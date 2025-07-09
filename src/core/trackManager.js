import { AppState } from './state.js';
import { Settings } from "./settings.js";
import { Utils } from "./utils.js";
import { DateTime } from 'luxon';
import * as JumpPlanner from './jumpPlanner.js';
import * as weatherManager from './weatherManager.js';
import { interpolateWeatherData } from './weatherManager.js';
import { Filesystem, Directory } from '@capacitor/filesystem';


"use strict";

/**
 * Lädt und verarbeitet eine GPX-Datei. Liest die Datei, extrahiert die Trackpunkte
 * und ruft die renderTrack-Funktion auf, um sie auf der Karte darzustellen.
 * @param {File} file - Das vom Benutzer ausgewählte GPX-Datei-Objekt.
 * @returns {Promise<object|null>} Ein Promise, das zu den Metadaten des Tracks auflöst oder null bei einem Fehler.
 */
export async function loadGpxTrack(file) {
    if (!AppState.map) { /* istanbul ignore next */ Utils.handleError('Map not initialized.'); return null; }
    AppState.isLoadingGpx = true;
    const reader = new FileReader();

    return new Promise((resolve, reject) => {
        reader.onload = async function (e) {
            try {
                const gpxData = e.target.result;
                const parser = new DOMParser();
                const xml = parser.parseFromString(gpxData, 'text/xml');
                const trackpoints = xml.getElementsByTagName('trkpt');
                const points = [];
                for (let i = 0; i < trackpoints.length; i++) {
                    const lat = parseFloat(trackpoints[i].getAttribute('lat'));
                    const lng = parseFloat(trackpoints[i].getAttribute('lon'));
                    if (isNaN(lat) || isNaN(lng)) continue;
                    const ele = trackpoints[i].getElementsByTagName('ele')[0]?.textContent;
                    const time = trackpoints[i].getElementsByTagName('time')[0]?.textContent;
                    points.push({ lat, lng, ele: ele ? parseFloat(ele) : null, time: time ? DateTime.fromISO(time, { zone: 'utc' }) : null });
                }
                if (points.length < 2) throw new Error('GPX track has insufficient points.');

                const trackMetaData = await renderTrack(points, file.name);
                resolve(trackMetaData); // Gibt Metadaten zurück
            } catch (error) {
                /* istanbul ignore next */
                console.error('[trackManager] Error in loadGpxTrack:', error);
                /* istanbul ignore next */
                Utils.handleError('Error parsing GPX file: ' + error.message);
                /* istanbul ignore next */
                resolve(null); // Gibt null bei Fehler zurück
            }
            finally { AppState.isLoadingGpx = false; }
        };
        reader.onerror = () => {
            /* istanbul ignore next */
            Utils.handleError('Error reading GPX file.');
            /* istanbul ignore next */
            AppState.isLoadingGpx = false;
            /* istanbul ignore next */
            reject(new Error('Error reading GPX file.')); // Promise ablehnen
        };
        reader.readAsText(file);
    });
}

/**
 * Lädt und verarbeitet eine CSV-Datei von einem FlySight-Gerät.
 * Parst die CSV-Daten, extrahiert die Trackpunkte und stellt sie auf der Karte dar.
 * Diese Funktion geht davon aus, dass die Zeitstempel in UTC ('Z-Time') vorliegen.
 * @param {File} file - Das vom Benutzer ausgewählte CSV-Datei-Objekt.
 * @returns {Promise<object|null>} Ein Promise, das zu den Metadaten des Tracks auflöst oder null bei einem Fehler.
 */
export async function loadCsvTrackUTC(file) {
    if (!AppState.map) { /* istanbul ignore next */ Utils.handleError('Map not initialized.'); return null; }
    AppState.isLoadingGpx = true;
    const reader = new FileReader();

    return new Promise((resolve, reject) => {
        reader.onload = async function (e) {
            try {
                const csvData = e.target.result;
                const points = [];
                Papa.parse(csvData, {
                    skipEmptyLines: true,
                    step: function (row) {
                        const data = row.data;
                        // Beispielhafte Annahme für CSV-Struktur: $GNSS,Zeit,Lat,Lng,Höhe
                        if (data[0] && data[0].toUpperCase() === '$GNSS' && data.length >= 5) {
                            let timeStr = data[1];
                            const lat = parseFloat(data[2]);
                            const lng = parseFloat(data[3]);
                            const ele = parseFloat(data[4]);
                            if (isNaN(lat) || isNaN(lng) || isNaN(ele)) return;
                            let time = null;
                            try {
                                // Standard-Zeitparsing (ggf. anpassen, falls UTC/Lokal unterschiedlich behandelt werden muss)
                                time = DateTime.fromISO(timeStr, { setZone: true }).toUTC();
                                if (!time.isValid) time = null;
                            } catch (parseError) { /* istanbul ignore next */ time = null; }
                            points.push({ lat, lng, ele, time });
                        }
                    },
                    complete: async function () {
                        if (points.length < 2) throw new Error('CSV track has insufficient points.');
                        const trackMetaData = await renderTrack(points, file.name);
                        resolve(trackMetaData); // Gibt Metadaten zurück
                    },
                    error: function (error) { /* istanbul ignore next */ throw new Error('Error parsing CSV: ' + error.message); }
                });
            } catch (error) {
                /* istanbul ignore next */
                console.error('[trackManager] Error in loadCsvTrackUTC:', error);
                /* istanbul ignore next */
                Utils.handleError('Error parsing CSV file: ' + error.message);
                /* istanbul ignore next */
                resolve(null); // Gibt null bei Fehler zurück
            }
            finally { AppState.isLoadingGpx = false; }
        };
        reader.onerror = () => {
            /* istanbul ignore next */
            Utils.handleError('Error reading CSV file.');
            /* istanbul ignore next */
            AppState.isLoadingGpx = false;
            /* istanbul ignore next */
            reject(new Error('Error reading CSV file.')); // Promise ablehnen
        };
        reader.readAsText(file);
    });
}

/**
 * Rendert einen gegebenen Satz von Trackpunkten auf der Karte.
 * Erstellt eine farbkodierte Polylinie, bei der die Farbe die Höhe über Grund (AGL) anzeigt.
 * Löst nach dem Rendern ein 'track:loaded'-Event aus, um die restliche Anwendung zu informieren.
 * @param {object[]} points - Ein Array von Punkt-Objekten, die den Track definieren.
 * @param {string} fileName - Der Name der geladenen Datei für Anzeigezwecke.
 * @returns {Promise<object|null>} Ein Promise, das zu den Metadaten des Tracks auflöst oder null bei einem Fehler.
 * @private
 */
async function renderTrack(points, fileName) {
    try {
        console.log(`[trackManager] renderTrack called for ${fileName} with ${points.length} points.`);
        if (!AppState.map) {
            console.warn('[trackManager] Map object in AppState is not available in renderTrack.');
            Utils.handleError('Map not initialized. Cannot render track.');
            return null;
        }

        if (AppState.gpxLayer && AppState.map.hasLayer(AppState.gpxLayer)) {
            AppState.map.removeLayer(AppState.gpxLayer);
        }
        AppState.gpxLayer = null;
        AppState.gpxPoints = points;
        AppState.isTrackLoaded = false;

        const trackMetaData = {
            finalPointData: null,
            timestampToUseForWeather: null,
            historicalDateString: null,
            summaryForInfoElement: '',
            success: false
        };

        if (points.length > 0) {
            const finalPoint = points[points.length - 1];
            AppState.lastLat = finalPoint.lat;
            AppState.lastLng = finalPoint.lng;
            AppState.lastAltitude = await Utils.getAltitude(AppState.lastLat, AppState.lastLng);
            trackMetaData.finalPointData = { lat: AppState.lastLat, lng: AppState.lastLng, altitude: AppState.lastAltitude };

            if (points[0].time && points[0].time.isValid) {
                const initialTimestamp = points[0].time;
                const today = DateTime.utc().startOf('day');
                const trackDateLuxon = initialTimestamp.startOf('day');

                if (trackDateLuxon < today) {
                    trackMetaData.historicalDateString = trackDateLuxon.toFormat('yyyy-MM-dd');
                }

                let roundedTimestamp = initialTimestamp.startOf('hour');
                if (initialTimestamp.minute >= 30) roundedTimestamp = roundedTimestamp.plus({ hours: 1 });
                trackMetaData.timestampToUseForWeather = roundedTimestamp.toISO();
            }

            // KORREKTUR: Berechnungen VOR die Verwendung verschieben
            const distance = (points.reduce((dist, p, i) => {
                if (i === 0 || !AppState.map) return 0; const prev = points[i - 1];
                return dist + AppState.map.distance([prev.lat, prev.lng], [p.lat, p.lng]);
            }, 0) / 1000).toFixed(2);
            const elevations = points.map(p => p.ele).filter(e => e !== null);
            const elevationMin = elevations.length ? Math.min(...elevations).toFixed(0) : 'N/A';
            const elevationMax = elevations.length ? Math.max(...elevations).toFixed(0) : 'N/A';

            // Event erstellen, NACHDEM alle Werte berechnet wurden
            const trackLoadedEvent = new CustomEvent('track:loaded', {
                detail: {
                    lat: AppState.lastLat,
                    lng: AppState.lastLng,
                    altitude: AppState.lastAltitude,
                    timestamp: trackMetaData.timestampToUseForWeather,
                    historicalDate: trackMetaData.historicalDateString,
                    summary: `<br><strong>Track:</strong> Distance: ${distance} km, Min Elevation: ${elevationMin} m, Max Elevation: ${elevationMax} m (Source: ${fileName})`
                },
                bubbles: true,
                cancelable: true
            });

            AppState.map.getContainer().dispatchEvent(trackLoadedEvent);
        }

        AppState.gpxLayer = L.layerGroup([], { pane: 'gpxTrackPane' });
        const groundAltitude = AppState.lastAltitude !== 'N/A' && !isNaN(AppState.lastAltitude) ? parseFloat(AppState.lastAltitude) : null;

        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i]; const p2 = points[i + 1];
            const ele1 = p1.ele; const ele2 = p2.ele;
            let color = '#808080';
            if (groundAltitude !== null && ele1 !== null && ele2 !== null) {
                const agl1 = ele1 - groundAltitude; const agl2 = ele2 - groundAltitude;
                const avgAgl = (agl1 + agl2) / 2;
                color = Utils.interpolateColor(avgAgl);
            }
            const segment = L.polyline([[p1.lat, p1.lng], [p2.lat, p2.lng]], {
                color: color, weight: 4, opacity: 0.75, pane: 'gpxTrackPane'
            }).bindTooltip('', { sticky: true });

            segment.on('mousemove', function (e) {
                const latlng = e.latlng;
                let closestPoint = points[0]; let minDist = Infinity; let closestIndex = 0;
                points.forEach((p, index) => {
                    const dist = Math.sqrt(Math.pow(p.lat - latlng.lat, 2) + Math.pow(p.lng - latlng.lng, 2));
                    if (dist < minDist) { minDist = dist; closestPoint = p; closestIndex = index; }
                });
                segment.setTooltipContent(Utils.getTooltipContent(closestPoint, closestIndex, points, groundAltitude)).openTooltip(latlng);
            });
            AppState.gpxLayer.addLayer(segment);
        }
        if (AppState.map) AppState.gpxLayer.addTo(AppState.map);
        AppState.isTrackLoaded = true;

        if (points.length > 0 && AppState.map) {
            const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]));
            if (bounds.isValid()) AppState.map.fitBounds(bounds, { padding: [50, 50], maxZoom: AppState.map.getMaxZoom() || 18 });
            else Utils.handleError('Unable to display track: invalid coordinates.');
        }

        trackMetaData.success = true;
        console.log('[trackManager] renderTrack finished successfully.');
        return trackMetaData;

    } catch (error) {
        console.error('[trackManager] Error in renderTrack:', error);
        Utils.handleError('Error rendering track: ' + error.message);
        AppState.gpxPoints = [];
        if (AppState.gpxLayer && AppState.map && AppState.map.hasLayer(AppState.gpxLayer)) {
            AppState.map.removeLayer(AppState.gpxLayer);
        }
        AppState.gpxLayer = null;
        AppState.isTrackLoaded = false;
        return { success: false, error: error.message };
    }
}

/**
 * Erstellt eine GPX-Datei als <trk> (Track) und löst den Download aus.
 * Diese Struktur wird von Google Maps und anderen GPS-Programmen bevorzugt.
 * @param {number} sliderIndex Der aktuell im UI ausgewählte Index des Zeitschiebereglers.
 * @param {number} interpStep Der Interpolationsschritt für die Wetterdaten.
 * @param {string} heightUnit Die aktuell ausgewählte Höheneinheit ('m' oder 'ft').
 */
export async function exportToGpx(sliderIndex, interpStep, heightUnit) {
    console.log("--- GPX EXPORT DEBUG START ---");
    if (!Settings.getValue('showJumpRunTrack', false)) {
        Utils.handleError("Bitte aktivieren Sie zuerst 'Show Jump Run Track' im Menü, um den Track zu exportieren.");
        return;
    }

    if (!AppState.weatherData || !AppState.lastLat || !AppState.lastLng || AppState.lastAltitude === 'N/A') {
        Utils.handleError("Wetterdaten oder DIP-Position nicht verfügbar. GPX-Export nicht möglich.");
        return;
    }

    // Höhenreferenzen holen
    const dipLat = AppState.lastLat;
    const dipLng = AppState.lastLng;
    const dipElevation = Math.round(AppState.lastAltitude);
    const harpAnchor = AppState.harpMarker ? AppState.harpMarker.getLatLng() : null;
    let harpElevation = null;

    if (harpAnchor) {
        // Asynchron die Höhe des HARP abrufen
        harpElevation = await Utils.getAltitude(harpAnchor.lat, harpAnchor.lng);
        harpElevation = harpElevation !== 'N/A' ? Math.round(harpElevation) : null;
    }

    const interpolatedData = interpolateWeatherData(
        AppState.weatherData, sliderIndex, interpStep, dipElevation, heightUnit
    );

    if (!interpolatedData || interpolatedData.length === 0) {
        Utils.handleError("Keine Wetterdaten für die GPX-Erstellung verfügbar.");
        return;
    }

    const trackData = JumpPlanner.jumpRunTrack(interpolatedData, harpAnchor);

    if (!trackData || !trackData.latlngs || !trackData.approachLatLngs) {
        Utils.handleError("Jump Run Track konnte nicht berechnet werden.");
        return;
    }

    const [approachStartLat, approachStartLng] = trackData.approachLatLngs[1];
    const [jumpRunStartLat, jumpRunStartLng] = trackData.latlngs[0];
    const [jumpRunEndLat, jumpRunEndLng] = trackData.latlngs[1];

    // MSL-Höhe für den Absetzvorgang berechnen
    const exitAltitudeAGL = Settings.getValue('exitAltitude', 3000);
    const exitAltitudeMSL = dipElevation + exitAltitudeAGL;

    let gpxContent = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<gpx version="1.1" creator="DZMaster" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>Jump Run - ${new Date().toLocaleString()}</name>
    <desc>Generated by DZMaster. Jump Run Direction: ${trackData.direction}°</desc>
  </metadata>
`;

    // Wegpunkte mit korrekten MSL-Höhen einfügen
    gpxContent += `  <wpt lat="${dipLat}" lon="${dipLng}">\n    <name>DIP</name>\n    <ele>${dipElevation}</ele>\n    <sym>Flag, Blue</sym>\n  </wpt>\n`;
    if (harpAnchor && harpElevation !== null) {
        gpxContent += `  <wpt lat="${harpAnchor.lat}" lon="${harpAnchor.lng}">\n    <name>HARP</name>\n    <ele>${harpElevation}</ele>\n    <sym>Flag, Green</sym>\n  </wpt>\n`;
    }
    gpxContent += `  <wpt lat="${approachStartLat}" lon="${approachStartLng}">\n    <name>x-2, ${trackData.direction}°</name>\n    <ele>${exitAltitudeMSL}</ele>\n    <sym>Airplane</sym>\n  </wpt>\n`;
    gpxContent += `  <wpt lat="${jumpRunStartLat}" lon="${jumpRunStartLng}">\n    <name>First Out ${exitAltitudeAGL} m AGL</name>\n    <ele>${exitAltitudeMSL}</ele>\n    <sym>Airplane</sym>\n  </wpt>\n`;
    gpxContent += `  <wpt lat="${jumpRunEndLat}" lon="${jumpRunEndLng}">\n    <name>Last Out</name>\n    <ele>${exitAltitudeMSL}</ele>\n    <sym>Airplane</sym>\n  </wpt>\n`;

    // Track mit korrekten MSL-Höhen einfügen
    gpxContent += `  <trk>\n    <name>Jump Run and Approach</name>\n    <trkseg>\n`;
    gpxContent += `      <trkpt lat="${approachStartLat}" lon="${approachStartLng}"><ele>${exitAltitudeMSL}</ele></trkpt>\n`;
    gpxContent += `      <trkpt lat="${jumpRunStartLat}" lon="${jumpRunStartLng}"><ele>${exitAltitudeMSL}</ele></trkpt>\n`;
    gpxContent += `      <trkpt lat="${jumpRunEndLat}" lon="${jumpRunEndLng}"><ele>${exitAltitudeMSL}</ele></trkpt>\n`;
    gpxContent += `    </trkseg>\n  </trk>\n</gpx>`;

    const blob = new Blob([gpxContent], { type: "application/gpx+xml;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    const time = Utils.formatTime(AppState.weatherData.time[sliderIndex]).replace(/ /g, '_').replace(/:/g, '');
    a.href = url;
    a.download = `${time}_JumpRun_Track.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

/**
 * Erstellt eine GPX-Datei für das Landemuster und löst den Download aus.
 * @param {number} sliderIndex Der aktuell im UI ausgewählte Index des Zeitschiebereglers.
 * @param {number} interpStep Der Interpolationsschritt für die Wetterdaten.
 * @param {string} heightUnit Die aktuell ausgewählte Höheneinheit ('m' oder 'ft').
 */
export function exportLandingPatternToGpx() {
    console.log("--- GPX Landing Pattern Export gestartet ---");

    const sliderIndex = parseInt(document.getElementById('timeSlider')?.value) || 0;
    const interpStep = Settings.getValue('interpStep', 'select', 200);
    const heightUnit = Settings.getValue('heightUnit', 'm');

    if (!Settings.getValue('showLandingPattern', false)) {
        Utils.handleError("Bitte 'Landing Pattern' aktivieren, um zu exportieren.");
        return;
    }

    if (!AppState.weatherData || !AppState.lastLat || !AppState.lastLng || AppState.lastAltitude === 'N/A') {
        Utils.handleError("Wetterdaten oder DIP-Position für GPX-Export nicht verfügbar.");
        return;
    }
    console.log("Schritt 1: Vorbedingungen erfüllt. Wetterdaten und Position vorhanden.");

    const interpolatedData = weatherManager.interpolateWeatherData(
        AppState.weatherData, sliderIndex, interpStep, Math.round(AppState.lastAltitude), heightUnit
    );

    if (!interpolatedData || interpolatedData.length === 0) {
        Utils.handleError("Fehler in Schritt 2: Keine interpolierten Wetterdaten für GPX-Erstellung verfügbar.");
        return;
    }
    console.log("Schritt 2: Wetterdaten erfolgreich interpoliert.");

    const patternDataForExport = JumpPlanner.calculateLandingPatternCoords(AppState.lastLat, AppState.lastLng, interpolatedData);
    
    // ================== DEBUGGING-BLOCK ==================
    console.log("Schritt 3: Ergebnis von calculateLandingPatternCoords:", patternDataForExport);
    if (!patternDataForExport) {
        Utils.handleError("Fehler in Schritt 3: calculateLandingPatternCoords hat keine Daten zurückgegeben. Export abgebrochen.");
        return;
    }
    console.log("Schritt 3: Koordinaten des Landemusters erfolgreich berechnet.");
    // =====================================================

    const { downwindStart, baseStart, finalStart, landingPoint } = patternDataForExport;
    
    const baseHeight = Math.round(AppState.lastAltitude);
    
    const legHeightDownwind = Settings.getValue('legHeightDownwind', 300);
    const legHeightBase = Settings.getValue('legHeightBase', 200);
    const legHeightFinal = Settings.getValue('legHeightFinal', 100);

    const eleDownwind = baseHeight + legHeightDownwind;
    const eleBase = baseHeight + legHeightBase;
    const eleFinal = baseHeight + legHeightFinal;

    let gpxContent = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<gpx version="1.1" creator="DZMaster" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>Landing Pattern - ${new Date().toLocaleString()}</name>
    <desc>Generated by DZMaster Application.</desc>
  </metadata>
`;

    gpxContent += `  <wpt lat="${downwindStart[0]}" lon="${downwindStart[1]}"><name>Downwind ${legHeightDownwind} m AGL</name><ele>${eleDownwind}</ele></wpt>\n`;
    gpxContent += `  <wpt lat="${baseStart[0]}" lon="${baseStart[1]}"><name>Base ${legHeightBase} m AGL</name><ele>${eleBase}</ele></wpt>\n`;
    gpxContent += `  <wpt lat="${finalStart[0]}" lon="${finalStart[1]}"><name>Final ${legHeightFinal} m AGL</name><ele>${eleFinal}</ele></wpt>\n`;
    gpxContent += `  <wpt lat="${landingPoint[0]}" lon="${landingPoint[1]}"><name>DIP</name><ele>${baseHeight}</ele></wpt>\n`;

    gpxContent += `  <trk>
    <name>Landing Pattern</name>
    <trkseg>
      <trkpt lat="${downwindStart[0]}" lon="${downwindStart[1]}"><ele>${eleDownwind}</ele></trkpt>
      <trkpt lat="${baseStart[0]}" lon="${baseStart[1]}"><ele>${eleBase}</ele></trkpt>
      <trkpt lat="${finalStart[0]}" lon="${finalStart[1]}"><ele>${eleFinal}</ele></trkpt>
      <trkpt lat="${landingPoint[0]}" lon="${landingPoint[1]}"><ele>${baseHeight}</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;
    
    console.log("Schritt 4: GPX-String wurde erfolgreich erstellt.");
    console.log(gpxContent); // Gibt den GPX-Inhalt in die Konsole aus

    const blob = new Blob([gpxContent], { type: "application/gpx+xml;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    const time = Utils.formatTime(AppState.weatherData.time[sliderIndex]).replace(/ /g, '_').replace(/:/g, '');
    a.download = `${time}_Landing_Pattern.gpx`;
    a.href = url;
    document.body.appendChild(a);
    
    console.log("Schritt 5: Download-Link erstellt. Der Download wird jetzt ausgelöst...");
    a.click();
    
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    console.log("--- GPX Landing Pattern Export beendet ---");
}

/**
 * Speichert die aufgezeichneten Trackpunkte als GPX-Datei.
 */
export async function saveRecordedTrack() {
    console.log(`--- Starte saveRecordedTrack mit ${AppState.recordedTrackPoints.length} Punkten ---`);

    if (!AppState.recordedTrackPoints || AppState.recordedTrackPoints.length < 2) {
        Utils.handleError("Keine Track-Daten zum Speichern vorhanden.");
        return;
    }

    try {
        const header = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="DZMaster" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>Skydive Track - ${new Date().toLocaleString()}</name></metadata>
<trk><name>Recorded Skydive</name><trkseg>`;

        const footer = `</trkseg></trk></gpx>`;
        
        const trackpointStrings = AppState.recordedTrackPoints.map((p, index) => {
            if (p && typeof p.lat === 'number' && typeof p.lng === 'number' && p.time) {
                const ele = (typeof p.ele === 'number') ? p.ele.toFixed(2) : '0';
                const time = p.time.toISO();
                const trkpt = `<trkpt lat="${p.lat}" lon="${p.lng}"><ele>${ele}</ele><time>${time}</time></trkpt>`;
                console.log(`Punkt ${index + 1}: ${trkpt}`); // Log für jeden einzelnen Punkt
                return trkpt;
            }
            console.warn(`Ungültiger oder unvollständiger Punkt bei Index ${index} übersprungen:`, p);
            return ''; // Leeren String für ungültige Punkte
        }).filter(Boolean); // Entfernt leere Einträge

        if (trackpointStrings.length < 2) {
            Utils.handleError("Nicht genügend gültige Punkte für einen Track zum Speichern.");
            return;
        }

        const gpxContent = `${header}\n${trackpointStrings.join('\n')}\n${footer}`;

        console.log("--- FINALER GPX-INHALT VOR DEM SPEICHERN ---");
        console.log(gpxContent);
        console.log("-----------------------------------------");
        
        const fileName = `Skydive_Track_${DateTime.utc().toFormat('yyyy-MM-dd_HHmm')}.gpx`;

        if (window.Capacitor && window.Capacitor.isNativePlatform()) {
            await Filesystem.writeFile({
                path: fileName,
                data: gpxContent,
                directory: Directory.Documents,
                encoding: 'utf8'
            });
            Utils.handleMessage(`Track saved: ${fileName}`);
        } else {
            // Web-Fallback
            const blob = new Blob([gpxContent], { type: "application/gpx+xml;charset=utf-8" });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }

    } catch (error) {
        console.error("Fehler während saveRecordedTrack:", error);
        Utils.handleError("Konnte den Track nicht speichern.");
    } finally {
        AppState.recordedTrackPoints = [];
    }
}


