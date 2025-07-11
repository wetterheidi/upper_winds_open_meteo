// In: src/ui-web/coordinates.js

"use strict";

import { Utils } from '../core/utils.js';
import * as mgrs from 'mgrs';
import { AppState } from '../core/state.js';

let isAddingFavorite = false;
let currentFavoriteData = null; // Zum Speichern der Daten für das Modal

/**
 * Initialisiert das gesamte Location-Search-Modul für die Web-App.
 */
export function initializeLocationSearch() {
    const searchInput = document.getElementById('locationSearchInput'); // Angepasst an Web-HTML
    const resultsList = document.getElementById('locationResults');
    const saveFavoriteBtn = document.getElementById('saveFavoriteBtn');
    const favoriteModal = document.getElementById('favoriteModal');
    const favoriteNameInput = document.getElementById('favoriteNameInput');
    const submitFavoriteName = document.getElementById('submitFavoriteName');
    const cancelFavoriteName = document.getElementById('cancelFavoriteName');

    if (!searchInput || !resultsList || !saveFavoriteBtn || !favoriteModal) {
        console.error('Einige UI-Elemente für die Ortssuche wurden nicht gefunden.');
        return;
    }

    const debouncedSearch = Utils.debounce(performSearch, 300);

    searchInput.addEventListener('input', () => debouncedSearch(searchInput.value));
    
    // Event-Listener für das Speichern des aktuellen Ortes
    saveFavoriteBtn.addEventListener('click', () => {
        if (AppState.lastLat === null || AppState.lastLng === null) {
            Utils.handleError("Please select a location on the map first.");
            return;
        }
        currentFavoriteData = { 
            lat: AppState.lastLat, 
            lng: AppState.lastLng, 
            defaultName: `DIP at ${AppState.lastLat.toFixed(4)}, ${AppState.lastLng.toFixed(4)}`
        };
        favoriteNameInput.value = currentFavoriteData.defaultName;
        favoriteModal.style.display = 'flex'; // Modal anzeigen
    });

    // Event-Listener für das Bestätigen des Favoritennamens
    submitFavoriteName.addEventListener('click', () => {
        if (currentFavoriteData) {
            const name = favoriteNameInput.value.trim() || currentFavoriteData.defaultName;
            addOrUpdateFavorite(currentFavoriteData.lat, currentFavoriteData.lng, name);
        }
        favoriteModal.style.display = 'none';
        currentFavoriteData = null;
    });

    // Event-Listener für das Abbrechen im Modal
    cancelFavoriteName.addEventListener('click', () => {
        favoriteModal.style.display = 'none';
        currentFavoriteData = null;
    });

    // Initial das Panel mit Favoriten/Verlauf füllen
    renderResultsList();
}


/**
 * Führt die Suche aus, basierend auf der Benutzereingabe.
 * Unterscheidet zwischen Koordinaten und Suchbegriffen.
 * @param {string} query - Die Eingabe des Benutzers.
 */
async function performSearch(query) {
    if (!query.trim()) {
        renderResultsList(); // Ohne Query, zeige Favoriten/Verlauf
        return;
    }
    let searchResults = [];
    const parsedCoords = parseQueryAsCoordinates(query);
    if (parsedCoords) {
        searchResults.push({
            display_name: `Coordinate: ${parsedCoords.lat.toFixed(5)}, ${parsedCoords.lng.toFixed(5)}`,
            lat: parsedCoords.lat,
            lon: parsedCoords.lng,
            type: 'coordinate'
        });
    } else {
        try {
            const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`;
            const response = await fetch(url, { headers: { 'User-Agent': 'Skydiving-Weather-App/1.0' } });
            if (!response.ok) throw new Error(`Nominatim API Error: ${response.statusText}`);
            searchResults = await response.json();
        } catch (error) {
            console.error('Fehler bei der Geocoding-Suche:', error);
            Utils.handleError("Could not find location.");
        }
    }
    renderResultsList(searchResults);
}

/**
 * Rendert die Ergebnisliste, die Favoriten, Verlauf und Suchergebnisse enthält.
 * @param {Array} searchResults - Ein Array mit Suchergebnissen von der API.
 */
function renderResultsList(searchResults = []) {
    const resultsList = document.getElementById('locationResults');
    if (!resultsList) return;

    resultsList.innerHTML = ''; // Liste leeren
    const history = getCoordHistory();
    const favorites = history.filter(item => item.isFavorite);
    const nonFavorites = history.filter(item => !item.isFavorite);

    const createSection = (title, items, isSearchResult = false) => {
        if (items.length === 0) return;

        const section = document.createElement('div');
        section.className = 'search-section';
        const heading = document.createElement('h5');
        heading.textContent = title;
        section.appendChild(heading);
        const ul = document.createElement('ul');

        items.forEach(item => {
            const li = createListItem(item);
            if (li) ul.appendChild(li);
        });
        section.appendChild(ul);
        resultsList.appendChild(section);
    };

    const createListItem = (item) => {
        const li = document.createElement('li');
        li.className = 'search-item';
        const lat = parseFloat(item.lat);
        const lng = parseFloat(item.lng || item.lon);
        if (isNaN(lat) || isNaN(lng)) return null;

        li.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('location:selected', { detail: { lat, lng, source: 'search' }, bubbles: true }));
            addCoordToHistory(lat, lng, item.display_name || item.label, item.isFavorite);
        });

        const nameSpan = document.createElement('span');
        nameSpan.className = 'search-item-text';
        nameSpan.innerHTML = `<span class="name">${item.display_name || item.label}</span>`;
        li.appendChild(nameSpan);

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'search-item-actions';

        const favToggle = document.createElement('button');
        favToggle.className = `favorite-toggle ${item.isFavorite ? 'is-favorite' : ''}`;
        favToggle.innerHTML = '★';
        favToggle.title = "Toggle favorite";
        favToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavorite(lat, lng, item.display_name || item.label);
        });
        actionsDiv.appendChild(favToggle);
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.textContent = '×';
        deleteBtn.title = "Delete this entry";
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Delete "${item.display_name || item.label}"?`)) {
                removeLocationFromHistory(lat, lng);
            }
        });
        actionsDiv.appendChild(deleteBtn);

        li.appendChild(actionsDiv);
        return li;
    };

    createSection('Results', searchResults, true);
    createSection('Favorites', favorites);
    createSection('Recent Searches', nonFavorites);
}

// --- Funktionen zur Verwaltung von localStorage & Favoriten (unverändert aus mobile) ---

/**
 * Versucht, eine Benutzereingabe als Koordinate zu parsen.
 * @param {string} query - Die Eingabe des Benutzers.
 * @returns {object|null} Ein Objekt mit {lat, lng} oder null.
 */
export function parseQueryAsCoordinates(query) {
    const trimmedQuery = query.trim();
    
    // Versuch 1: Dezimalgrad (z.B. "48.123 -11.456" oder "48.123, -11.456")
    const cleanedForDecimal = trimmedQuery.replace(/[,;\t]+/g, ' ').trim();
    const decMatch = cleanedForDecimal.match(/^(-?\d{1,3}(?:\.\d+)?)\s+(-?\d{1,3}(?:\.\d+)?)$/);
    if (decMatch) {
        const lat = parseFloat(decMatch[1]);
        const lng = parseFloat(decMatch[2]);
        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
            return { lat, lng };
        }
    }

    // Versuch 2: MGRS
    const cleanedForMgrs = trimmedQuery.replace(/\s/g, '').toUpperCase();
    // Die Regex prüft auf das grundlegende MGRS-Format
    const mgrsRegex = /^[0-9]{1,2}[C-HJ-NP-X][A-HJ-NP-Z]{2}(\d{2}|\d{4}|\d{6}|\d{8}|\d{10})$/;
    if (mgrsRegex.test(cleanedForMgrs)) {
        try {
            // Die mgrs-Bibliothek selbst validiert die Koordinate final
            const [lng, lat] = mgrs.toPoint(cleanedForMgrs);
            if (!isNaN(lat) && !isNaN(lng)) {
                return { lat, lng };
            }
        } catch (e) {
            // Fehler wird ignoriert, da es sich um eine ungültige MGRS-Koordinate handeln könnte
            console.warn('MGRS parsing failed:', e.message);
            return null;
        }
    }

    // Wenn keine der Prüfungen erfolgreich war
    return null;
}

export function getCoordHistory() {
    try {
        return JSON.parse(localStorage.getItem('coordHistory')) || [];
    } catch (e) { return []; }
}

function saveCoordHistory(history) {
    localStorage.setItem('coordHistory', JSON.stringify(history));
}

export function addCoordToHistory(lat, lng, label, isFavorite = false) {
    if (isNaN(lat) || isNaN(lng)) return;
    let history = getCoordHistory();
    const newLat = parseFloat(lat.toFixed(5));
    const newLng = parseFloat(lng.toFixed(5));
    history = history.filter(entry => Math.abs(entry.lat - newLat) > 0.0001 || Math.abs(entry.lng - newLng) > 0.0001);
    history.unshift({ lat: newLat, lng: newLng, label: label, isFavorite: isFavorite, timestamp: Date.now() });
    const favorites = history.filter(e => e.isFavorite);
    const nonFavorites = history.filter(e => !e.isFavorite).slice(0, 5);
    saveCoordHistory([...favorites, ...nonFavorites]);
    renderResultsList();
}

function addOrUpdateFavorite(lat, lng, name) {
    let history = getCoordHistory();
    const newLat = parseFloat(lat.toFixed(5));
    const newLng = parseFloat(lng.toFixed(5));
    const existingEntry = history.find(entry => Math.abs(entry.lat - newLat) < 0.0001 && Math.abs(entry.lng - newLng) < 0.0001);
    if (existingEntry) {
        existingEntry.isFavorite = true;
        existingEntry.label = name;
    } else {
        history.unshift({ lat: newLat, lng: newLng, label: name, isFavorite: true, timestamp: Date.now() });
    }
    saveCoordHistory(history);
    Utils.handleMessage(`"${name}" saved as favorite.`);
    renderResultsList();
    _dispatchFavoritesUpdate();
}

function toggleFavorite(lat, lng, defaultName) {
    let history = getCoordHistory();
    const entry = history.find(e => Math.abs(e.lat - lat) < 0.0001 && Math.abs(e.lng - lng) < 0.0001);
    if (entry) {
        entry.isFavorite = !entry.isFavorite;
        entry.label = entry.isFavorite ? (prompt("Enter a name for this favorite:", entry.label) || entry.label) : entry.label;
        if (!entry.isFavorite) Utils.handleMessage(`"${entry.label}" removed from favorites.`);
    } else {
        const name = prompt("Enter a name for this favorite:", defaultName);
        if (name) addOrUpdateFavorite(lat, lng, name);
    }
    saveCoordHistory(history);
    renderResultsList();
    _dispatchFavoritesUpdate();
}

function removeLocationFromHistory(lat, lng) {
    let history = getCoordHistory();
    const updatedHistory = history.filter(entry => Math.abs(entry.lat - lat) > 0.0001 || Math.abs(entry.lng - lng) > 0.0001);
    saveCoordHistory(updatedHistory);
    Utils.handleMessage("Location deleted.");
    renderResultsList();
    _dispatchFavoritesUpdate();
}

function _dispatchFavoritesUpdate() {
    const favorites = getCoordHistory().filter(item => item.isFavorite);
    document.dispatchEvent(new CustomEvent('favorites:updated', { detail: { favorites }, bubbles: true }));
}

