// rainRadarManager.js
"use strict";

import { AppState } from './state.js';

const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';
const RAINVIEWER_TILE_HOST = 'https://tilecache.rainviewer.com';
const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const ANIMATION_SPEED_MS = 800;
const DEFAULT_OPACITY = 0.5;
const RADAR_MAX_NATIVE_ZOOM = 7; // RainViewer tiles natively available up to ~zoom 7 in most regions

// All preloaded L.TileLayer instances (one per radar frame)
let preloadedLayers = [];
// The frame metadata from the API ({time, path}[])
let radarFrames = [];
// The user-selected display opacity
let activeOpacity = DEFAULT_OPACITY;
// True when radar is suppressed because timeslider is in the future
let isSuppressed = false;

/**
 * Fetches the latest radar metadata from RainViewer.
 * @returns {Promise<{time: number, path: string}[]>}
 */
async function fetchRadarFrames() {
    const response = await fetch(RAINVIEWER_API);
    if (!response.ok) throw new Error(`RainViewer API error: ${response.status}`);
    const data = await response.json();
    return data.radar?.past || [];
}

/**
 * Creates a Leaflet TileLayer for a given radar frame path.
 * Layer is added to the map immediately but hidden (opacity 0)
 * so tiles are preloaded into the browser cache.
 * @param {string} path - Tile path from the API (e.g. "/v2/radar/1711234567").
 * @returns {L.TileLayer}
 */
function _createLayer(path) {
    const url = `${RAINVIEWER_TILE_HOST}${path}/256/{z}/{x}/{y}/2/1_1.png`;
    return L.tileLayer(url, {
        opacity: 0, // hidden until needed
        zIndex: 1000,
        maxNativeZoom: RADAR_MAX_NATIVE_ZOOM,
        maxZoom: 19,
        attribution: '<a href="https://www.rainviewer.com/" target="_blank">RainViewer</a>',
        transparent: true
    });
}

/**
 * Removes all preloaded layers from the map and resets state.
 */
function _removeAllLayers() {
    for (const layer of preloadedLayers) {
        if (AppState.map) AppState.map.removeLayer(layer);
    }
    preloadedLayers = [];
    radarFrames = [];
    AppState.radarLayer = null;
}

/**
 * Preloads all radar frame layers onto the map (hidden).
 * Then makes the latest frame visible.
 */
async function _loadAndPreloadFrames() {
    radarFrames = await fetchRadarFrames();
    if (!radarFrames.length) {
        console.warn('RainViewer: No radar frames available.');
        return false;
    }

    AppState.radarTimestamps = radarFrames.map(f => f.time);

    // Create all layers and add to map (hidden at opacity 0)
    preloadedLayers = radarFrames.map(frame => {
        const layer = _createLayer(frame.path);
        layer.addTo(AppState.map);
        return layer;
    });

    // Show latest frame
    const lastIndex = preloadedLayers.length - 1;
    preloadedLayers[lastIndex].setOpacity(activeOpacity);
    AppState.radarLayer = preloadedLayers[lastIndex];
    AppState.radarCurrentIndex = lastIndex;

    return true;
}

/**
 * Shows the latest radar frame on the map.
 */
export async function showRadar() {
    if (!AppState.map) return;

    try {
        activeOpacity = _getStoredOpacity();
        _removeAllLayers();

        const success = await _loadAndPreloadFrames();
        if (!success) return;

        AppState.isRadarVisible = true;
        _startAutoRefresh();
        _updateTimestampDisplay();

        console.log(`RainViewer: ${preloadedLayers.length} frames preloaded, showing latest.`);
    } catch (error) {
        console.error('RainViewer: Failed to load radar data:', error);
    }
}

/**
 * Hides the radar overlay and stops all timers.
 */
export function hideRadar() {
    stopAnimation();
    _stopAutoRefresh();
    _removeAllLayers();
    isSuppressed = false;
    AppState.radarTimestamps = [];
    AppState.radarCurrentIndex = -1;
    AppState.isRadarVisible = false;
    _updateTimestampDisplay();
}

/**
 * Toggles radar visibility.
 */
export async function toggleRadar() {
    if (AppState.isRadarVisible) {
        hideRadar();
    } else {
        await showRadar();
    }
}

/**
 * Sets radar layer opacity and applies it to the currently visible frame.
 * @param {number} opacity - Value between 0 and 1.
 */
export function setOpacity(opacity) {
    activeOpacity = Math.max(0, Math.min(1, opacity));

    // Apply to the currently visible layer
    if (AppState.radarLayer) {
        AppState.radarLayer.setOpacity(activeOpacity);
    }

    try {
        localStorage.setItem('radarOpacity', activeOpacity.toString());
    } catch (e) { /* ignore storage errors */ }
}

/**
 * Starts animated playback through all preloaded frames.
 * No new HTTP requests — just toggles opacity on existing layers.
 */
export function startAnimation() {
    if (!preloadedLayers.length || AppState.radarAnimationTimer) return;

    AppState.radarCurrentIndex = 0;
    AppState.radarAnimationTimer = setInterval(() => {
        _switchToFrame(AppState.radarCurrentIndex);
        AppState.radarCurrentIndex = (AppState.radarCurrentIndex + 1) % preloadedLayers.length;
    }, ANIMATION_SPEED_MS);
}

/**
 * Stops animation playback and shows the latest frame.
 */
export function stopAnimation() {
    if (AppState.radarAnimationTimer) {
        clearInterval(AppState.radarAnimationTimer);
        AppState.radarAnimationTimer = null;
    }
    // Jump to latest frame
    if (preloadedLayers.length && AppState.isRadarVisible) {
        _switchToFrame(preloadedLayers.length - 1);
    }
}

/**
 * Returns whether animation is currently playing.
 * @returns {boolean}
 */
export function isAnimating() {
    return AppState.radarAnimationTimer !== null;
}

/**
 * Called when the timeslider changes. Suppresses radar display when the
 * selected time is more than ±1h away from the current UTC time.
 *
 * weatherData.time[] strings from Open-Meteo are UTC but lack a trailing "Z",
 * so we append it before parsing to ensure correct interpretation.
 *
 * @param {string} isoTimeString - The ISO time string from weatherData.time[index] (UTC, no "Z").
 */
export function handleTimeChange(isoTimeString) {
    if (!AppState.isRadarVisible || !preloadedLayers.length) return;

    // Ensure the time string is parsed as UTC (Open-Meteo omits the "Z")
    const utcString = isoTimeString.endsWith('Z') ? isoTimeString : isoTimeString + 'Z';
    const selectedTime = new Date(utcString).getTime();
    const now = Date.now();
    const TOLERANCE_MS = 60 * 60 * 1000; // 1 hour

    // Radar is only valid for "around now" — suppress if slider is too far away
    const isOutOfRange = Math.abs(selectedTime - now) > TOLERANCE_MS;

    if (isOutOfRange && !isSuppressed) {
        isSuppressed = true;
        for (const layer of preloadedLayers) {
            layer.setOpacity(0);
        }
        _updateTimestampDisplay();
    } else if (!isOutOfRange && isSuppressed) {
        isSuppressed = false;
        _switchToFrame(preloadedLayers.length - 1);
    }
}

/**
 * Returns whether the radar is currently suppressed due to timeslider out of range.
 * @returns {boolean}
 */
export function isRadarSuppressed() {
    return isSuppressed;
}

// --- Private helpers ---

/**
 * Switches visibility: hides all layers, then shows the target frame.
 * @param {number} index - The frame index to display.
 */
function _switchToFrame(index) {
    if (!preloadedLayers[index]) return;

    // Hide all frames
    for (const layer of preloadedLayers) {
        layer.setOpacity(0);
    }

    // Show the target frame
    preloadedLayers[index].setOpacity(activeOpacity);
    AppState.radarLayer = preloadedLayers[index];
    AppState.radarCurrentIndex = index;
    _updateTimestampDisplay();
}

function _startAutoRefresh() {
    _stopAutoRefresh();
    AppState.radarRefreshTimer = setInterval(async () => {
        if (AppState.isRadarVisible && !AppState.radarAnimationTimer) {
            try {
                // Reload all frames (new data available)
                _removeAllLayers();
                await _loadAndPreloadFrames();
                _updateTimestampDisplay();
            } catch (e) {
                console.warn('RainViewer: Auto-refresh failed:', e);
            }
        }
    }, REFRESH_INTERVAL_MS);
}

function _stopAutoRefresh() {
    if (AppState.radarRefreshTimer) {
        clearInterval(AppState.radarRefreshTimer);
        AppState.radarRefreshTimer = null;
    }
}

function _getStoredOpacity() {
    try {
        const stored = localStorage.getItem('radarOpacity');
        if (stored !== null) {
            const val = parseFloat(stored);
            if (Number.isFinite(val) && val > 0) return val;
        }
    } catch (e) { /* ignore */ }
    return DEFAULT_OPACITY;
}

function _updateTimestampDisplay() {
    const el = document.getElementById('radarTimestamp');
    if (!el) return;

    if (!AppState.isRadarVisible || AppState.radarCurrentIndex < 0) {
        el.textContent = '';
        return;
    }

    if (isSuppressed) {
        el.textContent = '⏸';
        return;
    }

    const ts = AppState.radarTimestamps[AppState.radarCurrentIndex];
    if (ts) {
        const date = new Date(ts * 1000);
        el.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
}
