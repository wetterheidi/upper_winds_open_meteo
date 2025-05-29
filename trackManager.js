import { AppState, createCustomMarker, attachMarkerDragend, updateMarkerPopup, fetchWeatherForLocation, debouncedCalculateJump, calculateCutAway } from './app.js';
import { Settings } from "./settings.js";
import { Utils } from "./utils.js";
import { interpolateColor} from "./uiHelpers.js";
"use strict";


export function getTooltipContent(point, index, points, groundAltitude, windUnit, heightUnit) {
    if (!AppState.map) {
        console.warn('Map not initialized, cannot calculate tooltip content distance');
        return 'Map not initialized';
    }

    const coordFormat = Settings.getValue('coordFormat', 'radio', 'Decimal');
    const coords = Utils.convertCoords(point.lat, point.lng, coordFormat);
    let tooltipContent = coordFormat === 'MGRS' ? `MGRS: ${coords.lat}` : `Lat: ${coords.lat}<br>Lng: ${coords.lng}`;
    const elevation = point.ele;
    let aglHeight = (elevation !== null && groundAltitude !== null) ? (elevation - groundAltitude) : null;
    if (aglHeight !== null) {
        // Use Settings.state.userSettings.heightUnit as fallback if heightUnit is undefined
        const effectiveHeightUnit = heightUnit || Settings.state.userSettings.heightUnit || 'm';
        aglHeight = Utils.convertHeight(aglHeight, effectiveHeightUnit);
        aglHeight = Math.round(aglHeight);
        tooltipContent = `Altitude: ${aglHeight} ${effectiveHeightUnit} AGL`;
    } else {
        tooltipContent = `Altitude: N/A`;
    }
    let speed = 'N/A';
    let descentRate = 'N/A';
    if (index > 0 && point.time && points[index - 1].time && point.ele !== null && points[index - 1].ele !== null) {
        const timeDiff = (point.time.toMillis() - points[index - 1].time.toMillis()) / 1000; // seconds
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
export function loadGpxTrack(file) {
    if (!AppState.map) {
        console.warn('Map not initialized, cannot load GPX track');
        Utils.handleError('Map not initialized, cannot load GPX track.');
        return;
    }

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
                if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                    console.warn('Invalid trackpoint coordinates:', { lat, lng, index: i });
                    continue;
                }
                const ele = trackpoints[i].getElementsByTagName('ele')[0]?.textContent;
                const time = trackpoints[i].getElementsByTagName('time')[0]?.textContent;
                points.push({
                    lat: lat,
                    lng: lng,
                    ele: ele ? parseFloat(ele) : null,
                    time: time ? luxon.DateTime.fromISO(time, { zone: 'utc' }) : null
                });
            }
            if (points.length < 2) {
                throw new Error('GPX track has insufficient points.');
            }
            await renderTrack(points, file.name);
        } catch (error) {
            console.error('Error in loadGpxTrack:', error);
            Utils.handleError('Error parsing GPX file: ' + error.message);
        } finally {
            AppState.isLoadingGpx = false;
        }
    };
    reader.onerror = function () {
        Utils.handleError('Error reading GPX file.');
        AppState.isLoadingGpx = false;
    };
    reader.readAsText(file);
}
//If FlySight stores Z time
export function loadCsvTrackUTC(file) {
    if (!AppState.map) {
        console.warn('Map not initialized, cannot load CSV track');
        Utils.handleError('Map not initialized, cannot load CSV track.');
        return;
    }

    AppState.isLoadingGpx = true; // Reuse loading state
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
                        const timeStr = data[1];
                        const lat = parseFloat(data[2]);
                        const lng = parseFloat(data[3]);
                        const ele = parseFloat(data[4]); // hMSL as elevation
                        if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180 || isNaN(ele)) {
                            console.warn('Invalid CSV trackpoint:', { time: timeStr, lat, lng, ele });
                            return;
                        }
                        let time = null;
                        try {
                            // Parse timestamp as local time
                            time = luxon.DateTime.fromISO(timeStr, { setZone: true });
                            if (!time.isValid) {
                                console.warn('Invalid timestamp in CSV:', { time: timeStr, reason: time.invalidReason });
                                time = null;
                            } else {
                                console.log('Parsed CSV timestamp as local:', { timeStr, localTime: time.toISO(), zone: time.zoneName });
                                // Convert to UTC for consistency with GPX
                                time = time.toUTC();
                                console.log('Converted to UTC:', { utcTime: time.toISO() });
                            }
                        } catch (error) {
                            console.warn('Error parsing timestamp in CSV:', { time: timeStr, error: error.message });
                            time = null;
                        }
                        points.push({
                            lat: lat,
                            lng: lng,
                            ele: ele,
                            time: time
                        });
                    }
                },
                error: function (error) {
                    throw new Error('Error parsing CSV: ' + error.message);
                }
            });
            if (points.length < 2) {
                throw new Error('CSV track has insufficient points.');
            }
            await renderTrack(points, file.name);
        } catch (error) {
            console.error('Error in loadCsvTrack:', error);
            Utils.handleError('Error parsing CSV file: ' + error.message);
        } finally {
            AppState.isLoadingGpx = false;
        }
    };
    reader.onerror = function () {
        Utils.handleError('Error reading CSV file.');
        AppState.isLoadingGpx = false;
    };
    reader.readAsText(file);
}
//If FlySight stores loc time
export function loadCsvTrack(file) {
    if (!AppState.map) {
        console.warn('Map not initialized, cannot load CSV track');
        Utils.handleError('Map not initialized, cannot load CSV track.');
        return;
    }

    AppState.isLoadingGpx = true; // Reuse loading state
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
                        let timeStr = data[1]; // e.g., '2025-04-26T17:36:33.800Z' or '2025-04-26T17:36:33.800'
                        const lat = parseFloat(data[2]);
                        const lng = parseFloat(data[3]);
                        const ele = parseFloat(data[4]); // hMSL as elevation
                        if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180 || isNaN(ele)) {
                            console.warn('Invalid CSV trackpoint:', { time: timeStr, lat, lng, ele });
                            return;
                        }
                        let time = null;
                        try {
                            // Remove 'Z' or any explicit offset to treat as local time
                            timeStr = timeStr.replace(/Z$|([+-]\d{2}:\d{2})$/, '');
                            // Parse as local time in the user's time zone
                            time = luxon.DateTime.fromISO(timeStr, { zone: luxon.Settings.defaultZone });
                            if (!time.isValid) {
                                console.warn('Invalid timestamp in CSV:', { time: timeStr, reason: time.invalidReason });
                                time = null;
                            } else {
                                console.log('Parsed CSV timestamp as local:', { timeStr, localTime: time.toISO(), zone: time.zoneName });
                                // Convert to UTC for consistency with GPX
                                time = time.toUTC();
                                console.log('Converted to UTC:', { utcTime: time.toISO() });
                            }
                        } catch (error) {
                            console.warn('Error parsing timestamp in CSV:', { time: timeStr, error: error.message });
                            time = null;
                        }
                        points.push({
                            lat: lat,
                            lng: lng,
                            ele: ele,
                            time: time
                        });
                    }
                },
                error: function (error) {
                    throw new Error('Error parsing CSV: ' + error.message);
                }
            });
            if (points.length < 2) {
                throw new Error('CSV track has insufficient points.');
            }
            await renderTrack(points, file.name);
        } catch (error) {
            console.error('Error in loadCsvTrack:', error);
            Utils.handleError('Error parsing CSV file: ' + error.message);
        } finally {
            AppState.isLoadingGpx = false;
        }
    };
    reader.onerror = function () {
        Utils.handleError('Error reading CSV file.');
        AppState.isLoadingGpx = false;
    };
    reader.readAsText(file);
}
export async function renderTrack(points, fileName) {
    try {
        // Clear existing layer
        if (AppState.gpxLayer) {
            AppState.map.removeLayer(AppState.gpxLayer);
            AppState.gpxLayer = null;
        }
        AppState.gpxPoints = points;
        AppState.isTrackLoaded = false; // Reset flag at start

        // Move marker to final point and update lastAltitude
        if (points.length > 0) {
            const finalPoint = points[points.length - 1];
            AppState.lastLat = finalPoint.lat;
            AppState.lastLng = finalPoint.lng;
            AppState.lastAltitude = await Utils.getAltitude(AppState.lastLat, AppState.lastLng);
            console.log('Moved marker to final track point:', { lat: AppState.lastLat, lng: AppState.lastLng, lastAltitude: AppState.lastAltitude });

            // Update marker position
            AppState.currentMarker = Utils.configureMarker(
                AppState.map,
                AppState.lastLat,
                AppState.lastLng,
                AppState.lastAltitude,
                false,
                createCustomMarker,
                attachMarkerDragend,
                updateMarkerPopup,
                AppState.currentMarker,
                (marker) => { AppState.currentMarker = marker; }
            );
            AppState.isManualPanning = false;

            // Trigger weather fetch and jump calculations
            let timestampToUse = null;
            if (points[0].time && points[0].time.isValid) {
                const initialTimestamp = points[0].time;
                console.log('Track initial timestamp:', initialTimestamp.toISO());
                const today = luxon.DateTime.utc().startOf('day');
                const trackDate = initialTimestamp.startOf('day');
                const isToday = trackDate.hasSame(today, 'day');

                // Round to nearest hour
                let roundedTimestamp = initialTimestamp.startOf('hour');
                if (initialTimestamp.minute >= 30) {
                    roundedTimestamp = roundedTimestamp.plus({ hours: 1 });
                }
                console.log('Track rounded timestamp:', roundedTimestamp.toISO());
                timestampToUse = roundedTimestamp.toISO();

                if (!isToday) {
                    const historicalDatePicker = document.getElementById('historicalDatePicker');
                    if (historicalDatePicker) {
                        historicalDatePicker.value = trackDate.toFormat('yyyy-MM-dd');
                        console.log('Set historicalDatePicker to:', historicalDatePicker.value);
                    } else {
                        console.warn('historicalDatePicker not found, cannot set historical date');
                        Utils.handleError('Cannot fetch historical weather: date picker not found.');
                    }
                }
            } else {
                console.warn('No valid timestamp in track, using current time for weather');
            }

            await fetchWeatherForLocation(AppState.lastLat, AppState.lastLng, timestampToUse);
            if (Settings.state.userSettings.calculateJump) {
                debouncedCalculateJump();
                calculateCutAway();
            }
            if (Settings.state.userSettings.showJumpRunTrack) {
                updateJumpRunTrack();
            }
            if (Settings.state.userSettings.showLandingPattern) {
                updateLandingPattern();
            }
        }

        // Create track layer with custom pane
        AppState.gpxLayer = L.layerGroup([], { pane: 'gpxTrackPane' });
        const groundAltitude = AppState.lastAltitude !== 'N/A' && !isNaN(AppState.lastAltitude) ? parseFloat(AppState.lastAltitude) : null;
        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];
            const ele1 = p1.ele;
            const ele2 = p2.ele;
            let color = '#808080';
            if (groundAltitude !== null && ele1 !== null && ele2 !== null) {
                const agl1 = ele1 - groundAltitude;
                const agl2 = ele2 - groundAltitude;
                const avgAgl = (agl1 + agl2) / 2;
                color = interpolateColor(avgAgl);
            }
            const segment = L.polyline([[p1.lat, p1.lng], [p2.lat, p2.lng]], {
                color: color,
                weight: 4,
                opacity: 0.75,
                pane: 'gpxTrackPane'
            }).bindTooltip('', { sticky: true });
            segment.on('mousemove', function (e) {
                const latlng = e.latlng;
                let closestPoint = points[0];
                let minDist = Infinity;
                let closestIndex = 0;
                points.forEach((p, index) => {
                    const dist = Math.sqrt(Math.pow(p.lat - latlng.lat, 2) + Math.pow(p.lng - latlng.lng, 2));
                    if (dist < minDist) {
                        minDist = dist;
                        closestPoint = p;
                        closestIndex = index;
                    }
                });
                segment.setTooltipContent(getTooltipContent(closestPoint, closestIndex, points, groundAltitude, Settings.getValue('windUnit', 'radio', 'kt'), Settings.getValue('heightUnit', 'radio', 'm'))).openTooltip(latlng);
            });
            AppState.gpxLayer.addLayer(segment);
        }
        AppState.gpxLayer.addTo(AppState.map);
        AppState.isTrackLoaded = true; // Set flag after successful rendering
        console.log('Track layer added:', { gpxLayer: AppState.gpxLayer, isTrackLoaded: AppState.isTrackLoaded });

        // Center map to track bounds
        if (points.length > 0) {
            const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]));
            if (bounds.isValid()) {
                AppState.map.invalidateSize();
                AppState.map.fitBounds(bounds, { padding: [50, 50], maxZoom: AppState.maxZoom });
                console.log('Map fitted to track bounds:', { bounds: bounds.toBBoxString() });
            } else {
                console.warn('Invalid track bounds:', { points });
                Utils.handleError('Unable to display track: invalid coordinates.');
            }
        }

        // Display track info
        const distance = (points.reduce((dist, p, i) => {
            if (i === 0) return 0;
            const prev = points[i - 1];
            return dist + AppState.map.distance([prev.lat, prev.lng], [p.lat, p.lng]);
        }, 0) / 1000).toFixed(2);
        const elevations = points.map(p => p.ele).filter(e => e !== null);
        const elevationMin = elevations.length ? Math.min(...elevations).toFixed(0) : 'N/A';
        const elevationMax = elevations.length ? Math.max(...elevations).toFixed(0) : 'N/A';
        document.getElementById('info').innerHTML += `<br><strong>Track:</strong> Distance: ${distance} km, Min Elevation: ${elevationMin} m, Max Elevation: ${elevationMax} m (Source: ${fileName})`;
    } catch (error) {
        console.error('Error in renderTrack:', error);
        Utils.handleError('Error rendering track: ' + error.message);
        AppState.gpxPoints = [];
        AppState.gpxLayer = null;
        AppState.isTrackLoaded = false; // Ensure flag is reset on failure
        console.log('Track rendering failed:', { isTrackLoaded: AppState.isTrackLoaded });
    }
}
