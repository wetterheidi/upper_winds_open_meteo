// liveTrackingManager.js
"use strict";

import { UI_DEFAULTS, SMOOTHING_DEFAULTS } from './constants.js';
import { AppState } from './state.js';
import { Utils } from './utils.js';
import { getCapacitor } from './capacitor-adapter.js';
import { DateTime } from 'luxon'; // <--- DIESE ZEILE HINZUFÜGEN
import { saveRecordedTrack } from './trackManager.js'; // <-- NEU: Importieren

// Zähler, um die ersten ungenauen Web-Geolocation-Events zu überspringen
let webUpdateCounter = 0;

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

function updateAccuracyCircle(lat, lng, accuracy) {
    if (AppState.accuracyCircle) {
        AppState.map.removeLayer(AppState.accuracyCircle);
    }
    AppState.accuracyCircle = L.circle([lat, lng], {
        radius: accuracy, color: 'blue', fillOpacity: 0.1, weight: 1, dashArray: '5, 5', pmIgnore: true
    }).addTo(AppState.map);
}

const debouncedPositionUpdate = Utils.debounce(async (position) => {
    console.log("[LiveTrackingManager] Received position data:", position);
    if (!AppState.map) {
        console.warn("[LiveTrackingManager] Map not initialized, skipping position update.");
        return;
    }

    const { latitude, longitude, accuracy, altitude: deviceAltitude, altitudeAccuracy } = position.coords;

    // Offset-Berechnung nur beim allerersten validen Punkt einer Aufzeichnung
    if (AppState.recordedTrackPoints.length === 0 && AppState.altitudeCorrectionOffset === 0 && deviceAltitude !== null && AppState.lastAltitude !== 'N/A') {
        const heightDifference = Math.abs(deviceAltitude - AppState.lastAltitude);
        
        // Plausibilitätscheck: Ist der Unterschied < 150m?
        // Das deutet auf einen Start am Boden hin.
        if (heightDifference < 150) {
            AppState.altitudeCorrectionOffset = deviceAltitude - AppState.lastAltitude;
            console.log(`Bodenstart erkannt. Korrektur-Offset berechnet: ${AppState.altitudeCorrectionOffset.toFixed(2)}m`);
        } else {
            // Start in der Luft erkannt. Keine Korrektur anwenden.
            AppState.altitudeCorrectionOffset = 0; // Explizit auf 0 setzen
            console.warn(`Start in der Luft erkannt (Höhendifferenz: ${heightDifference.toFixed(0)}m). Es wird keine Höhenkorrektur angewendet.`);
            Utils.handleMessage("Airborne start: Altitudes are uncorrected (Ellipsoid).");
        }
    }

    // Wende die Korrektur nur an, wenn ein gültiger Offset berechnet wurde.
    const correctedAltitude = (deviceAltitude !== null && AppState.altitudeCorrectionOffset !== 0)
        ? deviceAltitude - AppState.altitudeCorrectionOffset
        : deviceAltitude;


    const isFirstUpdate = !AppState.liveMarker;
    const accuracyThreshold = isFirstUpdate ? 500 : UI_DEFAULTS.GEOLOCATION_ACCURACY_THRESHOLD_M;

    if (accuracy > accuracyThreshold) {
        console.log(`[LiveTrackingManager] Skipping position update. Accuracy (${accuracy}m) is lower than threshold (${accuracyThreshold}m).`);
        return;
    }
    const currentTime = Date.now();
    let speedMs = 0;
    let direction = 'N/A';
    let descentRateMps = 0; // NEU: Variable für die Sinkrate

    if (AppState.prevLat !== null && AppState.prevLng !== null && AppState.prevTime !== null && AppState.prevAltitude !== null) {
        const timeDiff = (currentTime - AppState.prevTime) / 1000;
        if (timeDiff > SMOOTHING_DEFAULTS.MIN_TIME_DIFF_FOR_SPEED_CALC_S) {
            // Horizontale Geschwindigkeit berechnen
            const distance = AppState.map.distance([AppState.prevLat, AppState.prevLng], [latitude, longitude]);
            speedMs = distance / timeDiff;
            direction = Utils.calculateBearing(AppState.prevLat, AppState.prevLng, latitude, longitude);

            // NEU: Vertikale Geschwindigkeit (Sinkrate) berechnen
            const altitudeDiff = AppState.prevAltitude - deviceAltitude; // positiv bei Sinken
            descentRateMps = altitudeDiff / timeDiff;
        }
    }

    // Glättung der Werte für eine stabilere Anzeige
    const alphaSpeed = speedMs < SMOOTHING_DEFAULTS.SPEED_SMOOTHING_TRESHOLD ? SMOOTHING_DEFAULTS.SPEED_SMOOTHING_LOW : SMOOTHING_DEFAULTS.SPEED_SMOOTHING_HIGH;
    AppState.lastSmoothedSpeedMs = alphaSpeed * speedMs + (1 - alphaSpeed) * AppState.lastSmoothedSpeedMs;
    const alphaDescent = 0.5; // Fester Glättungsfaktor für die Sinkrate
    AppState.lastSmoothedDescentRateMps = alphaDescent * descentRateMps + (1 - alphaDescent) * (AppState.lastSmoothedDescentRateMps || 0);


    if (!AppState.liveMarker) {
        AppState.liveMarker = L.marker([latitude, longitude], {
            icon: createLiveMarkerIcon(direction),
            zIndexOffset: 1000,
            pmIgnore: true
        }).addTo(AppState.map);
    } else {
        AppState.liveMarker.setLatLng([latitude, longitude]);
        AppState.liveMarker.setIcon(createLiveMarkerIcon(direction));
    }

    if (accuracy) {
        updateAccuracyCircle(latitude, longitude, accuracy);
    }

    // Vorherige Werte für die nächste Berechnung speichern
    AppState.prevLat = latitude;
    AppState.prevLng = longitude;
    AppState.prevTime = currentTime;
    AppState.prevAltitude = deviceAltitude; // NEU: Höhe speichern

    // Event mit den neuen Daten auslösen
    const event = new CustomEvent('tracking:positionUpdated', {
        detail: {
            latitude, longitude, 
            deviceAltitude: correctedAltitude, 
            altitudeAccuracy, accuracy,
            speedMs: AppState.lastSmoothedSpeedMs,
            descentRateMps: AppState.lastSmoothedDescentRateMps,
            direction: typeof direction === 'number' ? direction.toFixed(0) : 'N/A'
        },
        bubbles: true, cancelable: true
    });

    if (AppState.isAutoRecording || AppState.isManualRecording) {
        console.log(`Recording point. Live Altitude (deviceAltitude): ${deviceAltitude}, DIP Altitude (lastAltitude): ${AppState.lastAltitude}`);

        AppState.recordedTrackPoints.push({
            lat: latitude,
            lng: longitude,
            ele: correctedAltitude,
            time: DateTime.utc()
        });
    }

    document.dispatchEvent(event);
}, 300);

/**
 * Prüft die GPS-Berechtigungen und fordert sie bei Bedarf an.
 * @returns {Promise<boolean>} Gibt `true` zurück, wenn die Berechtigung erteilt wurde.
 * @private
 */
async function checkAndRequestPermissions() {
    const { Geolocation } = await getCapacitorModules();
    let permissions = await Geolocation.checkPermissions();
    console.log('Initial geolocation permissions state:', permissions.location);

    if (permissions.location === 'denied') {
        Utils.handleError('GPS permission was denied. Please enable it in the app settings.');
        return false;
    }

    if (permissions.location === 'prompt' || permissions.location === 'prompt-with-rationale') {
        permissions = await Geolocation.requestPermissions();
        console.log('New geolocation permissions state:', permissions.location);
    }

    if (permissions.location !== 'granted') {
        Utils.handleError('GPS permission is required for live tracking.');
        return false;
    }

    return true;
}

/**
 * Startet die kontinuierliche Abfrage der GPS-Position des Geräts.
 * Verwendet `navigator.geolocation.watchPosition` für regelmäßige Updates.
 * Löst ein 'tracking:started'-Event aus, um andere Teile der Anwendung zu informieren.
 * @returns {void}
 */
export async function startPositionTracking() {
    if (AppState.watchId !== null) return;
    console.log("[LiveTrackingManager] Attempting to start position tracking...");

    // Hole die Module über den Adapter
    const { Geolocation, isNative } = await getCapacitor();

    if (isNative && Geolocation) { // Prüfe, ob wir in der nativen App sind UND das Modul geladen wurde
        try {
            await Geolocation.requestPermissions(); // Berechtigung anfordern
            const watchId = await Geolocation.watchPosition({ enableHighAccuracy: true }, (position, err) => {
                if (err || !position) {
                    Utils.handleError(`Geolocation error: ${err?.message || 'No position'}`);
                    stopPositionTracking();
                    return;
                }
                debouncedPositionUpdate(position);
            });
            AppState.watchId = watchId;
            document.dispatchEvent(new CustomEvent('tracking:started'));
        } catch (error) {
            Utils.handleError(`Failed to start tracking: ${error.message}`);
        }
    } else {
        console.log("[LiveTrackingManager] Using navigator.geolocation for tracking.");
        if (!navigator.geolocation) {
            Utils.handleError("Geolocation is not supported by your browser.");
            document.dispatchEvent(new CustomEvent('tracking:stopped'));
            return;
        }
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
}

/**
 * Beendet die kontinuierliche Abfrage der GPS-Position.
 * Löscht den Watcher, entfernt die zugehörigen Marker und Kreise von der Karte
 * und setzt die Tracking-Variablen im AppState zurück.
 * Löst ein 'tracking:stopped'-Event aus.
 * @returns {void}
 */
export async function stopPositionTracking() {
    if (AppState.watchId !== null) {
        // Hole die Module erneut, um sicherzugehen
        const { Geolocation, isNative } = await getCapacitor();

        if (isNative && Geolocation) {
            await Geolocation.clearWatch({ id: AppState.watchId });
            console.log("[LiveTrackingManager] Stopped Capacitor position tracking.");
        } else {
            navigator.geolocation.clearWatch(AppState.watchId);
        }
        AppState.watchId = null;
    }

    if (AppState.liveMarker) AppState.map.removeLayer(AppState.liveMarker);
    if (AppState.accuracyCircle) AppState.map.removeLayer(AppState.accuracyCircle);
    AppState.liveMarker = null;
    AppState.accuracyCircle = null;
    AppState.prevLat = null;
    AppState.prevLng = null;

    AppState.altitudeCorrectionOffset = 0; // Wichtig: Offset zurücksetzen
    document.dispatchEvent(new CustomEvent('tracking:stopped'));
}

/**
 * Startet oder stoppt die manuelle Aufzeichnung eines Tracks.
 * Wird durch den neuen Button im Dashboard gesteuert.
 */
export function toggleManualRecording() {
    if (AppState.isAutoRecording) {
        Utils.handleMessage("Cannot start manual recording while auto-recording is active.");
        return;
    }

    AppState.isManualRecording = !AppState.isManualRecording;

    if (AppState.isManualRecording) {
        // Manuelle Aufnahme starten
        AppState.recordedTrackPoints = []; // Track zurücksetzen
        AppState.altitudeCorrectionOffset = 0; // WICHTIG: Offset zurücksetzen
        startPositionTracking(); // Tracking starten, falls es nicht läuft
        Utils.handleMessage("Manual recording started.");
        document.dispatchEvent(new CustomEvent('sensor:freefall_detected')); // Simuliert den Start
    } else {
        // Manuelle Aufnahme stoppen
        Utils.handleMessage("Manual recording stopped. Saving track...");
        saveRecordedTrack(); // Track speichern
        // Das Tracking wird hier NICHT gestoppt, da es unabhängig weiterlaufen kann.
        document.dispatchEvent(new CustomEvent('sensor:disarmed'));
    }

    // Button-Zustand in der UI aktualisieren
    const manualButton = document.getElementById('manual-recording-button');
    if (manualButton) {
        if (AppState.isManualRecording) {
            manualButton.textContent = "Stop Recording";
            manualButton.classList.add('recording');
        } else {
            manualButton.textContent = "Start Recording";
            manualButton.classList.remove('recording');
        }
    }
}