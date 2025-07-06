import { AppState } from './state.js';
import { Settings } from "./settings.js";
import { Utils } from "./utils.js";
import { DateTime } from 'luxon';
import * as JumpPlanner from './jumpPlanner.js';
import { interpolateWeatherData } from './weatherManager.js';

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
export function exportToGpx(sliderIndex, interpStep, heightUnit) {
    console.log("--- GPX EXPORT DEBUG START ---");
    console.log("Schritt 1: Initialisiere Export mit Parametern:", { sliderIndex, interpStep, heightUnit });

    if (!Settings.getValue('showJumpRunTrack', false)) {
        Utils.handleError("Bitte aktivieren Sie zuerst 'Show Jump Run Track' im Menü, um den Track zu exportieren.");
        return;
    }

    if (!AppState.weatherData || !AppState.lastLat || !AppState.lastLng || AppState.lastAltitude === 'N/A') {
        console.error("DEBUG ABBRUCH: Vorbedingungen (Wetterdaten, Position) nicht erfüllt.");
        Utils.handleError("Wetterdaten oder DIP-Position nicht verfügbar. GPX-Export nicht möglich.");
        return;
    }
    console.log("Schritt 2: Vorbedingungen erfüllt.");

    const dipLat = AppState.lastLat;
    const dipLng = AppState.lastLng;
    const harpAnchor = AppState.harpMarker ? AppState.harpMarker.getLatLng() : null;

    const interpolatedData = interpolateWeatherData(
        AppState.weatherData,
        sliderIndex,
        interpStep,
        Math.round(AppState.lastAltitude),
        heightUnit
    );

    if (!interpolatedData || interpolatedData.length === 0) {
        console.error("DEBUG ABBRUCH: Interpolierte Wetterdaten sind leer.");
        Utils.handleError("Keine Wetterdaten für die GPX-Erstellung verfügbar.");
        return;
    }
    console.log("Schritt 3: Wetterdaten erfolgreich interpoliert.", `Anzahl Punkte: ${interpolatedData.length}`);

    const trackData = JumpPlanner.jumpRunTrack(interpolatedData, harpAnchor);

    // SEHR WICHTIGE AUSGABE: Was ist im trackData-Objekt?
    console.log("Schritt 4: Jump Run Track berechnet. Ergebnis:", trackData);

    if (!trackData || !trackData.latlngs || !trackData.approachLatLngs) {
        console.error("DEBUG ABBRUCH: trackData-Objekt ist unvollständig.", "trackData:", trackData);
        Utils.handleError("Jump Run Track konnte nicht berechnet werden. Prüfen Sie die Konsolenausgabe für Details.");
        return;
    }
    console.log("Schritt 5: trackData-Objekt ist vollständig und gültig.");

    const [approachStartLat, approachStartLng] = trackData.approachLatLngs[1];
    const [jumpRunStartLat, jumpRunStartLng] = trackData.latlngs[0];
    const [jumpRunEndLat, jumpRunEndLng] = trackData.latlngs[1];

    const exitAltitude = Settings.getValue('exitAltitude', 3000);
    console.log("Exit Altitude: ", exitAltitude);
    console.log("Schritt 6: Alle Koordinaten für den Track extrahiert.");

    // GPX-Inhalt erstellen (unverändert)
    let gpxContent = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<gpx version="1.1" creator="DZMaster" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>Jump Run - ${new Date().toLocaleString()}</name>
    <desc>Generated by DZMaster. Jump Run Direction: ${trackData.direction}°</desc>
    <author>
      <name>DZMaster</name>
      <link href="https://github.com/wetterheidi/upper_winds_open_meteo"/>
    </author>
    <time>${new Date().toISOString()}</time>
  </metadata>
`;

    // --- START DER ÄNDERUNG: Nutzerfreundliche Wegpunkte hinzufügen ---
    // Wegpunkt für DIP
    gpxContent += `  <wpt lat="${dipLat}" lon="${dipLng}">
    <name>DIP</name>
    <sym>Flag, Blue</sym>
  </wpt>\n`;

    // Wegpunkt für HARP (falls vorhanden)
    if (harpAnchor) {
        gpxContent += `  <wpt lat="${harpAnchor.lat}" lon="${harpAnchor.lng}">
    <name>HARP</name>
    <sym>Flag, Green</sym>
  </wpt>\n`;
    }

    // Wegpunkt für den Beginn des Anflugs
    gpxContent += `  <wpt lat="${approachStartLat}" lon="${approachStartLng}">
    <name>x-2, ${trackData.direction}°</name>
    <ele>${exitAltitude}</ele>
    <sym>Airplane</sym>
  </wpt>\n`;

    // Wegpunkt für den ersten Springer
    gpxContent += `  <wpt lat="${jumpRunStartLat}" lon="${jumpRunStartLng}">
    <name>First Out</name>
    <ele>${exitAltitude}</ele>
    <sym>Airplane</sym>
  </wpt>\n`;

    // Wegpunkt für den letzten Springer
    gpxContent += `  <wpt lat="${jumpRunEndLat}" lon="${jumpRunEndLng}">
    <name>Last Out</name>
    <ele>${exitAltitude}</ele>
    <sym>Airplane</sym>
  </wpt>\n`;
    // --- ENDE DER ÄNDERUNG ---

    // Der Track (<trk>) bleibt erhalten, um die Linie zu zeichnen
    gpxContent += `  <trk>
    <name>Jump Run and Approach</name>
    <trkseg>
      <trkpt lat="${approachStartLat}" lon="${approachStartLng}"><ele>${exitAltitude}</ele></trkpt>
      <trkpt lat="${jumpRunStartLat}" lon="${jumpRunStartLng}"><ele>${exitAltitude}</ele></trkpt>
      <trkpt lat="${jumpRunEndLat}" lon="${jumpRunEndLng}"><ele>${exitAltitude}</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

    console.log("Schritt 7: GPX-XML-String erfolgreich erstellt.");

    const blob = new Blob([gpxContent], { type: "application/gpx+xml;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    const time = Utils.formatTime(AppState.weatherData.time[sliderIndex]).replace(/ /g, '_').replace(/:/g, '');
    a.href = url;
    a.download = `${time}_JumpRun_Track.gpx`;

    console.log("Schritt 8: Download-Link vorbereitet. LÖSE JETZT DOWNLOAD AUS.", { filename: a.download });
    console.log("--- GPX EXPORT DEBUG END ---");

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
export function exportLandingPatternToGpx(sliderIndex, interpStep, heightUnit) {
    // 1. Prüfen, ob die Funktion überhaupt aktiviert ist
    if (!Settings.getValue('showLandingPattern', false)) {
        Utils.handleError("Bitte aktivieren Sie zuerst 'Landing Pattern' im Menü, um es zu exportieren.");
        return;
    }

    if (!AppState.weatherData || !AppState.lastLat || !AppState.lastLng || AppState.lastAltitude === 'N/A') {
        Utils.handleError("Wetterdaten oder DIP-Position nicht verfügbar. GPX-Export nicht möglich.");
        return;
    }

    // 2. Notwendige Daten für die Berechnung sammeln
    const interpolatedData = interpolateWeatherData(
        AppState.weatherData, sliderIndex, interpStep, Math.round(AppState.lastAltitude), heightUnit
    );

    if (!interpolatedData || interpolatedData.length === 0) {
        Utils.handleError("Keine Wetterdaten für die GPX-Erstellung verfügbar.");
        return;
    }

    // Holen Sie die Eckpunkte des Landemusters. Diese Logik ist bereits in `displayManager` vorhanden
    // und wird hier wiederverwendet.
    // HINWEIS: Diese Neuberechnung ist notwendig, um die exakten Punkte zu bekommen.
    const patternDataForExport = JumpPlanner.calculateLandingPatternCoords(AppState.lastLat, AppState.lastLng, interpolatedData);
    if (!patternDataForExport) {
         Utils.handleError("Landemuster konnte nicht berechnet werden.");
         return;
    }

    const { downwindStart, baseStart, finalStart, landingPoint } = patternDataForExport;
    const legHeightDownwind = Settings.getValue('legHeightDownwind', 300);
    const legHeightBase = Settings.getValue('legHeightBase', 200);
    const legHeightFinal = Settings.getValue('legHeightFinal', 100);

    // 3. GPX-String aufbauen
    let gpxContent = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<gpx version="1.1" creator="DZMaster" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>Landing Pattern - ${new Date().toLocaleString()}</name>
    <desc>Generated by DZMaster Application.</desc>
    <author>
      <name>DZMaster</name>
      <link href="https://github.com/wetterheidi/upper_winds_open_meteo"/>
    </author>
    <time>${new Date().toISOString()}</time>
  </metadata>
`;

    // Wegpunkte hinzufügen
    gpxContent += `  <wpt lat="${downwindStart[0]}" lon="${downwindStart[1]}">
    <name>Downwind</name>
    <ele>${legHeightDownwind}</ele>
    <sym>scenic area</sym>
  </wpt>\n`;

    gpxContent += `  <wpt lat="${baseStart[0]}" lon="${baseStart[1]}">
    <name>Base</name>
    <ele>${legHeightBase}</ele>
    <sym>scenic area</sym>
  </wpt>\n`;

    gpxContent += `  <wpt lat="${finalStart[0]}" lon="${finalStart[1]}">
    <name>Final</name>
    <ele>${legHeightFinal}</ele>
    <sym>scenic area</sym>
  </wpt>\n`;
  
    gpxContent += `  <wpt lat="${landingPoint[0]}" lon="${landingPoint[1]}">
    <name>DIP</name>
    <sym>Flag, Blue</sym>
  </wpt>\n`;

    // Track hinzufügen, der die Punkte verbindet
    gpxContent += `  <trk>
    <name>Landing Pattern</name>
    <trkseg>
      <trkpt lat="${downwindStart[0]}" lon="${downwindStart[1]}"><ele>${legHeightDownwind}</ele></trkpt>
      <trkpt lat="${baseStart[0]}" lon="${baseStart[1]}"><ele>${legHeightBase}</ele></trkpt>
      <trkpt lat="${finalStart[0]}" lon="${finalStart[1]}"><ele>${legHeightFinal}</ele></trkpt>
      <trkpt lat="${landingPoint[0]}" lon="${landingPoint[1]}"><ele>0</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

    // 4. Download auslösen
    const blob = new Blob([gpxContent], { type: "application/gpx+xml;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    const time = Utils.formatTime(AppState.weatherData.time[sliderIndex]).replace(/ /g, '_').replace(/:/g, '');
    a.download = `${time}_Landing_Pattern.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

