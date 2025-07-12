import { Utils } from './utils.js';
import * as mgrs from 'mgrs';

let searchCache = JSON.parse(localStorage.getItem('searchCache')) || {};
let isAddingFavorite = false; 

/**
 * Attempts to parse user input as coordinates.
 * @param {string} query - The user's input.
 * @returns {object|null} An object with {lat, lng} or null.
 */
export function parseQueryAsCoordinates(query) {
    console.log('parseQueryAsCoordinates: Parsing query:', query);
    const trimmedQuery = query.trim();
    const cleanedForDecimal = trimmedQuery.replace(/[,;\t]+/g, ' ').trim();
    // Flexible regex for decimal degrees: e.g., "48.1234 11.5678" or "-48.1234,11.5678"
    const decMatch = cleanedForDecimal.match(/^(-?\d{1,3}(?:\.\d+)?)\s+(-?\d{1,3}(?:\.\d+)?)$/);
    if (decMatch) {
        console.log('parseQueryAsCoordinates: Regex match:', decMatch);
        const lat = parseFloat(decMatch[1]);
        const lng = parseFloat(decMatch[2]);
        console.log('parseQueryAsCoordinates: Decimal degrees detected:', { lat, lng });
        if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
            return { lat, lng };
        } else {
            console.warn('parseQueryAsCoordinates: Invalid coordinate ranges:', { lat, lng });
        }
    }
    const cleanedForMgrs = trimmedQuery.replace(/\s/g, '').toUpperCase();
    const mgrsRegex = /^[0-9]{1,2}[C-HJ-NP-X][A-HJ-NP-Z]{2}(\d{2}|\d{4}|\d{6}|\d{8}|\d{10})$/;
    if (typeof mgrs === 'undefined') {
        console.warn('parseQueryAsCoordinates: MGRS library not loaded');
        return null;
    }
    if (mgrsRegex.test(cleanedForMgrs)) {
        try {
            const [lng, lat] = mgrs.toPoint(cleanedForMgrs);
            console.log('parseQueryAsCoordinates: MGRS detected:', { lat, lng });
            if (!isNaN(lat) && !isNaN(lng)) {
                return { lat, lng };
            } else {
                console.warn('parseQueryAsCoordinates: Invalid MGRS coordinates:', { lat, lng });
            }
        } catch (e) {
            console.warn('parseQueryAsCoordinates: MGRS parsing failed:', e.message);
            return null;
        }
    }
    console.log('parseQueryAsCoordinates: No coordinates detected');
    return null;
}

/**
 * Local Storage Management
 */
export function getCoordHistory() {
    console.log('getCoordHistory: Retrieving history');
    try {
        const history = JSON.parse(localStorage.getItem('coordHistory')) || [];
        console.log('getCoordHistory: History retrieved:', history);
        return history;
    } catch (e) {
        console.error('getCoordHistory: Error retrieving history:', e);
        return [];
    }
}

export function saveCoordHistory(history) {
    console.log('saveCoordHistory: Saving history:', history);
    try {
        localStorage.setItem('coordHistory', JSON.stringify(history));
        console.log('saveCoordHistory: History saved');
    } catch (e) {
        console.error('saveCoordHistory: Error saving history:', e);
    }
}

export function addCoordToHistory(lat, lng, label, isFavorite = false) {
    console.log('addCoordToHistory: Adding:', { lat, lng, label, isFavorite });
    if (isNaN(lat) || isNaN(lng)) {
        console.error('addCoordToHistory: Invalid coordinates');
        return;
    }
    let history = getCoordHistory();
    const newLat = parseFloat(lat.toFixed(5));
    const newLng = parseFloat(lng.toFixed(5));
    history = history.filter(entry => Math.abs(entry.lat - newLat) > 0.001 || Math.abs(entry.lng - newLng) > 0.001);
    history.unshift({ lat: newLat, lng: newLng, label: label, isFavorite: isFavorite, timestamp: Date.now() });
    const favorites = history.filter(e => e.isFavorite);
    const nonFavorites = history.filter(e => !e.isFavorite).slice(0, 5);
    saveCoordHistory([...favorites, ...nonFavorites]);
}

export function addOrUpdateFavorite(lat, lng, name, skipMessage = false) {
    console.log('addOrUpdateFavorite: Processing:', { lat, lng, name });
    if (isNaN(lat) || isNaN(lng)) {
        console.error('addOrUpdateFavorite: Invalid coordinates');
        return;
    }
    if (isAddingFavorite) {
        console.log('addOrUpdateFavorite: Blocked due to ongoing operation');
        return;
    }
    isAddingFavorite = true;
    try {
        let history = getCoordHistory();
        const newLat = parseFloat(lat.toFixed(5));
        const newLng = parseFloat(lng.toFixed(5));
        const existingEntry = history.find(entry => Math.abs(entry.lat - newLat) < 0.001 && Math.abs(entry.lng - newLng) < 0.001);
        if (existingEntry) {
            console.log('addOrUpdateFavorite: Updating existing entry:', existingEntry);
            existingEntry.isFavorite = true;
            existingEntry.label = name;
        } else {
            const newEntry = { lat: newLat, lng: newLng, label: name, isFavorite: true, timestamp: Date.now() };
            console.log('addOrUpdateFavorite: Adding new entry:', newEntry);
            history.unshift(newEntry);
        }
        saveCoordHistory(history);
        if (!skipMessage) {
            Utils.handleMessage(`"${name}" saved as favorite.`);
        }
        _dispatchFavoritesUpdate();
    } catch (error) {
        console.error('addOrUpdateFavorite: Error:', error);
    } finally {
        isAddingFavorite = false;
        console.log('addOrUpdateFavorite: Completed');
    }
}

/**
 * Removes a location from history.
 * @param {number} lat - Latitude of the location.
 * @param {number} lng - Longitude of the location.
 */
export function removeLocationFromHistory(lat, lng) {
    console.log('removeLocationFromHistory: Removing:', { lat, lng });
    if (isNaN(lat) || isNaN(lng)) {
        console.error('removeLocationFromHistory: Invalid coordinates');
        return;
    }
    let history = getCoordHistory();
    const updatedHistory = history.filter(entry => {
        const entryLat = parseFloat(entry.lat);
        const entryLng = parseFloat(entry.lng || entry.lon);
        return Math.abs(entryLat - lat) > 0.001 || Math.abs(entryLng - lng) > 0.001;
    });
    saveCoordHistory(updatedHistory);
    Utils.handleMessage("Location deleted.");
    _dispatchFavoritesUpdate();
}

/**
 * Dispatches an update event for favorites.
 */
export function _dispatchFavoritesUpdate() {
    console.log('_dispatchFavoritesUpdate: Dispatching event');
    const history = getCoordHistory();
    const favorites = history.filter(item => item.isFavorite);
    const event = new CustomEvent('favorites:updated', {
        detail: { favorites: favorites },
        bubbles: true,
        cancelable: true
    });
    document.dispatchEvent(event);
    console.log('_dispatchFavoritesUpdate: Event dispatched');
}

export async function performSearch(query) {
    // --- Phase 1: Eingabe prüfen und Cache nutzen (Logik aus der mobilen Version) ---
    if (!query.trim()) {
        return []; // Leeres Array zurückgeben, wenn die Eingabe leer ist
    }

    const parsedCoords = parseQueryAsCoordinates(query); // Annahme: parse... ist auch hier
    if (parsedCoords) {
        return [{
            display_name: `Coordinate: ${parsedCoords.lat.toFixed(5)}, ${parsedCoords.lng.toFixed(5)}`,
            lat: parsedCoords.lat,
            lon: parsedCoords.lng,
            type: 'coordinate'
        }];
    }

    if (searchCache[query]) {
        return searchCache[query]; // Ergebnisse aus dem Cache zurückgeben
    }

    // --- Phase 2: API-Aufruf mit Wiederholungslogik ---
    const maxRetries = 3;
    const retryDelay = 1500;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`;
            const response = await fetch(url, { headers: { 'User-Agent': 'DZMaster/1.0' } });
            if (!response.ok) {
                throw new Error(`Nominatim API Error: ${response.statusText}`);
            }
            const data = await response.json();
            
            // Ergebnis im Cache speichern
            searchCache[query] = data;
            localStorage.setItem('searchCache', JSON.stringify(searchCache));
            
            return data; // Erfolgreiches Ergebnis zurückgeben

        } catch (error) {
            console.error(`Search attempt ${attempt} failed:`, error);
            if (attempt === maxRetries) {
                // Nach dem letzten Versuch einen Fehler werfen oder ein leeres Array zurückgeben
                Utils.handleError("Could not find location. Please check network.");
                return []; 
            }
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }
}

export function updateFavoriteStatus(lat, lng, name, isFavorite) {
    let history = getCoordHistory(); // getCoordHistory() ist bereits hier
    const newLat = parseFloat(lat.toFixed(5));
    const newLng = parseFloat(lng.toFixed(5));

    const existingEntry = history.find(entry => 
        Math.abs(entry.lat - newLat) < 0.0001 && 
        Math.abs(entry.lng - newLng) < 0.0001
    );

    if (existingEntry) {
        existingEntry.isFavorite = isFavorite;
        // Aktualisiere den Namen nur, wenn es ein neuer Favorit wird
        if (isFavorite) {
            existingEntry.label = name;
        }
    } else if (isFavorite) {
        // Füge einen komplett neuen Favoriten hinzu, falls er nicht im Verlauf war
        history.unshift({ lat: newLat, lng: newLng, label: name, isFavorite: true, timestamp: Date.now() });
    }
    
    saveCoordHistory(history); 
    _dispatchFavoritesUpdate(); 
    
    // Gib eine Erfolgsmeldung zurück
    if (isFavorite) {
        Utils.handleMessage(`"${name}" saved as favorite.`);
    } else {
        Utils.handleMessage(`"${name}" removed from favorites.`);
    }
}