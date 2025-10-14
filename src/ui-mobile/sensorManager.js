/**
 * @file sensorManager.js
 * @description Verwaltet die Gerätesensoren (Beschleunigungsmesser) zur automatischen
 * Erkennung eines Fallschirmsprungs (Freifall) und der Landung.
 */

"use strict";

import { AppState } from '../core/state.js';
import { Utils } from '../core/utils.js';

// ===================================================================
// 1. Modul-Konstanten & Zustand
// ===================================================================


// --- KONSTANTEN ---
const SENSOR_FREQUENCY = 60;        // In Hz, hohe Frequenz für präzise Ruck-Erkennung
const JERK_THRESHOLD = 30.0;        // (m/s^3) Schwellenwert für den Ruck GROK 40-50
const FREEFALL_ACCEL_MAX = 2.5;     // (m/s^2) Angepasster Schwellenwert für den Standard-Beschleunigungssensor
const FREEFALL_CONFIRM_TIME = 1500;   // (ms) Zeitfenster, in dem alle Bedingungen erfüllt sein müssen
const DESCENT_RATE_THRESHOLD = 10;  // (m/s) Mindestsinkrate, um einen Sprung zu bestätigen

// Konstanten für die Landerkennung
const LANDING_THRESHOLD = 0.5; //Schwellenwert der Sinkrate, unter dem eine Landung angenommen wird.
const LANDING_DURATION = 10; //Zeit in Sekunden, die die Sinkrate unter dem Schwellenwert bleiben muss, um eine Landung zu bestätigen.

// === ZUSTANDS-VARIABLEN ===
let sensorApi = null; // Hält entweder den Sensor oder den Event-Listener-Namen
let lastX = 0, lastY = 0, lastZ = 0;
let lastTimestamp = 0;
let landingStartTimestamp = null;
let jerkDetectionTimeout = null;
let lastDescentRate = 0;

// ===================================================================
// 2. Öffentliche Schnittstelle (SensorManager-Objekt)
// ===================================================================

export const SensorManager = {
    /**
     * "Schärft" das System zur Sprungerkennung. Startet die Sensoren und lauscht auf GPS-Updates.
     * Fordert bei Bedarf die notwendigen Berechtigungen vom Benutzer an.
     */
    async arm() {
        if (AppState.isArmed) return;
        console.log("Arming system...");

        const activateSensors = async () => {
            try {
                await startSensor(); // Warte, bis der Sensor wirklich gestartet ist
                
                AppState.isArmed = true;
                document.addEventListener('tracking:positionUpdated', updateDescentRate);
                
                Utils.handleMessage('System armed. Ready for jump detection.');
                document.dispatchEvent(new CustomEvent('sensor:armed'));

            } catch (error) {
                Utils.handleError(`Could not start accelerometer: ${error.message}`);
            }
        };

        if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
            try {
                const permissionState = await DeviceMotionEvent.requestPermission();
                if (permissionState === 'granted') {
                    await activateSensors();
                } else {
                    Utils.handleError('Permission to use motion sensors was denied.');
                }
            } catch (error) {
                console.error('Error requesting motion sensor permission:', error);
                Utils.handleError('Could not request sensor permission.');
            }
        } else {
            // Fallback für Android etc.
            try {
                const result = await navigator.permissions.query({ name: 'accelerometer' });
                if (result.state === 'denied') {
                    Utils.handleError('Permission to use accelerometer was denied.');
                    return;
                }
                await activateSensors();
            } catch (error) {
                Utils.handleError('Could not query accelerometer permission.');
                console.error(error);
            }
        }
    },

    /**
     * "Entschärft" das System und stoppt die Sensorabfrage.
     */
    disarm() {
        if (!AppState.isArmed) return;
        console.log("Disarming system...");
        AppState.isArmed = false;
        stopSensor();
        document.dispatchEvent(new CustomEvent('sensor:disarmed'));
    },
    
    /**
     * Überprüft bei jeder Positionsaktualisierung, ob eine Landung stattgefunden hat.
     * @param {number} descentRateMps - Die aktuelle Sinkrate in m/s.
     */
    checkLanding(descentRateMps) {
        if (!AppState.isAutoRecording) return;
        const MIN_POINTS_BEFORE_LANDING_CHECK = 10;
        if (AppState.recordedTrackPoints.length < MIN_POINTS_BEFORE_LANDING_CHECK) return;

        if (Math.abs(descentRateMps) < LANDING_THRESHOLD) {
            if (landingStartTimestamp === null) {
                landingStartTimestamp = performance.now();
            } else if ((performance.now() - landingStartTimestamp) / 1000 >= LANDING_DURATION) {
                console.log("Landing detected! Stopping recording.");
                document.dispatchEvent(new CustomEvent('sensor:landing_detected'));
            }
        } else {
            landingStartTimestamp = null;
        }
    }
};

// ===================================================================
// 3. Kernlogik der Sprungerkennung
// ===================================================================

/**
 * Verarbeitet die Sensor-Rohdaten und implementiert die zweistufige Logik zur Sprungerkennung.
 * Stufe 1: Warten auf einen starken Ruck (Exit).
 * Stufe 2: Nach dem Ruck innerhalb eines Zeitfensters auf Beschleunigungswerte nahe Null (Freifall)
 * UND eine hohe Sinkrate vom GPS warten.
 * @param {number} ax - Beschleunigung auf der x-Achse.
 * @param {number} ay - Beschleunigung auf der y-Achse.
 * @param {number} az - Beschleunigung auf der z-Achse.
 * @param {number} timestamp - Der Zeitstempel der Messung.
 * @private
 */
function processSensorData(ax, ay, az, timestamp) {
    if (!timestamp) return;

    if (!lastTimestamp) {
        lastTimestamp = timestamp;
        return;
    }

    const dt = (timestamp - lastTimestamp) / 1000.0;
    if (dt <= 0) return;

    if (AppState.isArmed) {
        const jerkMagnitude = Math.sqrt(((ax - lastX) / dt)**2 + ((ay - lastY) / dt)**2 + ((az - lastZ) / dt)**2);
        // Da der Standard-Accelerometer die Schwerkraft misst, ist der Betrag im freien Fall nahe 0 (nicht ~9.81).
        const accelMagnitude = Math.sqrt(ax**2 + ay**2 + az**2);

        // Zustand 1: Warten auf den initialen Ruck
        if (!jerkDetectionTimeout) {
            if (jerkMagnitude > JERK_THRESHOLD) {
                console.log(`Phase 1: Jerk detected (Magnitude: ${jerkMagnitude.toFixed(2)}). Awaiting confirmation...`);
                jerkDetectionTimeout = setTimeout(() => {
                    console.log("Confirmation window timed out. Resetting state.");
                    jerkDetectionTimeout = null;
                }, FREEFALL_CONFIRM_TIME);
            }
        }
        // Zustand 2: Ruck erkannt, jetzt auf Freifall UND Sinkrate prüfen
        else {
            if (accelMagnitude < FREEFALL_ACCEL_MAX && lastDescentRate > DESCENT_RATE_THRESHOLD) {
                console.log(`Phase 2: Confirmation! Freefall (Accel: ${accelMagnitude.toFixed(2)}) AND Descent Rate (${lastDescentRate.toFixed(1)} m/s). Starting recording!`);
                
                document.dispatchEvent(new CustomEvent('sensor:freefall_detected'));
                
                clearTimeout(jerkDetectionTimeout);
                jerkDetectionTimeout = null;
                SensorManager.disarm();
            }
        }
    }

    lastX = ax;
    lastY = ay;
    lastZ = az;
    lastTimestamp = timestamp;
}

// ===================================================================
// 4. Sensor-Management & Event-Handler
// ===================================================================

/**
 * Startet den bestmöglichen verfügbaren Beschleunigungssensor.
 * @returns {Promise<void>}
 * @private
 */
function startSensor() {
    return new Promise((resolve, reject) => {
        // 1. Wahl: LinearAccelerationSensor (Android)
        if ('LinearAccelerationSensor' in window) {
            try {
                const sensor = new LinearAccelerationSensor({ frequency: SENSOR_FREQUENCY });
                sensor.addEventListener('reading', handleSensorReading);
                sensor.addEventListener('error', (event) => reject(event.error));
                sensor.start();
                sensorApi = sensor;
                console.log("LinearAccelerationSensor started.");
                resolve();
            } catch (error) {
                reject(error);
            }
        // 2. Wahl: DeviceMotionEvent (iOS)
        } else if (typeof DeviceMotionEvent !== 'undefined') {
            window.addEventListener('devicemotion', handleDeviceMotionEvent);
            sensorApi = 'devicemotion';
            console.log("Attached devicemotion listener for iOS.");
            resolve();
        // 3. Wahl: Standard Accelerometer (Fallback)
        } else if ('Accelerometer' in window) {
             try {
                const sensor = new Accelerometer({ frequency: SENSOR_FREQUENCY });
                sensor.addEventListener('reading', handleSensorReading);
                sensor.addEventListener('error', (event) => reject(event.error));
                sensor.start();
                sensorApi = sensor;
                console.log("Standard Accelerometer started.");
                resolve();
            } catch (error) {
                reject(error);
            }
        } else {
            reject(new Error("No compatible accelerometer API found."));
        }
    });
}

/**
 * Stoppt den aktiven Sensor oder Listener und bereinigt den Zustand.
 * @private
 */
function stopSensor() {
    if (typeof sensorApi === 'object' && sensorApi !== null) { // Standard Sensor
        sensorApi.removeEventListener('reading', handleSensorReading);
        sensorApi.stop();
        console.log("Sensor stopped.");
    } else if (sensorApi === 'devicemotion') { // iOS Event Listener
        window.removeEventListener('devicemotion', handleDeviceMotionEvent);
        console.log("Removed devicemotion listener.");
    }
    
    sensorApi = null;
    document.removeEventListener('tracking:positionUpdated', updateDescentRate);
    if (jerkDetectionTimeout) {
        clearTimeout(jerkDetectionTimeout);
    }
    jerkDetectionTimeout = null;
    lastTimestamp = 0;
    landingStartTimestamp = null;
}

/**
 * Event-Handler für die Standard-Sensor-API ('reading' Event).
 * @private
 */
const handleSensorReading = () => {
    if (!sensorApi) return;
    processSensorData(sensorApi.x, sensorApi.y, sensorApi.z, sensorApi.timestamp);
};

/**
 * Event-Handler für die DeviceMotionEvent-API (iOS).
 * @param {DeviceMotionEvent} event - Das Motion-Event.
 * @private
 */
const handleDeviceMotionEvent = (event) => {
    const { x, y, z } = event.accelerationIncludingGravity;
    if (x === null || y === null || z === null) return;
    processSensorData(x, y, z, event.timeStamp);
};

/**
 * Empfängt die Sinkrate aus dem 'tracking:positionUpdated' Event.
 * @param {CustomEvent} event - Das Event mit den Positionsdaten.
 * @private
 */
function updateDescentRate(event) {
    if (!event.detail) {
        return;
    }
    if (typeof event.detail.descentRateMps === 'number') {
        lastDescentRate = event.detail.descentRateMps;
        return;
    }
    if (typeof event.detail.rateOfClimbMps === 'number') {
        const roc = event.detail.rateOfClimbMps;
        lastDescentRate = roc < 0 ? -roc : 0;
    }
}