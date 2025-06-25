// liveTrackingManager.js
"use strict";

import { UI_DEFAULTS, SMOOTHING_DEFAULTS } from './constants.js';
import { AppState } from './state.js';
import { Utils } from './utils.js';


// --- Private Hilfsfunktionen ---

/**
 * Erstellt ein benutzerdefiniertes Leaflet-Icon für den Live-Marker,
 * das einen Punkt und einen Pfeil enthält, der in die angegebene Richtung gedreht ist.
 * @param {number|string} direction - Die Bewegungsrichtung in Grad (0-360).
 * @returns {L.DivIcon} Das konfigurierte Leaflet DivIcon.
 */
function createLiveMarkerIcon(direction) {
    // Stellt sicher, dass die Rotation eine gültige Zahl ist, ansonsten 0.
    const rotation = (typeof direction === 'number' && isFinite(direction)) ? direction : 0;

    // Das HTML für das Icon: ein Wrapper für die Rotation, der Punkt und der Pfeil.
    const iconHtml = `
        <div class="live-marker-wrapper" style="transform: rotate(${rotation}deg);">
            <div class="live-marker-dot"></div>
            <div class="live-marker-arrow"></div>
        </div>
    `;

    return L.divIcon({
        className: 'live-marker-container', // Container-Klasse ohne Standard-Leaflet-Stile
        html: iconHtml,
        iconSize: [24, 24], // Größe des Icons
        iconAnchor: [12, 12] // Zentriert das Icon auf der Koordinate
    });
}

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
    console.log("[LiveTrackingManager] Received position data:", position);
    if (!AppState.map) {
        console.warn("[LiveTrackingManager] Map not initialized, skipping position update.");
        return;
    }

    const { latitude, longitude, accuracy, altitude: deviceAltitude, altitudeAccuracy } = position.coords;
    console.log("[LiveTrackingManager] Position details:", { latitude, longitude, accuracy, deviceAltitude, altitudeAccuracy });

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
        if (timeDiff > SMOOTHING_DEFAULTS.MIN_TIME_DIFF_FOR_SPEED_CALC_S) {
            speedMs = distance / timeDiff;
            direction = Utils.calculateBearing(AppState.prevLat, AppState.prevLng, latitude, longitude);
        }
    }

    const alpha = speedMs < SMOOTHING_DEFAULTS.SPEED_SMOOTHING_TRESHOLD ? SMOOTHING_DEFAULTS.SPEED_SMOOTHING_LOW : SMOOTHING_DEFAULTS.SPEED_SMOOTHING_HIGH;
    AppState.lastSmoothedSpeedMs = alpha * speedMs + (1 - alpha) * AppState.lastSmoothedSpeedMs;

    // Marker erstellen oder aktualisieren
    if (!AppState.liveMarker) {
        // Erstellt den Marker beim ersten Mal mit der initialen Richtung
        AppState.liveMarker = L.marker([latitude, longitude], {
            icon: createLiveMarkerIcon(direction),
            zIndexOffset: 1000
        }).addTo(AppState.map);
    } else {
        // Aktualisiert bei Folgeaufrufen die Position und das Icon (für die Rotation)
        AppState.liveMarker.setLatLng([latitude, longitude]);
        AppState.liveMarker.setIcon(createLiveMarkerIcon(direction));
    }

    if (accuracy) {
        updateAccuracyCircle(latitude, longitude, accuracy);
    }
    
    AppState.prevLat = latitude;
    AppState.prevLng = longitude;
    AppState.prevTime = currentTime;

    const event = new CustomEvent('tracking:positionUpdated', {
        detail: {
            latitude, longitude, deviceAltitude, altitudeAccuracy, accuracy,
            speedMs: AppState.lastSmoothedSpeedMs,
            direction: typeof direction === 'number' ? direction.toFixed(0) : 'N/A'
        },
        bubbles: true, cancelable: true
    });
    console.log("[LiveTrackingManager] Dispatching tracking:positionUpdated event:", event.detail);
    document.dispatchEvent(event);
}, 300);

/**
 * Startet die kontinuierliche Abfrage der GPS-Position des Geräts.
 * Verwendet `navigator.geolocation.watchPosition` für regelmäßige Updates.
 * Löst ein 'tracking:started'-Event aus, um andere Teile der Anwendung zu informieren.
 * @returns {void}
 */
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

/**
 * Beendet die kontinuierliche Abfrage der GPS-Position.
 * Löscht den Watcher, entfernt die zugehörigen Marker und Kreise von der Karte
 * und setzt die Tracking-Variablen im AppState zurück.
 * Löst ein 'tracking:stopped'-Event aus.
 * @returns {void}
 */
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