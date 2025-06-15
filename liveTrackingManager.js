// liveTrackingManager.js
"use strict";

import { UI_DEFAULTS, SMOOTHING_DEFAULTS } from './constants.js';
import { AppState } from './state.js';
import { Utils } from './utils.js';
import * as L from 'leaflet';
window.L = L; // <-- DIESE ZEILE MUSS BLEIBEN
import 'leaflet/dist/leaflet.css'; // Nicht vergessen!

// --- Private Hilfsfunktionen ---

function createLiveMarker(lat, lng) {
    return L.marker([lat, lng], {
        icon: L.divIcon({
            className: 'live-marker',
            html: '<div style="background-color: blue; width: 10px; height: 10px; border-radius: 50%;"></div>',
            iconSize: [10, 10],
            iconAnchor: [5, 5]
        }),
        zIndexOffset: 1000
    });
}

function updateAccuracyCircle(lat, lng, accuracy) {
    if (AppState.accuracyCircle) {
        AppState.map.removeLayer(AppState.accuracyCircle);
    }
    AppState.accuracyCircle = L.circle([lat, lng], {
        radius: accuracy, color: 'blue', fillOpacity: 0.1, weight: 1, dashArray: '5, 5'
    }).addTo(AppState.map);
}

const debouncedPositionUpdate = Utils.debounce(async (position) => {
    console.log("[LiveTrackingManager] Received position data:", position); // Debug-Ausgabe
    if (!AppState.map) {
        console.warn("[LiveTrackingManager] Map not initialized, skipping position update.");
        return;
    }

    const { latitude, longitude, accuracy, altitude: deviceAltitude, altitudeAccuracy } = position.coords;
    console.log("[LiveTrackingManager] Position details:", { latitude, longitude, accuracy, deviceAltitude, altitudeAccuracy }); // Debug-Ausgabe

    if (accuracy > UI_DEFAULTS.GEOLOCATION_ACCURACY_THRESHOLD_M) {
        console.log("[LiveTrackingManager] Skipping position update due to low accuracy:", accuracy);
        return;
    }

    const currentTime = Date.now();
    let speedMs = 0;
    let direction = 'N/A';

    if (AppState.prevLat !== null && AppState.prevLng !== null && AppState.prevTime !== null) {
        const distance = AppState.map.distance([AppState.prevLat, AppState.prevLng], [latitude, longitude]);
        const timeDiff = (currentTime - AppState.prevTime) / 1000;
        if (timeDiff > 0.5) { // Nur berechnen, wenn genug Zeit vergangen ist
            speedMs = distance / timeDiff;
            direction = Utils.calculateBearing(AppState.prevLat, AppState.prevLng, latitude, longitude).toFixed(0);
        }
    }

    // WIEDERHERGESTELLT: Die wichtige Logik zur Glättung der Geschwindigkeit
    const alpha = speedMs < SMOOTHING_DEFAULTS.SPEED_SMOOTHING_TRESHOLD ? SMOOTHING_DEFAULTS.SPEED_SMOOTHING_LOW : SMOOTHING_DEFAULTS.SPEED_SMOOTHING_HIGH;
    AppState.lastSmoothedSpeedMs = alpha * speedMs + (1 - alpha) * AppState.lastSmoothedSpeedMs;

    // Aktualisiere die Marker-Position auf der Karte
    if (!AppState.liveMarker) {
        AppState.liveMarker = createLiveMarker(latitude, longitude).addTo(AppState.map);
    } else {
        AppState.liveMarker.setLatLng([latitude, longitude]);
    }

    if (accuracy) {
        updateAccuracyCircle(latitude, longitude, accuracy);
    }
    
    // WIEDERHERGESTELLT: Speichere die Position für die nächste Berechnung
    AppState.prevLat = latitude;
    AppState.prevLng = longitude;
    AppState.prevTime = currentTime;

    // Feuere das Event mit dem vollständigen und geglätteten Datensatz
    const event = new CustomEvent('tracking:positionUpdated', {
        detail: {
            latitude, longitude, deviceAltitude, altitudeAccuracy, accuracy,
            speedMs: AppState.lastSmoothedSpeedMs,
            direction
        },
        bubbles: true, cancelable: true
    });
    console.log("[LiveTrackingManager] Dispatching tracking:positionUpdated event:", event.detail); // Debug-Ausgabe
    document.dispatchEvent(event);
}, 300);

// --- Öffentliche (exportierte) Funktionen ---

export function startPositionTracking() {
    if (AppState.watchId !== null) return;
    if (!navigator.geolocation) {
        Utils.handleError("Geolocation is not supported by your browser.");
        document.dispatchEvent(new CustomEvent('tracking:stopped'));
        return;
    }
    console.log("[LiveTrackingManager] Starting position tracking...");
    AppState.watchId = navigator.geolocation.watchPosition(
        debouncedPositionUpdate,
        (error) => {
            Utils.handleError(`Geolocation error: ${error.message}`);
            stopPositionTracking();
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
    document.dispatchEvent(new CustomEvent('tracking:started'));
}

export function stopPositionTracking() {
    if (AppState.watchId !== null) {
        navigator.geolocation.clearWatch(AppState.watchId);
        AppState.watchId = null;
    }
    // Aufräumen der Karten-Elemente
    if (AppState.liveMarker) AppState.map.removeLayer(AppState.liveMarker);
    if (AppState.accuracyCircle) AppState.map.removeLayer(AppState.accuracyCircle);
    AppState.liveMarker = null;
    AppState.accuracyCircle = null;
    // Tracking-Variablen zurücksetzen
    AppState.prevLat = null;
    AppState.prevLng = null;
    AppState.prevTime = null;
    AppState.lastSmoothedSpeedMs = 0;
    
    document.dispatchEvent(new CustomEvent('tracking:stopped'));
    console.log("[LiveTrackingManager] Stopped position tracking and cleaned up.");
}