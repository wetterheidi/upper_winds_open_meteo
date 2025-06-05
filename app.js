// == Project: Skydiving Weather and Jump Planner ==
// == Constants and Global Variables ==
import { Utils } from './utils.js';
import { Settings } from './settings.js';
import { Constants, FEATURE_PASSWORD } from './constants.js';
import { displayMessage, displayProgress, displayError, hideProgress, updateOfflineIndicator, isMobileDevice } from './ui.js';
import { TileCache, cacheTilesForDIP, debouncedCacheVisibleTiles } from './tileCache.js';
import { setupCacheManagement, setupCacheSettings } from './cacheUI.js';
import * as Coordinates from './coordinates.js';
import { interpolateColor, generateWindBarb, createArrowIcon } from "./uiHelpers.js";
import { handleHarpPlacement, createHarpMarker, clearHarpMarker } from './harpMarker.js';
import { loadGpxTrack, loadCsvTrackUTC } from './trackManager.js';

"use strict";

let userSettings;
try {
    const storedSettings = localStorage.getItem('upperWindsSettings');
    userSettings = storedSettings ? JSON.parse(storedSettings) : { ...Settings.defaultSettings };
} catch (error) {
    console.error('Failed to parse upperWindsSettings from localStorage:', error);
    userSettings = { ...Settings.defaultSettings };
}

export { createCustomMarker, attachMarkerDragend, updateMarkerPopup, fetchWeatherForLocation, debouncedCalculateJump, calculateCutAway };
export const AppState = {
    isInitialized: false,
    coordsControl: null,
    lastMouseLatLng: null,
    landingPatternPolygon: null,
    secondlandingPatternPolygon: null,
    thirdLandingPatternLine: null,
    finalArrow: null,
    baseArrow: null,
    downwindArrow: null,
    landingWindDir: null,
    cutAwayMarker: null,
    cutAwayLat: null,
    cutAwayLng: null,
    cutAwayCircle: null,
    jumpRunTrackLayer: null,
    customJumpRunDirection: null,
    isJumperSeparationManual: false,
    jumpCircle: null,
    jumpCircleFull: null,
    jumpCircleGreen: null,
    jumpCircleGreenLight: null,
    weatherData: null,
    lastModelRun: null,
    gpxLayer: null,
    gpxPoints: [],
    isLoadingGpx: false,
    isTrackLoaded: false, // New flag
    liveMarker: null,
    jumpMasterLine: null,
    isPlacingHarp: false,
    harpMarker: null,
    watchId: null,
    prevLat: null,
    prevLng: null,
    prevTime: null,
    livePositionControl: null,
    lastLatitude: null,
    lastLongitude: null,
    lastDeviceAltitude: null,
    lastAltitudeAccuracy: null,
    lastAccuracy: null,
    lastSpeed: 'N/A',
    lastEffectiveWindUnit: 'kt',
    lastDirection: 'N/A',
    lastTerrainAltitude: 'N/A',
    lastSmoothedSpeedMs: 0,
    map: null,
    baseMaps: {},
    lastLat: null,
    lastLng: null,
    lastAltitude: null,
    currentMarker: null,
    isManualPanning: false,
    autoupdateInterval: null,
    accuracyCircle: null,
    additionalBlueCircles: [],
    additionalBlueLabels: [],
    ensembleModelsData: null, // Objekt zur Speicherung der Wetterdaten für jedes ausgewählte Ensemble-Modell, z.B. { icon_global: weatherDataICON, gfs_global: weatherDataGFS }
    selectedEnsembleModels: [], // Array der Namen der ausgewählten Ensemble-Modelle
    currentEnsembleScenario: 'all_models', // Aktuell ausgewähltes Szenario
    ensembleLayerGroup: null, // Eigene LayerGroup für Ensemble-Visualisierungen
    ensembleScenarioCircles: {}, // Speichert die Leaflet-Layer für die Szenario-Kreise, z.B. { min_wind: circleLayer, mean_wind: circleLayer }
};

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
let mapInitialized = false;
let elevationCache = new Map();
let qfeCache = new Map();
let lastTapTime = 0;
let hasTileErrorSwitched = false;

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

// HILFSFUNKTIONEN FÜR initMap (innerhalb von app.js)

function _initializeBasicMapInstance(defaultCenter, defaultZoom) {
    AppState.lastLat = AppState.lastLat || defaultCenter[0];
    AppState.lastLng = AppState.lastLng || defaultCenter[1];
    AppState.map = L.map('map', {
        center: defaultCenter,
        zoom: defaultZoom,
        zoomControl: false,
        doubleClickZoom: false, // Wichtig für eigenen dblclick Handler
        maxZoom: 19,
        minZoom: navigator.onLine ? 6 : 11
    });
    console.log('Map instance created.');
}
function _setupBaseLayersAndHandling() {
    AppState.baseMaps = {
        "OpenStreetMap": L.tileLayer.cached('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            subdomains: ['a', 'b', 'c']
        }),
        "OpenTopoMap": L.tileLayer.cached('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            maxZoom: 17,
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a>, <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
            subdomains: ['a', 'b', 'c']
        }),
        "Esri Satellite": L.tileLayer.cached('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: '© Esri, USDA, USGS'
        }),
        "Esri Street": L.tileLayer.cached('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: '© Esri, USGS'
        }),
        "Esri Topo": L.tileLayer.cached('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: '© Esri, USGS'
        }),
        "Esri Satellite + OSM": L.layerGroup([
            L.tileLayer.cached('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                maxZoom: 19,
                attribution: '© Esri, USDA, USGS',
                zIndex: 1
            }),
            L.tileLayer.cached('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
                opacity: 0.5,
                zIndex: 2,
                updateWhenIdle: true,
                keepBuffer: 2,
                subdomains: ['a', 'b', 'c']
            })
        ], {
            attribution: '© Esri, USDA, USGS | © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        })
    };

    const openMeteoAttribution = 'Weather data by <a href="https://open-meteo.com">Open-Meteo</a>';
    if (AppState.map && AppState.map.attributionControl) {
        AppState.map.attributionControl.addAttribution(openMeteoAttribution);
    }

    const selectedBaseMapName = Settings.state.userSettings.baseMaps in AppState.baseMaps
        ? Settings.state.userSettings.baseMaps
        : "Esri Street";
    const activeLayer = AppState.baseMaps[selectedBaseMapName];

    if (activeLayer && typeof activeLayer.on === 'function') {
        activeLayer.on('tileerror', () => {
            if (!navigator.onLine) {
                if (!hasTileErrorSwitched) {
                    console.warn(`${selectedBaseMapName} tiles unavailable offline. Zoom restricted.`);
                    Utils.handleMessage('Offline: Zoom restricted to levels 11–14 for cached tiles.');
                    hasTileErrorSwitched = true;
                }
                return;
            }
            if (!hasTileErrorSwitched && AppState.map.hasLayer(activeLayer)) {
                const fallbackBaseMapName = "OpenStreetMap";
                console.warn(`${selectedBaseMapName} tiles unavailable, switching to ${fallbackBaseMapName}`);
                AppState.map.removeLayer(activeLayer);
                AppState.baseMaps[fallbackBaseMapName].addTo(AppState.map);
                Settings.state.userSettings.baseMaps = fallbackBaseMapName;
                Settings.save();
                Utils.handleMessage(`${selectedBaseMapName} tiles unavailable. Switched to ${fallbackBaseMapName}.`);
                hasTileErrorSwitched = true;
            } else if (!hasTileErrorSwitched) {
                console.warn(`Tile error in ${selectedBaseMapName}, attempting to continue.`);
            }
        });
        activeLayer.addTo(AppState.map);
    } else {
        console.error(`Default base map "${selectedBaseMapName}" could not be added.`);
        AppState.baseMaps["OpenStreetMap"].addTo(AppState.map); // Sicherer Fallback
    }

    if (AppState.map) AppState.map.invalidateSize();

    window.addEventListener('online', () => {
        hasTileErrorSwitched = false;
        if (AppState.map) AppState.map.options.minZoom = 6;
        updateOfflineIndicator(); // updateOfflineIndicator muss global/importiert sein
    });
    window.addEventListener('offline', () => {
        if (AppState.map) AppState.map.options.minZoom = 9;
        updateOfflineIndicator();
    });
    console.log('Base layers and online/offline handlers set up.');
}
function _addStandardMapControls() {
    if (!AppState.map) {
        console.error("Karte nicht initialisiert, bevor Controls hinzugefügt werden können.");
        return;
    }
    L.control.layers(AppState.baseMaps, null, { position: 'topright' }).addTo(AppState.map);
    AppState.map.on('baselayerchange', function (e) {
        console.log(`Base map changed to: ${e.name}`);
        if (Settings && Settings.state && Settings.state.userSettings) {
            Settings.state.userSettings.baseMaps = e.name;
            Settings.save();
            console.log(`Saved selected base map "${e.name}" to settings.`);
        } else {
            console.error("Settings object not properly available to save base map choice.");
        }
        hasTileErrorSwitched = false;
        if (AppState.lastLat && AppState.lastLng && typeof cacheTilesForDIP === 'function') {
            cacheTilesForDIP({ map: AppState.map, lastLat: AppState.lastLat, lastLng: AppState.lastLng, baseMaps: AppState.baseMaps });
        }
    });
    L.control.zoom({ position: 'topright' }).addTo(AppState.map);
    L.control.polylineMeasure({
        position: 'topright',
        unit: 'kilometres',
        showBearings: true,
        clearMeasurementsOnStop: false,
        showClearControl: true,
        showUnitControl: true,
        tooltipTextFinish: 'Click to finish the line<br>',
        tooltipTextDelete: 'Shift-click to delete point', tooltipTextMove: 'Drag to move point<br>',
        tooltipTextResume: 'Click to resume line<br>', tooltipTextAdd: 'Click to add point<br>',
        measureControlTitleOn: 'Start measuring distance and bearing',
        measureControlTitleOff: 'Stop measuring'
    }).addTo(AppState.map);

    L.control.scale({
        position: 'bottomleft',
        metric: true,
        imperial: false,
        maxWidth: 100
    }).addTo(AppState.map);
    console.log('Standard map controls and baselayerchange handler added.');
}
function _setupCustomPanes() {
    AppState.map.createPane('gpxTrackPane');
    AppState.map.getPane('gpxTrackPane').style.zIndex = 650;
    AppState.map.getPane('tooltipPane').style.zIndex = 700;
    AppState.map.getPane('popupPane').style.zIndex = 700;
    console.log('Custom map panes created.');
}
function _initializeLivePositionControl() {
    AppState.livePositionControl = L.control.livePosition({ position: 'bottomright' }).addTo(AppState.map);
    if (AppState.livePositionControl._container) {
        AppState.livePositionControl._container.style.display = 'none';
        console.log('Initialized livePositionControl and hid by default');
    } else {
        console.warn('livePositionControl._container not initialized in initMap');
    }
}
function _initializeDefaultMarker(defaultCenter, initialAltitude) {
    // Annahme: createCustomMarker, attachMarkerDragend, updateMarkerPopup sind global in app.js definiert
    AppState.currentMarker = Utils.configureMarker(
        AppState.map,
        defaultCenter[0],
        defaultCenter[1],
        initialAltitude, false,
        createCustomMarker,
        attachMarkerDragend,
        updateMarkerPopup,
        AppState.currentMarker,
        (marker) => { AppState.currentMarker = marker; }
    );
    AppState.isManualPanning = false;
    console.log('Default marker initialized.');
}
async function _initializeTileCacheLogic() {
    try {
        await TileCache.init();
        await TileCache.migrateTiles();
        const size = await TileCache.getCacheSize();
        if (size > 500) {
            const result = await TileCache.clearOldTiles(3);
            Utils.handleMessage(`Cleared ${result.deletedCount} old tiles: ${result.deletedSizeMB.toFixed(2)} MB freed.`);
        } else {
            await TileCache.clearOldTiles();
        }
    } catch (error) {
        console.error('Failed to initialize or manage tile cache:', error);
        Utils.handleError('Tile caching setup failed.');
    }
    console.log('Tile cache logic initialized.');
}
async function _geolocationSuccessCallback(position, defaultZoom) {
    const userCoords = [position.coords.latitude, position.coords.longitude];
    AppState.lastLat = position.coords.latitude;
    AppState.lastLng = position.coords.longitude;
    AppState.lastAltitude = await Utils.getAltitude(AppState.lastLat, AppState.lastLng);
    Coordinates.addCoordToHistory(AppState.lastLat, AppState.lastLng);

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
    AppState.map.setView(userCoords, defaultZoom);

    if (Settings.state.userSettings.calculateJump) {
        calculateJump();
        calculateCutAway();
    }
    recenterMap(true);
    AppState.isManualPanning = false;
    await _fetchInitialWeather(AppState.lastLat, AppState.lastLng);
    if (Settings.state.userSettings.trackPosition) {
        setCheckboxValue('trackPositionCheckbox', true);
        startPositionTracking();
    }
    cacheTilesForDIP({ map: AppState.map, lastLat: AppState.lastLat, lastLng: AppState.lastLng, baseMaps: AppState.baseMaps });
    console.log('Geolocation success handled.');
}
async function _geolocationErrorCallback(error, defaultCenter, defaultZoom) {
    console.warn(`Geolocation error: ${error.message}`);
    Utils.handleMessage('Unable to retrieve your location. Using default location.');
    AppState.lastLat = defaultCenter[0]; AppState.lastLng = defaultCenter[1];
    AppState.lastAltitude = await Utils.getAltitude(AppState.lastLat, AppState.lastLng);
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
    AppState.map.setView(defaultCenter, defaultZoom);
    recenterMap(true);
    AppState.isManualPanning = false;
    await _fetchInitialWeather(AppState.lastLat, AppState.lastLng);
    if (Settings.state.userSettings.trackPosition) {
        Utils.handleMessage('Tracking disabled due to geolocation failure.');
        setCheckboxValue('trackPositionCheckbox', false);
        Settings.state.userSettings.trackPosition = false;
        Settings.save();
    }
    cacheTilesForDIP({ map: AppState.map, lastLat: AppState.lastLat, lastLng: AppState.lastLng, baseMaps: AppState.baseMaps });
    console.log('Geolocation error handled.');
}
async function _handleGeolocation(defaultCenter, defaultZoom) {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => _geolocationSuccessCallback(position, defaultZoom),
            (geoError) => _geolocationErrorCallback(geoError, defaultCenter, defaultZoom),
            {
                enableHighAccuracy: true,
                timeout: 20000,
                maximumAge: 0
            }
        );
    } else {
        console.warn('Geolocation not supported.');
        await _geolocationErrorCallback({ message: "Geolocation not supported by this browser." }, defaultCenter, defaultZoom);
    }
}
function _initializeCoordsControlAndHandlers() {
    AppState.coordsControl = new L.Control.Coordinates();
    AppState.coordsControl.addTo(AppState.map);
    console.log('CoordsControl initialized.');

    // Mousemove Handler (vereinfacht, da debouncedGetElevationAndQFE jetzt globaler ist)
    AppState.map.on('mousemove', function (e) {
        _handleMapMouseMove(e); // Ausgelagert
    });

    AppState.map.on('mouseout', function () {
        if (AppState.coordsControl && AppState.coordsControl.getContainer()) {
            AppState.coordsControl.getContainer().innerHTML = 'Move mouse over map';
        }
    });
    console.log('Mousemove and mouseout handlers set up.');
}

// Die einzelnen komplexen Event-Handler
function _handleMapMouseMove(e) {
    const coordFormat = getCoordinateFormat(); // getCoordinateFormat muss global definiert sein
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    AppState.lastMouseLatLng = { lat, lng };

    let coordText;
    if (coordFormat === 'MGRS') {
        const mgrsVal = Utils.decimalToMgrs(lat, lng); // Utils.decimalToMgrs
        coordText = `MGRS: ${mgrsVal ? mgrsVal : 'N/A'}`;
    } else if (coordFormat === 'DMS') {
        const latDMS = Utils.decimalToDms(lat, true); // Utils.decimalToDms
        const lngDMS = Utils.decimalToDms(lng, false); // Utils.decimalToDms
        coordText = `Lat: ${latDMS}, Lng: ${lngDMS}`;
    } else {
        coordText = `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;
    }

    if (AppState.coordsControl) {
        AppState.coordsControl.update(`${coordText}<br>Elevation: Fetching...<br>QFE: Fetching...`);
    }

    debouncedGetElevationAndQFE(lat, lng, { lat, lng }, ({ elevation, qfe }, requestLatLng) => {
        if (AppState.lastMouseLatLng && AppState.coordsControl) {
            const deltaLat = Math.abs(AppState.lastMouseLatLng.lat - requestLatLng.lat);
            const deltaLng = Math.abs(AppState.lastMouseLatLng.lng - requestLatLng.lng);
            const threshold = 0.05;
            if (deltaLat < threshold && deltaLng < threshold) {
                const heightUnit = getHeightUnit(); // getHeightUnit muss global definiert sein
                let displayElevation = elevation === 'N/A' ? 'N/A' : elevation;
                if (displayElevation !== 'N/A') {
                    displayElevation = Utils.convertHeight(displayElevation, heightUnit); // Utils.convertHeight
                    displayElevation = Math.round(displayElevation);
                }
                const qfeText = qfe === 'N/A' ? 'N/A' : `${qfe} hPa`;
                AppState.coordsControl.update(`${coordText}<br>Elevation: ${displayElevation} ${displayElevation === 'N/A' ? '' : heightUnit}<br>QFE: ${qfeText}`);
            }
        }
    });
}
async function _handleMapDblClick(e) {
    console.log('--- _handleMapDblClick START ---', e.latlng);
    const { lat, lng } = e.latlng;
    AppState.lastLat = lat;
    AppState.lastLng = lng;
    AppState.lastAltitude = await Utils.getAltitude(lat, lng);
    console.log('Map double-clicked, moving marker to:', { lat, lng });
    Coordinates.addCoordToHistory(lat, lng);

    AppState.currentMarker = Utils.configureMarker(
        AppState.map,
        AppState.lastLat,
        AppState.lastLng,
        AppState.lastAltitude,
        false, // openPopup
        createCustomMarker,
        attachMarkerDragend,
        updateMarkerPopup,
        AppState.currentMarker,
        (newMarker) => {
            AppState.currentMarker = newMarker;
            console.log('_handleMapDblClick: setCurrentMarker callback. New AppState.currentMarker ID:', newMarker ? newMarker._leaflet_id : 'none');
        }
    );

    resetJumpRunDirection(true);
    if (Settings.state.userSettings.calculateJump) {
        calculateJump();
        calculateCutAway();
    }
    recenterMap(true);
    AppState.isManualPanning = false;

    const slider = document.getElementById('timeSlider');
    const currentIndex = parseInt(slider.value) || 0;
    const currentTime = AppState.weatherData?.time?.[currentIndex] || null;

    await fetchWeatherForLocation(lat, lng, currentTime);

    if (Settings.state.userSettings.showJumpRunTrack) updateJumpRunTrack();
    if (AppState.map && AppState.lastLat && AppState.lastLng && AppState.baseMaps) {
        cacheTilesForDIP({ map: AppState.map, lastLat: AppState.lastLat, lastLng: AppState.lastLng, baseMaps: AppState.baseMaps });
    }
    if (Settings.state.userSettings.showJumpMasterLine && Settings.state.userSettings.trackPosition) updateJumpMasterLine();
    console.log('--- _handleMapDblClick END ---');
}
function _setupCoreMapEventHandlers() {
    if (!AppState.map) {
        console.error("Karte nicht initialisiert in _setupCoreMapEventHandlers");
        return;
    }
    if (!AppState.coordsControl) {
        AppState.coordsControl = new L.Control.Coordinates();
        AppState.coordsControl.addTo(AppState.map);
        console.log('CoordsControl initialized in _setupCoreMapEventHandlers.');
    }

    AppState.map.on('mousemove', _handleMapMouseMove);
    AppState.map.on('mouseout', function () {
        if (AppState.coordsControl && AppState.coordsControl.getContainer()) {
            AppState.coordsControl.getContainer().innerHTML = 'Move mouse over map';
        }
    });

    AppState.map.on('dblclick', _handleMapDblClick);

    // Zoom Events
    AppState.map.on('zoomstart', (e) => {
        if (!navigator.onLine) {
            const targetZoom = e.target._zoom || AppState.map.getZoom();
            if (targetZoom < 11) {
                e.target._zoom = 11;
                AppState.map.setZoom(11);
                Utils.handleMessage('Offline: Zoom restricted to levels 11–14 for cached tiles.');
            } else if (targetZoom > 14) {
                e.target._zoom = 14;
                AppState.map.setZoom(14);
                Utils.handleMessage('Offline: Zoom restricted to levels 11–14 for cached tiles.');
            }
        }
    });
    AppState.map.on('zoomend', () => {
        const currentZoom = AppState.map.getZoom();
        if (Settings.state.userSettings.calculateJump && AppState.weatherData && AppState.lastLat && AppState.lastLng) calculateJump();
        if (Settings.state.userSettings.showJumpRunTrack) updateJumpRunTrack();
        if (Settings.state.userSettings.showLandingPattern) updateLandingPattern();

        if (AppState.currentMarker && AppState.lastLat && AppState.lastLng) {
            AppState.currentMarker.setLatLng([AppState.lastLat, AppState.lastLng]);
            updateMarkerPopup(AppState.currentMarker, AppState.lastLat, AppState.lastLng, AppState.lastAltitude, AppState.currentMarker.getPopup()?.isOpen() || false);
        }
        // Anker-Marker-Größe anpassen
        if (AppState.jumpRunTrackLayer && Settings.state.userSettings.showJumpRunTrack) {
            const anchorMarker = AppState.jumpRunTrackLayer.getLayers().find(layer => layer.options.icon?.options.className === 'jrt-anchor-marker');
            if (anchorMarker) {
                const baseSize = currentZoom <= 11 ? 10 : currentZoom <= 12 ? 12 : currentZoom <= 13 ? 14 : 16;
                anchorMarker.setIcon(L.divIcon({
                    className: 'jrt-anchor-marker',
                    html: `<div style="background-color: orange; width: ${baseSize}px; height: ${baseSize}px; border-radius: 50%; border: 2px solid white; opacity: 0.8;"></div>`,
                    iconSize: [baseSize, baseSize],
                    iconAnchor: [baseSize / 2, baseSize / 2],
                    tooltipAnchor: [0, -(baseSize / 2 + 5)]
                }));
            }
        }
    });

    // Movestart (für manuelles Panning)
    AppState.map.on('movestart', (e) => {
        // Prüft, ob die Bewegung durch Ziehen der Karte ausgelöst wurde und nicht durch Ziehen eines Markers
        if (e.target === AppState.map && (!e.originalEvent || e.originalEvent.target === AppState.map.getContainer())) {
            AppState.isManualPanning = true;
            console.log('Manual map panning detected.');
        }
    });


    // Contextmenu (Rechtsklick für Cut-Away-Marker)
    AppState.map.on('contextmenu', (e) => {
        if (!Settings.state.userSettings.showCutAwayFinder || !Settings.state.userSettings.calculateJump) return;
        const { lat, lng } = e.latlng;
        if (AppState.cutAwayMarker) {
            AppState.cutAwayMarker.setLatLng([lat, lng]);
        } else {
            // createCutAwayMarker und attachCutAwayMarkerDragend müssen global/importiert sein
            AppState.cutAwayMarker = createCutAwayMarker(lat, lng).addTo(AppState.map);
            attachCutAwayMarkerDragend(AppState.cutAwayMarker);
        }
        AppState.cutAwayLat = lat;
        AppState.cutAwayLng = lng;
        updateCutAwayMarkerPopup(AppState.cutAwayMarker, lat, lng); // updateCutAwayMarkerPopup muss global/importiert sein
        if (AppState.weatherData && Settings.state.userSettings.calculateJump) calculateCutAway();
    });

    // Touchstart (Doppel-Tipp) auf dem Kartencontainer
    const mapContainer = AppState.map.getContainer();
    mapContainer.addEventListener('touchstart', async (e) => {
        if (e.touches.length !== 1 || e.target.closest('.leaflet-marker-icon')) return; // Ignoriere Multi-Touch oder Klick auf Marker
        const currentTime = new Date().getTime();
        const timeSinceLastTap = currentTime - lastTapTime; // lastTapTime ist eine module-level Variable
        const tapThreshold = 300; // ms
        if (timeSinceLastTap < tapThreshold && timeSinceLastTap > 0) {
            e.preventDefault(); // Verhindere Standard-Touch-Aktionen wie Zoom
            const rect = mapContainer.getBoundingClientRect();
            const touchX = e.touches[0].clientX - rect.left;
            const touchY = e.touches[0].clientY - rect.top;
            const latlng = AppState.map.containerPointToLatLng([touchX, touchY]);

            await _handleMapDblClick({ latlng: latlng, containerPoint: L.point(touchX, touchY), layerPoint: AppState.map.latLngToLayerPoint(latlng) });
        }
        lastTapTime = currentTime; // Aktualisiere die Zeit des letzten Taps
    }, { passive: false }); // passive: false ist wichtig, um preventDefault zu erlauben

    // Optionale, einfache Click/Mousedown-Handler (falls benötigt)
    AppState.map.on('click', (e) => {
        // console.log('Map click event, target:', e.originalEvent.target);
        // Z.B. um Popups zu schließen oder andere UI-Interaktionen zu steuern.
        // Achte darauf, dass dies nicht mit dem Doppelklick/Doppel-Tipp kollidiert.
    });
    AppState.map.on('mousedown', (e) => {
        // console.log('Map mousedown event, target:', e.originalEvent.target);
    });

    console.log('All core map event handlers have been set up.');
}
function initMap() {
    if (mapInitialized || AppState.map) {
        console.warn('Map already initialized or init in progress.');
        return;
    }
    mapInitialized = true;
    console.log('initMap started...');

    const defaultCenter = [48.0179, 11.1923];
    const defaultZoom = 11;
    const initialAltitude = 'N/A';

    _initializeBasicMapInstance(defaultCenter, defaultZoom);
    _setupBaseLayersAndHandling();      // Definiert AppState.baseMaps, fügt erste Ebene hinzu
    _addStandardMapControls();          // Fügt L.control.layers und andere Controls hinzu, registriert 'baselayerchange'
    _setupCustomPanes();
    _initializeLivePositionControl();
    _initializeDefaultMarker(defaultCenter, initialAltitude); // Setzt AppState.currentMarker

    // Kern-Event-Handler (inkl. dblclick) registrieren, nachdem die Karte und Controls da sind
    _setupCoreMapEventHandlers();

    // Kachel-Caching und Geolocation parallel
    Promise.all([
        _initializeTileCacheLogic(),
        _handleGeolocation(defaultCenter, defaultZoom)
    ]).then(() => {
        if (AppState.lastLat && AppState.lastLng) {
            // cacheTilesForDIP wird bereits in den Geolocation-Callbacks aufgerufen
            // console.log('Ensuring tiles are cached for initial DIP after geolocation/fallback.');
            // cacheTilesForDIP({ map: AppState.map, lastLat: AppState.lastLat, lastLng: AppState.lastLng, baseMaps: AppState.baseMaps });
        }
        console.log('Initial tile caching and geolocation promise resolved.');
    }).catch(error => {
        console.error("Error during parallel initialization of cache/geolocation:", error);
    });

    updateOfflineIndicator();
    console.log('initMap finished.');
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
function createCustomMarker(lat, lng) {
    const customIcon = L.icon({
        iconUrl: 'favicon.ico',
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32],
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        shadowSize: [41, 41],
        shadowAnchor: [13, 32]
    });
    return L.marker([lat, lng], {
        icon: customIcon,
        draggable: true
    });
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
function attachMarkerDragend(marker) {
    marker.on('dragend', async (e) => {
        const position = marker.getLatLng();
        AppState.lastLat = position.lat;
        AppState.lastLng = position.lng;
        AppState.lastAltitude = await Utils.getAltitude(AppState.lastLat, AppState.lastLng);
        Coordinates.addCoordToHistory(position.lat, position.lng);
        const wasOpen = marker.getPopup()?.isOpen() || false;
        updateMarkerPopup(marker, AppState.lastLat, AppState.lastLng, AppState.lastAltitude, wasOpen);
        console.log('Marker dragged to:', { lat: AppState.lastLat, lng: AppState.lastLng });
        resetJumpRunDirection(true);
        if (Settings.state.userSettings.calculateJump) {
            console.log('Recalculating jump for marker drag');
            debouncedCalculateJump(); // Use debounced version
            calculateCutAway();
        }
        recenterMap(true); // Force recenter after fallback
        AppState.isManualPanning = false; // Reset after marker placement
        const slider = document.getElementById('timeSlider');
        const currentIndex = parseInt(slider.value) || 0;
        const currentTime = AppState.weatherData?.time?.[currentIndex] || null;
        document.getElementById('info').innerHTML = `Fetching weather and models...`;
        const availableModels = await checkAvailableModels(AppState.lastLat, AppState.lastLng);
        if (availableModels.length > 0) {
            await fetchWeatherForLocation(AppState.lastLat, AppState.lastLng, currentTime);
            Settings.updateModelRunInfo();
            if (AppState.lastAltitude !== 'N/A') calculateMeanWind();
            updateLandingPattern();
            if (Settings.state.userSettings.showJumpRunTrack) {
                console.log('Updating JRT after weather fetch for marker drag');
                updateJumpRunTrack();
            }
            slider.value = currentIndex;
            cacheTilesForDIP({ map: AppState.map, lastLat: AppState.lastLat, lastLng: AppState.lastLng, baseMaps: AppState.baseMaps });
            // Update Jump Master Line if active
            if (Settings.state.userSettings.showJumpMasterLine && Settings.state.userSettings.trackPosition) {
                console.log('Updating Jump Master Line for marker dragend');
                updateJumpMasterLine();
            }
        } else {
            document.getElementById('info').innerHTML = `No models available.`;
        }
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
            calculateCutAway();
        }
    });
}
async function updateMarkerPopup(marker, lat, lng, altitude, open = false) {
    console.log('Updating marker popup:', { lat, lng, altitude, format: getCoordinateFormat(), open });
    const coordFormat = getCoordinateFormat();
    const coords = Utils.convertCoords(lat, lng, coordFormat);
    const sliderIndex = getSliderValue();

    if (!AppState.weatherData && lat && lng) {
        console.log('No weather data available, fetching for:', { lat, lng });
        await fetchWeatherForLocation(lat, lng, null, false);
    }

    console.log('Weather data status:', {
        weatherDataExists: !!AppState.weatherData,
        surfacePressureExists: !!AppState.weatherData?.surface_pressure,
        sliderIndex,
        surfacePressureLength: AppState.weatherData?.surface_pressure?.length,
        samplePressure: AppState.weatherData?.surface_pressure?.[sliderIndex]
    });

    let popupContent;
    if (coordFormat === 'MGRS') {
        popupContent = `MGRS: ${coords.lat}<br>Alt: ${altitude}m`;
    } else {
        popupContent = `Lat: ${coords.lat}<br>Lng: ${coords.lng}<br>Alt: ${altitude}m`;
    }

    if (AppState.weatherData && AppState.weatherData.surface_pressure && sliderIndex >= 0 && sliderIndex < AppState.weatherData.surface_pressure.length) {
        const surfacePressure = AppState.weatherData.surface_pressure[sliderIndex];
        popupContent += ` QFE: ${surfacePressure.toFixed(0)} hPa`;
    } else {
        popupContent += ` QFE: N/A`;
        console.warn('Surface pressure not available:', {
            hasWeatherData: !!AppState.weatherData,
            hasSurfacePressure: !!AppState.weatherData?.surface_pressure,
            sliderIndexValid: sliderIndex >= 0 && sliderIndex < (AppState.weatherData?.surface_pressure?.length || 0)
        });
    }

    // Unbind and bind new popup content
    marker.unbindPopup();
    marker.bindPopup(popupContent);
    console.log('Popup rebound with content:', popupContent);

    // If the popup is open, update its content immediately
    const popup = marker.getPopup();
    const isOpen = popup?.isOpen();
    if (isOpen) {
        popup.setContent(popupContent);
        popup.update(); // Ensure the popup layout is refreshed
        console.log('Updated open popup content:', popupContent);
    } else if (open) {
        console.log('Attempting to open popup');
        marker.openPopup();
        const isNowOpen = marker.getPopup()?.isOpen();
        console.log('Popup open status after openPopup():', isNowOpen);
        if (!isNowOpen) {
            console.warn('Popup failed to open, retrying');
            marker.openPopup();
        }
    }
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
function recenterMap(force = false) {
    if (AppState.isLoadingGpx) {
        console.log('Skipping recenterMap during GPX loading');
        return;
    }
    if (AppState.isManualPanning && !force) {
        console.log('Skipping recenterMap due to manual panning');
        return;
    }
    if (AppState.map && AppState.currentMarker) {
        AppState.map.invalidateSize();
        AppState.map.panTo(AppState.currentMarker.getLatLng());
        console.log('Map recentered on marker at:', AppState.currentMarker.getLatLng());
    } else {
        console.warn('Cannot recenter map: map or marker not defined');
    }
}
function initializeMap() {
    console.log('Initializing map...');
    initMap();
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
                        console.log(`[checkAvailableModels] Model ${model} (HTTP 200 OK) returned an array for temperature_2m, but it contained no valid numeric data (e.g., all nulls or non-numeric). Considered unavailable. Data sample:`, data.hourly.temperature_2m.slice(0,5));
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
                if (Settings.state.userSettings.calculateJump) { debouncedCalculateJump(); calculateCutAway(); }
            }
            if (Settings.state.userSettings.showLandingPattern) updateLandingPattern();
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
    console.log(`[fetchWeather] Called for lat: ${lat}, lon: ${lon}, currentTime: ${currentTime}`);

    try {
        const modelSelect = document.getElementById('modelSelect');
        const selectedModelValue = modelSelect ? modelSelect.value : Settings.defaultSettings.model;

        const modelMap = {
            'icon_seamless': 'dwd_icon',
            'icon_global': 'dwd_icon',
            'icon_eu': 'dwd_icon_eu',
            'icon_d2': 'dwd_icon_d2',
            'ecmwf_ifs025': 'ecmwf_ifs025',
            'ecmwf_aifs025_single': 'ecmwf_aifs025_single', // Korrigiert von ecmwf_aifs025
            'gfs_seamless': 'ncep_gfs013',
            'gfs_global': 'ncep_gfs025',
            'gfs_hrrr': 'ncep_hrrr_conus',
            'arome_france': 'meteofrance_arome_france0025',
            'gem_hrdps_continental': 'cmc_gem_hrdps',
            'gem_regional': 'cmc_gem_rdps'
        };

        const modelApiIdentifierForMeta = modelMap[selectedModelKey] || selectedModelKey;

        if (!selectedModelValue) { // Zusätzliche Prüfung, falls modelSelect leer war
            console.warn("[fetchWeather] No model selected in dropdown. Aborting fetchWeather.");
            Utils.handleError("No weather model selected to fetch data.");
            if (loadingElement) loadingElement.style.display = 'none';
            return;
        }
        console.log(`[fetchWeather] Using model: ${selectedModelValue}`);


        let isHistorical = false;
        let startDateStr, endDateStr;
        let targetDateForAPI = null;
        const today = luxon.DateTime.utc().startOf('day');

        if (currentTime) {
            let parsedCurrentTime = null;
            if (typeof currentTime === 'string' && currentTime.includes('GMT')) {
                const match = currentTime.match(/^(\d{4}-\d{2}-\d{2})\s(\d{2})(\d{2})\sGMT([+-]\d{1,2})$/);
                if (match) {
                    const [, dateStr, hourStr, minuteStr, offset] = match;
                    const formattedOffset = `${offset.startsWith('+') ? '+' : '-'}${Math.abs(parseInt(offset, 10)).toString().padStart(2, '0')}:00`;
                    const isoString = `${dateStr}T${hourStr}:${minuteStr}:00${formattedOffset}`;
                    parsedCurrentTime = luxon.DateTime.fromISO(isoString, { zone: 'utc' });
                }
            } else {
                parsedCurrentTime = luxon.DateTime.fromISO(currentTime, { zone: 'utc' });
            }
            if (parsedCurrentTime && parsedCurrentTime.isValid) {
                targetDateForAPI = parsedCurrentTime.startOf('day');
                if (targetDateForAPI < today) isHistorical = true;
            }
        }

        if (!isHistorical) {
            const historicalDatePicker = document.getElementById('historicalDatePicker');
            const selectedPickerDate = historicalDatePicker?.value ? luxon.DateTime.fromISO(historicalDatePicker.value, { zone: 'utc' }).startOf('day') : null;
            if (selectedPickerDate && selectedPickerDate < today) {
                isHistorical = true; targetDateForAPI = selectedPickerDate;
            }
        }

        let baseUrl = 'https://api.open-meteo.com/v1/forecast';
        const modelIdentifierForMeta = selectedModelValue.replace(/_seamless|_global|_eu|_d2/, '').split('_')[0];

        if (isHistorical && targetDateForAPI) {
            baseUrl = 'https://historical-forecast-api.open-meteo.com/v1/forecast';
            startDateStr = targetDateForAPI.toFormat('yyyy-MM-dd');
            endDateStr = startDateStr;
            console.log(`[fetchWeather] Historical fetch for date: ${startDateStr}`);
        } else {
            // Nur Meta für Forecast-Modelle abrufen, da historische API keine "run time" hat
            let runDate;
            try {
                const metaResponse = await fetch(`https://api.open-meteo.com/data/${modelIdentifierForMeta}/static/meta.json`);
                if (!metaResponse.ok) {
                    console.warn(`[fetchWeather] Meta fetch failed for ${modelIdentifierForMeta}: ${metaResponse.status}. Using current time for forecast window.`);
                    runDate = new Date(); // Fallback auf aktuelle Zeit
                } else {
                    const metaData = await metaResponse.json();
                    runDate = new Date(metaData.last_run_initialisation_time * 1000);
                }
            } catch (metaError) {
                console.warn(`[fetchWeather] Meta fetch error for ${modelIdentifierForMeta}: ${metaError.message}. Using current time for forecast window.`);
                runDate = new Date(); // Fallback
            }

            let forecastStart = luxon.DateTime.fromJSDate(runDate).setZone('utc').plus({ hours: 6 });
            if (forecastStart > luxon.DateTime.utc()) forecastStart = luxon.DateTime.utc();
            startDateStr = forecastStart.toFormat('yyyy-MM-dd');
            const forecastDays = selectedModelValue.includes('_d2') ? 2 : (selectedModelValue.includes('hrrr') ? 1 : 7); // HRRR oft nur 1-2 Tage
            endDateStr = forecastStart.plus({ days: forecastDays }).toFormat('yyyy-MM-dd');
            console.log(`[fetchWeather] Forecast fetch from ${startDateStr} to ${endDateStr}`);
        }

        const hourlyParams = "surface_pressure,temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_1000hPa,relative_humidity_1000hPa,wind_speed_1000hPa,wind_direction_1000hPa,geopotential_height_1000hPa,temperature_950hPa,relative_humidity_950hPa,wind_speed_950hPa,wind_direction_950hPa,geopotential_height_950hPa,temperature_925hPa,relative_humidity_925hPa,wind_speed_925hPa,wind_direction_925hPa,geopotential_height_925hPa,temperature_900hPa,relative_humidity_900hPa,wind_speed_900hPa,wind_direction_900hPa,geopotential_height_900hPa,temperature_850hPa,relative_humidity_850hPa,wind_speed_850hPa,wind_direction_850hPa,geopotential_height_850hPa,temperature_800hPa,relative_humidity_800hPa,wind_speed_800hPa,wind_direction_800hPa,geopotential_height_800hPa,temperature_700hPa,relative_humidity_700hPa,wind_speed_700hPa,wind_direction_700hPa,geopotential_height_700hPa,temperature_600hPa,relative_humidity_600hPa,wind_speed_600hPa,wind_direction_600hPa,geopotential_height_600hPa,temperature_500hPa,relative_humidity_500hPa,wind_speed_500hPa,wind_direction_500hPa,geopotential_height_500hPa,temperature_400hPa,relative_humidity_400hPa,wind_speed_400hPa,wind_direction_400hPa,geopotential_height_400hPa,temperature_300hPa,relative_humidity_300hPa,wind_speed_300hPa,wind_direction_300hPa,geopotential_height_300hPa,temperature_250hPa,relative_humidity_250hPa,wind_speed_250hPa,wind_direction_250hPa,geopotential_height_250hPa,temperature_200hPa,relative_humidity_200hPa,wind_speed_200hPa,wind_direction_200hPa,geopotential_height_200hPa";
        const url = `${baseUrl}?latitude=${lat}&longitude=${lon}&hourly=${hourlyParams}&models=${selectedModelValue}&start_date=${startDateStr}&end_date=${endDateStr}`;

        console.log('[fetchWeather] Fetching weather from:', url);
        const response = await fetch(url);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! Status: ${response.status} - ${errorText}`);
        }
        const data = await response.json();
        if (!data.hourly || !data.hourly.time || data.hourly.time.length === 0) { // Zusätzliche Prüfung auf leeres Zeit-Array
            console.warn("[fetchWeather] No hourly data or time array returned from API for model:", selectedModelValue, "Data:", data);
            throw new Error('No hourly data returned from API for model: ' + selectedModelValue);
        }

        console.log(`[fetchWeather] Successfully fetched data for model ${selectedModelValue}. Number of time entries: ${data.hourly.time.length}`);

        const lastValidIndex = data.hourly.time.length - 1;
        AppState.weatherData = {};
        for (const key in data.hourly) {
            if (Object.hasOwnProperty.call(data.hourly, key)) {
                AppState.weatherData[key] = data.hourly[key].slice(0, lastValidIndex + 1);
            }
        }

        const slider = document.getElementById('timeSlider');
        slider.min = 0; slider.max = AppState.weatherData.time.length - 1;
        slider.disabled = AppState.weatherData.time.length <= 1;
        if (slider.disabled) {
            slider.style.opacity = '0.5'; slider.style.cursor = 'not-allowed';
            const infoEl = document.getElementById('info');
            if (infoEl) infoEl.innerHTML += '<br><strong>Note:</strong> Only one forecast time available.';
        } else {
            slider.style.opacity = '1'; slider.style.cursor = 'pointer';
        }


        let initialIndex = 0;
        if (currentTime && AppState.weatherData.time.length > 0) {
            let targetLuxonDate = null;
            if (typeof currentTime === 'string' && currentTime.includes('GMT')) {
                const match = currentTime.match(/^(\d{4}-\d{2}-\d{2})\s(\d{2})(\d{2})\sGMT([+-]\d{1,2})$/);
                if (match) {
                    const [, dateStr, hourStr, minuteStr, offset] = match;
                    const formattedOffset = `${offset.startsWith('+') ? '+' : '-'}${Math.abs(parseInt(offset, 10)).toString().padStart(2, '0')}:00`;
                    const isoString = `${dateStr}T${hourStr}:${minuteStr}:00${formattedOffset}`;
                    targetLuxonDate = luxon.DateTime.fromISO(isoString, { zone: 'utc' });
                }
            } else { targetLuxonDate = luxon.DateTime.fromISO(currentTime, { zone: 'utc' }); }

            if (targetLuxonDate && targetLuxonDate.isValid) {
                const targetTimestamp = targetLuxonDate.toMillis();
                let minDiff = Infinity;
                AppState.weatherData.time.forEach((time, idx) => {
                    const timeTimestamp = luxon.DateTime.fromISO(time, { zone: 'utc' }).toMillis();
                    const diff = Math.abs(timeTimestamp - targetTimestamp);
                    if (diff < minDiff) { minDiff = diff; initialIndex = idx; }
                });
            }
        } else if (isHistorical && targetDateForAPI && AppState.weatherData.time.length > 0) {
            let minDiff = Infinity;
            AppState.weatherData.time.forEach((time, idx) => {
                const timeLuxon = luxon.DateTime.fromISO(time, { zone: 'utc' });
                if (timeLuxon.hasSame(targetDateForAPI, 'day')) {
                    const diffToNoon = Math.abs(timeLuxon.hour - 12);
                    if (diffToNoon < minDiff) { minDiff = diffToNoon; initialIndex = idx; }
                }
            });
            if (minDiff === Infinity && AppState.weatherData.time.length > 0) initialIndex = 0;
        } else if (AppState.weatherData.time.length > 0) {
            const now = luxon.DateTime.utc(); let minDiff = Infinity;
            AppState.weatherData.time.forEach((time, idx) => {
                const timeTimestamp = luxon.DateTime.fromISO(time, { zone: 'utc' }).toMillis();
                const diff = Math.abs(timeTimestamp - now.toMillis());
                if (diff < minDiff) { minDiff = diff; initialIndex = idx; }
            });
        }
        slider.value = initialIndex;
        await updateWeatherDisplay(initialIndex);

        // Model Run Time nur für Forecast aktualisieren
        if (!isHistorical) {
            // Die `runDate` für Meta wurde schon oben geholt. Wir verwenden sie hier.
            const metaResponse = await fetch(`https://api.open-meteo.com/data/${modelIdentifierForMeta}/static/meta.json`);
            if (metaResponse.ok) {
                const metaData = await metaResponse.json();
                if (metaData && metaData.last_run_initialisation_time) {
                    const runDateFromMeta = new Date(metaData.last_run_initialisation_time * 1000);
                    const year = runDateFromMeta.getUTCFullYear();
                    const month = String(runDateFromMeta.getUTCMonth() + 1).padStart(2, '0');
                    const day = String(runDateFromMeta.getUTCDate()).padStart(2, '0');
                    const hour = String(runDateFromMeta.getUTCHours()).padStart(2, '0');
                    const minute = String(runDateFromMeta.getUTCMinutes()).padStart(2, '0');
                    AppState.lastModelRun = `${year}-${month}-${day} ${hour}${minute}Z`;
                } else { AppState.lastModelRun = "N/A"; }
            } else { AppState.lastModelRun = "N/A (Meta fetch failed)"; }
        } else { AppState.lastModelRun = "N/A (Historical Data)"; }
        console.log("[fetchWeather] lastModelRun set to:", AppState.lastModelRun);

    } catch (error) /* istanbul ignore next */ {
        console.error("[fetchWeather] Error:", error);
        Utils.handleError(`Failed to fetch weather: ${error.message}`);
        AppState.weatherData = null; AppState.lastModelRun = null;
        const infoElement = document.getElementById('info'); if (infoElement) infoElement.innerHTML = 'Failed to load weather data.';
        const slider = document.getElementById('timeSlider'); if (slider) { slider.disabled = true; slider.value = 0; slider.max = 0; }
        const selectedTimeElement = document.getElementById('selectedTime'); if (selectedTimeElement) selectedTimeElement.innerHTML = 'Selected Time: N/A';
    } finally {
        if (loadingElement) loadingElement.style.display = 'none';
    }
}

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

// Hilfsfunktion zum Leeren der Ensemble-Visualisierungen
function clearEnsembleVisualizations() {
    if (AppState.ensembleLayerGroup) {
        AppState.ensembleLayerGroup.clearLayers();
    } else {
        // Sicherstellen, dass die LayerGroup existiert und zur Karte hinzugefügt wurde
        if (AppState.map) {
            AppState.ensembleLayerGroup = L.layerGroup().addTo(AppState.map);
        } else {
            console.warn("Karte nicht initialisiert, ensembleLayerGroup kann nicht erstellt werden.");
            return;
        }
    }
    AppState.ensembleScenarioCircles = {}; // Zurücksetzen der gespeicherten Kreise
    console.log("Ensemble visualizations cleared.");
}

function processAndVisualizeEnsemble() {
    clearEnsembleVisualizations();

    if (!AppState.ensembleModelsData || Object.keys(AppState.ensembleModelsData).length === 0) {
        console.log("No ensemble data to process.");
        if (Settings.state.userSettings.selectedEnsembleModels.length > 0 && Settings.state.userSettings.currentEnsembleScenario !== 'all_models') {
            Utils.handleMessage("Data for selected ensemble models not yet available. Fetching...");
            fetchEnsembleWeatherData(); // Versuch, Daten erneut zu laden
        }
        return;
    }

    const scenario = Settings.state.userSettings.currentEnsembleScenario;
    const sliderIndex = getSliderValue();

    console.log(`Processing ensemble scenario: ${scenario} for slider index: ${sliderIndex}`);

    if (scenario === 'all_models') {
        for (const modelName in AppState.ensembleModelsData) {
            if (Object.hasOwnProperty.call(AppState.ensembleModelsData, modelName)) {
                const modelHourlyData = AppState.ensembleModelsData[modelName];
                // Erstelle eine temporäre weatherData-Struktur für diese spezifische Modellanfrage
                const tempWeatherData = { hourly: modelHourlyData };
                const canopyResult = calculateCanopyCirclesForEnsemble(modelName, tempWeatherData);
                if (canopyResult) {
                    const color = getDistinctColorForModel(modelName);
                    drawEnsembleCircle(canopyResult, color, modelName);
                }
            }
        }
    } else { // Min, Mean, Max scenarios
        const scenarioProfile = calculateEnsembleScenarioProfile(scenario, sliderIndex);
        if (scenarioProfile) {
            const canopyResult = calculateCanopyCirclesForEnsemble(scenario, scenarioProfile);
            if (canopyResult) {
                const color = getDistinctColorForScenario(scenario);
                drawEnsembleCircle(canopyResult, color, scenario.replace('_', ' '));
            }
        } else {
            console.warn(`Could not calculate profile for scenario: ${scenario}`);
            Utils.handleMessage(`Could not generate '${scenario.replace('_', ' ')}' profile. Not enough data?`);
        }
    }
}

// Hilfsfunktion für unterscheidbare Farben (Beispiel)
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

// Neue Funktion zum Zeichnen eines einzelnen Ensemble-Kreises
function drawEnsembleCircle(canopyResult, color, label) {
    if (!AppState.map || !canopyResult || !AppState.ensembleLayerGroup) return;

    // canopyResult sollte { centerLat, centerLng, radius, displacement, direction, profileIdentifier } enthalten
    const newCenter = Utils.calculateNewCenter(canopyResult.centerLat, canopyResult.centerLng, canopyResult.displacement, canopyResult.direction);

    const circle = L.circle(newCenter, {
        radius: canopyResult.radius,
        color: color,
        fillColor: color,
        fillOpacity: 0.15, // Etwas sichtbarer als 0.1
        weight: 2,       // Etwas dicker
        dashArray: '5, 10' // Strichelung: 5px Strich, 10px Lücke
    }).addTo(AppState.ensembleLayerGroup);

    const tooltipText = `${label}: ${Math.round(canopyResult.radius)}m drift @ ${Math.round(canopyResult.direction)}°`;
    circle.bindTooltip(tooltipText, { permanent: false, direction: 'top', className: 'ensemble-tooltip' }); // Eigene Klasse für Styling
    AppState.ensembleScenarioCircles[label] = circle; // Speichern unter dem Label (Szenario oder Modellname)
    console.log(`Drew ensemble circle for ${label} at [${newCenter.join(', ')}], radius ${canopyResult.radius}`);
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
        result = calculateCanopyCircles();
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
            profileIdentifier: profileIdentifier // Behalte die ID für Tooltips etc.
        };
    }
    console.warn(`calculateCanopyCircles lieferte null für Profil ${profileIdentifier}`);
    return null;
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
    updateLandingPattern();
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
            calculateCutAway();
            if (Settings.state.userSettings.showJumpRunTrack) {
                updateJumpRunTrack();
            }
        }
        console.log('Updated all displays for current hour');
    } catch (error) {
        console.error('Error updating to current hour:', error);
        Utils.handleError('Failed to update weather data: ' + error.message);
    }
}

// == Jump and Free Fall Calculations ==
export function getSeparationFromTAS(ias) {
    // Convert exitAltitude from meters to feet (1m = 3.28084ft)
    const exitAltitudeFt = Settings.state.userSettings.exitAltitude * 3.28084;

    // Calculate TAS using Utils.calculateTAS
    const tas = Utils.calculateTAS(ias, exitAltitudeFt);
    if (tas === 'N/A') {
        console.warn('TAS calculation failed, using default separation');
        return defaultSettings.jumperSeparation; // Fallback to default (5s)
    }

    // Round TAS to nearest table key
    const speeds = Object.keys(Constants.jumperSeparationTable).map(Number).sort((a, b) => b - a);
    let closestSpeed = speeds[0]; // Default to highest speed
    for (const speed of speeds) {
        if (tas <= speed) closestSpeed = speed;
        else break;
    }

    // Return separation from table, default to 7 seconds if not found
    const separation = Constants.jumperSeparationTable[closestSpeed] || 7;
    console.log(`Calculated TAS: ${tas}kt, Closest speed: ${closestSpeed}kt, Separation: ${separation}s`);
    return separation;
}
export function calculateFreeFall(weatherData, exitAltitude, openingAltitude, sliderIndex, startLat, startLng, elevation) {
    console.log('Starting calculateFreeFall...', { exitAltitude, openingAltitude, sliderIndex });

    if (!AppState.weatherData || !AppState.weatherData.time || !AppState.weatherData.surface_pressure) {
        console.warn('Invalid weather data provided');
        return null;
    }
    if (!Number.isFinite(startLat) || !Number.isFinite(startLng) || !Number.isFinite(elevation)) {
        console.warn('Invalid coordinates or elevation');
        return null;
    }

    // RW values
    const mass = 80; // jumpers mass
    const g = 9.81; //Erdbeschleunigung
    const Rl = 287.102; //gas constant dry air
    const cdHorizontal = 1; // Widerstandswert horizontal
    const areaHorizontal = 0.5; // Auftriebsfläche horizontal
    const cdVertical = 1; // Widerstandswert vertikal
    const areaVertical = 0.5; //Auftriebsfläche vertikal
    const dt = 0.5;

    const hStart = elevation + exitAltitude;
    const hStop = elevation + openingAltitude - 200; //calculate until canopy is open
    const jumpRunData = jumpRunTrack();
    const jumpRunDirection = jumpRunData ? jumpRunData.direction : 0;
    const aircraftSpeedKt = Settings.state.userSettings.aircraftSpeedKt; // Use user-defined IAS speed
    const exitAltitudeFt = exitAltitude / 0.3048; // Convert to feet (adjust if elevation matters)

    const aircraftSpeedTAS = Utils.calculateTAS(aircraftSpeedKt, exitAltitudeFt);
    let aircraftSpeedMps;
    if (aircraftSpeedTAS === 'N/A') {
        console.warn('TAS calculation failed, using IAS', aircraftSpeedKt);
        aircraftSpeedMps = aircraftSpeedKt * 0.514444;
    } else {
        aircraftSpeedMps = aircraftSpeedTAS * 0.514444;
    }

    const vxInitial = Math.cos((jumpRunDirection) * Math.PI / 180) * aircraftSpeedMps;
    const vyInitial = Math.sin((jumpRunDirection) * Math.PI / 180) * aircraftSpeedMps;

    console.log('Free fall initial values: IAS', aircraftSpeedKt, 'kt, TAS', aircraftSpeedTAS, 'kt, direction', jumpRunDirection, '°');
    console.log('Free fall initial velocity: ', { vxInitial, vyInitial });

    const interpolatedData = interpolateWeatherData(sliderIndex);
    if (!interpolatedData || interpolatedData.length === 0) {
        console.warn('No interpolated weather data available');
        return null;
    }
    const heights = interpolatedData.map(d => d.height);
    const windDirs = interpolatedData.map(d => Number.isFinite(d.dir) ? parseFloat(d.dir) : 0);
    const windSpdsMps = interpolatedData.map(d => Utils.convertWind(parseFloat(d.spd) || 0, 'm/s', 'km/h'));
    const tempsC = interpolatedData.map(d => d.temp);

    const trajectory = [{
        time: 0,
        height: hStart,
        vz: 0,
        vxGround: vxInitial,
        vyGround: vyInitial,
        x: 0,
        y: 0
    }];

    const surfacePressure = AppState.weatherData.surface_pressure[sliderIndex] || 1013.25;
    const surfaceTempC = AppState.weatherData.temperature_2m[sliderIndex] || 15;
    const surfaceTempK = surfaceTempC + 273.15;
    let rho = (surfacePressure * 100) / (Rl * surfaceTempK);

    let current = trajectory[0];
    while (current.height > hStop) {
        const windDir = Utils.LIP(heights, windDirs, current.height);
        const windSpd = Utils.LIP(heights, windSpdsMps, current.height);
        const tempC = Utils.LIP(heights, tempsC, current.height);
        const tempK = tempC + 273.15;
        rho = (surfacePressure * 100 * Math.exp(-g * (current.height - elevation) / (Rl * tempK))) / (Rl * tempK);

        // Wind direction is "from," displacement is "to" (add 180°)
        const windDirTo = (windDir + 180) % 360;
        const vxWind = windSpd * Math.cos(windDirTo * Math.PI / 180); // Displacement direction
        const vyWind = windSpd * Math.sin(windDirTo * Math.PI / 180);

        const vxAir = current.vxGround - vxWind;
        const vyAir = current.vyGround - vyWind;
        const vAirMag = Math.sqrt(vxAir * vxAir + vyAir * vyAir);

        const bv = 0.5 * cdVertical * areaVertical * rho / mass;
        const bh = 0.5 * cdHorizontal * areaHorizontal * rho / mass;

        const az = -g - bv * current.vz * Math.abs(current.vz);
        const ax = -bh * vAirMag * vxAir;
        const ay = -bh * vAirMag * vyAir;

        let nextHeight = current.height + current.vz * dt;
        let nextVz = current.vz + az * dt;
        let nextTime = current.time + dt;

        if (nextHeight <= hStop) {
            const fraction = (current.height - hStop) / (current.height - nextHeight);
            nextTime = current.time + dt * fraction;
            nextHeight = hStop;
            nextVz = current.vz + az * dt * fraction;
        }

        const next = {
            time: nextTime,
            height: nextHeight,
            vz: nextVz,
            vxGround: vxInitial === 0 ? vxWind : current.vxGround + ax * dt,
            vyGround: vyInitial === 0 ? vyWind : current.vyGround + ay * dt,
            x: current.x + (vxInitial === 0 ? vxWind : current.vxGround) * dt,
            y: current.y + (vyInitial === 0 ? vyWind : current.vyGround) * dt
        };

        trajectory.push(next);
        current = next;

        if (next.height === hStop) break;
    }

    const final = trajectory[trajectory.length - 1];
    const distance = Math.sqrt(final.x * final.x + final.y * final.y);
    const directionRad = Math.atan2(final.y, final.x);
    let directionDeg = directionRad * 180 / Math.PI;
    directionDeg = (directionDeg + 360) % 360;

    console.log(`Free fall from exit to opening: ${Math.round(directionDeg)}° ${Math.round(distance)} m, vz: ${final.vz.toFixed(2)} m/s`);
    console.log('Elevation used:', elevation);

    const result = {
        time: final.time,
        height: final.height,
        vz: final.vz,
        xDisplacement: final.x,
        yDisplacement: final.y,
        path: trajectory.map(point => ({
            latLng: Utils.calculateNewCenter(startLat, startLng, Math.sqrt(point.x * point.x + point.y * point.y), Math.atan2(point.y, point.x) * 180 / Math.PI),
            point_x: point.x,
            point_y: point.y,
            height: point.height,
            time: point.time,
            vz: point.vz
        })),
        directionDeg: directionDeg, // Include direction
        distance: distance // Include distance
    };
    console.log('Aircraft Speed IAS: ', aircraftSpeedKt);
    console.log('Free fall result:', result);
    console.log(`Free fall considerations output: Throw and drift: ${Math.round(directionDeg)}° ${Math.round(distance)} m ${Math.round(final.time)} s ${hStart} m ${hStop} m`);
    return result;
}
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
export function calculateExitCircle() {
    if (!Settings.state.userSettings.showExitArea || !Settings.state.userSettings.calculateJump || !AppState.weatherData || !AppState.lastLat || !AppState.lastLng) {
        console.log('Skipping calculateExitCircle: conditions not met');
        return null;
    }
    console.log('Calculating exit circle...', {
        lastLat: AppState.lastLat,
        lastLng: AppState.lastLng,
        lastAltitude: AppState.lastAltitude,
        sliderIndex: parseInt(document.getElementById('timeSlider')?.value) || 0
    });

    const sliderIndex = parseInt(document.getElementById('timeSlider')?.value) || 0;
    const exitAltitude = parseInt(document.getElementById('exitAltitude')?.value) || 3000;
    const openingAltitude = parseInt(document.getElementById('openingAltitude')?.value) || 1200;
    const legHeightDownwind = parseInt(document.getElementById('legHeightDownwind')?.value) || 300;
    const descentRate = parseFloat(document.getElementById('descentRate')?.value) || 3.5;
    const canopySpeed = parseFloat(document.getElementById('canopySpeed')?.value) || 20;

    const interpolatedData = interpolateWeatherData(sliderIndex);
    if (!interpolatedData || interpolatedData.length === 0) {
        console.warn('No interpolated weather data for exit circle');
        return null;
    }

    const heights = interpolatedData.map(d => d.height);
    const dirs = interpolatedData.map(d => Number.isFinite(d.dir) ? parseFloat(d.dir) : 0);
    const spdsMps = interpolatedData.map(d => Utils.convertWind(parseFloat(d.spd) || 0, 'm/s', 'km/h'));
    const uComponents = spdsMps.map((spd, i) => -spd * Math.sin(dirs[i] * Math.PI / 180));
    const vComponents = spdsMps.map((spd, i) => -spd * Math.cos(dirs[i] * Math.PI / 180));

    const canopySpeedMps = canopySpeed * 0.514444;
    const heightDistance = openingAltitude - 200 - legHeightDownwind;
    const flyTime = heightDistance / descentRate;
    const horizontalCanopyDistance = flyTime * canopySpeedMps;
    const heightDistanceFull = openingAltitude - 200;
    const flyTimeFull = heightDistanceFull / descentRate;
    const horizontalCanopyDistanceFull = flyTimeFull * canopySpeedMps;

    const elevation = Math.round(AppState.lastAltitude);
    const upperLimit = elevation + openingAltitude - 200;
    const lowerLimit = elevation + legHeightDownwind;
    const meanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, lowerLimit, upperLimit);
    const meanWindDirection = meanWind[0];
    const meanWindSpeedMps = meanWind[1];
    const meanWindFull = Utils.calculateMeanWind(heights, uComponents, vComponents, elevation, elevation + openingAltitude - 200);
    const meanWindDirectionFull = meanWindFull[0];
    const meanWindSpeedMpsFull = meanWindFull[1];

    const centerDisplacement = meanWindSpeedMps * flyTime;
    const centerDisplacementFull = meanWindSpeedMpsFull * flyTimeFull;
    const displacementDirection = meanWindDirection;
    const displacementDirectionFull = meanWindDirectionFull;

    const landingPatternCoords = calculateLandingPatternCoords(AppState.lastLat, AppState.lastLng, interpolatedData, sliderIndex);
    let blueLat = landingPatternCoords.downwindLat;
    let blueLng = landingPatternCoords.downwindLng;
    if (!Number.isFinite(blueLat) || !Number.isFinite(blueLng)) {
        console.warn('Downwind coordinates invalid, using lastLat, lastLng as fallback');
        blueLat = AppState.lastLat;
        blueLng = AppState.lastLng;
    }
    const redLat = AppState.lastLat;
    const redLng = AppState.lastLng;

    const newCenterBlue = Utils.calculateNewCenter(blueLat, blueLng, centerDisplacement, displacementDirection);
    const newCenterRed = Utils.calculateNewCenter(redLat, redLng, centerDisplacementFull, displacementDirectionFull);

    const freeFallResult = calculateFreeFall(AppState.weatherData, exitAltitude, openingAltitude, sliderIndex, AppState.lastLat, AppState.lastLng, AppState.lastAltitude);
    if (!freeFallResult) {
        console.warn('Free fall calculation failed for exit circle');
        return null;
    }

    const greenShiftDirection = (freeFallResult.directionDeg + 180) % 360;
    const greenCenter = Utils.calculateNewCenter(newCenterRed[0], newCenterRed[1], freeFallResult.distance, greenShiftDirection);
    const darkGreenCenter = Utils.calculateNewCenter(newCenterBlue[0], newCenterBlue[1], freeFallResult.distance, greenShiftDirection);

    console.log('Exit circle calculated:', {
        greenCenter,
        darkGreenCenter,
        greenRadius: horizontalCanopyDistanceFull,
        darkGreenRadius: horizontalCanopyDistance,
        freeFallDirection: freeFallResult.directionDeg,
        freeFallDistance: freeFallResult.distance
    });

    return {
        greenLat: greenCenter[0],
        greenLng: greenCenter[1],
        darkGreenLat: darkGreenCenter[0],
        darkGreenLng: darkGreenCenter[1],
        greenRadius: horizontalCanopyDistanceFull,
        darkGreenRadius: horizontalCanopyDistance,
        freeFallDirection: freeFallResult.directionDeg,
        freeFallDistance: freeFallResult.distance,
        freeFallTime: freeFallResult.time
    };
}
export function calculateCanopyCircles() {
    if (!Settings.state.userSettings.showCanopyArea || !Settings.state.userSettings.calculateJump || !AppState.weatherData || !AppState.lastLat || !AppState.lastLng) {
        console.log('Skipping calculateCanopyCircles: conditions not met');
        return null;
    }
    console.log('Calculating canopy circles...', {
        lastLat: AppState.lastLat,
        lastLng: AppState.lastLng,
        lastAltitude: AppState.lastAltitude,
        sliderIndex: parseInt(document.getElementById('timeSlider')?.value) || 0
    });

    const sliderIndex = parseInt(document.getElementById('timeSlider')?.value) || 0;
    const exitAltitude = parseInt(document.getElementById('exitAltitude')?.value) || 3000;
    const openingAltitude = parseInt(document.getElementById('openingAltitude')?.value) || 1200;
    const legHeightDownwind = parseInt(document.getElementById('legHeightDownwind')?.value) || 300;
    const descentRate = parseFloat(document.getElementById('descentRate')?.value) || 3.5;
    const canopySpeed = parseFloat(document.getElementById('canopySpeed')?.value) || 20;

    const interpolatedData = interpolateWeatherData(sliderIndex);
    if (!interpolatedData || interpolatedData.length === 0) {
        console.warn('No interpolated weather data for canopy circles');
        return null;
    }

    const heights = interpolatedData.map(d => d.height);
    const dirs = interpolatedData.map(d => Number.isFinite(d.dir) ? parseFloat(d.dir) : 0);
    const spdsMps = interpolatedData.map(d => Utils.convertWind(parseFloat(d.spd) || 0, 'm/s', 'km/h'));
    const uComponents = spdsMps.map((spd, i) => -spd * Math.sin(dirs[i] * Math.PI / 180));
    const vComponents = spdsMps.map((spd, i) => -spd * Math.cos(dirs[i] * Math.PI / 180));

    const canopySpeedMps = canopySpeed * 0.514444;
    const heightDistance = openingAltitude - 200 - legHeightDownwind;
    const flyTime = heightDistance / descentRate;
    const horizontalCanopyDistance = flyTime * canopySpeedMps;
    const heightDistanceFull = openingAltitude - 200;
    const flyTimeFull = heightDistanceFull / descentRate;
    const horizontalCanopyDistanceFull = flyTimeFull * canopySpeedMps;

    const elevation = Math.round(AppState.lastAltitude);
    const upperLimit = elevation + openingAltitude - 200;
    const lowerLimit = elevation + legHeightDownwind;
    const additionalBlueRadii = [];
    const additionalBlueDisplacements = [];
    const additionalBlueDirections = [];
    const additionalBlueUpperLimits = [];
    let decrement;
    if ((upperLimit - lowerLimit) <= 1000) {
        decrement = 200;
    } else if ((upperLimit - lowerLimit) > 1000 && (upperLimit - lowerLimit) <= 3000) {
        decrement = 500;
    } else {
        decrement = 1000;
    }
    let currentUpper = upperLimit;
    while (currentUpper >= lowerLimit + 200) {
        const currentHeightDistance = currentUpper - lowerLimit;
        const currentFlyTime = currentHeightDistance / descentRate;
        const currentRadius = currentFlyTime * canopySpeedMps;
        if (currentRadius > 0) {
            const meanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, lowerLimit, currentUpper);
            const currentMeanWindDirection = meanWind[0];
            const currentMeanWindSpeedMps = meanWind[1];
            const currentDisplacement = currentMeanWindSpeedMps * currentFlyTime;

            additionalBlueRadii.push(currentRadius);
            additionalBlueDisplacements.push(currentDisplacement);
            additionalBlueDirections.push(currentMeanWindDirection);
            additionalBlueUpperLimits.push(currentUpper - elevation);
            console.log(`Additional blue circle for ${currentUpper}m:`, {
                radius: currentRadius,
                displacement: currentDisplacement,
                direction: currentMeanWindDirection,
                heightAGL: currentUpper - elevation
            });
        }
        currentUpper -= decrement;
    }

    const freeFallResult = calculateFreeFall(AppState.weatherData, exitAltitude, openingAltitude, sliderIndex, AppState.lastLat, AppState.lastLng, AppState.lastAltitude);
    if (!freeFallResult) {
        console.warn('Free fall calculation failed for canopy circles');
        return null;
    }

    const meanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, lowerLimit, upperLimit);
    const meanWindDirection = meanWind[0];
    const meanWindSpeedMps = meanWind[1];
    const meanWindFull = Utils.calculateMeanWind(heights, uComponents, vComponents, elevation, elevation + openingAltitude - 200);
    const meanWindDirectionFull = meanWindFull[0];
    const meanWindSpeedMpsFull = meanWindFull[1];

    const centerDisplacement = meanWindSpeedMps * flyTime;
    const centerDisplacementFull = meanWindSpeedMpsFull * flyTimeFull;
    const displacementDirection = meanWindDirection;
    const displacementDirectionFull = meanWindDirectionFull;

    const landingPatternCoords = calculateLandingPatternCoords(AppState.lastLat, AppState.lastLng, interpolatedData, sliderIndex);
    let blueLat = landingPatternCoords.downwindLat;
    let blueLng = landingPatternCoords.downwindLng;
    if (!Number.isFinite(blueLat) || !Number.isFinite(blueLng)) {
        console.warn('Downwind coordinates invalid, using lastLat, lastLng as fallback');
        blueLat = AppState.lastLat;
        blueLng = AppState.lastLng;
    }
    const redLat = AppState.lastLat;
    const redLng = AppState.lastLng;

    console.log('Canopy circles calculated:', {
        blueLat,
        blueLng,
        redLat,
        redLng,
        horizontalCanopyDistance,
        horizontalCanopyDistanceFull,
        centerDisplacement,
        centerDisplacementFull,
        displacementDirection,
        displacementDirectionFull
    });

    return {
        blueLat,
        blueLng,
        redLat,
        redLng,
        radius: horizontalCanopyDistance,
        radiusFull: horizontalCanopyDistanceFull,
        additionalBlueRadii,
        additionalBlueDisplacements,
        additionalBlueDirections,
        additionalBlueUpperLimits,
        displacement: centerDisplacement,
        displacementFull: centerDisplacementFull,
        direction: meanWindDirection,
        directionFull: meanWindDirectionFull,
        freeFallDirection: freeFallResult.directionDeg,
        freeFallDistance: freeFallResult.distance,
        freeFallTime: freeFallResult.time
    };
}
export function calculateJumpRunTrack() {
    if (!Settings.state.userSettings.showJumpRunTrack || !Settings.state.userSettings.calculateJump || !AppState.weatherData || !AppState.lastLat || !AppState.lastLng) {
        console.log('Skipping calculateJumpRunTrack: conditions not met');
        return null;
    }
    console.log('Calculating jump run track...');
    updateJumpRunTrack();
    const trackData = jumpRunTrack();
    return trackData;
}
export function calculateJump() {
    console.log('Starting calculateJump...', {
        showExitArea: Settings.state.userSettings.showExitArea,
        showCanopyArea: Settings.state.userSettings.showCanopyArea,
        showJumpRunTrack: Settings.state.userSettings.showJumpRunTrack
    });

    if (!AppState.weatherData || !AppState.lastLat || !AppState.lastLng) {
        console.warn('Missing required data for calculateJump');
        clearJumpCircles();
        return null;
    }

    clearJumpCircles();

    let result = {};
    if (Settings.state.userSettings.showExitArea) {
        const exitResult = calculateExitCircle();
        if (exitResult) {
            updateJumpCircle(
                exitResult.darkGreenLat, exitResult.darkGreenLng,
                exitResult.greenLat, exitResult.greenLng,
                exitResult.darkGreenRadius, exitResult.greenRadius,
                [], [], [], [],
                0, 0, 0, 0,
                exitResult.freeFallDirection, exitResult.freeFallDistance, exitResult.freeFallTime,
                true, false
            );
            result = { ...result, ...exitResult, exitCircle: true };
        }
    }
    if (Settings.state.userSettings.showCanopyArea) {
        const canopyResult = calculateCanopyCircles();
        if (canopyResult) {
            updateJumpCircle(
                canopyResult.blueLat, canopyResult.blueLng,
                canopyResult.redLat, canopyResult.redLng,
                canopyResult.radius, canopyResult.radiusFull,
                canopyResult.additionalBlueRadii, canopyResult.additionalBlueDisplacements,
                canopyResult.additionalBlueDirections, canopyResult.additionalBlueUpperLimits,
                canopyResult.displacement, canopyResult.displacementFull,
                canopyResult.direction, canopyResult.directionFull,
                canopyResult.freeFallDirection, canopyResult.freeFallDistance, canopyResult.freeFallTime,
                false, true
            );
            result = { ...result, ...canopyResult, canopyCircles: true };
        }
    }
    if (Settings.state.userSettings.showJumpRunTrack) {
        const trackResult = calculateJumpRunTrack();
        if (trackResult) {
            result = { ...result, track: true };
        }
    }

    if (AppState.currentMarker && AppState.lastLat && AppState.lastLng) {
        AppState.currentMarker.setLatLng([AppState.lastLat, AppState.lastLng]);
        updateMarkerPopup(AppState.currentMarker, AppState.lastLat, AppState.lastLng, AppState.lastAltitude, AppState.currentMarker.getPopup()?.isOpen() || false);
    }

    console.log('calculateJump completed', result);
    return result;
}
export function updateJumpCircle(blueLat, blueLng, redLat, redLng, radius, radiusFull, additionalBlueRadii = [], additionalBlueDisplacements = [], additionalBlueDirections = [], additionalBlueUpperLimits = [], displacement = 0, displacementFull = 0, direction = 0, directionFull = 0, freeFallDirection = 0, freeFallDistance = 0, freeFallTime = 0, showExitAreaOnly = false, showCanopyAreaOnly = false) {
    console.log('updateJumpCircle called with:', {
        blueLat, blueLng, redLat, redLng, radius, radiusFull,
        additionalBlueRadii, additionalBlueDisplacements, additionalBlueDirections, additionalBlueUpperLimits,
        displacement, displacementFull, direction, directionFull, freeFallDirection, freeFallDistance, freeFallTime,
        showExitArea: Settings.state.userSettings.showExitArea,
        showCanopyArea: Settings.state.userSettings.showCanopyArea,
        showExitAreaOnly, showCanopyAreaOnly
    });

    if (!AppState.map) {
        console.warn('Map not available to update jump circles');
        return false;
    }

    const currentZoom = AppState.map.getZoom();
    const isVisible = currentZoom >= Constants.minZoom && currentZoom <= Constants.maxZoom;
    console.log('Zoom check:', { currentZoom, minZoom: Constants.minZoom, maxZoom: Constants.maxZoom, isVisible });

    const blueCircleMetadata = [];

    const removeLayer = (layer, name) => {
        if (layer && typeof layer === 'object' && '_leaflet_id' in layer && AppState.map.hasLayer(layer)) {
            console.log(`Removing existing ${name}`);
            AppState.map.removeLayer(layer);
        }
    };

    console.log('Before cleanup:', {
        blueCircle: !!AppState.jumpCircle,
        redCircle: !!AppState.jumpCircleFull,
        greenCircle: !!AppState.jumpCircleGreen,
        darkGreenCircle: !!AppState.jumpCircleGreenLight,
        additionalBlueCircles: AppState.additionalBlueCircles?.length || 0,
        additionalBlueLabels: AppState.additionalBlueLabels?.length || 0
    });

    // Cleanup based on mode
    if (showExitAreaOnly) {
        // Only clear exit circles
        removeLayer(AppState.jumpCircleGreen, 'green circle');
        removeLayer(AppState.jumpCircleGreenLight, 'dark green circle');
    } else if (showCanopyAreaOnly) {
        // Only clear canopy circles
        removeLayer(AppState.jumpCircle, 'blue circle');
        removeLayer(AppState.jumpCircleFull, 'red circle');
        if (AppState.additionalBlueCircles) {
            AppState.additionalBlueCircles.forEach(circle => removeLayer(circle, 'additional blue circle'));
            AppState.additionalBlueCircles = [];
        }
        if (AppState.additionalBlueLabels) {
            AppState.additionalBlueLabels.forEach(label => removeLayer(label, 'additional blue label'));
            AppState.additionalBlueLabels = [];
        }
    } else {
        // Clear all circles if neither mode is specified
        clearJumpCircles();
    }

    AppState.additionalBlueCircles = AppState.additionalBlueCircles || [];
    AppState.additionalBlueLabels = AppState.additionalBlueLabels || [];

    function calculateLabelAnchor(center, radius) {
        const centerLatLng = L.latLng(center[0], center[1]);
        const earthRadius = 6378137;
        const deltaLat = (radius / earthRadius) * (180 / Math.PI);
        const topEdgeLatLng = L.latLng(center[0] + deltaLat, center[1]);
        const centerPoint = AppState.map.latLngToLayerPoint(centerLatLng);
        const topEdgePoint = AppState.map.latLngToLayerPoint(topEdgeLatLng);
        const offsetY = centerPoint.y - topEdgePoint.y + 10;
        console.log('calculateLabelAnchor:', { center, radius, anchor: [25, offsetY] });
        return [25, offsetY];
    }

    function updateBlueCircleLabels() {
        if (!blueCircleMetadata.length) {
            console.log('No blue circle metadata to update labels');
            return;
        }
        const zoom = AppState.map.getZoom();
        blueCircleMetadata.forEach(({ circle, label, center, radius, content }) => {
            label.setIcon(L.divIcon({
                className: `isoline-label isoline-label-${zoom <= 11 ? 'small' : 'large'}`,
                html: `<span style="font-size: ${zoom <= 11 ? '8px' : '10px'}">${content}</span>`,
                iconSize: zoom <= 11 ? [50, 12] : [60, 14],
                iconAnchor: calculateLabelAnchor(center, radius)
            }));
        });
        console.log('Updated isoline labels for zoom:', zoom);
    }

    try {
        AppState.map.off('zoomend', updateBlueCircleLabels);
    } catch (e) {
        console.warn('Failed to remove zoomend listener:', e.message);
    }

    if (!isVisible || (!Settings.state.userSettings.showExitArea && !Settings.state.userSettings.showCanopyArea)) {
        console.log('No circles to render:', { isVisible, showExitArea: Settings.state.userSettings.showExitArea, showCanopyArea: Settings.state.userSettings.showCanopyArea });
        return false;
    }

    // Render exit circles
    if (showExitAreaOnly && Settings.state.userSettings.showExitArea && Number.isFinite(blueLat) && Number.isFinite(blueLng) && Number.isFinite(radius) && Number.isFinite(radiusFull)) {
        AppState.jumpCircleGreen = L.circle([redLat, redLng], {
            radius: radiusFull,
            color: 'green',
            fillColor: 'green',
            fillOpacity: 0.2,
            weight: 2
        }).addTo(AppState.map);
        AppState.jumpCircleGreenLight = L.circle([blueLat, blueLng], {
            radius: radius,
            color: 'darkgreen',
            fillColor: 'darkgreen',
            fillOpacity: 0.2,
            weight: 2
        }).addTo(AppState.map);
        if (AppState.jumpCircleGreen.setZIndex) AppState.jumpCircleGreen.setZIndex(600);
        if (AppState.jumpCircleGreenLight.setZIndex) AppState.jumpCircleGreenLight.setZIndex(600);
        console.log('Added green and dark green circles:', {
            greenCenter: [redLat, redLng],
            greenRadius: radiusFull,
            darkGreenCenter: [blueLat, blueLng],
            darkGreenRadius: radius
        });

        const tooltipContent = `
            Exit areas calculated with:<br>
            Throw/Drift: ${Number.isFinite(freeFallDirection) ? Math.round(freeFallDirection) : 'N/A'}° ${Number.isFinite(freeFallDistance) ? Math.round(freeFallDistance) : 'N/A'} m<br>
            Free Fall Time: ${freeFallTime != null && !isNaN(freeFallTime) ? Math.round(freeFallTime) : 'N/A'} sec
        `;
        AppState.jumpCircleGreenLight.bindTooltip(tooltipContent, {
            direction: 'top',
            offset: [0, 0],
            className: 'wind-tooltip'
        });
        console.log('Tooltip bound to dark green circle:', { tooltipContent });
    }

    // Render canopy circles
    if (showCanopyAreaOnly && Settings.state.userSettings.showCanopyArea && Number.isFinite(blueLat) && Number.isFinite(blueLng) && Number.isFinite(redLat) && Number.isFinite(redLng) && Number.isFinite(radius) && Number.isFinite(radiusFull)) {
        const newCenterBlue = Utils.calculateNewCenter(blueLat, blueLng, displacement, direction);
        const newCenterRed = Utils.calculateNewCenter(redLat, redLng, displacementFull, directionFull);

        AppState.jumpCircle = L.circle(newCenterBlue, {
            radius: radius,
            color: 'blue',
            fillColor: 'blue',
            fillOpacity: 0,
            weight: 2,
            opacity: 0.1
        }).addTo(AppState.map);
        if (AppState.jumpCircle.setZIndex) AppState.jumpCircle.setZIndex(1000);
        console.log('Added main blue circle at:', { center: newCenterBlue, radius });

        AppState.jumpCircleFull = L.circle(newCenterRed, {
            radius: radiusFull,
            color: 'red',
            fillColor: 'red',
            fillOpacity: 0,
            weight: 2,
            opacity: 0.8
        }).addTo(AppState.map);
        if (AppState.jumpCircleFull.setZIndex) AppState.jumpCircleFull.setZIndex(400);
        console.log('Added red circle at:', { center: newCenterRed, radius: radiusFull });

        if (Array.isArray(additionalBlueRadii) && Array.isArray(additionalBlueDisplacements) && Array.isArray(additionalBlueDirections) && Array.isArray(additionalBlueUpperLimits)) {
            AppState.additionalBlueCircles = [];
            AppState.additionalBlueLabels = [];
            additionalBlueRadii.forEach((addRadius, i) => {
                if (Number.isFinite(addRadius) && addRadius > 0 &&
                    Number.isFinite(additionalBlueDisplacements[i]) && Number.isFinite(additionalBlueDirections[i]) &&
                    Number.isFinite(additionalBlueUpperLimits[i])) {
                    const addCenter = Utils.calculateNewCenter(blueLat, blueLng, additionalBlueDisplacements[i], additionalBlueDirections[i]);
                    const blueContent = `${Math.round(additionalBlueUpperLimits[i])}m`;
                    const circle = L.circle(addCenter, {
                        radius: addRadius,
                        color: 'blue',
                        fillColor: 'blue',
                        fillOpacity: 0.1,
                        weight: 1
                    }).addTo(AppState.map);
                    if (circle.setZIndex) circle.setZIndex(1000);

                    const label = L.marker(addCenter, {
                        icon: L.divIcon({
                            className: `isoline-label isoline-label-${currentZoom <= 11 ? 'small' : 'large'}`,
                            html: `<span style="font-size: ${currentZoom <= 11 ? '8px' : '10px'}">${blueContent}</span>`,
                            iconSize: currentZoom <= 11 ? [50, 12] : [60, 14],
                            iconAnchor: calculateLabelAnchor(addCenter, addRadius)
                        }),
                        zIndexOffset: 2100
                    }).addTo(AppState.map);

                    AppState.additionalBlueCircles.push(circle);
                    AppState.additionalBlueLabels.push(label);
                    blueCircleMetadata.push({ circle, label, center: addCenter, radius: addRadius, content: blueContent });
                    console.log(`Added additional blue circle ${i}:`, { center: addCenter, radius: addRadius, content: blueContent });

                    if (currentZoom <= 11 && i % 2 === 1) {
                        label.remove();
                        console.log(`Hid label for blue circle ${i} at zoom:`, currentZoom);
                    }
                } else {
                    console.warn(`Invalid data for blue circle ${i}:`, {
                        addRadius,
                        displacement: additionalBlueDisplacements[i],
                        direction: additionalBlueDirections[i],
                        upperLimit: additionalBlueUpperLimits[i]
                    });
                }
            });
        } else {
            console.warn('Invalid or empty arrays for additional blue circles:', {
                additionalBlueRadii,
                additionalBlueDisplacements,
                additionalBlueDirections,
                additionalBlueUpperLimits
            });
        }
    }

    // Re-render canopy circles if active and not in showExitAreaOnly mode
    if (!showExitAreaOnly && Settings.state.userSettings.showCanopyArea && !showCanopyAreaOnly) {
        const canopyResult = calculateCanopyCircles();
        if (canopyResult) {
            const newCenterBlue = Utils.calculateNewCenter(canopyResult.blueLat, canopyResult.blueLng, canopyResult.displacement, canopyResult.direction);
            const newCenterRed = Utils.calculateNewCenter(canopyResult.redLat, canopyResult.redLng, canopyResult.displacementFull, canopyResult.directionFull);

            removeLayer(AppState.jumpCircle, 'blue circle');
            removeLayer(AppState.jumpCircleFull, 'red circle');
            if (AppState.additionalBlueCircles) {
                AppState.additionalBlueCircles.forEach(circle => removeLayer(circle, 'additional blue circle'));
                AppState.additionalBlueCircles = [];
            }
            if (AppState.additionalBlueLabels) {
                AppState.additionalBlueLabels.forEach(label => removeLayer(label, 'additional blue label'));
                AppState.additionalBlueLabels = [];
            }

            AppState.jumpCircle = L.circle(newCenterBlue, {
                radius: canopyResult.radius,
                color: 'blue',
                fillColor: 'blue',
                fillOpacity: 0,
                weight: 2,
                opacity: 0.1
            }).addTo(AppState.map);
            if (AppState.jumpCircle.setZIndex) AppState.jumpCircle.setZIndex(1000);
            console.log('Re-added main blue circle at:', { center: newCenterBlue, radius: canopyResult.radius });

            AppState.jumpCircleFull = L.circle(newCenterRed, {
                radius: canopyResult.radiusFull,
                color: 'red',
                fillColor: 'red',
                fillOpacity: 0,
                weight: 2,
                opacity: 0.8
            }).addTo(AppState.map);
            if (AppState.jumpCircleFull.setZIndex) AppState.jumpCircleFull.setZIndex(400);
            console.log('Re-added red circle at:', { center: newCenterRed, radius: canopyResult.radiusFull });

            if (Array.isArray(canopyResult.additionalBlueRadii)) {
                AppState.additionalBlueCircles = [];
                AppState.additionalBlueLabels = [];
                canopyResult.additionalBlueRadii.forEach((addRadius, i) => {
                    if (Number.isFinite(addRadius) && addRadius > 0 &&
                        Number.isFinite(canopyResult.additionalBlueDisplacements[i]) &&
                        Number.isFinite(canopyResult.additionalBlueDirections[i]) &&
                        Number.isFinite(canopyResult.additionalBlueUpperLimits[i])) {
                        const addCenter = Utils.calculateNewCenter(canopyResult.blueLat, canopyResult.blueLng, canopyResult.additionalBlueDisplacements[i], canopyResult.additionalBlueDirections[i]);
                        const blueContent = `${Math.round(canopyResult.additionalBlueUpperLimits[i])}m`;
                        const circle = L.circle(addCenter, {
                            radius: addRadius,
                            color: 'blue',
                            fillColor: 'blue',
                            fillOpacity: 0.1,
                            weight: 1
                        }).addTo(AppState.map);
                        if (circle.setZIndex) circle.setZIndex(1000);

                        const label = L.marker(addCenter, {
                            icon: L.divIcon({
                                className: `isoline-label isoline-label-${currentZoom <= 11 ? 'small' : 'large'}`,
                                html: `<span style="font-size: ${currentZoom <= 11 ? '8px' : '10px'}">${blueContent}</span>`,
                                iconSize: currentZoom <= 11 ? [50, 12] : [60, 14],
                                iconAnchor: calculateLabelAnchor(addCenter, addRadius)
                            }),
                            zIndexOffset: 2100
                        }).addTo(AppState.map);

                        AppState.additionalBlueCircles.push(circle);
                        AppState.additionalBlueLabels.push(label);
                        blueCircleMetadata.push({ circle, label, center: addCenter, radius: addRadius, content: blueContent });
                        console.log(`Re-added additional blue circle ${i}:`, { center: addCenter, radius: addRadius, content: blueContent });

                        if (currentZoom <= 11 && i % 2 === 1) {
                            label.remove();
                            console.log(`Hid label for blue circle ${i} at zoom:`, currentZoom);
                        }
                    }
                });
            }
        }
    }

    if (blueCircleMetadata.length) {
        updateBlueCircleLabels();
        AppState.map.on('zoomend', updateBlueCircleLabels);
    } else {
        console.log('No blue circles created, skipping label update and zoom listener');
    }

    // Ensure gpxLayer is valid and track is loaded before bringing to front
    if (AppState.isTrackLoaded && AppState.gpxLayer && typeof AppState.gpxLayer.bringToFront === 'function') {
        console.log('Bringing gpxLayer to front');
        AppState.gpxLayer.bringToFront();
    } else {
        console.log('gpxLayer not brought to front:', {
            isTrackLoaded: AppState.isTrackLoaded,
            gpxLayerExists: !!AppState.gpxLayer,
            hasBringToFront: AppState.gpxLayer && typeof AppState.gpxLayer.bringToFront === 'function',
            gpxLayerType: AppState.gpxLayer ? AppState.gpxLayer.constructor.name : null
        });
    }

    ['showExitAreaCheckbox', 'showCanopyAreaCheckbox', 'showJumpRunTrack'].forEach(id => {
        const checkbox = document.getElementById(id);
        if (checkbox) {
            console.log(`Checkbox ${id} DOM state after update:`, {
                disabled: checkbox.disabled,
                pointerEvents: getComputedStyle(checkbox).pointerEvents,
                zIndex: getComputedStyle(checkbox).zIndex,
                parentClasses: checkbox.parentElement.className
            });
        }
    });

    console.log('updateJumpCircle completed');
    return true;
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
        updateJumpRunTrack();
    }
}
export function jumpRunTrack() {
    console.log('Starting jumpRunTrack...', {
        weatherData: !!AppState.weatherData,
        lastLat: AppState.lastLat,
        lastLng: AppState.lastLng,
        lastAltitude: AppState.lastAltitude,
        customJumpRunDirection: AppState.customJumpRunDirection,
        jumpRunTrackOffset: Settings.state.userSettings.jumpRunTrackOffset,
        jumpRunTrackForwardOffset: Settings.state.userSettings.jumpRunTrackForwardOffset
    });
    const exitAltitude = parseInt(document.getElementById('exitAltitude')?.value) || Settings.state.userSettings.exitAltitude || 3000;
    const openingAltitude = parseInt(document.getElementById('openingAltitude')?.value) || Settings.state.userSettings.openingAltitude || 1000;
    const customDirection = parseInt(document.getElementById('jumpRunTrackDirection')?.value, 10);
    const sliderIndex = parseInt(document.getElementById('timeSlider')?.value) || 0;
    const lateralOffset = parseInt(document.getElementById('jumpRunTrackOffset')?.value) || Settings.state.userSettings.jumpRunTrackOffset || 0;
    const forwardOffset = parseInt(document.getElementById('jumpRunTrackForwardOffset')?.value) || Settings.state.userSettings.jumpRunTrackForwardOffset || 0;

    if (!AppState.weatherData || !AppState.lastLat || !AppState.lastLng || AppState.lastAltitude === null || AppState.lastAltitude === 'N/A') {
        console.warn('Cannot calculate jump run track: missing data', {
            weatherData: !!AppState.weatherData,
            lastLat: AppState.lastLat,
            lastLng: AppState.lastLng,
            lastAltitude: AppState.lastAltitude
        });
        return null;
    }

    const interpolatedData = interpolateWeatherData(sliderIndex);
    if (!interpolatedData || interpolatedData.length === 0) {
        console.warn('No interpolated weather data available for sliderIndex:', sliderIndex);
        return null;
    }

    const elevation = Math.round(AppState.lastAltitude);
    const lowerLimit = elevation;
    const upperLimit = elevation + openingAltitude;
    console.log('Jump run track limits:', { lowerLimit, upperLimit, elevation });

    const heights = interpolatedData.map(d => d.height);
    const dirs = interpolatedData.map(d => Number.isFinite(d.dir) ? parseFloat(d.dir) : 0);
    const spdsMps = interpolatedData.map(d => {
        const spd = Number.isFinite(d.spd) ? parseFloat(d.spd) : 0;
        return Utils.convertWind(spd, 'm/s', getWindSpeedUnit());
    });

    console.log('Interpolated data:', { heights, dirs, spdsMps });

    const uComponents = spdsMps.map((spd, i) => -spd * Math.sin(dirs[i] * Math.PI / 180));
    const vComponents = spdsMps.map((spd, i) => -spd * Math.cos(dirs[i] * Math.PI / 180));

    const meanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, lowerLimit, upperLimit);
    const meanWindDirection = meanWind[0];
    const meanWindSpeed = meanWind[1];

    if (!Number.isFinite(meanWindDirection) || !Number.isFinite(meanWindSpeed)) {
        console.warn('Invalid mean wind calculation:', meanWind);
        return null;
    }

    let jumpRunTrackDirection;
    if (AppState.customJumpRunDirection !== null && !isNaN(AppState.customJumpRunDirection) && AppState.customJumpRunDirection >= 0 && AppState.customJumpRunDirection <= 359) {
        jumpRunTrackDirection = AppState.customJumpRunDirection;
        console.log(`Using custom jump run direction: ${jumpRunTrackDirection}°`);
    } else {
        jumpRunTrackDirection = Math.round(meanWindDirection);
        AppState.customJumpRunDirection = null;
        console.log(`Using calculated jump run direction: ${jumpRunTrackDirection}°`, {
            meanWindDirection: meanWindDirection.toFixed(1),
            inputValue: document.getElementById('jumpRunTrackDirection')?.value
        });
    }

    // Calculate ground speed at exit altitude
    const exitHeightM = elevation + exitAltitude;
    const exitHeightFt = exitHeightM / 0.3048;
    const iasKt = Settings.state.userSettings.aircraftSpeedKt || 90;
    console.log('TAS input:', { iasKt, exitHeightFt });
    const tasKt = Utils.calculateTAS(iasKt, exitHeightFt);
    console.log('TAS output:', tasKt);
    let trackLength = 2000; // Default fallback
    let approachLength = 2000; // Default fallback for approach
    let groundSpeedMps = null;
    let approachLatLngs = null;
    if (tasKt === 'N/A' || !Number.isFinite(tasKt)) {
        console.warn('Failed to calculate TAS for ground speed');
    } else {
        const windDirAtExit = Utils.LIP(heights, dirs, exitHeightM);
        const windSpeedMpsAtExit = Utils.LIP(heights, spdsMps, exitHeightM);
        const windSpeedKtAtExit = windSpeedMpsAtExit * 1.94384;

        const tasMps = tasKt * 0.514444;
        const trackRad = (jumpRunTrackDirection * Math.PI) / 180;
        const tasVx = tasMps * Math.cos(trackRad);
        const tasVy = tasMps * Math.sin(trackRad);

        const windDirToRad = ((windDirAtExit + 180) % 360) * Math.PI / 180;
        const windVx = windSpeedMpsAtExit * Math.cos(windDirToRad);
        const windVy = windSpeedMpsAtExit * Math.sin(windDirToRad);

        const groundVx = tasVx + windVx;
        const groundVy = tasVy + windVy;
        groundSpeedMps = Math.sqrt(groundVx * groundVx + groundVy * groundVy);
        const groundSpeedKt = groundSpeedMps * 1.94384;

        // Calculate dynamic track length
        const numberOfJumpers = parseInt(Settings.state.userSettings.numberOfJumpers) || 10;
        const jumperSeparation = parseFloat(Settings.state.userSettings.jumperSeparation) || 5;

        let separation;
        if (numberOfJumpers == 1) {
            separation = 200 / groundSpeedMps;
        } else if (numberOfJumpers <= 6) {
            separation = 300 / groundSpeedMps;
        } else {
            separation = 500 / groundSpeedMps;
        }
        console.log('Dynamic separation: ', separation.toFixed(0));

        if (numberOfJumpers >= 1 && jumperSeparation >= 1 && Number.isFinite(groundSpeedMps)) {
            trackLength = numberOfJumpers * jumperSeparation * groundSpeedMps;
            trackLength = Math.max(100, Math.min(10000, Math.round(trackLength)));
            console.log('Dynamic track length calculation:', {
                numberOfJumpers,
                jumperSeparation,
                groundSpeedMps: groundSpeedMps.toFixed(2),
                trackLength
            });
        } else {
            console.warn('Invalid inputs for track length, using default:', {
                numberOfJumpers,
                jumperSeparation,
                groundSpeedMps
            });
        }

        console.log('Aircraft Ground Speed Calculation:', {
            exitAltitude: exitHeightM.toFixed(1) + ' m',
            exitHeightFt: exitHeightFt.toFixed(1) + ' ft',
            ias: iasKt.toFixed(1) + ' kt',
            tas: tasKt.toFixed(1) + ' kt',
            jumpRunDirection: jumpRunTrackDirection.toFixed(1) + '°',
            windDirAtExit: windDirAtExit.toFixed(1) + '°',
            windSpeedAtExit: windSpeedKtAtExit.toFixed(1) + ' kt',
            groundSpeed: groundSpeedKt.toFixed(1) + ' kt'
        });
    }

    // Update input field only if calculated or explicitly set
    const directionInput = document.getElementById('jumpRunTrackDirection');
    if (directionInput) {
        directionInput.value = jumpRunTrackDirection;
        console.log('Updated jumpRunTrackDirection input to:', jumpRunTrackDirection);
    }

    const halfLength = trackLength / 2;

    // Apply forward/backward offset along the track direction
    let centerLat = AppState.lastLat;
    let centerLng = AppState.lastLng;
    if (forwardOffset !== 0) {
        const forwardDistance = Math.abs(forwardOffset);
        const forwardBearing = forwardOffset >= 0 ? jumpRunTrackDirection : (jumpRunTrackDirection + 180) % 360;
        [centerLat, centerLng] = Utils.calculateNewCenter(AppState.lastLat, AppState.lastLng, forwardDistance, forwardBearing);
        console.log('Applied forward/backward offset:', {
            forwardOffset,
            forwardBearing,
            centerLat,
            centerLng
        });
    }

    // Apply lateral offset perpendicular to the track direction
    if (lateralOffset !== 0) {
        const offsetDistance = Math.abs(lateralOffset);
        const offsetBearing = lateralOffset >= 0
            ? (jumpRunTrackDirection + 90) % 360
            : (jumpRunTrackDirection - 90 + 360) % 360;
        [centerLat, centerLng] = Utils.calculateNewCenter(centerLat, centerLng, offsetDistance, offsetBearing);
        console.log('Applied lateral offset:', {
            lateralOffset,
            offsetBearing,
            centerLat,
            centerLng
        });
    }

    // Calculate approach path
    const approachTime = 120; // Fixed 120 seconds
    if (Number.isFinite(groundSpeedMps)) {
        approachLength = groundSpeedMps * approachTime;
        approachLength = Math.max(100, Math.min(20000, Math.round(approachLength)));
        console.log('Approach path calculation:', {
            groundSpeedMps: groundSpeedMps.toFixed(2),
            approachTime,
            approachLength
        });

        const startPoint = Utils.calculateNewCenter(centerLat, centerLng, trackLength / 2, (jumpRunTrackDirection + 180) % 360);
        const approachEndPoint = Utils.calculateNewCenter(startPoint[0], startPoint[1], approachLength, (jumpRunTrackDirection + 180) % 360);
        approachLatLngs = [
            [startPoint[0], startPoint[1]],
            [approachEndPoint[0], approachEndPoint[1]]
        ];
    } else {
        console.warn('Invalid ground speed for approach path, using default length');
    }

    // Calculate jump run track points
    const startPoint = Utils.calculateNewCenter(centerLat, centerLng, halfLength, (jumpRunTrackDirection + 180) % 360);
    const endPoint = Utils.calculateNewCenter(centerLat, centerLng, halfLength, jumpRunTrackDirection);

    const latlngs = [
        [startPoint[0], startPoint[1]], // Rear
        [endPoint[0], endPoint[1]]      // Front
    ];

    console.log(`Jump Run Track: ${jumpRunTrackDirection}° (Mean wind: ${meanWindDirection.toFixed(1)}° @ ${meanWindSpeed.toFixed(1)} ${getWindSpeedUnit()}), Length: ${trackLength} m`);
    console.log('Jump Run Track latlngs:', latlngs);
    if (approachLatLngs) {
        console.log(`Approach Path: ${jumpRunTrackDirection}°, Length: ${approachLength} m, latlngs:`, approachLatLngs);
    }

    return {
        direction: jumpRunTrackDirection,
        trackLength: trackLength,
        meanWindDirection: meanWindDirection,
        meanWindSpeed: meanWindSpeed,
        latlngs: latlngs,
        approachLatLngs: approachLatLngs,
        approachLength: approachLength,
        approachTime: approachTime
    };
}
export function updateJumpRunTrack() {
    if (!AppState.map) {
        console.warn('Map not initialized, cannot update jump run track');
        return;
    }

    console.log('updateJumpRunTrack called', {
        showJumpRunTrack: Settings.state.userSettings.showJumpRunTrack,
        weatherData: !!AppState.weatherData,
        lastLat: AppState.lastLat,
        lastLng: AppState.lastLng,
        customJumpRunDirection: AppState.customJumpRunDirection,
        currentZoom: AppState.map.getZoom(),
        jumpRunTrackOffset: Settings.state.userSettings.jumpRunTrackOffset,
        jumpRunTrackForwardOffset: Settings.state.userSettings.jumpRunTrackForwardOffset
    });

    const currentZoom = AppState.map.getZoom();
    const isZoomInRange = currentZoom >= Constants.minZoom && currentZoom <= Constants.maxZoom;

    // Remove existing jump run track layer
    if (AppState.jumpRunTrackLayer) {
        try {
            AppState.map.removeLayer(AppState.jumpRunTrackLayer);
            console.log('Removed existing JRT layer group');
        } catch (error) {
            console.warn('Error removing JRT layer group:', error);
        }
        AppState.jumpRunTrackLayer = null;
    }

    if (!Settings.state.userSettings.showJumpRunTrack || !AppState.weatherData || !AppState.lastLat || !AppState.lastLng || !isZoomInRange) {
        console.log('Jump run track not drawn', {
            showJumpRunTrack: Settings.state.userSettings.showJumpRunTrack,
            weatherData: !!AppState.weatherData,
            lastLat: AppState.lastLat,
            lastLng: AppState.lastLng,
            isZoomInRange
        });
        const directionInput = document.getElementById('jumpRunTrackDirection');
        if (directionInput) {
            setInputValueSilently('jumpRunTrackDirection', '');
        }
        return;
    }

    const trackData = jumpRunTrack();
    if (!trackData || !trackData.latlngs || !Array.isArray(trackData.latlngs) || trackData.latlngs.length < 2) {
        console.error('Invalid trackData from jumpRunTrack:', trackData);
        return;
    }

    let { latlngs, direction, trackLength, approachLatLngs, approachLength, approachTime } = trackData;

    const isValidLatLngs = latlngs.every(ll => Array.isArray(ll) && ll.length === 2 && !isNaN(ll[0]) && !isNaN(ll[1]));
    if (!isValidLatLngs) {
        console.error('Invalid latlngs format in trackData:', latlngs);
        return;
    }

    console.log('Updating jump run track with:', {
        latlngs,
        direction,
        trackLength,
        lateralOffset: Settings.state.userSettings.jumpRunTrackOffset,
        forwardOffset: Settings.state.userSettings.jumpRunTrackForwardOffset
    });
    if (approachLatLngs) {
        console.log('Updating approach path with:', { approachLatLngs, approachLength });
    }

    // Create a LayerGroup to hold all components
    AppState.jumpRunTrackLayer = L.layerGroup().addTo(AppState.map);

    // Create polyline for the jump run track (interactive for tooltips)
    const trackPolyline = L.polyline(latlngs, {
        color: 'orange',
        weight: 4,
        opacity: 0.9,
        interactive: true
    }).addTo(AppState.jumpRunTrackLayer);

    trackPolyline.bindTooltip(`Jump Run: ${Math.round(direction)}°, ${Math.round(trackLength)} m`, {
        permanent: false,
        direction: 'top',
        offset: [0, -10]
    });

    // Prevent drag events on the polyline
    trackPolyline.on('mousedown touchstart', (e) => {
        L.DomEvent.stopPropagation(e);
    });

    // Create polyline for the approach path (interactive for tooltips)
    let approachPolyline = null;
    if (approachLatLngs && Array.isArray(approachLatLngs) && approachLatLngs.length === 2) {
        const isValidApproachLatLngs = approachLatLngs.every(ll => Array.isArray(ll) && ll.length === 2 && !isNaN(ll[0]) && !isNaN(ll[1]));
        if (isValidApproachLatLngs) {
            approachPolyline = L.polyline(approachLatLngs, {
                color: 'orange',
                weight: 3,
                opacity: 0.9,
                dashArray: '10, 10',
                interactive: true
            }).addTo(AppState.jumpRunTrackLayer);

            approachPolyline.bindTooltip(`Approach: ${Math.round(direction)}°, ${Math.round(approachLength)} m, ${Math.round(approachTime / 60)} min`, {
                permanent: false,
                direction: 'top',
                offset: [0, -10]
            });

            // Prevent drag events on the approach polyline
            approachPolyline.on('mousedown touchstart', (e) => {
                L.DomEvent.stopPropagation(e);
            });
        } else {
            console.warn('Invalid approachLatLngs format:', approachLatLngs);
        }
    } else {
        console.warn('approachLatLngs is null or invalid:', approachLatLngs);
    }

    // Add airplane marker at the front end (now draggable)
    const frontEnd = latlngs[1];
    const airplaneIcon = L.icon({
        iconUrl: 'airplane_orange.png',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -16],
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        shadowSize: [41, 41],
        shadowAnchor: [13, 32]
    });

    const airplaneMarker = L.marker(frontEnd, {
        icon: airplaneIcon,
        rotationAngle: direction,
        rotationOrigin: 'center center',
        draggable: true, // Make the airplane marker draggable
        zIndexOffset: 2000 // Ensure it's above other layers
    }).addTo(AppState.jumpRunTrackLayer);

    // Add tooltip to indicate draggability
    airplaneMarker.bindTooltip('Drag to move Jump Run Track', {
        permanent: false,
        direction: 'top',
        offset: [0, -20]
    });

    // Store original positions for drag calculations
    let originalTrackLatLngs = latlngs.map(ll => [...ll]);
    let originalApproachLatLngs = approachLatLngs ? approachLatLngs.map(ll => [...ll]) : null;
    let originalAirplaneLatLng = [...frontEnd];
    let originalCenterLat = AppState.lastLat;
    let originalCenterLng = AppState.lastLng;
    if (Settings.state.userSettings.jumpRunTrackForwardOffset !== 0) {
        const forwardDistance = Math.abs(Settings.state.userSettings.jumpRunTrackForwardOffset);
        const forwardBearing = Settings.state.userSettings.jumpRunTrackForwardOffset >= 0 ? direction : (direction + 180) % 360;
        [originalCenterLat, originalCenterLng] = Utils.calculateNewCenter(AppState.lastLat, AppState.lastLng, forwardDistance, forwardBearing);
    }
    if (Settings.state.userSettings.jumpRunTrackOffset !== 0) {
        const lateralDistance = Math.abs(Settings.state.userSettings.jumpRunTrackOffset);
        const lateralBearing = Settings.state.userSettings.jumpRunTrackOffset >= 0
            ? (direction + 90) % 360
            : (direction - 90 + 360) % 360;
        [originalCenterLat, originalCenterLng] = Utils.calculateNewCenter(originalCenterLat, originalCenterLng, lateralDistance, lateralBearing);
    }

    // Update direction input
    const directionInput = document.getElementById('jumpRunTrackDirection');
    if (directionInput) {
        setInputValueSilently('jumpRunTrackDirection', Math.round(direction));
    }

    // Dragging handlers for the airplane marker
    airplaneMarker.on('mousedown', (e) => {
        console.log('Airplane marker mousedown:', e);
        if (AppState.map) {
            AppState.map.dragging.disable();
        }
        L.DomEvent.stopPropagation(e);
    });

    airplaneMarker.on('dragstart', () => {
        console.log('Airplane marker dragstart');
        if (AppState.map) {
            AppState.map.dragging.disable();
        }
    });

    airplaneMarker.on('drag', () => {
        console.log('Airplane marker drag');
        const newLatLng = airplaneMarker.getLatLng();
        // Calculate delta from the original center (lastLat, lastLng) to new center
        const originalCenter = L.latLng(originalCenterLat, originalCenterLng);
        const newCenter = L.latLng(originalTrackLatLngs[1][0], originalTrackLatLngs[1][1]); // Front end of JRT
        const deltaLat = newLatLng.lat - newCenter.lat;
        const deltaLng = newLatLng.lng - newCenter.lng;

        // Update track polyline
        const newTrackLatLngs = originalTrackLatLngs.map(ll => [ll[0] + deltaLat, ll[1] + deltaLng]);
        trackPolyline.setLatLngs(newTrackLatLngs);
        originalTrackLatLngs = newTrackLatLngs;

        // Update approach polyline if it exists
        if (approachPolyline && originalApproachLatLngs) {
            const newApproachLatLngs = originalApproachLatLngs.map(ll => [ll[0] + deltaLat, ll[1] + deltaLng]);
            approachPolyline.setLatLngs(newApproachLatLngs);
            originalApproachLatLngs = newApproachLatLngs;
        }

        // Update airplane marker position (already handled by Leaflet)
        originalAirplaneLatLng = [newLatLng.lat, newLatLng.lng];
        originalCenterLat += deltaLat;
        originalCenterLng += deltaLng;
    });

    airplaneMarker.on('dragend', () => {
        console.log('Airplane marker dragend');
        if (AppState.map) {
            AppState.map.dragging.enable();
        }

        const newLatLng = airplaneMarker.getLatLng();

        // Calculate displacement from original center (lastLat, lastLng)
        const originalCenter = L.latLng(AppState.lastLat, AppState.lastLng);
        const newCenter = L.latLng(newLatLng.lat - (originalAirplaneLatLng[0] - originalCenterLat), newLatLng.lng - (originalAirplaneLatLng[1] - originalCenterLng));
        if (!AppState.map) {
            console.warn('Map not initialized, cannot calculate distance for dragend');
            return;
        }
        const distance = AppState.map.distance(originalCenter, newCenter);
        const bearing = Utils.calculateBearing(originalCenter.lat, originalCenter.lng, newCenter.lat, newCenter.lng);

        // Calculate lateral and forward components
        const trackDirectionRad = direction * Math.PI / 180;
        const bearingRad = bearing * Math.PI / 180;

        let angle = Math.abs(((bearing - direction + 540) % 360) - 180);
        if (angle > 90) {
            angle = 180 - angle;
        }
        const angleRad = angle * Math.PI / 180;

        const forwardDistance = distance * Math.cos(angleRad);
        const lateralDistance = distance * Math.sin(angleRad);

        let forwardOffsetSign = 1;
        const forwardAngle = Math.abs(((bearing - direction + 540) % 360) - 180);
        const backwardAngle = Math.abs(((bearing - (direction + 180) % 360 + 540) % 360) - 180);
        if (backwardAngle < forwardAngle) {
            forwardOffsetSign = -1;
        }

        let lateralOffsetSign = 1;
        const rightAngle = Math.abs(((bearing - (direction + 90) % 360 + 540) % 360) - 180);
        const leftAngle = Math.abs(((bearing - (direction - 90 + 360) % 360 + 540) % 360) - 180);
        if (leftAngle < rightAngle) {
            lateralOffsetSign = -1;
        }

        const newForwardOffset = Math.round((forwardDistance * forwardOffsetSign) / 100) * 100;
        const newLateralOffset = Math.round((lateralDistance * lateralOffsetSign) / 100) * 100;

        const clampedForwardOffset = Math.max(-50000, Math.min(50000, newForwardOffset));
        const clampedLateralOffset = Math.max(-50000, Math.min(50000, newLateralOffset));

        Settings.state.userSettings.jumpRunTrackOffset = clampedLateralOffset;
        Settings.state.userSettings.jumpRunTrackForwardOffset = clampedForwardOffset;
        Settings.save();
        console.log('JRT dragged, new offsets:', {
            lateralOffset: Settings.state.userSettings.jumpRunTrackOffset,
            forwardOffset: Settings.state.userSettings.jumpRunTrackForwardOffset,
            distance,
            bearing,
            forwardDistance,
            lateralDistance,
            angle
        });

        const lateralOffsetInput = document.getElementById('jumpRunTrackOffset');
        if (lateralOffsetInput) {
            lateralOffsetInput.value = Settings.state.userSettings.jumpRunTrackOffset;
        }
        const forwardOffsetInput = document.getElementById('jumpRunTrackForwardOffset');
        if (forwardOffsetInput) {
            forwardOffsetInput.value = Settings.state.userSettings.jumpRunTrackForwardOffset;
        }
    });

    airplaneMarker.on('touchstart', (e) => {
        console.log('Airplane marker touchstart:', e);
        if (AppState.map) {
            AppState.map.dragging.disable();
        }
        L.DomEvent.stopPropagation(e);
    });

    airplaneMarker.on('click', (e) => {
        console.log('Airplane marker click:', e);
        L.DomEvent.stopPropagation(e);
    });
}
function calculateCutAway() {
    if (!AppState.map) {
        console.warn('Map not initialized, cannot calculate cut-away');
        Utils.handleError('Cannot calculate cut-away: map not initialized.');
        return;
    }

    console.log('calculateCutAway called', {
        calculateJump: Settings.state.userSettings.calculateJump,
        showCanopyArea: Settings.state.userSettings.showCanopyArea,
        showCutAwayFinder: Settings.state.userSettings.showCutAwayFinder,
        cutAwayLat: AppState.cutAwayLat,
        cutAwayLng: AppState.cutAwayLng,
        cutAwayMarkerExists: !!AppState.cutAwayMarker,
        cutAwayMarkerClassName: AppState.cutAwayMarker?.options?.icon?.options?.className || 'none',
        cutAwayCircleExists: !!AppState.cutAwayCircle
    });

    // Silently skip if cut-away marker is not placed
    if (AppState.cutAwayLat === null || AppState.cutAwayLng === null) {
        console.log('Skipping calculateCutAway: cutAwayLat or cutAwayLng is null');
        return;
    }

    // Validate other required data
    if (!AppState.weatherData || AppState.lastAltitude === 'N/A' || !Settings.state.userSettings.cutAwayAltitude) {
        console.log('Cannot calculate cut-away: missing data', {
            weatherData: !!AppState.weatherData,
            lastAltitude: AppState.lastAltitude,
            cutAwayAltitude: Settings.state.userSettings.cutAwayAltitude
        });
        Utils.handleError('Cannot calculate cut-away: missing required data.');
        return;
    }

    // Get current time slider index
    const index = parseInt(document.getElementById('timeSlider')?.value) || 0;

    // Generate interpolated data
    let interpolatedData;
    try {
        if (typeof interpolateWeatherData === 'function') {
            interpolatedData = interpolateWeatherData(index);
        } else {
            console.warn('interpolateWeatherData is not a function');
            Utils.handleError('Cannot calculate cut-away: weather data processing unavailable.');
            return;
        }
    } catch (error) {
        console.warn('Error calling interpolateWeatherData:', error);
        Utils.handleError('Cannot calculate cut-away: error processing weather data.');
        return;
    }

    if (!interpolatedData || !Array.isArray(interpolatedData) || interpolatedData.length === 0) {
        console.warn('Cannot calculate cut-away: invalid interpolatedData', { interpolatedData });
        Utils.handleError('Cannot calculate cut-away: no valid weather data available.');
        return;
    }

    // Prepare altitude range for mean wind calculation
    const elevation = Math.round(AppState.lastAltitude); // Surface altitude in meters
    const lowerLimit = elevation;
    const upperLimit = elevation + Settings.state.userSettings.cutAwayAltitude; // Surface + cutAwayAltitude
    console.log('Cut-away wind limits:', { lowerLimit, upperLimit, elevation });

    // Extract wind data and convert speeds from km/h to m/s
    const heights = interpolatedData.map(d => d.height);
    const dirs = interpolatedData.map(d => Number.isFinite(d.dir) ? parseFloat(d.dir) : 0);
    const spdsMps = interpolatedData.map(d => {
        const spdKmh = Number.isFinite(d.spd) ? parseFloat(d.spd) : 0; // Speed in km/h
        return spdKmh * 0.277778; // Convert km/h to m/s (1 km/h = 0.277778 m/s)
    });

    console.log('Interpolated data for cut-away:', { heights, dirs, spdsMps });

    // Calculate U and V components
    const uComponents = spdsMps.map((spd, i) => -spd * Math.sin(dirs[i] * Math.PI / 180));
    const vComponents = spdsMps.map((spd, i) => -spd * Math.cos(dirs[i] * Math.PI / 180));

    // Compute mean wind
    const meanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, lowerLimit, upperLimit);
    if (!meanWind || !Array.isArray(meanWind) || meanWind.length < 2 || !Number.isFinite(meanWind[0]) || !Number.isFinite(meanWind[1])) {
        console.warn('Invalid mean wind calculation for cut-away:', meanWind);
        Utils.handleError('Cannot calculate cut-away: invalid wind calculation.');
        return;
    }

    const meanWindDirection = meanWind[0]; // degrees
    const meanWindSpeedMps = meanWind[1]; // m/s

    // Vertical speed calculations
    const cutAwayAltitude = Settings.state.userSettings.cutAwayAltitude; // meters
    const surfaceAltitude = AppState.lastAltitude; // meters
    const verticalSpeedMax = Math.sqrt((2 * 9.81 * 5) / (1.2 * 13 * 2.6)).toFixed(1); // m/s, Fully Open
    const verticalSpeedMean = Math.sqrt((2 * 9.81 * 5) / (1.2 * 2 * 1.5)).toFixed(1); // m/s, Partially Collapsed
    const verticalSpeedMin = Math.sqrt((2 * 9.81 * 5) / (1.2 * 0.1 * 1)).toFixed(1); // m/s, Fully Collapsed
    const radius = 150; // meters

    // Log vertical speeds
    console.log('Vertical speeds:', {
        Max: `${verticalSpeedMax} m/s (Fully Open)`,
        Mean: `${verticalSpeedMean} m/s (Partially Collapsed)`,
        Min: `${verticalSpeedMin} m/s (Fully Collapsed)`
    });

    // Calculate descent times
    const heightDifference = cutAwayAltitude; // meters
    const descentTimeMin = heightDifference / verticalSpeedMin; // seconds
    const descentTimeMean = heightDifference / verticalSpeedMean; // seconds
    const descentTimeMax = heightDifference / verticalSpeedMax; // seconds

    // Calculate displacement distances
    const displacementDistanceMin = meanWindSpeedMps * descentTimeMin; // meters
    const displacementDistanceMean = meanWindSpeedMps * descentTimeMean; // meters
    const displacementDistanceMax = meanWindSpeedMps * descentTimeMax; // meters

    // Calculate landing positions
    const adjustedWindDirection = ((meanWindDirection + 180) % 360);
    const [newLatMin, newLngMin] = Utils.calculateNewCenter(AppState.cutAwayLat, AppState.cutAwayLng, displacementDistanceMin, adjustedWindDirection);
    const [newLatMean, newLngMean] = Utils.calculateNewCenter(AppState.cutAwayLat, AppState.cutAwayLng, displacementDistanceMean, adjustedWindDirection);
    const [newLatMax, newLngMax] = Utils.calculateNewCenter(AppState.cutAwayLat, AppState.cutAwayLng, displacementDistanceMax, adjustedWindDirection);

    // Log all calculations
    console.log('Cut-away canopy calculation:', {
        cutAwayAltitude: `${cutAwayAltitude} m`,
        surfaceAltitude: `${surfaceAltitude} m`,
        meanWindSpeed: `${meanWindSpeedMps.toFixed(2)} m/s`,
        meanWindDirection: `${Math.round(adjustedWindDirection)}°`,
        descentTimeMin: `${descentTimeMin.toFixed(0)} s`,
        descentTimeMean: `${descentTimeMean.toFixed(0)} s`,
        descentTimeMax: `${descentTimeMax.toFixed(0)} s`,
        displacementDistanceMin: `${displacementDistanceMin.toFixed(0)} m`,
        displacementDistanceMean: `${displacementDistanceMean.toFixed(0)} m`,
        displacementDistanceMax: `${displacementDistanceMax.toFixed(0)} m`,
        landingPositionMin: {
            lat: newLatMin.toFixed(5),
            lng: newLngMin.toFixed(5)
        },
        landingPositionMean: {
            lat: newLatMean.toFixed(5),
            lng: newLngMean.toFixed(5)
        },
        landingPositionMax: {
            lat: newLatMax.toFixed(5),
            lng: newLngMax.toFixed(5)
        }
    });

    // Remove existing cut-away circle if present
    if (AppState.cutAwayCircle) {
        AppState.map.removeLayer(AppState.cutAwayCircle);
        AppState.cutAwayCircle = null;
        console.log('Cleared existing cut-away circle');
    }

    // Add circle for the selected cut-away state if showCutAwayFinder is enabled
    if (Settings.state.userSettings.showCutAwayFinder && Settings.state.userSettings.calculateJump) {
        let center, descentTime, displacementDistance, stateLabel, verticalSpeedSelected;
        switch (Settings.state.userSettings.cutAwayState) {
            case 'Partially':
                center = [newLatMean, newLngMean];
                descentTime = descentTimeMean;
                displacementDistance = displacementDistanceMean;
                verticalSpeedSelected = verticalSpeedMean;
                stateLabel = 'Partially Collapsed';
                break;
            case 'Collapsed':
                center = [newLatMin, newLngMin];
                descentTime = descentTimeMin;
                displacementDistance = displacementDistanceMin;
                verticalSpeedSelected = verticalSpeedMin;
                stateLabel = 'Fully Collapsed';
                break;
            case 'Open':
                center = [newLatMax, newLngMax];
                descentTime = descentTimeMax;
                displacementDistance = displacementDistanceMax;
                verticalSpeedSelected = verticalSpeedMax;
                stateLabel = 'Fully Open';
                break;
            default:
                console.warn('Unknown cutAwayState:', Settings.state.userSettings.cutAwayState);
                return;
        }

        // Create tooltip content
        const tooltipContent = `
            <b>Cut-Away (${stateLabel})</b><br>
            Cut-Away Altitude: ${cutAwayAltitude} m<br>
            Displacement: ${meanWindDirection.toFixed(0)}°, ${displacementDistance.toFixed(0)} m<br>
            Descent Time/Speed: ${descentTime.toFixed(0)} s at ${verticalSpeedSelected} m/s<br>
        `;

        // Add circle to map
        AppState.cutAwayCircle = L.circle(center, {
            radius: radius,
            color: 'purple',
            fillColor: 'purple',
            fillOpacity: 0.2,
            weight: 2
        }).addTo(AppState.map);

        // Bind tooltip
        AppState.cutAwayCircle.bindTooltip(tooltipContent, {
            permanent: false,
            direction: 'center',
            className: 'cutaway-tooltip'
        });
        console.log('Added cut-away circle:', { center, radius, stateLabel });
    }
    console.log('calculateCutAway completed', {
        cutAwayMarkerExists: !!AppState.cutAwayMarker,
        cutAwayCircleExists: !!AppState.cutAwayCircle
    });
}

// == Landing Pattern Calculations ==
export function calculateLandingPatternCoords(lat, lng, interpolatedData, sliderIndex) {
    const CANOPY_SPEED_KT = parseInt(document.getElementById('canopySpeed').value) || 20;
    const DESCENT_RATE_MPS = parseFloat(document.getElementById('descentRate').value) || 3.5;
    const LEG_HEIGHT_FINAL = parseInt(document.getElementById('legHeightFinal').value) || 100;
    const LEG_HEIGHT_BASE = parseInt(document.getElementById('legHeightBase').value) || 200;
    const LEG_HEIGHT_DOWNWIND = parseInt(document.getElementById('legHeightDownwind').value) || 300;
    const baseHeight = Math.round(AppState.lastAltitude);

    const landingDirection = document.querySelector('input[name="landingDirection"]:checked')?.value || 'LL';
    const customLandingDirLL = parseInt(document.getElementById('customLandingDirectionLL')?.value, 10) || null;
    const customLandingDirRR = parseInt(document.getElementById('customLandingDirectionRR')?.value, 10) || null;

    const heights = interpolatedData.map(d => d.height);
    const dirs = interpolatedData.map(d => Number.isFinite(d.dir) ? parseFloat(d.dir) : 0);
    const spdsKt = interpolatedData.map(d => Utils.convertWind(parseFloat(d.spd) || 0, 'kt', 'km/h')); // km/h to kt
    const uComponents = spdsKt.map((spd, i) => -spd * Math.sin(dirs[i] * Math.PI / 180));
    const vComponents = spdsKt.map((spd, i) => -spd * Math.cos(dirs[i] * Math.PI / 180));

    let effectiveLandingWindDir;
    if (landingDirection === 'LL' && Number.isFinite(customLandingDirLL) && customLandingDirLL >= 0 && customLandingDirLL <= 359) {
        effectiveLandingWindDir = customLandingDirLL;
    } else if (landingDirection === 'RR' && Number.isFinite(customLandingDirRR) && customLandingDirRR >= 0 && customLandingDirRR <= 359) {
        effectiveLandingWindDir = customLandingDirRR;
    } else {
        // Only use calculated wind direction if no valid custom direction exists
        effectiveLandingWindDir = Number.isFinite(AppState.landingWindDir) ? AppState.landingWindDir : dirs[0];
    }

    if (!Number.isFinite(effectiveLandingWindDir)) {
        console.warn('Invalid landing wind direction:', effectiveLandingWindDir);
        return { downwindLat: lat, downwindLng: lng };
    }

    const calculateLegEndpoint = (startLat, startLng, bearing, groundSpeedKt, timeSec) => {
        const speedMps = groundSpeedKt * 0.514444; // kt to m/s
        const lengthMeters = speedMps * timeSec;
        const metersPerDegreeLat = 111000;
        const distanceDeg = lengthMeters / metersPerDegreeLat;
        const radBearing = bearing * Math.PI / 180;
        const deltaLat = distanceDeg * Math.cos(radBearing);
        const deltaLng = distanceDeg * Math.sin(radBearing) / Math.cos(startLat * Math.PI / 180);
        return [startLat + deltaLat, startLng + deltaLng];
    };

    // Final Leg
    const finalLimits = [baseHeight, baseHeight + LEG_HEIGHT_FINAL];
    const finalMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, ...finalLimits);
    const finalWindDir = finalMeanWind[0];
    const finalWindSpeedKt = finalMeanWind[1];
    const finalCourse = (effectiveLandingWindDir + 180) % 360;
    const finalWindAngle = Utils.calculateWindAngle(effectiveLandingWindDir, finalWindDir);
    const { crosswind: finalCrosswind, headwind: finalHeadwind } = Utils.calculateWindComponents(finalWindSpeedKt, finalWindAngle);
    const finalGroundSpeedKt = Utils.calculateGroundSpeed(CANOPY_SPEED_KT, finalHeadwind);
    const finalTime = LEG_HEIGHT_FINAL / DESCENT_RATE_MPS;
    const finalEnd = calculateLegEndpoint(lat, lng, finalCourse, finalGroundSpeedKt, finalTime);

    // Base Leg
    const baseLimits = [baseHeight + LEG_HEIGHT_FINAL, baseHeight + LEG_HEIGHT_BASE];
    const baseMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, ...baseLimits);
    const baseWindDir = baseMeanWind[0];
    const baseWindSpeedKt = baseMeanWind[1];
    const baseHeading = landingDirection === 'LL' ? (effectiveLandingWindDir + 90) % 360 : (effectiveLandingWindDir - 90 + 360) % 360;
    const baseCourse = Utils.calculateCourseFromHeading(baseHeading, baseWindDir, baseWindSpeedKt, CANOPY_SPEED_KT).trueCourse;
    const baseWindAngle = Utils.calculateWindAngle(baseCourse, baseWindDir);
    const { crosswind: baseCrosswind, headwind: baseHeadwind } = Utils.calculateWindComponents(baseWindSpeedKt, baseWindAngle);
    const baseGroundSpeedKt = CANOPY_SPEED_KT - baseHeadwind;
    const baseTime = (LEG_HEIGHT_BASE - LEG_HEIGHT_FINAL) / DESCENT_RATE_MPS;
    let baseBearing = (baseCourse + 180) % 360;
    if (baseGroundSpeedKt < 0) baseBearing = (baseBearing + 180) % 360;
    const baseEnd = calculateLegEndpoint(finalEnd[0], finalEnd[1], baseBearing, baseGroundSpeedKt, baseTime);

    // Downwind Leg
    const downwindLimits = [baseHeight + LEG_HEIGHT_BASE, baseHeight + LEG_HEIGHT_DOWNWIND];
    const downwindMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, ...downwindLimits);
    const downwindWindDir = downwindMeanWind[0];
    const downwindWindSpeedKt = downwindMeanWind[1];
    const downwindCourse = effectiveLandingWindDir;
    const downwindWindAngle = Utils.calculateWindAngle(downwindCourse, downwindWindDir);
    const { crosswind: downwindCrosswind, headwind: downwindHeadwind } = Utils.calculateWindComponents(downwindWindSpeedKt, downwindWindAngle);
    const downwindGroundSpeedKt = CANOPY_SPEED_KT + downwindHeadwind;
    const downwindTime = (LEG_HEIGHT_DOWNWIND - LEG_HEIGHT_BASE) / DESCENT_RATE_MPS;
    const downwindEnd = calculateLegEndpoint(baseEnd[0], baseEnd[1], downwindCourse, downwindGroundSpeedKt, downwindTime);

    return { downwindLat: downwindEnd[0], downwindLng: downwindEnd[1] };
}
export function updateLandingPattern() {
    console.log('updateLandingPattern called');
    if (!AppState.map) {
        console.warn('Map not initialized, cannot update landing pattern');
        return;
    }

    const currentZoom = AppState.map.getZoom();
    const isVisible = currentZoom >= Constants.landingPatternMinZoom; // e.g., 14
    console.log('Landing pattern zoom check:', { currentZoom, landingPatternMinZoom: Constants.landingPatternMinZoom, isVisible });

    // Clear existing layers
    const removeLayer = (layer, name) => {
        if (layer && AppState.map.hasLayer(layer)) {
            AppState.map.removeLayer(layer);
            console.log(`Removed ${name}`);
        }
    };
    removeLayer(AppState.landingPatternPolygon, 'landing pattern polygon');
    removeLayer(AppState.secondlandingPatternPolygon, 'second landing pattern polygon');
    removeLayer(AppState.thirdLandingPatternLine, 'third landing pattern line');
    removeLayer(AppState.finalArrow, 'final arrow');
    removeLayer(AppState.baseArrow, 'base arrow');
    removeLayer(AppState.downwindArrow, 'downwind arrow');
    AppState.landingPatternPolygon = null;
    AppState.secondlandingPatternPolygon = null;
    AppState.thirdLandingPatternLine = null;
    AppState.finalArrow = null;
    AppState.baseArrow = null;
    AppState.downwindArrow = null;

    if (!Settings.state.userSettings.showLandingPattern) {
        console.log('Landing pattern disabled, layers cleared');
        return;
    }

    if (!isVisible) {
        console.log('Landing pattern not displayed - zoom too low:', currentZoom);
        return;
    }

    if (!AppState.weatherData || !AppState.lastLat || !AppState.lastLng) {
        console.warn('Cannot render landing pattern: missing weather data or coordinates');
        return;
    }

    const showLandingPattern = document.getElementById('showLandingPattern').checked;
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

    // Remove existing layers
    [AppState.landingPatternPolygon, AppState.secondlandingPatternPolygon, AppState.thirdLandingPatternLine, AppState.finalArrow, AppState.baseArrow, AppState.downwindArrow].forEach(layer => {
        if (layer) {
            layer.remove();
            layer = null;
        }
    });

    if (!showLandingPattern || !AppState.weatherData || !AppState.weatherData.time || !AppState.currentMarker || sliderIndex >= AppState.weatherData.time.length) {
        console.log('Landing pattern not updated: missing data or not enabled');
        return;
    }

    const markerLatLng = AppState.currentMarker.getLatLng();
    const lat = markerLatLng.lat;
    const lng = markerLatLng.lng;
    const baseHeight = Math.round(AppState.lastAltitude);

    const interpolatedData = interpolateWeatherData(sliderIndex);
    if (!interpolatedData || interpolatedData.length === 0) {
        console.warn('No interpolated data available for landing pattern calculation');
        return;
    }

    // Convert wind speeds from km/h (Open-Meteo) to kt explicitly
    const heights = interpolatedData.map(d => d.height);
    const dirs = interpolatedData.map(d => Number.isFinite(d.dir) ? parseFloat(d.dir) : 0);
    const spdsKt = interpolatedData.map(d => Utils.convertWind(parseFloat(d.spd) || 0, 'kt', 'km/h')); // km/h to kt

    // Calculate U and V components in kt
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

    // Final Leg (0-100m AGL)
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

    AppState.landingPatternPolygon = L.polyline([[lat, lng], finalEnd], {
        color: 'red',
        weight: 3,
        opacity: 0.8,
        dashArray: '5, 10'
    }).addTo(AppState.map);

    // Add a fat blue arrow in the middle of the final leg pointing to landing direction
    const finalMidLat = (lat + finalEnd[0]) / 2;
    const finalMidLng = (lng + finalEnd[1]) / 2;
    const finalArrowBearing = (finalWindDir - 90 + 180) % 360; // Points in direction of the mean wind at final

    AppState.finalArrow = L.marker([finalMidLat, finalMidLng], {
        icon: createArrowIcon(finalMidLat, finalMidLng, finalArrowBearing, finalArrowColor)
    }).addTo(AppState.map);
    AppState.finalArrow.bindTooltip(`${Math.round(finalWindDir)}° ${formatWindSpeed(finalWindSpeedKt)}${getWindSpeedUnit()}`, {
        offset: [10, 0], // Slight offset to avoid overlap
        direction: 'right',
        className: 'wind-tooltip'
    });

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

    AppState.secondlandingPatternPolygon = L.polyline([finalEnd, baseEnd], {
        color: 'red',
        weight: 3,
        opacity: 0.8,
        dashArray: '5, 10'
    }).addTo(AppState.map);

    // Add a fat blue arrow in the middle of the base leg pointing to landing direction
    const baseMidLat = (finalEnd[0] + baseEnd[0]) / 2;
    const baseMidLng = (finalEnd[1] + baseEnd[1]) / 2;
    const baseArrowBearing = (baseWindDir - 90 + 180) % 360; // Points in direction of the mean wind at base

    AppState.baseArrow = L.marker([baseMidLat, baseMidLng], {
        icon: createArrowIcon(baseMidLat, baseMidLng, baseArrowBearing, baseArrowColor)
    }).addTo(AppState.map);
    AppState.baseArrow.bindTooltip(`${Math.round(baseWindDir)}° ${formatWindSpeed(baseWindSpeedKt)}${getWindSpeedUnit()}`, {
        offset: [10, 0],
        direction: 'right',
        className: 'wind-tooltip'
    });

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

    AppState.thirdLandingPatternLine = L.polyline([baseEnd, downwindEnd], {
        color: 'red',
        weight: 3,
        opacity: 0.8,
        dashArray: '5, 10'
    }).addTo(AppState.map);

    // Add a fat blue arrow in знак middle of the downwind leg pointing to landing direction
    const downwindMidLat = (baseEnd[0] + downwindEnd[0]) / 2;
    const downwindMidLng = (baseEnd[1] + downwindEnd[1]) / 2;
    const downwindArrowBearing = (downwindWindDir - 90 + 180) % 360; // Points in direction of the mean wind at downwind

    // Create a custom arrow icon using Leaflet’s DivIcon
    AppState.downwindArrow = L.marker([downwindMidLat, downwindMidLng], {
        icon: createArrowIcon(downwindMidLat, downwindMidLng, downwindArrowBearing, downwindArrowColor)
    }).addTo(AppState.map);
    AppState.downwindArrow.bindTooltip(`${Math.round(downwindWindDir)}° ${formatWindSpeed(downwindWindSpeedKt)}${getWindSpeedUnit()}`, {
        offset: [10, 0],
        direction: 'right',
        className: 'wind-tooltip'
    });

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

    //map.fitBounds([[lat, lng], finalEnd, baseEnd, downwindEnd], { padding: [50, 50] });
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
    const separation = getSeparationFromTAS(Settings.state.userSettings.aircraftSpeedKt);
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
                updateLandingPattern();
            }
            if (Settings.state.userSettings.calculateJump) {
                console.log('Recalculating jump for slider index:', sliderIndex);
                clearJumpCircles();
                calculateJump();
                calculateCutAway();
            }
            if (Settings.state.userSettings.showJumpRunTrack) {
                console.log('Updating jump run track for slider index:', sliderIndex);
                updateJumpRunTrack();
            }
            //recenterMap();
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
                    calculateCutAway();
                }
            }
            if (Settings.state.userSettings.showJumpRunTrack) {
                console.log('Updating JRT for model change');
                updateJumpRunTrack();
            }
            if (AppState.currentMarker) {
                console.log('Updating marker popup for model change');
                const wasOpen = AppState.currentMarker.getPopup()?.isOpen() || false;
                await updateMarkerPopup(AppState.currentMarker, AppState.lastLat, AppState.lastLng, AppState.lastAltitude, wasOpen);
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
            updateMarkerPopup(AppState.currentMarker, AppState.lastLat, AppState.lastLng, AppState.lastAltitude, AppState.currentMarker.getPopup()?.isOpen() || false);
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
            calculateCutAway();
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
                calculateCutAway();
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
                updateLandingPattern();
                recenterMap();
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
                updateLandingPattern();
                recenterMap();
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
                    updateJumpRunTrack();
                }
                if (Settings.state.userSettings.calculateJump) {
                    console.log('Recalculating jump for custom JRT direction');
                    debouncedCalculateJump(); // Use debounced version
                    calculateCutAway();
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
                setInputValueSilently('jumpRunTrackDirection', '');
            }
            if (AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                if (Settings.state.userSettings.showJumpRunTrack) {
                    console.log('Updating JRT for invalid direction input');
                    updateJumpRunTrack();
                }
                if (Settings.state.userSettings.calculateJump) {
                    console.log('Recalculating jump for reset JRT direction');
                    debouncedCalculateJump(); // Use debounced version
                    calculateCutAway();
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
                updateJumpRunTrack();
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
                updateJumpRunTrack();
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
                updateJumpRunTrack();
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
                updateJumpRunTrack();
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
                const separation = getSeparationFromTAS(speed);
                setInputValue('jumperSeparation', separation);
                Settings.state.userSettings.jumperSeparation = separation;
                Settings.save();
                console.log(`Auto-updated jumperSeparation to ${separation}s for IAS ${speed}kt`);
            }
            if (Settings.state.userSettings.calculateJump && AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                console.log('Recalculating jump for aircraft speed change');
                debouncedCalculateJump(); // Use debounced version
                calculateCutAway();
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
                calculateCutAway();
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
                calculateCutAway();
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
                calculateCutAway();
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
        recenterMap();
    });

    setupCheckbox('showExitAreaCheckbox', 'showExitArea', (checkbox) => {
        Settings.state.userSettings.showExitArea = checkbox.checked;
        Settings.save();
        checkbox.checked = Settings.state.userSettings.showExitArea;
        console.log('Show Exit Area set to:', Settings.state.userSettings.showExitArea);
        if (checkbox.checked && AppState.weatherData && AppState.lastLat && AppState.lastLng && Settings.state.isCalculateJumpUnlocked && Settings.state.userSettings.calculateJump) {
            const exitResult = calculateExitCircle();
            if (exitResult) {
                updateJumpCircle(
                    exitResult.darkGreenLat, exitResult.darkGreenLng,
                    exitResult.greenLat, exitResult.greenLng,
                    exitResult.darkGreenRadius, exitResult.greenRadius,
                    [], [], [], [],
                    0, 0, 0, 0,
                    exitResult.freeFallDirection, exitResult.freeFallDistance, exitResult.freeFallTime,
                    true, false
                );
            }
            calculateCutAway();
        } else {
            clearJumpCircles();
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
            const canopyResult = calculateCanopyCircles();
            if (canopyResult) {
                updateJumpCircle(
                    canopyResult.blueLat, canopyResult.blueLng,
                    canopyResult.redLat, canopyResult.redLng,
                    canopyResult.radius, canopyResult.radiusFull,
                    canopyResult.additionalBlueRadii, canopyResult.additionalBlueDisplacements,
                    canopyResult.additionalBlueDirections, canopyResult.additionalBlueUpperLimits,
                    canopyResult.displacement, canopyResult.displacementFull,
                    canopyResult.direction, canopyResult.directionFull,
                    canopyResult.freeFallDirection, canopyResult.freeFallDistance, canopyResult.freeFallTime,
                    false, true
                );
            }
            calculateCutAway();
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
                const trackData = jumpRunTrack();
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
            calculateCutAway();
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
                updateLandingPattern();
                recenterMap();
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
function setupCoordinateEvents() {
    Coordinates.initCoordStorage();

    // Define the move marker logic
    const moveMarker = async (lat, lng) => {
        try {
            AppState.lastLat = lat;
            AppState.lastLng = lng;
            AppState.lastAltitude = await Utils.getAltitude(lat, lng);
            console.log('Moving marker to:', { lat, lng });
            AppState.currentMarker = Utils.configureMarker(
                AppState.map,
                lat,
                lng,
                AppState.lastAltitude,
                false,
                createCustomMarker,
                attachMarkerDragend,
                updateMarkerPopup,
                AppState.currentMarker,
                (marker) => { AppState.currentMarker = marker; }
            );
            resetJumpRunDirection(true);
            Coordinates.addCoordToHistory(lat, lng);
            if (Settings.state.userSettings.calculateJump) {
                console.log('Recalculating jump for coordinate input');
                debouncedCalculateJump();
                calculateCutAway();
            }
            recenterMap(true);
            AppState.isManualPanning = false;
            await fetchWeatherForLocation(lat, lng);
        } catch (error) {
            console.error('Error moving marker:', error);
            Utils.handleError(error.message);
        }
    };

    // Set the move marker callback for coordinates.js
    Coordinates.setMoveMarkerCallback(moveMarker);

    // Initialize coordinate inputs
    const coordInputs = document.getElementById('coordInputs');
    if (coordInputs) {
        Coordinates.updateCoordInputs(Settings.state.userSettings.coordFormat, AppState.lastLat, AppState.lastLng);
    } else {
        console.warn('Coordinate inputs container (#coordInputs) not found');
    }

    // Attach event listener to move marker button
    const moveMarkerBtn = document.getElementById('moveMarkerBtn');
    if (moveMarkerBtn) {
        moveMarkerBtn.addEventListener('click', async () => {
            console.log('Move marker button clicked');
            try {
                const [lat, lng] = Coordinates.parseCoordinates();
                await moveMarker(lat, lng); // Use the same logic
            } catch (error) {
                console.error('Error moving marker:', error);
                Utils.handleError(error.message);
            }
        });
        console.log('Attached event listener to moveMarkerBtn');
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
            Settings.state.userSettings.calculateJump = true;
            Settings.save();
            toggleSubmenu(calculateJumpMenuItem, submenu, true);
            if (AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                debouncedCalculateJump();
                calculateCutAway();
            }
            calculateJumpMenuItem.style.opacity = '1';
            calculateJumpMenuItem.title = '';
        };
        const disableFeature = () => {
            Settings.state.userSettings.calculateJump = false;
            Settings.save();
            toggleSubmenu(calculateJumpMenuItem, submenu, false);
            clearJumpCircles();
            calculateJumpMenuItem.style.opacity = Settings.isFeatureUnlocked('calculateJump') ? '1' : '0.5';
            calculateJumpMenuItem.title = Settings.isFeatureUnlocked('calculateJump') ? '' : 'Feature locked. Click to enter password.';
        };
        if (!Settings.isFeatureUnlocked('calculateJump')) {
            Settings.showPasswordModal('calculateJump', enableFeature, () => {
                if (submenu) toggleSubmenu(calculateJumpMenuItem, submenu, false);
            });
        } else {
            if (submenu) {
                const isSubmenuHidden = submenu.classList.contains('hidden');
                if (isSubmenuHidden) enableFeature();
                else disableFeature();
            }
        }
    };
    calculateJumpMenuItem.addEventListener('click', calculateJumpMenuItem._clickHandler, { capture: true });
    console.log('Attached click handler to Calculate Jump menu item with capture phase');
}
function clearJumpCircles() {
    if (!AppState.map) {
        console.warn('Map not initialized, cannot clear jump circles');
        return;
    }

    console.log('Clearing all jump circles');
    const removeLayer = (layer, name) => {
        if (layer && typeof layer === 'object' && '_leaflet_id' in layer && AppState.map.hasLayer(layer)) {
            console.log(`Removing ${name}`);
            AppState.map.removeLayer(layer);
        } else if (layer) {
            console.warn(`Layer ${name} not removed: not on map or invalid`, { layer });
        }
    };

    removeLayer(AppState.jumpCircle, 'blue circle');
    removeLayer(AppState.jumpCircleFull, 'red circle');
    removeLayer(AppState.jumpCircleGreen, 'green circle');
    removeLayer(AppState.jumpCircleGreenLight, 'dark green circle');

    if (AppState.additionalBlueCircles) {
        AppState.additionalBlueCircles.forEach((circle, i) => removeLayer(circle, `additional blue circle ${i}`));
        AppState.additionalBlueCircles = [];
    }
    if (AppState.additionalBlueLabels) {
        AppState.additionalBlueLabels.forEach((label, i) => removeLayer(label, `additional blue label ${i}`));
        AppState.additionalBlueLabels = [];
    }

    AppState.jumpCircle = null;
    AppState.jumpCircleFull = null;
    AppState.jumpCircleGreen = null;
    AppState.jumpCircleGreenLight = null;
    console.log('All jump circles cleared', {
        blue: !!AppState.jumpCircle,
        red: !!AppState.jumpCircleFull,
        green: !!AppState.jumpCircleGreen,
        darkGreen: !!AppState.jumpCircleGreenLight,
        additionalBlueCircles: AppState.additionalBlueCircles?.length || 0,
        additionalBlueLabels: AppState.additionalBlueLabels?.length || 0
    });
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
            if (Settings.state.userSettings.showLandingPattern) updateLandingPattern();
            if (Settings.state.userSettings.calculateJump) {
                debouncedCalculateJump();
                calculateCutAway();
                if (Settings.state.userSettings.showJumpRunTrack) updateJumpRunTrack();
            }
            recenterMap();
        }
        updateLivePositionControl();
        // Update Jump Master Line distance unit if active
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
    } catch (error) {
        console.error('Error in updateAllDisplays:', error);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Initialize settings and UI
    initializeApp();
    Settings.initialize();
    initializeUIElements();
    initializeMap();

    // Setup event listeners
    setupMenuItemEvents();
    setupSliderEvents();
    setupModelSelectEvents();
    setupDownloadEvents();
    setupMenuEvents();
    setupRadioEvents();
    setupInputEvents();
    setupCheckboxEvents();
    setupCoordinateEvents();
    setupResetButton();
    setupResetCutAwayMarkerButton();
    setupClearHistoricalDate(); // Add this line
    setupTrackEvents(); // Add this line
    setupCacheManagement();
    setupCacheSettings({ map: AppState.map, lastLat: AppState.lastLat, lastLng: AppState.lastLng, baseMaps: AppState.baseMaps });
    setupAutoupdate(); // Add autoupdate setup
});