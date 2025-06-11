// liveTrackingManager.js
"use strict";

import { AppState } from './state.js';
import { Utils } from './utils.js';

// Private Hilfsfunktionen
function createLiveMarker(lat, lng) {
    return L.marker([lat, lng], {
        icon: L.divIcon({
            className: 'live-marker',
            html: '<div style="background-color: blue; width: 10px; height: 10px; border-radius: 50%;"></div>',
            iconSize: [10, 10],
            iconAnchor: [5, 5]
        }),
        zIndexOffset: 1000 // Sicherer Wert, um über anderen Layern zu sein
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
    if (!AppState.map) return;

    const { latitude, longitude, accuracy, altitude: deviceAltitude, altitudeAccuracy } = position.coords;
    if (accuracy > 100) return;

    const currentTime = Date.now();
    let speedMs = 0;
    let direction = 'N/A';

    if (AppState.prevLat && AppState.prevLng && AppState.prevTime) {
        const distance = AppState.map.distance([AppState.prevLat, AppState.prevLng], [latitude, longitude]);
        const timeDiff = (currentTime - AppState.prevTime) / 1000;
        if (timeDiff > 0.5) {
            speedMs = distance / timeDiff;
            // HIER IST DIE WIEDERHERGESTELLTE GLÄTTUNG
            const alpha = speedMs < 25 ? 0.5 : 0.2;
            AppState.lastSmoothedSpeedMs = alpha * speedMs + (1 - alpha) * AppState.lastSmoothedSpeedMs;
            
            direction = Utils.calculateBearing(AppState.prevLat, AppState.prevLng, latitude, longitude).toFixed(0);
        }
    }
    
    AppState.prevLat = latitude;
    AppState.prevLng = longitude;
    AppState.prevTime = currentTime;

    if (!AppState.liveMarker) {
        AppState.liveMarker = createLiveMarker(latitude, longitude).addTo(AppState.map);
    } else {
        AppState.liveMarker.setLatLng([latitude, longitude]);
    }

    if (accuracy) {
        updateAccuracyCircle(latitude, longitude, accuracy);
    }

    const event = new CustomEvent('tracking:positionUpdated', {
        detail: { latitude, longitude, deviceAltitude, altitudeAccuracy, accuracy, speedMs: AppState.lastSmoothedSpeedMs, direction },
        bubbles: true, cancelable: true
    });
    document.dispatchEvent(event);
}, 300);

// Öffentliche Funktionen
export function startPositionTracking() {
    if (AppState.watchId !== null) return;
    if (!navigator.geolocation) {
        Utils.handleError("Geolocation is not supported by your browser.");
        document.dispatchEvent(new CustomEvent('tracking:stopped')); // Event zum Aufräumen der UI senden
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
        console.log("[LiveTrackingManager] Stopped position tracking.");
    }
    if (AppState.liveMarker) AppState.map.removeLayer(AppState.liveMarker);
    if (AppState.accuracyCircle) AppState.map.removeLayer(AppState.accuracyCircle);
    AppState.liveMarker = null;
    AppState.accuracyCircle = null;
    AppState.prevLat = null;
    AppState.prevLng = null;
    AppState.prevTime = null;
    document.dispatchEvent(new CustomEvent('tracking:stopped'));
}