// mapManager.js
"use strict";

import { AppState } from '../core/state.js';
import { Settings } from '../core/settings.js';
import { Utils } from '../core/utils.js';
import { TileCache } from '../core/tileCache.js';
import { updateOfflineIndicator, isMobileDevice, displayWarning } from './ui.js';
//import './public/vendor/Leaflet.PolylineMeasure.js'; // Pfad ggf. anpassen
import { UI_DEFAULTS, ICON_URLS, ENSEMBLE_VISUALIZATION } from '../core/constants.js'; // Importiere UI-Defaults
import { getCapacitor } from '../core/capacitor-adapter.js';
import * as LocationManager from '../core/locationManager.js';
import * as liveTrackingManager from '../core/liveTrackingManager.js';
import { I18n } from '../core/i18n.js'; // <--- NEU: Importiert
import * as PinManager from '../core/pinManager.js';
import * as RainRadar from '../core/rainRadarManager.js';

let lastTapTime = 0; // Add this line
let isRotatingJRT = false;
let initialJrtAngle = 0;
let initialJrtDirection = 0;

// ===================================================================
// 1. Initialisierung
// ===================================================================

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
    AppState.favoritesLayerGroup = L.layerGroup().addTo(AppState.map);
    console.log('Favorite marker layer added!');
    AppState.poiLayerGroup = L.layerGroup().addTo(AppState.map);
    console.log('POI marker layer added!');
    AppState.pinLayerGroup = L.layerGroup().addTo(AppState.map);

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
        }
        console.log('Initial tile caching and geolocation promise resolved.');
    }).catch(error => {
        console.error("Error during parallel initialization of cache/geolocation:", error);
    });

    updateOfflineIndicator();
    console.log('initMap finished.');
}

// ===================================================================
// 2. Öffentliche API zum Zeichnen auf der Karte
// ===================================================================

/**
 * Zeichnet alle Visualisierungen für den Sprungablauf (Exit- und Canopy-Bereiche) auf die Karte.
 * Löscht zuvor alle alten Visualisierungen, um eine saubere Anzeige zu gewährleisten.
 * @param {object|null} jumpData - Ein Objekt, das die "Bauanleitungen" für alle zu zeichnenden Kreise und Labels enthält, oder null, um die Anzeige zu löschen.
 * @returns {void}
 */
export function drawJumpVisualization(jumpData) {
    // 1. Immer alles sauber machen.
    clearJumpVisualization();

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
            if (!_isValidCircle(circleInfo)) return;
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
            if (!_isValidCircle(circleInfo)) return;
            L.circle(circleInfo.center, {
                ...circleInfo,
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
        draggable: !Settings.state.userSettings.isInteractionLocked,
        zIndexOffset: 2000,
        pmIgnore: true
    })
        .bindTooltip(I18n.t('map.drag_to_move_track')) // NEU: I18n
        .addTo(AppState.jumpRunTrackLayerGroup);

    airplaneMarker.on('mousedown', () => {
        if (Settings.state.userSettings.isInteractionLocked) {
            displayWarning(I18n.t('map.interaction_locked')); // NEU: I18n
        }
        AppState.map.dragging.disable();
    });
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

    airplaneMarker.on('dragstart', (e) => {
        if (Settings.state.userSettings.isInteractionLocked) {
            e.target.dragging.disable();
            displayWarning(I18n.t('map.interaction_locked')); // NEU: I18n
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

/**
 * Zeichnet den Unsicherheitskreis für ein Abtrennverfahren (Cut-Away).
 * @param {object|null} data - Ein Objekt mit Center, Radius und Tooltip, oder null zum Löschen.
 */
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
export function drawJumpMasterLine(start, end) {
    const line = [[start.lat, start.lng], [end.lat, end.lng]];
    if (AppState.jumpMasterLine) {
        AppState.jumpMasterLine.setLatLngs(line);
    } else {
        AppState.jumpMasterLine = L.polyline(line, { color: 'blue', weight: 3, dashArray: '5, 5' }).addTo(AppState.map);
    }
}
/**
 * Zeichnet den aktuell aufgezeichneten Track als Linie auf der Karte.
 * @param {Array<object>} points - Ein Array von Trackpunkten ({lat, lng}).
 */
export function drawRecordedTrack(points) {
    if (!AppState.map) return;

    // Alte Linie entfernen, um sie zu aktualisieren
    if (AppState.recordedTrackLayer) {
        AppState.map.removeLayer(AppState.recordedTrackLayer);
    }

    if (points.length < 2) return;

    const latlngs = points.map(p => [p.lat, p.lng]);

    AppState.recordedTrackLayer = L.polyline(latlngs, {
        color: '#ff0000', // Rote Farbe für den Live-Track
        weight: 3,
        opacity: 0.8
    }).addTo(AppState.map);
}
export function drawTerrainWarning(dangerousPoints) {
    _initializeTerrainWarningLayer();
    AppState.terrainWarningLayer.clearLayers();

    if (!dangerousPoints || dangerousPoints.length < 3) {
        return; // Benötigen mindestens 3 Punkte für ein Polygon
    }

    // Berechnet die konvexe Hülle, um eine saubere Umrandung zu erhalten
    const hullPoints = Utils.getConvexHull(dangerousPoints.map(p => [p.lat, p.lng]));

    // Den aktuellen Schwellenwert direkt hier aus den Einstellungen holen
    const requiredClearance = Settings.getValue('terrainClearance', 100);
    const heightUnit = Settings.getValue('heightUnit', 'm');

    L.polygon(hullPoints, {
        color: 'red',
        fillColor: '#f03',
        fillOpacity: 0.5,
        weight: 2,
        pmIgnore: true
    }).bindTooltip(
        I18n.t('map.terrain_warning', { clearance: requiredClearance, unit: heightUnit }),
        { sticky: true, className: 'cutaway-tooltip' }
    ).addTo(AppState.terrainWarningLayer);
}
/**
 * Zeichnet oder aktualisiert den Flugpfad des getrackten ADSB-Flugzeugs.
 * @param {Array<[number, number]>} trackPoints - Ein Array von [lat, lng] Koordinaten.
 */
export function drawAircraftTrack(trackPoints) {
    if (!AppState.map || trackPoints.length < 2) {
        return;
    }

    const trackOptions = {
        color: '#007bff',
        weight: 3,
        opacity: 0.7,
        pmIgnore: true
    };

    if (AppState.aircraftTrackLayer) {
        AppState.aircraftTrackLayer.setLatLngs(trackPoints);
    } else {
        AppState.aircraftTrackLayer = L.polyline(trackPoints, trackOptions).addTo(AppState.map);
    }
}

// Validierung: Prüft ob ein Kreis gültige Koordinaten und Radius hat
function _isValidCircle(circleInfo) {
    if (!circleInfo || !Array.isArray(circleInfo.center) || circleInfo.center.length < 2) {
        console.warn('drawJumpVisualization: Ungültiges center:', circleInfo);
        return false;
    }
    const [lat, lng] = circleInfo.center;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        console.warn('drawJumpVisualization: NaN/Infinity in center:', circleInfo.center);
        return false;
    }
    if (!Number.isFinite(circleInfo.radius) || circleInfo.radius < 0) {
        console.warn('drawJumpVisualization: Ungültiger radius:', circleInfo.radius);
        return false;
    }
    return true;
}

// Clear Funktionen für die API

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
function clearJumpRunTrack() {
    if (AppState.map && AppState.jumpRunTrackLayerGroup) {
        AppState.map.removeLayer(AppState.jumpRunTrackLayerGroup);
    }
    AppState.jumpRunTrackLayerGroup = L.layerGroup().addTo(AppState.map);
}
export function clearCutAwayMarker() {
    if (AppState.cutAwayMarker) {
        AppState.map.removeLayer(AppState.cutAwayMarker);
        AppState.cutAwayMarker = null;
    }
    // Lösche auch den Kreis, wenn der Marker entfernt wird.
    drawCutAwayVisualization(null);
}
export function clearJumpMasterLine() {
    if (AppState.jumpMasterLine) {
        AppState.map.removeLayer(AppState.jumpMasterLine);
        AppState.jumpMasterLine = null;
    }
}
// ===================================================================
// Pin-Marker Funktionen
// ===================================================================

export function createPinMarker(pin) {
    const isActive = pin.isActive;
    const marker = L.marker([pin.harpLatLng.lat, pin.harpLatLng.lng], {
        icon: L.divIcon({
            className: `pin-marker ${isActive ? 'pin-marker-active' : ''}`,
            html: `<div class="pin-marker-inner">${pin.id}</div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        }),
        pane: 'markerPane',
        zIndexOffset: 1400,
        pmIgnore: true
    });

    marker.on('click', () => {
        if (pin.isActive) {
            // Zweiter Tap auf aktiven Pin → entfernen
            document.dispatchEvent(new CustomEvent('pin:remove', { detail: { pinId: pin.id } }));
        } else {
            document.dispatchEvent(new CustomEvent('pin:activate', { detail: { pinId: pin.id } }));
        }
    });

    return marker;
}

export function redrawPinMarkers() {
    if (!AppState.pinLayerGroup) return;
    AppState.pinLayerGroup.clearLayers();

    AppState.pinnedJumps.forEach(pin => {
        const marker = createPinMarker(pin);
        marker.addTo(AppState.pinLayerGroup);
        pin.marker = marker;
    });
}

export function clearAllPinMarkers() {
    if (AppState.pinLayerGroup) {
        AppState.pinLayerGroup.clearLayers();
    }
}

export function clearHarpMarker() {
    if (!AppState.map) {
        console.warn('Map not initialized, cannot clear HARP marker');
        Utils.handleMessage(I18n.t('messages.map_not_init')); // NEU: I18n
        return;
    }

    // Alle Pins löschen wenn HARP entfernt wird
    if (AppState.pinnedJumps.length > 0) {
        PinManager.clearAllPins();
        clearAllPinMarkers();
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
    Utils.handleMessage(I18n.t('messages.harp_cleared')); // NEU: I18n
}
/**
 * Entfernt die Track-Linie von der Karte.
 */
export function clearRecordedTrack() {
    if (AppState.map && AppState.recordedTrackLayer) {
        AppState.map.removeLayer(AppState.recordedTrackLayer);
        AppState.recordedTrackLayer = null;
    }
}
/**
 * Zeichnet eine Heatmap aller analysierten Terrain-Punkte mit farbcodierter Clearance.
 * @param {object[]} allPoints - Alle analysierten Punkte mit clearance-Werten.
 * @param {number} requiredClearance - Der eingestellte Mindestabstand in Metern.
 */
export function drawTerrainHeatmap(allPoints, requiredClearance) {
    _initializeTerrainWarningLayer();
    AppState.terrainWarningLayer.clearLayers();

    if (!allPoints || allPoints.length === 0) return;

    for (const p of allPoints) {
        let color;
        if (p.clearance < requiredClearance) {
            color = '#e74c3c'; // Rot: unter Mindestabstand
        } else if (p.clearance < requiredClearance + 50) {
            color = '#f39c12'; // Orange: bis +50m über Mindestabstand
        } else if (p.clearance < requiredClearance + 100) {
            color = '#f1c40f'; // Gelb: bis +100m über Mindestabstand
        } else {
            color = '#27ae60'; // Grün: > 100m über Mindestabstand
        }

        L.circleMarker([p.lat, p.lng], {
            radius: 5,
            color: color,
            fillColor: color,
            fillOpacity: 0.7,
            weight: 1,
            pmIgnore: true
        }).bindTooltip(
            `Clearance: ${Math.round(p.clearance)}m<br>` +
            `Gelände: ${Math.round(p.groundElevation)}m MSL<br>` +
            `Springer: ${Math.round(p.skydiverMslAltitude)}m MSL`,
            { sticky: true, className: 'cutaway-tooltip' }
        ).addTo(AppState.terrainWarningLayer);
    }
}

/**
 * Entfernt die Terrain-Warnungs-Visualisierung von der Karte.
 */
export function clearTerrainWarning() {
    if (AppState.terrainWarningLayer) {
        AppState.terrainWarningLayer.clearLayers();
        console.log("Terrain warning layer cleared.");
    }
}
/**
 * Entfernt den Flugpfad des ADSB-Flugzeugs von der Karte.
 */
export function clearAircraftTrack() {
    if (AppState.aircraftTrackLayer) {
        AppState.map.removeLayer(AppState.aircraftTrackLayer);
        AppState.aircraftTrackLayer = null;
    }
}

// ===================================================================
// 3. Marker-Management
// ===================================================================

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
        html: `<div style="transform-origin: center; transform: rotate(${normalizedBearing}deg);">${arrowSvg}</div>`,
        className: 'wind-arrow-icon',
        iconSize: [40, 20],
        iconAnchor: [20, 10]
    });
}
export function createCutAwayMarker(lat, lng) {
    const cutAwayIcon = L.icon({
        iconUrl: ICON_URLS.CUTAWAY_MARKER,
        iconSize: [25, 25],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12],
        pmIgnore: true
    });
    return L.marker([lat, lng], {
        icon: cutAwayIcon,
        draggable: !Settings.state.userSettings.isInteractionLocked,
        pmIgnore: true
    });
}
export function attachCutAwayMarkerDragend(marker) {
    marker.on('mousedown', () => {
        if (Settings.state.userSettings.isInteractionLocked) {
            displayWarning(I18n.t('map.interaction_locked')); // NEU: I18n
        }
    });
    marker.on('dragend', (e) => {
        const position = marker.getLatLng();
        AppState.cutAwayLat = position.lat;
        AppState.cutAwayLng = position.lng;
        updateCutAwayMarkerPopup(marker, AppState.cutAwayLat, AppState.cutAwayLng);
        const cutawayEvent = new CustomEvent('cutaway:marker_placed', { bubbles: true });
        AppState.map.getContainer().dispatchEvent(cutawayEvent);
    });
}
export function updateCutAwayMarkerPopup(marker, lat, lng, open = false) {
    const coordFormat = Settings.getValue('coordFormat', 'radio', 'Decimal');
    let popupContent = `<b>${I18n.t('map.cut_away_start')}</b><br>`;

    const formatDDM = (ddm) => `${ddm.deg}° ${ddm.min.toFixed(3)}' ${ddm.dir}`;
    const formatDMS = (dms) => `${dms.deg}°${dms.min}'${dms.sec.toFixed(0)}" ${dms.dir}`;

    if (coordFormat === 'MGRS') {
        popupContent += `${I18n.t('map.mgrs')}: ${Utils.decimalToMgrs(lat, lng)}`;
    } else if (coordFormat === 'DMS') {
        popupContent += `${I18n.t('map.lat')}: ${formatDMS(Utils.decimalToDms(lat, true))}<br>${I18n.t('map.lng')}: ${formatDMS(Utils.decimalToDms(lng, false))}`;
    } else if (coordFormat === 'DDM') {
        popupContent += `${I18n.t('map.lat')}: ${formatDDM(Utils.decimalToDecimalMinutes(lat, true))}<br>${I18n.t('map.lng')}: ${formatDDM(Utils.decimalToDecimalMinutes(lng, false))}`;
    } else {
        popupContent += `${I18n.t('map.lat')}: ${lat.toFixed(5)}<br>${I18n.t('map.lng')}: ${lng.toFixed(5)}`;
    }
    // Ruft die zentrale Funktion zum Aktualisieren von Popups auf
    updatePopupContent(marker, popupContent, open);
}
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
            // Wenn Live-Tracking + JML aktiv und JML nicht auf DIP zeigt: umschalten statt Popup
            if (AppState.watchId !== null &&
                Settings.state.userSettings.showJumpMasterLine &&
                Settings.state.userSettings.jumpMasterLineTarget !== 'DIP') {
                Settings.state.userSettings.jumpMasterLineTarget = 'DIP';
                Settings.save();
                document.dispatchEvent(new CustomEvent('ui:jumpMasterLineTargetChanged'));
                setTimeout(() => newMarker.closePopup(), 0);
                return;
            }
            import('../ui-web/displayManager.js').then(displayManager => {
                displayManager.refreshMarkerPopup(false, true);
            });
        });
        AppState.currentMarker = newMarker;
        AppState.currentMarker.addTo(AppState.map);
    }

    const popupContent = `${I18n.t('map.lat')}: ${lat.toFixed(5)}<br>${I18n.t('map.lng')}: ${lng.toFixed(5)}<br>${I18n.t('map.alt')}: ${altitude} m`;
    updatePopupContent(AppState.currentMarker, popupContent);

    AppState.lastLat = lat;
    AppState.lastLng = lng;
    AppState.lastAltitude = altitude;
    // Remove invalidateSize to prevent layout recalculation
    // AppState.map.invalidateSize();
}
export function createCustomMarker(lat, lng) {
    const customIcon = L.icon({
        iconUrl: ICON_URLS.DEFAULT_MARKER,
        iconSize: [32, 32],
        iconAnchor: [16, 20],
        popupAnchor: [0, -32],
        pmIgnore: true
    });
    return L.marker([lat, lng], {
        icon: customIcon,
        draggable: !Settings.state.userSettings.isInteractionLocked,
        pmIgnore: true
    });
}
export function attachMarkerDragend(marker) {
    marker.on('mousedown', () => {
        if (Settings.state.userSettings.isInteractionLocked) {
            displayWarning(I18n.t('map.interaction_locked')); // NEU: I18n
        }
    });
    marker.on('dragend', (e) => {
        const position = marker.getLatLng();
        const mapSelectEvent = new CustomEvent('location:selected', {
            detail: { lat: position.lat, lng: position.lng, source: 'marker_drag' },
            bubbles: true
        });
        AppState.map.getContainer().dispatchEvent(mapSelectEvent);
    });
}
export function updatePopupContent(marker, content, open = false) {
    if (!marker) return;

    const popup = marker.getPopup();
    // 'wasOpen' prüft jetzt, ob das Popup schon offen war ODER ob 'open' explizit true ist.
    const wasOpen = (popup && popup.isOpen()) || open;

    if (popup) {
        popup.setContent(content);
    } else {
        marker.bindPopup(content);
    }

    if (wasOpen) {
        marker.openPopup();
    }
}
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
export function handleHarpPlacement(e) {
    if (Settings.state.userSettings.isInteractionLocked) {
        displayWarning(I18n.t('map.interaction_locked')); // NEU: I18n
        AppState.isPlacingHarp = false;
        AppState.map.off('click', handleHarpPlacement);
        return;
    }
    if (!AppState.isPlacingHarp) return;
    const { lat, lng } = e.latlng;
    if (AppState.harpMarker) {
        AppState.harpMarker.setLatLng([lat, lng]);
    } else {
        AppState.harpMarker = createHarpMarker(lat, lng).addTo(AppState.map);
    }
    // NEU: Ruft die Popup-Aktualisierung sofort auf und öffnet es
    updateHarpMarkerPopup(AppState.harpMarker, lat, lng, true);

    Settings.state.userSettings.harpLat = lat;
    Settings.state.userSettings.harpLng = lng;

    Settings.state.userSettings.jumpRunTrackOffset = 0;
    Settings.state.userSettings.jumpRunTrackForwardOffset = 0;
    console.log('HARP placed. JRT offsets reset to 0.');

    // Aktiven Pin deaktivieren, damit Live-Berechnung wieder gezeichnet wird
    // Pins bleiben bestehen — jeder Pin hat seine eigene HARP-Position
    if (AppState.activePinId !== null) {
        AppState.pinnedJumps.forEach(p => { p.isActive = false; });
        AppState.activePinId = null;
        redrawPinMarkers();
        console.log('Active pin deactivated due to HARP repositioning.');
    }

    Settings.save();
    AppState.isPlacingHarp = false;
    AppState.map.off('click', handleHarpPlacement);

    const harpRadio = document.querySelector('input[name="jumpMasterLineTarget"][value="HARP"]');
    if (harpRadio) {
        harpRadio.disabled = false;
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
        }),
        pane: 'markerPane',
        pmIgnore: true
    });
    marker.on('click', () => {
        // Wenn Live-Tracking + JML aktiv und JML nicht auf HARP zeigt: umschalten statt Popup
        if (AppState.watchId !== null &&
            Settings.state.userSettings.showJumpMasterLine &&
            Settings.state.userSettings.jumpMasterLineTarget !== 'HARP') {
            Settings.state.userSettings.jumpMasterLineTarget = 'HARP';
            Settings.save();
            document.dispatchEvent(new CustomEvent('ui:jumpMasterLineTargetChanged'));
            setTimeout(() => marker.closePopup(), 0);
            return;
        }
        const pos = marker.getLatLng();
        updateHarpMarkerPopup(marker, pos.lat, pos.lng, true);
    });
    return marker;
}
/**
 * NEUE FUNKTION: Erstellt und aktualisiert das Popup für den HARP-Marker.
 * @param {L.Marker} marker - Die Marker-Instanz.
 * @param {number} lat - Die Breite.
 * @param {number} lng - Die Länge.
 * @param {boolean} [open=false] - Ob das Popup sofort geöffnet werden soll.
 */
export async function updateHarpMarkerPopup(marker, lat, lng, open = false, expanded = false) {
    // --- Schritt 1: Alle Daten sammeln (wie in deiner alten Version) ---
    const altitude = await Utils.getAltitude(lat, lng);
    const heightUnit = Settings.getValue('heightUnit', 'radio', 'm');
    let displayAltitude = 'N/A';
    let displayUnit = heightUnit;
    if (altitude !== 'N/A') {
        displayAltitude = Math.round(Utils.convertHeight(altitude, heightUnit));
    }

    let qfeText = 'N/A';
    if (altitude !== 'N/A' && AppState.weatherData && AppState.weatherData.surface_pressure) {
        const sliderIndex = parseInt(document.getElementById('timeSlider')?.value) || 0;
        const surfacePressure = AppState.weatherData.surface_pressure[sliderIndex];
        const temperature = AppState.weatherData.temperature_2m?.[sliderIndex] || 15;
        const qfe = Utils.calculateQFE(surfacePressure, altitude, altitude, temperature);
        if (qfe !== 'N/A') {
            qfeText = `${qfe} hPa`;
        }
    }

    // Ein wiederverwendbarer Block für Höhe und QFE
    const altitudeContent = `<br>${I18n.t('map.alt')}: ${displayAltitude} ${displayUnit}<br>${I18n.t('map.qfe')}: ${qfeText}`; // NEU: I18n

    // --- Schritt 2: Den Popup-Inhalt basierend auf dem 'expanded'-Status erstellen ---
    let popupContent = `<b>HARP</b><br>`;

    if (expanded) {
        // Erweiterte Ansicht mit allen Formaten
        const dms = Utils.decimalToDms(lat, true);
        const ddm = Utils.decimalToDecimalMinutes(lat, true);
        const dmsLng = Utils.decimalToDms(lng, false);
        const ddmLng = Utils.decimalToDecimalMinutes(lng, false);

        popupContent += `
            <div style="font-size: 11px; line-height: 1.4;">
                Decimal: ${lat.toFixed(5)}, ${lng.toFixed(5)}<br>
                DDM: ${ddm.deg}° ${ddm.min.toFixed(3)}' ${ddm.dir}, ${ddmLng.deg}° ${ddmLng.min.toFixed(3)}' ${ddmLng.dir}<br>
                DMS: ${dms.deg}°${dms.min}'${dms.sec.toFixed(0)}" ${dms.dir}, ${dmsLng.deg}°${dmsLng.min}'${dmsLng.sec.toFixed(0)}" ${dmsLng.dir}<br>
                ${I18n.t('map.mgrs')}: ${Utils.decimalToMgrs(lat, lng)}
            </div>
            ${altitudeContent}<br>
            <a href="#" class="toggle-coords-format" data-marker-type="harp" data-lat="${lat}" data-lng="${lng}" data-expanded="true" style="font-size: 11px;">${I18n.t('map.show_less')}</a>
        `;
    } else {
        // Standardansicht mit dem vom Benutzer ausgewählten Format
        const coordFormat = Settings.getValue('coordFormat', 'radio', 'Decimal');
        const coords = Utils.convertCoords(lat, lng, coordFormat);
        const formatDDM = (ddm) => `${ddm.deg}° ${ddm.min.toFixed(3)}' ${ddm.dir}`;
        const formatDMS = (dms) => `${dms.deg}°${dms.min}'${dms.sec.toFixed(0)}" ${dms.dir}`;

        if (coordFormat === 'MGRS') {
            popupContent += `${I18n.t('map.mgrs')}: ${coords.lat}`;
        } else if (coordFormat === 'DMS') {
            popupContent += `${I18n.t('map.lat')}: ${formatDMS(coords.lat)}<br>${I18n.t('map.lng')}: ${formatDMS(coords.lng)}`;
        } else if (coordFormat === 'DDM') {
            popupContent += `${I18n.t('map.lat')}: ${formatDDM(coords.lat)}<br>${I18n.t('map.lng')}: ${formatDDM(coords.lng)}`;
        } else {
            popupContent += `${I18n.t('map.lat')}: ${coords.lat}<br>${I18n.t('map.lng')}: ${coords.lng}`;
        }

        popupContent += `${altitudeContent}<br>
            <a href="#" class="toggle-coords-format" data-marker-type="harp" data-lat="${lat}" data-lng="${lng}" data-expanded="false" style="font-size: 11px;">${I18n.t('map.show_more')}</a>
        `;
    }

    // Pin Jump Button
    const pinCount = AppState.pinnedJumps.length;
    const canPin = pinCount < 4 && Settings.state.userSettings.calculateJump && AppState.lastVisualizationData;
    if (canPin) {
        popupContent += `<br><button class="pin-jump-btn" style="margin-top: 4px; padding: 2px 8px; font-size: 11px; cursor: pointer;">📌 ${I18n.t('planner.pin_jump')} (${pinCount}/4)</button>`;
    } else if (pinCount >= 4) {
        popupContent += `<br><span style="font-size: 11px; color: gray;">📌 ${I18n.t('planner.pin_limit_reached')}</span>`;
    }
    if (pinCount > 0) {
        popupContent += `<br><a href="#" class="clear-all-pins-btn" style="font-size: 11px; color: red;">${I18n.t('planner.clear_all_pins')}</a>`;
    }

    // --- Schritt 3: Das Popup aktualisieren ---
    updatePopupContent(marker, popupContent, open);
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
        let coordString;
        const formatDDM = (ddm) => `${ddm.deg}° ${ddm.min.toFixed(3)}' ${ddm.dir}`;
        const formatDMS = (dms) => `${dms.deg}°${dms.min}'${dms.sec.toFixed(0)}" ${dms.dir}`;

        if (coordFormat === 'MGRS') {
            coordString = `MGRS: ${coords.lat}`;
        } else if (coordFormat === 'DMS') {
            coordString = `${formatDMS(coords.lat)}, ${formatDMS(coords.lng)}`;
        } else if (coordFormat === 'DDM') {
            coordString = `${formatDDM(coords.lat)}, ${formatDDM(coords.lng)}`;
        } else {
            coordString = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
        }

        let altitudeText = "<br>Altitude: N/A<br>";
        if (deviceAltitude !== null) {
            let displayAltitude = (refLevel === 'AGL' && AppState.lastAltitude) ? deviceAltitude - parseFloat(AppState.lastAltitude) : deviceAltitude;
            let displayRefLevel = (refLevel === 'AGL' && AppState.lastAltitude) ? 'abv DIP' : refLevel;
            const convertedAlt = Math.round(Utils.convertHeight(displayAltitude, heightUnit));
            const convertedAcc = Math.round(Utils.convertHeight(altitudeAccuracy, heightUnit));
            altitudeText = `<br>Altitude: ${convertedAlt} ${heightUnit} ${displayRefLevel} (±${convertedAcc || 'N/A'} ${heightUnit})<br>`;
        }

        const accuracyText = `Accuracy: ${Math.round(Utils.convertHeight(accuracy, heightUnit))} ${heightUnit}<br>`;
        const speedText = `Speed: ${Utils.convertWind(speedMs, effectiveWindUnit, 'm/s').toFixed(1)} ${effectiveWindUnit}<br>`;
        const directionText = `Direction: ${direction}°`;

        let content = `<span style="font-weight: bold;">Live Position</span><br>${coordString}${altitudeText}${accuracyText}${speedText}${directionText}`;

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
/**
 * Erstellt einen Marker für das Absetzflugzeug mit Rotationsmöglichkeit.
 * @param {number} lat - Breite.
 * @param {number} lng - Länge.
 * @param {number} bearing - Flugrichtung in Grad.
 * @returns {L.Marker} Der erstellte Leaflet-Marker.
 */
export function createAircraftMarker(lat, lng, bearing) {
    const aircraftIcon = L.icon({
        iconUrl: ICON_URLS.LIVEPLANE_MARKER,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
    });

    const marker = L.marker([lat, lng], {
        icon: aircraftIcon,
        rotationAngle: bearing,
        rotationOrigin: 'center center',
        zIndexOffset: 1500,
        pmIgnore: true
    }).addTo(AppState.map);

    AppState.aircraftMarker = marker;
    return marker;
}

// ===================================================================
// 4. Interne Initialisierungs-Helfer
// ===================================================================

/**
 * Initialisiert die grundlegende Leaflet-Karteninstanz.
 * @private
 */
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

    // ============================================================
    // NEU: Dynamische Spracheinstellung für Geoman
    // ============================================================
    
    // 1. Sprache beim Start setzen
    const currentLang = Settings.getValue('language') || 'en';
    AppState.map.pm.setLang(currentLang);

    // 2. Auf Sprachwechsel hören (Live-Update ohne Neuladen)
    document.addEventListener('i18n:loaded', (e) => {
        if (AppState.map && AppState.map.pm) {
            console.log(`Updating Geoman language to: ${e.detail.lang}`);
            AppState.map.pm.setLang(e.detail.lang);
        }
    });
    // ============================================================

    if (isMobileDevice()) {
        AppState.map.pm.setGlobalOptions({
            hintlineStyle: { opacity: 0, color: 'green' }
        });
        console.log("Geoman global options set for mobile to hide helper lines.");
    }

    // ============================================================
    // Wetterradar-Control (RainViewer)
    // ============================================================
    _addRadarControl();

    console.log('Standard map controls including Geoman have been added.');
}

function _addRadarControl() {
    const RadarControl = L.Control.extend({
        options: { position: 'bottomright' },

        onAdd() {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-radar');
            L.DomEvent.disableClickPropagation(container);
            L.DomEvent.disableScrollPropagation(container);

            container.innerHTML = `
                <div class="radar-control-panel">
                    <button id="radarToggleBtn" class="radar-btn" title="${I18n.t('map.radar.toggle')}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <circle cx="12" cy="12" r="6"/>
                            <circle cx="12" cy="12" r="2"/>
                            <line x1="12" y1="2" x2="12" y2="12"/>
                        </svg>
                        <span>${I18n.t('map.radar.toggle')}</span>
                    </button>
                    <div id="radarOptions" class="radar-options" style="display:none;">
                        <div class="radar-opacity-row">
                            <label>${I18n.t('map.radar.opacity')}:</label>
                            <input id="radarOpacitySlider" type="range" min="0" max="100" value="50" />
                        </div>
                        <div class="radar-animation-row">
                            <button id="radarAnimateBtn" class="radar-btn-small">${I18n.t('map.radar.animate')}</button>
                            <span id="radarTimestamp" class="radar-timestamp"></span>
                        </div>
                    </div>
                </div>
            `;

            const toggleBtn = container.querySelector('#radarToggleBtn');
            const optionsPanel = container.querySelector('#radarOptions');
            const opacitySlider = container.querySelector('#radarOpacitySlider');
            const animateBtn = container.querySelector('#radarAnimateBtn');

            // Restore saved opacity (match _getStoredOpacity logic: ignore 0, fallback to 50%)
            try {
                const saved = localStorage.getItem('radarOpacity');
                if (saved !== null) {
                    const val = parseFloat(saved);
                    opacitySlider.value = (Number.isFinite(val) && val > 0) ? Math.round(val * 100) : 50;
                }
            } catch (e) { /* ignore */ }

            toggleBtn.addEventListener('click', async () => {
                await RainRadar.toggleRadar();
                toggleBtn.classList.toggle('radar-active', AppState.isRadarVisible);
                optionsPanel.style.display = AppState.isRadarVisible ? 'block' : 'none';
            });

            opacitySlider.addEventListener('input', (e) => {
                RainRadar.setOpacity(parseInt(e.target.value, 10) / 100);
            });

            animateBtn.addEventListener('click', () => {
                if (RainRadar.isAnimating()) {
                    RainRadar.stopAnimation();
                    animateBtn.textContent = I18n.t('map.radar.animate');
                } else {
                    RainRadar.startAnimation();
                    animateBtn.textContent = I18n.t('map.radar.stop');
                }
            });

            return container;
        }
    });

    new RadarControl().addTo(AppState.map);
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
            Utils.handleMessage(I18n.t('map.cache.cleared_success')); // NEU: I18n
        } else {
            await TileCache.clearOldTiles();
        }
    } catch (error) {
        console.error('Failed to initialize or manage tile cache:', error);
        Utils.handleError(I18n.t('map.cache.status_setup_failed'));
    }
    console.log('Tile cache logic initialized.');
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
            AppState.coordsControl.getContainer().innerHTML = I18n.t('map.move_mouse_over'); // NEU: I18n
        }
    });
    console.log('Mousemove and mouseout handlers set up.');
}
function _initializeTerrainWarningLayer() {
    if (!AppState.terrainWarningLayer) {
        AppState.terrainWarningLayer = L.layerGroup().addTo(AppState.map);
    }
}

// Setup Funktionen

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
        "Esri Street": L.tileLayer.cached('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: '© Esri, USGS'
        }),
        "Esri Topo": L.tileLayer.cached('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: '© Esri, USGS'
        }),
        "Esri Satellite": L.layerGroup([
            // Basiskarte: Satellit
            L.tileLayer.cached('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                maxZoom: 19,
            }),
            // Overlay: Nur Labels und Grenzen von Esri (sehr detailliert)
            L.tileLayer.cached('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
                maxZoom: 19,
                attribution: '© EsriEsri, USDA, USGS © OpenStreetMap contributors, and the GIS user community',
                pane: 'shadowPane' // Sorgt dafür, dass Labels über den Satellitenbildern liegen
            })
        ]),
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
        }),
        "OpenTopoMap + Airspaces": L.layerGroup([
            L.tileLayer.cached('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
                subdomains: ['a', 'b', 'c']
            }),
            L.tileLayer.cached('https://nwy-tiles-api.prod.newaydata.com/tiles/{z}/{x}/{y}.png?path=latest/aero/latest', {
                maxZoom: 19,
                attribution: '© <a href="https://www.openflightmaps.org">openflightmaps.org</a>',
                opacity: 0.8,
                transparent: true,
                zIndex: 2,
                updateWhenIdle: true,
                keepBuffer: 2,
                subdomains: ['a', 'b', 'c']
            })
        ], {
            attribution: '© Esri, USDA, USGS | © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }),
        "Open Flight Map": L.tileLayer.cached('https://nwy-tiles-api.prod.newaydata.com/tiles/{z}/{x}/{y}.png?path=latest/aero/latest', {
            maxZoom: 19,
            attribution: '© <a href="https://www.openflightmaps.org">openflightmaps.org</a>'
        }),
        "Esri Topo + SeaMarks": L.layerGroup([
            // Diese Ebene wird weiterhin gecached
            L.tileLayer.cached('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
                maxZoom: 19,
                attribution: '© Esri, USGS'
            }),
            // DIESE ZEILE IST GEÄNDERT: .cached wurde entfernt
            L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
                maxZoom: 18,
                attribution: ' © <a href="http://www.openseamap.org">OpenSeaMap</a> contributors',
                transparent: true,
                zIndex: 3
            })
        ]),
        "CARTO Dark Matter": L.tileLayer.cached('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 19
        }),
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
                    Utils.handleMessage(I18n.t('messages.offline_zoom_restricted')); // NEU: I18n
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
                Utils.handleMessage(I18n.t('messages.tiles_unavailable_switched', { current: selectedBaseMapName, fallback: fallbackBaseMapName })); // NEU: I18n
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
function _setupCustomPanes() {
    AppState.map.createPane('gpxTrackPane');
    AppState.map.getPane('gpxTrackPane').style.zIndex = 650;
    AppState.map.getPane('tooltipPane').style.zIndex = 700;
    AppState.map.getPane('popupPane').style.zIndex = 700;
    console.log('Custom map panes created.');
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
        const segmentDistanceText = Utils.formatDistance(segmentDistance);

        let totalDistance = 0;
        for (let i = 1; i <= index; i++) {
            totalDistance += latlngs[i - 1].distanceTo(latlngs[i]);
        }
        const totalDistanceText = Utils.formatDistance(totalDistance);

        const outBearingText = nextPoint ? `${Utils.calculateBearing(currentPoint.lat, currentPoint.lng, nextPoint.lat, nextPoint.lng).toFixed(0)}°` : '---';

        const labelContent = `
            <div class="geoman-permanent-label">
                <div>${I18n.t('map.geoman.in')}: ${inBearing.toFixed(0)}°</div>
                <div>${I18n.t('map.geoman.out')}: ${outBearingText}</div>
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
        const radiusText = Utils.formatDistance(radius);
        const labelContent = `<div class="geoman-permanent-label">${I18n.t('map.geoman.radius')}:<br> ${radiusText}</div>`;
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
                liveMeasureLabel.innerHTML = I18n.t('map.geoman.tap_first_point'); // NEU: I18n

                // --- NEU: Positionierung direkt unter dem Slider ---
                const sliderContainer = document.getElementById('slider-container');
                // Wir holen die Höhe des Sliders oder nehmen 80px als Fallback
                const topOffset = sliderContainer ? sliderContainer.offsetHeight - 100 : 80;
                
                const mapSize = map.getSize();
                // Wir versuchen die Breite des Labels zu ermitteln, fallback 150px.
                // Wir zentrieren es: (Bildschirmmitte) - (Halbe Labelbreite)
                const labelWidth = liveMeasureLabel.offsetWidth || 150;
                const labelX = (mapSize.x / 2) - (labelWidth / 2);
                
                const initialLabelPos = L.point(labelX, topOffset);
                L.DomUtil.setPosition(liveMeasureLabel, initialLabelPos);
                // --------------------------------------------------

                L.DomUtil.setPosition(liveMeasureLabel, initialLabelPos);

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
                        const distanceText = Utils.formatDistance(distance);

                        liveMeasureLabel.innerHTML = `${I18n.t('map.geoman.in')}: ${bearing.toFixed(0)}°<br>${I18n.t('map.geoman.out')}: ---°<br>+: ${distanceText}`;
                        const mapSize = map.getSize();
                        const labelPos = L.point(mapSize.x / 2 + 20, mapSize.y / 2 - 40);
                        L.DomUtil.setPosition(liveMeasureLabel, labelPos);
                    } else {
                        // Wenn keine Punkte da sind (Reset oder Start)
                        if (rubberBandLayer) {
                            map.removeLayer(rubberBandLayer);
                            rubberBandLayer = null;
                        }
                        liveMeasureLabel.innerHTML = I18n.t('map.geoman.tap_first_point');

                        // --- NEU: Reset-Position ebenfalls oben ---
                        const currentSliderContainer = document.getElementById('slider-container');
                        const currentTopOffset = currentSliderContainer ? currentSliderContainer.offsetHeight + 20 : 80;
                        const currentMapSize = map.getSize();
                        
                        // Breite neu berechnen (da Text sich geändert hat)
                        // Da innerHTML gerade gesetzt wurde, ist offsetWidth evtl. noch nicht aktuell, 
                        // daher nutzen wir hier einen Schätzwert oder warten kurz (timeout nicht zwingend nötig für UI)
                        const resetLabelX = (currentMapSize.x / 2) - 75; // 75px = halbe Breite von ca 150px
                        
                        const resetLabelPos = L.point(resetLabelX, currentTopOffset);
                        L.DomUtil.setPosition(liveMeasureLabel, resetLabelPos);
                        // -----------------------------------------
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
                liveMeasureLabel.innerHTML = I18n.t('map.geoman.click_first_point'); // NEU: I18n
                mouseMoveHandler = (moveEvent) => {
                    const latlngs = workingLayer.getLatLngs();
                    if (latlngs.length > 0) {
                        const lastPoint = latlngs[latlngs.length - 1];
                        const distance = lastPoint.distanceTo(moveEvent.latlng);
                        const bearing = Utils.calculateBearing(lastPoint.lat, lastPoint.lng, moveEvent.latlng.lat, moveEvent.latlng.lng);
                        const distanceText = Utils.formatDistance(distance);
                        liveMeasureLabel.innerHTML = `${I18n.t('map.geoman.in')}: ${bearing.toFixed(0)}°<br>${I18n.t('map.geoman.out')}: ---°<br>+: ${distanceText}`;
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

                            const radiusText = Utils.formatDistance(radius);
                            liveMeasureLabel.innerHTML = `${I18n.t('map.geoman.radius')}: ${radiusText}`;
                            const mapSize = map.getSize();
                            const labelPos = L.point(mapSize.x / 2, mapSize.y / 2 - 40);
                            L.DomUtil.setPosition(liveMeasureLabel, labelPos);
                        }
                    }
                };

                vertexAddHandler = () => {
                    if (!centerSet) {
                        centerSet = true;
                        liveMeasureLabel.innerHTML = I18n.t('map.geoman.move_map_radius'); // NEU: I18n
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
                liveMeasureLabel.innerHTML = I18n.t('map.geoman.click_drag_circle'); // NEU: I18n
                mouseMoveHandler = (moveEvent) => {
                    const center = workingLayer.getLatLng();
                    if (center) {
                        const radius = center.distanceTo(moveEvent.latlng);
                        const radiusText = Utils.formatDistance(radius);
                        liveMeasureLabel.innerHTML = `${I18n.t('map.geoman.radius')}: ${radiusText}`;
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
                const radiusText = Utils.formatDistance(radius);
                liveMeasureLabel.innerHTML = `${I18n.t('map.geoman.radius')}: ${radiusText}`;
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
                Utils.handleMessage(I18n.t('messages.offline_zoom_restricted')); // NEU: I18n
            } else if (targetZoom > 14) {
                e.target._zoom = 14;
                AppState.map.setZoom(14);
                Utils.handleMessage(I18n.t('messages.offline_zoom_restricted'));
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

    //
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

        if (Settings.state.userSettings.isInteractionLocked) {
            displayWarning(I18n.t('map.interaction_locked')); // NEU: I18n
            return; // Aktion unterbinden
        }

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

            if (Settings.state.userSettings.isInteractionLocked) {
                displayWarning(I18n.t('map.interaction_locked')); // NEU: I18n
                return; // Aktion unterbinden
            }

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
    // Letzte bekannte Höhen-/QFE-Werte für die Anzeige während der Bewegung
    let lastAltString = '...';
    let lastQfeString = '...';
    let elevationFetchTimeout = null;

    const _buildCoordString = (center) => {
        const coordFormat = Settings.getValue('coordFormat', 'Decimal');
        const coords = Utils.convertCoords(center.lat, center.lng, coordFormat);
        const formatDDM = (ddm) => `${ddm.deg}° ${ddm.min.toFixed(3)}' ${ddm.dir}`;
        const formatDMS = (dms) => `${dms.deg}°${dms.min}'${dms.sec.toFixed(0)}" ${dms.dir}`;

        if (coordFormat === 'MGRS') {
            return `${I18n.t('map.mgrs')}: ${coords.lat}`;
        } else if (coordFormat === 'DMS') {
            return `${I18n.t('map.lat')}: ${formatDMS(coords.lat)}, ${I18n.t('map.lng')}: ${formatDMS(coords.lng)}`;
        } else if (coordFormat === 'DDM') {
            return `${I18n.t('map.lat')}: ${formatDDM(coords.lat)}, ${I18n.t('map.lng')}: ${formatDDM(coords.lng)}`;
        } else {
            return `${I18n.t('map.lat')}: ${center.lat.toFixed(5)}, ${I18n.t('map.lng')}: ${center.lng.toFixed(5)}`;
        }
    };

    const _updateElevationDisplay = (elevation, center) => {
        try {
            const heightUnit = Settings.getValue('heightUnit', 'm');
            let displayElevation = 'N/A';
            if (elevation !== 'N/A' && elevation !== undefined && elevation !== null) {
                const convertedElevation = Utils.convertHeight(elevation, heightUnit);
                displayElevation = Math.round(convertedElevation);
            }
            lastAltString = displayElevation === 'N/A' ? 'N/A' : `${displayElevation}${heightUnit}`;

            let qfeString = 'N/A';
            if (elevation !== 'N/A' && AppState.weatherData && AppState.weatherData.surface_pressure) {
                const sliderIndex = parseInt(document.getElementById('timeSlider')?.value) || 0;
                const surfacePressure = AppState.weatherData.surface_pressure[sliderIndex];
                const temperature = AppState.weatherData.temperature_2m?.[sliderIndex] || 15;
                const referenceElevation = AppState.lastAltitude !== 'N/A' ? AppState.lastAltitude : 0;
                const qfe = Utils.calculateQFE(surfacePressure, elevation, referenceElevation, temperature);
                qfeString = qfe !== 'N/A' ? `${qfe.toFixed(0)}hPa` : 'N/A';
            }
            lastQfeString = qfeString;

            const coordString = _buildCoordString(center);
            AppState.coordsControl.update(`${coordString}<br>${I18n.t('map.alt')}: ${lastAltString}<br>${I18n.t('map.qfe')}: ${lastQfeString}`);
        } catch (err) {
            console.error('Crosshair elevation display error:', err);
            lastAltString = 'N/A';
            lastQfeString = 'N/A';
        }
    };

    const _fetchElevation = async (center) => {
        try {
            const elevation = await Utils.getAltitude(center.lat, center.lng);
            // Nur aktualisieren, wenn sich die Karte nicht zu weit bewegt hat
            const currentCenter = map.getCenter();
            if (Math.abs(currentCenter.lat - center.lat) > 0.0001 || Math.abs(currentCenter.lng - center.lng) > 0.0001) {
                return;
            }
            _updateElevationDisplay(elevation, currentCenter);
        } catch (err) {
            console.error('Crosshair elevation fetch error:', err);
            _updateElevationDisplay('N/A', map.getCenter());
        }
    };

    // move: Koordinaten live aktualisieren, Höhe/QFE beibehalten
    const handleMapMove = () => {
        const center = map.getCenter();
        const coordString = _buildCoordString(center);
        AppState.coordsControl.update(`${coordString}<br>${I18n.t('map.alt')}: ${lastAltString}<br>${I18n.t('map.qfe')}: ${lastQfeString}`);
    };

    // moveend: Höhe und QFE abrufen, sobald die Karte stillsteht
    const handleMapMoveEnd = () => {
        const center = map.getCenter();
        const coordString = _buildCoordString(center);

        lastAltString = '...';
        lastQfeString = '...';
        AppState.coordsControl.update(`${coordString}<br>${I18n.t('map.alt')}: ...<br>${I18n.t('map.qfe')}: ...`);

        // Eigener Debounce: vorherigen Fetch-Timer abbrechen, neuen starten
        if (elevationFetchTimeout) clearTimeout(elevationFetchTimeout);
        elevationFetchTimeout = setTimeout(() => _fetchElevation(center), 300);
    };

    map.on('move', handleMapMove);
    map.on('moveend', handleMapMoveEnd);
    // Ersten Aufruf direkt auslösen (ohne Debounce, damit initiale Anzeige sofort kommt)
    setTimeout(() => _fetchElevation(map.getCenter()), 500);
    console.log('Crosshair coordinate handler initialized.');
}
function _setupMouseCoordinateHandler(map) {
    map.on('mousemove', _handleMapMouseMove);
    map.on('mouseout', function () {
        if (AppState.coordsControl && AppState.coordsControl.getContainer()) {
            AppState.coordsControl.getContainer().innerHTML = I18n.t('map.move_mouse_over'); // NEU: I18n
        }
    });
    console.log('Mouse coordinate handler initialized.');
}

// Geolocation Handlers

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

    // =================================================================
    // ==== HIER KOMMT DIE FEHLENDE LOGIK HIN                       ====
    // =================================================================
    // Prüfe auf Home DZ, bevor der Default verwendet wird
    const homeDZ = LocationManager.getHomeDZ();
    let startLat, startLng, source, message;

    if (homeDZ) {
        startLat = homeDZ.lat;
        startLng = homeDZ.lng;
        source = 'home_dz_fallback';
        message = I18n.t('messages.home_dz_fallback', { name: homeDZ.label }); // NEU: I18n
    } else {
        startLat = defaultCenter[0];
        startLng = defaultCenter[1];
        source = 'geolocation_fallback';
        message = I18n.t('messages.geolocation_fallback'); // NEU: I18n
    }

    Utils.handleMessage(message);

    // Setzt den Marker auf den korrekten Startpunkt (Home DZ oder Default)
    await createOrUpdateMarker(startLat, startLng);
    AppState.map.setView([startLat, startLng], defaultZoom);
    recenterMap(true);
    AppState.isManualPanning = false;

    // Löst das Event aus, damit die App weitermachen kann
    const mapSelectEvent = new CustomEvent('location:selected', {
        detail: { lat: startLat, lng: startLng, source: source },
        bubbles: true,
        cancelable: true
    });
    AppState.map.getContainer().dispatchEvent(mapSelectEvent);
    console.log(`Dispatched 'location:selected' event from ${source}.`);
    // =================================================================
    // ==== ENDE DER KORREKTUR                                        ====
    // =================================================================
}
async function _handleGeolocation(defaultCenter, defaultZoom) {
    console.log('[MapManager] Getting initial geolocation...');

    try {
        const { Geolocation, isNative } = await getCapacitor();

        // Native Logik (Capacitor)
        if (isNative && Geolocation) {
            // Berechtigungen prüfen, bevor die Position abgefragt wird
            const permissions = await Geolocation.checkPermissions();
            if (permissions.location === 'denied') {
                throw new Error('Permission for location was denied.');
            }
            // Wenn nicht bereits erteilt, Berechtigung anfordern
            if (permissions.location !== 'granted') {
                const requestResult = await Geolocation.requestPermissions({ permissions: ['location'] });
                if (requestResult.location !== 'granted') {
                    throw new Error('Permission for location not granted.');
                }
            }

            // Nur die einmalige, aktuelle Position abfragen
            const position = await Geolocation.getCurrentPosition({
                enableHighAccuracy: true,
                timeout: UI_DEFAULTS.GEOLOCATION_TIMEOUT_MS,
                maximumAge: 0
            });
            await _geolocationSuccessCallback(position, defaultZoom);

        } else if (navigator.geolocation) { // Web-Fallback
            navigator.geolocation.getCurrentPosition(
                (position) => _geolocationSuccessCallback(position, defaultZoom),
                (geoError) => _geolocationErrorCallback(geoError, defaultCenter, defaultZoom),
                {
                    enableHighAccuracy: true,
                    timeout: UI_DEFAULTS.GEOLOCATION_TIMEOUT_MS,
                    maximumAge: 0
                }
            );
        } else {
            throw new Error('Geolocation is not supported on this device.');
        }
    } catch (error) {
        console.warn(`[MapManager] Initial geolocation failed. Using fallback. Error: ${error.message}`);
        await _geolocationErrorCallback(error, defaultCenter, defaultZoom);
    }
}
export function toggleGeoManControls(locked) {
    if (!AppState.map || !AppState.map.pm) return;
    const toolbar = document.querySelector('.leaflet-pm-toolbar');

    if (locked) {
        // Toolbar sofort ausblenden, um weitere Klicks zu verhindern
        if (toolbar) toolbar.style.display = 'none';

        // WICHTIG: Nur die Modi deaktivieren, die auch wirklich aktiv sind.
        if (AppState.map.pm.globalDrawModeEnabled()) {
            AppState.map.pm.disableDraw();
        }
        if (AppState.map.pm.globalEditModeEnabled()) {
            AppState.map.pm.disableGlobalEditMode();
        }
        if (AppState.map.pm.globalRemovalModeEnabled()) {
            AppState.map.pm.disableGlobalRemovalMode();
        }
    } else {
        // Toolbar wieder anzeigen
        if (toolbar) toolbar.style.display = 'block';
    }
}
export function updateCoordsDisplay(text) {
    // AppState.coordsControl wurde in _initializeCoordsControlAndHandlers erstellt.
    if (AppState.coordsControl) {
        AppState.coordsControl.update(text);
    }
}
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
function _handleMapDblClick(e) {
    if (Settings.state.userSettings.isInteractionLocked) {
        displayWarning(I18n.t('map.interaction_locked')); // NEU: I18n
        return;
    }
    if (!Settings.state.userSettings.showCutAwayFinder) {
        return;
    }
    const { lat, lng } = e.latlng;

    if (AppState.cutAwayMarker) {
        AppState.cutAwayMarker.setLatLng([lat, lng]);
    } else {
        AppState.cutAwayMarker = createCutAwayMarker(lat, lng).addTo(AppState.map);
        attachCutAwayMarkerDragend(AppState.cutAwayMarker);
    }

    AppState.cutAwayLat = lat;
    AppState.cutAwayLng = lng;
    updateCutAwayMarkerPopup(AppState.cutAwayMarker, lat, lng);

    const cutawayEvent = new CustomEvent('cutaway:marker_placed', {
        bubbles: true
    });
    AppState.map.getContainer().dispatchEvent(cutawayEvent);
}
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