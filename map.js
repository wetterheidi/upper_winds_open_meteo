// map.js
import { Settings } from './settings.js';
import {
    configureMarker,
    fetchWeatherForLocation,
    cacheTilesForDIP,
    recenterMap,
    updateJumpRunTrack,
    updateJumpMasterLine,
    updateLandingPattern,
    updateMarkerPopup,
    calculateJump,
    calculateCutAway,
    resetJumpRunDirection,
    startPositionTracking,
    setCheckboxValue,
    getAltitude,
    updateOfflineIndicator,
    debouncedCacheVisibleTiles,
    createCutAwayMarker,
    attachCutAwayMarkerDragend,
    updateCutAwayMarkerPopup,
    generateWindBarb,
    initializeApp,
    getLastFullHourUTC,
    getCoordinateFormat,
    getHeightUnit,
    TileCache
} from './app.js';
import {
    decimalToMgrs,
    decimalToDms,
    convertHeight,
    formatLocalTime,
    handleError,
    handleMessage,
    roundToTens
} from './utils.js';

// Global variables (to be moved to state.js later)
let map;
let coordsControl;
let lastMouseLatLng;
let lastLat, lastLng, lastAltitude;
let baseMaps;
let livePositionControl;
let cutAwayMarker;
let currentMarker;
let jumpRunTrackLayer;
let isManualPanning = false;
let weatherData;
let landingWindDir;
let cutAwayLat, cutAwayLng;
let failedCount = 0; // For tileerror handling
let totalTiles = 0; // For tileerror handling
let hasSwitched = false; // For tileerror handling

// Custom Coordinates control
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

function setupMap() {
    console.log('Setting up map');
    const defaultCenter = [48.0179, 11.1923];
    const defaultZoom = 11;

    lastLat = lastLat || defaultCenter[0];
    lastLng = lastLng || defaultCenter[1];

    map = L.map('map', {
        center: defaultCenter,
        zoom: defaultZoom,
        zoomControl: false,
        doubleClickZoom: false,
        maxZoom: 19,
        minZoom: navigator.onLine ? 6 : 11
    });

    console.log('setupMap completed');
    return map;
}

function setupBaseMaps() {
    console.log('Setting up base maps');
    baseMaps = {
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
    map.attributionControl.addAttribution(openMeteoAttribution);

    const selectedBaseMap = Settings.state.userSettings.baseMaps in baseMaps ? Settings.state.userSettings.baseMaps : "Esri Street";
    const fallbackBaseMap = "OpenStreetMap";
    const layer = baseMaps[selectedBaseMap];

    layer.on('tileerror', () => {
        if (!navigator.onLine) {
            if (!hasSwitched) {
                console.warn(`${selectedBaseMap} tiles unavailable offline. Zoom restricted to levels 11–14.`);
                handleError('Offline: Zoom restricted to levels 11–14 for cached tiles.');
                hasSwitched = true;
            }
            return;
        }
        if (!hasSwitched && failedCount > totalTiles / 2) {
            console.warn(`${selectedBaseMap} tiles slow or unavailable, switching to ${fallbackBaseMap}`);
            if (map.hasLayer(layer)) {
                map.removeLayer(layer);
                baseMaps[fallbackBaseMap].addTo(map);
                Settings.state.userSettings.baseMaps = fallbackBaseMap;
                Settings.save();
                handleError(`${selectedBaseMap} tiles slow or unavailable. Switched to ${fallbackBaseMap}.`);
                hasSwitched = true;
            }
        } else {
            console.warn(`Tile error in ${selectedBaseMap}, attempting to continue`);
        }
    });

    layer.addTo(map);
    map.invalidateSize();
    console.log('setupBaseMaps completed');
}

function setupControls() {
    console.log('Setting up controls');
    L.control.layers(baseMaps, null, { position: 'topright' }).addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.control.polylineMeasure({
        position: 'topright',
        unit: 'kilometres',
        showBearings: true,
        clearMeasurementsOnStop: false,
        showClearControl: true,
        showUnitControl: true,
        tooltipTextFinish: 'Click to finish the line<br>',
        tooltipTextDelete: 'Shift-click to delete point',
        tooltipTextMove: 'Drag to move point<br>',
        tooltipTextResume: 'Click to resume line<br>',
        tooltipTextAdd: 'Click to add point<br>',
        measureControlTitleOn: 'Start measuring distance and bearing',
        measureControlTitleOff: 'Stop measuring'
    }).addTo(map);
    L.control.scale({
        position: 'bottomleft',
        metric: true,
        imperial: true,
        maxWidth: 100
    }).addTo(map);

    map.createPane('gpxTrackPane');
    map.getPane('gpxTrackPane').style.zIndex = 650;
    map.getPane('tooltipPane').style.zIndex = 700;
    map.getPane('popupPane').style.zIndex = 700;

    coordsControl = new L.Control.Coordinates();
    coordsControl.addTo(map);
    console.log('coordsControl initialized:', coordsControl);

    livePositionControl = L.control.livePosition({ position: 'bottomright' }).addTo(map);
    if (livePositionControl._container) {
        livePositionControl._container.style.display = 'none';
        console.log('Initialized livePositionControl and hid by default');
    } else {
        console.warn('livePositionControl._container not initialized');
    }
    console.log('setupControls completed');
}

function setupEventListeners() {
    console.log('Setting up event listeners');
    map.on('baselayerchange', (e) => {
        Settings.state.userSettings.baseMaps = e.name;
        Settings.save();
        console.log(`Base map changed to: ${e.name}`);
        if (lastLat && lastLng) {
            cacheTilesForDIP();
        }
    });

    map.on('moveend', () => {
        if (lastLat && lastLng) {
            debouncedCacheVisibleTiles();
        }
    });

    const elevationCache = new Map();
    const debouncedGetElevation = debounce(async (lat, lng, requestLatLng, callback) => {
        const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
        if (elevationCache.has(cacheKey)) {
            console.log('Using cached elevation:', { lat, lng, elevation: elevationCache.get(cacheKey) });
            callback(elevationCache.get(cacheKey), requestLatLng);
            return;
        }
        try {
            const elevation = await getAltitude(lat, lng);
            elevationCache.set(cacheKey, elevation);
            console.log('Fetched elevation:', { lat, lng, elevation });
            callback(elevation, requestLatLng);
        } catch (error) {
            console.warn('Failed to fetch elevation:', error);
            callback('N/A', requestLatLng);
        }
    }, 500);

    map.on('mousemove', (e) => {
        console.log('Map mousemove fired:', { lat: e.latlng.lat, lng: e.latlng.lng });
        const coordFormat = getCoordinateFormat();
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        lastMouseLatLng = { lat, lng };

        let coordText;
        if (coordFormat === 'MGRS') {
            const mgrs = decimalToMgrs(lat, lng);
            coordText = `MGRS: ${mgrs}`;
        } else if (coordFormat === 'DMS') {
            const latDMS = decimalToDms(lat, true);
            const lngDMS = decimalToDms(lng, false);
            coordText = `Lat: ${latDMS}, Lng: ${lngDMS}`;
        } else {
            coordText = `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;
        }

        coordsControl.update(`${coordText}<br>Elevation: Fetching...`);

        debouncedGetElevation(lat, lng, { lat, lng }, (elevation, requestLatLng) => {
            if (lastMouseLatLng) {
                const deltaLat = Math.abs(lastMouseLatLng.lat - requestLatLng.lat);
                const deltaLng = Math.abs(lastMouseLatLng.lng - requestLatLng.lng);
                const threshold = 0.05;
                if (deltaLat < threshold && deltaLng < threshold) {
                    const heightUnit = getHeightUnit();
                    let displayElevation = elevation === 'N/A' ? 'N/A' : elevation;
                    if (displayElevation !== 'N/A') {
                        displayElevation = convertHeight(displayElevation, heightUnit);
                        displayElevation = Math.round(displayElevation);
                    }
                    console.log('Updating elevation display:', { lat: requestLatLng.lat, lng: requestLatLng.lng, elevation, heightUnit, displayElevation });
                    coordsControl.update(`${coordText}<br>Elevation: ${displayElevation} ${displayElevation === 'N/A' ? '' : heightUnit}`);
                } else {
                    console.log('Discarded elevation update: mouse moved too far', {
                        requestLat: requestLatLng.lat,
                        requestLng: requestLatLng.lng,
                        currentLat: lastMouseLatLng.lat,
                        currentLng: lastMouseLatLng.lng
                    });
                }
            } else {
                console.warn('No lastMouseLatLng, skipping elevation update');
            }
        });
    });

    map.on('movestart', (e) => {
        if (!e.target.dragging || !e.target.dragging._marker) {
            isManualPanning = true;
            console.log('Manual panning detected, isManualPanning set to true');
        }
    });

    map.on('mouseout', () => {
        coordsControl.getContainer().innerHTML = 'Move mouse over map';
    });

    map.on('contextmenu', (e) => {
        if (!Settings.state.userSettings.showCutAwayFinder || !Settings.state.userSettings.calculateJump) {
            console.log('Cut-away marker placement ignored: showCutAwayFinder or calculateJump not enabled');
            return;
        }
        const { lat, lng } = e.latlng;
        console.log('Right-click: Placing/moving cut-away marker at:', { lat, lng });

        if (cutAwayMarker) {
            cutAwayMarker.setLatLng([lat, lng]);
        } else {
            cutAwayMarker = createCutAwayMarker(lat, lng).addTo(map);
            attachCutAwayMarkerDragend(cutAwayMarker);
            console.log('attachCutAwayMarkerDragend called for cut-away marker');
        }

        cutAwayLat = lat;
        cutAwayLng = lng;

        updateCutAwayMarkerPopup(cutAwayMarker, lat, lng);

        if (weatherData && Settings.state.userSettings.calculateJump) {
            console.log('Recalculating cut-away for marker placement');
            calculateCutAway();
        }
    });

    map.on('dblclick', async (e) => {
        const { lat, lng } = e.latlng;
        lastLat = lat;
        lastLng = lng;
        lastAltitude = await getAltitude(lat, lng);
        console.log('Map double-clicked, moving marker to:', { lat, lng });

        configureMarker(lastLat, lastLng, lastAltitude, false);
        resetJumpRunDirection(true);
        if (Settings.state.userSettings.calculateJump) {
            console.log('Recalculating jump for marker click');
            calculateJump();
            calculateCutAway();
        }
        recenterMap(true);
        isManualPanning = false;

        const slider = document.getElementById('timeSlider');
        const currentIndex = parseInt(slider.value) || 0;
        const currentTime = weatherData?.time?.[currentIndex] || null;

        await fetchWeatherForLocation(lat, lng, currentTime);

        if (Settings.state.userSettings.showJumpRunTrack) {
            console.log('Updating JRT after weather fetch for double-click');
            updateJumpRunTrack();
        }
        cacheTilesForDIP();

        if (Settings.state.userSettings.showJumpMasterLine && Settings.state.userSettings.trackPosition) {
            console.log('Updating Jump Master Line for double-click');
            updateJumpMasterLine();
        }
    });

    map.on('zoomend', () => {
        const currentZoom = map.getZoom();
        console.log('Zoom level changed to:', currentZoom);

        if (Settings.state.userSettings.calculateJump && weatherData && lastLat && lastLng) {
            console.log('Recalculating jump for zoom:', currentZoom);
            calculateJump();
        }

        if (Settings.state.userSettings.showJumpRunTrack) {
            console.log('Updating jump run track for zoom:', currentZoom);
            updateJumpRunTrack();
        }

        if (Settings.state.userSettings.showLandingPattern) {
            console.log('Updating landing pattern for zoom:', currentZoom);
            updateLandingPattern();
        }

        if (currentMarker && lastLat && lastLng) {
            currentMarker.setLatLng([lastLat, lastLng]);
            updateMarkerPopup(currentMarker, lastLat, lastLng, lastAltitude, currentMarker.getPopup()?.isOpen() || false);
        }

        if (jumpRunTrackLayer && Settings.state.userSettings.showJumpRunTrack) {
            const anchorMarker = jumpRunTrackLayer.getLayers().find(layer => layer.options.icon?.options.className === 'jrt-anchor-marker');
            if (anchorMarker) {
                const baseSize = currentZoom <= 11 ? 10 : currentZoom <= 12 ? 12 : currentZoom <= 13 ? 14 : 16;
                const newIcon = L.divIcon({
                    className: 'jrt-anchor-marker',
                    html: `<div style="background-color: orange; width: ${baseSize}px; height: ${baseSize}px; border-radius: 50%; border: 2px solid white; opacity: 0.8;"></div>`,
                    iconSize: [baseSize, baseSize],
                    iconAnchor: [baseSize / 2, baseSize / 2],
                    tooltipAnchor: [0, -(baseSize / 2 + 5)]
                });
                anchorMarker.setIcon(newIcon);
                console.log('Updated anchor marker size for zoom:', { zoom: currentZoom, size: baseSize });
            }
        }
    });

    let lastTapTime = 0;
    const tapThreshold = 300;
    const mapContainer = map.getContainer();

    mapContainer.addEventListener('touchstart', async (e) => {
        console.log('Map touchstart event, target:', e.target, 'touches:', e.touches.length);
        if (e.touches.length !== 1 || e.target.closest('.leaflet-marker-icon')) {
            console.log('Ignoring map touchstart: multiple touches or marker target');
            return;
        }

        const currentTime = new Date().getTime();
        const timeSinceLastTap = currentTime - lastTapTime;
        if (timeSinceLastTap < tapThreshold && timeSinceLastTap > 0) {
            e.preventDefault();
            const rect = mapContainer.getBoundingClientRect();
            const touchX = e.touches[0].clientX - rect.left;
            const touchY = e.touches[0].clientY - rect.top;
            const latlng = map.containerPointToLatLng([touchX, touchY]);
            const { lat, lng } = latlng;
            lastLat = lat;
            lastLng = lng;
            lastAltitude = await getAltitude(lat, lng);
            configureMarker(lastLat, lastLng, lastAltitude, false);
            resetJumpRunDirection(true);
            if (Settings.state.userSettings.calculateJump) {
                calculateJump();
                calculateCutAway();
            }
            recenterMap(true);
            isManualPanning = false;

            const slider = document.getElementById('timeSlider');
            const currentIndex = parseInt(slider.value) || 0;
            const currentTime = weatherData?.time?.[currentIndex] || null;
            await fetchWeatherForLocation(lastLat, lastLng, currentTime);
            cacheTilesForDIP();
            if (Settings.state.userSettings.showJumpMasterLine && Settings.state.userSettings.trackPosition) {
                console.log('Updating Jump Master Line for double-tap');
                updateJumpMasterLine();
            }
        }
        lastTapTime = currentTime;
    }, { passive: false });

    map.on('click', (e) => {
        console.log('Map click event, target:', e.originalEvent.target);
    });

    map.on('mousedown', (e) => {
        console.log('Map mousedown event, target:', e.originalEvent.target);
    });
    console.log('setupEventListeners completed');
}

async function setupGeolocation() {
    console.log('Setting up geolocation');
    const defaultCenter = [48.0179, 11.1923];
    const defaultZoom = 11;
    const initialAltitude = 'N/A';

    async function fetchInitialWeather(lat, lng) {
        const lastFullHourUTC = getLastFullHourUTC();
        let utcIsoString;
        try {
            utcIsoString = lastFullHourUTC.toISOString();
            console.log('initMap: Last full hour UTC:', utcIsoString);
        } catch (error) {
            console.error('Failed to get UTC time:', error);
            const now = new Date();
            now.setMinutes(0, 0, 0);
            utcIsoString = now.toISOString();
            console.log('initMap: Fallback to current time:', utcIsoString);
        }

        let initialTime;
        if (Settings.state.userSettings.timeZone === 'Z') {
            initialTime = utcIsoString.replace(':00.000Z', 'Z');
        } else {
            try {
                const localTimeStr = await formatLocalTime(utcIsoString, lat, lng);
                console.log('initMap: Local time string:', localTimeStr);
                const match = localTimeStr.match(/^(\d{4}-\d{2}-\d{2}) (\d{2})(\d{2}) GMT([+-]\d+)/);
                if (!match) {
                    throw new Error(`Local time string format mismatch: ${localTimeStr}`);
                }
                const [, datePart, hour, minute, offset] = match;
                const offsetSign = offset.startsWith('+') ? '+' : '-';
                const offsetHours = Math.abs(parseInt(offset, 10)).toString().padStart(2, '0');
                const formattedOffset = `${offsetSign}${offsetHours}:00`;
                const isoFormatted = `${datePart}T${hour}:${minute}:00${formattedOffset}`;
                console.log('initMap: ISO formatted local time:', isoFormatted);
                const localDate = new Date(isoFormatted);
                if (isNaN(localDate.getTime())) {
                    throw new Error(`Failed to parse localDate from ${isoFormatted}`);
                }
                const localDateUtc = localDate.toISOString();
                console.log('initMap: Local time in UTC:', localDateUtc);
                initialTime = localDateUtc.replace(':00.000Z', 'Z');
            } catch (error) {
                console.error('Error converting to local time:', error);
                initialTime = utcIsoString.replace(':00.000Z', 'Z');
                console.log('initMap: Falling back to UTC time:', initialTime);
            }
        }

        console.log('initMap: initialTime:', initialTime);
        await fetchWeatherForLocation(lat, lng, initialTime, true);
    }

    configureMarker(defaultCenter[0], defaultCenter[1], initialAltitude, false);
    isManualPanning = false;

 convertir
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const userCoords = [position.coords.latitude, position.coords.longitude];
                lastLat = position.coords.latitude;
                lastLng = position.coords.longitude;
                lastAltitude = await getAltitude(lastLat, lastLng);

                configureMarker(lastLat, lastLng, lastAltitude, false);
                map.setView(userCoords, defaultZoom);

                if (Settings.state.userSettings.calculateJump) {
                    calculateJump();
                    calculateCutAway();
                }
                recenterMap(true);
                isManualPanning = false;

                await fetchInitialWeather(lastLat, lastLng);

                if (Settings.state.userSettings.trackPosition) {
                    setCheckboxValue('trackPositionCheckbox', true);
                    startPositionTracking();
                }

                cacheTilesForDIP();
            },
            async (error) => {
                console.warn(`Geolocation error: ${error.message}`);
                handleError('Unable to retrieve your location. Using default location.');
                lastLat = defaultCenter[0];
                lastLng = defaultCenter[1];
                lastAltitude = await getAltitude(lastLat, lastLng);
                configureMarker(lastLat, lastLng, lastAltitude, false);
                map.setView(defaultCenter, defaultZoom);
                recenterMap(true);
                isManualPanning = false;

                await fetchInitialWeather(lastLat, lastLng);

                if (Settings.state.userSettings.trackPosition) {
                    handleError('Tracking disabled due to geolocation failure.');
                    setCheckboxValue('trackPositionCheckbox', false);
                    Settings.state.userSettings.trackPosition = false;
                    Settings.save();
                }

                cacheTilesForDIP();
            },
            {
                enableHighAccuracy: true,
                timeout: 20000,
                maximumAge: 0
            }
        );
    } else {
        console.warn('Geolocation not supported.');
        handleError('Geolocation not supported. Using default location.');
        lastLat = defaultCenter[0];
        lastLng = defaultCenter[1];
        lastAltitude = getAltitude(lastLat, lastLng);
        configureMarker(lastLat, lastLng, initialAltitude, false);
        map.setView(defaultCenter, defaultZoom);
        recenterMap(true);
        isManualPanning = false;

        await fetchInitialWeather(lastLat, lastLng);

        if (Settings.state.userSettings.trackPosition) {
            handleError('Tracking disabled: Geolocation not supported.');
            setCheckboxValue('trackPositionCheckbox', false);
            Settings.state.userSettings.trackPosition = false;
            Settings.save();
        }

        cacheTilesForDIP();
    }
    console.log('setupGeolocation completed');
}

function setupTileCaching() {
    console.log('Setting up tile caching');
    TileCache.init().then(() => {
        TileCache.migrateTiles().then(() => {
            TileCache.getCacheSize().then(size => {
                if (size > 500) {
                    TileCache.clearOldTiles(3).then(result => {
                        handleMessage(`Cleared ${result.deletedCount} old tiles to free up space: ${result.deletedSizeMB.toFixed(2)} MB freed.`);
                    }).catch(error => {
                        console.error('Failed to clear old tiles during init:', error);
                        handleError('Failed to clear old tiles during startup.');
                    });
                } else {
                    TileCache.clearOldTiles().then(() => {
                        cacheTilesForDIP();
                    }).catch(error => {
                        console.error('Failed to clear old tiles:', error);
                    });
                }
            }).catch(error => {
                console.error('Failed to get cache size during init:', error);
                TileCache.clearOldTiles().then(() => {
                    cacheTilesForDIP();
                }).catch(error => {
                    console.error('Failed to clear old tiles:', error);
                });
            });
        }).catch(error => {
            console.error('Failed to migrate tiles:', error);
            TileCache.clearOldTiles().then(() => {
                cacheTilesForDIP();
            }).catch(err => {
                console.error('Failed to clear old tiles:', err);
            });
        });
    }).catch(error => {
        console.error('Failed to initialize tile cache:', error);
        handleError('Tile caching unavailable.');
    });
    console.log('setupTileCaching completed');
}

function setupOnlineOfflineListeners() {
    console.log('Setting up online/offline listeners');
    window.addEventListener('online', () => {
        hasSwitched = false;
        map.options.minZoom = 10;
        console.log('Back online, restored minZoom to 10');
        updateOfflineIndicator();
    });

    window.addEventListener('offline', () => {
        updateOfflineIndicator();
    });

    map.on('zoomstart', (e) => {
        if (!navigator.onLine) {
            const targetZoom = e.target._zoom || map.getZoom();
            if (targetZoom < 11) {
                e.target._zoom = 11;
                map.setZoom(11);
                handleError('Offline: Zoom restricted to levels 11–14 for cached tiles.');
            } else if (targetZoom > 14) {
                e.target._zoom = 14;
                map.setZoom(14);
                handleError('Offline: Zoom restricted to levels 11–14 for cached tiles.');
            }
        }
    });
    console.log('setupOnlineOfflineListeners completed');
}

function setupHamburgerMenu() {
    console.log('Setting up hamburger menu');
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const menu = document.getElementById('menu');
    if (hamburgerBtn && menu) {
        hamburgerBtn.addEventListener('click', () => {
            console.log('Hamburger menu clicked, menu visibility toggled');
        });
    }
    console.log('setupHamburgerMenu completed');
}

function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

export function initMap() {
    console.log('Initializing map');
    setupMap();
    setupBaseMaps();
    setupControls();
    setupEventListeners();
    setupGeolocation();
    setupTileCaching();
    setupOnlineOfflineListeners();
    setupHamburgerMenu();
    updateOfflineIndicator();
    initializeApp();
    console.log('Map initialization completed');
}

// Export globals for other modules (temporary, until state.js)
export {
    map,
    coordsControl,
    lastMouseLatLng,
    lastLat,
    lastLng,
    lastAltitude,
    baseMaps,
    livePositionControl,
    cutAwayMarker,
    currentMarker,
    jumpRunTrackLayer,
    isManualPanning,
    weatherData,
    landingWindDir,
    cutAwayLat,
    cutAwayLng
};