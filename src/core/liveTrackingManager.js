/**
 * @file liveTrackingManager.js
 * @description Verwaltet das Live-Tracking der GPS-Position des Geräts,
 * die Verarbeitung der Positionsdaten und die manuelle Aufzeichnung von Tracks.
 * Nutzt Capacitor Geolocation für native Plattformen und `navigator.geolocation` als Fallback.
 */

"use strict";

import { UI_DEFAULTS, SMOOTHING_DEFAULTS } from './constants.js';
import { AppState } from './state.js';
import { Utils } from './utils.js';
import { getCapacitor } from './capacitor-adapter.js';
import { DateTime } from 'luxon';
import { saveRecordedTrack } from './trackManager.js';
import { showDisclosureModal } from '../ui-mobile/ui.js';

// ===================================================================
// 1. Öffentliche Hauptfunktionen (API des Moduls)
// ===================================================================

// NEU: Initialisierungs-Flag und Promise
let isTrackingInitializing = false;
let trackingInitPromise = null;

/**
 * Startet die kontinuierliche Abfrage der GPS-Position des Geräts.
 * Verwendet das Capacitor Geolocation-Plugin für native Plattformen und navigator.geolocation als Fallback für Web.
 * Löst ein 'tracking:started'-Event aus, um andere Teile der Anwendung zu informieren.
 * @returns {void}
 */
export async function startPositionTracking() {
    if (AppState.watchId !== null || isTrackingInitializing) return;
    isTrackingInitializing = true;
    if (!trackingInitPromise) {
        trackingInitPromise = (async () => {
            console.log("[LiveTrackingManager] Attempting to start position tracking...");

            // Prüfen, ob der Nutzer den Hinweis bereits bestätigt hat.
            const hasAcknowledged = localStorage.getItem('hasAcknowledgedLocationDisclosure');

            const proceedWithTracking = async () => {
                // FIX 1: Warte, bis Capacitor garantiert bereit ist.
                // getCapacitor() wartet jetzt intern auf 'deviceready'.
                const { Geolocation, isNative } = await getCapacitor();
                console.log("[LiveTrackingManager] Platform:", isNative ? window.Capacitor.getPlatform() : 'Web', "IsNative:", isNative);

                if (isNative && Geolocation) {
                    // --- Native Logik (iOS/Android) ---
                    try {
                        // Prüfe und fordere Berechtigungen an
                        const permissions = await checkAndRequestPermissions();
                        console.log("[LiveTrackingManager] Permissions result:", permissions);
                        if (!permissions) {
                            console.warn("[LiveTrackingManager] Permissions not granted, stopping tracking.");
                            return;
                        }

                        // Starte native Hintergrund-Tracking mit Capacitor Geolocation
                        const watchId = await Geolocation.watchPosition(
                            {
                                enableHighAccuracy: true,
                                timeout: 10000,
                                maximumAge: 0
                            },
                            (position, error) => {
                                if (error) {
                                    console.error("[LiveTrackingManager] Geolocation error:", error);
                                    Utils.handleError(`Geolocation error: ${error.message || 'Unknown error'}`);
                                    stopPositionTracking();
                                    return;
                                }
                                if (position) {
                                    console.log("[LiveTrackingManager] Received position:", position.coords);
                                    debouncedPositionUpdate(position);
                                }
                            }
                        );
                        AppState.watchId = watchId;
                        console.log("[LiveTrackingManager] Native Geolocation watcher started:", watchId);
                        document.dispatchEvent(new CustomEvent('tracking:started'));
                    } catch (error) {
                        console.error("[LiveTrackingManager] Failed to start native tracking:", error);
                        Utils.handleError(`Failed to start tracking: ${error.message || 'Unknown error'}`);
                        stopPositionTracking();
                    }
                } else {
                    // --- Web-Fallback-Logik ---
                    console.log("[LiveTrackingManager] Using navigator.geolocation for tracking (Web).");
                    if (!navigator.geolocation) {
                        Utils.handleError("Geolocation is not supported by your browser.");
                        document.dispatchEvent(new CustomEvent('tracking:stopped'));
                        return;
                    }
                    AppState.watchId = navigator.geolocation.watchPosition(
                        (position) => {
                            console.log("[LiveTrackingManager] Web position:", position.coords);
                            debouncedPositionUpdate(position);
                        },
                        (error) => {
                            console.error("[LiveTrackingManager] Web Geolocation error:", error);
                            Utils.handleError(`Geolocation error: ${error.message || 'Unknown error'}`);
                            stopPositionTracking();
                        },
                        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
                    );
                    console.log("[LiveTrackingManager] Web Geolocation watcher started:", AppState.watchId);
                    document.dispatchEvent(new CustomEvent('tracking:started'));
                }
            };

            if (!hasAcknowledged) {
                // Wenn der Hinweis noch nicht gezeigt wurde, zeige das Modal.
                showDisclosureModal({
                    title: "Notice on Location Use",
                    message: "DZMaster collects location data to enable the functions <strong>'Live Tracking'</strong> and <strong>'Automatic Jump Recording'</strong>. This also happens when the app is running in the background or the screen is off in order to record your complete jump. This data is only stored locally on your device and is not shared.",
                    onConfirm: () => {
                        localStorage.setItem('hasAcknowledgedLocationDisclosure', 'true');
                        proceedWithTracking(); // Fahre mit der Berechtigungsanfrage fort
                    },
                    onCancel: () => {
                        // Nutzer hat abgebrochen -> setze die UI zurück
                        const trackCheckbox = document.getElementById('trackPositionCheckbox');
                        if (trackCheckbox) trackCheckbox.checked = false;
                        Settings.state.userSettings.trackPosition = false;
                        Settings.save();
                        Utils.handleMessage("Location access canceled.");
                    }
                });
            } else {
                // Hinweis wurde bereits bestätigt, fahre direkt fort.
                proceedWithTracking();
            }
            // Am Ende:
            isTrackingInitializing = false;
            trackingInitPromise = null;
        })();
    }
    await trackingInitPromise;
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
        const { Geolocation, isNative } = await getCapacitor();

        if (isNative && Geolocation) {
            try {
                await Geolocation.clearWatch({ id: AppState.watchId });
                console.log("[LiveTrackingManager] Stopped native Geolocation watcher:", AppState.watchId);
            } catch (error) {
                console.error("[LiveTrackingManager] Error stopping native watcher:", error);
            }
        } else if (navigator.geolocation) {
            navigator.geolocation.clearWatch(AppState.watchId);
            console.log("[LiveTrackingManager] Stopped navigator.geolocation watcher:", AppState.watchId);
        }
        AppState.watchId = null;
    }

    // UI-Elemente von der Karte entfernen
    if (AppState.liveMarker) AppState.map.removeLayer(AppState.liveMarker);
    if (AppState.accuracyCircle) AppState.map.removeLayer(AppState.accuracyCircle);

    // Zustand zurücksetzen
    AppState.liveMarker = null;
    AppState.accuracyCircle = null;
    AppState.prevLat = null;
    AppState.prevLng = null;
    AppState.altitudeCorrectionOffset = 0;
    AppState.prevTime = null;
    AppState.prevAltitude = null;
    AppState.lastSmoothedSpeedMs = 0;
    AppState.lastSmoothedRateOfClimbMps = 0;
    AppState.lastDirection = 'N/A';
    AppState.lastDeviceAltitude = null;
    AppState.lastAltitudeAccuracy = null;
    AppState.lastAccuracy = null;

    // --- START: DIE ENTSCHEIDENDE KORREKTUR ---
    // Setzt die Flags zurück, die den Neustart blockiert haben.
    isTrackingInitializing = false;
    trackingInitPromise = null;
    // --- ENDE: DIE ENTSCHEIDENDE KORREKTUR ---
    
    document.dispatchEvent(new CustomEvent('tracking:stopped'));
}

// ===================================================================
// 2. Zentrale Verarbeitungslogik
// ===================================================================

/**
 * Verarbeitet die eingehenden Positionsdaten. Diese Funktion wird gedebounced aufgerufen,
 * um die App bei hoher Frequenz von GPS-Updates nicht zu überlasten.
 * Sie berechnet Geschwindigkeit, Richtung, Sinkrate, glättet die Werte,
 * aktualisiert den Live-Marker auf der Karte, zeichnet den Track auf und löst ein
 * 'tracking:positionUpdated'-Event aus.
 *
 * HINWEIS (ToDo): Diese Funktion ist sehr umfangreich. Sie könnte in Zukunft in
 * kleinere, spezialisierte Funktionen aufgeteilt werden (z.B. eine für die
 * Höhenkorrektur, eine für die Geschwindigkeitsberechnung, eine für das Event-Dispatching).
 * @param {GeolocationPosition} position - Das Positionsobjekt von der Geolocation-API.
 * @private
 */
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
    let verticalSpeedMps = 0; // NEU: Variable für die Sinkrate

    if (AppState.prevLat !== null && AppState.prevLng !== null && AppState.prevTime !== null && AppState.prevAltitude !== null) {
        const timeDiff = (currentTime - AppState.prevTime) / 1000;
        if (timeDiff > SMOOTHING_DEFAULTS.MIN_TIME_DIFF_FOR_SPEED_CALC_S) {
            // Horizontale Geschwindigkeit berechnen
            const distance = AppState.map.distance([AppState.prevLat, AppState.prevLng], [latitude, longitude]);
            speedMs = distance / timeDiff;
            direction = Utils.calculateBearing(AppState.prevLat, AppState.prevLng, latitude, longitude);

            // Vertikale Geschwindigkeit (Sink- oder Steigrate) berechnen
            const altitudeDiff = deviceAltitude - AppState.prevAltitude; // negativ bei Sinken
            verticalSpeedMps = altitudeDiff / timeDiff;
        }
    }

    // Glättung der Werte für eine stabilere Anzeige
    const alphaSpeed = speedMs < SMOOTHING_DEFAULTS.SPEED_SMOOTHING_TRESHOLD ? SMOOTHING_DEFAULTS.SPEED_SMOOTHING_LOW : SMOOTHING_DEFAULTS.SPEED_SMOOTHING_HIGH;
    AppState.lastSmoothedSpeedMs = alphaSpeed * speedMs + (1 - alphaSpeed) * AppState.lastSmoothedSpeedMs;
    const alphaVario = 0.5; // Fester Glättungsfaktor für das Variometer
    AppState.lastSmoothedRateOfClimbMps = alphaVario * verticalSpeedMps + (1 - alphaVario) * (AppState.lastSmoothedRateOfClimbMps || 0);


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
            rateOfClimbMps: AppState.lastSmoothedRateOfClimbMps,
            direction: typeof direction === 'number' ? direction.toFixed(0) : 'N/A'
        },
        bubbles: true, cancelable: true
    });

    console.log('[LiveTrackingManager] Dispatching tracking:positionUpdated with data:', event.detail);

    if (AppState.isAutoRecording || AppState.isManualRecording) {
        console.log(`Recording point. Live Altitude (deviceAltitude): ${deviceAltitude}, DIP Altitude (lastAltitude): ${AppState.lastAltitude}`);

        AppState.recordedTrackPoints.push({
            lat: latitude,
            lng: longitude,
            ele: correctedAltitude,
            time: DateTime.utc()
        });

        document.dispatchEvent(new CustomEvent('track:point_added'));
    }

    document.dispatchEvent(event);
}, 300);

// ===================================================================
// 3. Interne Hilfsfunktionen
// ===================================================================

/**
 * Erstellt ein benutzerdefiniertes Leaflet-Icon für den Live-Marker.
 * @param {number|string} direction - Die Bewegungsrichtung in Grad (0-360).
 * @returns {L.DivIcon} Das konfigurierte Leaflet DivIcon.
 * @private
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
        iconAnchor: [12, 12],
        pmIgnore: true
    });
}

/**
 * Zeichnet oder aktualisiert den Genauigkeitskreis um den Live-Marker.
 * @param {number} lat - Breite.
 * @param {number} lng - Länge.
 * @param {number} accuracy - Genauigkeit in Metern.
 * @private
 */
function updateAccuracyCircle(lat, lng, accuracy) {
    if (AppState.accuracyCircle) {
        AppState.map.removeLayer(AppState.accuracyCircle);
    }
    AppState.accuracyCircle = L.circle([lat, lng], {
        radius: accuracy, color: 'blue', fillOpacity: 0.1, weight: 1, dashArray: '5, 5', pmIgnore: true
    }).addTo(AppState.map);
}

/**
 * Prüft die GPS-Berechtigungen und fordert sie bei Bedarf an (nur für native Apps).
 * @returns {Promise<boolean>} Gibt `true` zurück, wenn die Berechtigung erteilt wurde.
 * @private
 */
async function checkAndRequestPermissions() {
    try {
        const { Geolocation, isInitialized } = await getCapacitor();
        
        if (!isInitialized) {
            console.error('Capacitor not fully initialized');
            return false;
        }

        // Warte einen kurzen Moment, um sicherzustellen, dass das Plugin bereit ist
        await new Promise(resolve => setTimeout(resolve, 100));

        const permissions = await Geolocation.checkPermissions();
        console.log('Initial geolocation permissions state:', permissions);

        if (permissions.location === 'denied') {
            Utils.handleError('GPS permission was denied. Please enable "Always" in the app settings.');
            return false;
        }

        if (permissions.location !== 'granted') {
            try {
                const requestResult = await Geolocation.requestPermissions({
                    permissions: ['location', 'coarseLocation']
                });
                console.log('New geolocation permissions state:', requestResult);
                
                if (requestResult.location !== 'granted') {
                    Utils.handleError('GPS permission is required for live tracking.');
                    return false;
                }
            } catch (error) {
                console.error('[LiveTrackingManager] Permission request error:', error);
                Utils.handleError(`Failed to request permissions: ${error.message}`);
                return false;
            }
        }

        return true;
    } catch (error) {
        console.error('Error in checkAndRequestPermissions:', error);
        Utils.handleError('Could not check location permissions.');
        return false;
    }
}