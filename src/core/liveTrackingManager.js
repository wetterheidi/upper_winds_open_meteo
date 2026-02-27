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
import { Settings } from './settings.js';
import { I18n } from './i18n.js'; // Import ergänzt

// ===================================================================
// 1. Öffentliche Hauptfunktionen (API des Moduls)
// ===================================================================

// Initialisierungs-Flag und Promise
let isTrackingInitializing = false;
let trackingInitPromise = null;

// Handle für den App-State-Listener (GPS-Puffer-Verarbeitung beim Wakeup)
let gpsBufferAppStateListener = null;

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

                        // Starte Background-Tracking — läuft auch bei gesperrtem/ausgeschaltetem Display.
                        // Auf Android wird ein Foreground-Service gestartet, auf iOS die Background-Location-API genutzt.
                        const { BackgroundGeolocation } = await getCapacitor();
                        const watchId = await BackgroundGeolocation.addWatcher(
                            {
                                backgroundMessage: I18n.t('tracking.background_message'),
                                backgroundTitle: I18n.t('tracking.background_title'),
                                requestPermissions: true, // Plugin fragt iOS nach „Immer erlauben" für Background-Tracking
                                stale: false,
                                distanceFilter: 0
                            },
                            (location, error) => {
                                if (error) {
                                    console.error("[LiveTrackingManager] BackgroundGeolocation error:", error);
                                    if (error.code === 'NOT_AUTHORIZED') {
                                        Utils.handleError(I18n.t('tracking.error_gps_denied'));
                                    } else {
                                        Utils.handleError(I18n.t('tracking.error_geolocation', { message: error.code || 'Unknown' }));
                                    }
                                    stopPositionTracking();
                                    return;
                                }
                                if (location) {
                                    console.log("[LiveTrackingManager] Received position:", location);
                                    // Normalisiere auf das Standard-GeolocationPosition-Format (position.coords.*)
                                    const normalizedPosition = {
                                        coords: {
                                            latitude: location.latitude,
                                            longitude: location.longitude,
                                            accuracy: location.accuracy,
                                            altitude: location.altitude,
                                            altitudeAccuracy: location.altitudeAccuracy,
                                            heading: location.bearing,
                                            speed: location.speed
                                        },
                                        timestamp: location.time
                                    };
                                    debouncedPositionUpdate(normalizedPosition);
                                }
                            }
                        );
                        AppState.watchId = watchId;
                        console.log("[LiveTrackingManager] BackgroundGeolocation watcher started:", watchId);

                        // GPS-Puffer: beim Aufwachen aus dem Hintergrund fehlende Punkte nachladen.
                        const { App } = await import('@capacitor/app');
                        gpsBufferAppStateListener = await App.addListener('appStateChange', async (state) => {
                            if (state.isActive) await processGPSBuffer();
                        });
                        await processGPSBuffer(); // Eventuell noch Puffer von vorherigen Sessions

                        document.dispatchEvent(new CustomEvent('tracking:started'));
                    } catch (error) {
                        console.error("[LiveTrackingManager] Failed to start native tracking:", error);
                        Utils.handleError(I18n.t('tracking.error_start_failed', { message: error.message || 'Unknown' }));
                        stopPositionTracking();
                    }
                } else {
                    // --- Web-Fallback-Logik ---
                    console.log("[LiveTrackingManager] Using navigator.geolocation for tracking (Web).");
                    if (!navigator.geolocation) {
                        Utils.handleError(I18n.t('tracking.error_not_supported'));
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
                            Utils.handleError(I18n.t('tracking.error_geolocation', { message: error.message || 'Unknown' }));
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
                    title: I18n.t('tracking.disclosure_title'), // Übersetzt
                    message: I18n.t('tracking.disclosure_message'), // Übersetzt
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
                        Utils.handleMessage(I18n.t('tracking.access_canceled')); // Übersetzt
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
 * Schaltet die manuelle Aufzeichnung eines Tracks ein oder aus.
 */
export function toggleManualRecording() {
    const manualButton = document.getElementById('manual-recording-button');

    if (AppState.isManualRecording) {
        // Aufzeichnung stoppen
        AppState.isManualRecording = false;
        if (manualButton) {
            manualButton.textContent = I18n.t('tracking.btn_start_recording'); // "Start Recording"
            manualButton.classList.remove('recording');
        }
        Utils.handleMessage(I18n.t('tracking.recording_stopped')); // Übersetzt

        if (AppState.recordedTrackPoints.length > 1) {
            saveRecordedTrack();
        } else {
            AppState.recordedTrackPoints = []; // Leeren, wenn nicht genügend Punkte vorhanden sind
        }

        // Entscheiden, ob das Tracking komplett gestoppt werden soll.
        if (!Settings.state.userSettings.trackPosition) {
            stopPositionTracking();
        }
    } else {
        // Aufzeichnung starten
        AppState.isManualRecording = true;
        AppState.recordedTrackPoints = []; // Eine saubere Aufzeichnung starten
        if (manualButton) {
            manualButton.textContent = I18n.t('tracking.btn_stop_recording'); // "Stop Recording"
            manualButton.classList.add('recording');
        }
        Utils.handleMessage(I18n.t('tracking.recording_started')); // Übersetzt

        // Sicherstellen, dass das Live-Tracking aktiv ist
        if (AppState.watchId === null) {
            startPositionTracking();
        }
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
    if (gpsBufferAppStateListener) {
        gpsBufferAppStateListener.remove();
        gpsBufferAppStateListener = null;
    }
    if (AppState.watchId !== null) {
        const { isNative, BackgroundGeolocation } = await getCapacitor();

        if (isNative) {
            try {
                await BackgroundGeolocation.removeWatcher({ id: AppState.watchId });
                console.log("[LiveTrackingManager] Stopped BackgroundGeolocation watcher:", AppState.watchId);
            } catch (error) {
                console.error("[LiveTrackingManager] Error stopping background watcher:", error);
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
    AppState.altitudeCorrectionPerformed = false; // <-- ZURÜCKSETZEN: Flag für die nächste Sitzung vorbereiten.

    // Setzt die Flags zurück, die den Neustart blockiert haben.
    isTrackingInitializing = false;
    trackingInitPromise = null;

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

    // Offset-Berechnung wird jetzt nur noch EINMAL pro Sitzung ausgeführt.
    if (!AppState.altitudeCorrectionPerformed && deviceAltitude !== null && AppState.lastAltitude !== 'N/A') {
        // Flag sofort setzen, um wiederholte Ausführung zu blockieren.
        AppState.altitudeCorrectionPerformed = true;

        const heightDifference = Math.abs(deviceAltitude - AppState.lastAltitude);

        if (heightDifference < 150) {
            AppState.altitudeCorrectionOffset = deviceAltitude - AppState.lastAltitude;
            console.log(`Bodenstart erkannt. Korrektur-Offset berechnet: ${AppState.altitudeCorrectionOffset.toFixed(2)}m`);
        } else {
            AppState.altitudeCorrectionOffset = 0;
            console.warn(`Start in der Luft erkannt (Höhendifferenz: ${heightDifference.toFixed(0)}m). Es wird keine Höhenkorrektur angewendet.`);
            Utils.handleMessage(I18n.t('tracking.airborne_start_warning'));
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
 * Liest den nativen GPS-Puffer (gps_buffer.jsonl), der von MainActivity befüllt wird,
 * wenn JavaScript im Hintergrund eingefroren ist. Fügt fehlende Punkte chronologisch
 * in den laufenden Track ein und löscht danach die Pufferdatei.
 * @private
 */
async function processGPSBuffer() {
    try {
        const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
        const result = await Filesystem.readFile({
            path: 'gps_buffer.jsonl',
            directory: Directory.Data,
            encoding: Encoding.UTF8
        });
        if (!result.data || !result.data.trim()) return;

        const lines = result.data.trim().split('\n').filter(l => l.trim());
        let added = 0;

        for (const line of lines) {
            try {
                const p = JSON.parse(line);
                if (!p.lat || !p.lon || !p.time) continue;

                // Deduplizierung: Zeitstempel bereits im Track vorhanden? (±500 ms)
                const alreadyExists = AppState.recordedTrackPoints.some(
                    tp => Math.abs(tp.time.toMillis() - p.time) < 500
                );
                if (alreadyExists) continue;

                if (AppState.isAutoRecording || AppState.isManualRecording) {
                    AppState.recordedTrackPoints.push({
                        lat: p.lat,
                        lng: p.lon,
                        ele: p.alt ?? null,
                        time: DateTime.fromMillis(p.time, { zone: 'utc' })
                    });
                    added++;
                }
            } catch (_) { /* Fehlerhafte Zeile überspringen */ }
        }

        if (added > 0) {
            AppState.recordedTrackPoints.sort((a, b) => a.time.toMillis() - b.time.toMillis());
            console.log(`[LiveTrackingManager] GPS-Puffer: ${added} Punkte nachgeladen.`);
            document.dispatchEvent(new CustomEvent('track:point_added'));
        }

        await Filesystem.deleteFile({ path: 'gps_buffer.jsonl', directory: Directory.Data });
    } catch (e) {
        // Datei existiert nicht → kein Puffer, kein Problem.
        if (e?.message && !e.message.toLowerCase().includes('not exist') && !e.message.toLowerCase().includes('no such')) {
            console.warn('[LiveTrackingManager] GPS-Puffer Fehler:', e.message);
        }
    }
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
            Utils.handleError(I18n.t('tracking.error_gps_denied'));
            return false;
        }

        if (permissions.location !== 'granted') {
            try {
                const requestResult = await Geolocation.requestPermissions({
                    permissions: ['location', 'coarseLocation']
                });
                console.log('New geolocation permissions state:', requestResult);

                if (requestResult.location !== 'granted') {
                    Utils.handleError(I18n.t('tracking.error_gps_denied'));
                    return false;
                }
            } catch (error) {
                console.error('[LiveTrackingManager] Permission request error:', error);
                Utils.handleError(I18n.t('tracking.error_permission_denied'));
                return false;
            }
        }

        return true;
    } catch (error) {
        console.error('Error in checkAndRequestPermissions:', error);
        Utils.handleError(I18n.t('tracking.error_location_denied', { message: error.message || 'Unknown' }));
        return false;
    }
}