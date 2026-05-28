import { AppState } from './state.js';
import { Settings } from './settings.js';

const MAX_PINS = 4;

/**
 * Erstellt einen neuen Pin aus der aktuellen Sprungberechnung.
 * @param {object} visualizationData - Exit-/Canopy-Kreisdaten
 * @param {object} trackDrawData - JRT-Zeichendaten
 * @param {object} trackData - Rohe JRT-Ergebnisdaten
 * @returns {object|null} Der erstellte Pin oder null
 */
export function createPin(visualizationData, trackDrawData, trackData) {
    if (!AppState.harpMarker) return null;
    if (AppState.pinnedJumps.length >= MAX_PINS) return null;

    const harpPos = AppState.harpMarker.getLatLng();
    const id = _getNextPinId();
    if (id === null) return null;

    const pin = {
        id,
        harpLatLng: { lat: harpPos.lat, lng: harpPos.lng },
        visualizationData: _deepClone(visualizationData),
        trackDrawData: _deepClone(trackDrawData),
        trackData: trackData ? _deepClone(trackData) : null,
        openingAltitude: Settings.state.userSettings.openingAltitude,
        exitAltitude: Settings.state.userSettings.exitAltitude,
        marker: null,
        isActive: false
    };

    AppState.pinnedJumps.push(pin);
    console.log(`[PinManager] Pin ${id} erstellt (${AppState.pinnedJumps.length}/${MAX_PINS})`);
    return pin;
}

/**
 * Aktiviert einen Pin — deaktiviert alle anderen.
 * @param {number} pinId - Die ID des zu aktivierenden Pins
 * @returns {object|null} Der aktivierte Pin
 */
export function activatePin(pinId) {
    AppState.pinnedJumps.forEach(p => { p.isActive = false; });
    const pin = AppState.pinnedJumps.find(p => p.id === pinId);
    if (pin) {
        pin.isActive = true;
        AppState.activePinId = pinId;
        console.log(`[PinManager] Pin ${pinId} aktiviert`);
    }
    return pin;
}

/**
 * Entfernt einen einzelnen Pin.
 * @param {number} pinId - Die ID des zu entfernenden Pins
 * @returns {object|null} Der entfernte Pin
 */
export function removePin(pinId) {
    const index = AppState.pinnedJumps.findIndex(p => p.id === pinId);
    if (index === -1) return null;

    const [removed] = AppState.pinnedJumps.splice(index, 1);
    console.log(`[PinManager] Pin ${pinId} entfernt (${AppState.pinnedJumps.length}/${MAX_PINS})`);

    if (AppState.activePinId === pinId) {
        AppState.activePinId = null;
    }
    return removed;
}

/**
 * Entfernt alle Pins.
 * @returns {object[]} Array der entfernten Pins
 */
export function clearAllPins() {
    const pins = [...AppState.pinnedJumps];
    AppState.pinnedJumps = [];
    AppState.activePinId = null;
    if (pins.length > 0) {
        console.log(`[PinManager] Alle ${pins.length} Pins gelöscht`);
    }
    return pins;
}

/**
 * Gibt den aktiven Pin zurück.
 * @returns {object|null}
 */
export function getActivePin() {
    return AppState.pinnedJumps.find(p => p.isActive) || null;
}

/**
 * Gibt die Anzahl der Pins zurück.
 * @returns {number}
 */
export function getPinCount() {
    return AppState.pinnedJumps.length;
}

function _getNextPinId() {
    const used = new Set(AppState.pinnedJumps.map(p => p.id));
    for (let i = 1; i <= MAX_PINS; i++) {
        if (!used.has(i)) return i;
    }
    return null;
}

function _deepClone(obj) {
    if (obj == null) return null;
    return JSON.parse(JSON.stringify(obj, (key, value) => {
        // L.latLng-Objekte zu [lat, lng] Arrays konvertieren
        if (value && typeof value === 'object' && !Array.isArray(value) &&
            'lat' in value && 'lng' in value && Object.keys(value).length === 2) {
            return [value.lat, value.lng];
        }
        return value;
    }));
}
