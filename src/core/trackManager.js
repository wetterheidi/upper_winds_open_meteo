/**
 * @file trackManager.js
 * @description Verwaltet das Laden, Verarbeiten, Anzeigen, Speichern und Exportieren
 * von GPS-Tracks aus verschiedenen Dateiformaten (GPX, KML, CSV).
 */

import { AppState } from './state.js';
import { Utils } from "./utils.js";
import { DateTime } from 'luxon';
import * as JumpPlanner from './jumpPlanner.js';
import { interpolateWeatherData } from './weatherManager.js';
import { getCapacitor } from './capacitor-adapter.js';
import { Settings } from './settings.js';
import { I18n } from './i18n.js';

// ===================================================================
// 1. Öffentliche Lade- & Speicherfunktionen
// ===================================================================

/**
 * Lädt und verarbeitet eine KML-Datei. Stellt einzelne Tracks oder mehrere Polygone dar
 * und übernimmt dabei die in der KML definierten Stil-Informationen.
 * @param {File} file - Das vom Benutzer ausgewählte KML-Datei-Objekt.
 * @returns {Promise<object|null>} Ein Promise, das zu einem Erfolgsstatus auflöst.
 */
export async function loadKmlTrack(file) {
    if (!AppState.map) {
        Utils.handleError(I18n.t('tracks.error_map_init'));
        return null;
    }
    AppState.isLoadingGpx = true;

    try {
        const kmlData = await readFileContent(file);
        const parser = new DOMParser();
        const xml = parser.parseFromString(kmlData, 'text/xml');
        const geojson = toGeoJSON.kml(xml);

        if (AppState.gpxLayer && AppState.map.hasLayer(AppState.gpxLayer)) {
            AppState.map.removeLayer(AppState.gpxLayer);
        }

        const kmlLayer = L.geoJSON(geojson, {
            style: function (feature) {
                const styles = getComputedStyle(document.body);
                // .trim() ist wichtig, da getPropertyValue manchmal Leerzeichen zurückgibt
                const dangerColor = styles.getPropertyValue('--color-danger').trim() || '#ff0000';
                const style = {};
                if (feature.properties.stroke) style.color = feature.properties.stroke;
                if (feature.properties['stroke-width']) style.weight = feature.properties['stroke-width'];
                if (feature.properties['stroke-opacity']) style.opacity = feature.properties['stroke-opacity'];
                if (feature.properties.fill) style.fillColor = feature.properties.fill;
                if (feature.properties['fill-opacity']) style.fillOpacity = feature.properties['fill-opacity'];
                if (!style.color && !style.fillColor) {
                    if (feature.properties.styleUrl === '#StyleDANGER') {
                        style.color = dangerColor;
                        style.weight = 1.5;
                        style.opacity = 1.0;
                        style.fillColor = dangerColor;
                        style.fillOpacity = 0.2;
                    }
                }
                return style;
            },
            onEachFeature: function (feature, layer) {
                if (feature.properties && feature.properties.name) {
                    layer.bindTooltip(feature.properties.name);
                }
            }
        });

        if (kmlLayer.getLayers().length === 0) {
            throw new Error(I18n.t('tracks.error_kml_no_geometry'));
        }

        AppState.gpxLayer = kmlLayer;
        AppState.gpxLayer.addTo(AppState.map);
        AppState.map.fitBounds(kmlLayer.getBounds());

        return { success: true, finalPointData: null };

    } catch (error) {
        console.error('[trackManager] Error in loadKmlTrack:', error);
        Utils.handleError(I18n.t('tracks.error_kml_parse').replace('{message}', error.message));
        return null;
    } finally {
        AppState.isLoadingGpx = false;
    }
}

/**
 * Lädt und verarbeitet eine GPX-Datei.
 * @param {File} file - Das vom Benutzer ausgewählte GPX-Datei-Objekt.
 * @returns {Promise<object|null>} Ein Promise, das zu den Metadaten des Tracks auflöst.
 */
export async function loadGpxTrack(file) {
    if (!AppState.map) { Utils.handleError(I18n.t('tracks.error_map_init')); return null; }
    AppState.isLoadingGpx = true;

    try {
        const gpxData = await readFileContent(file);

        const parser = new DOMParser();
        const xml = parser.parseFromString(gpxData, 'text/xml');

        const waypoints = xml.getElementsByTagName('wpt');
        let dipWaypoint = null;
        for (let i = 0; i < waypoints.length; i++) {
            const name = waypoints[i].getElementsByTagName('name')[0]?.textContent;
            if (name && name.toUpperCase() === 'DIP') {
                const lat = parseFloat(waypoints[i].getAttribute('lat'));
                const lng = parseFloat(waypoints[i].getAttribute('lon'));
                if (!isNaN(lat) && !isNaN(lng)) {
                    dipWaypoint = { lat, lng };
                    console.log(`[trackManager] DIP waypoint found in GPX file at: ${lat}, ${lng}`);
                    break;
                }
            }
        }

        const trackpoints = xml.getElementsByTagName('trkpt');
        const points = [];
        for (let i = 0; i < trackpoints.length; i++) {
            const lat = parseFloat(trackpoints[i].getAttribute('lat'));
            const lng = parseFloat(trackpoints[i].getAttribute('lon'));
            if (isNaN(lat) || isNaN(lng)) continue;
            const ele = trackpoints[i].getElementsByTagName('ele')[0]?.textContent;
            const time = trackpoints[i].getElementsByTagName('time')[0]?.textContent;
            let normalizedTime = null;
            if (time) {
                if (time.includes('.')) {
                    normalizedTime = time.split('.')[0] + 'Z';
                } else {
                    normalizedTime = time;
                }
            }
            points.push({
                lat,
                lng,
                ele: ele ? parseFloat(ele) : null,
                time: normalizedTime ? DateTime.fromISO(normalizedTime, { zone: 'utc' }) : null
            });
        }
        if (points.length < 2) throw new Error(I18n.t('tracks.error_gpx_points'));

        const trackMetaData = await renderTrack(points, file.name, dipWaypoint);
        return trackMetaData;

    } catch (error) {
        console.error('[trackManager] Error in loadGpxTrack:', error);
        Utils.handleError(I18n.t('tracks.error_gpx_parse').replace('{message}', error.message));
        return null;
    } finally {
        AppState.isLoadingGpx = false;
    }
}

/**
 * Lädt und verarbeitet eine CSV-Datei (FlySight-Format, UTC).
 * @param {File} file - Das vom Benutzer ausgewählte CSV-Datei-Objekt.
 * @returns {Promise<object|null>} Ein Promise, das zu den Metadaten des Tracks auflöst.
 */
export async function loadCsvTrackUTC(file) {
    if (!AppState.map) { Utils.handleError(I18n.t('tracks.error_map_init')); return null; }
    AppState.isLoadingGpx = true;

    try {
        const csvData = await readFileContent(file);

        return new Promise(async (resolve, reject) => {
            const points = [];
            Papa.parse(csvData, {
                skipEmptyLines: true,
                step: function (row) {
                    const data = row.data;
                    if (data[0] && data[0].toUpperCase() === '$GNSS' && data.length >= 5) {
                        let timeStr = data[1];
                        const lat = parseFloat(data[2]);
                        const lng = parseFloat(data[3]);
                        const ele = parseFloat(data[4]);
                        if (isNaN(lat) || isNaN(lng) || isNaN(ele)) return;
                        let normalizedTimeStr = null;
                        if (timeStr) {
                            if (timeStr.includes('.')) {
                                normalizedTimeStr = timeStr.split('.')[0] + 'Z';
                            } else {
                                normalizedTimeStr = timeStr;
                            }
                        }
                        let time = null;
                        try {
                            time = DateTime.fromISO(normalizedTimeStr, { setZone: true }).toUTC();
                            if (!time.isValid) time = null;
                        } catch (parseError) {
                            time = null;
                        }
                        points.push({ lat, lng, ele, time });
                    }
                },
                complete: async function () {
                    if (points.length < 2) {
                        reject(new Error(I18n.t('tracks.error_csv_points')));
                        return;
                    }
                    const trackMetaData = await renderTrack(points, file.name, null);
                    resolve(trackMetaData);
                },
                error: function (error) {
                    reject(new Error('Error parsing CSV: ' + error.message));
                }
            });
        });
    } catch (error) {
        console.error('[trackManager] Error in loadCsvTrackUTC:', error);
        Utils.handleError(I18n.t('tracks.error_csv_parse').replace('{message}', error.message));
        return null;
    } finally {
        AppState.isLoadingGpx = false;
    }
}

/**
 * Speichert die aktuell aufgezeichneten Trackpunkte als GPX-Datei.
 * @returns {Promise<void>}
 */
export async function saveRecordedTrack() {
    console.log(`--- Starte saveRecordedTrack mit ${AppState.recordedTrackPoints.length} Punkten ---`);

    if (!AppState.recordedTrackPoints || AppState.recordedTrackPoints.length < 2) {
        Utils.handleError(I18n.t('tracks.error_no_data_save'));
        return;
    }

    try {
        let dipWaypoint = '';
        if (AppState.lastLat !== null && AppState.lastLng !== null) {
            const dipElevation = AppState.lastAltitude !== 'N/A' ? AppState.lastAltitude.toFixed(2) : '0';
            dipWaypoint = `  <wpt lat="${AppState.lastLat}" lon="${AppState.lastLng}">\n    <name>DIP</name>\n    <ele>${dipElevation}</ele>\n    <sym>Flag, Blue</sym>\n  </wpt>\n`;
        }

        const header = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="DZMaster" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>Skydive Track - ${new Date().toLocaleString()}</name></metadata>
${dipWaypoint}<trk><name>Recorded Skydive</name><trkseg>`;

        const footer = `</trkseg></trk></gpx>`;

        const trackpointStrings = AppState.recordedTrackPoints.map((p, index) => {
            if (p && typeof p.lat === 'number' && typeof p.lng === 'number' && p.time) {
                const ele = (typeof p.ele === 'number') ? p.ele.toFixed(2) : '0';
                const time = p.time.toISO();
                const trkpt = `<trkpt lat="${p.lat}" lon="${p.lng}"><ele>${ele}</ele><time>${time}</time></trkpt>`;
                return trkpt;
            }
            return '';
        }).filter(Boolean);

        if (trackpointStrings.length < 2) {
            Utils.handleError(I18n.t('tracks.error_insufficient_points'));
            return;
        }

        const gpxContent = `${header}\n${trackpointStrings.join('\n')}\n${footer}`;
        const fileName = `Skydive_Track_${DateTime.utc().toFormat('yyyy-MM-dd_HHmm')}.gpx`;

        const { Filesystem, Directory, isNative } = await getCapacitor();

        if (isNative && Filesystem) {
            await Filesystem.writeFile({
                path: `DZMaster/${fileName}`,
                data: gpxContent,
                directory: Directory.Documents,
                encoding: 'utf8',
                recursive: true
            });
            Utils.handleMessage(I18n.t('tracks.status_saved_docs'));
        } else {
            if (isNative) {
                Utils.handleError(I18n.t('tracks.error_filesystem_missing'));
            } else {
                const blob = new Blob([gpxContent], { type: "application/gpx+xml;charset=utf-8" });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }
        }

    } catch (error) {
        console.error("Error in saveRecordedTrack:", error);
        Utils.handleError(I18n.t('tracks.error_save_failed'));
    } finally {
        AppState.recordedTrackPoints = [];
    }
}

// ===================================================================
// 2. Öffentliche Exportfunktionen
// ===================================================================

/**
 * Erstellt eine GPX-Datei für den Jump Run Track und löst den Download aus.
 * @param {number} sliderIndex - Der Index des Zeitschiebereglers.
 * @param {number} interpStep - Der Interpolationsschritt.
 * @param {string} heightUnit - Die aktuell ausgewählte Höheneinheit.
 */
export async function exportToGpx(sliderIndex, interpStep, heightUnit) {
    console.log("--- GPX EXPORT DEBUG START ---");
    if (!Settings.getValue('showJumpRunTrack', false)) {
        Utils.handleError(I18n.t('tracks.error_activate_jrt'));
        return;
    }

    if (!AppState.weatherData || AppState.lastLat == null || AppState.lastLng == null || AppState.lastAltitude === 'N/A') {
        Utils.handleError(I18n.t('tracks.error_no_weather_dip'));
        return;
    }

    const dipLat = AppState.lastLat;
    const dipLng = AppState.lastLng;
    const dipElevation = Math.round(AppState.lastAltitude);
    const harpAnchor = AppState.harpMarker ? AppState.harpMarker.getLatLng() : null;
    let harpElevation = null;

    if (harpAnchor) {
        harpElevation = await Utils.getAltitude(harpAnchor.lat, harpAnchor.lng);
        harpElevation = harpElevation !== 'N/A' ? Math.round(harpElevation) : null;
    }

    const interpolatedData = interpolateWeatherData(
        AppState.weatherData, sliderIndex, interpStep, dipElevation, heightUnit
    );

    if (!interpolatedData || interpolatedData.length === 0) {
        Utils.handleError(I18n.t('tracks.error_no_weather_data'));
        return;
    }

    const trackData = JumpPlanner.jumpRunTrack(interpolatedData, harpAnchor);

    if (!trackData || !trackData.latlngs || !trackData.approachLatLngs) {
        Utils.handleError(I18n.t('tracks.error_jrt_calc_failed'));
        return;
    }

    const [approachStartLat, approachStartLng] = trackData.approachLatLngs[1];
    const [jumpRunStartLat, jumpRunStartLng] = trackData.latlngs[0];
    const [jumpRunEndLat, jumpRunEndLng] = trackData.latlngs[1];

    const exitAltitudeAGL = Settings.getValue('exitAltitude', 3000);
    const exitAltitudeMSL = dipElevation + exitAltitudeAGL;

    let gpxContent = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<gpx version="1.1" creator="DZMaster" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>Jump Run - ${new Date().toLocaleString()}</name>
    <desc>Generated by DZMaster. Jump Run Direction: ${trackData.direction}°</desc>
  </metadata>
`;

    gpxContent += `  <wpt lat="${dipLat}" lon="${dipLng}">\n    <name>DIP</name>\n    <ele>${dipElevation}</ele>\n    <sym>Flag, Blue</sym>\n  </wpt>\n`;
    if (harpAnchor && harpElevation !== null) {
        gpxContent += `  <wpt lat="${harpAnchor.lat}" lon="${harpAnchor.lng}">\n    <name>HARP</name>\n    <ele>${harpElevation}</ele>\n    <sym>Flag, Green</sym>\n  </wpt>\n`;
    }
    gpxContent += `  <wpt lat="${approachStartLat}" lon="${approachStartLng}">\n    <name>x-2, ${trackData.direction}°</name>\n    <ele>${exitAltitudeMSL}</ele>\n    <sym>Airplane</sym>\n  </wpt>\n`;
    gpxContent += `  <wpt lat="${jumpRunStartLat}" lon="${jumpRunStartLng}">\n    <name>First Out ${exitAltitudeAGL} m AGL</name>\n    <ele>${exitAltitudeMSL}</ele>\n    <sym>Airplane</sym>\n  </wpt>\n`;
    gpxContent += `  <wpt lat="${jumpRunEndLat}" lon="${jumpRunEndLng}">\n    <name>Last Out</name>\n    <ele>${exitAltitudeMSL}</ele>\n    <sym>Airplane</sym>\n  </wpt>\n`;

    gpxContent += `  <trk>\n    <name>Jump Run and Approach</name>\n    <trkseg>\n`;
    gpxContent += `      <trkpt lat="${approachStartLat}" lon="${approachStartLng}"><ele>${exitAltitudeMSL}</ele></trkpt>\n`;
    gpxContent += `      <trkpt lat="${jumpRunStartLat}" lon="${jumpRunStartLng}"><ele>${exitAltitudeMSL}</ele></trkpt>\n`;
    gpxContent += `      <trkpt lat="${jumpRunEndLat}" lon="${jumpRunEndLng}"><ele>${exitAltitudeMSL}</ele></trkpt>\n`;
    gpxContent += `    </trkseg>\n  </trk>\n</gpx>`;

    const time = Utils.formatTime(AppState.weatherData.time[sliderIndex]).replace(/ /g, '_').replace(/:/g, '');
    const filename = `${time}_JumpRun_Track.gpx`;

    try {
        const { Filesystem, Directory, isNative } = await getCapacitor();
        if (isNative && Filesystem) {
            await Filesystem.writeFile({
                path: `DZMaster/${filename}`,
                data: gpxContent,
                directory: Directory.Documents,
                encoding: 'utf8',
                recursive: true
            });
            Utils.handleMessage(I18n.t('tracks.status_gpx_saved'));
        } else {
            const blob = new Blob([gpxContent], { type: "application/gpx+xml;charset=utf-8" });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }
    } catch (error) {
        console.error("Error saving GPX file:", error);
        Utils.handleError(I18n.t('tracks.error_gpx_save_failed'));
    }
}

/**
 * Erstellt eine GPX-Datei für das Landemuster und löst den Download aus.
 */
export async function exportLandingPatternToGpx() {
    console.log("--- GPX Landing Pattern Export gestartet ---");

    const sliderIndex = parseInt(document.getElementById('timeSlider')?.value) || 0;
    const interpStep = Settings.getValue('interpStep', 'select', 200);
    const heightUnit = Settings.getValue('heightUnit', 'm');

    if (!Settings.getValue('showLandingPattern', false)) {
        Utils.handleError(I18n.t('tracks.error_pattern_activation'));
        return;
    }

    if (!AppState.weatherData || AppState.lastLat == null || AppState.lastLng == null || AppState.lastAltitude === 'N/A') {
        Utils.handleError(I18n.t('tracks.error_activate_pattern'));
        return;
    }
    console.log("Schritt 1: Vorbedingungen erfüllt. Wetterdaten und Position vorhanden.");

    const interpolatedData = interpolateWeatherData(
        AppState.weatherData, sliderIndex, interpStep, Math.round(AppState.lastAltitude), heightUnit
    );

    if (!interpolatedData || interpolatedData.length === 0) {
        Utils.handleError(I18n.t('tracks.error_interpolation_failed'));
        return;
    }
    console.log("Schritt 2: Wetterdaten erfolgreich interpoliert.");

    const patternDataForExport = JumpPlanner.calculateLandingPatternCoords(AppState.lastLat, AppState.lastLng, interpolatedData);

    console.log("Schritt 3: Ergebnis von calculateLandingPatternCoords:", patternDataForExport);
    if (!patternDataForExport) {
        Utils.handleError(I18n.t('tracks.error_pattern_coords_failed'));
        return;
    }
    console.log("Schritt 3: Koordinaten des Landemusters erfolgreich berechnet.");

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

    const time = Utils.formatTime(AppState.weatherData.time[sliderIndex]).replace(/ /g, '_').replace(/:/g, '');
    const filename = `${time}_Landing_Pattern.gpx`;

    try {
        const { Filesystem, Directory, isNative } = await getCapacitor();
        if (isNative && Filesystem) {
            await Filesystem.writeFile({
                path: `DZMaster/${filename}`,
                data: gpxContent,
                directory: Directory.Documents,
                encoding: 'utf8',
                recursive: true
            });
            Utils.handleMessage(I18n.t('tracks.status_pattern_gpx_saved'));
        } else {
            const blob = new Blob([gpxContent], { type: "application/gpx+xml;charset=utf-8" });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }
    } catch (error) {
        console.error("Error saving Landing Pattern GPX file:", error);
        Utils.handleError(I18n.t('tracks.error_pattern_gpx_save_failed'));
    }
    console.log("--- GPX Landing Pattern Export beendet ---");
}

// ===================================================================
// 3. Zentrale Rendering-Funktion
// ===================================================================

/**
 * Rendert einen gegebenen Satz von Trackpunkten auf der Karte als farbkodierte Linie.
 * Löst nach dem Rendern ein 'track:loaded'-Event aus.
 * @param {object[]} points - Ein Array von Punkt-Objekten, die den Track definieren.
 * @param {string} fileName - Der Name der geladenen Datei.
 * @param {object|null} [dipWaypoint=null] - Ein optionaler DIP-Wegpunkt aus einer GPX-Datei.
 * @returns {Promise<object|null>} Ein Promise, das zu den Metadaten des Tracks auflöst.
 * @private
 */
async function renderTrack(points, fileName, dipWaypoint = null) {
    try {
        console.log(`[trackManager] renderTrack called for ${fileName} with ${points.length} points.`);
        if (!AppState.map) {
            console.warn('[trackManager] Map object in AppState is not available in renderTrack.');
            Utils.handleError(I18n.t('tracks.error_render_map'));
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

            if (dipWaypoint) {
                console.log("[trackManager] DIP waypoint found in GPX. Setting DIP to waypoint position.");
                AppState.lastLat = dipWaypoint.lat;
                AppState.lastLng = dipWaypoint.lng;
                AppState.lastAltitude = await Utils.getAltitude(AppState.lastLat, AppState.lastLng);
            } else {
                console.log("[trackManager] No DIP waypoint in file. Setting DIP to the last point of the track.");
                const finalPoint = points[points.length - 1];
                AppState.lastLat = finalPoint.lat;
                AppState.lastLng = finalPoint.lng;
                AppState.lastAltitude = await Utils.getAltitude(AppState.lastLat, AppState.lastLng);
            }

            trackMetaData.finalPointData = { lat: AppState.lastLat, lng: AppState.lastLng, altitude: AppState.lastAltitude };

            if (points[0].time && points[0].time.isValid) {
                const initialTimestamp = points[0].time;
                const today = DateTime.utc().startOf('day');
                const trackDateLuxon = initialTimestamp.startOf('day');

                // Auch Tracks vom selben Tag (<= heute) werden historisch geladen – nur zukünftige
                // (z. B. geplante Routen) bleiben im Forecast-Modus. Die historical-forecast-API
                // liefert für heute bereits den vollen Tag.
                if (trackDateLuxon <= today) {
                    trackMetaData.historicalDateString = trackDateLuxon.toFormat('yyyy-MM-dd');
                }

                let roundedTimestamp = initialTimestamp.startOf('hour');
                if (initialTimestamp.minute >= 30) roundedTimestamp = roundedTimestamp.plus({ hours: 1 });
                trackMetaData.timestampToUseForWeather = roundedTimestamp.toISO();
            }

            const distance = (points.reduce((dist, p, i) => {
                if (i === 0 || !AppState.map) return 0; const prev = points[i - 1];
                return dist + AppState.map.distance([prev.lat, prev.lng], [p.lat, p.lng]);
            }, 0) / 1000).toFixed(2);
            const elevations = points.map(p => p.ele).filter(e => e !== null);
            const elevationMin = elevations.length ? Math.min(...elevations).toFixed(0) : 'N/A';
            const elevationMax = elevations.length ? Math.max(...elevations).toFixed(0) : 'N/A';

            const trackLoadedEvent = new CustomEvent('track:loaded', {
                detail: {
                    lat: AppState.lastLat,
                    lng: AppState.lastLng,
                    altitude: AppState.lastAltitude,
                    timestamp: trackMetaData.timestampToUseForWeather,
                    historicalDate: trackMetaData.historicalDateString,
                    summary: `<br><strong>Track:</strong> ` + I18n.t('tracks.summary')
                        .replace('{distance}', distance)
                        .replace('{min}', elevationMin)
                        .replace('{max}', elevationMax)
                        .replace('{file}', fileName)
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
            if (bounds.isValid()) {
                AppState.map.fitBounds(bounds, { padding: [50, 50], maxZoom: AppState.map.getMaxZoom() || 18 });
            } else {
                Utils.handleError(I18n.t('tracks.error_render_invalid_coords'));
            }
        }

        trackMetaData.success = true;
        console.log('[trackManager] renderTrack finished successfully.');
        return trackMetaData;

    } catch (error) {
        console.error('[trackManager] Error in renderTrack:', error);
        Utils.handleError(I18n.t('tracks.error_render_generic').replace('{message}', error.message));
        AppState.gpxPoints = [];
        if (AppState.gpxLayer && AppState.map && AppState.map.hasLayer(AppState.gpxLayer)) {
            AppState.map.removeLayer(AppState.gpxLayer);
        }
        AppState.gpxLayer = null;
        AppState.isTrackLoaded = false;
        return { success: false, error: error.message };
    }
}

// ===================================================================
// 4. Interne Hilfsfunktionen
// ===================================================================

/**
 * Liest den Textinhalt einer Datei. Nutzt die Capacitor Filesystem API für native
 * Apps und den Web FileReader als Fallback.
 * @param {File} file - Das Datei-Objekt.
 * @returns {Promise<string>} Der Inhalt der Datei als Text.
 * @private
 */
async function readFileContent(file) {
    const { Filesystem, isNative, Directory } = await getCapacitor();

    if (isNative && file.path && Filesystem) {
        console.log(`[trackManager] Reading file via Capacitor Filesystem API: ${file.path}`);
        try {
            const result = await Filesystem.readFile({
                path: file.path,
                encoding: 'utf8'
            });
            return result.data;
        } catch (error) {
            console.error('[trackManager] Error reading file with Capacitor:', error);
            // Fallback für Content-URIs auf Android, die nicht direkt per Pfad lesbar sind
            if (file.webPath) {
                const response = await fetch(file.webPath);
                return await response.text();
            }
            throw new Error('Could not read file using native API.');
        }
    } else {
        console.log(`[trackManager] Reading file via Web FileReader: ${file.name}`);
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(new Error('Error reading file.'));
            reader.readAsText(file);
        });
    }
}

// ===================================================================
// 5. Composite GPX Export
// ===================================================================

/**
 * Generiert NUR die Trackpoints für einen Kreis (ohne <trk>-Wrapper).
 */
function getCircleTrackPoints(centerLat, centerLng, radiusMeters, elevation = 0) {
    if (radiusMeters <= 0) return '';
    const steps = 72;
    let points = '';

    for (let i = 0; i <= steps; i++) {
        const bearing = i * (360 / steps);
        const [lat, lng] = Utils.calculateNewCenter(centerLat, centerLng, radiusMeters, bearing);
        points += `      <trkpt lat="${lat}" lon="${lng}"><ele>${elevation.toFixed(1)}</ele></trkpt>\n`;
    }
    return points;
}

export async function exportCompositeJumpGpx(options) {
    const { includeJumpRun, includePattern, includeExitCircles, includeCanopyCircles, mergeTracks } = options;
    console.log("--- Starting Composite GPX Export ---", options);

    if (!AppState.weatherData || AppState.lastLat == null) {
        Utils.handleError(I18n.t('tracks.error_no_location_weather'));
        return;
    }

    const originalSettings = {
        calculateJump: Settings.state.userSettings.calculateJump,
        showCanopyArea: Settings.state.userSettings.showCanopyArea,
        showExitArea: Settings.state.userSettings.showExitArea,
    };

    Settings.state.userSettings.calculateJump = true;
    if (includeCanopyCircles) Settings.state.userSettings.showCanopyArea = true;
    if (includeExitCircles) Settings.state.userSettings.showExitArea = true;

    try {
        const sliderIndex = parseInt(document.getElementById('timeSlider')?.value) || 0;
        const interpStep = Settings.getValue('interpStep', 'select', 200);
        const heightUnit = Settings.getValue('heightUnit', 'm');

        const baseHeight = Math.round(AppState.lastAltitude);
        const safeBaseHeight = (!isNaN(baseHeight) && baseHeight !== null) ? baseHeight : 0;
        const exitAltitudeAGL = Settings.getValue('exitAltitude', 3000);
        const openingAltitudeAGL = Settings.getValue('openingAltitude', 1200);
        const buffer = 200;

        const interpolatedData = interpolateWeatherData(
            AppState.weatherData, sliderIndex, interpStep, safeBaseHeight, heightUnit
        );

        if (!interpolatedData || interpolatedData.length === 0) {
            Utils.handleError(I18n.t('tracks.error_calc_no_data'));
            return;
        }

        let gpxContent = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<gpx version="1.1" creator="DZMaster" 
    xmlns="http://www.topografix.com/GPX/1/1" 
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
    xmlns:gpxx="http://www.garmin.com/xmlschemas/GpxExtensions/v3"
    xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>Skydive Plan - ${new Date().toLocaleString()}</name>
  </metadata>
`;

        let mergedSegments = "";

        const addTrack = (name, color, pointsString) => {
            if (mergeTracks) {
                // Im Merge-Modus werden Name und Farbe verworfen — GPX unterstützt keine Segment-Farben
                mergedSegments += `    <trkseg>\n${pointsString}    </trkseg>\n`;
            } else {
                gpxContent += `
  <trk>
    <name>${name}</name>
    <extensions><gpxx:TrackExtension><gpxx:DisplayColor>${color}</gpxx:DisplayColor></gpxx:TrackExtension></extensions>
    <trkseg>
${pointsString}    </trkseg>
  </trk>`;
            }
        };

        if (includePattern) {
            const pattern = JumpPlanner.calculateLandingPatternCoords(AppState.lastLat, AppState.lastLng, interpolatedData);
            if (pattern) {
                const legHeightDownwind = Settings.getValue('legHeightDownwind', 300);
                const legHeightBase = Settings.getValue('legHeightBase', 200);
                const legHeightFinal = Settings.getValue('legHeightFinal', 100);

                const eleDown = safeBaseHeight + legHeightDownwind;
                const eleBase = safeBaseHeight + legHeightBase;
                const eleFinal = safeBaseHeight + legHeightFinal;

                gpxContent += `  <wpt lat="${pattern.landingPoint[0]}" lon="${pattern.landingPoint[1]}"><name>DIP</name><ele>${safeBaseHeight}</ele><sym>Flag, Blue</sym></wpt>\n`;

                let pts = `      <trkpt lat="${pattern.downwindStart[0]}" lon="${pattern.downwindStart[1]}"><ele>${eleDown}</ele></trkpt>\n`;
                pts += `      <trkpt lat="${pattern.baseStart[0]}" lon="${pattern.baseStart[1]}"><ele>${eleBase}</ele></trkpt>\n`;
                pts += `      <trkpt lat="${pattern.finalStart[0]}" lon="${pattern.finalStart[1]}"><ele>${eleFinal}</ele></trkpt>\n`;
                pts += `      <trkpt lat="${pattern.landingPoint[0]}" lon="${pattern.landingPoint[1]}"><ele>${safeBaseHeight}</ele></trkpt>\n`;

                addTrack("Landing Pattern", "Cyan", pts);
            }
        }

        if (includeJumpRun) {
            const harpAnchor = AppState.harpMarker ? AppState.harpMarker.getLatLng() : null;
            const jrt = JumpPlanner.jumpRunTrack(interpolatedData, harpAnchor);

            if (jrt) {
                const exitAltitudeMSL = safeBaseHeight + exitAltitudeAGL;
                const approachStart = jrt.approachLatLngs[1];
                const exit = jrt.latlngs[0];
                const lastOut = jrt.latlngs[1];

                gpxContent += `  <wpt lat="${approachStart[0]}" lon="${approachStart[1]}"><name>X-2</name><ele>${exitAltitudeMSL}</ele><sym>Waypoint</sym></wpt>\n`;
                gpxContent += `  <wpt lat="${exit[0]}" lon="${exit[1]}"><name>HARP</name><ele>${exitAltitudeMSL}</ele><sym>Airplane</sym></wpt>\n`;
                gpxContent += `  <wpt lat="${lastOut[0]}" lon="${lastOut[1]}"><name>LAST OUT</name><ele>${exitAltitudeMSL}</ele><sym>Waypoint</sym></wpt>\n`;

                let pts = `      <trkpt lat="${approachStart[0]}" lon="${approachStart[1]}"><ele>${exitAltitudeMSL}</ele></trkpt>\n`;
                pts += `      <trkpt lat="${exit[0]}" lon="${exit[1]}"><ele>${exitAltitudeMSL}</ele></trkpt>\n`;
                pts += `      <trkpt lat="${lastOut[0]}" lon="${lastOut[1]}"><ele>${exitAltitudeMSL}</ele></trkpt>\n`;

                addTrack(`Jump Run (${jrt.direction}°)`, "Magenta", pts);
            }
        }

        if (includeExitCircles) {
            const exitData = JumpPlanner.calculateExitCircle(interpolatedData);
            if (exitData && !exitData.error) {
                const exitEle = safeBaseHeight + exitAltitudeAGL;

                const greenPts = getCircleTrackPoints(exitData.greenLatFull, exitData.greenLngFull, exitData.greenRadius, exitEle);
                addTrack(`Exit Area Max @ ${exitAltitudeAGL}m`, "Green", greenPts);

                const darkGreenPts = getCircleTrackPoints(exitData.greenLat, exitData.greenLng, exitData.darkGreenRadius, exitEle);
                addTrack(`Exit Area Safe @ ${exitAltitudeAGL}m`, "DarkGreen", darkGreenPts);
            }
        }

        if (includeCanopyCircles) {
            const canopyData = JumpPlanner.calculateCanopyCircles(interpolatedData);
            if (canopyData) {
                const redEle = safeBaseHeight + openingAltitudeAGL - buffer;
                const [redCenterLat, redCenterLng] = Utils.calculateNewCenter(canopyData.redLat, canopyData.redLng, canopyData.displacementFull, canopyData.directionFull);

                const redPts = getCircleTrackPoints(redCenterLat, redCenterLng, canopyData.radiusFull, redEle);
                addTrack(`Max Range @ ${Math.round(openingAltitudeAGL - buffer)}m`, "Red", redPts);

                if (canopyData.additionalBlueRadii && canopyData.additionalBlueRadii.length > 0) {
                    canopyData.additionalBlueRadii.forEach((radius, idx) => {
                        const disp = canopyData.additionalBlueDisplacements[idx];
                        const dir = canopyData.additionalBlueDirections[idx];
                        const ringHeightAGL = canopyData.additionalBlueUpperLimits[idx];
                        const ringEle = safeBaseHeight + ringHeightAGL;
                        const [cLat, cLng] = Utils.calculateNewCenter(canopyData.blueLat, canopyData.blueLng, disp, dir);

                        const bluePts = getCircleTrackPoints(cLat, cLng, radius, ringEle);
                        addTrack(`Ideal Pos @ ${Math.round(ringHeightAGL)}m`, "Blue", bluePts);
                    });
                }
            }
        }

        if (mergeTracks && mergedSegments.length > 0) {
            gpxContent += `
  <trk>
    <name>Skydive Plan Combined</name>
    <extensions><gpxx:TrackExtension><gpxx:DisplayColor>Red</gpxx:DisplayColor></gpxx:TrackExtension></extensions>
    ${mergedSegments}
  </trk>`;
        }

        gpxContent += `</gpx>`;

        const time = Utils.formatTime(AppState.weatherData.time[sliderIndex]).replace(/ /g, '_').replace(/:/g, '');
        const filename = `Jump_Plan_${time}.gpx`;

        const { Filesystem, Directory, isNative } = await getCapacitor();
        if (isNative && Filesystem) {
            await Filesystem.writeFile({ path: `DZMaster/${filename}`, data: gpxContent, directory: Directory.Documents, encoding: 'utf8', recursive: true });
            Utils.handleMessage(I18n.t('tracks.status_generic_saved').replace('{filename}', filename));
        } else {
            const blob = new Blob([gpxContent], { type: "application/gpx+xml;charset=utf-8" });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }

    } catch (error) {
        console.error("Export failed:", error);
        Utils.handleError(I18n.t('tracks.error_gpx_save_failed'));
    } finally {
        Settings.state.userSettings.calculateJump = originalSettings.calculateJump;
        Settings.state.userSettings.showCanopyArea = originalSettings.showCanopyArea;
        Settings.state.userSettings.showExitArea = originalSettings.showExitArea;
        console.log("--- Composite GPX Export Finished ---");
    }
}