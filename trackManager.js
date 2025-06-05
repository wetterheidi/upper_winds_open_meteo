import {
    AppState,
    createCustomMarker,
    attachMarkerDragend,
    updateMarkerPopup,
    fetchWeatherForLocation,
    debouncedCalculateJump,
    calculateCutAway,
    updateJumpRunTrack,
    updateLandingPattern,
    getCoordinateFormat,
    getWindSpeedUnit,
    getHeightUnit
} from './app.js';
import { Settings } from "./settings.js";
import { Utils } from "./utils.js";
import { interpolateColor } from "./uiHelpers.js";
"use strict";


function getTooltipContent(point, index, points, groundAltitude, windUnitFromArg, heightUnitFromArg) {
    // Verwende die importierten Getter-Funktionen, falls die Argumente nicht direkt die Werte sind
    const currentWindUnit = windUnitFromArg || getWindSpeedUnit();
    const currentHeightUnit = heightUnitFromArg || getHeightUnit();
    const currentCoordFormat = getCoordinateFormat(); // Wird direkt verwendet

    if (!AppState.map) {
        console.warn('Map not initialized for getTooltipContent');
        return 'Map not initialized';
    }

    const coords = Utils.convertCoords(point.lat, point.lng, currentCoordFormat);
    let tooltipContent = currentCoordFormat === 'MGRS' ? `MGRS: ${coords.lat}` : `Lat: ${coords.lat}<br>Lng: ${coords.lng}`;
    
    const elevation = point.ele;
    let aglHeight = (elevation !== null && groundAltitude !== null) ? (elevation - groundAltitude) : null;
    
    if (aglHeight !== null) {
        // Settings.state.userSettings.heightUnit ist hier nicht direkt verfügbar,
        // daher verwenden wir den importierten Getter oder den übergebenen Parameter.
        const effectiveHeightUnit = currentHeightUnit; 
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
            // Verwende currentWindUnit für die Konvertierung
            speed = Utils.convertWind(speedMs, currentWindUnit, 'm/s'); 
            speed = currentWindUnit === 'bft' ? Math.round(speed) : speed.toFixed(1);
            const eleDiff = point.ele - points[index - 1].ele;
            descentRate = (eleDiff / timeDiff).toFixed(1);
        }
    }
    tooltipContent += `<br>Speed: ${speed} ${currentWindUnit}`; // Verwende currentWindUnit
    tooltipContent += `<br>Descent Rate: ${descentRate} m/s`;
    return tooltipContent;
}

export async function loadGpxTrack(file) {
    if (!AppState.map) { Utils.handleError('Map not initialized.'); return; }
    AppState.isLoadingGpx = true;
    const reader = new FileReader();
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
                points.push({ lat, lng, ele: ele ? parseFloat(ele) : null, time: time ? luxon.DateTime.fromISO(time, { zone: 'utc' }) : null });
            }
            if (points.length < 2) throw new Error('GPX track has insufficient points.');
            
            const trackMetaData = await renderTrack(points, file.name);
            if (trackMetaData && trackMetaData.trackDate) {
                const historicalDatePicker = document.getElementById('historicalDatePicker');
                if (historicalDatePicker) historicalDatePicker.value = trackMetaData.trackDate;
            }
            if (trackMetaData && trackMetaData.trackSummary) {
                const infoEl = document.getElementById('info');
                if (infoEl) infoEl.innerHTML += trackMetaData.trackSummary;
            }

        } catch (error) { console.error('Error in loadGpxTrack:', error); Utils.handleError('Error parsing GPX file: ' + error.message); }
        finally { AppState.isLoadingGpx = false; }
    };
    reader.onerror = () => { Utils.handleError('Error reading GPX file.'); AppState.isLoadingGpx = false; };
    reader.readAsText(file);
}
//If FlySight stores Z time
export async function loadCsvTrackUTC(file) { 
    if (!AppState.map) { Utils.handleError('Map not initialized.'); return; }
    AppState.isLoadingGpx = true;
    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const csvData = e.target.result;
            const points = [];
            Papa.parse(csvData, {
                skipEmptyLines: true,
                step: function (row) {
                    const data = row.data;
                    if (data[0] === '$GNSS') { 
                        let timeStr = data[1]; 
                        const lat = parseFloat(data[2]);
                        const lng = parseFloat(data[3]);
                        const ele = parseFloat(data[4]);
                        if (isNaN(lat) || isNaN(lng) || isNaN(ele)) return;
                        let time = null;
                        try {
                            time = luxon.DateTime.fromISO(timeStr, { setZone: true }).toUTC();
                            if(!time.isValid) time = null;
                        } catch (parseError) { time = null; }
                        points.push({ lat, lng, ele, time });
                    }
                },
                complete: async function() {
                    if (points.length < 2) throw new Error('CSV track has insufficient points.');
                    const trackMetaData = await renderTrack(points, file.name);
                    if (trackMetaData && trackMetaData.trackDate) {
                        const historicalDatePicker = document.getElementById('historicalDatePicker');
                        if (historicalDatePicker) historicalDatePicker.value = trackMetaData.trackDate;
                    }
                    if (trackMetaData && trackMetaData.trackSummary) {
                        const infoEl = document.getElementById('info');
                        if (infoEl) infoEl.innerHTML += trackMetaData.trackSummary;
                    }
                },
                error: function(error) { throw new Error('Error parsing CSV: ' + error.message); }
            });
        } catch (error) { console.error('Error in loadCsvTrack:', error); Utils.handleError('Error parsing CSV file: ' + error.message); }
        finally { AppState.isLoadingGpx = false; }
    };
    reader.onerror = () => { Utils.handleError('Error reading CSV file.'); AppState.isLoadingGpx = false; };
    reader.readAsText(file);
}

async function renderTrack(points, fileName) {
    try {
        console.log(`renderTrack called for ${fileName} with ${points.length} points.`);
        if (!AppState.map) {
            console.warn('Map object in AppState is not available in renderTrack.');
            Utils.handleError('Map not initialized. Cannot render track.');
            return null;
        }

        // Clear existing layer
        if (AppState.gpxLayer) {
            if (AppState.map.hasLayer(AppState.gpxLayer)) {
                AppState.map.removeLayer(AppState.gpxLayer);
            }
            AppState.gpxLayer = null;
        }
        AppState.gpxPoints = points;
        AppState.isTrackLoaded = false;

        let trackMetaData = {
            finalPoint: null,
            timestampToUse: null,
            trackDate: null, // Für die Aktualisierung des DatePickers
            trackSummary: ''   // Für die Info-Anzeige
        };

        // Move marker to final point and update lastAltitude
        if (points.length > 0) {
            const finalPoint = points[points.length - 1];
            AppState.lastLat = finalPoint.lat;
            AppState.lastLng = finalPoint.lng;
            AppState.lastAltitude = await Utils.getAltitude(AppState.lastLat, AppState.lastLng);
            console.log('Moved marker to final track point:', { lat: AppState.lastLat, lng: AppState.lastLng, lastAltitude: AppState.lastAltitude });
            
            trackMetaData.finalPoint = { lat: AppState.lastLat, lng: AppState.lastLng, altitude: AppState.lastAltitude };

            // Update marker position
            if (typeof Utils.configureMarker === 'function' &&
                typeof createCustomMarker === 'function' &&
                typeof attachMarkerDragend === 'function' &&
                typeof updateMarkerPopup === 'function') {
                AppState.currentMarker = Utils.configureMarker(
                    AppState.map, AppState.lastLat, AppState.lastLng, AppState.lastAltitude, false,
                    createCustomMarker, attachMarkerDragend, updateMarkerPopup, AppState.currentMarker,
                    (marker) => { AppState.currentMarker = marker; }
                );
            } else {
                console.warn("Marker utility functions (createCustomMarker, etc.) not available in trackManager.js for renderTrack.");
            }
            AppState.isManualPanning = false;

            if (points[0].time && points[0].time.isValid) {
                const initialTimestamp = points[0].time;
                const today = luxon.DateTime.utc().startOf('day');
                const trackDateLuxon = initialTimestamp.startOf('day');
                trackMetaData.trackDate = trackDateLuxon.toFormat('yyyy-MM-dd'); // Für DatePicker

                const isToday = trackDateLuxon.hasSame(today, 'day');
                let roundedTimestamp = initialTimestamp.startOf('hour');
                if (initialTimestamp.minute >= 30) roundedTimestamp = roundedTimestamp.plus({ hours: 1 });
                trackMetaData.timestampToUse = roundedTimestamp.toISO();
                
                // Die DOM-Manipulation für historicalDatePicker wird später von app.js übernommen
            }

            // Kernaktionen nach Laden des Tracks
            await fetchWeatherForLocation(AppState.lastLat, AppState.lastLng, trackMetaData.timestampToUse);
            if (Settings.state.userSettings.calculateJump) {
                debouncedCalculateJump();
                calculateCutAway();
            }
            if (Settings.state.userSettings.showJumpRunTrack) {
                updateJumpRunTrack();
            }
            if (Settings.state.userSettings.showLandingPattern) {
                console.log('renderTrack: Calling updateLandingPattern...');
                updateLandingPattern();
            }
        }

        // Create track layer with custom pane
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
                segment.setTooltipContent(getTooltipContent(closestPoint, closestIndex, points, groundAltitude, getWindSpeedUnit(), getHeightUnit())).openTooltip(latlng);
            });
            AppState.gpxLayer.addLayer(segment);
        }
        if (AppState.map) AppState.gpxLayer.addTo(AppState.map);
        AppState.isTrackLoaded = true;

        if (points.length > 0 && AppState.map) {
            const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]));
            if (bounds.isValid()) AppState.map.fitBounds(bounds, { padding: [50, 50], maxZoom: AppState.map.getMaxZoom() });
            else Utils.handleError('Unable to display track: invalid coordinates.');
        }

        const distance = (points.reduce((dist, p, i) => {
            if (i === 0 || !AppState.map) return 0; const prev = points[i - 1];
            return dist + AppState.map.distance([prev.lat, prev.lng], [p.lat, p.lng]);
        }, 0) / 1000).toFixed(2);
        const elevations = points.map(p => p.ele).filter(e => e !== null);
        const elevationMin = elevations.length ? Math.min(...elevations).toFixed(0) : 'N/A';
        const elevationMax = elevations.length ? Math.max(...elevations).toFixed(0) : 'N/A';
        
        trackMetaData.trackSummary = `<br><strong>Track:</strong> Distance: ${distance} km, Min Elevation: ${elevationMin} m, Max Elevation: ${elevationMax} m (Source: ${fileName})`;
        
        return trackMetaData; // Gibt Metadaten zurück

    } catch (error) {
        console.error('Error in renderTrack:', error);
        Utils.handleError('Error rendering track: ' + error.message);
        AppState.gpxPoints = [];
        if (AppState.gpxLayer && AppState.map && AppState.map.hasLayer(AppState.gpxLayer)) {
            AppState.map.removeLayer(AppState.gpxLayer);
        }
        AppState.gpxLayer = null;
        AppState.isTrackLoaded = false;
        return null;
    }
}
