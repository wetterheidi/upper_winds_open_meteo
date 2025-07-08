"use strict";

import { AppState } from './state.js';
import { Utils } from './utils.js';

const SENSOR_FREQUENCY = 20; // Erhöhen für präzisere Ruck-Erkennung
const JERK_THRESHOLD = 25.0; // Schwellenwert für die Beschleunigungsänderung (m/s^3)
const LANDING_THRESHOLD = 0.5; // <--- DIESE ZEILE WIEDER HINZUFÜGEN
const LANDING_DURATION = 10;   // <--- DIESE ZEILE WIEDER HINZUFÜGEN
const MIN_RECORDING_DURATION_BEFORE_LANDING = 20; // in Sekunden


let accelerometer;
let lastX = 0, lastY = 0, lastZ = 0;
let lastTimestamp = 0;
let landingStartTimestamp = null; // <--- DIESE ZEILE HINZUFÜGEN
let freefallStartTimestamp = null; // <--- DIESE ZEILE HINZUFÜGEN

function handleReading() {
    if (!accelerometer || !lastTimestamp) {
        lastTimestamp = accelerometer.timestamp;
        return;
    }

    const dt = (accelerometer.timestamp - lastTimestamp) / 1000.0; // Zeit in Sekunden
    if (dt === 0) return;

    // Ruck berechnen (Änderung der Beschleunigung über die Zeit)
    const jerkX = (accelerometer.x - lastX) / dt;
    const jerkY = (accelerometer.y - lastY) / dt;
    const jerkZ = (accelerometer.z - lastZ) / dt;
    const jerkMagnitude = Math.sqrt(jerkX**2 + jerkY**2 + jerkZ**2);

    if (jerkMagnitude > JERK_THRESHOLD) {
        if (AppState.isArmed && !AppState.isAutoRecording) {
            console.log(`Jerk detected! Magnitude: ${jerkMagnitude.toFixed(2)}. Starting recording.`);
            document.dispatchEvent(new CustomEvent('sensor:freefall_detected'));
            // Wichtig: Sensor nach Auslösung stoppen, um weitere Events zu vermeiden
            stopSensor();
        }
    }

    // Aktuelle Werte für die nächste Messung speichern
    lastX = accelerometer.x;
    lastY = accelerometer.y;
    lastZ = accelerometer.z;
    lastTimestamp = accelerometer.timestamp;
}

function startSensor() {
    try {
        accelerometer = new LinearAccelerationSensor({ frequency: SENSOR_FREQUENCY });
        accelerometer.addEventListener('reading', handleReading);
        accelerometer.addEventListener('error', (event) => {
            Utils.handleError(`Accelerometer error: ${event.error.name} - ${event.error.message}`);
        });
        accelerometer.start();
        console.log("Accelerometer started.");
    } catch (error) {
        Utils.handleError(`Could not start accelerometer: ${error.name} - ${error.message}`);
    }
}

function stopSensor() {
    if (accelerometer) {
        accelerometer.removeEventListener('reading', handleReading);
        accelerometer.stop();
        accelerometer = null;
        console.log("Accelerometer stopped.");
    }
    freefallStartTimestamp = null;
    landingStartTimestamp = null;
}

export const SensorManager = {
    arm() {
        if (AppState.isArmed) return;

        console.log("Arming automatic jump recording...");
        // Berechtigungen anfragen und Sensor starten
        navigator.permissions.query({ name: 'accelerometer' }).then(result => {
            if (result.state === 'denied') {
                Utils.handleError('Permission to use accelerometer was denied.');
                return;
            }
            AppState.isArmed = true;
            startSensor();
            Utils.handleMessage('System armed. Ready for jump detection.');
            document.dispatchEvent(new CustomEvent('sensor:armed'));
        });
    },

    disarm() {
        if (!AppState.isArmed) return;
        console.log("Disarming automatic jump recording.");
        AppState.isArmed = false;
        stopSensor();
        document.dispatchEvent(new CustomEvent('sensor:disarmed'));
    },
    
    checkLanding(descentRateMps) {
        if (!AppState.isAutoRecording) return;

        // ================== START DER NEUEN LOGIK ==================
        
        // WICHTIG: Prüfe erst, ob genügend Datenpunkte vorhanden sind.
        // Das verhindert, dass die Landerkennung sofort startet.
        const MIN_POINTS_BEFORE_LANDING_CHECK = 10;
        if (AppState.recordedTrackPoints.length < MIN_POINTS_BEFORE_LANDING_CHECK) {
            return; // Zu früh, um eine Landung zu prüfen.
        }

        // =================== ENDE DER NEUEN LOGIK ====================

        // Jetzt die eigentliche Landerkennung starten
        if (Math.abs(descentRateMps) < LANDING_THRESHOLD) {
            if (!landingStartTimestamp) {
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