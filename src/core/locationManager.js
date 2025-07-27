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
    try {
        // 1. Die URL wird auf die Open-Meteo Geocoding API umgestellt.
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=10&language=de&format=json`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Geocoding API Error: ${response.statusText}`);
        }
        const data = await response.json();

        // 2. Die Antwort der API wird in das Format umgewandelt, das die UI erwartet.
        if (!data.results) {
            return []; // Keine Ergebnisse gefunden
        }

        const formattedResults = data.results.map(item => {
            // Wir bauen einen aussagekräftigen Anzeigenamen zusammen.
            const displayNameParts = [
                item.name,
                item.admin1, // z.B. Bundesland oder Region
                item.country
            ];

            return {
                // Filtern leere Teile heraus und verbinden sie mit Kommas
                display_name: displayNameParts.filter(Boolean).join(', '),
                lat: item.latitude,
                lon: item.longitude
            };
        });

        // Ergebnis im Cache speichern
        searchCache[query] = formattedResults;
        localStorage.setItem('searchCache', JSON.stringify(searchCache));

        return formattedResults; // Die formatierten Ergebnisse zurückgeben

    } catch (error) {
        console.error("Search failed:", error);
        Utils.handleError("Could not find location. Please check network.");
        return [];
    }
}

/**
 * Finds parachuting-related POIs in a bounding box using Overpass API.
 * @param {number} minLat - Minimum latitude of the bounding box.
 * @param {number} minLon - Minimum longitude of the bounding box.
 * @param {number} maxLat - Maximum latitude of the bounding box.
 * @param {number} maxLon - Maximum longitude of the bounding box.
 * @returns {Promise<Array>} Array of POIs with {display_name, lat, lon, type}.
 */
export async function findParachutingPOIs(minLat, minLon, maxLat, maxLon) {
    console.log('findParachutingPOIs: Searching for POIs in bbox:', { minLat, minLon, maxLat, maxLon });

    // Validate bounding box
    if (isNaN(minLat) || isNaN(minLon) || isNaN(maxLat) || isNaN(maxLon) ||
        minLat < -90 || maxLat > 90 || minLon < -180 || maxLon > 180 ||
        minLat > maxLat || minLon > maxLon) {
        console.error('findParachutingPOIs: Invalid bounding box coordinates');
        Utils.handleError('Invalid map bounds for POI search.');
        return [];
    }

    // Cache key based on bounding box
    const cacheKey = `parachutingPOIs_${minLat}_${minLon}_${maxLat}_${maxLon}`;
    if (searchCache[cacheKey]) {
        console.log('findParachutingPOIs: Returning cached results for bbox:', cacheKey);
        return searchCache[cacheKey];
    }

    try {
        // Overpass QL query for parachuting-related POIs
        const overpassQuery = `
            [out:json][timeout:50][bbox:${minLat},${minLon},${maxLat},${maxLon}];
            (
                node["sport"="parachuting"];
                way["sport"="parachuting"];
                relation["sport"="parachuting"];
                node["name"~"Skydive",i];
                way["name"~"Skydive",i];
                relation["name"~"Skydive",i];
                node["name"~"Fallschirmspringen",i];
                way["name"~"Fallschirmspringen",i];
                relation["name"~"Fallschirmspringen",i];
                node["tourism"="attraction"]["name"~"Skydive",i];
                node["tourism"="attraction"]["name"~"Fallschirmspringen",i];
                node["aeroway"="aerodrome"]["destination"~"skydiving",i];
                way["aeroway"="aerodrome"]["destination"~"skydiving",i];
                node["leisure"="sports_centre"]["sport"~"parachuting",i];
                way["leisure"="sports_centre"]["sport"~"parachuting",i];
                node["aeroway"="aerodrome"]["name"~"Flugplatz",i];
                way["aeroway"="aerodrome"]["name"~"Flugplatz",i];
            );
            out center;
        `;
        const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`;

        console.log('findParachutingPOIs: Sending Overpass query:', overpassQuery);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Overpass API Error: ${response.statusText}`);
        }
        const data = await response.json();

        console.log('findParachutingPOIs: Raw Overpass response:', data);

        const results = data.elements.map(item => {
            const tags = item.tags || {};
            const displayNameParts = [
                tags.name,
                tags["addr:street"] || tags.street,
                tags["addr:city"] || tags.city,
                tags["addr:state"] || tags.state,
                tags["addr:country"] || tags.country,
                tags['sport'] ? `(${tags['sport']})` : null,
                tags['aeroway'] === 'aerodrome' ? '(Airfield)' : null
            ].filter(Boolean).join(', ');

            return {
                display_name: displayNameParts || 'Unnamed Parachuting Location',
                lat: item.lat || item.center?.lat,
                lon: item.lon || item.center?.lon,
                type: tags['sport'] || tags['aeroway'] || tags['leisure'] || 'parachuting'
            };
        });

        // Filter out duplicates based on proximity (within 100m)
        const uniqueResults = [];
        const seenCoords = new Set();
        for (const result of results) {
            const coordKey = `${result.lat.toFixed(5)}_${result.lon.toFixed(5)}`;
            if (!seenCoords.has(coordKey)) {
                seenCoords.add(coordKey);
                uniqueResults.push(result);
            }
        }

        console.log('findParachutingPOIs: Caching results for bbox:', cacheKey);
        searchCache[cacheKey] = uniqueResults;
        localStorage.setItem('searchCache', JSON.stringify(searchCache));

        if (uniqueResults.length === 0) {
            console.log('findParachutingPOIs: No parachuting POIs found in bbox');
            Utils.handleMessage('No parachuting locations found in this area.');
        } else {
            console.log('findParachutingPOIs: Found POIs:', uniqueResults);
            Utils.handleMessage(`Found ${uniqueResults.length} parachuting location(s) in this area.`);
        }

        return uniqueResults;
    } catch (error) {
        console.error('findParachutingPOIs: Search failed:', error);
        Utils.handleError('Could not find parachuting locations. Please check network.');
        return [];
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