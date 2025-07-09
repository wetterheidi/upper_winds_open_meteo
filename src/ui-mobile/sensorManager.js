
"use strict";

import { AppState } from '../core/state.js';
import { Utils } from '../core/utils.js';

// --- KONSTANTEN ---
const SENSOR_FREQUENCY = 60;        // In Hz, hohe Frequenz für präzise Ruck-Erkennung
const JERK_THRESHOLD = 30.0;        // (m/s^3) Schwellenwert für den Ruck GROK 40-50
const FREEFALL_ACCEL_MAX = 1.5;     // (m/s^2) Maximale Beschleunigung im freien Fall GROK 2-2.5
const FREEFALL_CONFIRM_TIME = 1500;   // (ms) Zeitfenster, in dem alle Bedingungen erfüllt sein müssen
const DESCENT_RATE_THRESHOLD = 10;  // (m/s) Mindestsinkrate, um einen Sprung zu bestätigen

// Konstanten für die Landerkennung
const LANDING_THRESHOLD = 0.5;
const LANDING_DURATION = 10;

// === ZUSTANDS-VARIABLEN ===
let accelerometer = null;
let lastX = 0, lastY = 0, lastZ = 0;
let lastTimestamp = 0;
let landingStartTimestamp = null;
let jerkDetectionTimeout = null;
let lastDescentRate = 0; // Speichert die letzte bekannte Sinkrate vom GPS

/**
 * Event-Listener, der die GPS-Sinkrate aus dem Live-Tracking empfängt.
 */
function updateDescentRate(event) {
    if (event.detail && typeof event.detail.descentRateMps === 'number') {
        lastDescentRate = event.detail.descentRateMps;
    }
}

/**
 * Verarbeitet die Sensor-Daten und prüft auf die Drei-Faktor-Bedingung.
 */
function handleReading() {
    if (!accelerometer) return;

    const now = accelerometer.timestamp;
    if (!lastTimestamp) {
        lastTimestamp = now;
        return;
    }

    const dt = (now - lastTimestamp) / 1000.0;
    if (dt <= 0) return;

    const ax = accelerometer.x, ay = accelerometer.y, az = accelerometer.z;

    if (AppState.isArmed) {
        const jerkMagnitude = Math.sqrt(((ax - lastX) / dt)**2 + ((ay - lastY) / dt)**2 + ((az - lastZ) / dt)**2);
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
    lastTimestamp = now;
}

function startSensor() {
    try {
        if ('LinearAccelerationSensor' in window) {
            accelerometer = new LinearAccelerationSensor({ frequency: SENSOR_FREQUENCY });
            accelerometer.addEventListener('reading', handleReading);
            accelerometer.addEventListener('error', (event) => {
                Utils.handleError(`Accelerometer error: ${event.error.name}`);
                SensorManager.disarm();
            });
            accelerometer.start();
            console.log("LinearAccelerationSensor started.");
        } else {
            throw new Error("LinearAccelerationSensor API not supported.");
        }
    } catch (error) {
        Utils.handleError(`Could not start accelerometer: ${error.message}`);
    }
}

function stopSensor() {
    if (accelerometer) {
        accelerometer.removeEventListener('reading', handleReading);
        accelerometer.stop();
        accelerometer = null;
        console.log("Accelerometer stopped.");
    }
    document.removeEventListener('tracking:positionUpdated', updateDescentRate); // Wichtig: Listener entfernen
    if (jerkDetectionTimeout) {
        clearTimeout(jerkDetectionTimeout);
    }
    jerkDetectionTimeout = null;
    lastTimestamp = 0;
    landingStartTimestamp = null;
}

export const SensorManager = {
    arm() {
        if (AppState.isArmed) return;
        console.log("Arming system...");

        navigator.permissions.query({ name: 'accelerometer' }).then(result => {
            if (result.state === 'denied') {
                Utils.handleError('Permission to use accelerometer was denied.');
                return;
            }
            
            AppState.isArmed = true;
            // Starte BEIDE Listener: einen für den Beschleunigungssensor und einen für die GPS-Updates.
            startSensor();
            document.addEventListener('tracking:positionUpdated', updateDescentRate);
            
            Utils.handleMessage('System armed. Ready for jump detection.');
            document.dispatchEvent(new CustomEvent('sensor:armed'));

        }).catch(error => {
            Utils.handleError('Could not query accelerometer permission.');
            console.error(error);
        });
    },

    disarm() {
        if (!AppState.isArmed) return;
        console.log("Disarming system...");
        AppState.isArmed = false;
        stopSensor();
        document.dispatchEvent(new CustomEvent('sensor:disarmed'));
    },
    
    checkLanding(descentRateMps) {
        // Diese Funktion bleibt unverändert
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