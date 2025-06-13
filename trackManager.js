import { AppState } from './state.js';
import { calculateCutAway } from "./jumpPlanner.js";
import { Settings } from "./settings.js";
import { Utils } from "./utils.js";
import { interpolateColor } from "./uiHelpers.js";
import { attachMarkerDragend, createCustomMarker, updatePopupContent } from './mapManager.js';
import { DateTime } from 'luxon';
import * as L from 'leaflet';
window.L = L; // <-- DIESE ZEILE MUSS BLEIBEN
import 'leaflet/dist/leaflet.css'; // Nicht vergessen!
import * as mgrs from 'mgrs';
import Papa from 'papaparse';
import 'leaflet-gpx';

"use strict";


function getTooltipContent(point, index, points, groundAltitude) { // Entferne windUnit und heightUnit aus den Parametern
    if (!AppState.map) {
        console.warn('Map not initialized for getTooltipContent');
        return 'Map not initialized';
    }

    const currentCoordFormat = Settings.getValue('coordFormat', 'radio', 'Decimal'); // Direkter Zugriff
    const windUnit = Settings.getValue('windUnit', 'radio', 'kt'); // Direkter Zugriff
    const heightUnit = Settings.getValue('heightUnit', 'radio', 'm'); // Direkter Zugriff

    const coords = Utils.convertCoords(point.lat, point.lng, currentCoordFormat);
    let tooltipContent = currentCoordFormat === 'MGRS' ? `MGRS: ${coords.lat}` : `Lat: ${coords.lat}<br>Lng: ${coords.lng}`;

    const elevation = point.ele;
    let aglHeight = (elevation !== null && groundAltitude !== null) ? (elevation - groundAltitude) : null;

    if (aglHeight !== null) {
        const effectiveHeightUnit = heightUnit || (Settings.state.userSettings.heightUnit || 'm');
        aglHeight = Utils.convertHeight(aglHeight, effectiveHeightUnit);
        aglHeight = Math.round(aglHeight);
        tooltipContent += `<br>Altitude: ${aglHeight} ${effectiveHeightUnit} AGL`;
    } else {
        tooltipContent += `<br>Altitude: N/A`;
    }

    let speed = 'N/A';
    let descentRate = 'N/A';
    if (index > 0 && point.time && points[index - 1].time && point.ele !== null && points[index - 1].ele !== null) {
        const timeDiff = (point.time.toMillis() - points[index - 1].time.toMillis()) / 1000;
        if (timeDiff > 0) {
            const distance = AppState.map.distance([points[index - 1].lat, points[index - 1].lng], [point.lat, point.lng]);
            const speedMs = distance / timeDiff;
            speed = Utils.convertWind(speedMs, windUnit, 'm/s');
            speed = windUnit === 'bft' ? Math.round(speed) : speed.toFixed(1);
            const eleDiff = point.ele - points[index - 1].ele;
            descentRate = (eleDiff / timeDiff).toFixed(1);
        }
    }
    tooltipContent += `<br>Speed: ${speed} ${windUnit}`;
    tooltipContent += `<br>Descent Rate: ${descentRate} m/s`;
    return tooltipContent;
}

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
//If FlySight stores Z time
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
                color = interpolateColor(avgAgl);
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
                segment.setTooltipContent(getTooltipContent(closestPoint, closestIndex, points, groundAltitude)).openTooltip(latlng);
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
