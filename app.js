// == Project: Skydiving Weather and Jump Planner ==
// == Constants and Global Variables ==
import { AppState } from './state.js';
import { Utils } from './utils.js';
import { Settings } from './settings.js';
import { Constants, FEATURE_PASSWORD } from './constants.js';
import { displayMessage, displayProgress, displayError, hideProgress, updateOfflineIndicator, isMobileDevice } from './ui.js';
import { TileCache, cacheTilesForDIP, debouncedCacheVisibleTiles } from './tileCache.js';
import { setupCacheManagement, setupCacheSettings } from './cacheUI.js';
import * as Coordinates from './coordinates.js';
import { initializeLocationSearch } from './coordinates.js'; // <-- HIER ERGÄNZEN
import { interpolateColor, generateWindBarb } from "./uiHelpers.js";
import { handleHarpPlacement, createHarpMarker, clearHarpMarker } from './harpMarker.js';
import { loadGpxTrack, loadCsvTrackUTC } from './trackManager.js';
import * as JumpPlanner from './jumpPlanner.js';
import * as mapManager from './mapManager.js';


"use strict";

let userSettings;
try {
    const storedSettings = localStorage.getItem('upperWindsSettings');
    userSettings = storedSettings ? JSON.parse(storedSettings) : { ...Settings.defaultSettings };
    // Stelle sicher, dass bestimmte Einstellungen zurückgesetzt werden
    userSettings.customJumpRunDirection = null;
    userSettings.jumpRunTrackOffset = 0;
    userSettings.jumpRunTrackForwardOffset = 0;
    // Speichere die aktualisierten Settings, um localStorage zu überschreiben
    localStorage.setItem('upperWindsSettings', JSON.stringify(userSettings));
    console.log('Settings initialized and saved with reset offsets:', userSettings);
} catch (error) {
    console.error('Failed to parse upperWindsSettings from localStorage:', error);
    userSettings = { ...Settings.defaultSettings, customJumpRunDirection: null, jumpRunTrackOffset: 0, jumpRunTrackForwardOffset: 0 };
    localStorage.setItem('upperWindsSettings', JSON.stringify(userSettings));
}

export { fetchWeatherForLocation, debouncedCalculateJump };

const HEATMAP_BASE_RADIUS = 20;
const HEATMAP_REFERENCE_ZOOM = 13;
const debouncedCalculateJump = Utils.debounce(calculateJump, 300);
export const getTemperatureUnit = () => Settings.getValue('temperatureUnit', 'radio', 'C');
export const getHeightUnit = () => Settings.getValue('heightUnit', 'radio', 'm');
export const getWindSpeedUnit = () => Settings.getValue('windUnit', 'radio', 'kt');
export const getCoordinateFormat = () => Settings.getValue('coordFormat', 'radio', 'Decimal');
export const getInterpolationStep = () => Settings.getValue('interpStepSelect', 'select', 200); // Umbenannt von getInterpStepSelect für Konsistenz
export const getDownloadFormat = () => Settings.getValue('downloadFormat', 'radio', 'csv');

// == Tile caching ==
Utils.handleMessage = displayMessage;
let isCachingCancelled = false;

// == Map Initialization and Interaction ==
// Define custom Coordinates control globally
L.Control.Coordinates = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function (map) {
        var container = L.DomUtil.create('div', 'leaflet-control-coordinates');
        container.style.background = 'rgba(255, 255, 255, 0.8)';
        container.style.padding = '5px';
        container.style.borderRadius = '4px';
        container.style.boxShadow = '0 2px 5px rgba(0, 0, 0, 0.2)';
        container.innerHTML = 'Move mouse over map';
        this._container = container;
        return container;
    },
    update: function (content) {
        this._container.innerHTML = content;
    }
});

// == Refactored initMap ==
// an den Anfang von app.js, nach den Imports und AppState Definition
let elevationCache = new Map();
let qfeCache = new Map();
let lastTapTime = 0;

const debouncedGetElevationAndQFE = Utils.debounce(async (lat, lng, requestLatLng, callback) => {
    const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    const sliderIndex = getSliderValue(); // getSliderValue muss hier zugreifbar sein
    const weatherCacheKey = `${cacheKey}-${sliderIndex}`;
    let elevation, qfe;

    if (elevationCache.has(cacheKey)) {
        elevation = elevationCache.get(cacheKey);
    } else {
        try {
            elevation = await Utils.getAltitude(lat, lng);
            elevationCache.set(cacheKey, elevation);
        } catch (error) {
            console.warn('Failed to fetch elevation:', error);
            elevation = 'N/A';
        }
    }

    if (qfeCache.has(weatherCacheKey)) {
        qfe = qfeCache.get(weatherCacheKey);
    } else {
        if (AppState.weatherData && AppState.weatherData.surface_pressure && sliderIndex >= 0 && sliderIndex < AppState.weatherData.surface_pressure.length) {
            const surfacePressure = AppState.weatherData.surface_pressure[sliderIndex];
            const temperature = AppState.weatherData.temperature_2m?.[sliderIndex] || 16.1;
            const referenceElevation = AppState.lastAltitude !== 'N/A' ? AppState.lastAltitude : 339;
            qfe = Utils.calculateQFE(surfacePressure, elevation, referenceElevation, temperature);
            qfeCache.set(weatherCacheKey, qfe);
            console.log('Calculated QFE:', { lat, lng, surfacePressure, elevation, referenceElevation, temperature, qfe });
        } else {
            console.warn('Surface pressure not available for QFE:', {
                hasWeatherData: !!AppState.weatherData,
                hasSurfacePressure: !!AppState.weatherData?.surface_pressure,
                sliderIndexValid: sliderIndex >= 0 && sliderIndex < (AppState.weatherData?.surface_pressure?.length || 0)
            });
            qfe = 'N/A';
        }
    }
    callback({ elevation, qfe }, requestLatLng);
}, 500);

async function _fetchInitialWeather(lat, lng) {
    const lastFullHourUTC = Utils.getLastFullHourUTC();
    let utcIsoString;
    try {
        utcIsoString = lastFullHourUTC.toISOString();
    } catch (error) {
        console.error('Failed to get UTC time:', error);
        const now = new Date();
        now.setMinutes(0, 0, 0);
        utcIsoString = now.toISOString();
    }

    let initialTime;
    if (Settings.state.userSettings.timeZone === 'Z') {
        initialTime = utcIsoString.replace(':00.000Z', 'Z');
    } else {
        try {
            const localTimeStr = await Utils.formatLocalTime(utcIsoString, lat, lng);
            const match = localTimeStr.match(/^(\d{4}-\d{2}-\d{2}) (\d{2})(\d{2}) GMT([+-]\d+)/);
            if (!match) throw new Error(`Local time string format mismatch: ${localTimeStr}`);
            const [, datePart, hour, minute, offset] = match;
            const offsetSign = offset.startsWith('+') ? '+' : '-';
            const offsetHours = Math.abs(parseInt(offset, 10)).toString().padStart(2, '0');
            const formattedOffset = `${offsetSign}${offsetHours}:00`;
            const isoFormatted = `${datePart}T${hour}:${minute}:00${formattedOffset}`;
            const localDate = new Date(isoFormatted);
            if (isNaN(localDate.getTime())) throw new Error(`Failed to parse localDate from ${isoFormatted}`);
            initialTime = localDate.toISOString().replace(':00.000Z', 'Z');
        } catch (error) {
            console.error('Error converting to local time for initial weather:', error);
            initialTime = utcIsoString.replace(':00.000Z', 'Z');
        }
    }
    await fetchWeatherForLocation(lat, lng, initialTime, true);
}

// == Marker and popup functions ==
function reinitializeCoordsControl() {
    if (!AppState.map) {
        console.warn('Map not initialized, cannot reinitialize coords control');
        return;
    }

    console.log('Before reinitialize - coordsControl:', AppState.coordsControl);
    if (AppState.coordsControl) {
        AppState.coordsControl.remove();
        console.log('Removed existing coordsControl');
    }
    AppState.coordsControl = new L.Control.Coordinates();
    AppState.coordsControl.addTo(AppState.map);
    console.log('After reinitialize - coordsControl:', AppState.coordsControl);
}
function createCutAwayMarker(lat, lng) {
    const cutAwayIcon = L.icon({
        iconUrl: 'schere_purple.png', // Use a different icon if available
        iconSize: [25, 25],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32],
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        shadowSize: [41, 41],
        shadowAnchor: [13, 32],
        className: 'cutaway-marker' // For CSS styling (e.g., different color)
    });
    return L.marker([lat, lng], {
        icon: cutAwayIcon,
        draggable: true
    });
}
function attachCutAwayMarkerDragend(marker) {
    marker.on('dragend', (e) => {
        const position = marker.getLatLng();
        AppState.cutAwayLat = position.lat;
        AppState.cutAwayLng = position.lng;
        console.log('Cut-away marker dragged to:', { lat: AppState.cutAwayLat, lng: AppState.cutAwayLng });
        updateCutAwayMarkerPopup(marker, AppState.cutAwayLat, AppState.cutAwayLng);
        if (Settings.state.userSettings.showCutAwayFinder && Settings.state.userSettings.calculateJump && AppState.weatherData) {
            console.log('Recalculating cut-away for marker drag');
            debouncedCalculateJump(); // Use debounced version
            JumpPlanner.calculateCutAway();
        }
    });
}
function updateCutAwayMarkerPopup(marker, lat, lng, open = false) {
    const coordFormat = getCoordinateFormat();
    const coords = Utils.convertCoords(lat, lng, coordFormat);
    let popupContent = `<b>Cut-Away Start</b><br>`;
    if (coordFormat === 'MGRS') {
        popupContent += `MGRS: ${coords.lat}`;
    } else {
        popupContent += `Lat: ${coords.lat}<br>Lng: ${coords.lng}`;
    }
    if (!marker.getPopup()) {
        marker.bindPopup(popupContent);
    } else {
        marker.setPopupContent(popupContent);
    }
    if (open) {
        marker.openPopup();
    }
}
async function refreshMarkerPopup() {
    // 1. Sicherheitscheck: Gibt es überhaupt einen Marker zum Aktualisieren?
    if (!AppState.currentMarker || AppState.lastLat === null) {
        return;
    }

    // 2. Hier findet die gesamte Logik und Datensammlung statt!
    //    Wir greifen auf den globalen AppState zu, um die nötigen Infos zu holen.
    const lat = AppState.lastLat;
    const lng = AppState.lastLng;
    const altitude = AppState.lastAltitude;
    const coordFormat = getCoordinateFormat(); // Diese Funktion lebt in app.js
    const sliderIndex = getSliderValue();      // Diese auch

    const coords = Utils.convertCoords(lat, lng, coordFormat);

    // 3. Den Inhalt des Popups zusammenbauen.
    let popupContent;
    if (coordFormat === 'MGRS') {
        popupContent = `MGRS: ${coords.lat}<br>Alt: ${altitude} m`;
    } else {
        popupContent = `Lat: ${coords.lat}<br>Lng: ${coords.lng}<br>Alt: ${altitude} m`;
    }

    // Fügen Sie die QFE-Logik hinzu.
    if (AppState.weatherData && AppState.weatherData.surface_pressure) {
        const surfacePressure = AppState.weatherData.surface_pressure[sliderIndex];
        if (surfacePressure) {
            popupContent += ` QFE: ${surfacePressure.toFixed(0)} hPa`;
        } else {
            popupContent += ` QFE: N/A`;
        }
    } else {
        popupContent += ` QFE: N/A`;
    }

    // 4. Den "Maler" mit der fertigen "Bauanleitung" beauftragen.
    //    Wir übergeben den Marker, den wir aktualisieren wollen, und den fertigen Text.
    refreshMarkerPopup(AppState.currentMarker, popupContent);
}
function setupCoordinateEvents() {
    // Nur noch dieser Aufruf bleibt übrig.
    Coordinates.initializeLocationSearch();

    console.log("Coordinate events setup complete.");
}

// == Live Tracking Handling ==
export const debouncedPositionUpdate = Utils.debounce(async (position) => {
    if (!AppState.map) {
        console.warn('Map not initialized, cannot update position');
        return;
    }

    const { latitude, longitude, accuracy, altitude: deviceAltitude, altitudeAccuracy } = position.coords;
    const currentTime = new Date().getTime() / 1000;
    console.log('Debounced position update:', { latitude, longitude, accuracy, deviceAltitude, altitudeAccuracy, currentTime });

    // Optional: Filter out low-accuracy updates
    if (accuracy > 50) {
        console.log('Skipping position update due to low accuracy:', { accuracy });
        return;
    }

    let speed = 'N/A';
    let speedMs = 0;
    let effectiveWindUnit = getWindSpeedUnit();
    if (effectiveWindUnit === 'bft') {
        effectiveWindUnit = 'kt';
    }
    let direction = 'N/A';
    if (AppState.prevLat !== null && AppState.prevLng !== null && AppState.prevTime !== null) {
        const distance = AppState.map.distance([AppState.prevLat, AppState.prevLng], [latitude, longitude]);
        const timeDiff = currentTime - AppState.prevTime;
        if (timeDiff > 0) {
            speedMs = distance / timeDiff; // Speed in meters/second
            // Apply EMA smoothing with dynamic alpha
            const alpha = speedMs < 25 ? 0.5 : 0.2; // Responsive at low speeds, stable at high speeds
            AppState.lastSmoothedSpeedMs = alpha * speedMs + (1 - alpha) * AppState.lastSmoothedSpeedMs;
            speed = Utils.convertWind(AppState.lastSmoothedSpeedMs, effectiveWindUnit, 'm/s');
            speed = effectiveWindUnit === 'bft' ? Math.round(speed) : speed.toFixed(1);
            direction = Utils.calculateBearing(AppState.prevLat, AppState.prevLng, latitude, longitude).toFixed(0);
            console.log('Calculated speed:', { rawSpeedMs: speedMs, smoothedSpeedMs: AppState.lastSmoothedSpeedMs, convertedSpeed: speed, unit: effectiveWindUnit, alpha });
        }
    }

    if (!AppState.liveMarker) {
        AppState.liveMarker = createLiveMarker(latitude, longitude).addTo(AppState.map);
        console.log('Created new liveMarker at:', { latitude, longitude });
    } else {
        if (!AppState.map.hasLayer(AppState.liveMarker)) {
            AppState.liveMarker.addTo(AppState.map);
            console.log('Re-added liveMarker to map:', { latitude, longitude });
        }
        requestAnimationFrame(() => {
            AppState.liveMarker.setLatLng([latitude, longitude]);
            console.log('Updated liveMarker to:', { latitude, longitude });
        });
    }

    if (accuracy && Number.isFinite(accuracy) && accuracy > 0) {
        updateAccuracyCircle(latitude, longitude, accuracy);
    } else {
        console.warn('Skipping accuracy circle update: invalid accuracy', { accuracy });
        if (AppState.accuracyCircle) {
            AppState.map.removeLayer(AppState.accuracyCircle);
            AppState.accuracyCircle = null;
            console.log('Removed accuracy circle');
        }
    }

    let jumpMasterLineData = null;
    if (Settings.state.userSettings.showJumpMasterLine && AppState.liveMarker) {
        let targetMarker = null;
        let targetLat = null;
        let targetLng = null;
        if (Settings.state.userSettings.jumpMasterLineTarget === 'DIP' && AppState.currentMarker && AppState.lastLat !== null && AppState.lastLng !== null) {
            targetMarker = AppState.currentMarker;
            targetLat = AppState.lastLat;
            targetLng = AppState.lastLng;
        } else if (Settings.state.userSettings.jumpMasterLineTarget === 'HARP' && AppState.harpMarker && Settings.state.userSettings.harpLat !== null && Settings.state.userSettings.harpLng !== null) {
            targetMarker = AppState.harpMarker;
            targetLat = Settings.state.userSettings.harpLat;
            targetLng = Settings.state.userSettings.harpLng;
        }

        if (targetMarker) {
            try {
                const liveLatLng = AppState.liveMarker.getLatLng();
                const targetLatLng = targetMarker.getLatLng();
                const bearing = Utils.calculateBearing(liveLatLng.lat, liveLatLng.lng, targetLatLng.lat, targetLatLng.lng).toFixed(0);
                const distanceMeters = AppState.map.distance(liveLatLng, targetLatLng);
                const heightUnit = getHeightUnit();
                const convertedDistance = Utils.convertHeight(distanceMeters, heightUnit);
                const roundedDistance = Math.round(convertedDistance);

                let totDisplay = 'N/A';
                if (AppState.lastSmoothedSpeedMs > 0) {
                    const totSeconds = distanceMeters / AppState.lastSmoothedSpeedMs;
                    totDisplay = Math.round(totSeconds);
                    console.log('Calculated TOT:', { distanceMeters, smoothedSpeedMs: AppState.lastSmoothedSpeedMs, totSeconds, totDisplay });
                } else {
                    console.log('TOT set to N/A: invalid or zero speed', { smoothedSpeedMs: AppState.lastSmoothedSpeedMs });
                }

                jumpMasterLineData = {
                    target: Settings.state.userSettings.jumpMasterLineTarget,
                    bearing,
                    distance: roundedDistance,
                    tot: totDisplay,
                    heightUnit
                };

                if (AppState.jumpMasterLine) {
                    AppState.jumpMasterLine.setLatLngs([[liveLatLng.lat, liveLatLng.lng], [targetLatLng.lat, targetLatLng.lng]]);
                    console.log(`Updated Jump Master Line to ${Settings.state.userSettings.jumpMasterLineTarget}:`, { bearing, distance: roundedDistance, unit: heightUnit, tot: totDisplay });
                } else {
                    AppState.jumpMasterLine = L.polyline([[liveLatLng.lat, liveLatLng.lng], [targetLatLng.lat, targetLatLng.lng]], {
                        color: 'blue',
                        weight: 3,
                        opacity: 0.8,
                        dashArray: '5, 5'
                    }).addTo(AppState.map);
                    console.log(`Created Jump Master Line to ${Settings.state.userSettings.jumpMasterLineTarget}:`, { bearing, distance: roundedDistance, unit: heightUnit, tot: totDisplay });
                }
            } catch (error) {
                console.error('Error updating Jump Master Line:', error);
            }
        } else {
            if (AppState.jumpMasterLine) {
                AppState.map.removeLayer(AppState.jumpMasterLine);
                AppState.jumpMasterLine = null;
                console.log(`Removed Jump Master Line: no valid target (${Settings.state.userSettings.jumpMasterLineTarget})`);
            }
        }
    } else {
        if (AppState.jumpMasterLine) {
            AppState.map.removeLayer(AppState.jumpMasterLine);
            AppState.jumpMasterLine = null;
            console.log('Removed Jump Master Line: disabled or no liveMarker');
        }
    }

    if (AppState.livePositionControl) {
        AppState.livePositionControl.update(
            latitude,
            longitude,
            deviceAltitude,
            altitudeAccuracy,
            accuracy,
            speed,
            effectiveWindUnit,
            direction,
            Settings.state.userSettings.showJumpMasterLine,
            jumpMasterLineData
        );
        console.log('Updated livePositionControl content:', {
            latitude,
            longitude,
            deviceAltitude,
            altitudeAccuracy,
            accuracy,
            speed,
            effectiveWindUnit,
            direction,
            showJumpMasterLine: Settings.state.userSettings.showJumpMasterLine,
            jumpMasterLineData
        });
        AppState.livePositionControl._container.style.display = 'block';
        AppState.livePositionControl._container.style.opacity = '1';
        AppState.livePositionControl._container.style.visibility = 'visible';
    } else {
        console.warn('livePositionControl not initialized in debouncedPositionUpdate');
    }

    AppState.lastLatitude = latitude;
    AppState.lastLongitude = longitude;
    AppState.lastDeviceAltitude = deviceAltitude;
    AppState.lastAltitudeAccuracy = altitudeAccuracy;
    AppState.lastAccuracy = accuracy;
    AppState.lastSpeed = speed;
    AppState.lastEffectiveWindUnit = effectiveWindUnit;
    AppState.lastDirection = direction;
    console.log('Stored last position data:', { lastLatitude: AppState.lastLatitude, lastLongitude: AppState.lastLongitude, lastDeviceAltitude: AppState.lastDeviceAltitude, lastAltitudeAccuracy: AppState.lastAltitudeAccuracy, lastAccuracy: AppState.lastAccuracy, lastSpeed: AppState.lastSpeed, lastEffectiveWindUnit: AppState.lastEffectiveWindUnit, lastDirection: AppState.lastDirection });

    AppState.prevLat = latitude;
    AppState.prevLng = longitude;
    AppState.prevTime = currentTime;
}, 300);
L.Control.LivePosition = L.Control.extend({
    options: {
        position: 'bottomright'
    },
    onAdd: function (map) {
        const container = L.DomUtil.create('div', 'leaflet-control-live-position');
        container.style.display = 'block';
        container.style.zIndex = '600';
        container.innerHTML = 'Initializing live position...';
        this._container = container;
        console.log('LivePosition control added to map', { styles: container.style });
        return container;
    },
    update: function (lat, lng, deviceAltitude, altitudeAccuracy, accuracy, speed, effectiveWindUnit, direction, showJumpMasterLine, jumpMasterLineData) {
        try {
            const coordFormat = getCoordinateFormat();
            const coords = Utils.convertCoords(lat, lng, coordFormat);
            const heightUnit = getHeightUnit();
            const refLevel = Settings.getValue('refLevel', 'radio', 'AGL');
            let content = `<span style="font-weight: bold;">Live Position</span><br>`;
            if (coordFormat === 'MGRS') {
                content += `MGRS: ${coords.lat}<br>`;
            } else {
                content += `Lat: ${coords.lat}<br>Lng: ${coords.lng}<br>`;
            }
            if (deviceAltitude !== null && deviceAltitude !== undefined) {
                let displayAltitude;
                let displayRefLevel = refLevel;
                if (refLevel === 'AGL' && AppState.lastAltitude !== null && !isNaN(AppState.lastAltitude)) {
                    displayAltitude = deviceAltitude - parseFloat(AppState.lastAltitude);
                    displayRefLevel = 'abv DIP';
                } else {
                    displayAltitude = deviceAltitude;
                }
                const convertedAltitude = Utils.convertHeight(displayAltitude, heightUnit);
                const convertedAltitudeAccuracy = altitudeAccuracy && Number.isFinite(altitudeAccuracy) && altitudeAccuracy > 0
                    ? Utils.convertHeight(altitudeAccuracy, heightUnit)
                    : 'N/A';
                content += `Altitude: ${Math.round(convertedAltitude)} ${heightUnit} ${displayRefLevel} (±${convertedAltitudeAccuracy !== 'N/A' ? Math.round(convertedAltitudeAccuracy) : 'N/A'} ${convertedAltitudeAccuracy !== 'N/A' ? heightUnit : ''})<br>`;
            } else {
                content += `Altitude: N/A<br>`;
            }
            const convertedAccuracy = accuracy && Number.isFinite(accuracy) ? Utils.convertHeight(accuracy, heightUnit) : 'N/A';
            content += `Accuracy: ${convertedAccuracy !== 'N/A' ? Math.round(convertedAccuracy) : 'N/A'} ${convertedAccuracy !== 'N/A' ? heightUnit : ''}<br>`;
            content += `Speed: ${speed} ${effectiveWindUnit}<br>`;
            content += `Direction: ${direction}°`;

            if (showJumpMasterLine && jumpMasterLineData) {
                content += `<br><span style="font-weight: bold;">Jump Master Line to ${jumpMasterLineData.target}</span><br>`;
                content += `Bearing: ${jumpMasterLineData.bearing}°<br>`;
                content += `Distance: ${jumpMasterLineData.distance} ${jumpMasterLineData.heightUnit}<br>`;
                if (jumpMasterLineData.tot < 1200) {
                    content += `TOT: X - ${jumpMasterLineData.tot} s`;
                } else {
                    content += `TOT: N/A`;
                }
            }

            this._container.innerHTML = content;
            this._container.style.display = 'block';
            this._container.style.opacity = '1';
            this._container.style.visibility = 'visible';
            console.log('Updated livePositionControl content:', { content });
        } catch (error) {
            console.error('Error updating livePositionControl:', error);
            this._container.innerHTML = 'Error updating live position';
            this._container.style.display = 'block';
        }
    },
    onRemove: function (map) {
        console.log('LivePosition control removed from map');
    }
});
L.control.livePosition = function (opts) {
    return new L.Control.LivePosition(opts);
};
function createLiveMarker(lat, lng) {
    const marker = L.marker([lat, lng], {
        icon: L.divIcon({
            className: 'live-marker',
            html: '<div style="background-color: blue; width: 10px; height: 10px; border-radius: 50%;"></div>',
            iconSize: [10, 10],
            iconAnchor: [5, 5]
        }),
        zIndexOffset: 100
    });
    console.log('Created liveMarker:', { lat, lng });
    return marker;
}
function updateLiveMarkerPopup(marker, lat, lng, terrainAltitude, deviceAltitude, altitudeAccuracy, accuracy, speed, direction, open = false) {
    const coordFormat = getCoordinateFormat();
    const coords = Utils.convertCoords(lat, lng, coordFormat);
    const windUnit = getWindSpeedUnit();
    const heightUnit = getHeightUnit();
    let popupContent = `<b>Live Position</b><br>`;
    if (coordFormat === 'MGRS') {
        popupContent += `MGRS: ${coords.lat}<br>`;
    } else {
        popupContent += `Lat: ${coords.lat}<br>Lng: ${coords.lng}<br>`;
    }

    if (deviceAltitude !== null && deviceAltitude !== undefined) {
        const deviceAlt = Utils.convertHeight(deviceAltitude, heightUnit);
        popupContent += `Device Alt: ${Math.round(deviceAlt)} ${heightUnit} MSL (±${Math.round(altitudeAccuracy || 0)} m)<br>`;
        if (terrainAltitude !== 'N/A') {
            const agl = Utils.convertHeight(deviceAltitude - terrainAltitude, heightUnit);
            popupContent += `AGL: ${Math.round(agl)} ${heightUnit}<br>`;
        } else {
            popupContent += `AGL: N/A<br>`;
        }
    } else {
        popupContent += `Device Alt: N/A<br>`;
        popupContent += `AGL: N/A<br>`;
    }

    const terrainAlt = terrainAltitude !== 'N/A' ? Utils.convertHeight(terrainAltitude, heightUnit) : 'N/A';
    popupContent += `Terrain Alt: ${terrainAlt !== 'N/A' ? Math.round(terrainAlt) : 'N/A'} ${heightUnit}<br>`;

    popupContent += `Accuracy: ${Math.round(accuracy)} m<br>`;
    popupContent += `Speed: ${speed} ${windUnit}<br>`;
    popupContent += `Direction: ${direction}°`;

    // Rebind popup to ensure fresh state
    marker.unbindPopup();
    marker.bindPopup(popupContent);
    console.log('Rebound liveMarker popup with content:', { popupContent, open });

    marker._accuracy = accuracy;
    marker._speed = speed;
    marker._direction = direction;
    marker._deviceAltitude = deviceAltitude;
    marker._altitudeAccuracy = altitudeAccuracy;

    if (open) {
        console.log('Attempting to open liveMarker popup');
        marker.openPopup();
        const isOpen = marker.getPopup()?.isOpen();
        console.log('LiveMarker popup open status after openPopup():', isOpen);
        if (!isOpen) {
            console.warn('LiveMarker popup failed to open, retrying');
            marker.openPopup();
        }
    }
}
function updateLivePositionControl() {
    if (!AppState.livePositionControl || AppState.lastLatitude === null || AppState.lastLongitude === null) {
        console.log('Skipping livePositionControl update: no control or position data', { livePositionControl: !!AppState.livePositionControl, lastLatitude: AppState.lastLatitude });
        return;
    }
    try {
        console.log('Updating livePositionControl with last position data');
        // Recalculate speed for current windUnit
        let newSpeed = AppState.lastSpeed;
        let newEffectiveWindUnit = getWindSpeedUnit();
        if (newEffectiveWindUnit === 'bft') {
            newEffectiveWindUnit = 'kt';
        }
        if (AppState.lastSpeed !== 'N/A' && Number.isFinite(parseFloat(AppState.lastSpeed))) {
            const speedMs = Utils.convertWind(parseFloat(AppState.lastSpeed), 'm/s', AppState.lastEffectiveWindUnit);
            newSpeed = Utils.convertWind(speedMs, newEffectiveWindUnit, 'm/s');
            newSpeed = newEffectiveWindUnit === 'bft' ? Math.round(newSpeed) : newSpeed.toFixed(1);
        }
        AppState.livePositionControl.update(
            AppState.lastLatitude,
            AppState.lastLongitude,
            AppState.lastDeviceAltitude,
            AppState.lastAltitudeAccuracy,
            AppState.lastAccuracy,
            newSpeed,
            newEffectiveWindUnit,
            AppState.lastDirection
        );
        AppState.lastSpeed = newSpeed;
        AppState.lastEffectiveWindUnit = newEffectiveWindUnit;
        console.log('Updated livePositionControl:', { newSpeed, newEffectiveWindUnit });
    } catch (error) {
        console.error('Error updating livePositionControl:', error);
    }
}
function startPositionTracking() {
    console.log('startPositionTracking called');
    if (!navigator.geolocation) {
        Utils.handleError('Geolocation not supported by your browser. Please use a device with location services.');
        setCheckboxValue('trackPositionCheckbox', false);
        Settings.state.userSettings.trackPosition = false;
        Settings.save();
        console.warn('Geolocation not supported');
        return;
    }

    if (!AppState.map) {
        Utils.handleError('Map not initialized. Please try again.');
        setCheckboxValue('trackPositionCheckbox', false);
        Settings.state.userSettings.trackPosition = false;
        Settings.save();
        console.warn('Map not initialized');
        return;
    }

    // Clear any existing watch to prevent conflicts
    if (AppState.watchId !== null) {
        navigator.geolocation.clearWatch(AppState.watchId);
        AppState.watchId = null;
        console.log('Cleared existing geolocation watch');
    }

    try {
        AppState.watchId = navigator.geolocation.watchPosition(
            (position) => {
                console.log('Geolocation position received:', position);
                debouncedPositionUpdate(position);
            },
            (error) => {
                console.error('Geolocation error:', error);
                Utils.handleError(`Geolocation error: ${error.message}`);
                setCheckboxValue('trackPositionCheckbox', false);
                Settings.state.userSettings.trackPosition = false;
                Settings.save();
                stopPositionTracking();
            },
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 10000
            }
        );
        console.log('Started geolocation watch with watchId:', AppState.watchId);

        // Ensure livePositionControl is visible
        if (AppState.livePositionControl) {
            AppState.livePositionControl._container.style.display = 'block';
            AppState.livePositionControl._container.style.opacity = '1';
            AppState.livePositionControl._container.style.visibility = 'visible';
            console.log('Ensured livePositionControl is visible');
        } else {
            console.warn('livePositionControl not initialized in startPositionTracking');
            AppState.livePositionControl = L.control.livePosition({ position: 'bottomright' }).addTo(AppState.map);
            console.log('Reinitialized livePositionControl');
        }
    } catch (error) {
        console.error('Error starting position tracking:', error);
        Utils.handleError('Failed to start position tracking.');
        setCheckboxValue('trackPositionCheckbox', false);
        Settings.state.userSettings.trackPosition = false;
        Settings.save();
        stopPositionTracking();
    }
}
function stopPositionTracking() {
    if (!AppState.map) {
        console.warn('Map not initialized, cannot stop position tracking');
        return;
    }

    if (AppState.watchId !== null) {
        navigator.geolocation.clearWatch(AppState.watchId);
        AppState.watchId = null;
        console.log('Stopped geolocation watch');
    }
    if (AppState.liveMarker) {
        AppState.map.removeLayer(AppState.liveMarker);
        AppState.liveMarker = null;
        console.log('Removed liveMarker');
    }
    if (AppState.accuracyCircle) {
        AppState.map.removeLayer(AppState.accuracyCircle);
        AppState.accuracyCircle = null;
        console.log('Removed accuracy circle');
    }
    if (AppState.livePositionControl) {
        AppState.livePositionControl._container.innerHTML = 'Initializing live position...';
        AppState.livePositionControl._container.style.display = 'none';
        console.log('Hid livePositionControl and reset content');
    } else {
        console.warn('livePositionControl not found in stopPositionTracking');
    }
    AppState.prevLat = null;
    AppState.prevLng = null;
    AppState.prevTime = null;
    AppState.lastSpeed = 'N/A';
    AppState.lastDirection = 'N/A';
    console.log('Cleared tracking data');
}
function updateAccuracyCircle(lat, lng, accuracy) {
    try {
        if (AppState.accuracyCircle) {
            AppState.map.removeLayer(AppState.accuracyCircle);
            AppState.accuracyCircle = null;
            console.log('Removed previous accuracy circle');
        }
        AppState.accuracyCircle = L.circle([lat, lng], {
            radius: accuracy,
            color: 'blue',
            fillOpacity: 0.1,
            weight: 1,
            dashArray: '5, 5',
            zIndexOffset: 200 // Ensure above other layers
        }).addTo(AppState.map);
        console.log('Updated accuracy circle:', { lat, lng, radius: accuracy });
    } catch (error) {
        console.error('Error updating accuracy circle:', error);
        if (AppState.accuracyCircle) {
            AppState.map.removeLayer(AppState.accuracyCircle);
            AppState.accuracyCircle = null;
        }
    }
}
function updateJumpMasterLine() {
    // Check preconditions
    if (
        !Settings.state.userSettings.showJumpMasterLine ||
        !Settings.state.userSettings.trackPosition ||
        !AppState.liveMarker ||
        !AppState.map
    ) {
        if (AppState.jumpMasterLine) {
            AppState.map.removeLayer(AppState.jumpMasterLine);
            AppState.jumpMasterLine = null;
            console.log('Removed Jump Master Line: preconditions not met');
        }
        return;
    }

    const liveLatLng = AppState.liveMarker.getLatLng();
    let targetLat, targetLng;
    let targetType = Settings.state.userSettings.jumpMasterLineTarget;

    // Check if HARP is selected but coordinates are invalid
    if (targetType === 'HARP') {
        const { harpLat, harpLng } = Settings.state.userSettings;
        if (
            harpLat === null ||
            harpLng === null ||
            typeof harpLat !== 'number' ||
            typeof harpLng !== 'number' ||
            harpLat < -90 ||
            harpLat > 90 ||
            harpLng < -180 ||
            harpLng > 180
        ) {
            console.log('HARP coordinates invalid, falling back to DIP');
            targetType = 'DIP';
            // Optionally update settings to reflect fallback
            Settings.state.userSettings.jumpMasterLineTarget = 'DIP';
            Settings.save();
        }
    }

    if (targetType === 'HARP') {
        targetLat = Settings.state.userSettings.harpLat;
        targetLng = Settings.state.userSettings.harpLng;
        console.log('Drawing Jump Master Line to HARP:', { targetLat, targetLng });
    } else if (targetType === 'DIP') {
        if (AppState.currentMarker) {
            const dipLatLng = AppState.currentMarker.getLatLng();
            targetLat = dipLatLng.lat;
            targetLng = dipLatLng.lng;
            console.log('Drawing Jump Master Line to DIP using currentMarker:', { targetLat, targetLng });
        } else if (AppState.lastLat !== null && AppState.lastLng !== null) {
            targetLat = AppState.lastLat;
            targetLng = AppState.lastLng;
            console.log('Drawing Jump Master Line to DIP using lastLat/lastLng:', { targetLat, targetLng });
        } else {
            console.log('Cannot draw Jump Master Line: no DIP position set');
            return;
        }
    } else {
        console.log('Cannot draw Jump Master Line: invalid target');
        return;
    }

    const bearing = Utils.calculateBearing(liveLatLng.lat, liveLatLng.lng, targetLat, targetLng).toFixed(0);
    const distanceMeters = AppState.map.distance(liveLatLng, [targetLat, targetLng]);
    const heightUnit = getHeightUnit();
    const convertedDistance = Utils.convertHeight(distanceMeters, heightUnit);
    const roundedDistance = Math.round(convertedDistance);

    if (AppState.jumpMasterLine) {
        AppState.jumpMasterLine.setLatLngs([[liveLatLng.lat, liveLatLng.lng], [targetLat, targetLng]]);
        AppState.jumpMasterLine.setPopupContent(
            `<b>Jump Master Line</b><br>Bearing: ${bearing}°<br>Distance: ${roundedDistance} ${heightUnit}`
        );
        console.log('Updated Jump Master Line:', { bearing, distance: roundedDistance, unit: heightUnit });
    } else {
        AppState.jumpMasterLine = L.polyline([[liveLatLng.lat, liveLatLng.lng], [targetLat, targetLng]], {
            color: 'blue',
            weight: 3,
            dashArray: '5, 10'
        }).addTo(AppState.map);
        AppState.jumpMasterLine.bindPopup(
            `<b>Jump Master Line</b><br>Bearing: ${bearing}°<br>Distance: ${roundedDistance} ${heightUnit}`
        );
        console.log('Created Jump Master Line:', { bearing, distance: roundedDistance, unit: heightUnit });
    }

    if (AppState.livePositionControl) {
        AppState.livePositionControl.update(
            liveLatLng.lat,
            liveLatLng.lng,
            AppState.lastDeviceAltitude,
            AppState.lastAltitudeAccuracy,
            AppState.lastAccuracy,
            AppState.lastSpeed,
            AppState.lastEffectiveWindUnit,
            AppState.lastDirection,
            true,
            { bearing, distance: roundedDistance, unit: heightUnit }
        );
    }
}


// == Weather Data Handling ==
export async function checkAvailableModels(lat, lon) {
    console.log(`[checkAvailableModels] Starting for lat: ${lat}, lon: ${lon}`);
    const modelList = [
        'icon_seamless', 'icon_global', 'icon_eu', 'icon_d2', 'ecmwf_ifs025', 'ecmwf_aifs025_single', 'gfs_seamless', 'gfs_global', 'gfs_hrrr', 'arome_france', 'gem_hrdps_continental', 'gem_regional'
    ];
    let availableModels = [];

    for (const model of modelList) {
        const apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&models=${model}`;
        // console.log(`[checkAvailableModels] Checking model: ${model} with URL: ${apiUrl}`); // Kann für detailliertes Debugging aktiviert bleiben
        try {
            const response = await fetch(apiUrl);
            // console.log(`[checkAvailableModels] Response status for ${model}: ${response.status}`);

            if (response.ok) { // Status 200-299
                const data = await response.json();
                // console.log(`[checkAvailableModels] Data for ${model}:`, data); // Kann für detailliertes Debugging aktiviert bleiben

                if (data.hourly && data.hourly.temperature_2m && data.hourly.temperature_2m.length > 0) {
                    // *** VERBESSERTE PRÜFUNG: Sicherstellen, dass das Array nicht nur aus null-Werten besteht ***
                    const hasActualNumericData = data.hourly.temperature_2m.some(temp => temp !== null && !isNaN(parseFloat(temp)));

                    if (hasActualNumericData) {
                        availableModels.push(model);
                        // console.log(`[checkAvailableModels] Model ${model} ADDED to availableModels. Current list:`, availableModels);
                    } else {
                        console.log(`[checkAvailableModels] Model ${model} (HTTP 200 OK) returned an array for temperature_2m, but it contained no valid numeric data (e.g., all nulls or non-numeric). Considered unavailable. Data sample:`, data.hourly.temperature_2m.slice(0, 5));
                    }
                } else {
                    // Model gab HTTP 200 OK, aber die Struktur data.hourly.temperature_2m war nicht wie erwartet (fehlt, leer, etc.)
                    // Oder hourly_units.temperature_2m war "undefined", was ein starker Indikator ist.
                    if (data.hourly_units && data.hourly_units.temperature_2m === "undefined") {
                        console.log(`[checkAvailableModels] Model ${model} (HTTP 200 OK) has temperature_2m unit "undefined". Considered unavailable.`);
                    } else {
                        console.log(`[checkAvailableModels] Model ${model} (HTTP 200 OK) but no valid hourly data structure. Hourly data:`, data.hourly);
                    }
                }
            } else if (response.status === 400) {
                // Erwarteter Fehler, Modell nicht verfügbar für Koordinaten
                console.info(`[checkAvailableModels] Model ${model} not available (HTTP 400 - Bad Request). This is expected for some models/locations.`);
            } else {
                // Andere HTTP-Fehler
                const errorText = await response.text().catch(() => `Could not retrieve error text from response for model ${model}.`);
                console.warn(`[checkAvailableModels] Problem checking model ${model}: HTTP ${response.status} - ${errorText}`);
            }
        } catch (error) {
            /* istanbul ignore next */ // Diese Zeile ist spezifisch für Test-Coverage-Tools wie Istanbul/NYC.js
            console.warn(`[checkAvailableModels] Network error or other issue checking model ${model}: ${error.message}`);
        }
    }

    // ---- UI Aktualisierung für Haupt-Modellauswahl (modelSelect) ----
    const modelSelect = document.getElementById('modelSelect');
    if (modelSelect) {
        const currentSelectedModelInDropdown = modelSelect.value;
        modelSelect.innerHTML = ''; // Alte Optionen entfernen

        if (availableModels.length === 0) {
            const option = document.createElement('option');
            option.value = "";
            option.textContent = "No models available";
            option.disabled = true;
            modelSelect.appendChild(option);
            modelSelect.value = "";
        } else {
            availableModels.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model.replace(/_/g, ' ').toUpperCase();
                modelSelect.appendChild(option);
            });

            const storedPrimaryModel = Settings.state.userSettings.model;
            if (availableModels.includes(storedPrimaryModel)) {
                modelSelect.value = storedPrimaryModel;
            } else if (availableModels.includes(currentSelectedModelInDropdown)) {
                modelSelect.value = currentSelectedModelInDropdown;
            } else if (availableModels.length > 0) {
                modelSelect.value = availableModels[0];
                // Wichtig: Wenn das primär ausgewählte Modell geändert werden muss,
                // sollte Settings.state.userSettings.model auch aktualisiert werden.
                if (Settings.state.userSettings.model !== modelSelect.value) {
                    console.log(`[checkAvailableModels] Primary model '${Settings.state.userSettings.model}' no longer available or invalid. Switched to '${modelSelect.value}'.`);
                    Settings.state.userSettings.model = modelSelect.value;
                    Settings.save(); // Speichere die Änderung des primären Modells
                    // Ein change Event manuell auslösen, damit fetchWeather für das neue primäre Modell geladen wird
                    // Dies ist wichtig, wenn das vorherige primäre Modell nicht mehr verfügbar ist.
                    modelSelect.dispatchEvent(new Event('change'));
                }
            }
        }
    } else {
        console.warn("[checkAvailableModels] Element with ID 'modelSelect' not found.");
    }


    // ---- UI Aktualisierung für Ensemble-Modellauswahl (ensembleModelsSubmenu) ----
    const ensembleModelsSubmenu = document.getElementById('ensembleModelsSubmenu');
    if (ensembleModelsSubmenu) {
        ensembleModelsSubmenu.innerHTML = ''; // Alte Checkboxen entfernen

        if (availableModels.length === 0) {
            const li = document.createElement('li');
            li.textContent = "No models available";
            ensembleModelsSubmenu.appendChild(li);
        } else {
            availableModels.forEach(model => {
                const li = document.createElement('li');
                const label = document.createElement('label');
                label.className = 'radio-label';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.name = 'ensembleModel';
                checkbox.value = model;
                checkbox.checked = Settings.state.userSettings.selectedEnsembleModels.includes(model);

                checkbox.addEventListener('change', () => {
                    const currentSelected = Settings.state.userSettings.selectedEnsembleModels || [];
                    if (checkbox.checked) {
                        if (!currentSelected.includes(model)) {
                            Settings.state.userSettings.selectedEnsembleModels.push(model);
                        }
                    } else {
                        Settings.state.userSettings.selectedEnsembleModels = currentSelected.filter(m => m !== model);
                    }
                    Settings.save();
                    console.log('[checkAvailableModels] Ensemble selection changed by user. New selection:', Settings.state.userSettings.selectedEnsembleModels);
                    fetchEnsembleWeatherData();
                });

                label.appendChild(checkbox);
                label.appendChild(document.createTextNode(` ${model.replace(/_/g, ' ').toUpperCase()}`));
                li.appendChild(label);
                ensembleModelsSubmenu.appendChild(li);
            });
        }
    } else {
        console.warn("[checkAvailableModels] Element with ID 'ensembleModelsSubmenu' not found.");
    }

    // ---- Bereinigung der in Settings gespeicherten Ensemble-Auswahl ----
    let currentSelectedEnsembleModels = Settings.state.userSettings.selectedEnsembleModels || [];
    const originalSelectedCount = currentSelectedEnsembleModels.length;

    const updatedSelectedEnsembleModels = currentSelectedEnsembleModels.filter(model => availableModels.includes(model));

    if (updatedSelectedEnsembleModels.length !== originalSelectedCount) {
        console.log('[checkAvailableModels] Some previously selected ensemble models are no longer available. Updating selection.');
        Settings.state.userSettings.selectedEnsembleModels = updatedSelectedEnsembleModels;
        Settings.save();
        console.log('[checkAvailableModels] Updated selectedEnsembleModels in Settings:', updatedSelectedEnsembleModels);

        // UI der Checkboxen erneut explizit synchronisieren (obwohl sie oben neu gezeichnet wurden, ist dies eine doppelte Sicherheit)
        const ensembleCheckboxes = document.querySelectorAll('#ensembleModelsSubmenu input[name="ensembleModel"]');
        ensembleCheckboxes.forEach(cb => {
            cb.checked = updatedSelectedEnsembleModels.includes(cb.value);
        });

        if (updatedSelectedEnsembleModels.length > 0) {
            fetchEnsembleWeatherData();
        } else {
            AppState.ensembleModelsData = null;
            clearEnsembleVisualizations();
            console.log("[checkAvailableModels] No ensemble models left selected or available after cleanup.");
        }
    } else {
        // Auswahl hat sich nicht geändert, aber Position könnte sich geändert haben.
        // Wenn Modelle ausgewählt sind, deren Daten für die neue Position laden.
        if (Settings.state.userSettings.selectedEnsembleModels && Settings.state.userSettings.selectedEnsembleModels.length > 0) {
            console.log("[checkAvailableModels] Selected ensemble models are still available at the new location. Ensuring data is fetched for the new location.");
            fetchEnsembleWeatherData();
        }
    }

    console.log('[checkAvailableModels] Finished. Final effective available models:', availableModels);
    return availableModels;
}
async function fetchWeatherForLocation(lat, lng, currentTime = null, isInitialLoad = false) {
    console.log('fetchWeatherForLocation called:', { lat, lng, currentTime, isInitialLoad });
    const loadingElement = document.getElementById('loading');
    const infoElement = document.getElementById('info');

    if (loadingElement) loadingElement.style.display = 'block';
    if (infoElement) infoElement.innerHTML = `Fetching weather and models...`;

    try {
        const availableModels = await checkAvailableModels(lat, lng);
        // UI-Updates für modelSelect und infoElement sollten hier oder in einer dedizierten UI-Funktion erfolgen
        const modelSelect = document.getElementById('modelSelect');
        if (modelSelect) {
            const currentSelectedModel = modelSelect.value;
            modelSelect.innerHTML = '';
            if (availableModels.length === 0) {
                const option = document.createElement('option'); option.value = ""; option.textContent = "No models available"; option.disabled = true; modelSelect.appendChild(option); modelSelect.value = "";
            } else {
                availableModels.forEach(model => { const option = document.createElement('option'); option.value = model; option.textContent = model.replace(/_/g, ' ').toUpperCase(); modelSelect.appendChild(option); });
                const storedModel = Settings.state.userSettings.model;
                if (availableModels.includes(storedModel)) modelSelect.value = storedModel;
                else if (availableModels.includes(currentSelectedModel)) modelSelect.value = currentSelectedModel;
                else if (availableModels.length > 0) { modelSelect.value = availableModels[0]; Settings.state.userSettings.model = availableModels[0]; Settings.save(); }
            }
        }
        if (infoElement) {
            const modelDisplay = availableModels.length > 0 ? `<br><strong>Available Models:</strong><ul>${availableModels.map(m => `<li>${m.replace(/_/g, ' ').toUpperCase()}</li>`).join('')}</ul>` : '<br><strong>Available Models:</strong> None';
            const modelDisplayRegex = /(<br><strong>Available Models:<\/strong><ul>.*?<\/ul>|<br><strong>Available Models:<\/strong> None)/s;
            if (modelDisplayRegex.test(infoElement.innerHTML)) infoElement.innerHTML = infoElement.innerHTML.replace(modelDisplayRegex, modelDisplay);
            else infoElement.innerHTML += modelDisplay;
        }

        if (availableModels.length > 0) {
            AppState.lastLat = lat; AppState.lastLng = lng;
            await fetchWeather(lat, lng, currentTime, isInitialLoad); // currentTime wird weitergegeben
            Settings.updateModelRunInfo(AppState.lastModelRun, AppState.lastLat, AppState.lastLng);
            if (AppState.lastAltitude !== 'N/A') {
                calculateMeanWind();
                if (Settings.state.userSettings.calculateJump) { debouncedCalculateJump(); JumpPlanner.calculateCutAway(); }
            }
            if (Settings.state.userSettings.showLandingPattern) updateLandingPatternDisplay();
        } else {
            if (infoElement) infoElement.innerHTML = `No models available.`;
            Settings.updateModelRunInfo(null, lat, lng);
        }
    } catch (error) /* istanbul ignore next */ {
        Utils.handleError('Failed to fetch weather data for location', { error: error.message, lat, lng });
        if (infoElement) infoElement.innerHTML = `Failed to fetch weather data.`;
        Settings.updateModelRunInfo(null, lat, lng);
    } finally {
        if (loadingElement) loadingElement.style.display = 'none';
        // restoreUIInteractivity(); // Ggf. aufrufen
    }
}
export async function fetchWeather(lat, lon, currentTime = null, isInitialLoad = false) {
    const loadingElement = document.getElementById('loading');
    if (loadingElement) loadingElement.style.display = 'block';
    console.log(`[fetchWeather] Called for lat: ${lat}, lon: ${lon}, currentTime: ${currentTime}, isInitialLoad: ${isInitialLoad}`);

    try {
        const modelSelect = document.getElementById('modelSelect');
        // Verwende den Wert aus dem Dropdown oder einen Default, falls das Dropdown noch nicht initialisiert ist.
        const selectedModelValue = modelSelect ? modelSelect.value : Settings.defaultSettings.model;

        if (!selectedModelValue) {
            console.warn("[fetchWeather] No model selected in dropdown or default settings. Aborting fetchWeather.");
            Utils.handleError("No weather model selected to fetch data.");
            if (loadingElement) loadingElement.style.display = 'none';
            return;
        }

        // Die korrekte modelMap zur Umwandlung der Dropdown-Werte in API-spezifische Identifier für Meta-Daten
        const modelMap = {
            'icon_seamless': 'dwd_icon',
            'icon_global': 'dwd_icon',
            'icon_eu': 'dwd_icon_eu',
            'icon_d2': 'dwd_icon_d2',
            'ecmwf_ifs025': 'ecmwf_ifs025',
            'ecmwf_aifs025_single': 'ecmwf_aifs025_single',
            'gfs_seamless': 'ncep_gfs013',
            'gfs_global': 'ncep_gfs025',
            'gfs_hrrr': 'ncep_hrrr_conus',
            'arome_france': 'meteofrance_arome_france0025',
            'gem_hrdps_continental': 'cmc_gem_hrdps',
            'gem_regional': 'cmc_gem_rdps'
        };

        // Korrekter Identifier für den Meta-Daten-Abruf
        const modelApiIdentifierForMeta = modelMap[selectedModelValue] || selectedModelValue;
        // Für den Haupt-Forecast-API-Call wird `selectedModelValue` direkt verwendet,
        // da der `models`-Parameter der Forecast-API die allgemeinen Namen (z.B. "icon_global") erwartet.

        console.log(`[fetchWeather] Using model (for forecast API): '${selectedModelValue}', Meta API identifier: '${modelApiIdentifierForMeta}'`);

        let isHistorical = false;
        let startDateStr, endDateStr;
        let targetDateForAPI = null;
        const today = luxon.DateTime.utc().startOf('day');

        // Logik zur Bestimmung, ob historische Daten oder Forecast benötigt werden
        // und Setzen von targetDateForAPI
        if (currentTime) {
            let parsedCurrentTime = null;
            if (typeof currentTime === 'string' && currentTime.includes('GMT')) {
                const match = currentTime.match(/^(\d{4}-\d{2}-\d{2})\s(\d{2})(\d{2})\sGMT([+-]\d{1,2})$/);
                if (match) {
                    const [, dateStrParse, hourStr, minuteStr, offset] = match;
                    const formattedOffset = `${offset.startsWith('+') ? '+' : '-'}${Math.abs(parseInt(offset, 10)).toString().padStart(2, '0')}:00`;
                    const isoString = `${dateStrParse}T${hourStr}:${minuteStr}:00${formattedOffset}`;
                    parsedCurrentTime = luxon.DateTime.fromISO(isoString, { zone: 'utc' });
                }
            } else {
                parsedCurrentTime = luxon.DateTime.fromISO(currentTime, { zone: 'utc' });
            }
            if (parsedCurrentTime && parsedCurrentTime.isValid) {
                targetDateForAPI = parsedCurrentTime.startOf('day'); // Nur das Datum für den API Call
                if (targetDateForAPI < today) isHistorical = true;
            }
        }

        if (!isHistorical) { // Nur prüfen, wenn nicht schon durch currentTime als historisch markiert
            const historicalDatePicker = document.getElementById('historicalDatePicker');
            const selectedPickerDate = historicalDatePicker?.value ? luxon.DateTime.fromISO(historicalDatePicker.value, { zone: 'utc' }).startOf('day') : null;
            if (selectedPickerDate && selectedPickerDate < today) {
                isHistorical = true;
                targetDateForAPI = selectedPickerDate;
            }
        }
        // Ende der Datumslogik

        let baseUrl = 'https://api.open-meteo.com/v1/forecast';
        let runDateForForecastWindowCalculation; // Für die Berechnung des Vorhersagefensters

        if (isHistorical && targetDateForAPI) {
            baseUrl = 'https://historical-forecast-api.open-meteo.com/v1/forecast';
            startDateStr = targetDateForAPI.toFormat('yyyy-MM-dd');
            endDateStr = startDateStr; // Historische Daten sind tagesgenau
            console.log(`[fetchWeather] Historical fetch for date: ${startDateStr}`);
            AppState.lastModelRun = "N/A (Historical Data)"; // Setze für historische Daten
        } else {
            // Nur für Forecast-Modelle die Meta-Daten (Modelllaufzeit) abrufen
            try {
                const metaUrl = `https://api.open-meteo.com/data/${modelApiIdentifierForMeta}/static/meta.json`;
                console.log(`[fetchWeather] Attempting meta fetch with URL: ${metaUrl}`);
                const metaResponse = await fetch(metaUrl);
                if (!metaResponse.ok) {
                    console.warn(`[fetchWeather] Meta fetch failed for '${modelApiIdentifierForMeta}': ${metaResponse.status} (${metaResponse.statusText}). Using current time as fallback for forecast window.`);
                    runDateForForecastWindowCalculation = new Date(); // Fallback
                    AppState.lastModelRun = `N/A (Meta ${metaResponse.status})`;
                } else {
                    const metaData = await metaResponse.json();
                    if (metaData && typeof metaData.last_run_initialisation_time === 'number') {
                        runDateForForecastWindowCalculation = new Date(metaData.last_run_initialisation_time * 1000);
                        const year = runDateForForecastWindowCalculation.getUTCFullYear();
                        const month = String(runDateForForecastWindowCalculation.getUTCMonth() + 1).padStart(2, '0');
                        const day = String(runDateForForecastWindowCalculation.getUTCDate()).padStart(2, '0');
                        const hour = String(runDateForForecastWindowCalculation.getUTCHours()).padStart(2, '0');
                        const minute = String(runDateForForecastWindowCalculation.getUTCMinutes()).padStart(2, '0');
                        AppState.lastModelRun = `${year}-${month}-${day} ${hour}${minute}Z`;
                        console.log('[fetchWeather] Meta success. Last model run:', AppState.lastModelRun);
                    } else {
                        console.warn(`[fetchWeather] Meta data for '${modelApiIdentifierForMeta}' valid (HTTP 200) but 'last_run_initialisation_time' missing or invalid. Using current time. MetaData:`, metaData);
                        runDateForForecastWindowCalculation = new Date();
                        AppState.lastModelRun = 'N/A (Invalid meta structure)';
                    }
                }
            } catch (metaError) {
                console.warn(`[fetchWeather] Meta fetch exception for '${modelApiIdentifierForMeta}': ${metaError.message}. Using current time for forecast window.`);
                runDateForForecastWindowCalculation = new Date(); // Fallback
                AppState.lastModelRun = 'N/A (Meta exception)';
            }

            // Berechnung des Vorhersagefensters basierend auf runDateForForecastWindowCalculation
            let forecastStart = luxon.DateTime.fromJSDate(runDateForForecastWindowCalculation).setZone('utc').plus({ hours: 6 });
            const nowUtc = luxon.DateTime.utc();
            if (forecastStart > nowUtc) forecastStart = nowUtc; // Nicht in der Zukunft starten
            startDateStr = forecastStart.toFormat('yyyy-MM-dd');

            // Bestimme Anzahl der Vorhersagetage basierend auf dem Modell
            const forecastDays = selectedModelValue.includes('_d2') ? 2 : (selectedModelValue.includes('hrrr') ? 1 : 7);
            endDateStr = forecastStart.plus({ days: forecastDays }).toFormat('yyyy-MM-dd');
            console.log(`[fetchWeather] Forecast fetch from ${startDateStr} to ${endDateStr} (based on runDate: ${runDateForForecastWindowCalculation.toISOString()})`);
        }

        const hourlyParams = "surface_pressure,temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_1000hPa,relative_humidity_1000hPa,wind_speed_1000hPa,wind_direction_1000hPa,geopotential_height_1000hPa,temperature_950hPa,relative_humidity_950hPa,wind_speed_950hPa,wind_direction_950hPa,geopotential_height_950hPa,temperature_925hPa,relative_humidity_925hPa,wind_speed_925hPa,wind_direction_925hPa,geopotential_height_925hPa,temperature_900hPa,relative_humidity_900hPa,wind_speed_900hPa,wind_direction_900hPa,geopotential_height_900hPa,temperature_850hPa,relative_humidity_850hPa,wind_speed_850hPa,wind_direction_850hPa,geopotential_height_850hPa,temperature_800hPa,relative_humidity_800hPa,wind_speed_800hPa,wind_direction_800hPa,geopotential_height_800hPa,temperature_700hPa,relative_humidity_700hPa,wind_speed_700hPa,wind_direction_700hPa,geopotential_height_700hPa,temperature_600hPa,relative_humidity_600hPa,wind_speed_600hPa,wind_direction_600hPa,geopotential_height_600hPa,temperature_500hPa,relative_humidity_500hPa,wind_speed_500hPa,wind_direction_500hPa,geopotential_height_500hPa,temperature_400hPa,relative_humidity_400hPa,wind_speed_400hPa,wind_direction_400hPa,geopotential_height_400hPa,temperature_300hPa,relative_humidity_300hPa,wind_speed_300hPa,wind_direction_300hPa,geopotential_height_300hPa,temperature_250hPa,relative_humidity_250hPa,wind_speed_250hPa,wind_direction_250hPa,geopotential_height_250hPa,temperature_200hPa,relative_humidity_200hPa,wind_speed_200hPa,wind_direction_200hPa,geopotential_height_200hPa";

        // Für den &models= Parameter in der Haupt-API-Anfrage wird selectedModelValue direkt verwendet.
        const url = `${baseUrl}?latitude=${lat}&longitude=${lon}&hourly=${hourlyParams}&models=${selectedModelValue}&start_date=${startDateStr}&end_date=${endDateStr}`;

        console.log('[fetchWeather] Fetching weather from:', url);
        const response = await fetch(url);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! Status: ${response.status} - ${errorText}`);
        }
        const data = await response.json();
        if (!data.hourly || !data.hourly.time || data.hourly.time.length === 0) {
            console.warn("[fetchWeather] No hourly data or time array returned from API for model:", selectedModelValue, "Data:", data);
            throw new Error('No hourly data returned from API for model: ' + selectedModelValue);
        }

        console.log(`[fetchWeather] Successfully fetched data for model ${selectedModelValue}. Number of time entries: ${data.hourly.time.length}`);

        // Daten in AppState.weatherData speichern
        const lastValidIndex = data.hourly.time.length - 1;
        AppState.weatherData = {}; // AppState.weatherData zurücksetzen
        for (const key in data.hourly) {
            if (Object.hasOwnProperty.call(data.hourly, key)) {
                // Sicherstellen, dass die Arrays nicht länger als die 'time'-Achse sind
                AppState.weatherData[key] = data.hourly[key].slice(0, lastValidIndex + 1);
            }
        }

        // Slider aktualisieren
        const slider = document.getElementById('timeSlider');
        if (slider) { // Prüfen, ob Slider existiert
            slider.min = 0;
            slider.max = AppState.weatherData.time.length > 0 ? AppState.weatherData.time.length - 1 : 0;
            slider.disabled = AppState.weatherData.time.length <= 1;

            if (slider.disabled) {
                slider.style.opacity = '0.5';
                slider.style.cursor = 'not-allowed';
                const infoEl = document.getElementById('info');
                if (infoEl && !infoEl.innerHTML.includes('Only one forecast time available.')) { // Verhindere Duplikate
                    infoEl.innerHTML += '<br><strong>Note:</strong> Only one forecast time available.';
                }
            } else {
                slider.style.opacity = '1';
                slider.style.cursor = 'pointer';
            }
        }

        // initialIndex bestimmen und Slider & Anzeige aktualisieren
        let initialIndex = 0;
        if (AppState.weatherData.time && AppState.weatherData.time.length > 0) { // Nur wenn Zeitdaten vorhanden sind
            if (currentTime) { // Wenn eine bestimmte Zeit angefordert wurde
                let targetLuxonDate = null;
                if (typeof currentTime === 'string' && currentTime.includes('GMT')) {
                    const match = currentTime.match(/^(\d{4}-\d{2}-\d{2})\s(\d{2})(\d{2})\sGMT([+-]\d{1,2})$/);
                    if (match) {
                        const [, dateStrParse, hourStr, minuteStr, offset] = match;
                        const formattedOffset = `${offset.startsWith('+') ? '+' : '-'}${Math.abs(parseInt(offset, 10)).toString().padStart(2, '0')}:00`;
                        const isoString = `${dateStrParse}T${hourStr}:${minuteStr}:00${formattedOffset}`;
                        targetLuxonDate = luxon.DateTime.fromISO(isoString, { zone: 'utc' });
                    }
                } else {
                    targetLuxonDate = luxon.DateTime.fromISO(currentTime, { zone: 'utc' });
                }

                if (targetLuxonDate && targetLuxonDate.isValid) {
                    const targetTimestamp = targetLuxonDate.toMillis();
                    let minDiff = Infinity;
                    AppState.weatherData.time.forEach((time, idx) => {
                        const timeTimestamp = luxon.DateTime.fromISO(time, { zone: 'utc' }).toMillis();
                        const diff = Math.abs(timeTimestamp - targetTimestamp);
                        if (diff < minDiff) {
                            minDiff = diff;
                            initialIndex = idx;
                        }
                    });
                }
            } else if (isHistorical && targetDateForAPI) { // Für historische Daten, versuche Mittag zu finden
                let minDiff = Infinity;
                let foundDay = false;
                AppState.weatherData.time.forEach((time, idx) => {
                    const timeLuxon = luxon.DateTime.fromISO(time, { zone: 'utc' });
                    if (timeLuxon.hasSame(targetDateForAPI, 'day')) {
                        foundDay = true;
                        const diffToNoon = Math.abs(timeLuxon.hour - 12);
                        if (diffToNoon < minDiff) {
                            minDiff = diffToNoon;
                            initialIndex = idx;
                        }
                    }
                });
                if (!foundDay) initialIndex = 0; // Fallback, falls kein passender Tag in den Daten ist
            } else { // Für Forecast, finde die Zeit, die "jetzt" am nächsten ist
                const now = luxon.DateTime.utc();
                let minDiff = Infinity;
                AppState.weatherData.time.forEach((time, idx) => {
                    const timeTimestamp = luxon.DateTime.fromISO(time, { zone: 'utc' }).toMillis();
                    const diff = Math.abs(timeTimestamp - now.toMillis());
                    if (diff < minDiff) {
                        minDiff = diff;
                        initialIndex = idx;
                    }
                });
            }
        }
        if (slider) slider.value = initialIndex; // Slider-Wert setzen
        await updateWeatherDisplay(initialIndex); // Anzeige mit dem ermittelten Index aktualisieren

        // AppState.lastModelRun wurde bereits im Meta-Daten-Block oder für historische Daten gesetzt.
        console.log("[fetchWeather] final lastModelRun to be used by UI:", AppState.lastModelRun);


    } catch (error) {
        console.error("[fetchWeather] Main fetch/processing Error:", error);
        Utils.handleError(`Failed to fetch weather: ${error.message}`);
        AppState.weatherData = null;
        AppState.lastModelRun = null; // Zurücksetzen
        const infoElement = document.getElementById('info');
        if (infoElement) infoElement.innerHTML = 'Failed to load weather data.';
        const slider = document.getElementById('timeSlider');
        if (slider) {
            slider.disabled = true;
            slider.value = 0;
            slider.max = 0;
        }
        const selectedTimeElement = document.getElementById('selectedTime');
        if (selectedTimeElement) selectedTimeElement.innerHTML = 'Selected Time: N/A';
    } finally {
        if (loadingElement) loadingElement.style.display = 'none';
    }
}
export async function updateWeatherDisplay(index, originalTime = null) {
    console.log(`updateWeatherDisplay called with index: ${index}, Time: ${AppState.weatherData.time[index]}`);
    if (!AppState.weatherData || !AppState.weatherData.time || index < 0 || index >= AppState.weatherData.time.length) {
        console.error('No weather data available or index out of bounds:', index);
        document.getElementById('info').innerHTML = 'No weather data available';
        document.getElementById('selectedTime').innerHTML = 'Selected Time: ';
        const slider = document.getElementById('timeSlider');
        if (slider) slider.value = 0;
        return;
    }

    AppState.landingWindDir = AppState.weatherData.wind_direction_10m[index] || null;
    console.log('landingWindDir updated to:', AppState.landingWindDir);

    const customLandingDirectionLLInput = document.getElementById('customLandingDirectionLL');
    const customLandingDirectionRRInput = document.getElementById('customLandingDirectionRR');
    if (customLandingDirectionLLInput && customLandingDirectionRRInput && AppState.landingWindDir !== null) {
        customLandingDirectionLLInput.value = Math.round(AppState.landingWindDir);
        customLandingDirectionRRInput.value = Math.round(AppState.landingWindDir);
    }

    const refLevel = document.querySelector('input[name="refLevel"]:checked')?.value || 'AGL';
    const heightUnit = getHeightUnit();
    const windSpeedUnit = getWindSpeedUnit();
    const temperatureUnit = getTemperatureUnit();
    // Pass lat and lng to getDisplayTime
    const time = await Utils.getDisplayTime(AppState.weatherData.time[index], AppState.lastLat, AppState.lastLng);
    const interpolatedData = interpolateWeatherData(index);
    const surfaceHeight = refLevel === 'AMSL' && AppState.lastAltitude !== 'N/A' ? Math.round(AppState.lastAltitude) : 0;

    if (!Settings.state.userSettings.showTable) {
        document.getElementById('info').innerHTML = '';
        document.getElementById('selectedTime').innerHTML = `Selected Time: ${time}`;
        return;
    }

    let output = `<table id="weatherTable">`;
    output += `<tr><th>Height (${heightUnit} ${refLevel})</th><th>Dir (deg)</th><th>Spd (${windSpeedUnit})</th><th>Wind</th><th>T (${temperatureUnit === 'C' ? '°C' : '°F'})</th></tr>`;
    interpolatedData.forEach((data, idx) => {
        const spd = parseFloat(data.spd);
        let windClass = '';
        if (windSpeedUnit === 'bft') {
            const spdInKt = Utils.convertWind(spd, 'kt', 'km/h');
            const bft = Utils.knotsToBeaufort(spdInKt);
            if (bft <= 1) windClass = 'wind-low';
            else if (bft <= 3) windClass = 'wind-moderate';
            else if (bft <= 4) windClass = 'wind-high';
            else windClass = 'wind-very-high';
        } else {
            const spdInKt = Utils.convertWind(spd, 'kt', 'km/h');
            if (spdInKt <= 3) windClass = 'wind-low';
            else if (spdInKt <= 10) windClass = 'wind-moderate';
            else if (spdInKt <= 16) windClass = 'wind-high';
            else windClass = 'wind-very-high';
        }

        // Apply conditional background color based on RH
        const humidity = data.rh;
        let humidityClass = '';
        if (humidity !== 'N/A' && Number.isFinite(humidity)) {
            if (humidity < 65) {
                humidityClass = 'humidity-low';
            } else if (humidity >= 65 && humidity <= 85) {
                humidityClass = 'humidity-moderate';
            } else if (humidity > 85 && humidity < 100) {
                humidityClass = 'humidity-high';
            } else if (humidity === 100) {
                humidityClass = 'humidity-saturated';
            }
        }
        console.log(`Row ${idx}: RH=${humidity}, windClass=${windClass}, humidityClass=${humidityClass}`);

        const displayHeight = refLevel === 'AMSL' ? data.displayHeight + (heightUnit === 'ft' ? Math.round(surfaceHeight * 3.28084) : surfaceHeight) : data.displayHeight;
        const displayTemp = Utils.convertTemperature(data.temp, temperatureUnit === 'C' ? '°C' : '°F');
        const formattedTemp = displayTemp === 'N/A' ? 'N/A' : displayTemp.toFixed(0);

        const convertedSpd = Utils.convertWind(spd, windSpeedUnit, 'km/h');
        let formattedWind;
        const surfaceDisplayHeight = refLevel === 'AMSL' ? (heightUnit === 'ft' ? Math.round(surfaceHeight * 3.28084) : surfaceHeight) : 0;
        if (Math.round(displayHeight) === surfaceDisplayHeight && AppState.weatherData.wind_gusts_10m[index] !== undefined && Number.isFinite(AppState.weatherData.wind_gusts_10m[index])) {
            const gustSpd = AppState.weatherData.wind_gusts_10m[index];
            const convertedGust = Utils.convertWind(gustSpd, windSpeedUnit, 'km/h');
            const spdValue = windSpeedUnit === 'bft' ? Math.round(convertedSpd) : convertedSpd.toFixed(0);
            const gustValue = windSpeedUnit === 'bft' ? Math.round(convertedGust) : convertedGust.toFixed(0);
            formattedWind = `${spdValue} G ${gustValue}`;
        } else {
            formattedWind = convertedSpd === 'N/A' ? 'N/A' : (windSpeedUnit === 'bft' ? Math.round(convertedSpd) : convertedSpd.toFixed(0));
        }

        const speedKt = Math.round(Utils.convertWind(spd, 'kt', 'km/h') / 5) * 5;
        const windBarbSvg = data.dir === 'N/A' || isNaN(speedKt) ? 'N/A' : generateWindBarb(data.dir, speedKt);

        output += `<tr class="${windClass} ${humidityClass}">
            <td>${Math.round(displayHeight)}</td>
            <td>${Utils.roundToTens(data.dir)}</td>
            <td>${formattedWind}</td>
            <td>${windBarbSvg}</td>
            <td>${formattedTemp}</td>
        </tr>`;
    });
    output += `</table>`;
    document.getElementById('info').innerHTML = output;
    document.getElementById('selectedTime').innerHTML = `Selected Time: ${time}`;
    updateLandingPatternDisplay();
}
export function calculateMeanWind() {
    console.log('Calculating mean wind with model:', document.getElementById('modelSelect').value, 'weatherData:', AppState.weatherData);
    const index = document.getElementById('timeSlider').value || 0;
    const interpolatedData = interpolateWeatherData(index);
    let lowerLimitInput = parseFloat(document.getElementById('lowerLimit').value) || 0;
    let upperLimitInput = parseFloat(document.getElementById('upperLimit').value);
    const refLevel = document.querySelector('input[name="refLevel"]:checked')?.value || 'AGL';
    const heightUnit = getHeightUnit();
    const windSpeedUnit = getWindSpeedUnit();
    const baseHeight = Math.round(AppState.lastAltitude);

    if (!AppState.weatherData || AppState.lastAltitude === 'N/A') {
        handleError('Cannot calculate mean wind: missing data or altitude');
        return;
    }

    // Convert inputs to meters
    lowerLimitInput = heightUnit === 'ft' ? lowerLimitInput / 3.28084 : lowerLimitInput;
    upperLimitInput = heightUnit === 'ft' ? upperLimitInput / 3.28084 : upperLimitInput;

    if ((refLevel === 'AMSL') && lowerLimitInput < baseHeight) {
        Utils.handleError(`Lower limit adjusted to terrain altitude (${baseHeight} m ${refLevel}) as it cannot be below ground level in ${refLevel} mode.`);
        lowerLimitInput = baseHeight;
        document.getElementById('lowerLimit').value = Utils.convertHeight(lowerLimitInput, heightUnit);
    }

    const lowerLimit = refLevel === 'AGL' ? lowerLimitInput + baseHeight : lowerLimitInput;
    const upperLimit = refLevel === 'AGL' ? upperLimitInput + baseHeight : upperLimitInput;

    if (isNaN(lowerLimitInput) || isNaN(upperLimitInput) || lowerLimitInput >= upperLimitInput) {
        Utils.handleError('Invalid layer limits. Ensure Lower < Upper and both are numbers.');
        return;
    }

    // Check if interpolatedData is valid
    if (!interpolatedData || interpolatedData.length === 0) {
        Utils.handleError('No valid weather data available to calculate mean wind.');
        return;
    }

    // Use raw heights and speeds in knots
    const heights = interpolatedData.map(d => d.height);
    const dirs = interpolatedData.map(d => parseFloat(d.dir) || 0);
    const spds = interpolatedData.map(d => Utils.convertWind(parseFloat(d.spd) || 0, windSpeedUnit, 'km/h')); // Fixed order

    const xKomponente = spds.map((spd, i) => -spd * Math.sin(dirs[i] * Math.PI / 180));
    const yKomponente = spds.map((spd, i) => -spd * Math.cos(dirs[i] * Math.PI / 180));

    const meanWind = Utils.calculateMeanWind(heights, xKomponente, yKomponente, lowerLimit, upperLimit);
    const [dir, spd] = meanWind;

    const roundedDir = Utils.roundToTens(dir) === 0 && dir >= 0 && dir < 5 ? 360 : Utils.roundToTens(dir);
    const displayLower = Math.round(Utils.convertHeight(lowerLimitInput, heightUnit));
    const displayUpper = Math.round(Utils.convertHeight(upperLimitInput, heightUnit));
    const displaySpd = Utils.convertWind(spd, windSpeedUnit, 'kt');
    const formattedSpd = Number.isFinite(spd) ? (windSpeedUnit === 'bft' ? Math.round(spd) : spd.toFixed(1)) : 'N/A';
    const result = `Mean wind (${displayLower}-${displayUpper} ${heightUnit} ${refLevel}): ${roundedDir}° ${formattedSpd} ${windSpeedUnit}`;
    document.getElementById('meanWindResult').innerHTML = result;
    console.log('Calculated Mean Wind:', result, 'u:', meanWind[2], 'v:', meanWind[3]);
}
export function interpolateWeatherData(sliderIndex) {
    if (!AppState.weatherData || !AppState.weatherData.time || sliderIndex >= AppState.weatherData.time.length) {
        console.warn('No weather data available for interpolation');
        return [];
    }

    const baseHeight = Math.round(AppState.lastAltitude);
    const interpStep = parseInt(getInterpolationStep()) || 100;
    const heightUnit = getHeightUnit();

    // Define all possible pressure levels
    const allPressureLevels = [1000, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200];

    // Filter pressure levels with valid geopotential height data
    const validPressureLevels = allPressureLevels.filter(hPa => {
        const height = AppState.weatherData[`geopotential_height_${hPa}hPa`]?.[sliderIndex];
        return height !== null && height !== undefined;
    });

    if (validPressureLevels.length < 2) {
        console.warn('Insufficient valid pressure level data for interpolation:', validPressureLevels);
        return [];
    }

    // Collect data for valid pressure levels
    let heightData = validPressureLevels.map(hPa => AppState.weatherData[`geopotential_height_${hPa}hPa`][sliderIndex]);
    let tempData = validPressureLevels.map(hPa => AppState.weatherData[`temperature_${hPa}hPa`][sliderIndex]);
    let rhData = validPressureLevels.map(hPa => AppState.weatherData[`relative_humidity_${hPa}hPa`][sliderIndex]);
    let spdData = validPressureLevels.map(hPa => AppState.weatherData[`wind_speed_${hPa}hPa`][sliderIndex]);
    let dirData = validPressureLevels.map(hPa => AppState.weatherData[`wind_direction_${hPa}hPa`][sliderIndex]);

    const surfacePressure = AppState.weatherData.surface_pressure[sliderIndex];
    if (surfacePressure === null || surfacePressure === undefined) {
        console.warn('Surface pressure missing');
        return [];
    }

    // Calculate wind components at valid pressure levels
    let uComponents = spdData.map((spd, i) => -spd * Math.sin(dirData[i] * Math.PI / 180));
    let vComponents = spdData.map((spd, i) => -spd * Math.cos(dirData[i] * Math.PI / 180));

    // Add surface and intermediate points if surfacePressure > lowest valid pressure level
    const lowestPressureLevel = Math.max(...validPressureLevels);
    const hLowest = AppState.weatherData[`geopotential_height_${lowestPressureLevel}hPa`][sliderIndex];
    if (surfacePressure > lowestPressureLevel && Number.isFinite(hLowest) && hLowest > baseHeight) {
        const stepsBetween = Math.floor((hLowest - baseHeight) / interpStep);

        // Surface wind components
        const uSurface = -AppState.weatherData.wind_speed_10m[sliderIndex] * Math.sin(AppState.weatherData.wind_direction_10m[sliderIndex] * Math.PI / 180);
        const vSurface = -AppState.weatherData.wind_speed_10m[sliderIndex] * Math.cos(AppState.weatherData.wind_direction_10m[sliderIndex] * Math.PI / 180);
        const uLowest = uComponents[validPressureLevels.indexOf(lowestPressureLevel)];
        const vLowest = vComponents[validPressureLevels.indexOf(lowestPressureLevel)];

        // Add intermediate points with logarithmic interpolation
        for (let i = stepsBetween - 1; i >= 1; i--) {
            const h = baseHeight + i * interpStep;
            if (h >= hLowest) continue;
            const fraction = (h - baseHeight) / (hLowest - baseHeight);
            const logPSurface = Math.log(surfacePressure);
            const logPLowest = Math.log(lowestPressureLevel);
            const logP = logPSurface + fraction * (logPLowest - logPSurface);
            const p = Math.exp(logP);

            const logHeight = Math.log(h - baseHeight + 1);
            const logH0 = Math.log(1);
            const logH1 = Math.log(hLowest - baseHeight);
            const u = Utils.LIP([logH0, logH1], [uSurface, uLowest], logHeight);
            const v = Utils.LIP([logH0, logH1], [vSurface, vLowest], logHeight);
            const spd = Utils.windSpeed(u, v);
            const dir = Utils.windDirection(u, v);

            heightData.unshift(h);
            validPressureLevels.unshift(p);
            tempData.unshift(Utils.LIP([baseHeight, hLowest], [AppState.weatherData.temperature_2m[sliderIndex], AppState.weatherData[`temperature_${lowestPressureLevel}hPa`][sliderIndex]], h));
            rhData.unshift(Utils.LIP([baseHeight, hLowest], [AppState.weatherData.relative_humidity_2m[sliderIndex], AppState.weatherData[`relative_humidity_${lowestPressureLevel}hPa`][sliderIndex]], h));
            spdData.unshift(spd);
            dirData.unshift(dir);
            uComponents.unshift(u);
            vComponents.unshift(v);
        }

        // Add surface data
        heightData.unshift(baseHeight);
        validPressureLevels.unshift(surfacePressure);
        tempData.unshift(AppState.weatherData.temperature_2m[sliderIndex]);
        rhData.unshift(AppState.weatherData.relative_humidity_2m[sliderIndex]);
        spdData.unshift(AppState.weatherData.wind_speed_10m[sliderIndex]);
        dirData.unshift(AppState.weatherData.wind_direction_10m[sliderIndex]);
        uComponents.unshift(uSurface);
        vComponents.unshift(vSurface);
    }

    // Determine the maximum height using the lowest pressure level (highest altitude)
    const minPressureIndex = validPressureLevels.indexOf(Math.min(...validPressureLevels));
    const maxHeightASL = heightData[minPressureIndex];
    const maxHeightAGL = maxHeightASL - baseHeight;
    if (maxHeightAGL <= 0 || isNaN(maxHeightAGL)) {
        console.warn('Invalid max height at lowest pressure level:', { maxHeightASL, baseHeight, minPressure: validPressureLevels[minPressureIndex] });
        return [];
    }

    // Convert maxHeightAGL to user's unit for step calculation
    const maxHeightInUnit = heightUnit === 'ft' ? maxHeightAGL * 3.28084 : maxHeightAGL;
    const steps = Math.floor(maxHeightInUnit / interpStep);
    const heightsInUnit = Array.from({ length: steps + 1 }, (_, i) => i * interpStep);

    console.log('Interpolating up to lowest pressure level:', { maxHeightAGL, minPressure: validPressureLevels[minPressureIndex], interpStep });

    const interpolatedData = [];
    heightsInUnit.forEach(height => {
        const heightAGLInMeters = heightUnit === 'ft' ? height / 3.28084 : height;
        const heightASLInMeters = baseHeight + heightAGLInMeters;

        let dataPoint;
        if (heightAGLInMeters === 0) {
            dataPoint = {
                height: heightASLInMeters,
                pressure: surfacePressure,
                temp: AppState.weatherData.temperature_2m[sliderIndex],
                rh: AppState.weatherData.relative_humidity_2m[sliderIndex],
                spd: AppState.weatherData.wind_speed_10m[sliderIndex],
                dir: AppState.weatherData.wind_direction_10m[sliderIndex],
                dew: Utils.calculateDewpoint(AppState.weatherData.temperature_2m[sliderIndex], AppState.weatherData.relative_humidity_2m[sliderIndex])
            };
        } else {
            const pressure = Utils.interpolatePressure(heightASLInMeters, validPressureLevels, heightData);
            const windComponents = Utils.interpolateWindAtAltitude(heightASLInMeters, validPressureLevels, heightData, uComponents, vComponents);
            const spd = Utils.windSpeed(windComponents.u, windComponents.v);
            const dir = Utils.windDirection(windComponents.u, windComponents.v);
            const temp = Utils.LIP(heightData, tempData, heightASLInMeters);
            const rh = Utils.LIP(heightData, rhData, heightASLInMeters);
            const dew = Utils.calculateDewpoint(temp, rh);

            dataPoint = {
                height: heightASLInMeters,
                pressure: pressure === 'N/A' ? 'N/A' : Number(pressure.toFixed(1)),
                temp: Number(temp.toFixed(1)),
                rh: Number(rh.toFixed(0)),
                spd: Number(spd.toFixed(1)),
                dir: Number(dir.toFixed(0)),
                dew: Number(dew.toFixed(1))
            };
        }

        dataPoint.displayHeight = height;
        interpolatedData.push(dataPoint);
    });

    console.log('Interpolated data length:', interpolatedData.length, 'Max height:', interpolatedData[interpolatedData.length - 1].displayHeight);
    return interpolatedData;
}
export function downloadTableAsAscii(format) {
    if (!AppState.weatherData || !AppState.weatherData.time) {
        Utils.handleError('No weather data available to download.');
        return;
    }

    const index = document.getElementById('timeSlider').value || 0;
    const model = document.getElementById('modelSelect').value.toUpperCase();
    const time = Utils.formatTime(AppState.weatherData.time[index]).replace(' ', '_');
    const filename = `${time}_${model}_${format}.txt`;

    // Define format-specific required settings
    const formatRequirements = {
        'ATAK': {
            interpStep: 1000,
            heightUnit: 'ft',
            refLevel: 'AGL',
            windUnit: 'kt'
        },
        'Windwatch': {
            interpStep: 100,
            heightUnit: 'ft',
            refLevel: 'AGL',
            windUnit: 'km/h'
        },
        'HEIDIS': {
            interpStep: 100,
            heightUnit: 'm',
            refLevel: 'AGL',
            temperatureUnit: 'C',
            windUnit: 'm/s'
        },
        'Customized': {} // No strict requirements, use current settings
    };

    // Store original settings
    const originalSettings = {
        interpStep: getInterpolationStep(),
        heightUnit: getHeightUnit(),
        refLevel: document.querySelector('input[name="refLevel"]:checked')?.value || 'AGL',
        windUnit: getWindSpeedUnit(),
        temperatureUnit: getTemperatureUnit()
    };

    // Get current settings
    let currentSettings = { ...originalSettings };

    // Check and adjust settings if format has specific requirements
    const requiredSettings = formatRequirements[format];
    if (requiredSettings && Object.keys(requiredSettings).length > 0) {
        let settingsAdjusted = false;

        // Check each required setting and adjust if necessary
        for (const [key, requiredValue] of Object.entries(requiredSettings)) {
            if (currentSettings[key] !== requiredValue) {
                settingsAdjusted = true;
                switch (key) {
                    case 'interpStep':
                        document.getElementById('interpStepSelect').value = requiredValue;
                        Settings.state.userSettings.interpStep = requiredValue;
                        break;
                    case 'heightUnit':
                        document.querySelector(`input[name="heightUnit"][value="${requiredValue}"]`).checked = true;
                        Settings.state.userSettings.heightUnit = requiredValue;
                        break;
                    case 'refLevel':
                        document.querySelector(`input[name="refLevel"][value="${requiredValue}"]`).checked = true;
                        Settings.state.userSettings.refLevel = requiredValue;
                        break;
                    case 'windUnit':
                        document.querySelector(`input[name="windUnit"][value="${requiredValue}"]`).checked = true;
                        Settings.state.userSettings.windUnit = requiredValue;
                        break;
                    case 'temperatureUnit':
                        document.querySelector(`input[name="temperatureUnit"][value="${requiredValue}"]`).checked = true;
                        Settings.state.userSettings.temperatureUnit = requiredValue;
                        break;
                }
                currentSettings[key] = requiredValue;
            }
        }

        if (settingsAdjusted) {
            Settings.save();
            console.log(`Adjusted settings for ${format} compatibility:`, requiredSettings);
            Settings.updateUnitLabels(); // Update UI labels if heightUnit changes
            Settings.updateUnitLabels();   // Update UI labels if windUnit changes
            Settings.updateUnitLabels();
            // Update UI labels if refLevel changes
        }
    }

    // Prepare content based on format
    let content = '';
    let separator = ' '; // Default separator "space"
    const heightUnit = getHeightUnit();
    const temperatureUnit = getTemperatureUnit();
    const windSpeedUnit = getWindSpeedUnit();
    const refLevel = document.querySelector('input[name="refLevel"]:checked')?.value || 'AGL';

    if (format === 'ATAK') {
        content = `Alt Dir Spd\n${heightUnit}${refLevel}\n`;
    } else if (format === 'Windwatch') {
        const elevation = heightUnit === 'ft' ? Math.round(AppState.lastAltitude * 3.28084) : Math.round(AppState.lastAltitude);
        content = `Version 1.0, ID = 9999999999\n${time}, Ground Level: ${elevation} ft\nWindsond ${model}\n AGL[ft] Wind[°] Speed[km/h]\n`;
    } else if (format === 'HEIDIS') {
        const heightHeader = refLevel === 'AGL' ? `h(${heightUnit}AGL)` : `h(${heightUnit}AMSL)`;
        const temperatureHeader = temperatureUnit === 'C' ? '°C' : '°F';
        const windSpeedHeader = windSpeedUnit;
        content = `${heightHeader} p(hPa) T(${temperatureHeader}) Dew(${temperatureHeader}) Dir(°) Spd(${windSpeedHeader}) RH(%)`;
    } else if (format === 'Customized') {
        const heightHeader = refLevel === 'AGL' ? `h(${heightUnit}AGL)` : `h(${heightUnit}AMSL)`;
        const temperatureHeader = temperatureUnit === 'C' ? '°C' : '°F';
        const windSpeedHeader = windSpeedUnit;
        content = `${heightHeader} p(hPa) T(${temperatureHeader}) Dew(${temperatureHeader}) Dir(°) Spd(${windSpeedHeader}) RH(%)`;
    }

    // Generate surface data with fetched surface_pressure
    const baseHeight = Math.round(AppState.lastAltitude);
    const surfaceHeight = refLevel === 'AGL' ? 0 : baseHeight;
    const surfaceTemp = AppState.weatherData.temperature_2m?.[index];
    const surfaceRH = AppState.weatherData.relative_humidity_2m?.[index];
    const surfaceSpd = AppState.weatherData.wind_speed_10m?.[index];
    const surfaceDir = AppState.weatherData.wind_direction_10m?.[index];
    const surfaceDew = Utils.calculateDewpoint(surfaceTemp, surfaceRH);
    const surfacePressure = AppState.weatherData.surface_pressure[index]; // Use fetched surface pressure directly

    const displaySurfaceHeight = Math.round(Utils.convertHeight(surfaceHeight, heightUnit));
    const displaySurfaceTemp = Utils.convertTemperature(surfaceTemp, temperatureUnit);
    const displaySurfaceDew = Utils.convertTemperature(surfaceDew, temperatureUnit);
    const displaySurfaceSpd = Utils.convertWind(surfaceSpd, windSpeedUnit, 'km/h');
    const formattedSurfaceTemp = displaySurfaceTemp === 'N/A' ? 'N/A' : displaySurfaceTemp.toFixed(1);
    const formattedSurfaceDew = displaySurfaceDew === 'N/A' ? 'N/A' : displaySurfaceDew.toFixed(1);
    const formattedSurfaceSpd = displaySurfaceSpd === 'N/A' ? 'N/A' : (windSpeedUnit === 'bft' ? Math.round(displaySurfaceSpd) : displaySurfaceSpd.toFixed(1));
    const formattedSurfaceDir = surfaceDir === 'N/A' || surfaceDir === undefined ? 'N/A' : Math.round(surfaceDir);
    const formattedSurfaceRH = surfaceRH === 'N/A' || surfaceRH === undefined ? 'N/A' : Math.round(surfaceRH);

    if (format === 'ATAK') {
        content += `${displaySurfaceHeight}${separator}${formattedSurfaceDir}${separator}${formattedSurfaceSpd}\n`;
    } else if (format === 'Windwatch') {
        content += `${displaySurfaceHeight}${separator}${formattedSurfaceDir}${separator}${formattedSurfaceSpd}\n`;
    } else if (format === 'HEIDIS') {
        content += `\n${displaySurfaceHeight}${separator}${surfacePressure === 'N/A' ? 'N/A' : surfacePressure.toFixed(1)}${separator}${formattedSurfaceTemp}${separator}${formattedSurfaceDew}${separator}${formattedSurfaceDir}${separator}${formattedSurfaceSpd}${separator}${formattedSurfaceRH}\n`;
    } else if (format === 'Customized') {
        content += `\n${displaySurfaceHeight}${separator}${surfacePressure === 'N/A' ? 'N/A' : surfacePressure.toFixed(1)}${separator}${formattedSurfaceTemp}${separator}${formattedSurfaceDew}${separator}${formattedSurfaceDir}${separator}${formattedSurfaceSpd}${separator}${formattedSurfaceRH}\n`;
    }

    // Generate interpolated data
    const interpolatedData = interpolateWeatherData(index);
    if (!interpolatedData || interpolatedData.length === 0) {
        Utils.handleError('No interpolated data available to download.');
        return;
    }

    interpolatedData.forEach(data => {
        if (data.displayHeight !== surfaceHeight) {
            const displayHeight = Math.round(Utils.convertHeight(data.displayHeight, heightUnit));
            const displayPressure = data.pressure === 'N/A' ? 'N/A' : data.pressure.toFixed(1);
            const displayTemperature = Utils.convertTemperature(data.temp, temperatureUnit);
            const displayDew = Utils.convertTemperature(data.dew, temperatureUnit);
            const displaySpd = Utils.convertWind(data.spd, windSpeedUnit, getWindSpeedUnit()); // Use current windUnit
            const formattedTemp = displayTemperature === 'N/A' ? 'N/A' : displayTemperature.toFixed(1);
            const formattedDew = displayDew === 'N/A' ? 'N/A' : displayDew.toFixed(1);
            const formattedSpd = displaySpd === 'N/A' ? 'N/A' : (windSpeedUnit === 'bft' ? Math.round(displaySpd) : displaySpd.toFixed(1));
            const formattedDir = data.dir === 'N/A' ? 'N/A' : Math.round(data.dir);
            const formattedRH = data.rh === 'N/A' ? 'N/A' : Math.round(data.rh);

            if (format === 'ATAK') {
                content += `${displayHeight}${separator}${formattedDir}${separator}${formattedSpd}\n`;
            } else if (format === 'Windwatch') {
                content += `${displayHeight}${separator}${formattedDir}${separator}${formattedSpd}\n`;
            } else if (format === 'HEIDIS') {
                content += `${displayHeight}${separator}${displayPressure}${separator}${formattedTemp}${separator}${formattedDew}${separator}${formattedDir}${separator}${formattedSpd}${separator}${formattedRH}\n`;
            } else if (format === 'Customized') {
                content += `${displayHeight}${separator}${displayPressure}${separator}${formattedTemp}${separator}${formattedDew}${separator}${formattedDir}${separator}${formattedSpd}${separator}${formattedRH}\n`;
            }
        }
    });

    // Create and trigger the download
    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    // Optionally revert settings (commented out to persist changes in UI)
    document.getElementById('interpStepSelect').value = originalSettings.interpStep;
    document.querySelector(`input[name="heightUnit"][value="${originalSettings.heightUnit}"]`).checked = true;
    document.querySelector(`input[name="refLevel"][value="${originalSettings.refLevel}"]`).checked = true;
    document.querySelector(`input[name="windUnit"][value="${originalSettings.windUnit}"]`).checked = true;
    document.querySelector(`input[name="temperatureUnit"][value="${originalSettings.temperatureUnit}"]`).checked = true;
    Settings.state.userSettings.interpStep = originalSettings.interpStep;
    Settings.state.userSettings.heightUnit = originalSettings.heightUnit;
    Settings.state.userSettings.refLevel = originalSettings.refLevel;
    Settings.state.userSettings.windUnit = originalSettings.windUnit;
    Settings.state.userSettings.temperatureUnit = originalSettings.temperatureUnit;
    Settings.save();
    Settings.updateUnitLabels();
    Settings.updateUnitLabels();
    Settings.updateUnitLabels();

}

// == Ensemble Data Handling ==
async function fetchEnsembleWeatherData() {
    if (!AppState.lastLat || !AppState.lastLng) {
        Utils.handleMessage("Please select a location first.");
        return;
    }
    if (!Settings.state.userSettings.selectedEnsembleModels || Settings.state.userSettings.selectedEnsembleModels.length === 0) {
        AppState.ensembleModelsData = null;
        clearEnsembleVisualizations();
        console.log("No ensemble models selected. Cleared ensemble data and visualizations.");
        return;
    }

    const lat = AppState.lastLat;
    const lon = AppState.lastLng;
    const modelsToFetch = Settings.state.userSettings.selectedEnsembleModels;

    console.log(`Fetching ensemble weather data for models: ${modelsToFetch.join(', ')} at ${lat}, ${lon}`);
    const loadingElement = document.getElementById('loading');
    if (loadingElement) loadingElement.style.display = 'block';


    const modelString = modelsToFetch.join(',');

    // Basisvariablen, die wir von der API erwarten (ohne Modell-Suffix)
    const baseVariablesList = [
        "surface_pressure", "temperature_2m", "relative_humidity_2m", "wind_speed_10m", "wind_direction_10m",
        "geopotential_height_1000hPa", "temperature_1000hPa", "relative_humidity_1000hPa", "wind_speed_1000hPa", "wind_direction_1000hPa",
        "geopotential_height_950hPa", "temperature_950hPa", "relative_humidity_950hPa", "wind_speed_950hPa", "wind_direction_950hPa",
        "geopotential_height_925hPa", "temperature_925hPa", "relative_humidity_925hPa", "wind_speed_925hPa", "wind_direction_925hPa",
        "geopotential_height_900hPa", "temperature_900hPa", "relative_humidity_900hPa", "wind_speed_900hPa", "wind_direction_900hPa",
        "geopotential_height_850hPa", "temperature_850hPa", "relative_humidity_850hPa", "wind_speed_850hPa", "wind_direction_850hPa",
        "geopotential_height_800hPa", "temperature_800hPa", "relative_humidity_800hPa", "wind_speed_800hPa", "wind_direction_800hPa",
        "geopotential_height_700hPa", "temperature_700hPa", "relative_humidity_700hPa", "wind_speed_700hPa", "wind_direction_700hPa",
        "geopotential_height_600hPa", "temperature_600hPa", "relative_humidity_600hPa", "wind_speed_600hPa", "wind_direction_600hPa",
        "geopotential_height_500hPa", "temperature_500hPa", "relative_humidity_500hPa", "wind_speed_500hPa", "wind_direction_500hPa",
        "geopotential_height_400hPa", "temperature_400hPa", "relative_humidity_400hPa", "wind_speed_400hPa", "wind_direction_400hPa",
        "geopotential_height_300hPa", "temperature_300hPa", "relative_humidity_300hPa", "wind_speed_300hPa", "wind_direction_300hPa",
        "geopotential_height_250hPa", "temperature_250hPa", "relative_humidity_250hPa", "wind_speed_250hPa", "wind_direction_250hPa",
        "geopotential_height_200hPa", "temperature_200hPa", "relative_humidity_200hPa", "wind_speed_200hPa", "wind_direction_200hPa"
    ];
    const hourlyVariablesString = baseVariablesList.join(',');

    const historicalDatePicker = document.getElementById('historicalDatePicker');
    const selectedDateValue = historicalDatePicker ? historicalDatePicker.value : null;
    const selectedDate = selectedDateValue ? luxon.DateTime.fromISO(selectedDateValue, { zone: 'utc' }) : null;
    const today = luxon.DateTime.utc().startOf('day');
    const isHistorical = selectedDate && selectedDate < today;

    let startDateStr, endDateStr;
    let baseUrl = 'https://api.open-meteo.com/v1/forecast';

    if (isHistorical) {
        baseUrl = 'https://historical-forecast-api.open-meteo.com/v1/forecast';
        startDateStr = selectedDate.toFormat('yyyy-MM-dd');
        endDateStr = startDateStr;
    } else {
        const now = luxon.DateTime.utc();
        startDateStr = now.toFormat('yyyy-MM-dd');
        endDateStr = now.plus({ days: 7 }).toFormat('yyyy-MM-dd'); // Standard-Vorhersagezeitraum
    }

    const url = `${baseUrl}?latitude=${lat}&longitude=${lon}&hourly=${hourlyVariablesString}&models=${modelString}&start_date=${startDateStr}&end_date=${endDateStr}`;
    console.log("Constructed ensemble URL:", url);

    try {
        const response = await fetch(url);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API request failed: ${response.status} - ${errorText}`);
        }
        const apiResponseData = await response.json(); // Nennen wir es apiResponseData, um Verwechslung zu vermeiden
        console.log("Raw data from OpenMeteo for ensemble request:", JSON.stringify(apiResponseData, null, 2));
        console.log("Models requested:", modelsToFetch);

        AppState.ensembleModelsData = {}; // Wichtig: Hier initialisieren

        if (apiResponseData.error && apiResponseData.reason) {
            throw new Error(`API Error: ${apiResponseData.reason}`);
        }

        if (!apiResponseData.hourly) {
            let errorMsg = 'Unexpected data format: "hourly" field missing in API response.';
            if (apiResponseData && typeof apiResponseData.latitude !== 'undefined') {
                errorMsg = "Received metadata but no 'hourly' data for any requested ensemble model.";
            }
            console.error(errorMsg, apiResponseData);
            throw new Error(errorMsg);
        }

        // Die 'time'-Achse ist für alle Modelle gleich und nicht suffigiert
        const sharedTimeArray = apiResponseData.hourly.time;
        if (!sharedTimeArray) {
            throw new Error("Shared 'time' array missing in hourly data.");
        }

        modelsToFetch.forEach(modelName => {
            const modelSpecificHourlyData = { time: [...sharedTimeArray] }; // Kopiere das Zeitarray
            let foundDataForThisModel = false;

            // Iteriere durch die Basisvariablen und suche die suffigierten Pendants
            baseVariablesList.forEach(baseVar => {
                const suffixedVarKey = `${baseVar}_${modelName}`; // z.B. temperature_2m_icon_global

                if (apiResponseData.hourly[suffixedVarKey]) {
                    modelSpecificHourlyData[baseVar] = apiResponseData.hourly[suffixedVarKey];
                    foundDataForThisModel = true;
                } else if (modelsToFetch.length === 1 && apiResponseData.hourly[baseVar]) {
                    // Fallback für Einzelmodellanfragen, wo Suffixe fehlen könnten
                    modelSpecificHourlyData[baseVar] = apiResponseData.hourly[baseVar];
                    foundDataForThisModel = true;
                } else {
                    modelSpecificHourlyData[baseVar] = null; // Oder new Array(sharedTimeArray.length).fill(null);
                }
            });

            if (foundDataForThisModel) {
                AppState.ensembleModelsData[modelName] = modelSpecificHourlyData;
                console.log(`Successfully processed and stored data for model: ${modelName}`);
            } else {
                console.warn(`No data found for model ${modelName} with suffixed keys in the 'hourly' object. Available keys for this model might be missing or the model is unavailable for this specific request. Hourly keys in response:`, Object.keys(apiResponseData.hourly));
                // Utils.handleMessage(`Warning: No data retrieved for model ${modelName}.`); // Optional: Nutzer informieren
            }
        });


        if (Object.keys(AppState.ensembleModelsData).length === 0 && modelsToFetch.length > 0) {
            const msg = "Could not retrieve and process data for any of the selected ensemble models. They might be unavailable or the API response structure was not as expected for these models.";
            console.warn(msg, "Original API response:", apiResponseData);
            Utils.handleMessage(msg);
        } else {
            console.log("Ensemble weather data processed and stored in AppState.ensembleModelsData:", AppState.ensembleModelsData);
        }

        processAndVisualizeEnsemble();

    } catch (error) {
        console.error('Error in fetchEnsembleWeatherData:', error);
        Utils.handleError(`Failed to fetch ensemble weather data: ${error.message}`);
        AppState.ensembleModelsData = null;
        clearEnsembleVisualizations();
    } finally {
        if (loadingElement) {
            loadingElement.style.display = 'none';
        }
    }
}
function clearEnsembleVisualizations() {
    if (AppState.ensembleLayerGroup) {
        AppState.ensembleLayerGroup.clearLayers();
    } else if (AppState.map) {
        AppState.ensembleLayerGroup = L.layerGroup().addTo(AppState.map);
    }

    // Explizit den alten Heatmap-Layer entfernen, falls er existiert
    if (AppState.heatmapLayer && AppState.map.hasLayer(AppState.heatmapLayer)) {
        AppState.map.removeLayer(AppState.heatmapLayer);
    }
    AppState.heatmapLayer = null;
    AppState.ensembleScenarioCircles = {};
    console.log("Ensemble visualizations cleared.");
}
function processAndVisualizeEnsemble() {
    clearEnsembleVisualizations();

    if (!AppState.ensembleModelsData || Object.keys(AppState.ensembleModelsData).length === 0) {
        console.log("No ensemble data to process.");
        if (Settings.state.userSettings.selectedEnsembleModels.length > 0 && Settings.state.userSettings.currentEnsembleScenario !== 'all_models') {
            Utils.handleMessage("Data for selected ensemble models not yet available. Fetching...");
            fetchEnsembleWeatherData();
        }
        return;
    }

    const scenario = Settings.state.userSettings.currentEnsembleScenario;
    const sliderIndex = getSliderValue();

    console.log(`Processing ensemble scenario: ${scenario} for slider index: ${sliderIndex}`);

    if (scenario === 'heatmap') {
        generateAndDisplayHeatmap();
    } else if (scenario === 'all_models') {
        for (const modelName in AppState.ensembleModelsData) {
            if (Object.hasOwnProperty.call(AppState.ensembleModelsData, modelName)) {
                const modelHourlyData = AppState.ensembleModelsData[modelName];
                const tempWeatherData = { hourly: modelHourlyData };
                const exitResult = calculateExitCircleForEnsemble(modelName, tempWeatherData); // KORREKTUR HIER
                if (exitResult) {
                    const color = getDistinctColorForModel(modelName);
                    drawEnsembleCircle(exitResult, color, modelName); // KORREKTUR HIER
                }
            }
        }
    } else { // Min, Mean, Max scenarios
        const scenarioProfile = calculateEnsembleScenarioProfile(scenario); // sliderIndex wird intern geholt
        if (scenarioProfile) {
            const exitResult = calculateExitCircleForEnsemble(scenario, scenarioProfile); // KORREKTUR HIER
            if (exitResult) {
                const color = getDistinctColorForScenario(scenario);
                drawEnsembleCircle(exitResult, color, scenario.replace('_', ' ')); // KORREKTUR HIER
            }
        } else {
            console.warn(`Could not calculate profile for scenario: ${scenario}`);
            Utils.handleMessage(`Could not generate '${scenario.replace('_', ' ')}' profile. Not enough data?`);
        }
    }
}
function getDistinctColorForModel(modelName) {
    let hash = 0;
    for (let i = 0; i < modelName.length; i++) {
        hash = modelName.charCodeAt(i) + ((hash << 5) - hash);
        hash = hash & hash; // Convert to 32bit integer
    }
    const hue = hash % 360;
    return `hsl(${hue}, 70%, 60%)`; // HSL für bessere Farbverteilung
}
function getDistinctColorForScenario(scenario) {
    if (scenario === 'min_wind') return 'rgba(0, 0, 255, 0.7)';    // Blau
    if (scenario === 'mean_wind') return 'rgba(0, 255, 0, 0.7)';   // Grün
    if (scenario === 'max_wind') return 'rgba(255, 0, 0, 0.7)';    // Rot
    return 'rgba(128, 128, 128, 0.7)'; // Grau für Fallback
}
function drawEnsembleCircle(exitResult, color, label) {
    if (!AppState.map || !exitResult || !AppState.ensembleLayerGroup) return;

    const center = [exitResult.centerLat, exitResult.centerLng];

    const circle = L.circle(center, {
        radius: exitResult.radius,
        color: color,
        fillColor: color,
        fillOpacity: 0.15,
        weight: 2,
        dashArray: '5, 10'
    }).addTo(AppState.ensembleLayerGroup);

    const userWindUnit = Settings.getValue('windUnit', 'radio', 'kt');

    // Prüfen, ob meanWindSpeedMps eine gültige Zahl ist
    let formattedMeanWindSpeed = 'N/A';
    if (exitResult.meanWindSpeedMps !== 'N/A' && Number.isFinite(exitResult.meanWindSpeedMps)) {
        const meanWindSpeedConverted = Utils.convertWind(exitResult.meanWindSpeedMps, userWindUnit, 'm/s');

        // Zusätzliche Prüfung, da convertWind 'N/A' zurückgeben kann
        if (meanWindSpeedConverted !== 'N/A' && Number.isFinite(meanWindSpeedConverted)) {
            formattedMeanWindSpeed = userWindUnit === 'bft' ?
                Math.round(meanWindSpeedConverted) :
                meanWindSpeedConverted.toFixed(1);
        }
    }

    const openingAltitudeAGL = parseInt(document.getElementById('openingAltitude')?.value) || Settings.state.userSettings.openingAltitude || 1200;
    const lowerLimitDisplay = parseInt(document.getElementById('legHeightDownwind')?.value) || Settings.state.userSettings.legHeightDownwind || 0;
    const upperLimitDisplay = openingAltitudeAGL - 200;

    const heightUnit = Settings.getValue('heightUnit', 'radio', 'm');
    const lowerLimitFormatted = Math.round(Utils.convertHeight(lowerLimitDisplay, heightUnit));
    const upperLimitFormatted = Math.round(Utils.convertHeight(upperLimitDisplay, heightUnit));

    const meanWindDirFormatted = (exitResult.meanWindDir !== 'N/A' && Number.isFinite(exitResult.meanWindDir))
        ? Utils.roundToTens(exitResult.meanWindDir)
        : 'N/A';

    const tooltipText = `<strong>${label}</strong><br>` +
        `Mean Wind ${lowerLimitFormatted}-${upperLimitFormatted} ${heightUnit} AGL:<br>` +
        `${meanWindDirFormatted}° ${formattedMeanWindSpeed} ${userWindUnit}`;

    circle.bindTooltip(tooltipText, {
        permanent: false,
        direction: 'top',
        className: 'wind-tooltip',
        opacity: 0.9
    });

    AppState.ensembleScenarioCircles[label] = circle;
    console.log(`Drew ensemble circle for ${label} at [${center.join(', ')}], radius ${exitResult.radius}`);
}
function calculateEnsembleScenarioProfile(scenarioType /* sliderIndex hier nicht mehr als direkter Parameter nötig, wird in der Schleife verwendet */) {
    if (!AppState.ensembleModelsData || Object.keys(AppState.ensembleModelsData).length === 0) {
        console.warn("No ensemble data available for profile calculation.");
        return null;
    }

    const numModels = Object.keys(AppState.ensembleModelsData).length;
    if (numModels === 0) return null;

    console.log(`Calculating full time-series ensemble profile for: ${scenarioType}`);

    const scenarioHourlyData = {}; // Das wird das neue 'hourly'-Objekt für das Szenario

    // Annahme: Alle Modelle haben die gleiche Zeitachsenstruktur. Nehmen Sie sie vom ersten Modell.
    const firstModelName = Object.keys(AppState.ensembleModelsData)[0];
    const timeArrayFromFirstModel = AppState.ensembleModelsData[firstModelName]?.time; // ?. für Sicherheit

    if (!timeArrayFromFirstModel || timeArrayFromFirstModel.length === 0) {
        console.error("Time data missing or empty in the first ensemble model for profile calculation.");
        return null;
    }
    scenarioHourlyData.time = [...timeArrayFromFirstModel]; // Kopiere das vollständige Zeitarray

    const numTimeSteps = scenarioHourlyData.time.length;

    // Basisvariablen (ohne Modell-Suffix), die aggregiert werden sollen
    const baseVariablesToProcess = [
        "surface_pressure", "temperature_2m", "relative_humidity_2m",
        "geopotential_height_1000hPa", "temperature_1000hPa", "relative_humidity_1000hPa",
        "geopotential_height_950hPa", "temperature_950hPa", "relative_humidity_950hPa",
        "geopotential_height_925hPa", "temperature_925hPa", "relative_humidity_925hPa",
        "geopotential_height_900hPa", "temperature_900hPa", "relative_humidity_900hPa",
        "geopotential_height_850hPa", "temperature_850hPa", "relative_humidity_850hPa",
        "geopotential_height_800hPa", "temperature_800hPa", "relative_humidity_800hPa",
        "geopotential_height_700hPa", "temperature_700hPa", "relative_humidity_700hPa",
        "geopotential_height_600hPa", "temperature_600hPa", "relative_humidity_600hPa",
        "geopotential_height_500hPa", "temperature_500hPa", "relative_humidity_500hPa",
        "geopotential_height_400hPa", "temperature_400hPa", "relative_humidity_400hPa",
        "geopotential_height_300hPa", "temperature_300hPa", "relative_humidity_300hPa",
        "geopotential_height_250hPa", "temperature_250hPa", "relative_humidity_250hPa",
        "geopotential_height_200hPa", "temperature_200hPa", "relative_humidity_200hPa"
    ];

    // Windvariablen-Paare (Basisnamen)
    const windVariablePairs = [
        ["wind_speed_10m", "wind_direction_10m"]
    ];
    const pressureLevels = [1000, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200];
    pressureLevels.forEach(p => {
        windVariablePairs.push([`wind_speed_${p}hPa`, `wind_direction_${p}hPa`]);
    });

    // Initialisiere die Arrays in scenarioHourlyData mit der korrekten Länge
    baseVariablesToProcess.forEach(varName => {
        scenarioHourlyData[varName] = new Array(numTimeSteps).fill(null);
    });
    windVariablePairs.forEach(pair => {
        scenarioHourlyData[pair[0]] = new Array(numTimeSteps).fill(null); // für Geschwindigkeit
        scenarioHourlyData[pair[1]] = new Array(numTimeSteps).fill(null); // für Richtung
    });

    // Iteriere durch jeden Zeitschritt der gesamten Vorhersageperiode
    for (let t = 0; t < numTimeSteps; t++) {
        // Verarbeite nicht-Wind Variablen
        baseVariablesToProcess.forEach(varName => {
            const valuesAtTimeStep = [];
            for (const modelName in AppState.ensembleModelsData) {
                // Stelle sicher, dass das Modell auch Daten für diese Variable hat
                const modelHourly = AppState.ensembleModelsData[modelName];
                if (modelHourly && modelHourly[varName]) {
                    const val = modelHourly[varName][t]; // Zugriff auf den t-ten Wert
                    if (val !== null && val !== undefined && !isNaN(val)) {
                        valuesAtTimeStep.push(val);
                    }
                }
            }
            if (valuesAtTimeStep.length > 0) {
                if (scenarioType === 'min_wind') scenarioHourlyData[varName][t] = Math.min(...valuesAtTimeStep);
                else if (scenarioType === 'max_wind') scenarioHourlyData[varName][t] = Math.max(...valuesAtTimeStep);
                else scenarioHourlyData[varName][t] = valuesAtTimeStep.reduce((a, b) => a + b, 0) / valuesAtTimeStep.length; // Mean
            }
            // Wenn keine Werte vorhanden sind, bleibt der Wert null (durch Initialisierung oben)
        });

        // Verarbeite Windvariablen
        windVariablePairs.forEach(pair => {
            const speedVarName = pair[0];
            const dirVarName = pair[1];
            let u_components_t = [];
            let v_components_t = [];
            let speeds_t = [];
            let dirs_t = [];

            for (const modelName in AppState.ensembleModelsData) {
                const modelHourly = AppState.ensembleModelsData[modelName];
                if (modelHourly && modelHourly[speedVarName] && modelHourly[dirVarName]) {
                    const speed = modelHourly[speedVarName][t];
                    const dir = modelHourly[dirVarName][t];
                    if (speed !== null && speed !== undefined && !isNaN(speed) &&
                        dir !== null && dir !== undefined && !isNaN(dir)) {
                        speeds_t.push(speed);
                        dirs_t.push(dir);
                        u_components_t.push(-speed * Math.sin(dir * Math.PI / 180));
                        v_components_t.push(-speed * Math.cos(dir * Math.PI / 180));
                    }
                }
            }

            if (speeds_t.length > 0) {
                if (scenarioType === 'min_wind') {
                    const minSpeed = Math.min(...speeds_t);
                    const minIndex = speeds_t.indexOf(minSpeed);
                    scenarioHourlyData[speedVarName][t] = minSpeed;
                    scenarioHourlyData[dirVarName][t] = dirs_t[minIndex];
                } else if (scenarioType === 'max_wind') {
                    const maxSpeed = Math.max(...speeds_t);
                    const maxIndex = speeds_t.indexOf(maxSpeed);
                    scenarioHourlyData[speedVarName][t] = maxSpeed;
                    scenarioHourlyData[dirVarName][t] = dirs_t[maxIndex];
                } else { // mean_wind
                    const mean_u = u_components_t.reduce((a, b) => a + b, 0) / u_components_t.length;
                    const mean_v = v_components_t.reduce((a, b) => a + b, 0) / v_components_t.length;
                    scenarioHourlyData[speedVarName][t] = Utils.windSpeed(mean_u, mean_v);
                    scenarioHourlyData[dirVarName][t] = Utils.windDirection(mean_u, mean_v);
                }
            }
            // Wenn keine Werte vorhanden sind, bleiben die Werte null
        });
    }
    // console.log(`Vollständiges Zeitreihenprofil für ${scenarioType}:`, scenarioHourlyData);
    return { hourly: scenarioHourlyData }; // Struktur wie eine einzelne API-Modellantwort
}
/**
 * Berechnet die Canopy-Kreise für ein gegebenes Ensemble-Profil oder ein einzelnes Modell aus dem Ensemble.
 * @param {string} profileIdentifier - Name des Modells oder Szenarios (z.B. "icon_global", "min_wind").
 * @param {object} [specificProfileData=null] - Optionale, spezifische Wetterdaten für das Profil.
 * Wenn null, wird versucht, die Daten aus AppState.ensembleModelsData[profileIdentifier] zu verwenden.
 * @returns {object|null} Das Ergebnis von calculateCanopyCircles oder null bei Fehler.
 */
function calculateCanopyCirclesForEnsemble(profileIdentifier, specificProfileData = null) {
    console.log(`Calculating canopy circles for ensemble profile/model: ${profileIdentifier}`);

    // Bestimme die zu verwendenden Wetterdaten
    let weatherDataForProfile;
    if (specificProfileData) {
        weatherDataForProfile = specificProfileData; // Direkte Übergabe für Min/Mean/Max Profile
    } else if (AppState.ensembleModelsData && AppState.ensembleModelsData[profileIdentifier]) {
        // Für 'all_models'-Szenario, hole Daten des spezifischen Modells
        weatherDataForProfile = { hourly: AppState.ensembleModelsData[profileIdentifier] };
    } else {
        console.warn(`Keine Daten für Profil/Modell ${profileIdentifier} in calculateCanopyCirclesForEnsemble gefunden.`);
        return null;
    }

    if (!weatherDataForProfile.hourly || !AppState.lastLat || !AppState.lastLng) {
        console.warn(`Unvollständige Daten für calculateCanopyCirclesForEnsemble: ${profileIdentifier}`);
        return null;
    }

    const originalGlobalWeatherData = AppState.weatherData;
    const originalShowCanopyArea = Settings.state.userSettings.showCanopyArea;
    const originalCalculateJump = Settings.state.userSettings.calculateJump;

    AppState.weatherData = weatherDataForProfile.hourly;
    // Für Ensemble-Visualisierung temporär die Bedingungen erfüllen,
    // oder calculateCanopyCircles so anpassen, dass es diese optional ignoriert.
    Settings.state.userSettings.showCanopyArea = true; // Temporär setzen
    Settings.state.userSettings.calculateJump = true;  // Temporär setzen

    let result = null;
    try {
        result = JumpPlanner.calculateCanopyCircles();
    } catch (error) {
        console.error(`Fehler in calculateCanopyCircles für Profil ${profileIdentifier}:`, error);
        result = null;
    } finally {
        AppState.weatherData = originalGlobalWeatherData;
        Settings.state.userSettings.showCanopyArea = originalShowCanopyArea; // Zurücksetzen
        Settings.state.userSettings.calculateJump = originalCalculateJump;  // Zurücksetzen
        // Settings.save(); // Nicht hier speichern, da es temporäre Änderungen sind
    }

    if (result) {
        // Die Visualisierungsfunktion erwartet eine vereinfachte Struktur.
        // Wir verwenden hier die Daten des "roten Kreises" (volle Distanz).
        return {
            centerLat: result.redLat,
            centerLng: result.redLng,
            radius: result.radiusFull,
            displacement: result.displacementFull,
            direction: result.directionFull,
            meanWindDir: result.meanWindForFullCanopyDir, // Die tatsächliche Mittelwindrichtung
            meanWindSpeedMps: result.meanWindForFullCanopySpeedMps, // Die Mittelwindgeschwindigkeit in m/s
            profileIdentifier: profileIdentifier // Behalte die ID für Tooltips etc.
        };
    }
    console.warn(`calculateCanopyCircles lieferte null für Profil ${profileIdentifier}`);
    return null;
}
/**
 * Berechnet die Exit-Kreise für ein gegebenes Ensemble-Profil oder ein einzelnes Modell.
 * @param {string} profileIdentifier - Name des Modells oder Szenarios (z.B. "icon_global", "min_wind").
 * @param {object} [specificProfileData=null] - Optionale, spezifische Wetterdaten für das Profil.
 * @returns {object|null} Das Ergebnis von calculateExitCircle oder null bei Fehler.
 */
function calculateExitCircleForEnsemble(profileIdentifier, specificProfileData = null) {
    console.log(`Calculating exit circle for ensemble profile/model: ${profileIdentifier}`);

    let weatherDataForProfile;
    if (specificProfileData) {
        weatherDataForProfile = specificProfileData;
    } else if (AppState.ensembleModelsData && AppState.ensembleModelsData[profileIdentifier]) {
        weatherDataForProfile = { hourly: AppState.ensembleModelsData[profileIdentifier] };
    } else {
        console.warn(`No data for profile/model ${profileIdentifier} in calculateExitCircleForEnsemble found.`);
        return null;
    }

    if (!weatherDataForProfile.hourly || !AppState.lastLat || !AppState.lastLng || AppState.lastAltitude === 'N/A') {
        console.warn(`Incomplete data for calculateExitCircleForEnsemble: ${profileIdentifier}`);
        return null;
    }

    const originalGlobalWeatherData = AppState.weatherData;
    AppState.weatherData = weatherDataForProfile.hourly;

    let result = null;
    let meanWindResult = { meanWindDir: 'N/A', meanWindSpeedMps: 'N/A' };

    try {
        const originalCalculateJump = Settings.state.userSettings.calculateJump;
        const originalShowExitArea = Settings.state.userSettings.showExitArea;
        Settings.state.userSettings.calculateJump = true;
        Settings.state.userSettings.showExitArea = true;

        result = JumpPlanner.calculateExitCircle();

        // Mittelwind für den Tooltip berechnen (Logik aus Ihrer drawEnsembleCircle-Funktion extrahiert)
        const sliderIndex = getSliderValue();
        const interpolatedData = interpolateWeatherData(sliderIndex);
        if (interpolatedData && interpolatedData.length > 0) {
            const heights = interpolatedData.map(d => d.height);
            const dirs = interpolatedData.map(d => Number.isFinite(d.dir) ? parseFloat(d.dir) : 0);
            const spdsMps = interpolatedData.map(d => Utils.convertWind(parseFloat(d.spd) || 0, 'm/s', 'km/h'));
            const uComponents = spdsMps.map((spd, i) => -spd * Math.sin(dirs[i] * Math.PI / 180));
            const vComponents = spdsMps.map((spd, i) => -spd * Math.cos(dirs[i] * Math.PI / 180));

            const openingAltitudeAGL = parseInt(document.getElementById('openingAltitude')?.value) || Settings.state.userSettings.openingAltitude || 1200;
            const legHeightDownwind = parseInt(document.getElementById('legHeightDownwind')?.value) || Settings.state.userSettings.legHeightDownwind || 0;
            const elevation = Math.round(AppState.lastAltitude);

            const upperLimit = elevation + openingAltitudeAGL - 200;
            const lowerLimit = elevation + legHeightDownwind;

            const meanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, lowerLimit, upperLimit);
            if (meanWind && Number.isFinite(meanWind[0]) && Number.isFinite(meanWind[1])) {
                meanWindResult = {
                    meanWindDir: meanWind[0],
                    meanWindSpeedMps: meanWind[1]
                };
            }
        }

        Settings.state.userSettings.calculateJump = originalCalculateJump;
        Settings.state.userSettings.showExitArea = originalShowExitArea;

    } catch (error) {
        console.error(`Error in calculateExitCircle for profile ${profileIdentifier}:`, error);
        result = null;
    } finally {
        AppState.weatherData = originalGlobalWeatherData;
    }

    if (result) {
        return {
            centerLat: result.darkGreenLat,
            centerLng: result.darkGreenLng,
            radius: result.darkGreenRadius,
            freeFallDirection: result.freeFallDirection,
            freeFallDistance: result.freeFallDistance,
            freeFallTime: result.freeFallTime,
            meanWindDir: meanWindResult.meanWindDir,
            meanWindSpeedMps: meanWindResult.meanWindSpeedMps,
            profileIdentifier: profileIdentifier
        };
    }
    console.warn(`calculateExitCircle returned null for profile ${profileIdentifier}`);
    return null;
}
export function calculateDynamicRadius(baseRadius = 20, referenceZoom = 13) {
    const currentZoom = AppState.map.getZoom();
    // NEU: Anstatt der festen "2" verwenden wir eine anpassbare Basis.
    // Ein Wert um 1.6 ist oft ein guter Kompromiss.
    // - Näher an 1: Sanftere Skalierung
    // - Näher an 2: Aggressivere Skalierung
    const scalingBase = 1.42;

    const scaleFactor = Math.pow(scalingBase, currentZoom - referenceZoom);
    const dynamicRadius = baseRadius * scaleFactor;
    // Clamp radius to reasonable bounds to avoid extreme values
    const minRadius = 5;  // Minimum radius to avoid disappearing at high zooms
    const maxRadius = 50; // Maximum radius to avoid excessive spread at low zooms
    const adjustedRadius = Math.max(minRadius, Math.min(maxRadius, dynamicRadius));
    console.log('[calculateDynamicRadius] Calculated dynamic radius:', { currentZoom, baseRadius, scaleFactor, dynamicRadius, adjustedRadius });
    return adjustedRadius;
}
function generateAndDisplayHeatmap() {

    // 1. Clear previous visualizations
    clearEnsembleVisualizations();
    if (AppState.heatmapLayer) {
        AppState.map.removeLayer(AppState.heatmapLayer);
        AppState.heatmapLayer = null;
    }

    // 2. Check if there is data
    if (!AppState.ensembleModelsData || Object.keys(AppState.ensembleModelsData).length < 2) {
        Utils.handleMessage("Please select at least two ensemble models to generate a heatmap.");
        return;
    }

    // 3. Calculate all individual model circles
    const modelCircles = [];
    for (const modelName in AppState.ensembleModelsData) {
        if (Object.hasOwnProperty.call(AppState.ensembleModelsData, modelName)) {
            const modelHourlyData = AppState.ensembleModelsData[modelName];
            const exitResult = calculateExitCircleForEnsemble(modelName, { hourly: modelHourlyData });

            if (exitResult) {
                // KORREKTUR: Das Zentrum ist bereits korrekt in exitResult.centerLat/centerLng.
                // Die zusätzliche Berechnung mit calculateNewCenter wird entfernt.
                modelCircles.push({
                    centerLat: exitResult.centerLat,
                    centerLng: exitResult.centerLng,
                    radius: exitResult.radius
                });
            }
        }
    }

    if (modelCircles.length === 0) {
        console.warn("Could not calculate any circles for the heatmap.");
        return;
    }
    console.log(`[Heatmap] Calculated ${modelCircles.length} model circles.`);

    // 4. Bounding-Box und Raster-Berechnung (bleibt unverändert)
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    const metersPerDegree = 111320;
    modelCircles.forEach(circle => {
        const latRadius = circle.radius / metersPerDegree;
        const lngRadius = circle.radius / (metersPerDegree * Math.cos(circle.centerLat * Math.PI / 180));
        minLat = Math.min(minLat, circle.centerLat - latRadius);
        maxLat = Math.max(maxLat, circle.centerLat + latRadius);
        minLng = Math.min(minLng, circle.centerLng - lngRadius);
        maxLng = Math.max(maxLng, circle.centerLng + lngRadius);
    });

    const gridResolution = 40;
    const latStep = gridResolution / metersPerDegree;
    const heatmapPoints = [];

    console.log("[Heatmap] Starting grid calculation...");
    for (let lat = minLat; lat <= maxLat; lat += latStep) {
        const lngStep = gridResolution / (metersPerDegree * Math.cos(lat * Math.PI / 180));
        for (let lng = minLng; lng <= maxLng; lng += lngStep) {
            let overlapCount = 0;
            const gridCellLatLng = L.latLng(lat, lng);
            modelCircles.forEach(circle => {
                const circleCenterLatLng = L.latLng(circle.centerLat, circle.centerLng);
                const distance = AppState.map.distance(gridCellLatLng, circleCenterLatLng);
                if (distance <= circle.radius) {
                    overlapCount++;
                }
            });
            if (overlapCount > 0) {
                heatmapPoints.push([lat, lng, overlapCount]);
            }
        }
    }
    console.log(`[Heatmap] Finished grid calculation. Generated ${heatmapPoints.length} heatmap points.`);

    // 5. Heatmap-Layer erstellen und anzeigen (bleibt unverändert)
    if (heatmapPoints.length > 0) {
        const maxOverlap = modelCircles.length;
        const gradient = {};

        if (maxOverlap === 1) {
            gradient[1.0] = 'lime';
        } else {
            for (let i = 1; i <= maxOverlap; i++) {
                const ratio = i / maxOverlap;
                if (i === 1) {
                    gradient[ratio] = 'red';
                } else if (i < maxOverlap) {
                    gradient[ratio] = 'yellow';
                } else {
                    gradient[ratio] = 'lime';
                }
            }
        }

        console.log("[Heatmap] Using gradient:", gradient);

        if (AppState.heatmapLayer) {
            AppState.map.removeLayer(AppState.heatmapLayer);
        }

        const dynamicRadius = calculateDynamicRadius(HEATMAP_BASE_RADIUS, HEATMAP_REFERENCE_ZOOM);

        AppState.heatmapLayer = L.heatLayer(heatmapPoints, {
            radius: dynamicRadius,
            blur: 10,
            max: maxOverlap,
            minOpacity: 0.01,
            gradient: gradient
        }).addTo(AppState.map);
    } else {
        Utils.handleMessage("No overlapping landing areas found for the selected models.");
    }
}

// == Autoupdate Functionality ==
export function setupAutoupdate() {
    const autoupdateCheckbox = document.getElementById('autoupdateCheckbox');
    if (!autoupdateCheckbox) {
        console.warn('Autoupdate checkbox not found');
        return;
    }

    // Initialize checkbox state
    autoupdateCheckbox.checked = Settings.state.userSettings.autoupdate;
    console.log('Autoupdate checkbox initialized:', autoupdateCheckbox.checked);

    autoupdateCheckbox.addEventListener('change', () => {
        Settings.state.userSettings.autoupdate = autoupdateCheckbox.checked;
        Settings.save();
        console.log('Autoupdate changed to:', autoupdateCheckbox.checked);

        // Check if historical date is set
        const historicalDatePicker = document.getElementById('historicalDatePicker');
        if (autoupdateCheckbox.checked && historicalDatePicker?.value) {
            autoupdateCheckbox.checked = false;
            Settings.state.userSettings.autoupdate = false;
            Settings.save();
            Utils.handleError('Autoupdate cannot be enabled with a historical date set.');
            return;
        }

        if (autoupdateCheckbox.checked) {
            startAutoupdate();
        } else {
            stopAutoupdate();
        }
    });

    // Start autoupdate if enabled on load
    if (Settings.state.userSettings.autoupdate && !document.getElementById('historicalDatePicker')?.value) {
        startAutoupdate();
    }
}
export function startAutoupdate() {
    if (AppState.autoupdateInterval) {
        console.log('Autoupdate already running, skipping start');
        return;
    }

    if (!navigator.onLine) {
        console.warn('Cannot start autoupdate: offline');
        Utils.handleError('Cannot enable autoupdate while offline.');
        document.getElementById('autoupdateCheckbox').checked = false;
        Settings.state.userSettings.autoupdate = false;
        Settings.save();
        return;
    }

    console.log('Starting autoupdate');
    updateToCurrentHour();

    // Check every minute for hour changes
    AppState.autoupdateInterval = setInterval(() => {
        const now = new Date();
        const currentHour = now.getUTCHours();
        const slider = document.getElementById('timeSlider');
        const currentSliderHour = parseInt(slider?.value) || 0;

        if (currentHour !== currentSliderHour) {
            console.log(`Hour changed to ${currentHour}, updating weather data`);
            updateToCurrentHour();
        }
    }, 60 * 1000); // Every minute

    Utils.handleMessage('Autoupdate enabled');
}
export function stopAutoupdate() {
    if (AppState.autoupdateInterval) {
        clearInterval(AppState.autoupdateInterval);
        AppState.autoupdateInterval = null;
        console.log('Autoupdate stopped');
        Utils.handleMessage('Autoupdate disabled');
    }
}
export async function updateToCurrentHour() {
    if (!AppState.lastLat || !AppState.lastLng) {
        console.warn('No location selected, cannot update weather data');
        Utils.handleError('Please select a location to enable autoupdate.');
        stopAutoupdate();
        document.getElementById('autoupdateCheckbox').checked = false;
        Settings.state.userSettings.autoupdate = false;
        Settings.save();
        return;
    }

    if (!navigator.onLine) {
        console.warn('Cannot update weather data: offline');
        Utils.handleError('Cannot update weather data while offline.');
        stopAutoupdate();
        document.getElementById('autoupdateCheckbox').checked = false;
        Settings.state.userSettings.autoupdate = false;
        Settings.save();
        return;
    }

    const slider = document.getElementById('timeSlider');
    if (!slider) {
        console.warn('Time slider not found, cannot update to current hour');
        return;
    }

    const now = new Date();
    const currentHour = now.getUTCHours();
    slider.value = currentHour;
    console.log(`Set slider to current hour: ${currentHour}`);

    try {
        await fetchWeatherForLocation(AppState.lastLat, AppState.lastLng, null, false);
        console.log('Weather data fetched for current hour');

        await updateWeatherDisplay(currentHour);
        if (AppState.lastAltitude !== 'N/A') {
            calculateMeanWind();
        }
        if (Settings.state.userSettings.calculateJump && isCalculateJumpUnlocked) {
            debouncedCalculateJump();
            JumpPlanner.calculateCutAway();
            if (Settings.state.userSettings.showJumpRunTrack) {
                updateJumpRunTrackDisplay();
            }
        }
        console.log('Updated all displays for current hour');
    } catch (error) {
        console.error('Error updating to current hour:', error);
        Utils.handleError('Failed to update weather data: ' + error.message);
    }
}

// == Jump and Free Fall Calculations ==
export function visualizeFreeFallPath(path) {
    if (!AppState.map || !Settings.state.userSettings.calculateJump) return;

    const latLngs = path.map(point => point.latLng);
    const freeFallPolyline = L.polyline(latLngs, {
        color: 'purple',
        weight: 3,
        opacity: 0.7,
        dashArray: '10, 10'
    }).addTo(AppState.map);

    freeFallPolyline.bindPopup(`Free Fall Path<br>Duration: ${path[path.length - 1].time.toFixed(1)}s<br>Distance: ${Math.sqrt(path[path.length - 1].latLng[0] ** 2 + path[path.length - 1].latLng[1] ** 2).toFixed(1)}m`);
}

// Isolated calculation functions

function calculateJump() {
    console.log('App: Starte Sprungberechnung und erstelle Bauanleitung...');

    if (!AppState.weatherData || !AppState.lastLat || !AppState.lastLng) {
        mapManager.drawJumpVisualization(null); // Befehl an den Maler: "Alles wegmachen"
        return;
    }

    // Dies ist die "Bauanleitung" für den Maler
    const visualizationData = {
        exitCircles: [],
        canopyCircles: [],
        canopyLabels: []
    };

    // -- BAUANLEITUNG FÜR EXIT AREA FÜLLEN --
    if (Settings.state.userSettings.showExitArea) {
        const exitResult = JumpPlanner.calculateExitCircle();
        if (exitResult) {
            // Füge die fertigen Zeichen-Instruktionen zur Bauanleitung hinzu
            visualizationData.exitCircles.push({
                center: [exitResult.greenLat, exitResult.greenLng],
                radius: exitResult.greenRadius,
                color: 'green'
            });
            visualizationData.exitCircles.push({
                center: [exitResult.darkGreenLat, exitResult.darkGreenLng],
                radius: exitResult.darkGreenRadius,
                color: 'darkgreen'
            });
        }
    }

    // -- BAUANLEITUNG FÜR CANOPY AREA FÜLLEN --
    if (Settings.state.userSettings.showCanopyArea) {
        const canopyResult = JumpPlanner.calculateCanopyCircles();
        if (canopyResult) {
            // HIER findet die Berechnung statt!
            const redCenter = Utils.calculateNewCenter(canopyResult.redLat, canopyResult.redLng, canopyResult.displacementFull, canopyResult.directionFull);

            // Füge die fertige Instruktion für den roten Kreis hinzu
            visualizationData.canopyCircles.push({
                center: redCenter,
                radius: canopyResult.radiusFull,
                color: 'red',
                weight: 2,
                opacity: 0.8
            });

            // Erstelle die Instruktionen für die blauen Kreise
            canopyResult.additionalBlueRadii.forEach((radius, i) => {
                const center = Utils.calculateNewCenter(canopyResult.blueLat, canopyResult.blueLng, canopyResult.additionalBlueDisplacements[i], canopyResult.additionalBlueDirections[i]);
                visualizationData.canopyCircles.push({
                    center: center,
                    radius: radius,
                    color: 'blue',
                    weight: 1,
                    opacity: 0.1
                });
                visualizationData.canopyLabels.push({
                    center: center,
                    text: `${Math.round(canopyResult.additionalBlueUpperLimits[i])}m`
                });
            });
        }
    }

    // Übergebe die fertige Bauanleitung an den Maler
    mapManager.drawJumpVisualization(visualizationData);
}
export function clearIsolineMarkers() {
    console.log('clearIsolineMarkers called');
    if (!AppState.map) {
        console.warn('Map not available in clearIsolineMarkers');
        return;
    }

    let markerCount = 0;
    AppState.map.eachLayer(layer => {
        if (layer instanceof L.Marker &&
            layer !== AppState.currentMarker &&
            layer !== AppState.cutAwayMarker &&
            layer !== AppState.liveMarker &&
            layer !== AppState.harpMarker && // Skip harpMarker
            layer.options.icon &&
            layer.options.icon.options &&
            typeof layer.options.icon.options.className === 'string' &&
            layer.options.icon.options.className.match(/isoline-label/) &&
            !layer.options.icon.options.className.match(/landing-pattern-arrow|wind-arrow-icon/)) {
            console.log('Removing isoline-label marker:', layer, 'className:', layer.options.icon.options.className);
            layer.remove();
            markerCount++;
        } else if (layer === AppState.currentMarker) {
            console.log('Skipping currentMarker:', layer, 'className:', layer.options?.icon?.options?.className || 'none');
        } else if (layer === AppState.cutAwayMarker) {
            console.log('Skipping cutAwayMarker:', layer, 'className:', layer.options?.icon?.options?.className || 'none');
        } else if (layer === AppState.liveMarker) {
            console.log('Skipping liveMarker:', layer, 'className:', layer.options?.icon?.options?.className || 'none');
        } else if (layer === AppState.harpMarker) {
            console.log('Skipping harpMarker:', layer, 'className:', layer.options?.icon?.options?.className || 'none');
        } else if (layer instanceof L.Marker &&
            layer.options.icon &&
            layer.options.icon.options &&
            typeof layer.options.icon.options.className === 'string' &&
            layer.options.icon.options.className.match(/landing-pattern-arrow|wind-arrow-icon/)) {
            console.log('Skipping landing pattern arrow marker:', layer, 'className:', layer.options.icon.options.className);
        }
    });
    console.log('Cleared', markerCount, 'isoline-label markers');
    // Fallback: Remove only markers that are not currentMarker, AppState.cutAwayMarker, AppState.liveMarker, or AppState.harpMarker
    if (markerCount === 0) {
        AppState.map.eachLayer(layer => {
            if (layer instanceof L.Marker &&
                layer !== AppState.currentMarker &&
                layer !== AppState.cutAwayMarker &&
                layer !== AppState.liveMarker &&
                layer !== AppState.harpMarker &&
                (!layer.options.icon ||
                    !layer.options.icon.options ||
                    !layer.options.icon.options.className ||
                    !layer.options.icon.options.className.match(/landing-pattern-arrow|wind-arrow-icon/))) {
                console.log('Fallback: Removing marker:', layer, 'className:', layer.options?.icon?.options?.className || 'none');
                layer.remove();
            }
        });
    }
}
export function resetJumpRunDirection(triggerUpdate = true) {
    AppState.customJumpRunDirection = null;
    const directionInput = document.getElementById('jumpRunTrackDirection');
    if (directionInput) {
        directionInput.value = '';
        console.log('Cleared jumpRunTrackDirection input');
    }
    console.log('Reset JRT direction to calculated');
    if (triggerUpdate && Settings.state.userSettings.showJumpRunTrack && AppState.weatherData && AppState.lastLat && AppState.lastLng) {
        console.log('Triggering JRT update after reset');
        updateJumpRunTrackDisplay();
    }
}
export function calculateJumpRunTrack() {
    if (!Settings.state.userSettings.showJumpRunTrack || !Settings.state.userSettings.calculateJump || !AppState.weatherData || !AppState.lastLat || !AppState.lastLng) {
        console.log('Skipping calculateJumpRunTrack: conditions not met');
        return null;
    }
    console.log('Calculating jump run track...');
    updateJumpRunTrackDisplay();
    const trackData = JumpPlanner.jumpRunTrack();
    return trackData;
}

// Dies ist die neue Funktion, die die ganze "Denkarbeit" leistet.
export function updateLandingPatternDisplay() {

    // --- TEIL A: DATEN SAMMELN UND PRÜFEN (1:1 aus Ihrer alten Funktion) ---
    if (!Settings.state.userSettings.showLandingPattern || !AppState.weatherData || !AppState.lastLat) {
        mapManager.drawLandingPattern(null); // Sagt dem Kellner: "Tisch abräumen"
        return;
    }

    const currentZoom = AppState.map.getZoom();
    if (currentZoom < Constants.landingPatternMinZoom) {
        console.log('Landing pattern not displayed - zoom too low:', currentZoom);
        // Sende den Befehl "Alles wegmachen" an den Maler und beende die Funktion.
        mapManager.drawLandingPattern(null);
        return;
    }

    //... (alle Zeilen von "const sliderIndex = ..." bis "if (!interpolatedData ...)") ...
    const sliderIndex = parseInt(document.getElementById('timeSlider').value) || 0;
    const landingDirection = document.querySelector('input[name="landingDirection"]:checked')?.value || 'LL';
    const customLandingDirectionLLInput = document.getElementById('customLandingDirectionLL');
    const customLandingDirectionRRInput = document.getElementById('customLandingDirectionRR');
    const customLandingDirLL = customLandingDirectionLLInput ? parseInt(customLandingDirectionLLInput.value, 10) : null;
    const customLandingDirRR = customLandingDirectionRRInput ? parseInt(customLandingDirectionRRInput.value, 10) : null;

    const CANOPY_SPEED_KT = parseInt(document.getElementById('canopySpeed').value) || 20;
    const DESCENT_RATE_MPS = parseFloat(document.getElementById('descentRate').value) || 3.5;
    const LEG_HEIGHT_FINAL = parseInt(document.getElementById('legHeightFinal').value) || 100;
    const LEG_HEIGHT_BASE = parseInt(document.getElementById('legHeightBase').value) || 200;

    const LEG_HEIGHT_DOWNWIND = parseInt(document.getElementById('legHeightDownwind').value) || 300;
    const markerLatLng = AppState.currentMarker.getLatLng();
    const lat = markerLatLng.lat;
    const lng = markerLatLng.lng;
    const baseHeight = Math.round(AppState.lastAltitude);
    const interpolatedData = interpolateWeatherData(sliderIndex);
    if (!interpolatedData || interpolatedData.length === 0) return;


    // *** HIER IST DIE KORREKTUR: FÜGEN SIE DIESEN BLOCK EIN ***
    // Holt die aktuellen Einstellungen aus dem HTML-Dokument.


    const heights = interpolatedData.map(d => d.height);
    const dirs = interpolatedData.map(d => Number.isFinite(d.dir) ? parseFloat(d.dir) : 0);
    const spdsKt = interpolatedData.map(d => Utils.convertWind(parseFloat(d.spd) || 0, 'kt', 'km/h'));
    const uComponents = spdsKt.map((spd, i) => -spd * Math.sin(dirs[i] * Math.PI / 180));
    const vComponents = spdsKt.map((spd, i) => -spd * Math.cos(dirs[i] * Math.PI / 180));

    // Determine effective landing direction based on selected pattern and input
    let effectiveLandingWindDir;
    if (landingDirection === 'LL' && Number.isFinite(customLandingDirLL) && customLandingDirLL >= 0 && customLandingDirLL <= 359) {
        effectiveLandingWindDir = customLandingDirLL;
    } else if (landingDirection === 'RR' && Number.isFinite(customLandingDirRR) && customLandingDirRR >= 0 && customLandingDirRR <= 359) {
        effectiveLandingWindDir = customLandingDirRR;
    } else {
        effectiveLandingWindDir = Number.isFinite(AppState.landingWindDir) ? AppState.landingWindDir : dirs[0];
    }

    if (!Number.isFinite(effectiveLandingWindDir)) {
        console.warn('Invalid landing wind direction:', effectiveLandingWindDir);
        return;
    }

    // Helper function to convert wind speed to user-selected unit
    function formatWindSpeed(speedKt) {
        const unit = getWindSpeedUnit();
        const convertedSpeed = Utils.convertWind(speedKt, unit, 'kt');
        if (unit === 'bft') {
            return Math.round(convertedSpeed); // Beaufort scale is integer
        }
        return convertedSpeed.toFixed(1); // Other units to one decimal
    }

    const calculateLegEndpoint = (startLat, startLng, bearing, groundSpeedKt, timeSec) => {
        const speedMps = groundSpeedKt * 1.852 / 3.6;
        const lengthMeters = speedMps * timeSec;
        const metersPerDegreeLat = 111000;
        const distanceDeg = lengthMeters / metersPerDegreeLat;
        const radBearing = bearing * Math.PI / 180;
        const deltaLat = distanceDeg * Math.cos(radBearing);
        const deltaLng = distanceDeg * Math.sin(radBearing) / Math.cos(startLat * Math.PI / 180);
        return [startLat + deltaLat, startLng + deltaLng];
    };

    // --- TEIL B: ALLE BERECHNUNGEN (1:1 aus Ihrer alten Funktion) ---
    // Der gesamte Block, der die Punkte, Winde und Farben berechnet.

    const finalLimits = [baseHeight, baseHeight + LEG_HEIGHT_FINAL];
    console.log('Final limits:', finalLimits);
    const finalMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, ...finalLimits);
    const finalWindDir = finalMeanWind[0];
    const finalWindSpeedKt = finalMeanWind[1];
    if (!Number.isFinite(finalWindSpeedKt) || !Number.isFinite(finalWindDir)) {
        console.warn('Invalid mean wind for final leg:', finalMeanWind);
        return;
    }

    let finalArrowColor = null;
    if (finalWindSpeedKt <= 3) {
        finalArrowColor = 'lightblue';
    } else if (finalWindSpeedKt <= 10) {
        finalArrowColor = 'lightgreen';
    } else if (finalWindSpeedKt <= 16) {
        finalArrowColor = '#f5f34f';
    } else {
        finalArrowColor = '#ffcccc';
    }

    const finalCourse = effectiveLandingWindDir;
    const finalWindAngle = Utils.calculateWindAngle(finalCourse, finalWindDir);
    const { crosswind: finalCrosswind, headwind: finalHeadwind } = Utils.calculateWindComponents(finalWindSpeedKt, finalWindAngle);
    const finalWca = Utils.calculateWCA(finalCrosswind, CANOPY_SPEED_KT) * (finalCrosswind >= 0 ? 1 : -1);
    const finalHeading = Utils.normalizeAngle(finalCourse - finalWca);
    const finalCourseObj = Utils.calculateCourseFromHeading(finalHeading, finalWindDir, finalWindSpeedKt, CANOPY_SPEED_KT);
    const finalGroundSpeedKt = finalCourseObj.groundSpeed;
    const finalTime = LEG_HEIGHT_FINAL / DESCENT_RATE_MPS;
    const finalLength = finalGroundSpeedKt * 1.852 / 3.6 * finalTime;
    const finalBearing = (effectiveLandingWindDir + 180) % 360;
    const finalEnd = calculateLegEndpoint(lat, lng, finalBearing, finalGroundSpeedKt, finalTime);
    // Add a fat blue arrow in the middle of the final leg pointing to landing direction
    const finalMidLat = (lat + finalEnd[0]) / 2;
    const finalMidLng = (lng + finalEnd[1]) / 2;
    const finalArrowBearing = (finalWindDir - 90 + 180) % 360; // Points in direction of the mean wind at final

    // Base Leg (100-200m AGL)
    const baseLimits = [baseHeight + LEG_HEIGHT_FINAL, baseHeight + LEG_HEIGHT_BASE];
    const baseMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, ...baseLimits);
    const baseWindDir = baseMeanWind[0];
    const baseWindSpeedKt = baseMeanWind[1];
    if (!Number.isFinite(baseWindSpeedKt) || !Number.isFinite(baseWindDir)) {
        console.warn('Invalid mean wind for base leg:', baseMeanWind);
        return;
    }

    let baseArrowColor = null;
    if (baseWindSpeedKt <= 3) {
        baseArrowColor = 'lightblue';
    } else if (baseWindSpeedKt <= 10) {
        baseArrowColor = 'lightgreen';
    } else if (baseWindSpeedKt <= 16) {
        baseArrowColor = '#f5f34f';
    } else {
        baseArrowColor = '#ffcccc';
    }

    console.log('********* Landing Direction: ', landingDirection, 'Effective Landing Wind Dir:', effectiveLandingWindDir);
    let baseHeading = 0;
    if (landingDirection === 'LL') {
        baseHeading = (effectiveLandingWindDir + 90) % 360;
        console.log('Base Heading:', baseHeading);
    } else if (landingDirection === 'RR') {
        baseHeading = (effectiveLandingWindDir - 90 + 360) % 360;
        console.log('Base Heading:', baseHeading);
    }

    const baseCourseObj = Utils.calculateCourseFromHeading(baseHeading, baseWindDir, baseWindSpeedKt, CANOPY_SPEED_KT);
    const baseCourse = baseCourseObj.trueCourse;
    const baseGroundSpeedKt = baseCourseObj.groundSpeed;
    let baseBearing = (baseCourse + 180) % 360;
    if (baseGroundSpeedKt < 0) {
        baseBearing = (baseBearing + 180) % 360; // Reverse the course
        console.log('Base ground speed is negative:', baseGroundSpeedKt, 'New course:', baseBearing);
    }
    const baseTime = (LEG_HEIGHT_BASE - LEG_HEIGHT_FINAL) / DESCENT_RATE_MPS;
    const baseLength = baseGroundSpeedKt * 1.852 / 3.6 * baseTime;
    console.log('Base Course:', baseCourse);
    const baseWindAngle = Utils.calculateWindAngle(baseCourse, baseWindDir);
    const { crosswind: baseCrosswind, headwind: baseHeadwind } = Utils.calculateWindComponents(baseWindSpeedKt, baseWindAngle);
    const baseWca = Utils.calculateWCA(baseCrosswind, CANOPY_SPEED_KT) * (baseCrosswind >= 0 ? 1 : -1);

    const baseEnd = calculateLegEndpoint(finalEnd[0], finalEnd[1], baseBearing, baseGroundSpeedKt, baseTime);

    // Add a fat blue arrow in the middle of the base leg pointing to landing direction
    const baseMidLat = (finalEnd[0] + baseEnd[0]) / 2;
    const baseMidLng = (finalEnd[1] + baseEnd[1]) / 2;
    const baseArrowBearing = (baseWindDir - 90 + 180) % 360; // Points in direction of the mean wind at base

    // Downwind Leg (200-300m AGL)
    const downwindLimits = [baseHeight + LEG_HEIGHT_BASE, baseHeight + LEG_HEIGHT_DOWNWIND];
    const downwindMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, ...downwindLimits);
    const downwindWindDir = downwindMeanWind[0];
    const downwindWindSpeedKt = downwindMeanWind[1];
    if (!Number.isFinite(downwindWindSpeedKt) || !Number.isFinite(downwindWindDir)) {
        console.warn('Invalid mean wind for downwind leg:', downwindMeanWind);
        return;
    }

    let downwindArrowColor = null;
    if (downwindWindSpeedKt <= 3) {
        downwindArrowColor = 'lightblue';
    } else if (downwindWindSpeedKt <= 10) {
        downwindArrowColor = 'lightgreen';
    } else if (downwindWindSpeedKt <= 16) {
        downwindArrowColor = '#f5f34f';
    } else {
        downwindArrowColor = '#ffcccc';
    }

    const downwindCourse = effectiveLandingWindDir;
    const downwindWindAngle = Utils.calculateWindAngle(downwindCourse, downwindWindDir);
    const { crosswind: downwindCrosswind, headwind: downwindHeadwind } = Utils.calculateWindComponents(downwindWindSpeedKt, downwindWindAngle);
    const downwindWca = Utils.calculateWCA(downwindCrosswind, CANOPY_SPEED_KT) * (downwindCrosswind >= 0 ? 1 : -1);
    const downwindHeading = Utils.normalizeAngle((downwindCourse - downwindWca + 180) % 360);
    const downwindCourseObj = Utils.calculateCourseFromHeading(downwindHeading, downwindWindDir, downwindWindSpeedKt, CANOPY_SPEED_KT);
    const downwindGroundSpeedKt = downwindCourseObj.groundSpeed;
    const downwindTime = (LEG_HEIGHT_DOWNWIND - LEG_HEIGHT_BASE) / DESCENT_RATE_MPS;
    const downwindLength = downwindGroundSpeedKt * 1.852 / 3.6 * downwindTime;
    const downwindEnd = calculateLegEndpoint(baseEnd[0], baseEnd[1], downwindCourse, downwindGroundSpeedKt, downwindTime);

    // Berechnet die exakten Mittelpunkte für die Platzierung der Windpfeile.
    const finalMidPoint = [(lat + finalEnd[0]) / 2, (lng + finalEnd[1]) / 2];
    const baseMidPoint = [(finalEnd[0] + baseEnd[0]) / 2, (finalEnd[1] + baseEnd[1]) / 2];
    const downwindMidPoint = [(baseEnd[0] + downwindEnd[0]) / 2, (baseEnd[1] + downwindEnd[1]) / 2];

    // Add a fat blue arrow in the middle of the downwind leg pointing to landing direction
    const downwindMidLat = (baseEnd[0] + downwindEnd[0]) / 2;
    const downwindMidLng = (baseEnd[1] + downwindEnd[1]) / 2;
    const downwindArrowBearing = (downwindWindDir - 90 + 180) % 360; // Points in direction of the mean wind at downwind

    console.log(`Landing Pattern Updated:
        Final Leg: Wind: ${finalWindDir.toFixed(1)}° @ ${finalWindSpeedKt.toFixed(1)}kt, Course: ${finalCourse.toFixed(1)}°, WCA: ${finalWca.toFixed(1)}°, GS: ${finalGroundSpeedKt.toFixed(1)}kt, HW: ${finalHeadwind.toFixed(1)}kt, Length: ${finalLength.toFixed(1)}m
        Base Leg: Wind: ${baseWindDir.toFixed(1)}° @ ${baseWindSpeedKt.toFixed(1)}kt, Course: ${baseCourse.toFixed(1)}°, WCA: ${baseWca.toFixed(1)}°, GS: ${baseGroundSpeedKt.toFixed(1)}kt, HW: ${baseHeadwind.toFixed(1)}kt, Length: ${baseLength.toFixed(1)}m
        Downwind Leg: Wind: ${downwindWindDir.toFixed(1)}° @ ${downwindWindSpeedKt.toFixed(1)}kt, Course: ${downwindCourse.toFixed(1)}°, WCA: ${downwindWca.toFixed(1)}°, GS: ${downwindGroundSpeedKt.toFixed(1)}kt, HW: ${downwindHeadwind.toFixed(1)}kt, Length: ${downwindLength.toFixed(1)}m`);

    // Logs für Feldversuch Bobby
    const selectedTime = AppState.weatherData.time[sliderIndex]; // Zeit aus den Wetterdaten basierend auf dem Slider-Index
    console.log('+++++++++ Koordinaten Pattern:', selectedTime);
    console.log('Coordinates DIP: ', lat, lng, 'Altitude DIP:', baseHeight);
    console.log('Coordinates final end: ', finalEnd[0], finalEnd[1], 'Leg Height:', baseHeight + LEG_HEIGHT_FINAL);
    console.log('Coordinates base end: ', baseEnd[0], baseEnd[1], 'Leg Height:', baseHeight + LEG_HEIGHT_BASE);
    console.log('Coordinates downwind end: ', downwindEnd[0], downwindEnd[1], 'Leg Height:', baseHeight + LEG_HEIGHT_DOWNWIND);

    // --- TEIL C: DIE "BAUANLEITUNG" FÜR DEN KELLNER ERSTELLEN ---
    // Hier fassen wir alle Ergebnisse sauber zusammen.
    const patternData = {
        legs: [
            { path: [[lat, lng], finalEnd], options: { color: 'red', weight: 3, opacity: 0.8, dashArray: '5, 10' } },
            { path: [finalEnd, baseEnd], options: { color: 'red', weight: 3, opacity: 0.8, dashArray: '5, 10' } },
            { path: [baseEnd, downwindEnd], options: { color: 'red', weight: 3, opacity: 0.8, dashArray: '5, 10' } }
        ],
        arrows: [
            {
                position: finalMidPoint,
                bearing: (finalWindDir - 90 + 180) % 360,
                color: finalArrowColor,
                tooltipText: `${Math.round(finalWindDir)}° ${formatWindSpeed(finalWindSpeedKt)}${getWindSpeedUnit()}` // Ihr alter Tooltip-Text
            },
            {
                position: baseMidPoint,
                bearing: (baseMeanWind[0] - 90 + 180) % 360,
                color: baseArrowColor,
                tooltipText: `${Math.round(baseWindDir)}° ${formatWindSpeed(baseWindSpeedKt)}${getWindSpeedUnit()}`
            },
            {
                position: downwindMidPoint,
                bearing: (downwindMeanWind[0] - 90 + 180) % 360,
                color: downwindArrowColor,
                tooltipText: `${Math.round(downwindWindDir)}° ${formatWindSpeed(downwindWindSpeedKt)}${getWindSpeedUnit()}`
            }
        ]
    };

    // --- TEIL D: DEN KELLNER MIT DER FERTIGEN BESTELLUNG LOSSCHICKEN ---
    mapManager.drawLandingPattern(patternData);
}
export function updateJumpRunTrackDisplay() {
    console.log('updateJumpRunTrackDisplay called');
    if (!AppState.map) {
        console.warn('Map not initialized, cannot update jump run track display');
        return;
    }
    if (
        !Settings.state.userSettings.showJumpRunTrack ||
        !AppState.weatherData ||
        !AppState.lastLat ||
        !AppState.lastLng ||
        !Settings.state.isCalculateJumpUnlocked ||
        !Settings.state.userSettings.calculateJump
    ) {
        console.log('Removing jump run track due to unmet conditions');
        if (AppState.jumpRunTrackLayer) {
            if (AppState.jumpRunTrackLayer.airplaneMarker) {
                AppState.map.removeLayer(AppState.jumpRunTrackLayer.airplaneMarker);
                AppState.jumpRunTrackLayer.airplaneMarker = null;
            }
            if (AppState.jumpRunTrackLayer.approachLayer) {
                AppState.map.removeLayer(AppState.jumpRunTrackLayer.approachLayer);
                AppState.jumpRunTrackLayer.approachLayer = null;
            }
            AppState.map.removeLayer(AppState.jumpRunTrackLayer);
            AppState.jumpRunTrackLayer = null;
            console.log('Removed JRT polyline');
        }
        AppState.lastTrackData = null;
        return;
    }
    const trackData = JumpPlanner.jumpRunTrack();
    if (trackData && trackData.latlngs?.length === 2 && trackData.latlngs.every(ll => Number.isFinite(ll[0]) && Number.isFinite(ll[1]))) {
        console.log('Drawing jump run track with data:', trackData);
        const drawData = {
            path: {
                latlngs: trackData.latlngs,
                options: { color: 'orange', weight: 5, opacity: 0.8 },
                tooltipText: `Jump Run Track: ${trackData.direction}°, Length: ${trackData.trackLength} m`,
                originalLatLngs: AppState.lastTrackData?.latlngs?.length === 2 ? AppState.lastTrackData.latlngs : trackData.latlngs
            },
            approachPath: trackData.approachLatLngs?.length === 2 && trackData.approachLatLngs.every(ll => Number.isFinite(ll[0]) && Number.isFinite(ll[1])) ? {
                latlngs: trackData.approachLatLngs,
                options: { color: 'orange', weight: 3, opacity: 0.6, dashArray: '5, 10' },
                tooltipText: `Approach Path: ${trackData.direction}°, Length: ${trackData.approachLength} m`,
                originalLatLngs: AppState.lastTrackData?.approachLatLngs?.length === 2 ? AppState.lastTrackData.approachLatLngs : trackData.approachLatLngs
            } : null,
            airplane: {
                position: L.latLng(trackData.latlngs[1][0], trackData.latlngs[1][1]),
                bearing: trackData.direction,
                originalPosition: AppState.lastTrackData?.latlngs?.[1] && Number.isFinite(AppState.lastTrackData.latlngs[1][0]) ?
                    L.latLng(AppState.lastTrackData.latlngs[1][0], AppState.lastTrackData.latlngs[1][1]) :
                    L.latLng(trackData.latlngs[1][0], trackData.latlngs[1][1]),
                originalLatLngs: AppState.lastTrackData?.latlngs?.length === 2 ? AppState.lastTrackData.latlngs : trackData.latlngs,
                approachLatLngs: AppState.lastTrackData?.approachLatLngs?.length === 2 ? AppState.lastTrackData.approachLatLngs : trackData.approachLatLngs
            }
        };
        mapManager.drawJumpRunTrack(drawData);
        // Speichere die neuen Track-Daten
        AppState.lastTrackData = {
            latlngs: trackData.latlngs,
            approachLatLngs: trackData.approachLatLngs,
            direction: trackData.direction,
            trackLength: trackData.trackLength,
            approachLength: trackData.approachLength
        };
        console.log('Updated AppState.lastTrackData:', AppState.lastTrackData);
    } else {
        console.warn('No valid track data to display:', trackData);
        AppState.lastTrackData = null;
    }
}

// == UI and Event Handling ==
function initializeApp() {
    Settings.initialize();
    // Synchronize global variables with Settings.state.unlockedFeatures
    Settings.state.isLandingPatternUnlocked = Settings.state.unlockedFeatures.landingPattern;
    Settings.state.isCalculateJumpUnlocked = Settings.state.unlockedFeatures.calculateJump;
    console.log('Initial unlock status:', { isLandingPatternUnlocked: Settings.state.isLandingPatternUnlocked, isCalculateJumpUnlocked: Settings.state.isCalculateJumpUnlocked });

    if (AppState.isInitialized) {
        console.log('App already initialized, skipping');
        return;
    }
    AppState.isInitialized = true;
    console.log('Initializing app');

    console.log('Initial userSettings:', userSettings);
    Settings.state.userSettings.calculateJump = true;
    Settings.save();

    setupCheckboxEvents();
    setupSliderEvents();
}
function initializeUIElements() {
    setElementValue('modelSelect', Settings.state.userSettings.model);
    setRadioValue('refLevel', Settings.state.userSettings.refLevel);
    setRadioValue('heightUnit', Settings.state.userSettings.heightUnit);
    setRadioValue('temperatureUnit', Settings.state.userSettings.temperatureUnit);
    setRadioValue('windUnit', Settings.state.userSettings.windUnit);
    setRadioValue('timeZone', Settings.state.userSettings.timeZone);
    setRadioValue('coordFormat', Settings.state.userSettings.coordFormat);
    setRadioValue('downloadFormat', Settings.state.userSettings.downloadFormat);
    setRadioValue('landingDirection', Settings.state.userSettings.landingDirection);
    setInputValue('canopySpeed', Settings.state.userSettings.canopySpeed);
    setInputValue('descentRate', Settings.state.userSettings.descentRate);
    setInputValue('legHeightDownwind', Settings.state.userSettings.legHeightDownwind);
    setInputValue('legHeightBase', Settings.state.userSettings.legHeightBase);
    setInputValue('legHeightFinal', Settings.state.userSettings.legHeightFinal);
    setInputValue('customLandingDirectionLL', Settings.state.userSettings.customLandingDirectionLL);
    setInputValue('customLandingDirectionRR', Settings.state.userSettings.customLandingDirectionRR);
    setInputValue('lowerLimit', Settings.state.userSettings.lowerLimit);
    setInputValue('upperLimit', Settings.state.userSettings.upperLimit);
    setInputValue('openingAltitude', Settings.state.userSettings.openingAltitude);
    setInputValue('exitAltitude', Settings.state.userSettings.exitAltitude);
    setInputValue('interpStepSelect', Settings.state.userSettings.interpStep);
    setInputValue('aircraftSpeedKt', Settings.state.userSettings.aircraftSpeedKt);
    setInputValue('numberOfJumpers', Settings.state.userSettings.numberOfJumpers);
    setCheckboxValue('showTableCheckbox', Settings.state.userSettings.showTable);
    setCheckboxValue('calculateJumpCheckbox', Settings.state.userSettings.calculateJump);
    setCheckboxValue('showLandingPattern', Settings.state.userSettings.showLandingPattern);
    setCheckboxValue('showJumpRunTrack', Settings.state.userSettings.showJumpRunTrack);
    setInputValue('jumpRunTrackOffset', Settings.state.userSettings.jumpRunTrackOffset);
    setCheckboxValue('showExitAreaCheckbox', Settings.state.userSettings.showExitArea);
    Settings.state.userSettings.isCustomJumpRunDirection = Settings.state.userSettings.isCustomJumpRunDirection || false;

    // Ensure UI reflects the stored custom direction without overwriting
    const customLL = document.getElementById('customLandingDirectionLL');
    const customRR = document.getElementById('customLandingDirectionRR');
    if (customLL && Settings.state.userSettings.customLandingDirectionLL !== '' && !isNaN(Settings.state.userSettings.customLandingDirectionLL)) {
        customLL.value = Settings.state.userSettings.customLandingDirectionLL;
    }
    if (customRR && Settings.state.userSettings.customLandingDirectionRR !== '' && !isNaN(Settings.state.userSettings.customLandingDirectionRR)) {
        customRR.value = Settings.state.userSettings.customLandingDirectionRR;
    }
    const separation = JumpPlanner.getSeparationFromTAS(Settings.state.userSettings.aircraftSpeedKt);
    setInputValue('jumperSeparation', separation);
    Settings.state.userSettings.jumperSeparation = separation;
    Settings.save();

    // Set initial tooltip and style for locked state
    const landingPatternCheckbox = document.getElementById('showLandingPattern');
    const calculateJumpCheckbox = document.getElementById('calculateJumpCheckbox');
    if (landingPatternCheckbox) {
        landingPatternCheckbox.title = (Settings.isFeatureUnlocked('landingPattern') && Settings.state.isLandingPatternUnlocked) ? '' : 'Feature locked. Click to enter password.';
        landingPatternCheckbox.style.opacity = (Settings.isFeatureUnlocked('landingPattern') && Settings.state.isLandingPatternUnlocked) ? '1' : '0.5';
        console.log('Initialized showLandingPattern UI:', { checked: landingPatternCheckbox.checked, opacity: landingPatternCheckbox.style.opacity });
    }
    if (calculateJumpCheckbox) {
        calculateJumpCheckbox.title = (Settings.isFeatureUnlocked('calculateJump') && Settings.state.isCalculateJumpUnlocked) ? '' : 'Feature locked. Click to enter password.';
        calculateJumpCheckbox.style.opacity = (Settings.isFeatureUnlocked('calculateJump') && Settings.state.isCalculateJumpUnlocked) ? '1' : '0.5';
        console.log('Initialized calculateJumpCheckbox UI:', { checked: calculateJumpCheckbox.checked, opacity: calculateJumpCheckbox.style.opacity });
    }
    const directionSpan = document.getElementById('jumpRunTrackDirection');
    if (directionSpan) directionSpan.textContent = '-'; // Initial placeholder
    updateUIState();
}
function updateUIState() {
    const info = document.getElementById('info');
    if (info) info.style.display = Settings.state.userSettings.showTable ? 'block' : 'none';
    const customLL = document.getElementById('customLandingDirectionLL');
    const customRR = document.getElementById('customLandingDirectionRR');
    const showJumpRunTrackCheckbox = document.getElementById('showJumpRunTrack');
    const showExitAreaCheckbox = document.getElementById('showExitAreaCheckbox');
    if (customLL) customLL.disabled = Settings.state.userSettings.landingDirection !== 'LL';
    if (customRR) customRR.disabled = Settings.state.userSettings.landingDirection !== 'RR';
    if (showJumpRunTrackCheckbox) showJumpRunTrackCheckbox.disabled = !Settings.state.userSettings.calculateJump;
    if (showExitAreaCheckbox) showExitAreaCheckbox.disabled = !Settings.state.userSettings.calculateJump; // Disable unless calculateJump is on
    Settings.updateUnitLabels();
    Settings.updateUnitLabels();
}
function restoreUIInteractivity() {
    const menu = document.getElementById('menu');
    const checkboxes = menu.querySelectorAll('input[type="checkbox"]');
    const inputs = menu.querySelectorAll('input[type="number"], input[type="text"]');

    // Check if elements are disabled unexpectedly
    checkboxes.forEach(cb => {
        if (cb.disabled && cb.id !== 'showJumpRunTrack' && cb.id !== 'showExitAreaCheckbox') {
            console.warn(`Checkbox ${cb.id} is disabled unexpectedly, re-enabling`);
            cb.disabled = false;
        }
    });

    inputs.forEach(input => {
        if (input.disabled && input.id !== 'customLandingDirectionLL' && input.id !== 'customLandingDirectionRR') {
            console.warn(`Input ${input.id} is disabled unexpectedly, re-enabling`);
            input.disabled = false;
        }
    });

    // Force a DOM refresh
    menu.style.display = 'none';
    void menu.offsetHeight; // Trigger reflow
    menu.style.display = 'block';

    console.log('UI interactivity check completed');
}
function setupMapEventListeners() {
    console.log("App: Richte Event-Listener für Karten-Events ein.");

    document.addEventListener('map:location_selected', async (event) => {
        const { lat, lng, source } = event.detail;
        console.log(`App: Event 'map:location_selected' von '${source}' empfangen.`);

        // --- HIER IST JETZT DIE GESAMTE ANWENDUNGSLOGIK ---

        // 1. Marker-Position im AppState und UI aktualisieren
        AppState.lastLat = lat;
        AppState.lastLng = lng;
        AppState.lastAltitude = await Utils.getAltitude(lat, lng);

        // Informiere das Coordinates-Modul über die neue Position
        Coordinates.updateCurrentMarkerPosition(lat, lng);
        Coordinates.addCoordToHistory(lat, lng);

        // Bewege den Marker (falls die Aktion nicht schon vom Marker selbst kam)
        if (source !== 'marker_drag') {
            // Annahme: Sie haben eine moveMarker-Funktion im mapManager
            // Dies ist ein Befehl von app.js an mapManager.js
            mapManager.moveMarker(lat, lng);
        }

        // 2. Kernlogik ausführen
        resetJumpRunDirection(true); // resetJumpRunDirection muss in app.js sein
        await fetchWeatherForLocation(lat, lng); // fetchWeather... muss in app.js sein

        if (Settings.state.userSettings.calculateJump) {
            calculateJump(); // calculateJump muss in app.js sein
            JumpPlanner.calculateCutAway();
        }

        mapManager.recenterMap(true); // recenterMap ist jetzt im mapManager
        AppState.isManualPanning = false;

        // 3. UI-Updates anstoßen, die von den neuen Daten abhängen
        updateJumpRunTrackDisplay(); // update... Funktionen sind jetzt im mapManager
        updateLandingPatternDisplay();
    });

    document.addEventListener('map:mousemove', (event) => {
        // 1. Hole die rohen Koordinaten aus dem Event
        const { lat, lng } = event.detail;

        // 2. Hier passiert die Logik! app.js kennt getCoordinateFormat.
        const coordFormat = getCoordinateFormat();
        let coordText;

        if (coordFormat === 'MGRS') {
            const mgrsVal = Utils.decimalToMgrs(lat, lng);
            coordText = `MGRS: ${mgrsVal || 'N/A'}`;
        } else if (coordFormat === 'DMS') {
            const latDMS = Utils.decimalToDms(lat, true);
            const lngDMS = Utils.decimalToDms(lng, false);
            coordText = `Lat: ${latDMS.deg}°... Lng: ${lngDMS.deg}°...`; // (gekürzt)
        } else {
            coordText = `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;
        }

        // 3. Gib den Befehl zum Aktualisieren der Anzeige.
        //    Dafür brauchen wir eine neue, kleine Helferfunktion im mapManager.
        mapManager.updateCoordsDisplay(coordText);
    });
}
function setupSliderEvents() {
    const slider = document.getElementById('timeSlider');
    if (!slider) {
        console.warn('Time slider not found:', { id: 'timeSlider' });
        return;
    }

    // Use 'input' event for real-time updates
    slider.addEventListener('input', async () => {
        const sliderIndex = parseInt(slider.value) || 0;
        console.log('Time slider moved to index:', sliderIndex);

        if (AppState.weatherData && AppState.lastLat && AppState.lastLng) {
            await updateWeatherDisplay(sliderIndex);
            if (AppState.lastAltitude !== 'N/A') calculateMeanWind();
            if (Settings.state.userSettings.showLandingPattern) {
                console.log('Updating landing pattern for slider index:', sliderIndex);
                updateLandingPatternDisplay();
            }
            if (Settings.state.userSettings.calculateJump) {
                console.log('Recalculating jump for slider index:', sliderIndex);
                calculateJump();
                JumpPlanner.calculateCutAway();
            }
            if (Settings.state.userSettings.showJumpRunTrack) {
                console.log('Updating jump run track for slider index:', sliderIndex);
                updateJumpRunTrackDisplay();
            }
            //mapManager.recenterMap();
            updateLivePositionControl();
        } else {
            // Aktualisiere zumindest die Zeitanzeige, auch wenn keine vollständigen Wetterdaten für das Hauptmodell da sind
            let timeToDisplay = 'N/A';
            if (AppState.weatherData?.time?.[sliderIndex]) {
                timeToDisplay = await Utils.getDisplayTime(AppState.weatherData.time[sliderIndex], AppState.lastLat, AppState.lastLng);
            } else if (AppState.ensembleModelsData && Object.keys(AppState.ensembleModelsData).length > 0) {
                const firstEnsembleModelName = Object.keys(AppState.ensembleModelsData)[0];
                const ensembleTimeArray = AppState.ensembleModelsData[firstEnsembleModelName]?.time;
                if (ensembleTimeArray?.[sliderIndex]) {
                    timeToDisplay = await Utils.getDisplayTime(ensembleTimeArray[sliderIndex], AppState.lastLat, AppState.lastLng);
                }
            }
            const selectedTimeElement = document.getElementById('selectedTime');
            if (selectedTimeElement) {
                selectedTimeElement.innerHTML = `Selected Time: ${timeToDisplay}`;
            }
        }

        // 2. Ensemble-Visualisierungen aktualisieren
        if (Settings.state.userSettings.selectedEnsembleModels && Settings.state.userSettings.selectedEnsembleModels.length > 0) {
            console.log("Time slider change triggering ensemble update for index:", sliderIndex);
            if (AppState.ensembleModelsData && Object.keys(AppState.ensembleModelsData).length > 0) {
                processAndVisualizeEnsemble(); // Diese Funktion verwendet intern den aktuellen sliderIndex via getSliderValue()
            } else {
                console.warn("Ensemble update skipped: AppState.ensembleModelsData is not populated yet.");
                // Optional: Daten erneut abrufen, falls sie fehlen sollten
                // await fetchEnsembleWeatherData();
                // processAndVisualizeEnsemble();
            }
        }
    });

    // Das 'change'-Event (feuert nach dem Loslassen des Sliders) kann für finale Textupdates bleiben,
    // oder wenn die 'input'-Performance bei sehr vielen Datenpunkten ein Problem wäre.
    // Für die Textanzeige der Zeit ist 'input' aber auch responsiv genug.
    slider.addEventListener('change', async () => {
        const sliderIndex = parseInt(slider.value) || 0;
        let timeToDisplay = 'N/A';

        // Konsistente Logik zur Zeitanzeige, wie im 'input'-Handler
        if (AppState.weatherData?.time?.[sliderIndex]) {
            timeToDisplay = await Utils.getDisplayTime(AppState.weatherData.time[sliderIndex], AppState.lastLat, AppState.lastLng);
        } else if (AppState.ensembleModelsData && Object.keys(AppState.ensembleModelsData).length > 0) {
            const firstEnsembleModelName = Object.keys(AppState.ensembleModelsData)[0];
            const ensembleTimeArray = AppState.ensembleModelsData[firstEnsembleModelName]?.time;
            if (ensembleTimeArray?.[sliderIndex]) {
                timeToDisplay = await Utils.getDisplayTime(ensembleTimeArray[sliderIndex], AppState.lastLat, AppState.lastLng);
            }
        }
        const selectedTimeElement = document.getElementById('selectedTime');
        if (selectedTimeElement) {
            selectedTimeElement.innerHTML = `Selected Time: ${timeToDisplay}`;
            console.log('Time slider change event, updated selectedTime label to:', timeToDisplay);
        }
        // Die Haupt-Aktualisierungslogik ist bereits im 'input'-Event.
        // Zusätzliche Aktionen nach dem Loslassen könnten hier platziert werden.
    });
}
function setupModelSelectEvents() {
    const modelSelect = document.getElementById('modelSelect');
    if (!modelSelect) {
        console.warn('modelSelect element not found');
        return;
    }

    // Function to initialize modelSelect with stored value
    const initializeModelSelect = () => {
        const storedModel = Settings.state.userSettings.model;
        const options = Array.from(modelSelect.options).map(option => option.value);
        console.log('modelSelect options during initialization:', options);
        if (storedModel && options.includes(storedModel)) {
            modelSelect.value = storedModel;
            console.log(`Initialized modelSelect to stored value: ${storedModel}`);
            return true; // Stop polling when stored model is found
        } else {
            console.log(`Stored model ${storedModel} not found in options, keeping current value: ${modelSelect.value}`);
            return false; // Continue polling
        }
    };

    // Initial attempt to set modelSelect
    initializeModelSelect();

    // Poll for options until the stored model is found or timeout
    const maxAttempts = 20; // 10 seconds
    let attempts = 0;
    const pollInterval = setInterval(() => {
        if (initializeModelSelect() || attempts >= maxAttempts) {
            clearInterval(pollInterval);
            console.log(`Stopped polling for modelSelect options after ${attempts} attempts`);
            if (attempts >= maxAttempts && !Array.from(modelSelect.options).some(opt => opt.value === Settings.state.userSettings.model)) {
                console.warn(`Timeout: Stored model ${Settings.state.userSettings.model} never found, keeping ${modelSelect.value}`);
            }
        } else {
            attempts++;
            console.log(`Polling attempt ${attempts}: modelSelect options`, Array.from(modelSelect.options).map(opt => opt.value));
        }
    }, 500);

    // Observe changes to modelSelect's parent container
    const parentContainer = modelSelect.parentElement || document.body;
    const observer = new MutationObserver(() => {
        console.log('modelSelect or parent DOM changed, reinitializing');
        initializeModelSelect();
    });
    observer.observe(parentContainer, { childList: true, subtree: true });

    // Handle changes
    modelSelect.addEventListener('change', async () => {
        console.log('Model select changed to:', modelSelect.value);
        if (AppState.lastLat && AppState.lastLng) {
            const currentIndex = getSliderValue();
            const currentTime = AppState.weatherData?.time?.[currentIndex] || null;
            document.getElementById('info').innerHTML = `Fetching weather with ${modelSelect.value}...`;
            resetJumpRunDirection(false);
            await fetchWeather(AppState.lastLat, AppState.lastLng, currentTime);
            Settings.updateModelRunInfo(AppState.lastModelRun, AppState.lastLat, AppState.lastLng);
            await updateWeatherDisplay(currentIndex);
            Settings.updateUnitLabels();

            if (AppState.lastAltitude !== 'N/A') {
                calculateMeanWind();
                if (Settings.state.userSettings.calculateJump) {
                    console.log('Recalculating jump for model change');
                    debouncedCalculateJump(); // Use debounced version
                    JumpPlanner.calculateCutAway();
                }
            }
            if (Settings.state.userSettings.showJumpRunTrack) {
                console.log('Updating JRT for model change');
                updateJumpRunTrackDisplay();
            }
            if (AppState.currentMarker) {
                console.log('Updating marker popup for model change');
                const wasOpen = AppState.currentMarker.getPopup()?.isOpen() || false;
                await refreshMarkerPopup(AppState.currentMarker, AppState.lastLat, AppState.lastLng, AppState.lastAltitude, wasOpen);
            }
            if (AppState.cutAwayMarker && AppState.cutAwayLat && AppState.cutAwayLng) {
                console.log('Updating cut-away marker popup for model change');
                const wasOpen = AppState.cutAwayMarker.getPopup()?.isOpen() || false;
                updateCutAwayMarkerPopup(AppState.cutAwayMarker, AppState.cutAwayLat, AppState.cutAwayLng, wasOpen);
            }
        } else {
            Utils.handleError('Please select a position on the map first.');
        }
        Settings.state.userSettings.model = modelSelect.value;
        Settings.save();
    });
}
function setupDownloadEvents() {
    const downloadButton = document.getElementById('downloadButton');
    if (downloadButton) {
        downloadButton.addEventListener('click', () => {
            const downloadFormat = getDownloadFormat();
            downloadTableAsAscii(downloadFormat);
        });
    }
}
function setupMenuEvents() {
    if (!AppState.map) {
        console.warn('Map not initialized, skipping setupMenuEvents');
        return;
    }

    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const menu = document.getElementById('menu');
    if (hamburgerBtn && menu) {
        menu.classList.add('hidden');
        console.log('Menu initialized as hidden on load');

        hamburgerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            menu.classList.toggle('hidden');
            const isHidden = menu.classList.contains('hidden');
            if (isHidden) {
                AppState.map.dragging.enable();
                AppState.map.touchZoom.enable();
                AppState.map.doubleClickZoom.enable();
                AppState.map.scrollWheelZoom.enable();
                AppState.map.boxZoom.enable();
                AppState.map.keyboard.enable();
                // Ensure map is interactive
                document.querySelector('.leaflet-container').style.pointerEvents = 'auto';
                reinitializeCoordsControl();
                console.log('Map interactions restored and coordsControl reinitialized');
            }
        });

        const menuItems = menu.querySelectorAll('li span');
        menuItems.forEach(item => {
            item.addEventListener('click', (e) => {
                const submenu = item.nextElementSibling;
                if (submenu && submenu.classList.contains('submenu')) {
                    const isSubmenuHidden = submenu.classList.contains('hidden');
                    const parentUl = item.closest('ul');
                    parentUl.querySelectorAll('.submenu').forEach(otherSubmenu => {
                        if (otherSubmenu !== submenu) {
                            otherSubmenu.classList.add('hidden');
                        }
                    });
                    submenu.classList.toggle('hidden', !isSubmenuHidden);
                    console.log('Submenu toggled:', isSubmenuHidden ? 'shown' : 'hidden');
                }
                e.stopPropagation();
            });
        });

        menu.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        document.addEventListener('click', (e) => {
            if (!menu.contains(e.target) && !hamburgerBtn.contains(e.target) && !menu.classList.contains('hidden')) {
                menu.classList.add('hidden');
                AppState.map.dragging.enable();
                AppState.map.touchZoom.enable();
                AppState.map.doubleClickZoom.enable();
                AppState.map.scrollWheelZoom.enable();
                AppState.map.boxZoom.enable();
                AppState.map.keyboard.enable();
                document.querySelector('.leaflet-container').style.pointerEvents = 'auto';
                reinitializeCoordsControl();
                console.log('Menu closed, map interactions restored, coordsControl reinitialized');
            }
        });
    } else {
        console.warn('Hamburger button or menu not found');
    }
}
function setupRadioEvents() {
    setupRadioGroup('refLevel', () => {
        Settings.updateUnitLabels();

        updateAllDisplays();
    });
    setupRadioGroup('heightUnit', () => {
        Settings.updateUnitLabels();
        updateAllDisplays();
        if (AppState.lastMouseLatLng && AppState.coordsControl) {
            const coordFormat = getCoordinateFormat();
            const lat = AppState.lastMouseLatLng.lat;
            const lng = AppState.lastMouseLatLng.lng;
            let coordText;
            if (coordFormat === 'MGRS') {
                const mgrs = Utils.decimalToMgrs(lat, lng);
                coordText = `MGRS: ${mgrs}`;
            } else {
                coordText = `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;
            }
            debouncedGetElevation(lat, lng, { lat, lng }, (elevation, requestLatLng) => {
                if (AppState.lastMouseLatLng) {
                    const deltaLat = Math.abs(AppState.lastMouseLatLng.lat - requestLatLng.lat);
                    const deltaLng = Math.abs(AppState.lastMouseLatLng.lng - requestLatLng.lng);
                    const threshold = 0.05;
                    if (deltaLat < threshold && deltaLng < threshold) {
                        const heightUnit = getHeightUnit();
                        let displayElevation = elevation === 'N/A' ? 'N/A' : elevation;
                        if (displayElevation !== 'N/A') {
                            displayElevation = Utils.convertHeight(displayElevation, heightUnit);
                            displayElevation = Math.round(displayElevation);
                        }
                        console.log('Updating elevation display after heightUnit change:', { lat, lng, elevation, heightUnit, displayElevation });
                        coordsControl.update(`${coordText}<br>Elevation: ${displayElevation} ${displayElevation === 'N/A' ? '' : heightUnit}`);
                    }
                }
            });
        }
        if (AppState.gpxLayer && AppState.gpxPoints.length > 0) {
            const groundAltitude = AppState.lastAltitude !== 'N/A' && !isNaN(AppState.lastAltitude) ? parseFloat(AppState.lastAltitude) : null;
            const windUnit = getWindSpeedUnit();
            const heightUnit = getHeightUnit();
            AppState.gpxLayer.eachLayer(layer => {
                if (layer instanceof L.Polyline) {
                    layer.on('mousemove', function (e) {
                        const latlng = e.latlng;
                        let closestPoint = AppState.gpxPoints[0];
                        let minDist = Infinity;
                        let closestIndex = 0;
                        AppState.gpxPoints.forEach((p, index) => {
                            const dist = Math.sqrt(Math.pow(p.lat - latlng.lat, 2) + Math.pow(p.lng - latlng.lng, 2));
                            if (dist < minDist) {
                                minDist = dist;
                                closestPoint = p;
                                closestIndex = index;
                            }
                        });
                        layer.setTooltipContent(getTooltipContent(closestPoint, closestIndex, AppState.gpxPoints, groundAltitude, windUnit, heightUnit)).openTooltip(latlng);
                    });
                }
            });
        }
    });
    setupRadioGroup('temperatureUnit', () => {
        updateAllDisplays();
    });
    setupRadioGroup('windUnit', () => {
        Settings.updateUnitLabels();
        updateAllDisplays();
        if (AppState.gpxLayer && AppState.gpxPoints.length > 0) {
            const groundAltitude = AppState.lastAltitude !== 'N/A' && !isNaN(AppState.lastAltitude) ? parseFloat(AppState.lastAltitude) : null;
            const windUnit = getWindSpeedUnit();
            const heightUnit = getHeightUnit();
            AppState.gpxLayer.eachLayer(layer => {
                if (layer instanceof L.Polyline) {
                    layer.on('mousemove', function (e) {
                        const latlng = e.latlng;
                        let closestPoint = AppState.gpxPoints[0];
                        let minDist = Infinity;
                        let closestIndex = 0;
                        AppState.gpxPoints.forEach((p, index) => {
                            const dist = Math.sqrt(Math.pow(p.lat - latlng.lat, 2) + Math.pow(p.lng - latlng.lng, 2));
                            if (dist < minDist) {
                                minDist = dist;
                                closestPoint = p;
                                closestIndex = index;
                            }
                        });
                        layer.setTooltipContent(getTooltipContent(closestPoint, closestIndex, AppState.gpxPoints, groundAltitude, windUnit, heightUnit)).openTooltip(latlng);
                    });
                }
            });
        }
    });
    setupRadioGroup('timeZone', async () => {
        updateAllDisplays();
    });
    setupRadioGroup('coordFormat', () => {
        Coordinates.updateCoordInputs(Settings.state.userSettings.coordFormat, AppState.lastLat, AppState.lastLng);
        if (AppState.lastLat && AppState.lastLng) {
            refreshMarkerPopup(AppState.currentMarker, AppState.lastLat, AppState.lastLng, AppState.lastAltitude, AppState.currentMarker.getPopup()?.isOpen() || false);
        }
    });
    setupRadioGroup('downloadFormat', () => {
        console.log('Download format changed:', getDownloadFormat());
    });
    setupRadioGroup('landingDirection', () => {
        const customLL = document.getElementById('customLandingDirectionLL');
        const customRR = document.getElementById('customLandingDirectionRR');
        const landingDirection = Settings.state.userSettings.landingDirection;
        console.log('landingDirection changed:', { landingDirection, customLL: customLL?.value, customRR: customRR?.value });
        if (customLL) {
            customLL.disabled = landingDirection !== 'LL';
            if (landingDirection === 'LL' && !customLL.value && AppState.landingWindDir !== null) {
                customLL.value = Math.round(AppState.landingWindDir);
                Settings.state.userSettings.customLandingDirectionLL = parseInt(customLL.value);
                Settings.save();
            }
        }
        if (customRR) {
            customRR.disabled = landingDirection !== 'RR';
            if (landingDirection === 'RR' && !customRR.value && AppState.landingWindDir !== null) {
                customRR.value = Math.round(AppState.landingWindDir);
                Settings.state.userSettings.customLandingDirectionRR = parseInt(customRR.value);
                Settings.save();
            }
        }
        updateUIState(); // Ensure UI reflects disabled state
        updateAllDisplays();
    });
    setupRadioGroup('cutAwayState', () => {
        Settings.state.userSettings.cutAwayState = Settings.getValue('cutAwayState', 'radio', 'Partially');
        Settings.save();
        console.log('cutAwayState changed:', Settings.state.userSettings.cutAwayState);
        if (Settings.state.userSettings.showCutAwayFinder && Settings.state.userSettings.calculateJump && AppState.weatherData && AppState.lastLat && AppState.lastLng) {
            console.log('Recalculating cut-away for state change');
            debouncedCalculateJump(); // Use debounced version
            JumpPlanner.calculateCutAway();
        }
    });
    setupRadioGroup('jumpMasterLineTarget', () => {
        Settings.state.userSettings.jumpMasterLineTarget = Settings.getValue('jumpMasterLineTarget', 'radio', 'DIP');
        Settings.save();
        console.log('jumpMasterLineTarget changed:', Settings.state.userSettings.jumpMasterLineTarget);
        if (Settings.state.userSettings.showJumpMasterLine && AppState.liveMarker) {
            debouncedPositionUpdate({
                coords: {
                    latitude: AppState.lastLatitude,
                    longitude: AppState.lastLongitude,
                    accuracy: AppState.lastAccuracy,
                    altitude: AppState.lastDeviceAltitude,
                    altitudeAccuracy: AppState.lastAltitudeAccuracy
                }
            });
        }
        // Disable HARP if no marker
        const harpRadio = document.querySelector('input[name="jumpMasterLineTarget"][value="HARP"]');
        if (harpRadio) {
            harpRadio.disabled = !AppState.harpMarker || Settings.state.userSettings.harpLat === null || Settings.state.userSettings.harpLng === null;
            console.log('HARP radio button disabled:', harpRadio.disabled);
        }
    });
    // Trigger initial tooltip refresh for heightUnit
    if (AppState.gpxLayer && AppState.gpxPoints.length > 0) {
        const groundAltitude = AppState.lastAltitude !== 'N/A' && !isNaN(AppState.lastAltitude) ? parseFloat(AppState.lastAltitude) : null;
        const windUnit = getWindSpeedUnit();
        const heightUnit = getHeightUnit();
        AppState.gpxLayer.eachLayer(layer => {
            if (layer instanceof L.Polyline) {
                layer.on('mousemove', function (e) {
                    const latlng = e.latlng;
                    let closestPoint = AppState.gpxPoints[0];
                    let minDist = Infinity;
                    let closestIndex = 0;
                    AppState.gpxPoints.forEach((p, index) => {
                        const dist = Math.sqrt(Math.pow(p.lat - latlng.lat, 2) + Math.pow(p.lng - latlng.lng, 2));
                        if (dist < minDist) {
                            minDist = dist;
                            closestPoint = p;
                            closestIndex = index;
                        }
                    });
                    layer.setTooltipContent(getTooltipContent(closestPoint, closestIndex, AppState.gpxPoints, groundAltitude, windUnit, heightUnit)).openTooltip(latlng);
                });
            }
        });
    }


    //Ensemble stuff
    const scenarioRadios = document.querySelectorAll('input[name="ensembleScenario"]');
    scenarioRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            if (radio.checked) {
                Settings.state.userSettings.currentEnsembleScenario = radio.value;
                AppState.currentEnsembleScenario = radio.value; // Auch AppState aktualisieren
                Settings.save();
                console.log('Ensemble scenario changed to:', radio.value);

                // Daten abrufen (falls noch nicht geschehen) und dann visualisieren
                if (Settings.state.userSettings.selectedEnsembleModels.length > 0) {
                    // Prüfen, ob Daten für die ausgewählten Modelle bereits geladen sind
                    const modelsLoaded = Settings.state.userSettings.selectedEnsembleModels.every(
                        m => AppState.ensembleModelsData && AppState.ensembleModelsData[m]
                    );

                    if (!modelsLoaded && radio.value !== 'all_models') { // Min/Mean/Max benötigen alle Modelldaten
                        fetchEnsembleWeatherData(); // processAndVisualizeEnsemble wird am Ende von fetchEnsembleWeatherData aufgerufen
                    } else if (!modelsLoaded && radio.value === 'all_models' && AppState.ensembleModelsData && Object.keys(AppState.ensembleModelsData).length > 0) {
                        // 'all_models' kann auch mit unvollständigen Daten etwas anzeigen
                        processAndVisualizeEnsemble();
                    } else if (modelsLoaded) {
                        processAndVisualizeEnsemble();
                    } else { // Keine Modelle ausgewählt oder Daten fehlen komplett
                        Utils.handleMessage("Please select models and ensure data is fetched.");
                        clearEnsembleVisualizations();
                    }
                } else if (radio.value !== 'all_models') {
                    Utils.handleMessage("Please select models from the 'Ensemble > Models' menu first.");
                    clearEnsembleVisualizations();
                } else { // 'all_models' aber keine Modelle selektiert
                    clearEnsembleVisualizations();
                }
            }
        });
    });

    // Initialisierung des ausgewählten Szenarios beim Laden der Seite
    const initialScenario = Settings.state.userSettings.currentEnsembleScenario || 'all_models';
    const currentScenarioRadio = document.querySelector(`input[name="ensembleScenario"][value="${initialScenario}"]`);
    if (currentScenarioRadio) {
        currentScenarioRadio.checked = true;
        AppState.currentEnsembleScenario = initialScenario; // AppState synchron halten
    }

    // Sicherstellen, dass die ensembleLayerGroup initialisiert ist, wenn die Karte bereit ist
    if (AppState.map && !AppState.ensembleLayerGroup) {
        AppState.ensembleLayerGroup = L.layerGroup().addTo(AppState.map);
    }
}
function setupInputEvents() {
    setupInput('lowerLimit', 'change', 300, (value) => {
        if (AppState.weatherData && AppState.lastLat && AppState.lastLng && AppState.lastAltitude !== 'N/A') calculateMeanWind();
    });
    setupInput('upperLimit', 'change', 300, (value) => {
        if (AppState.weatherData && AppState.lastLat && AppState.lastLng && AppState.lastAltitude !== 'N/A') calculateMeanWind();
    });
    setupInput('openingAltitude', 'change', 300, (value) => {
        if (!isNaN(value) && value >= 500 && value <= 15000) {
            if (Settings.state.userSettings.calculateJump && AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                debouncedCalculateJump(); // Use debounced version
                JumpPlanner.calculateCutAway();
            }
        } else {
            Utils.handleError('Opening altitude must be between 500 and 15000 meters.');
            setInputValue('openingAltitude', 1200);
            Settings.state.userSettings.openingAltitude = 1200;
            Settings.save();
        }
    });
    setupInput('exitAltitude', 'change', 300, (value) => {
        if (!isNaN(value) && value >= 500 && value <= 15000) {
            if (Settings.state.userSettings.calculateJump && AppState.weatherData && AppState.lastLat && AppState.lastLng) debouncedCalculateJump(); // Use debounced version
        } else {
            Utils.handleError('Exit altitude must be between 500 and 15000 meters.');
            setInputValue('exitAltitude', 3000);
            Settings.state.userSettings.exitAltitude = 3000;
            Settings.save();
        }
    });
    setupInput('canopySpeed', 'change', 300, (value) => {
        if (!isNaN(value) && value >= 5 && value <= 50) {
            updateAllDisplays();
        } else {
            Utils.handleError('Canopy speed must be between 5 and 50 kt.');
            setInputValue('canopySpeed', 20);
            Settings.state.userSettings.canopySpeed = 20;
            Settings.save();
        }
    });
    setupInput('descentRate', 'change', 300, (value) => {
        if (!isNaN(value) && value >= 1 && value <= 10) {
            updateAllDisplays();
        } else {
            Utils.handleError('Descent rate must be between 1 and 10 m/s.');
            setInputValue('descentRate', 3);
            Settings.state.userSettings.descentRate = 3;
            Settings.save();
        }
    });
    setupInput('interpStepSelect', 'change', 300, (value) => {
        updateAllDisplays();
    });
    setupLegHeightInput('legHeightFinal', 100);
    setupLegHeightInput('legHeightBase', 200);
    setupLegHeightInput('legHeightDownwind', 300);
    setupInput('customLandingDirectionLL', 'input', 100, (value) => {
        const customDir = parseInt(value, 10);
        console.log('customLandingDirectionLL input:', { value, customDir });
        if (!isNaN(customDir) && customDir >= 0 && customDir <= 359) {
            Settings.state.userSettings.customLandingDirectionLL = customDir;
            Settings.save();
            if (Settings.state.userSettings.landingDirection === 'LL' && AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                console.log('Updating landing pattern for LL:', customDir);
                updateLandingPatternDisplay();
                mapManager.recenterMap();
            }
        } else {
            Utils.handleError('Landing direction must be between 0 and 359°.');
            setInputValue('customLandingDirectionLL', Settings.state.userSettings.customLandingDirectionLL || 0);
        }
    });
    setupInput('customLandingDirectionRR', 'input', 100, (value) => {
        const customDir = parseInt(value, 10);
        console.log('customLandingDirectionRR input:', { value, customDir });
        if (!isNaN(customDir) && customDir >= 0 && customDir <= 359) {
            Settings.state.userSettings.customLandingDirectionRR = customDir;
            Settings.save();
            if (Settings.state.userSettings.landingDirection === 'RR' && AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                console.log('Updating landing pattern for RR:', customDir);
                updateLandingPatternDisplay();
                mapManager.recenterMap();
            }
        } else {
            Utils.handleError('Landing direction must be between 0 and 359°.');
            setInputValue('customLandingDirectionRR', Settings.state.userSettings.customLandingDirectionRR || 0);
        }
    });
    setupInput('jumpRunTrackDirection', 'change', 0, (value) => {
        const customDir = parseInt(value, 10);
        console.log('jumpRunTrackDirection change event:', {
            value,
            customDir,
            jumpRunTrackOffset: Settings.state.userSettings.jumpRunTrackOffset
        });
        if (!isNaN(customDir) && customDir >= 0 && customDir <= 359) {
            if (Settings.state.userSettings.jumpRunTrackOffset !== 0) {
                console.log('Error: Attempted to rotate jump run track with non-zero offset');
                displayError('jump run track rotation only works at the original position. Reset offset to 0 or rotate before moving.');
                return;
            }
            AppState.customJumpRunDirection = customDir;
            console.log('Set custom direction from input:', customDir);
            if (AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                if (Settings.state.userSettings.showJumpRunTrack) {
                    console.log('Updating JRT for custom direction input');
                    updateJumpRunTrackDisplay();
                }
                if (Settings.state.userSettings.calculateJump) {
                    console.log('Recalculating jump for custom JRT direction');
                    debouncedCalculateJump(); // Use debounced version
                    JumpPlanner.calculateCutAway();
                }
            } else {
                console.warn('Cannot update JRT or jump: missing conditions', {
                    weatherData: !!AppState.weatherData,
                    lastLat: AppState.lastLat,
                    lastLng: AppState.lastLng
                });
            }
        } else {
            console.log('Invalid direction input, resetting to calculated');
            Utils.handleError('Jump run direction must be between 0 and 359°.');
            AppState.customJumpRunDirection = null;
            const directionInput = document.getElementById('jumpRunTrackDirection');
            if (directionInput) {
                directionInput.addEventListener('change', () => {
                    const value = parseFloat(directionInput.value);

                    // Prüfen, ob eine gültige Zahl eingegeben wurde
                    if (Number.isFinite(value) && value >= 0 && value <= 359) {
                        Settings.state.userSettings.customJumpRunDirection = value;
                        console.log(`Setting 'customJumpRunDirection' on change to:`, value);
                    } else {
                        // Wenn die Eingabe ungültig ist, zurück zum berechneten Wert
                        Settings.state.userSettings.customJumpRunDirection = null;
                        directionInput.value = ''; // Feld leeren
                        console.log('Invalid direction, resetting to calculated.');
                    }
                    Settings.save();
                    updateJumpRunTrackDisplay();
                });
            }
            if (AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                if (Settings.state.userSettings.showJumpRunTrack) {
                    console.log('Updating JRT for invalid direction input');
                    updateJumpRunTrackDisplay();
                }
                if (Settings.state.userSettings.calculateJump) {
                    console.log('Recalculating jump for reset JRT direction');
                    debouncedCalculateJump(); // Use debounced version
                    JumpPlanner.calculateCutAway();
                }
            }
        }
    });
    setupInput('jumpRunTrackOffset', 'change', 0, (value) => {
        const offset = parseInt(value, 10);
        console.log('jumpRunTrackOffset change event:', { value, offset });
        if (!isNaN(offset) && offset >= -50000 && offset <= 50000 && offset % 100 === 0) {
            Settings.state.userSettings.jumpRunTrackOffset = offset;
            Settings.save();
            if (Settings.state.userSettings.calculateJump && Settings.state.userSettings.showJumpRunTrack && AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                console.log('Updating JRT for offset change');
                updateJumpRunTrackDisplay();
            }
        } else {
            Utils.handleError('Offset must be between -50000 and 50000 in steps of 100.');
            const offsetInput = document.getElementById('jumpRunTrackOffset');
            if (offsetInput) {
                offsetInput.value = 0;
            }
            Settings.state.userSettings.jumpRunTrackOffset = 0;
            Settings.save();
            if (Settings.state.userSettings.calculateJump && Settings.state.userSettings.showJumpRunTrack) {
                console.log('Resetting JRT for invalid offset');
                updateJumpRunTrackDisplay();
            }
        }
    });
    setupInput('jumpRunTrackForwardOffset', 'change', 0, (value) => {
        const offset = parseInt(value, 10);
        console.log('jumpRunTrackForwardOffset change event:', { value, offset });
        if (!isNaN(offset) && offset >= -50000 && offset <= 50000 && offset % 100 === 0) {
            Settings.state.userSettings.jumpRunTrackForwardOffset = offset;
            Settings.save();
            if (Settings.state.userSettings.calculateJump && Settings.state.userSettings.showJumpRunTrack && AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                console.log('Updating JRT for forward offset change');
                updateJumpRunTrackDisplay();
            }
        } else {
            Utils.handleError('Forward offset must be between -50000 and 50000 in steps of 100.');
            const offsetInput = document.getElementById('jumpRunTrackForwardOffset');
            if (offsetInput) {
                offsetInput.value = 0;
            }
            Settings.state.userSettings.jumpRunTrackForwardOffset = 0;
            Settings.save();
            if (Settings.state.userSettings.calculateJump && Settings.state.userSettings.showJumpRunTrack) {
                console.log('Resetting JRT for invalid forward offset');
                updateJumpRunTrackDisplay();
            }
        }
    });
    setupInput('aircraftSpeedKt', 'change', 300, (value) => {
        const speed = parseFloat(value);
        if (!isNaN(speed) && speed >= 10 && speed <= 150) {
            Settings.state.userSettings.aircraftSpeedKt = speed;
            Settings.save();
            // Update jumperSeparation if not manually set
            if (!AppState.isJumperSeparationManual) {
                const separation = JumpPlanner.getSeparationFromTAS(speed);
                setInputValue('jumperSeparation', separation);
                Settings.state.userSettings.jumperSeparation = separation;
                Settings.save();
                console.log(`Auto-updated jumperSeparation to ${separation}s for IAS ${speed}kt`);
            }
            if (Settings.state.userSettings.calculateJump && AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                console.log('Recalculating jump for aircraft speed change');
                debouncedCalculateJump(); // Use debounced version
                JumpPlanner.calculateCutAway();
            }
        } else {
            Utils.handleError('Aircraft speed must be between 10 and 150 kt.');
            setInputValue('aircraftSpeedKt', defaultSettings.aircraftSpeedKt);
            Settings.state.userSettings.aircraftSpeedKt = defaultSettings.aircraftSpeedKt;
            Settings.save();
        }
    });
    setupInput('numberOfJumpers', 'change', 300, (value) => {
        const number = parseFloat(value);
        if (!isNaN(number) && number >= 1 && number <= 50) {
            Settings.state.userSettings.numberOfJumpers = number;
            Settings.save();
            if (Settings.state.userSettings.calculateJump && AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                console.log('Recalculating jump for jumper number change');
                debouncedCalculateJump(); // Use debounced version
                JumpPlanner.calculateCutAway();
            }
        } else {
            Utils.handleError('Jumper number must be between 1 and 50.');
            setInputValue('numberOfJumpers', defaultSettings.numberOfJumpers);
            Settings.state.userSettings.numberOfJumpers = defaultSettings.numberOfJumpers;
            Settings.save();
        }
    });
    setupInput('jumperSeparation', 'change', 300, (value) => {
        const separation = parseFloat(value);
        if (!isNaN(separation) && separation >= 1 && separation <= 50) {
            Settings.state.userSettings.jumperSeparation = separation;
            AppState.isJumperSeparationManual = true; // Mark as manually set
            Settings.save();
            console.log(`jumperSeparation manually set to ${separation}s`);
            if (Settings.state.userSettings.calculateJump && AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                console.log('Recalculating jump for jumper separation change');
                debouncedCalculateJump(); // Use debounced version
                JumpPlanner.calculateCutAway();
            }
        } else {
            Utils.handleError('Jumper separation must be between 1 and 50 seconds.');
            setInputValue('jumperSeparation', defaultSettings.jumperSeparation);
            Settings.state.userSettings.jumperSeparation = defaultSettings.jumperSeparation;
            AppState.isJumperSeparationManual = false; // Reset to auto on invalid input
            Settings.save();
        }
    });
    setupInput('cutAwayAltitude', 'change', 300, (value) => {
        if (!isNaN(value) && value >= 400 && value <= 15000) {
            Settings.state.userSettings.cutAwayAltitude = value;
            Settings.save();
            if (Settings.state.userSettings.showCutAwayFinder && Settings.state.userSettings.calculateJump && AppState.weatherData && cutAwayLat !== null && AppState.cutAwayLng !== null) {
                console.log('Recalculating jump for cut-away altitude change');
                debouncedCalculateJump(); // Use debounced version
                JumpPlanner.calculateCutAway();
            }
        } else {
            Utils.handleError('Cut away altitude must be between 400 and 15000 meters.');
            setInputValue('cutAwayAltitude', 1000);
            Settings.state.userSettings.cutAwayAltitude = 1000;
            Settings.save();
        }
    });
    setupInput('historicalDatePicker', 'change', 300, (value) => {
        console.log('historicalDatePicker changed to:', value);
        if (AppState.lastLat && AppState.lastLng) {
            fetchWeatherForLocation(AppState.lastLat, AppState.lastLng, value ? `${value}T00:00:00Z` : null);
        } else {
            Utils.handleError('Please select a position on the map first.');
        }
    });
}
function setupCheckboxEvents() {
    if (!AppState.map) {
        console.warn('Map not initialized, skipping setupCheckboxEvents');
        return;
    }

    setupCheckbox('showTableCheckbox', 'showTable', (checkbox) => {
        Settings.state.userSettings.showTable = checkbox.checked;
        Settings.save();
        console.log('showTableCheckbox changed:', checkbox.checked);
        const info = document.getElementById('info');
        if (info) {
            info.style.display = checkbox.checked ? 'block' : 'none';
            console.log('Info display set to:', info.style.display);
        }
        if (checkbox.checked && AppState.weatherData && AppState.lastLat && AppState.lastLng) {
            updateWeatherDisplay(getSliderValue());
        }
        mapManager.recenterMap();
    });

    setupCheckbox('showExitAreaCheckbox', 'showExitArea', (checkbox) => {
        Settings.state.userSettings.showExitArea = checkbox.checked;
        Settings.save();
        checkbox.checked = Settings.state.userSettings.showExitArea;
        console.log('Show Exit Area set to:', Settings.state.userSettings.showExitArea);
        if (checkbox.checked && AppState.weatherData && AppState.lastLat && AppState.lastLng && Settings.state.isCalculateJumpUnlocked && Settings.state.userSettings.calculateJump) {
            const exitResult = JumpPlanner.calculateExitCircle();
            JumpPlanner.calculateCutAway();
        } else {
            if (Settings.state.isCalculateJumpUnlocked && Settings.state.userSettings.calculateJump) calculateJump();
            console.log('Cleared exit circles and re-rendered active circles');
        }
    });

    setupCheckbox('showCanopyAreaCheckbox', 'showCanopyArea', (checkbox) => {
        Settings.state.userSettings.showCanopyArea = checkbox.checked;
        Settings.save();
        checkbox.checked = Settings.state.userSettings.showCanopyArea;
        console.log('Show Canopy Area set to:', Settings.state.userSettings.showCanopyArea);
        if (checkbox.checked && AppState.weatherData && AppState.lastLat && AppState.lastLng && Settings.state.isCalculateJumpUnlocked && Settings.state.userSettings.calculateJump) {
            const canopyResult = JumpPlanner.calculateCanopyCircles();
            JumpPlanner.calculateCutAway();
        } else {
            if (AppState.jumpCircle) {
                if (AppState.map && typeof AppState.map.removeLayer === 'function') {
                    AppState.map.removeLayer(AppState.jumpCircle);
                }
                AppState.jumpCircle = null;
            }
            if (AppState.jumpCircleFull) {
                if (AppState.map && typeof AppState.map.removeLayer === 'function') {
                    AppState.map.removeLayer(AppState.jumpCircleFull);
                }
                AppState.jumpCircleFull = null;
            }
            if (AppState.additionalBlueCircles) {
                AppState.additionalBlueCircles.forEach(circle => {
                    if (AppState.map && typeof AppState.map.removeLayer === 'function') {
                        AppState.map.removeLayer(circle);
                    }
                });
                AppState.additionalBlueCircles = [];
            }
            if (AppState.additionalBlueLabels) {
                AppState.additionalBlueLabels.forEach(label => {
                    if (AppState.map && typeof AppState.map.removeLayer === 'function') {
                        AppState.map.removeLayer(label);
                    }
                });
                AppState.additionalBlueLabels = [];
            }
            console.log('Cleared blue and red circles and labels');
        }
    });

    setupCheckbox('showJumpRunTrack', 'showJumpRunTrack', (checkbox) => {
        Settings.state.userSettings.showJumpRunTrack = checkbox.checked;
        Settings.save();
        checkbox.checked = Settings.state.userSettings.showJumpRunTrack;
        console.log('showJumpRunTrack changed:', checkbox.checked);
        if (checkbox.checked && AppState.weatherData && AppState.lastLat && AppState.lastLng && Settings.state.isCalculateJumpUnlocked && Settings.state.userSettings.calculateJump) {
            calculateJumpRunTrack();
        } else {
            if (AppState.jumpRunTrackLayer) {
                if (AppState.jumpRunTrackLayer.airplaneMarker && AppState.map && typeof AppState.map.removeLayer === 'function') {
                    AppState.map.removeLayer(AppState.jumpRunTrackLayer.airplaneMarker);
                    AppState.jumpRunTrackLayer.airplaneMarker = null;
                }
                if (AppState.jumpRunTrackLayer.approachLayer && AppState.map && typeof AppState.map.removeLayer === 'function') {
                    AppState.map.removeLayer(AppState.jumpRunTrackLayer.approachLayer);
                    AppState.jumpRunTrackLayer.approachLayer = null;
                }
                if (AppState.map && typeof AppState.map.removeLayer === 'function') {
                    AppState.map.removeLayer(AppState.jumpRunTrackLayer);
                }
                AppState.jumpRunTrackLayer = null;
                console.log('Removed JRT polyline');
            }
            const directionInput = document.getElementById('jumpRunTrackDirection');
            if (directionInput) {
                const trackData = JumpPlanner.jumpRunTrack();
                directionInput.value = trackData ? trackData.direction : '';
                console.log('Updated jumpRunTrackDirection value:', trackData?.direction || '');
            }
        }
    });

    setupCheckbox('showCutAwayFinder', 'showCutAwayFinder', (checkbox) => {
        console.log('showCutAwayFinder checkbox changed to:', checkbox.checked);
        Settings.state.userSettings.showCutAwayFinder = checkbox.checked;
        Settings.save();
        // Find the submenu within the same <li> as the checkbox
        const submenu = checkbox.closest('li')?.querySelector('ul');
        console.log('Submenu lookup for showCutAwayFinder:', { submenu: submenu ? 'Found' : 'Not found', submenuClasses: submenu?.classList.toString() });
        toggleSubmenu(checkbox, submenu, checkbox.checked);
        if (checkbox.checked && AppState.weatherData && AppState.cutAwayLat !== null && AppState.cutAwayLng !== null && Settings.state.isCalculateJumpUnlocked && Settings.state.userSettings.calculateJump) {
            console.log('Show Cut Away Finder enabled, running calculateCutAway');
            JumpPlanner.calculateCutAway();
        } else {
            if (AppState.cutAwayCircle) {
                if (AppState.map && typeof AppState.map.removeLayer === 'function') {
                    AppState.map.removeLayer(AppState.cutAwayCircle);
                } else {
                    console.warn('Map not initialized, cannot remove cutAwayCircle');
                }
                AppState.cutAwayCircle = null;
                console.log('Cleared cut-away circle');
            }
            if (AppState.cutAwayMarker) {
                if (AppState.map && typeof AppState.map.removeLayer === 'function') {
                    AppState.map.removeLayer(AppState.cutAwayMarker);
                } else {
                    console.warn('Map not initialized, cannot remove cutAwayMarker');
                }
                AppState.cutAwayMarker = null;
                console.log('Cleared cut-away marker');
            }
            AppState.cutAwayLat = null;
            AppState.cutAwayLng = null;
            console.log('Cleared cutAwayLat and cutAwayLng');
        }
    });

    setupCheckbox('showLandingPattern', 'showLandingPattern', (checkbox) => {
        console.log('showLandingPattern checkbox changed to:', checkbox.checked);
        const enableFeature = () => {
            Settings.state.userSettings.showLandingPattern = true;
            Settings.save();
            const submenu = checkbox.closest('li')?.querySelector('ul');
            toggleSubmenu(checkbox, submenu, true);
            if (AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                updateLandingPatternDisplay();
                mapManager.recenterMap();
            }
        };
        const disableFeature = () => {
            Settings.state.userSettings.showLandingPattern = false;
            Settings.save();
            checkbox.checked = false;
            const submenu = checkbox.closest('li')?.querySelector('ul');
            toggleSubmenu(checkbox, submenu, false);
            // Clear landing pattern layers
            if (AppState.map) {
                const layers = [
                    AppState.landingPatternPolygon,
                    AppState.secondlandingPatternPolygon,
                    AppState.thirdLandingPatternLine,
                    AppState.finalArrow,
                    AppState.baseArrow,
                    AppState.downwindArrow
                ];
                layers.forEach((layer, index) => {
                    if (layer && AppState.map.hasLayer(layer)) {
                        AppState.map.removeLayer(layer);
                        console.log(`Removed landing pattern layer ${index}:`, layer);
                    }
                });
                // Reset state
                AppState.landingPatternPolygon = null;
                AppState.secondlandingPatternPolygon = null;
                AppState.thirdLandingPatternLine = null;
                AppState.finalArrow = null;
                AppState.baseArrow = null;
                AppState.downwindArrow = null;
                AppState.landingWindDir = null;
                console.log('Cleared landing pattern layers and reset state');
            } else {
                console.warn('Map not initialized, cannot clear landing pattern layers');
            }
        };
        if (checkbox.checked) {
            if (Settings.isFeatureUnlocked('landingPattern')) {
                enableFeature();
            } else {
                Settings.showPasswordModal('landingPattern', enableFeature, disableFeature);
            }
        } else {
            disableFeature();
        }
    });

    setupCheckbox('trackPositionCheckbox', 'trackPosition', (checkbox) => {
        console.log('trackPositionCheckbox changed to:', checkbox.checked);
        Settings.state.userSettings.trackPosition = checkbox.checked;
        Settings.save();
        const parentLi = checkbox.closest('li');
        const submenu = parentLi?.querySelector('ul');
        console.log('Submenu lookup for trackPositionCheckbox:', {
            parentLi: parentLi ? 'Found' : 'Not found',
            submenu: submenu ? 'Found' : 'Not found',
            submenuClasses: submenu?.classList.toString(),
            parentLiInnerHTML: parentLi?.innerHTML
        });
        if (submenu) {
            toggleSubmenu(checkbox, submenu, checkbox.checked);
        } else {
            console.log('No submenu for trackPositionCheckbox, skipping toggleSubmenu');
        }
        if (checkbox.checked) {
            startPositionTracking();
            // Enable Jump Master Line checkbox if it exists
            const jumpMasterCheckbox = document.getElementById('showJumpMasterLine');
            if (jumpMasterCheckbox) {
                jumpMasterCheckbox.disabled = false;
                jumpMasterCheckbox.style.opacity = '1';
                jumpMasterCheckbox.title = '';
                console.log('Enabled showJumpMasterLine checkbox due to trackPosition being enabled');
            }
        } else {
            stopPositionTracking();
            // Disable and uncheck Jump Master Line checkbox
            const jumpMasterCheckbox = document.getElementById('showJumpMasterLine');
            if (jumpMasterCheckbox) {
                jumpMasterCheckbox.disabled = true;
                jumpMasterCheckbox.checked = false;
                jumpMasterCheckbox.style.opacity = '0.5';
                jumpMasterCheckbox.title = 'Enable Live Tracking to use Jump Master Line';
                Settings.state.userSettings.showJumpMasterLine = false;
                Settings.save();
                const jumpMasterSubmenu = jumpMasterCheckbox.closest('li')?.querySelector('ul');
                if (jumpMasterSubmenu) {
                    toggleSubmenu(jumpMasterCheckbox, jumpMasterSubmenu, false);
                }
                console.log('Disabled and unchecked showJumpMasterLine checkbox');
            }
        }
        // Remove Jump Master Line from map
        if (AppState.jumpMasterLine) {
            if (AppState.map && typeof AppState.map.removeLayer === 'function') {
                AppState.map.removeLayer(AppState.jumpMasterLine);
            } else {
                console.warn('Map not initialized, cannot remove jumpMasterLine');
            }
            AppState.jumpMasterLine = null;
            console.log('Removed Jump Master Line due to trackPosition disabled');
        }
        if (AppState.livePositionControl) {
            AppState.livePositionControl.update(
                0,
                0,
                null,
                null,
                0,
                'N/A',
                'kt',
                'N/A',
                false,
                null
            );
            AppState.livePositionControl._container.style.display = 'none';
            console.log('Cleared livePositionControl content and hid panel');
        }
    });

    setupCheckbox('showJumpMasterLine', 'showJumpMasterLine', (checkbox) => {
        console.log('showJumpMasterLine checkbox changed to:', checkbox.checked);
        // Only allow changes if trackPosition is enabled
        if (!Settings.state.userSettings.trackPosition) {
            checkbox.checked = false;
            checkbox.disabled = true;
            checkbox.style.opacity = '0.5';
            checkbox.title = 'Enable Live Tracking to use Jump Master Line';
            Settings.state.userSettings.showJumpMasterLine = false;
            Settings.save();
            Utils.handleMessage('Enable Live Tracking to use Jump Master Line.');
            const submenu = checkbox.closest('li')?.querySelector('ul');
            toggleSubmenu(checkbox, submenu, false);
            return;
        }
        // If targeting DIP, ensure a position is set
        if (checkbox.checked && Settings.state.userSettings.jumpMasterLineTarget === 'DIP' &&
            (AppState.lastLat === null || AppState.lastLng === null || !AppState.currentMarker)) {
            checkbox.checked = false;
            Settings.state.userSettings.showJumpMasterLine = false;
            Settings.save();
            Utils.handleMessage('Please select a DIP position on the map first.');
            const submenu = checkbox.closest('li')?.querySelector('ul');
            toggleSubmenu(checkbox, submenu, false);
            return;
        }
        // If targeting HARP, ensure valid HARP coordinates exist
        if (checkbox.checked && Settings.state.userSettings.jumpMasterLineTarget === 'HARP' &&
            (!Settings.state.userSettings.harpLat || !Settings.state.userSettings.harpLng)) {
            checkbox.checked = false;
            Settings.state.userSettings.showJumpMasterLine = false;
            Settings.save();
            Utils.handleMessage('Please place a HARP marker first.');
            const submenu = checkbox.closest('li')?.querySelector('ul');
            toggleSubmenu(checkbox, submenu, false);
            return;
        }
        Settings.state.userSettings.showJumpMasterLine = checkbox.checked;
        Settings.save();
        const submenu = checkbox.closest('li')?.querySelector('ul');
        console.log('Submenu lookup for showJumpMasterLine:', { submenu: submenu ? 'Found' : 'Not found', submenuClasses: submenu?.classList.toString() });
        toggleSubmenu(checkbox, submenu, checkbox.checked);
        if (!checkbox.checked) {
            if (AppState.jumpMasterLine) {
                if (AppState.map && typeof AppState.map.removeLayer === 'function') {
                    AppState.map.removeLayer(AppState.jumpMasterLine);
                } else {
                    console.warn('Map not initialized, cannot remove jumpMasterLine');
                }
                AppState.jumpMasterLine = null;
                console.log('Removed Jump Master Line: unchecked');
            }
            if (AppState.livePositionControl) {
                AppState.livePositionControl.update(
                    AppState.lastLatitude || 0,
                    AppState.lastLongitude || 0,
                    AppState.lastDeviceAltitude,
                    AppState.lastAltitudeAccuracy,
                    AppState.lastAccuracy,
                    AppState.lastSpeed,
                    AppState.lastEffectiveWindUnit,
                    AppState.lastDirection,
                    false,
                    null
                );
                console.log('Cleared jump master line data from livePositionControl');
            }
        } else {
            // Immediately draw the Jump Master Line if conditions are met
            if (AppState.liveMarker && AppState.livePositionControl &&
                ((Settings.state.userSettings.jumpMasterLineTarget === 'DIP' && AppState.currentMarker &&
                    AppState.lastLat !== null && AppState.lastLng !== null) ||
                    (Settings.state.userSettings.jumpMasterLineTarget === 'HARP' &&
                        Settings.state.userSettings.harpLat && Settings.state.userSettings.harpLng))) {
                console.log('Drawing Jump Master Line immediately for:', Settings.state.userSettings.jumpMasterLineTarget);
                updateJumpMasterLine();
                // Update live position control with current data
                AppState.livePositionControl.update(
                    AppState.lastLatitude || 0,
                    AppState.lastLongitude || 0,
                    AppState.lastDeviceAltitude,
                    AppState.lastAltitudeAccuracy,
                    AppState.lastAccuracy,
                    AppState.lastSpeed,
                    AppState.lastEffectiveWindUnit,
                    AppState.lastDirection,
                    true,
                    null
                );
                // Trigger a position update to ensure line is drawn with latest data
                if (AppState.lastLatitude && AppState.lastLongitude) {
                    debouncedPositionUpdate({
                        coords: {
                            latitude: AppState.lastLatitude,
                            longitude: AppState.lastLongitude,
                            accuracy: AppState.lastAccuracy || 0,
                            altitude: AppState.lastDeviceAltitude,
                            altitudeAccuracy: AppState.lastAltitudeAccuracy
                        }
                    });
                }
            } else {
                console.log('Cannot draw Jump Master Line immediately: missing required data', {
                    hasLiveMarker: !!AppState.liveMarker,
                    hasLivePositionControl: !!AppState.livePositionControl,
                    target: Settings.state.userSettings.jumpMasterLineTarget,
                    hasDIP: AppState.currentMarker && AppState.lastLat !== null && AppState.lastLng !== null,
                    hasHARP: Settings.state.userSettings.harpLat && Settings.state.userSettings.harpLng
                });
            }
        }
    });

    const harpRadio = document.querySelector('input[name="jumpMasterLineTarget"][value="HARP"]');
    if (harpRadio) {
        harpRadio.disabled = !Settings.state.userSettings.harpLat || !Settings.state.userSettings.harpLng;
        console.log('HARP radio button initialized, disabled:', harpRadio.disabled);
    }

    const placeHarpButton = document.getElementById('placeHarpButton');
    if (placeHarpButton) {
        placeHarpButton.addEventListener('click', () => {
            AppState.isPlacingHarp = true;
            console.log('HARP placement mode activated');
            AppState.map.on('click', handleHarpPlacement); // Use imported function
            Utils.handleMessage('Click the map to place the HARP marker');
        });
    }

    const clearHarpButton = document.getElementById('clearHarpButton');
    if (clearHarpButton) {
        clearHarpButton.addEventListener('click', clearHarpMarker); // Use imported function
    }

    const menu = document.querySelector('.hamburger-menu');
    if (menu) {
        menu.addEventListener('click', (e) => {
            console.log('Menu click:', e.target, 'class:', e.target.className, 'id:', e.target.id);
        });
    }
}
function setupCheckbox(id, setting, callback) {
    console.log(`setupCheckbox called for id: ${id}`);
    const checkbox = document.getElementById(id);
    if (checkbox) {
        if (checkbox._changeHandler) {
            checkbox.removeEventListener('change', checkbox._changeHandler);
            console.log(`Removed previous change listener for ${id}`);
        }
        checkbox._changeHandler = (event) => {
            console.log(`Change event fired for ${id}, checked: ${checkbox.checked}, event:`, event);
            event.stopPropagation();
            callback(checkbox);
        };
        checkbox.addEventListener('change', checkbox._changeHandler);
        checkbox.addEventListener('click', (event) => {
            console.log(`Click event on ${id}, checked: ${checkbox.checked}, target:`, event.target);
        });
        console.log(`Attached change and click listeners to ${id}`);
        checkbox.checked = Settings.state.userSettings[setting];
        // Apply visual indication for locked features
        if (id === 'showLandingPattern' && !(Settings.isFeatureUnlocked('landingPattern') && Settings.state.isLandingPatternUnlocked)) {
            checkbox.style.opacity = '0.5';
            checkbox.title = 'Feature locked. Click to enter password.';
        }
    } else {
        console.warn(`Checkbox ${id} not found`);
    }
}
function setupTrackEvents() {
    console.log('[app.js] Setting up track events');
    const trackFileInput = document.getElementById('trackFileInput');
    if (trackFileInput) {
        trackFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            console.log('[app.js] Track file selected:', file?.name);
            if (!file) { /* istanbul ignore next */ Utils.handleError('No file selected.'); return; }

            const extension = file.name.split('.').pop().toLowerCase();
            let trackMetaData = null;

            if (extension === 'gpx') {
                trackMetaData = await loadGpxTrack(file);
            } else if (extension === 'csv') {
                trackMetaData = await loadCsvTrackUTC(file); // Oder loadCsvTrack, je nach Bedarf
            } else {
                Utils.handleError('Unsupported file type. Please upload a .gpx or .csv file.');
                return;
            }

            if (trackMetaData && trackMetaData.success) {
                console.log('[app.js] Track processed successfully by trackManager. MetaData:', trackMetaData);
                if (trackMetaData.historicalDateString) {
                    const historicalDatePicker = document.getElementById('historicalDatePicker');
                    if (historicalDatePicker) {
                        historicalDatePicker.value = trackMetaData.historicalDateString;
                        console.log('[app.js] Set historicalDatePicker to:', historicalDatePicker.value);
                        // Ggf. Autoupdate deaktivieren, wenn ein historisches Datum gesetzt wird
                        if (Settings.state.userSettings.autoupdate) {
                            stopAutoupdate();
                            const autoupdateCheckbox = document.getElementById('autoupdateCheckbox');
                            if (autoupdateCheckbox) autoupdateCheckbox.checked = false;
                            Settings.state.userSettings.autoupdate = false;
                            Settings.save();
                            Utils.handleMessage('Autoupdate disabled due to historical track upload.');
                        }
                    }
                }
                const infoEl = document.getElementById('info');
                if (infoEl && trackMetaData.summaryForInfoElement) {
                    // Logik zum intelligenten Aktualisieren des Info-Bereichs
                    const modelDisplayRegex = /(<br><strong>Available Models:<\/strong><ul>.*?<\/ul>|<br><strong>Available Models:<\/strong> None)/s;
                    const currentInfoHTML = infoEl.innerHTML;
                    const modelInfoMatch = currentInfoHTML.match(modelDisplayRegex);
                    const baseInfo = modelInfoMatch ? modelInfoMatch[0] : ''; // Behalte Modellinfos

                    // Entferne alte Track-Infos, falls vorhanden (heuristisch)
                    const oldTrackInfoRegex = /<br><strong>Track:<\/strong>.*?\(Source:.*?\)/s;
                    let newInfoHTML = currentInfoHTML.replace(modelDisplayRegex, '').replace(oldTrackInfoRegex, '').trim();
                    if (newInfoHTML === 'Click on the map to fetch weather data.' || newInfoHTML === 'No weather data.' || newInfoHTML === 'No models available at this location.' || newInfoHTML === 'Failed to load weather data.' || newInfoHTML === 'No weather model selected.') {
                        newInfoHTML = ''; // Leere Standardnachrichten, um Platz für Trackinfo zu machen
                    }

                    infoEl.innerHTML = (newInfoHTML ? newInfoHTML + "<br>" : "") + trackMetaData.summaryForInfoElement + baseInfo;
                }
            } else if (trackMetaData && !trackMetaData.success) {
                /* istanbul ignore next */
                console.warn('[app.js] Track processing in trackManager reported an error:', trackMetaData.error);
            } else {
                /* istanbul ignore next */
                console.warn('[app.js] Track processing did not return valid metadata or failed silently in trackManager.');
            }
        });
    } else { /* istanbul ignore next */ console.warn('Track file input (#trackFileInput) not found.'); }

    const clearTrackButton = document.getElementById('clearTrack');
    if (clearTrackButton) {
        clearTrackButton.addEventListener('click', () => {
            console.log('[app.js] Clear track button clicked');
            if (!AppState.map) { /* istanbul ignore next */ Utils.handleError('Cannot clear track: map not initialized.'); return; }
            if (AppState.gpxLayer) {
                try {
                    if (AppState.map.hasLayer(AppState.gpxLayer)) AppState.map.removeLayer(AppState.gpxLayer);
                    AppState.gpxLayer = null; AppState.gpxPoints = []; AppState.isTrackLoaded = false;
                    console.log('[app.js] Cleared track from map and AppState');

                    const infoElement = document.getElementById('info');
                    if (infoElement) {
                        const modelDisplayRegex = /(<br><strong>Available Models:<\/strong><ul>.*?<\/ul>|<br><strong>Available Models:<\/strong> None)/s;
                        const currentInfoHTML = infoElement.innerHTML;
                        const modelInfoMatch = currentInfoHTML.match(modelDisplayRegex);
                        const baseMessage = 'Click on the map to fetch weather data.';
                        infoElement.innerHTML = baseMessage + (modelInfoMatch ? modelInfoMatch[0] : '');
                    }
                    if (trackFileInput) trackFileInput.value = ''; // Eingabefeld zurücksetzen
                } catch (error) { /* istanbul ignore next */ Utils.handleError('Failed to clear track: ' + error.message); }
            } else { Utils.handleMessage('No track to clear.'); }
        });
    } else { /* istanbul ignore next */ console.warn('Clear track button (#clearTrack) not found.'); }
}
function setupResetButton() {
    const bottomContainer = document.getElementById('bottom-container');
    const resetButton = document.createElement('button');
    resetButton.id = 'resetButton';
    resetButton.textContent = 'Reset Settings';
    resetButton.title = 'Resets all settings to their default values and locks all features';

    const buttonWrapper = document.createElement('div');
    buttonWrapper.id = 'settings-cache-buttons';
    buttonWrapper.className = 'button-wrapper';

    buttonWrapper.appendChild(resetButton);
    bottomContainer.appendChild(buttonWrapper);

    resetButton.addEventListener('click', () => {
        // Reset settings to defaults
        Settings.state.userSettings = { ...Settings.defaultSettings };
        // Reset feature unlock status
        Settings.state.unlockedFeatures = { landingPattern: false, calculateJump: false };
        Settings.state.isLandingPatternUnlocked = false;
        Settings.state.isCalculateJumpUnlocked = false;
        // Clear localStorage
        localStorage.removeItem('unlockedFeatures');
        localStorage.removeItem('upperWindsSettings');
        console.log('Reset feature unlock status:', { isLandingPatternUnlocked: Settings.state.isLandingPatternUnlocked, isCalculateJumpUnlocked: Settings.state.isCalculateJumpUnlocked, unlockedFeatures: Settings.state.unlockedFeatures });
        // Save and reinitialize settings
        Settings.save();
        Settings.initialize();
        console.log('Settings reset to defaults:', Settings.state.userSettings);

        // Update UI to reflect locked state
        const landingPatternCheckbox = document.getElementById('showLandingPattern');
        if (landingPatternCheckbox) {
            landingPatternCheckbox.checked = false;
            landingPatternCheckbox.style.opacity = '0.5';
            landingPatternCheckbox.title = 'Feature locked. Click to enter password.';
            console.log('Updated landingPatternCheckbox UI: locked');
        }
        const calculateJumpMenuItem = document.getElementById('calculateJumpCheckbox');
        if (calculateJumpMenuItem) {
            calculateJumpMenuItem.checked = false;
            calculateJumpMenuItem.style.opacity = '0.5';
            calculateJumpMenuItem.title = 'Feature locked. Click to enter password.';
            // Hide submenu
            const submenu = calculateJumpMenuItem.parentElement.nextElementSibling;
            if (submenu && submenu.classList.contains('submenu')) {
                submenu.classList.add('hidden');
                console.log('Hid calculateJump submenu');
            }
        }

        // Reinitialize UI elements
        initializeUIElements();
        console.log('Reinitialized UI elements after reset');

        // Trigger tile caching if position is available
        if (AppState.lastLat && AppState.lastLng) {
            cacheTilesForDIP({ map: AppState.map, lastLat: AppState.lastLat, lastLng: AppState.lastLng, baseMaps: AppState.baseMaps });
            console.log('Triggered tile caching after reset');
        }

        Utils.handleMessage('Settings and feature locks reset to default values.');
    });
}
function setupResetCutAwayMarkerButton() {
    const resetButton = document.getElementById('resetCutAwayMarker');
    if (resetButton) {
        resetButton.addEventListener('click', () => {
            if (!AppState.map) {
                console.warn('Map not initialized, cannot reset cut-away marker');
                return;
            }
            if (AppState.cutAwayMarker) {
                AppState.map.removeLayer(AppState.cutAwayMarker);
                AppState.cutAwayMarker = null;
                AppState.cutAwayLat = null;
                AppState.cutAwayLng = null;
                console.log('Cut-away marker reset');
                if (AppState.cutAwayCircle) {
                    AppState.map.removeLayer(AppState.cutAwayCircle);
                    AppState.cutAwayCircle = null;
                    console.log('Cleared cut-away circle');
                }
                document.getElementById('info').innerHTML = 'Right-click map to place cut-away marker';
            }
        });
    }
}
function setupClearHistoricalDate() {
    const clearButton = document.getElementById('clearHistoricalDate');
    if (clearButton) {
        clearButton.addEventListener('click', () => {
            const datePicker = document.getElementById('historicalDatePicker');
            if (datePicker) {
                datePicker.value = '';
                console.log('Cleared historical date, refetching forecast data');
                if (AppState.lastLat && AppState.lastLng) {
                    fetchWeatherForLocation(AppState.lastLat, AppState.lastLng, null);
                    // Re-enable autoupdate if previously enabled
                    if (Settings.state.userSettings.autoupdate) {
                        startAutoupdate();
                    }
                } else {
                    Utils.handleError('Please select a position on the map first.');
                }
            }
        });
    }

    // Add listener for historical date changes
    const datePicker = document.getElementById('historicalDatePicker');
    if (datePicker) {
        datePicker.addEventListener('change', () => {
            if (datePicker.value && Settings.state.userSettings.autoupdate) {
                console.log('Historical date set, disabling autoupdate');
                stopAutoupdate();
                document.getElementById('autoupdateCheckbox').checked = false;
                Settings.state.userSettings.autoupdate = false;
                Settings.save();
                Utils.handleMessage('Autoupdate disabled due to historical date selection.');
            }
            if (AppState.lastLat && AppState.lastLng) {
                fetchWeatherForLocation(AppState.lastLat, AppState.lastLng, datePicker.value);
            } else {
                Utils.handleError('Please select a position on the map first.');
            }
        });
    }
}
function setupJumpRunTrackEvents() {
    console.log("App: Richte Event-Listener für Track-Einstellungen ein.");

    const setupInput = (inputId, settingName) => {
        const element = document.getElementById(inputId);
        if (element) {
            // Setze den Initialwert basierend auf Settings
            element.value = Settings.state.userSettings[settingName] || 0;
            console.log(`Set ${inputId} to initial value:`, element.value);
            element.addEventListener('input', () => {
                const value = parseFloat(element.value);
                if (isNaN(value)) return;
                Settings.state.userSettings[settingName] = value;
                Settings.save();
                updateJumpRunTrackDisplay();
            });
        }
    };

    setupInput('numberOfJumpers', 'numberOfJumpers');
    setupInput('jumperSeparation', 'jumperSeparation');
    setupInput('jumpRunTrackOffset', 'jumpRunTrackOffset');
    setupInput('jumpRunTrackForwardOffset', 'jumpRunTrackForwardOffset');

    const directionInput = document.getElementById('jumpRunTrackDirection');
    if (directionInput) {
        directionInput.value = Settings.state.userSettings.customJumpRunDirection || '';
        directionInput.addEventListener('change', () => {
            const value = parseFloat(directionInput.value);
            if (Number.isFinite(value) && value >= 0 && value <= 359) {
                Settings.state.userSettings.customJumpRunDirection = value;
                console.log(`Setting 'customJumpRunDirection' on change to:`, value);
            } else {
                Settings.state.userSettings.customJumpRunDirection = null;
                directionInput.value = '';
                console.log('Invalid direction, resetting to calculated.');
            }
            Settings.save();
            updateJumpRunTrackDisplay();
        });
    }

    const showTrackCheckbox = document.getElementById('showJumpRunTrack');
    if (showTrackCheckbox) {
        showTrackCheckbox.addEventListener('change', (e) => {
            Settings.state.userSettings.showJumpRunTrack = e.target.checked;
            Settings.save();
            updateJumpRunTrackDisplay();
        });
    }
}
function setupAndHandleInput(inputId, settingName, isNumeric = true) {
    const inputElement = document.getElementById(inputId);
    if (inputElement) {
        inputElement.addEventListener('input', () => {
            // 1. Lese den Wert aus dem Feld.
            let value = inputElement.value;
            // 2. Wandle ihn bei Bedarf in eine Zahl um.
            if (isNumeric) {
                value = parseFloat(value);
                if (isNaN(value)) return; // Bei ungültiger Eingabe abbrechen
            }

            // 3. HIER IST DER ENTSCHEIDENDE SCHRITT: Speichere den neuen Wert im Settings-Objekt.
            Settings.state.userSettings[settingName] = value;
            Settings.save();

            console.log(`Setting '${settingName}' aktualisiert auf:`, value);

            // 4. Erst DANACH die Anzeige neu zeichnen lassen.
            updateJumpRunTrackDisplay();
        });
    }
}

// Setup values
function getSliderValue() {
    return parseInt(document.getElementById('timeSlider')?.value) || 0;
}
function setElementValue(id, value) {
    const element = document.getElementById(id);
    if (element) element.value = value;
    else console.warn(`Element ${id} not found`);
}
function setRadioValue(name, value) {
    const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (radio) radio.checked = true;
    else console.warn(`Radio ${name} with value ${value} not found`);
}
function setInputValue(id, value) {
    const element = document.getElementById(id);
    if (element) element.value = value;
}
function setInputValueSilently(id, value) {
    const input = document.getElementById(id);
    if (input) {
        const lastValue = input.value;
        input.value = value;
        console.log(`Set ${id} silently:`, { old: lastValue, new: value });
    }
}
function setCheckboxValue(id, value) {
    const element = document.getElementById(id);
    if (element) element.checked = value;
}
function toggleSubmenu(element, submenu, isVisible) {
    console.log(`toggleSubmenu called for ${element.textContent || element.id}: ${isVisible ? 'show' : 'hide'}`);
    if (submenu) {
        // Ensure the submenu element has the 'submenu' class
        if (!submenu.classList.contains('submenu')) {
            submenu.classList.add('submenu');
            console.log(`Added 'submenu' class to element:`, { submenuClasses: submenu.classList.toString() });
        }
        submenu.classList.toggle('hidden', !isVisible);
        element.setAttribute('aria-expanded', isVisible);
        console.log(`Submenu toggled for ${element.textContent || element.id}: ${isVisible ? 'shown' : 'hidden'}`, { submenuClassList: submenu.classList.toString() });
        // Debug submenu state after toggle with a delay to detect interference
        let attempts = 0;
        const maxAttempts = 5;
        const forceVisibility = () => {
            const currentState = {
                isHidden: submenu.classList.contains('hidden'),
                submenuClassList: submenu.classList.toString(),
                displayStyle: window.getComputedStyle(submenu).display
            };
            console.log(`Submenu state after toggle for ${element.textContent || element.id} (attempt ${attempts + 1}):`, currentState);
            // Force visibility if opening and submenu is hidden
            if (isVisible && (submenu.classList.contains('hidden') || currentState.displayStyle === 'none')) {
                submenu.classList.remove('hidden');
                submenu.style.display = 'block'; // Force display to counteract interference
                console.log(`Forced submenu to stay open for ${element.textContent || element.id}`, { submenuClassList: submenu.classList.toString(), displayStyle: window.getComputedStyle(submenu).display });
                attempts++;
                if (attempts < maxAttempts) {
                    setTimeout(forceVisibility, 100);
                }
            }
        };
        setTimeout(forceVisibility, 100);
    } else {
        console.warn(`Submenu for ${element.textContent || element.id} not found`);
    }
}
function setupMenuItemEvents() {
    const calculateJumpMenuItem = Array.from(document.querySelectorAll('.menu-label'))
        .find(item => item.textContent.trim() === 'Calculate Jump');

    if (!calculateJumpMenuItem) {
        console.error('Calculate Jump menu item not found');
        const menuItems = document.querySelectorAll('.hamburger-menu .menu-label');
        console.log('Available menu labels:', Array.from(menuItems).map(item => item.textContent.trim()));
        return;
    }

    calculateJumpMenuItem.setAttribute('data-label', 'calculateJump');
    console.log('Found Calculate Jump menu item:', calculateJumpMenuItem);

    // Initialize visual state based on lock status
    if (!(Settings.isFeatureUnlocked('calculateJump') && Settings.state.isCalculateJumpUnlocked)) {
        calculateJumpMenuItem.style.opacity = '0.5';
        calculateJumpMenuItem.title = 'Feature locked. Click to enter password.';
    } else {
        calculateJumpMenuItem.style.opacity = '1';
        calculateJumpMenuItem.title = '';
    }

    // Remove any existing click handlers to prevent duplicates
    calculateJumpMenuItem.removeEventListener('click', calculateJumpMenuItem._clickHandler);
    calculateJumpMenuItem._clickHandler = (event) => {
        event.stopPropagation();
        event.preventDefault();
        const parentLi = calculateJumpMenuItem.closest('li');
        const submenu = parentLi?.querySelector('ul');
        const enableFeature = () => {
            // Diese Funktion wird aufgerufen, wenn das Submenü geöffnet wird
            // oder die Funktion nach Passworteingabe aktiviert wird.
            // Hier sollte Settings.state.userSettings.calculateJump ggf. auf true gesetzt werden,
            // falls es vorher explizit deaktiviert wurde.
            if (!Settings.state.userSettings.calculateJump && Settings.isFeatureUnlocked('calculateJump')) {
                Settings.state.userSettings.calculateJump = true;
                Settings.save();
            }
            toggleSubmenu(calculateJumpMenuItem, submenu, true);
            // calculateJump() nur aufrufen, wenn auch wirklich Daten/Marker da sind und die relevanten Unter-Checkboxen aktiv sind.
            // Die Unter-Checkboxen (showExitArea, showCanopyArea) steuern dann die eigentliche Visualisierung.
            // Ein direkter Aufruf von calculateJump() hier ist vielleicht nicht nötig, da die Checkbox-Handler das tun.
            // Stattdessen die bestehenden Visualisierungen basierend auf den Checkbox-Status neu rendern:
            if (AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                if (Settings.state.userSettings.showExitArea || Settings.state.userSettings.showCanopyArea) {
                    calculateJump(); // Dies berücksichtigt die Checkboxen
                }
                if (Settings.state.userSettings.showCutAwayFinder) {
                    JumpPlanner.calculateCutAway();
                }
                if (Settings.state.userSettings.showJumpRunTrack) {
                    updateJumpRunTrackDisplay();
                }
            }
            calculateJumpMenuItem.style.opacity = '1';
            calculateJumpMenuItem.title = '';
        };

        const disableFeatureOrToggleSubmenu = (isClosingMenu) => {
            toggleSubmenu(calculateJumpMenuItem, submenu, !isClosingMenu); // !isClosingMenu, da es das Submenü schließt

            // Die Kreise etc. bleiben basierend auf ihren Checkboxen sichtbar.
            // Nichts weiter zu tun hier, außer das Menü zu schließen.
            // Die Opacity/Title Logik für den "Calculate Jump" Menüpunkt sollte nur die Passwort-Sperre reflektieren.
            if (!(Settings.isFeatureUnlocked('calculateJump') && Settings.state.isCalculateJumpUnlocked)) {
                calculateJumpMenuItem.style.opacity = '0.5';
                calculateJumpMenuItem.title = 'Feature locked. Click to enter password.';
            } else {
                calculateJumpMenuItem.style.opacity = '1';
                calculateJumpMenuItem.title = '';
            }
        };

        calculateJumpMenuItem._clickHandler = (event) => {
            event.stopPropagation();
            event.preventDefault();
            // const parentLi = calculateJumpMenuItem.closest('li'); // Ist schon oben
            // const submenu = parentLi?.querySelector('ul'); // Ist schon oben

            if (!Settings.isFeatureUnlocked('calculateJump')) {
                Settings.showPasswordModal('calculateJump', enableFeature, () => {
                    if (submenu) toggleSubmenu(calculateJumpMenuItem, submenu, false); // Schließe Submenü bei Abbruch
                });
            } else {
                // Wenn die Funktion freigeschaltet ist, toggelt der Klick nur das Submenü
                // und ruft die entsprechende Funktion zum Öffnen oder Schließen auf.
                if (submenu) {
                    const isSubmenuHidden = submenu.classList.contains('hidden');
                    if (isSubmenuHidden) { // Wird geöffnet
                        enableFeature(); // Stellt sicher, dass calculateJump = true ist, falls es mal deaktiviert war
                    } else { // Wird geschlossen
                        disableFeatureOrToggleSubmenu(true); // true bedeutet, wir schließen das Menü
                    }
                }
            }
        };

        calculateJumpMenuItem.addEventListener('click', calculateJumpMenuItem._clickHandler, { capture: true }); console.log('Attached click handler to Calculate Jump menu item with capture phase');
    }
}
function setupRadioGroup(name, callback) {
    const radios = document.querySelectorAll(`input[name="${name}"]`);
    radios.forEach(radio => {
        radio.addEventListener('change', () => {
            const newValue = Settings.getValue(name, 'radio', Settings.defaultSettings[name]);
            Settings.state.userSettings[name] = newValue;
            Settings.save();
            console.log(`${name} changed to: ${newValue} and saved to localStorage`);

            if (name === 'landingDirection') {
                const customLL = document.getElementById('customLandingDirectionLL');
                const customRR = document.getElementById('customLandingDirectionRR');
                const landingDirection = Settings.state.userSettings.landingDirection;

                if (customLL) customLL.disabled = landingDirection !== 'LL';
                if (customRR) customRR.disabled = landingDirection !== 'RR';

                if (landingDirection === 'LL' && customLL && !customLL.value && Settings.state.userSettings.customLandingDirectionLL === '') {
                    customLL.value = Math.round(AppState.landingWindDir || 0);
                    Settings.state.userSettings.customLandingDirectionLL = parseInt(customLL.value);
                    Settings.save();
                    console.log(`Set customLandingDirectionLL to ${customLL.value}`);
                }
                if (landingDirection === 'RR' && customRR && !customRR.value && Settings.state.userSettings.customLandingDirectionRR === '') {
                    customRR.value = Math.round(AppState.landingWindDir || 0);
                    Settings.state.userSettings.customLandingDirectionRR = parseInt(customRR.value);
                    Settings.save();
                    console.log(`Set customLandingDirectionRR to ${customRR.value}`);
                }
            }
            callback();
        });
    });
}
function setupInput(id, eventType, debounceTime, callback) {
    const input = document.getElementById(id);
    if (!input) {
        console.warn(`Input element ${id} not found`);
        return;
    }
    input.addEventListener(eventType, Utils.debounce(() => {
        const value = input.type === 'number' ? parseFloat(input.value) : input.value;
        Settings.state.userSettings[id] = value;
        Settings.save();
        console.log(`${id} changed to: ${value} and saved to localStorage`);
        callback(value);
    }, debounceTime));
}
function validateLegHeights(final, base, downwind) {
    const finalVal = parseInt(final.value) || 100;
    const baseVal = parseInt(base.value) || 200;
    const downwindVal = parseInt(downwind.value) || 300;

    if (baseVal <= finalVal) {
        Utils.handleError('Base leg must start higher than final leg.');
        return false;
    }
    if (downwindVal <= baseVal) {
        Utils.handleError('Downwind leg must start higher than base leg.');
        return false;
    }
    return true;
}
function setupLegHeightInput(id, defaultValue) {
    const input = document.getElementById(id);
    if (!input) {
        console.warn(`Input element ${id} not found`);
        return;
    }
    input.addEventListener('blur', () => {
        const value = parseInt(input.value) || defaultValue;
        console.log(`Attempting to update ${id} to ${value}`);
        Settings.state.userSettings[id] = value;
        Settings.save();

        const finalInput = document.getElementById('legHeightFinal');
        const baseInput = document.getElementById('legHeightBase');
        const downwindInput = document.getElementById('legHeightDownwind');

        if (!isNaN(value) && value >= 50 && value <= 1000 && validateLegHeights(finalInput, baseInput, downwindInput)) {
            console.log(`Valid ${id}: ${value}, updating displays`);
            updateAllDisplays();
            if (AppState.weatherData && AppState.lastLat && AppState.lastLng && id === 'legHeightDownwind' && Settings.state.userSettings.calculateJump) {
                debouncedCalculateJump();
            }
        } else {
            let adjustedValue = defaultValue;
            const finalVal = parseInt(finalInput?.value) || 100;
            const baseVal = parseInt(baseInput?.value) || 200;
            const downwindVal = parseInt(downwindInput?.value) || 300;

            if (id === 'legHeightFinal') adjustedValue = Math.min(baseVal - 1, 100);
            if (id === 'legHeightBase') adjustedValue = Math.max(finalVal + 1, Math.min(downwindVal - 1, 200));
            if (id === 'legHeightDownwind') adjustedValue = Math.max(baseVal + 1, 300);

            input.value = adjustedValue;
            Settings.state.userSettings[id] = adjustedValue;
            Settings.save();
            console.log(`Adjusted ${id} to ${adjustedValue} due to invalid input`);
            Utils.handleError(`Adjusted ${id} to ${adjustedValue} to maintain valid leg order.`);
        }
    });
}
async function updateAllDisplays() {
    console.log('updateAllDisplays called');
    try {
        const sliderIndex = getSliderValue();
        if (AppState.weatherData && AppState.lastLat && AppState.lastLng) {
            await updateWeatherDisplay(sliderIndex);
            if (AppState.lastAltitude !== 'N/A') calculateMeanWind();
            if (Settings.state.userSettings.showLandingPattern) updateLandingPatternDisplay();
            if (Settings.state.userSettings.calculateJump) {
                debouncedCalculateJump();
                JumpPlanner.calculateCutAway();
                if (Settings.state.userSettings.showJumpRunTrack) updateJumpRunTrackDisplay();
            }
            mapManager.recenterMap();
        }
        updateLivePositionControl();

        if (AppState.jumpMasterLine && AppState.liveMarker && AppState.currentMarker && AppState.lastLat !== null && AppState.lastLng !== null) {
            if (!AppState.map) {
                console.warn('Map not initialized, cannot update Jump Master Line popup');
                return;
            }
            const liveLatLng = AppState.liveMarker.getLatLng();
            const dipLatLng = AppState.currentMarker.getLatLng();
            const bearing = Utils.calculateBearing(liveLatLng.lat, liveLatLng.lng, dipLatLng.lat, dipLatLng.lng).toFixed(0);
            const distanceMeters = AppState.map.distance(liveLatLng, dipLatLng);
            const heightUnit = getHeightUnit();
            const convertedDistance = Utils.convertHeight(distanceMeters, heightUnit);
            const roundedDistance = Math.round(convertedDistance);
            AppState.jumpMasterLine.setPopupContent(`<b>Jump Master Line</b><br>Bearing: ${bearing}°<br>Distance: ${roundedDistance} ${heightUnit}`);
            console.log('Updated Jump Master Line popup for heightUnit:', { bearing, distance: roundedDistance, unit: heightUnit });
        }

        // NEU: Ensemble-Visualisierung aktualisieren, wenn sich Anzeige-Parameter ändern
        if (Settings.state.userSettings.selectedEnsembleModels && Settings.state.userSettings.selectedEnsembleModels.length > 0) {
            console.log("updateAllDisplays triggering ensemble update.");
            processAndVisualizeEnsemble();
        }

    } catch (error) {
        console.error('Error in updateAllDisplays:', error);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // 1. Grundlegende Settings initialisieren, die keine Karte brauchen.
    Settings.initialize();
    initializeApp();
    initializeUIElements();

    // 2. Rufe initializeMap auf und WARTE auf das Ergebnis (die fertige Karte).
    //    Die `await`-Anweisung pausiert den Code hier, bis die Karte bereit ist.
    const mapInstance = mapManager.initializeMap();

    // 3. Erst wenn die Karte garantiert existiert, die abhängigen Funktionen aufrufen.
    if (mapInstance) {
        console.log("App: Karte ist bereit, richte abhängige Events ein.");
        setupMapEventListeners(); // Ihr neuer Listener für Karten-Events
        setupMenuEvents();
        setupSliderEvents();
        setupCheckboxEvents();
        setupCoordinateEvents();
        setupDownloadEvents();
        setupResetButton();
        setupResetCutAwayMarkerButton();
        setupClearHistoricalDate();
        setupTrackEvents();
        setupCacheManagement();
        setupCacheSettings({ map: AppState.map, lastLat: AppState.lastLat, lastLng: AppState.lastLng, baseMaps: AppState.baseMaps });
        setupAutoupdate();
        setupJumpRunTrackEvents();
    } else {
        console.error("App: Karteninitialisierung ist fehlgeschlagen. UI-Events werden nicht eingerichtet.");
        Utils.handleError("Map could not be loaded. Please refresh the page.");
    }

    // NEU: track:dragend-Listener hier platzieren
    document.addEventListener('track:dragend', (event) => {
        console.log("App: Event 'track:dragend' empfangen. Berechne und speichere neue Offsets.");

        const { newPosition, originalTrackData } = event.detail;

        // Validierung der Eingangsdaten
        if (!newPosition || !Number.isFinite(newPosition.lat) || !Number.isFinite(newPosition.lng)) {
            console.warn('Invalid newPosition:', newPosition);
            return;
        }
        if (!originalTrackData?.path?.latlngs?.[0] || !originalTrackData?.path?.latlngs?.[1]) {
            console.warn('Invalid originalTrackData:', originalTrackData);
            return;
        }

        // Berechne den ursprünglichen Endpunkt des Tracks (Flugzeugposition)
        const originalEnd = L.latLng(originalTrackData.path.latlngs[1][0], originalTrackData.path.latlngs[1][1]);
        const trackDirection = originalTrackData.airplane.bearing;
        const trackRad = trackDirection * Math.PI / 180; // Track-Richtung in Radiant

        // Berechne die Verschiebung relativ zum ursprünglichen Endpunkt
        const deltaLat = newPosition.lat - originalEnd.lat;
        const deltaLng = newPosition.lng - originalEnd.lng;

        // Konvertiere die Verschiebung in Meter
        const metersPerDegreeLat = 111000; // 111 km pro Grad
        const metersPerDegreeLng = 111000 * Math.cos(originalEnd.lat * Math.PI / 180);
        const deltaX = deltaLng * metersPerDegreeLng; // X-Richtung (entlang Längengrade, Ost-West)
        const deltaY = deltaLat * metersPerDegreeLat; // Y-Richtung (entlang Breitengrade, Nord-Süd)

        // Projiziere die Verschiebung auf die Track-Richtung (forward) und senkrecht dazu (lateral)
        // Forward: entlang der Track-Richtung (trackRad)
        // Lateral: senkrecht zur Track-Richtung (trackRad + 90°)
        const forwardOffset = Math.round(
            deltaX * Math.cos(trackRad) + deltaY * Math.sin(trackRad)
        );
        const lateralOffset = Math.round(
            deltaX * Math.sin(trackRad) - deltaY * Math.cos(trackRad)
        );

        // Speichere die neuen Offsets
        Settings.state.userSettings.jumpRunTrackOffset = lateralOffset;
        Settings.state.userSettings.jumpRunTrackForwardOffset = forwardOffset;
        Settings.save();

        // Aktualisiere die Eingabefelder
        const lateralOffsetInput = document.getElementById('jumpRunTrackOffset');
        if (lateralOffsetInput) {
            lateralOffsetInput.value = lateralOffset;
            console.log('Updated jumpRunTrackOffset input to:', lateralOffset);
        }
        const forwardOffsetInput = document.getElementById('jumpRunTrackForwardOffset');
        if (forwardOffsetInput) {
            forwardOffsetInput.value = forwardOffset;
            console.log('Updated jumpRunTrackForwardOffset input to:', forwardOffset);
        }

        // Aktualisiere den Track
        setTimeout(() => {
            updateJumpRunTrackDisplay();
        }, 0);
    });

    document.addEventListener('location:selected', async (event) => {
        const { lat, lng, source } = event.detail;
        console.log(`App: Event 'map:location_selected' empfangen. Quelle: ${source}, Koordinaten:`, { lat, lng });
        try {
            console.log('App: Rufe createOrUpdateMarker auf...');
            await mapManager.createOrUpdateMarker(lat, lng);
            console.log('App: createOrUpdateMarker abgeschlossen.');
            Coordinates.updateCurrentMarkerPosition(lat, lng);
            if (event.detail.source !== 'marker_drag') {
                Coordinates.addCoordToHistory(lat, lng);
            }
            resetJumpRunDirection(true);
            await fetchWeatherForLocation(lat, lng);
            if (Settings.state.userSettings.calculateJump) {
                calculateJump();
            }
            // NEU: Zeichne JRT, wenn showJumpRunTrack aktiviert ist
            if (Settings.state.userSettings.showJumpRunTrack && Settings.state.isCalculateJumpUnlocked && Settings.state.userSettings.calculateJump) {
                console.log('App: showJumpRunTrack ist aktiviert, rufe updateJumpRunTrackDisplay auf');
                updateJumpRunTrackDisplay();
            }
            mapManager.recenterMap(true);
            AppState.isManualPanning = false;
        } catch (error) {
            console.error('Fehler beim Verarbeiten von "map:location_selected":', error);
            Utils.handleError(error.message);
        }
    });


    // --- FÜGEN SIE DIESEN NEUEN LISTENER HINZU ---
    document.addEventListener('map:zoomend', (event) => {
        console.log("App: Event 'map:zoomend' empfangen.");

        // Hier ist jetzt das neue Zuhause für die Anwendungslogik!
        if (Settings.state.userSettings.calculateJump && AppState.weatherData && AppState.lastLat) {
            calculateJump();
        }
        if (Settings.state.userSettings.showJumpRunTrack) {
            updateJumpRunTrackDisplay();
        }
        if (Settings.state.userSettings.showLandingPattern) {
            updateLandingPatternDisplay();
        }

    });
});