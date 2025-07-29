// mapManager.js
"use strict";

import { AppState } from '../core/state.js';
import { Settings } from '../core/settings.js';
import { Utils } from '../core/utils.js';
import { TileCache } from '../core/tileCache.js';
import { updateOfflineIndicator, isMobileDevice } from './ui.js';
//import './public/vendor/Leaflet.PolylineMeasure.js'; // Pfad ggf. anpassen
import { UI_DEFAULTS, ICON_URLS, ENSEMBLE_VISUALIZATION } from '../core/constants.js'; // Importiere UI-Defaults
import { getCapacitor } from '../core/capacitor-adapter.js';

let lastTapTime = 0; // Add this line
let isRotatingJRT = false;
let initialJrtAngle = 0;
let initialJrtDirection = 0;

/**
 * Initialisiert die Leaflet-Karte und alle zugehörigen Komponenten.
 * Erstellt die Karteninstanz, richtet die Basiskarten (Tile-Layer),
 * Standard-Steuerelemente (Zoom, Maßstab etc.) und benutzerdefinierte Panes ein.
 * Startet ebenfalls die Logik für das Kachel-Caching und die Geolokalisierung.
 * @returns {Promise<L.Map>} Ein Promise, das zur fertigen Leaflet-Karteninstanz auflöst.
 */
export async function initializeMap() {
    console.log('MapManager: Starte Karteninitialisierung...');

    // Wir machen die interne initMap-Funktion ebenfalls async
    await initMap();

    console.log('MapManager: Karteninitialisierung abgeschlossen.');

    // Gib die fertige Karte zurück, als Bestätigung, dass alles bereit ist.
    return AppState.map;
}
async function initMap() {
    if (AppState.ismapInitialized || AppState.map) {
        console.warn('Map already initialized or init in progress.');
        return;
    }
    AppState.ismapInitialized = true;
    console.log('initMap started...');

    const defaultCenter = UI_DEFAULTS.DEFAULT_MAP_CENTER;
    const defaultZoom = UI_DEFAULTS.DEFAULT_MAP_ZOOM;
    const initialAltitude = 'N/A';

    _initializeBasicMapInstance(defaultCenter, defaultZoom);

    // Direkt nachdem die Karte erstellt wurde, erstellen wir unsere "Kiste" für alle Sprung-Visualisierungen.
    AppState.jumpVisualizationLayerGroup = L.layerGroup().addTo(AppState.map);
    AppState.landingPatternLayerGroup = L.layerGroup().addTo(AppState.map);
    AppState.jumpRunTrackLayerGroup = L.layerGroup().addTo(AppState.map);
    AppState.favoritesLayerGroup = L.layerGroup().addTo(AppState.map); // <-- NEUE ZEILE HINZUFÜGEN
    console.log('Favorite marker layer added!');
    AppState.poiLayerGroup = L.layerGroup().addTo(AppState.map); // <-- NEUE ZEILE HINZUFÜGEN
    console.log('POI marker layer added!');

    _setupBaseLayersAndHandling();
    _addStandardMapControls();
    _setupCustomPanes();
    _initializeLivePositionControl();
    _initializeDefaultMarker(defaultCenter, initialAltitude);

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

// HILFSFUNKTIONEN FÜR initMap
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
                zIndex: 1
            }),
            L.tileLayer.cached('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
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
                if (!AppState.hasTileErrorSwitched) {
                    console.warn(`${selectedBaseMapName} tiles unavailable offline. Zoom restricted.`);
                    Utils.handleMessage('Offline: Zoom restricted to levels 11–14 for cached tiles.');
                    AppState.hasTileErrorSwitched = true;
                }
                return;
            }
            if (!AppState.hasTileErrorSwitched && AppState.map.hasLayer(activeLayer)) {
                const fallbackBaseMapName = "OpenStreetMap";
                console.warn(`${selectedBaseMapName} tiles unavailable, switching to ${fallbackBaseMapName}`);
                AppState.map.removeLayer(activeLayer);
                AppState.baseMaps[fallbackBaseMapName].addTo(AppState.map);
                Settings.state.userSettings.baseMaps = fallbackBaseMapName;
                Settings.save();
                Utils.handleMessage(`${selectedBaseMapName} tiles unavailable. Switched to ${fallbackBaseMapName}.`);
                AppState.hasTileErrorSwitched = true;
            } else if (!AppState.hasTileErrorSwitched) {
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
        AppState.hasTileErrorSwitched = false;
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
        if (Settings && Settings.state && Settings.state.userSettings) {
            Settings.state.userSettings.baseMaps = e.name;
            Settings.save();
        }
        AppState.hasTileErrorSwitched = false;
        if (AppState.lastLat && AppState.lastLng && typeof cacheTilesForDIP === 'function') {
            cacheTilesForDIP({ map: AppState.map, lastLat: AppState.lastLat, lastLng: AppState.lastLng, baseMaps: AppState.baseMaps });
        }
    });

    L.control.zoom({ position: 'topright' }).addTo(AppState.map);

    L.control.scale({
        position: 'bottomleft',
        metric: true,
        imperial: false,
        maxWidth: 100
    }).addTo(AppState.map);

    // Jetzt, wo die Ladereihenfolge stimmt, ist dies der saubere und richtige Weg:
    AppState.map.pm.addControls({
        position: 'topright',
        drawMarker: true,
        drawCircleMarker: false,
        drawPolyline: true,
        drawPolygon: false,
        drawRectangle: false,
        drawCircle: true,
        cutPolygon: false,
        editMode: true,
        dragMode: true,
        removalMode: true,
        rotateMode: false
    });

    AppState.map.pm.setLang('en');

    // Wir prüfen, ob wir auf einem Mobilgerät sind.
    if (isMobileDevice()) {
        // Setze globale Geoman-Optionen, um die "Geisterlinie" unsichtbar zu machen.
        AppState.map.pm.setGlobalOptions({
            hintlineStyle: { opacity: 0, color: 'green' }  // Die Linie vom letzten Punkt zum Mauszeiger/Fadenkreuz
        });
        console.log("Geoman global options set for mobile to hide helper lines.");
    }

    console.log('Standard map controls including Geoman have been added.');
}
function _setupCustomPanes() {
    AppState.map.createPane('gpxTrackPane');
    AppState.map.getPane('gpxTrackPane').style.zIndex = 650;
    AppState.map.getPane('tooltipPane').style.zIndex = 700;
    AppState.map.getPane('popupPane').style.zIndex = 700;
    console.log('Custom map panes created.');
}
function _initializeLivePositionControl() {
    // Erstelle das Control mit der neuen Definition
    AppState.livePositionControl = new LivePositionControl({ position: 'bottomright' }).addTo(AppState.map);
    console.log('Initialized livePositionControl and hid by default');
}
async function _initializeDefaultMarker(defaultCenter, initialAltitude) {
    console.log("MapManager: Initialisiere den Standard-Marker...");
    await createOrUpdateMarker(defaultCenter[0], defaultCenter[1]);
    AppState.isManualPanning = false;
    console.log('Default marker initialized using the new standard method.');
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
    const { latitude, longitude } = position.coords;
    console.log('MapManager: Geolocation erfolgreich. Sende Event.');

    // 1. Aktualisiere die Marker-Position (das ist eine UI-Aufgabe des Managers)
    // Dieser Teil kann hier bleiben.
    AppState.lastLat = latitude;
    AppState.lastLng = longitude;
    AppState.lastAltitude = await Utils.getAltitude(latitude, longitude);
    moveMarker(latitude, longitude); // Einfach den Namen der Funktion aufrufen.
    AppState.map.setView([latitude, longitude], defaultZoom);

    // 2. Erstelle und sende das Event.
    const mapSelectEvent = new CustomEvent('location:selected', {
        detail: {
            lat: latitude,
            lng: longitude,
            source: 'geolocation' // Wichtige Info über die Herkunft
        },
        bubbles: true,
        cancelable: true
    });
    AppState.map.getContainer().dispatchEvent(mapSelectEvent);

    // 3. ALLE Anwendungslogik-Aufrufe wie calculateJump() und LocationManager.addCoordToHistory() werden hier GELÖSCHT.
}
async function _geolocationErrorCallback(error, defaultCenter, defaultZoom) {
    console.warn(`Geolocation error: ${error.message}`);
    Utils.handleMessage('Unable to retrieve your location. Using default location.');

    // 1. Setzt den Marker auf den Standardort
    await createOrUpdateMarker(defaultCenter[0], defaultCenter[1]);
    AppState.map.setView(defaultCenter, defaultZoom);
    recenterMap(true);
    AppState.isManualPanning = false;

    // 2. Löst das Event aus, damit die App weitermachen kann
    const mapSelectEvent = new CustomEvent('location:selected', {
        detail: {
            lat: defaultCenter[0],
            lng: defaultCenter[1],
            source: 'geolocation_fallback'
        },
        bubbles: true,
        cancelable: true
    });
    AppState.map.getContainer().dispatchEvent(mapSelectEvent);
    console.log("Dispatched 'location:selected' event from geolocation fallback.");
}

async function _handleGeolocation(defaultCenter, defaultZoom) {
    console.log('[MapManager] Starting geolocation handling at', new Date().toISOString());
    try {
        // Hole die Module über den Adapter
        const { Geolocation, isNative } = await getCapacitor();

        if (isNative && Geolocation) {
            // Prüfe den Berechtigungsstatus
            console.log('[MapManager] Checking geolocation permissions...');
            let permissionStatus = await Geolocation.checkPermissions();
            console.log('[MapManager] Permission status:', JSON.stringify(permissionStatus));

            let hasPermission = permissionStatus.location === 'granted' || permissionStatus.location === 'provisional';
            if (!hasPermission) {
                console.log('[MapManager] Requesting geolocation permissions...');
                try {
                    const result = await Geolocation.requestPermissions({ permissions: ['location'] });
                    hasPermission = result.location === 'granted' || result.location === 'provisional';
                    console.log('[MapManager] Permission request result:', JSON.stringify(result));

                    if (!hasPermission) {
                        console.warn('[MapManager] Geolocation permission denied or not granted:', result);
                        Utils.handleMessage('Bitte erlaube den Standortzugriff in den Einstellungen, um deine aktuelle Position zu verwenden.');
                        throw new Error(`Geolocation permission not granted: ${JSON.stringify(result)}`);
                    } else if (result.location === 'provisional') {
                        console.log('[MapManager] Provisional permission granted. Prompting user to share location...');
                        Utils.handleMessage('Bitte teile deinen Standort, um die Karte mit deiner Position zu laden.');
                    }
                } catch (permError) {
                    console.error('[MapManager] Error requesting permissions:', permError);
                    throw permError;
                }
            }

            // Versuche, die aktuelle Position abzurufen
            console.log('[MapManager] Attempting to fetch current position...');
            let position = null;
            let attempts = 0;
            const maxAttempts = 3;
            while (!position && attempts < maxAttempts) {
                try {
                    console.log(`[MapManager] Attempt ${attempts + 1} to fetch current position...`);
                    position = await Geolocation.getCurrentPosition({
                        enableHighAccuracy: true,
                        timeout: 20000, // Erhöhtes Timeout für iOS 18.5
                        maximumAge: 0
                    });
                    console.log('[MapManager] Current position retrieved:', JSON.stringify(position.coords));
                    await _geolocationSuccessCallback(position, defaultZoom);
                } catch (error) {
                    console.error('[MapManager] Error fetching position on attempt', attempts + 1, ':', error.message);
                    attempts++;
                    if (attempts < maxAttempts && permissionStatus.location === 'provisional') {
                        console.log('[MapManager] Retrying due to provisional permission...');
                        Utils.handleMessage('Standortfreigabe erforderlich. Bitte teile deinen Standort.');
                        await new Promise(resolve => setTimeout(resolve, 3000)); // Warte 3 Sekunden
                    } else {
                        throw error;
                    }
                }
            }
        } else if (navigator.geolocation) {
            // Fallback zur Web-API
            console.log('[MapManager] Using browser geolocation API...');
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    console.log('[MapManager] Browser position retrieved:', JSON.stringify(position.coords));
                    _geolocationSuccessCallback(position, defaultZoom);
                },
                (geoError) => {
                    console.error('[MapManager] Browser geolocation error:', geoError.message);
                    _geolocationErrorCallback(geoError, defaultCenter, defaultZoom);
                },
                { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
            );
        } else {
            console.warn('[MapManager] No geolocation API available.');
            Utils.handleMessage('Standortzugriff nicht verfügbar. Verwende Standardposition.');
            await _geolocationErrorCallback({ message: 'Geolocation not available' }, defaultCenter, defaultZoom);
        }
    } catch (error) {
        console.error('[MapManager] Error during geolocation handling:', error.message);
        Utils.handleMessage('Fehler beim Abrufen des Standorts. Verwende Standardposition.');
        await _geolocationErrorCallback(error, defaultCenter, defaultZoom);
    }
}

function _setupGeomanMeasurementHandlers() {
    const map = AppState.map;
    if (!map) {
        console.log('No map available');
        return;
    }

    console.log('Leaflet-Geoman Version:', L.PM.version);

    // Stop click propagation on the Geoman toolbar to prevent map clicks
    const geomanToolbar = document.querySelector('.leaflet-pm-toolbar');
    if (geomanToolbar) {
        // Eine Liste aller Events, die potenziell zur Karte durchsickern könnten.
        const eventsToStop = ['click', 'dblclick', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'pointerdown', 'pointerup', 'contextmenu'];

        eventsToStop.forEach(eventType => {
            geomanToolbar.addEventListener(eventType, (e) => {
                L.DomEvent.stopPropagation(e);
                // Optional: Zum Debuggen in der Konsole anzeigen, welches Event gestoppt wurde
                console.log(`Stopped '${e.type}' event on Geoman toolbar.`);
            });
        });
    }

    const liveMeasureLabel = L.DomUtil.create('div', 'leaflet-measure-label', map.getContainer());
    const persistentLabelsGroup = L.layerGroup().addTo(map);

    let lastKnownLatLngs = null;
    let lastKnownCircleState = null;
    let currentLayer = null;
    let isDrawingCompleted = false; // Flag to track if drawing was completed or cancelled

    // Helper function for permanent line labels
    function createPermanentLineLabel(latlngs, index) {
        const currentPoint = latlngs[index];
        const prevPoint = index > 0 ? latlngs[index - 1] : null;
        if (!prevPoint) return;

        const nextPoint = index < latlngs.length - 1 ? latlngs[index + 1] : null;
        const inBearing = Utils.calculateBearing(prevPoint.lat, prevPoint.lng, currentPoint.lat, currentPoint.lng);
        const segmentDistance = prevPoint.distanceTo(currentPoint);
        const segmentDistanceText = segmentDistance < 1000 ? `${segmentDistance.toFixed(0)} m` : `${(segmentDistance / 1000).toFixed(2)} km`;

        let totalDistance = 0;
        for (let i = 1; i <= index; i++) {
            totalDistance += latlngs[i - 1].distanceTo(latlngs[i]);
        }
        const totalDistanceText = totalDistance < 1000 ? `${totalDistance.toFixed(0)} m` : `${(totalDistance / 1000).toFixed(2)} km`;

        const outBearingText = nextPoint ? `${Utils.calculateBearing(currentPoint.lat, currentPoint.lng, nextPoint.lat, nextPoint.lng).toFixed(0)}°` : '---';

        const labelContent = `
            <div class="geoman-permanent-label">
                <div>In: ${inBearing.toFixed(0)}°</div>
                <div>Out: ${outBearingText}</div>
                <div>+: ${segmentDistanceText}</div>
                <div>∑: ${totalDistanceText}</div>
            </div>
        `;

        const marker = L.marker(currentPoint, {
            icon: L.divIcon({ className: 'geoman-label-container', html: labelContent, iconAnchor: [-5, -5] }),
            pmIgnore: true
        });
        marker.addTo(persistentLabelsGroup);
    }

    // Helper function for permanent circle labels
    function createPermanentCircleLabel(layer) {
        const center = layer.getLatLng();
        const radius = layer.getRadius();
        const radiusText = radius < 1000 ? `${radius.toFixed(0)} m` : `${(radius / 1000).toFixed(2)} km`;
        const labelContent = `<div class="geoman-permanent-label">Radius:<br> ${radiusText}</div>`;
        const label = L.marker(center, {
            icon: L.divIcon({ className: 'geoman-label-container', html: labelContent, iconAnchor: [0, 0] }),
            pmIgnore: true
        });
        label.addTo(persistentLabelsGroup);
        layer.permanentLabel = label;
    }

    function updateAllPermanentLineLabels(layer) {
        if (!layer || !(layer instanceof L.Polyline)) return;
        persistentLabelsGroup.clearLayers();
        const latlngs = layer.getLatLngs();
        if (Array.isArray(latlngs[0])) {
            latlngs.forEach((subLatlngs) => {
                subLatlngs.forEach((_, index) => createPermanentLineLabel(subLatlngs, index));
            });
        } else {
            latlngs.forEach((_, index) => createPermanentLineLabel(latlngs, index));
        }
        lastKnownLatLngs = JSON.stringify(latlngs);
        currentLayer = layer;
    }

    function updateCircleLabel(layer) {
        if (!layer || !(layer instanceof L.Circle)) return;
        if (layer.permanentLabel) {
            persistentLabelsGroup.removeLayer(layer.permanentLabel);
        }
        createPermanentCircleLabel(layer);
    }

    function startPolling() {
        setInterval(() => {
            if (currentLayer) {
                if (currentLayer instanceof L.Polyline) {
                    const currentLatLngs = JSON.stringify(currentLayer.getLatLngs());
                    if (currentLatLngs !== lastKnownLatLngs) {
                        updateAllPermanentLineLabels(currentLayer);
                    }
                } else if (currentLayer instanceof L.Circle) {
                    const currentState = JSON.stringify({
                        center: currentLayer.getLatLng(),
                        radius: currentLayer.getRadius()
                    });
                    if (currentState !== lastKnownCircleState) {
                        updateCircleLabel(currentLayer);
                        lastKnownCircleState = currentState;
                    }
                }
            }
        }, 500);
    }

    startPolling();

    map.on('pm:drawstart', (e) => {
        isDrawingCompleted = false; // Reset the flag at the start of any drawing action
        const workingLayer = e.workingLayer;
        persistentLabelsGroup.clearLayers();
        liveMeasureLabel.style.display = 'block';

        let mouseMoveHandler, vertexAddHandler, vertexRemoveHandler, mapMoveHandler, cleanup;

        if (e.shape === 'Line') {
            if (isMobileDevice()) {
                liveMeasureLabel.innerHTML = 'Tap to set first point.';
                let lastPoint = null;
                let rubberBandLayer = null;

                mapMoveHandler = () => {
                    const latlngs = workingLayer.getLatLngs();
                    if (latlngs.length > 0) {
                        lastPoint = latlngs[latlngs.length - 1];
                        const currentCenter = map.getCenter();

                        if (rubberBandLayer) {
                            map.removeLayer(rubberBandLayer);
                        }
                        rubberBandLayer = L.polyline([lastPoint, currentCenter], {
                            color: ' #3388ff',
                            dashArray: '5, 5',
                            weight: 3,
                            interactive: false
                        }).addTo(map);

                        const distance = lastPoint.distanceTo(currentCenter);
                        const bearing = Utils.calculateBearing(lastPoint.lat, lastPoint.lng, currentCenter.lat, currentCenter.lng);
                        const distanceText = distance < 1000 ? `${distance.toFixed(0)} m` : `${(distance / 1000).toFixed(2)} km`;

                        liveMeasureLabel.innerHTML = `In: ${bearing.toFixed(0)}°<br>Out: ---°<br>+: ${distanceText}`;
                        const mapSize = map.getSize();
                        const labelPos = L.point(mapSize.x / 2 + 20, mapSize.y / 2 - 40);
                        L.DomUtil.setPosition(liveMeasureLabel, labelPos);
                    } else {
                        // If there are no points, clear the rubber band
                        if (rubberBandLayer) {
                            map.removeLayer(rubberBandLayer);
                            rubberBandLayer = null;
                        }
                        liveMeasureLabel.innerHTML = 'Tap to set first point.';
                    }
                };

                vertexAddHandler = () => {
                    if (rubberBandLayer) {
                        map.removeLayer(rubberBandLayer);
                        rubberBandLayer = null;
                    }
                    setTimeout(() => {
                        updateAllPermanentLineLabels(workingLayer);
                        map.fire('move');
                    }, 50);
                };

                vertexRemoveHandler = () => {
                    setTimeout(() => {
                        updateAllPermanentLineLabels(workingLayer);
                        // Trigger the move handler to update the rubber band and label
                        map.fire('move');
                    }, 50);
                };

                map.on('move', mapMoveHandler);
                workingLayer.on('pm:vertexadded', vertexAddHandler);
                workingLayer.on('pm:vertexremoved', vertexRemoveHandler);

                cleanup = () => {
                    map.off('move', mapMoveHandler);
                    workingLayer.off('pm:vertexadded', vertexAddHandler);
                    workingLayer.off('pm:vertexremoved', vertexRemoveHandler);
                    if (rubberBandLayer) {
                        map.removeLayer(rubberBandLayer);
                        rubberBandLayer = null;
                    }
                };
            } else {
                liveMeasureLabel.innerHTML = 'Click to set the first point.';
                mouseMoveHandler = (moveEvent) => {
                    const latlngs = workingLayer.getLatLngs();
                    if (latlngs.length > 0) {
                        const lastPoint = latlngs[latlngs.length - 1];
                        const distance = lastPoint.distanceTo(moveEvent.latlng);
                        const bearing = Utils.calculateBearing(lastPoint.lat, lastPoint.lng, moveEvent.latlng.lat, moveEvent.latlng.lng);
                        const distanceText = distance < 1000 ? `${distance.toFixed(0)} m` : `${(distance / 1000).toFixed(2)} km`;
                        liveMeasureLabel.innerHTML = `In: ${bearing.toFixed(0)}°<br>Out: ---°<br>+: ${distanceText}`;
                        L.DomUtil.setPosition(liveMeasureLabel, moveEvent.containerPoint.add([15, -15]));
                    }
                };

                vertexAddHandler = () => {
                    setTimeout(() => updateAllPermanentLineLabels(workingLayer), 50);
                };

                vertexRemoveHandler = () => {
                    setTimeout(() => {
                        updateAllPermanentLineLabels(workingLayer);
                    }, 50);
                };

                map.on('mousemove', mouseMoveHandler);
                workingLayer.on('pm:vertexadded', vertexAddHandler);
                workingLayer.on('pm:vertexremoved', vertexRemoveHandler);

                cleanup = () => {
                    map.off('mousemove', mouseMoveHandler);
                    workingLayer.off('pm:vertexadded', vertexAddHandler);
                    workingLayer.off('pm:vertexremoved', vertexRemoveHandler);
                };
            }
        } else if (e.shape === 'Circle') {
            if (isMobileDevice()) {
                liveMeasureLabel.innerHTML = '';
                // Position label at map center initially
                const mapSize = map.getSize();
                const initialLabelPos = L.point(mapSize.x / 2, mapSize.y / 2 - 40);
                L.DomUtil.setPosition(liveMeasureLabel, initialLabelPos);
                let centerSet = false;

                mapMoveHandler = () => {
                    if (centerSet) {
                        const center = workingLayer.getLatLng();
                        if (center) {
                            const crosshairPos = map.getCenter();
                            const radius = center.distanceTo(crosshairPos);
                            workingLayer.setRadius(radius);

                            const radiusText = radius < 1000 ? `${radius.toFixed(0)} m` : `${(radius / 1000).toFixed(2)} km`;
                            liveMeasureLabel.innerHTML = `Radius: ${radiusText}`;
                            const mapSize = map.getSize();
                            const labelPos = L.point(mapSize.x / 2, mapSize.y / 2 - 40);
                            L.DomUtil.setPosition(liveMeasureLabel, labelPos);
                        }
                    }
                };

                vertexAddHandler = () => {
                    if (!centerSet) {
                        centerSet = true;
                        liveMeasureLabel.innerHTML = 'Move map to adjust radius. Tap again to finish.';
                        const mapSize = map.getSize();
                        const labelPos = L.point(mapSize.x / 2, mapSize.y / 2 - 40);
                        L.DomUtil.setPosition(liveMeasureLabel, labelPos);
                        map.on('move', mapMoveHandler);
                    } else {
                        // Second tap: finalize radius
                        finalize();
                        updateCircleLabel(workingLayer);
                        currentLayer = workingLayer;
                        lastKnownCircleState = JSON.stringify({
                            center: workingLayer.getLatLng(),
                            radius: workingLayer.getRadius()
                        });
                    }
                };

                workingLayer.on('pm:vertexadded', vertexAddHandler);

                cleanup = () => {
                    map.off('move', mapMoveHandler);
                    workingLayer.off('pm:vertexadded', vertexAddHandler);
                    centerSet = false;
                    liveMeasureLabel.style.display = 'none';
                };
            } else {
                liveMeasureLabel.innerHTML = 'Click and drag to draw a circle.';
                mouseMoveHandler = (moveEvent) => {
                    const center = workingLayer.getLatLng();
                    if (center) {
                        const radius = center.distanceTo(moveEvent.latlng);
                        const radiusText = radius < 1000 ? `${radius.toFixed(0)} m` : `${(radius / 1000).toFixed(2)} km`;
                        liveMeasureLabel.innerHTML = `Radius: ${radiusText}`;
                        L.DomUtil.setPosition(liveMeasureLabel, moveEvent.containerPoint.add([15, -15]));
                    }
                };
                map.on('mousemove', mouseMoveHandler);
                cleanup = () => map.off('mousemove', mouseMoveHandler);
            }
        }

        const finalize = () => {
            if (cleanup) cleanup();
            liveMeasureLabel.style.display = 'none';
        };

        map.once('pm:create', (createEvent) => {
            isDrawingCompleted = true; // Mark the drawing as successfully completed
            finalize();
            if (createEvent.shape === 'Line' && createEvent.layer instanceof L.Polyline) {
                updateAllPermanentLineLabels(createEvent.layer);
            } else if (createEvent.shape === 'Circle' && createEvent.layer instanceof L.Circle) {
                updateCircleLabel(createEvent.layer);
                currentLayer = createEvent.layer;
                lastKnownCircleState = JSON.stringify({
                    center: createEvent.layer.getLatLng(),
                    radius: createEvent.layer.getRadius()
                });
            }
            if (createEvent.layer.pm) {
                createEvent.layer.pm.enable();
            }
        });

        map.once('pm:drawend', () => {
            // If drawend fires but create did not, the action was cancelled.
            if (!isDrawingCompleted) {
                console.log("Drawing was cancelled, cleaning up visuals.");
                finalize(); // This will execute our cleanup function.
                persistentLabelsGroup.clearLayers(); // Also clear any permanent labels.
            }
        });
    });

    map.on('pm:edit', (e) => {
        if (e.shape === 'Line' && e.layer instanceof L.Polyline) {
            setTimeout(() => updateAllPermanentLineLabels(e.layer), 300);
        } else if (e.shape === 'Circle' && e.layer instanceof L.Circle) {
            // Update live label during dragging
            if (isMobileDevice()) {
                liveMeasureLabel.style.display = 'block';
                const radius = e.layer.getRadius();
                const radiusText = radius < 1000 ? `${radius.toFixed(0)} m` : `${(radius / 1000).toFixed(2)} km`;
                liveMeasureLabel.innerHTML = `Radius: ${radiusText}`;
                const mapSize = map.getSize();
                const labelPos = L.point(mapSize.x / 2, mapSize.y / 2 - 40);
                L.DomUtil.setPosition(liveMeasureLabel, labelPos);
            }
            setTimeout(() => {
                updateCircleLabel(e.layer);
                currentLayer = e.layer;
                lastKnownCircleState = JSON.stringify({
                    center: e.layer.getLatLng(),
                    radius: e.layer.getRadius()
                });
            }, 300);
        }
    });

    map.on('pm:editend', () => {
        if (isMobileDevice()) {
            liveMeasureLabel.style.display = 'none';
        }
    });

    map.on('pm:remove', (e) => {
        persistentLabelsGroup.clearLayers();
        lastKnownCircleState = null;
        lastKnownLatLngs = null;
        currentLayer = null;
        liveMeasureLabel.style.display = 'none';
    });
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
export function updateCoordsDisplay(text) {
    // AppState.coordsControl wurde in _initializeCoordsControlAndHandlers erstellt.
    if (AppState.coordsControl) {
        AppState.coordsControl.update(text);
    }
}
// Die einzelnen komplexen Event-Handler
function _handleMapMouseMove(e) {
    const { lat, lng } = e.latlng;

    // Erstelle ein Event mit den rohen Koordinaten
    const mouseMoveEvent = new CustomEvent('map:mousemove', {
        detail: { lat, lng },
        bubbles: true,
        cancelable: true
    });

    // Sende das Event
    AppState.map.getContainer().dispatchEvent(mouseMoveEvent);
}
function _setupCoreMapEventHandlers() {
    if (!AppState.map) {
        console.error("Karte nicht initialisiert in _setupCoreMapEventHandlers");
        return;
    }

    // A. Das Control wird jetzt immer hier erstellt, egal für welchen Modus.
    if (!AppState.coordsControl) {
        // WICHTIG: Deaktivieren der Standard-Handler des Plugins.
        // Wir steuern die Updates jetzt zu 100% selbst.
        const coordOptions = {
            enableUserInput: false
        };
        AppState.coordsControl = new L.Control.Coordinates(coordOptions);
        AppState.coordsControl.addTo(AppState.map);
    }

    // B. Die zentrale Entscheidung: Fadenkreuz oder Maus?
    if (isMobileDevice()) {
        _setupCrosshairCoordinateHandler(AppState.map);
    } else {
        _setupMouseCoordinateHandler(AppState.map);
    }

    // Die restlichen Event-Handler bleiben für beide Plattformen aktiv.
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

        // HIER IST DIE ÄNDERUNG:
        // Der Manager ruft KEINE Anwendungslogik mehr auf.
        // Stattdessen sendet er ein Event und meldet, dass der Zoom sich geändert hat.
        const zoomEvent = new CustomEvent('map:zoomend', {
            detail: { zoom: currentZoom },
            bubbles: true,
            cancelable: true
        });
        AppState.map.getContainer().dispatchEvent(zoomEvent);

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

        // Update heatmap radius on zoomend to adjust dynamically
        if (AppState.heatmapLayer) {
            const newRadius = Utils.calculateDynamicRadius(ENSEMBLE_VISUALIZATION.HEATMAP_BASE_RADIUS, ENSEMBLE_VISUALIZATION.HEATMAP_REFERENCE_ZOOM);
            AppState.heatmapLayer.setOptions({ radius: newRadius });
            console.log('Heatmap radius updated on zoom:', {
                currentZoom: AppState.map.getZoom(),
                newRadius
            });
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

    let longPressTimeout;

    // Standard contextmenu für Android und Desktop
    AppState.map.on('contextmenu', (e) => {
        const { lat, lng } = e.latlng;
        console.log('MapManager: Standard-Rechtsklick/Langes Drücken erkannt.');
        const mapSelectEvent = new CustomEvent('location:selected', {
            detail: { lat, lng, source: 'contextmenu' },
            bubbles: true,
            cancelable: true
        });
        AppState.map.getContainer().dispatchEvent(mapSelectEvent);
    });

    // Manuelle Erkennung für langes Drücken für iOS
    const mapContainer = AppState.map.getContainer();
    mapContainer.addEventListener('touchstart', (e) => {
        // Ignoriere, wenn mehr als ein Finger auf dem Bildschirm ist
        if (e.touches.length > 1) {
            clearTimeout(longPressTimeout);
            return;
        }
        
        // Starte den Timer für langes Drücken
        longPressTimeout = setTimeout(() => {
            // Verhindere das Auslösen des normalen "click"-Events
            e.preventDefault();

            // KORREKTUR: Hole die Koordinaten relativ zum Karten-Container
            const rect = mapContainer.getBoundingClientRect();
            const touch = e.touches[0];
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            const latlng = AppState.map.containerPointToLatLng([x, y]);
            
            console.log('MapManager: Manuelles langes Drücken (iOS) erkannt.');
            const mapSelectEvent = new CustomEvent('location:selected', {
                detail: { lat: latlng.lat, lng: latlng.lng, source: 'longpress_ios' },
                bubbles: true,
                cancelable: true
            });
            AppState.map.getContainer().dispatchEvent(mapSelectEvent);

        }, 500); // 500ms für langes Drücken
    }, { passive: false });

    mapContainer.addEventListener('touchend', () => {
        // Stoppe den Timer, wenn der Finger angehoben wird
        clearTimeout(longPressTimeout);
    });

    mapContainer.addEventListener('touchmove', () => {
        // Stoppe den Timer, wenn der Finger bewegt wird
        clearTimeout(longPressTimeout);
    });

    // Optionale, einfache Click/Mousedown-Handler (falls benötigt)
    AppState.map.on('click', (e) => {
        // console.log('Map click event, target:', e.originalEvent.target);
        // Z.B. um Popups zu schließen oder andere UI-Interaktionen zu steuern.
        // Achte darauf, dass dies nicht mit dem Doppelklick/Doppel-Tipp kollidiert.
    });
    AppState.map.on('mousedown', (e) => {
        // console.log('Map mousedown event, target:', e.originalEvent.target);
    });

    // --- START: Add Double-Tap/Touch Functionality ---
    mapContainer.addEventListener('touchstart', async (e) => {
        if (e.touches.length !== 1 || e.target.closest('.leaflet-marker-icon')) return; // Ignore Multi-Touch or taps on markers
        const currentTime = new Date().getTime();
        const timeSinceLastTap = currentTime - lastTapTime;
        const tapThreshold = 300; // Milliseconds
        if (timeSinceLastTap < tapThreshold && timeSinceLastTap > 0) {
            e.preventDefault(); // Prevent default zoom on double-tap
            const rect = mapContainer.getBoundingClientRect();
            const touchX = e.touches[0].clientX - rect.left;
            const touchY = e.touches[0].clientY - rect.top;
            const latlng = AppState.map.containerPointToLatLng([touchX, touchY]);

            await _handleMapDblClick({ latlng: latlng, containerPoint: L.point(touchX, touchY), layerPoint: AppState.map.latLngToLayerPoint(latlng) });
        }
        lastTapTime = currentTime; // Update the time of the last tap
    }, { passive: false }); // passive: false is required to allow preventDefault
    // --- END: Add Double-Tap/Touch Functionality ---

    _setupGeomanMeasurementHandlers();
    console.log('All core map event handlers have been set up.');
}
function _setupCrosshairCoordinateHandler(map) {
    const handleMapMove = () => {
        const center = map.getCenter();
        const coordFormat = Settings.getValue('coordFormat', 'Decimal');
        const coords = Utils.convertCoords(center.lat, center.lng, coordFormat);
        const coordString = (coordFormat === 'MGRS') ? `MGRS: ${coords.lat}` : `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`;

        // UI sofort mit "Fetching..." aktualisieren
        AppState.coordsControl.update(`${coordString}<br>Elevation: ...<br>QFE: ...`);

        // Die neue Funktion aus utils.js aufrufen
        Utils.debouncedGetElevationAndQFE(center.lat, center.lng, ({ elevation }) => {
            // Dieser Callback wird ausgeführt, sobald die Höhe verfügbar ist.
            const currentCenter = map.getCenter();
            if (Math.abs(currentCenter.lat - center.lat) > 0.0001 || Math.abs(currentCenter.lng - center.lng) > 0.0001) {
                return; // Verhindert Update, wenn sich die Karte inzwischen weiterbewegt hat
            }

            const heightUnit = Settings.getValue('heightUnit', 'm');
            let displayElevation = 'N/A';
            if (elevation !== 'N/A') {
                const convertedElevation = Utils.convertHeight(elevation, heightUnit);
                displayElevation = Math.round(convertedElevation);
            }
            const altString = displayElevation === 'N/A' ? 'N/A' : `${displayElevation}${heightUnit}`;

            // QFE-Berechnung findet jetzt hier statt
            let qfeString = 'N/A';
            if (elevation !== 'N/A' && AppState.weatherData && AppState.weatherData.surface_pressure) {
                const sliderIndex = parseInt(document.getElementById('timeSlider')?.value) || 0;
                const surfacePressure = AppState.weatherData.surface_pressure[sliderIndex];
                const temperature = AppState.weatherData.temperature_2m?.[sliderIndex] || 15;
                const referenceElevation = AppState.lastAltitude !== 'N/A' ? AppState.lastAltitude : 0;
                const qfe = Utils.calculateQFE(surfacePressure, elevation, referenceElevation, temperature);
                qfeString = qfe !== 'N/A' ? `${qfe.toFixed(0)}hPa` : 'N/A';
            }

            const displayText = `${coordString}<br>Elevation: ${altString}<br>QFE: ${qfeString}`;
            AppState.coordsControl.update(displayText);
        });
    };

    map.on('move', handleMapMove);
    // Ersten Aufruf auslösen, um die initiale Anzeige zu füllen
    setTimeout(() => map.fire('move'), 200);
    console.log('Crosshair coordinate handler initialized.');
}
function _setupMouseCoordinateHandler(map) {
    map.on('mousemove', _handleMapMouseMove);
    map.on('mouseout', function () {
        if (AppState.coordsControl && AppState.coordsControl.getContainer()) {
            AppState.coordsControl.getContainer().innerHTML = 'Move mouse over map';
        }
    });
    console.log('Mouse coordinate handler initialized.');
}

// Die einzelnen komplexen Event-Handler
function _handleMapDblClick(e) {
    // Diese Funktion platziert jetzt den Cut-Away-Marker
    if (!Settings.state.userSettings.showCutAwayFinder) {
        return;
    }
    const { lat, lng } = e.latlng;

    // Erstellt oder bewegt den Cut-Away-Marker
    if (AppState.cutAwayMarker) {
        AppState.cutAwayMarker.setLatLng([lat, lng]);
    } else {
        AppState.cutAwayMarker = createCutAwayMarker(lat, lng).addTo(AppState.map);
        attachCutAwayMarkerDragend(AppState.cutAwayMarker);
    }

    // Speichert die Position und löst die Neuberechnung aus
    AppState.cutAwayLat = lat;
    AppState.cutAwayLng = lng;
    updateCutAwayMarkerPopup(AppState.cutAwayMarker, lat, lng);

    const cutawayEvent = new CustomEvent('cutaway:marker_placed', {
        bubbles: true
    });
    AppState.map.getContainer().dispatchEvent(cutawayEvent);
}

/**
 * Zeichnet alle Visualisierungen für den Sprungablauf (Exit- und Canopy-Bereiche) auf die Karte.
 * Löscht zuvor alle alten Visualisierungen, um eine saubere Anzeige zu gewährleisten.
 * @param {object|null} jumpData - Ein Objekt, das die "Bauanleitungen" für alle zu zeichnenden Kreise und Labels enthält, oder null, um die Anzeige zu löschen.
 * @returns {void}
 */
export function drawJumpVisualization(jumpData) {
    // 1. Immer alles sauber machen.
    clearJumpVisualization(); // Umbenannt von clearJumpCircles für Klarheit

    // Entferne den alten Zoom-Listener, bevor neue Labels gezeichnet werden.
    if (AppState.labelZoomListener && AppState.map) {
        AppState.map.off('zoomend', AppState.labelZoomListener);
        AppState.labelZoomListener = null;
    }

    if (!jumpData || !AppState.jumpVisualizationLayerGroup) {
        return;
    }

    const labelsToUpdate = []; // Sammelt alle Labels für den Zoom-Listener

    // Zeichne Exit-Kreise
    if (jumpData.exitCircles) {
        jumpData.exitCircles.forEach(circleInfo => {
            const circleLayer = L.circle(circleInfo.center, {
                radius: circleInfo.radius,
                color: circleInfo.color,
                fillColor: circleInfo.fillColor,
                fillOpacity: circleInfo.fillOpacity,
                weight: circleInfo.weight || 2,
                pmIgnore: true
            }).addTo(AppState.jumpVisualizationLayerGroup);

            // NEU: Wenn eine Tooltip-Information vorhanden ist, binde sie.
            if (circleInfo.tooltip) {
                circleLayer.bindTooltip(circleInfo.tooltip, {
                    direction: 'top',
                    offset: [0, 0],
                    className: 'wind-tooltip'
                });
            }
        });
    }

    // Zeichne Canopy-Kreise
    if (jumpData.canopyCircles) {
        jumpData.canopyCircles.forEach(circleInfo => {
            // Fügen Sie die Option dem zweiten Argument von L.circle hinzu
            L.circle(circleInfo.center, {
                ...circleInfo, // Übernimmt alle bestehenden Optionen
                pmIgnore: true
            }).addTo(AppState.jumpVisualizationLayerGroup);
        });
    }

    // Helferfunktion zum Positionieren der Labels (aus deinem alten Code übernommen)
    function calculateLabelAnchor(center, radius) {
        const centerLatLng = L.latLng(center[0], center[1]);
        const earthRadius = 6378137;
        const deltaLat = (radius / earthRadius) * (180 / Math.PI);
        const topEdgeLatLng = L.latLng(center[0] + deltaLat, center[1]);
        const centerPoint = AppState.map.latLngToLayerPoint(centerLatLng);
        const topEdgePoint = AppState.map.latLngToLayerPoint(topEdgeLatLng);
        const offsetY = centerPoint.y - topEdgePoint.y + 10;
        return [25, offsetY];
    }

    // Zeichne Canopy-Labels mit dynamischem Styling
    if (jumpData.canopyLabels) {
        const currentZoom = AppState.map.getZoom();

        jumpData.canopyLabels.forEach(labelInfo => {
            const isSmall = currentZoom <= 11;
            const labelMarker = L.marker(labelInfo.center, {
                icon: L.divIcon({
                    className: `isoline-label ${isSmall ? 'isoline-label-small' : 'isoline-label-large'}`,
                    html: `<span style="font-size: ${isSmall ? '8px' : '10px'}">${labelInfo.text}</span>`,
                    iconSize: isSmall ? [50, 12] : [60, 14],
                    iconAnchor: calculateLabelAnchor(labelInfo.center, labelInfo.radius),
                    pmIgnore: true
                }),
                zIndexOffset: 2100 // Stellt sicher, dass Labels oben liegen
            }).addTo(AppState.jumpVisualizationLayerGroup);

            // Speichere die notwendigen Infos für das spätere Update
            labelsToUpdate.push({
                marker: labelMarker,
                center: labelInfo.center,
                radius: labelInfo.radius,
                text: labelInfo.text,
                pmIgnore: true
            });
        });
    }

    // Erstelle einen neuen Zoom-Listener, der alle gerade erstellten Labels kennt.
    if (labelsToUpdate.length > 0) {
        AppState.labelZoomListener = function () {
            const currentZoom = AppState.map.getZoom();
            const isSmall = currentZoom <= 11;
            labelsToUpdate.forEach(item => {
                item.marker.setIcon(L.divIcon({
                    className: `isoline-label ${isSmall ? 'isoline-label-small' : 'isoline-label-large'}`,
                    html: `<span style="font-size: ${isSmall ? '8px' : '10px'}">${item.text}</span>`,
                    iconSize: isSmall ? [50, 12] : [60, 14],
                    iconAnchor: calculateLabelAnchor(item.center, item.radius)
                }));
            });
        };
        AppState.map.on('zoomend', AppState.labelZoomListener);
    }
}
function clearJumpVisualization() {
    if (AppState.map && AppState.jumpVisualizationLayerGroup) {
        AppState.map.removeLayer(AppState.jumpVisualizationLayerGroup);
    }
    AppState.jumpVisualizationLayerGroup = L.layerGroup().addTo(AppState.map);
}
function clearJumpCircles() {
    // Greift auf die LayerGroup zu, die wir in initializeMap erstellt haben.
    if (AppState.jumpVisualizationLayerGroup) {
        AppState.jumpVisualizationLayerGroup.clearLayers();
    }
}
function clearLandingPattern() {
    if (AppState.landingPatternLayerGroup) {
        AppState.landingPatternLayerGroup.clearLayers();
    }
}
/**
 * Zeichnet das Landemuster (Downwind, Base, Final) auf die Karte.
 * Nimmt die berechneten Pfade und Pfeilpositionen entgegen und fügt sie
 * einer dedizierten Layer-Gruppe hinzu.
 * @param {object|null} patternData - Ein Objekt, das die Pfade und Pfeil-Informationen für das Muster enthält, oder null, um das Muster zu löschen.
 * @returns {void}
 */
export function drawLandingPattern(patternData) {
    // 1. Immer zuerst alles sauber machen.
    clearLandingPattern();

    // 2. Wenn es keine Anleitung gibt, sind wir fertig.
    if (!patternData) {
        return;
    }

    // 3. Zeichne die Linien des Musters.
    patternData.legs.forEach(leg => {
        L.polyline(leg.path, {
            color: 'red',
            weight: 3,
            opacity: 0.8,
            dashArray: '5, 10',
            pmIgnore: true
        }).addTo(AppState.landingPatternLayerGroup); // Fügt es zur LayerGroup hinzu
    });

    // 4. Zeichne die Pfeile.
    patternData.arrows.forEach(arrow => {
        // Die Funktion createArrowIcon muss auch hier im mapManager sein.
        const arrowIcon = createArrowIcon(arrow.position[0], arrow.position[1], arrow.bearing, arrow.color);

        const arrowMarker = L.marker(arrow.position, { icon: arrowIcon, pmIgnore: true })
            .addTo(AppState.landingPatternLayerGroup); // Fügt es zur LayerGroup hinzu

        arrowMarker.bindTooltip(arrow.tooltipText, {
            offset: [10, 0],
            direction: 'right',
            className: 'wind-tooltip',
            pmIgnore: true
        });
    });
}
function createArrowIcon(lat, lng, bearing, color) {
    // Ihr bestehender Code für createArrowIcon...
    const normalizedBearing = (bearing + 360) % 360;
    const arrowSvg = `
        <svg width="40" height="20" viewBox="0 0 40 20" xmlns="http://www.w3.org/2000/svg">
            <line x1="0" y1="10" x2="30" y2="10" stroke="${color}" stroke-width="4" />
            <polygon points="30,5 40,10 30,15" fill="${color}" />
        </svg>
    `;
    return L.divIcon({
        html: `<div style="transform: rotate(${normalizedBearing}deg); ...">${arrowSvg}</div>`,
        className: 'wind-arrow-icon',
        iconSize: [40, 20],
        iconAnchor: [20, 10]
    });
}
function clearJumpRunTrack() {
    if (AppState.map && AppState.jumpRunTrackLayerGroup) {
        AppState.map.removeLayer(AppState.jumpRunTrackLayerGroup);
    }
    AppState.jumpRunTrackLayerGroup = L.layerGroup().addTo(AppState.map);
}
export function createCutAwayMarker(lat, lng) {
    const cutAwayIcon = L.icon({
        iconUrl: ICON_URLS.CUTAWAY_MARKER, // Du benötigst dieses Bild im Projektverzeichnis
        iconSize: [25, 25],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12],
        pmIgnore: true
        //shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        //shadowSize: [41, 41],
        //shadowAnchor: [13, 41]
    });
    return L.marker([lat, lng], {
        icon: cutAwayIcon,
        draggable: true,
        pmIgnore: true
    });
}
export function attachCutAwayMarkerDragend(marker) {
    marker.on('dragend', (e) => {
        const position = marker.getLatLng();
        AppState.cutAwayLat = position.lat;
        AppState.cutAwayLng = position.lng;
        console.log('Cut-away marker dragged to:', { lat: AppState.cutAwayLat, lng: AppState.cutAwayLng });

        // Popup aktualisieren und Neuberechnung anstoßen
        updateCutAwayMarkerPopup(marker, AppState.cutAwayLat, AppState.cutAwayLng);
        const cutawayEvent = new CustomEvent('cutaway:marker_placed', { bubbles: true });
        AppState.map.getContainer().dispatchEvent(cutawayEvent);
    });
}
export function updateCutAwayMarkerPopup(marker, lat, lng, open = false) {
    const coordFormat = Settings.getValue('coordFormat', 'Decimal');
    const coords = Utils.convertCoords(lat, lng, coordFormat);
    let popupContent = `<b>Cut-Away Start</b><br>`;

    if (coordFormat === 'MGRS') {
        popupContent += `MGRS: ${coords.lat}`;
    } else {
        // Nutzt die korrekte Formatierung auch hier
        const formatDMS = (dms) => `${dms.deg}°${dms.min}'${dms.sec.toFixed(0)}" ${dms.dir}`;
        if (coordFormat === 'DMS') {
            popupContent += `Lat: ${formatDMS(Utils.decimalToDms(lat, true))}<br>Lng: ${formatDMS(Utils.decimalToDms(lng, false))}`;
        } else {
            popupContent += `Lat: ${lat.toFixed(5)}<br>Lng: ${lng.toFixed(5)}`;
        }
    }

    // Ruft die zentrale Funktion zum Aktualisieren von Popups auf
    updatePopupContent(marker, popupContent, open);
}
// 1. Eine Funktion, die den Marker und den Kreis zeichnet.
export function drawCutAwayVisualization(data) {
    // Zuerst immer den alten Kreis löschen.
    if (AppState.cutAwayCircle) {
        AppState.map.removeLayer(AppState.cutAwayCircle);
        AppState.cutAwayCircle = null;
    }

    // Wenn keine neuen Daten da sind, sind wir fertig.
    if (!data) return;

    // Zeichne den neuen Kreis mit den übergebenen Daten.
    AppState.cutAwayCircle = L.circle(data.center, {
        radius: data.radius,
        color: 'purple',
        fillColor: 'purple',
        fillOpacity: 0.2,
        weight: 2,
        pmIgnore: true
    }).addTo(AppState.map);

    AppState.cutAwayCircle.bindTooltip(data.tooltipContent, {
        permanent: false,
        direction: 'center',
        className: 'cutaway-tooltip'
    });
}
// 2. Eine Funktion, die den Marker (die Schere) löscht.
export function clearCutAwayMarker() {
    if (AppState.cutAwayMarker) {
        AppState.map.removeLayer(AppState.cutAwayMarker);
        AppState.cutAwayMarker = null;
    }
    // Lösche auch den Kreis, wenn der Marker entfernt wird.
    drawCutAwayVisualization(null);
}

/**
 * Zeichnet den kompletten Absetzanflug (Jump Run Track) inklusive des Anflugpfades auf die Karte.
 * Erstellt eine verschiebbare Visualisierung mit einem Flugzeug-Marker am Ende des Tracks,
 * dessen Verschiebung die Offsets neu berechnet.
 * @param {object|null} trackData - Ein Objekt mit allen Daten für den Anflug oder null, um den Track zu löschen.
 * @returns {void}
 */
export function drawJumpRunTrack(trackData) {
    clearJumpRunTrack();

    if (!AppState.jumpRunTrackLayerGroup) {
        console.error('drawJumpRunTrack called before jumpRunTrackLayerGroup was initialized.');
        return;
    }
    if (!trackData) {
        // Dies ist der normale Weg, um den Track zu löschen.
        // clearJumpRunTrack() wurde bereits aufgerufen, also beenden wir die Funktion hier einfach.
        return;
    }

    // Validierung der Eingangsdaten
    if (!trackData.path?.latlngs?.length || !trackData.airplane?.position) {
        console.warn('Invalid trackData structure:', trackData);
        return;
    }

    const trackPolyline = L.polyline(trackData.path.latlngs, trackData.path.options)
        .bindTooltip(trackData.path.tooltipText)
        .addTo(AppState.jumpRunTrackLayerGroup);

    let approachPolyline = null;
    if (trackData.approachPath?.latlngs) {
        approachPolyline = L.polyline(trackData.approachPath.latlngs, trackData.approachPath.options)
            .bindTooltip(trackData.approachPath.tooltipText)
            .addTo(AppState.jumpRunTrackLayerGroup);
    }

    const airplaneIcon = L.icon({
        iconUrl: ICON_URLS.AIRPLANE_MARKER,
        iconSize: [32, 32], iconAnchor: [16, 16],
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        shadowSize: [41, 41], shadowAnchor: [13, 32]
    });

    const airplaneMarker = L.marker(trackData.airplane.position, {
        icon: airplaneIcon,
        rotationAngle: trackData.airplane.bearing,
        rotationOrigin: 'center center',
        draggable: true,
        zIndexOffset: 2000,
        pmIgnore: true
    })
        .bindTooltip('Drag to move Jump Run Track')
        .addTo(AppState.jumpRunTrackLayerGroup);

    airplaneMarker.on('mousedown', () => AppState.map.dragging.disable());
    airplaneMarker.on('mouseup', () => AppState.map.dragging.enable());

    airplaneMarker.on('drag', (e) => {
        const newPos = e.target.getLatLng();
        // Validierung von originalPosition
        const originalPos = trackData.airplane.originalPosition;
        if (!originalPos || !Number.isFinite(originalPos.lat) || !Number.isFinite(originalPos.lng)) {
            console.warn('Invalid originalPosition:', originalPos);
            return;
        }

        const deltaLat = newPos.lat - originalPos.lat;
        const deltaLng = newPos.lng - originalPos.lng;

        // Validierung von delta-Werten
        if (!Number.isFinite(deltaLat) || !Number.isFinite(deltaLng)) {
            console.warn('Invalid delta values:', { deltaLat, deltaLng });
            return;
        }

        const newTrackLatLngs = trackData.path.originalLatLngs.map(ll => [
            Number.isFinite(ll[0]) ? ll[0] + deltaLat : ll[0],
            Number.isFinite(ll[1]) ? ll[1] + deltaLng : ll[1]
        ]);
        trackPolyline.setLatLngs(newTrackLatLngs);

        if (approachPolyline && trackData.approachPath?.originalLatLngs) {
            const newApproachLatLngs = trackData.approachPath.originalLatLngs.map(ll => [
                Number.isFinite(ll[0]) ? ll[0] + deltaLat : ll[0],
                Number.isFinite(ll[1]) ? ll[1] + deltaLng : ll[1]
            ]);
            approachPolyline.setLatLngs(newApproachLatLngs);
        }
    });

    airplaneMarker.on('dragend', (e) => {
        const newPos = e.target.getLatLng();
        if (!Number.isFinite(newPos.lat) || !Number.isFinite(newPos.lng)) {
            console.warn('Invalid new position in dragend:', newPos);
            return;
        }
        const dragEndEvent = new CustomEvent('track:dragend', {
            detail: { newPosition: newPos, originalTrackData: trackData },
            bubbles: true
        });
        AppState.map.getContainer().dispatchEvent(dragEndEvent);
    });
}

// Weitere exportierte Funktionen zum Steuern der Karte von außen
export function moveMarker(lat, lng) {
    // ... Logik zum Bewegen des Markers ...
}

/**
 * Erstellt einen neuen Hauptmarker (DIP) oder aktualisiert die Position eines bestehenden Markers.
 * Dies ist die zentrale Funktion, um den primären Auswahlpunkt auf der Karte zu setzen.
 * Aktualisiert auch das zugehörige Popup mit den aktuellen Standortdaten.
 * @param {number} lat - Die geographische Breite des Markers.
 * @param {number} lng - Die geographische Länge des Markers.
 * @returns {Promise<void>}
 */
export async function createOrUpdateMarker(lat, lng) {
    console.log("MapManager: Befehl erhalten, Marker zu erstellen/bewegen bei", lat, lng);
    if (typeof lat !== 'number' || typeof lng !== 'number' || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        console.error("MapManager: Ungültige Koordinaten:", { lat, lng });
        return;
    }
    const altitude = await Utils.getAltitude(lat, lng);
    if (AppState.currentMarker) {
        console.log("MapManager: Marker existiert, bewege ihn jetzt mit setLatLng.");
        AppState.currentMarker.setLatLng([lat, lng]);
    } else {
        console.log("MapManager: Kein Marker vorhanden, erstelle einen neuen.");
        const newMarker = createCustomMarker(lat, lng);
        attachMarkerDragend(newMarker);
        newMarker.on('click', () => {
            const position = newMarker.getLatLng();
            const mapSelectEvent = new CustomEvent('location:selected', {
                detail: { lat: position.lat, lng: position.lng, source: 'marker_click' },
                bubbles: true,
                cancelable: true
            });
            AppState.map.getContainer().dispatchEvent(mapSelectEvent);
        });
        AppState.currentMarker = newMarker;
        AppState.currentMarker.addTo(AppState.map);
    }

    const popupContent = `Lat: ${lat.toFixed(5)}<br>Lng: ${lng.toFixed(5)}<br>Alt: ${altitude} m`;
    updatePopupContent(AppState.currentMarker, popupContent);

    AppState.lastLat = lat;
    AppState.lastLng = lng;
    AppState.lastAltitude = altitude;
    // Remove invalidateSize to prevent layout recalculation
    // AppState.map.invalidateSize();
}

// Private Helferfunktion: Erstellt nur den Marker.
export function createCustomMarker(lat, lng) {
    const customIcon = L.icon({
        iconUrl: ICON_URLS.DEFAULT_MARKER,
        iconSize: [32, 32],
        iconAnchor: [16, 20],
        popupAnchor: [0, -32],
        pmIgnore: true
        //shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        //shadowSize: [41, 41], shadowAnchor: [13, 32]
    });
    return L.marker([lat, lng], { icon: customIcon, draggable: true, pmIgnore: true });
}

// Private Helferfunktion: Hängt die Drag-Logik an.
export function attachMarkerDragend(marker) {
    marker.on('dragend', (e) => {
        const position = marker.getLatLng();
        // Sendet ein Event, auf das app.js lauschen kann, um Neuberechnungen anzustoßen.
        const mapSelectEvent = new CustomEvent('location:selected', {
            detail: { lat: position.lat, lng: position.lng, source: 'marker_drag' },
            bubbles: true
        });
        AppState.map.getContainer().dispatchEvent(mapSelectEvent);
    });
}

// Private Helferfunktion: Aktualisiert das Popup.
export function updatePopupContent(marker, content, open = false) {
    if (!marker) return;
    const wasOpen = marker.getPopup()?.isOpen() || open;
    marker.unbindPopup().bindPopup(content);
    if (wasOpen) {
        marker.openPopup();
    }
}

// Helferfunktion zum Zentrieren der Karte.
export function recenterMap(force = false, moveMarkerToCenter = false) {
    if (AppState.isManualPanning && !force) return;
    if (AppState.map && AppState.currentMarker) {
        if (moveMarkerToCenter) {
            const mapCenter = AppState.map.getCenter();
            AppState.currentMarker.setLatLng(mapCenter);
            const mapSelectEvent = new CustomEvent('location:selected', {
                detail: { lat: mapCenter.lat, lng: mapCenter.lng, source: 'recenter' },
                bubbles: true,
                cancelable: true
            });
            AppState.map.getContainer().dispatchEvent(mapSelectEvent);
        } else {
            // Apply offset to keep marker below center
            const offsetY = 0; // Pixels below center
            const mapHeight = AppState.map.getSize().y;
            const offsetLat = (offsetY / mapHeight) * (AppState.map.getBounds().getNorth() - AppState.map.getBounds().getSouth());
            AppState.map.panTo([AppState.currentMarker.getLatLng().lat - offsetLat, AppState.currentMarker.getLatLng().lng], { animate: force });
        }
    }
}

/**
 * Zeichnet Marker für gefundene Points of Interest (POIs) auf die Karte.
 * @param {Array<Object>} pois - Ein Array von POI-Objekten.
 */
export function updatePoiMarkers(pois) {
    if (!AppState.map || !AppState.poiLayerGroup) {
        console.warn('Cannot update POI markers: map or layer group not ready.');
        return;
    }

    // Zuerst alle alten POI-Marker entfernen
    AppState.poiLayerGroup.clearLayers();

    if (!pois || pois.length === 0) {
        return; // Nichts zu zeichnen
    }

    // Ein Icon für die POI-Marker (z.B. ein Fallschirm-Emoji)
    const poiIcon = L.divIcon({
        html: '🪂',
        className: 'poi-marker-icon', // Eigene Klasse für potenzielles Styling
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });

    pois.forEach(poi => {
        const marker = L.marker([poi.lat, poi.lon], { icon: poiIcon, pmIgnore: true })
            .bindTooltip(poi.display_name, {
                permanent: false,
                direction: 'top',
            })
            .on('click', () => {
                // Wenn auf einen POI-Marker geklickt wird, die Position auswählen
                document.dispatchEvent(new CustomEvent('location:selected', {
                    detail: { lat: poi.lat, lng: poi.lon, source: 'poi_marker' },
                    bubbles: true
                }));
            });

        AppState.poiLayerGroup.addLayer(marker);
    });
}

//Live Position Funktionen
const LivePositionControl = L.Control.extend({
    options: {
        position: 'bottomright'
    },
    onAdd: function (map) {
        const container = L.DomUtil.create('div', 'leaflet-control-live-position');
        container.style.display = 'none';
        container.style.background = 'rgba(255, 255, 255, 0.8)';
        container.style.padding = '5px';
        container.style.borderRadius = '4px';
        this._container = container;
        return container;
    },
    update: function (data) {
        // Wenn keine Daten oder keine Koordinaten da sind -> ausblenden.
        if (!data || data.latitude === null || data.latitude === undefined) {
            this._container.style.display = 'none';
            return;
        }

        const {
            latitude, longitude, deviceAltitude, altitudeAccuracy, accuracy,
            speedMs, direction, showJumpMasterLine, jumpMasterLineData,
            heightUnit, effectiveWindUnit, coordFormat, refLevel
        } = data;

        const coords = Utils.convertCoords(latitude, longitude, coordFormat);
        const coordText = (coordFormat === 'MGRS') ? `MGRS: ${coords.lat}<br>` : `Lat: ${latitude.toFixed(5)}<br>Lng: ${longitude.toFixed(5)}<br>`;

        let altitudeText = "Altitude: N/A<br>";
        if (deviceAltitude !== null) {
            let displayAltitude = (refLevel === 'AGL' && AppState.lastAltitude) ? deviceAltitude - parseFloat(AppState.lastAltitude) : deviceAltitude;
            let displayRefLevel = (refLevel === 'AGL' && AppState.lastAltitude) ? 'abv DIP' : refLevel;
            const convertedAlt = Math.round(Utils.convertHeight(displayAltitude, heightUnit));
            const convertedAcc = Math.round(Utils.convertHeight(altitudeAccuracy, heightUnit));
            altitudeText = `Altitude: ${convertedAlt} ${heightUnit} ${displayRefLevel} (±${convertedAcc || 'N/A'} ${heightUnit})<br>`;
        }

        const accuracyText = `Accuracy: ${Math.round(Utils.convertHeight(accuracy, heightUnit))} ${heightUnit}<br>`;
        const speedText = `Speed: ${Utils.convertWind(speedMs, effectiveWindUnit, 'm/s').toFixed(1)} ${effectiveWindUnit}<br>`;
        const directionText = `Direction: ${direction}°`;

        let content = `<span style="font-weight: bold;">Live Position</span><br>${coordText}${altitudeText}${accuracyText}${speedText}${directionText}`;

        if (showJumpMasterLine && jumpMasterLineData) {
            const distText = Math.round(Utils.convertHeight(jumpMasterLineData.distance, heightUnit));
            const totText = jumpMasterLineData.tot !== 'N/A' && jumpMasterLineData.tot < 1200 ? `TOT: X - ${jumpMasterLineData.tot} s` : 'TOT: N/A';

            content += `<br><br><span style="font-weight: bold;">Jump Master Line to ${jumpMasterLineData.target}</span><br>`;
            content += `Bearing: ${jumpMasterLineData.bearing}°<br>`;
            content += `Distance: ${distText} ${heightUnit}<br>`;
            content += totText;
        }

        this._container.innerHTML = content;
        this._container.style.display = 'block';
    }
});

export function drawJumpMasterLine(start, end) {
    const line = [[start.lat, start.lng], [end.lat, end.lng]];
    if (AppState.jumpMasterLine) {
        AppState.jumpMasterLine.setLatLngs(line);
    } else {
        AppState.jumpMasterLine = L.polyline(line, { color: 'blue', weight: 3, dashArray: '5, 5' }).addTo(AppState.map);
    }
}

export function clearJumpMasterLine() {
    if (AppState.jumpMasterLine) {
        AppState.map.removeLayer(AppState.jumpMasterLine);
        AppState.jumpMasterLine = null;
    }
}

export function hideLivePositionControl() {
    if (AppState.livePositionControl) {
        // Rufe update mit null auf, um es auszublenden
        AppState.livePositionControl.update(null);
    }
}

export function updateLivePositionControl(data) {
    if (AppState.livePositionControl) {
        AppState.livePositionControl.update(data);
    }
}

export function handleHarpPlacement(e) {
    if (!AppState.isPlacingHarp) return;
    const { lat, lng } = e.latlng;
    if (AppState.harpMarker) {
        AppState.harpMarker.setLatLng([lat, lng]);
        console.log('Updated HARP marker position:', { lat, lng });
    } else {
        AppState.harpMarker = createHarpMarker(lat, lng).addTo(AppState.map);
        console.log('Placed new HARP marker:', { lat, lng });
    }
    Settings.state.userSettings.harpLat = lat;
    Settings.state.userSettings.harpLng = lng;
    Settings.save();
    AppState.isPlacingHarp = false;
    AppState.map.off('click', handleHarpPlacement);
    console.log('HARP placement mode deactivated');
    // Enable HARP radio button
    const harpRadio = document.querySelector('input[name="jumpMasterLineTarget"][value="HARP"]');
    if (harpRadio) {
        harpRadio.disabled = false;
        console.log('Enabled HARP radio button');
    }
    document.dispatchEvent(new CustomEvent('ui:recalculateJump'));
    document.dispatchEvent(new CustomEvent('harp:updated'));
}

export function createHarpMarker(latitude, longitude) {
    const marker = L.marker([latitude, longitude], {
        icon: L.divIcon({
            className: 'harp-marker',
            html: '<div style="width: 14px; height: 14px; background-color: green; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 6px rgba(0,0,0,0.6);"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10],
            pmIgnore: true
        }),
        pane: 'markerPane',  // Use standard marker pane
        pmIgnore: true
    });
    console.log('Created HARP marker at:', { latitude, longitude });
    return marker;
}

export function clearHarpMarker() {
    if (!AppState.map) {
        console.warn('Map not initialized, cannot clear HARP marker');
        Utils.handleMessage('Map not initialized, cannot clear HARP marker.');
        return;
    }

    if (AppState.harpMarker) {
        AppState.map.removeLayer(AppState.harpMarker);
        AppState.harpMarker = null;
        console.log('Removed HARP marker');
    }
    Settings.state.userSettings.harpLat = null;
    Settings.state.userSettings.harpLng = null;
    Settings.save();
    const harpRadio = document.querySelector('input[name="jumpMasterLineTarget"][value="HARP"]');
    if (harpRadio) {
        harpRadio.disabled = true;
        console.log('Disabled HARP radio button');
    }
    // If Jump Master Line is set to HARP, remove it or switch to DIP
    if (Settings.state.userSettings.jumpMasterLineTarget === 'HARP' && Settings.state.userSettings.showJumpMasterLine) {
        if (AppState.jumpMasterLine) {
            AppState.map.removeLayer(AppState.jumpMasterLine);
            AppState.jumpMasterLine = null;
            console.log('Removed Jump Master Line: HARP marker cleared');
        }
        // Switch to DIP
        Settings.state.userSettings.jumpMasterLineTarget = 'DIP';
        const dipRadio = document.querySelector('input[name="jumpMasterLineTarget"][value="DIP"]');
        if (dipRadio) {
            dipRadio.checked = true;
            console.log('Switched Jump Master Line to DIP');
        }
        Settings.save();
        // Update line if live tracking is active
        if (AppState.liveMarker && AppState.currentMarker && AppState.lastLat !== null && AppState.lastLng !== null) {
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
    }
    Utils.handleMessage('HARP marker cleared');
}
// --- ENDE DES NEUEN BLOCKS ---

/**
 * Zeichnet Marker für alle favorisierten Orte auf der Karte.
 * @param {Array<Object>} favorites - Ein Array von Favoriten-Objekten ({lat, lng, label}).
 */
export function updateFavoriteMarkers(favorites) {
    if (!AppState.map || !AppState.favoritesLayerGroup) {
        console.warn('Cannot update favorite markers: map or layer group not ready.');
        return;
    }

    // Zuerst alle alten Favoriten-Marker entfernen
    AppState.favoritesLayerGroup.clearLayers();

    if (!favorites || favorites.length === 0) {
        return; // Nichts zu zeichnen
    }

    // Ein Icon für die Favoriten-Marker erstellen (z.B. ein Stern)
    const starIcon = L.divIcon({
        html: '★',
        className: 'favorite-marker-icon',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });

    favorites.forEach(fav => {
        const marker = L.marker([fav.lat, fav.lng], { icon: starIcon, pmIgnore: true })
            .bindTooltip(fav.label, {
                permanent: false,
                direction: 'top',
            })
            .on('click', () => {
                // Wenn auf einen Favoriten-Marker geklickt wird, die Position auswählen
                const selectEvent = new CustomEvent('location:selected', {
                    detail: { lat: fav.lat, lng: fav.lng, source: 'favorite_marker' },
                    bubbles: true,
                    cancelable: true
                });
                AppState.map.getContainer().dispatchEvent(selectEvent);
            });

        AppState.favoritesLayerGroup.addLayer(marker);
        console.log('FAVORITE marker added!');
    });
}
