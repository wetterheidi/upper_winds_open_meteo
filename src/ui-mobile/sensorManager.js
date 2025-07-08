// src/ui-mobile/sensorManager.js

"use strict";

import { AppState } from '../core/state.js';
import { Utils } from '../core/utils.js';

// Konstanten für die Erkennung
const FREEFALL_THRESHOLD = 1.5;
const MIN_FREEFALL_DURATION = 500;
const LANDING_THRESHOLD = 0.5;
const LANDING_DURATION = 10;

// Zustandsvariablen für den Sensor
let accelHandler = null;
let freeFallStartTime = null;
let landingStartTimestamp = null;

/**
 * Verarbeitet die Beschleunigungsdaten, um den freien Fall zu erkennen.
 */
function handleMotion(event) {
    if (AppState.isAutoRecording) return;
    const { x, y, z } = event.acceleration;
    const magnitude = Math.sqrt(x * x + y * y + z * z);

    if (magnitude < FREEFALL_THRESHOLD) {
        if (freeFallStartTime === null) {
            freeFallStartTime = Date.now();
        } else if (Date.now() - freeFallStartTime >= MIN_FREEFALL_DURATION) {
            console.log(`Freefall detected! Magnitude: ${magnitude.toFixed(2)}. Starting recording.`);
            document.dispatchEvent(new CustomEvent('sensor:freefall_detected'));
            stopSensor();
        }
    } else {
        freeFallStartTime = null;
    }
}

/**
 * Startet den Bewegungssensor.
 */
async function startSensor() {
    try {
        // Dynamischer Import, um sicherzustellen, dass das Modul nur bei Bedarf geladen wird.
        const { Motion } = await import('@capacitor/motion');
        accelHandler = await Motion.addListener('accel', handleMotion);
        console.log("Motion sensor started.");
    } catch (error) {
        Utils.handleError(`Could not start motion sensor: ${error.message}`);
    }
}

/**
 * Stoppt den Bewegungssensor.
 */
function stopSensor() {
    if (accelHandler) {
        accelHandler.remove();
        accelHandler = null;
        console.log("Motion sensor stopped.");
    }
    freeFallStartTime = null;
}

export const SensorManager = {
    /**
     * Schärft das System für die automatische Sprungerkennung.
     */
    arm() {
        if (AppState.isArmed) return;
        console.log("Arming automatic jump recording...");

        const startArming = () => {
            AppState.isArmed = true;
            startSensor();
            Utils.handleMessage('System armed. Ready for jump detection.');
            document.dispatchEvent(new CustomEvent('sensor:armed'));
        };

        if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
            DeviceMotionEvent.requestPermission().then(permissionState => {
                if (permissionState === 'granted') {
                    startArming();
                } else {
                    Utils.handleError('Permission to use motion sensor was denied.');
                }
            }).catch(console.error);
        } else {
            startArming();
        }
    },

    /**
     * Entschärft das System.
     */
    disarm() {
        if (!AppState.isArmed) return;
        console.log("Disarming automatic jump recording.");
        AppState.isArmed = false;
        stopSensor();
        document.dispatchEvent(new CustomEvent('sensor:disarmed'));
    },

    /**
     * Prüft auf eine Landung.
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