// coordinates.js - Neu gestaltet für eine intuitive Orts-Suche

"use strict";

import { Utils } from '../core/utils.js';
import * as mgrs from 'mgrs';
import { AppState } from '../core/state.js';


let isAddingFavorite = false; // Sperrvariable, um doppelte Aufrufe zu verhindern

/**
 * Initialisiert das gesamte Location-Search-Modul.
 * Diese Funktion wird von app.js aufgerufen.
 */

function initializeLocationSearch() {
    const searchInput = document.getElementById('locationSearchInput');
    const resultsList = document.getElementById('locationResults');
    const saveFavoriteBtn = document.getElementById('saveCurrentLocationBtn');

    if (!searchInput || !resultsList || !saveFavoriteBtn) {
        console.error('Einige UI-Elemente für die Ortssuche wurden nicht gefunden.');
        return;
    }

    const debouncedSearch = Utils.debounce(performSearch, 300);

    searchInput.addEventListener('input', () => { debouncedSearch(searchInput.value); });
    searchInput.addEventListener('focus', () => {
        if (!searchInput.value.trim()) { renderResultsList(); }
        resultsList.style.display = 'block';
    });
    searchInput.addEventListener('blur', () => {
        setTimeout(() => { resultsList.style.display = 'none'; }, 200);
    });

    // Entferne bestehende Listener, falls vorhanden, um Duplikate zu vermeiden
    if (saveFavoriteBtn._clickHandler) {
        saveFavoriteBtn.removeEventListener('click', saveFavoriteBtn._clickHandler);
        console.log('Entfernte bestehenden click-Listener für saveCurrentLocationBtn');
    }
    saveFavoriteBtn._clickHandler = (event) => {
        event.stopPropagation();
        if (AppState.lastLat === null || AppState.lastLng === null) {
            Utils.handleError("Please select a location on the map first.");
            return;
        }
        if (isAddingFavorite) {
            console.log('saveFavoriteBtn Klick blockiert: Ein Favorit wird bereits hinzugefügt.');
            return;
        }
        const defaultName = `DIP at ${AppState.lastLat.toFixed(4)}, ${AppState.lastLng.toFixed(4)}`;
        const name = prompt("Enter a name for this favorite:", defaultName);
        if (name) {
            isAddingFavorite = true;
            try {
                addOrUpdateFavorite(AppState.lastLat, AppState.lastLng, name);
                addCoordToHistory(AppState.lastLat, AppState.lastLng, name, true);
            } finally {
                isAddingFavorite = false;
                console.log('saveFavoriteBtn Aktion abgeschlossen, Sperre aufgehoben.');
            }
        }
    };
    saveFavoriteBtn.addEventListener('click', saveFavoriteBtn._clickHandler);
    console.log('Neuer click-Listener für saveCurrentLocationBtn hinzugefügt');

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !resultsList.contains(e.target)) {
            resultsList.style.display = 'none';
        }
    });
}

/**
 * Führt die Suche aus, basierend auf der Benutzereingabe.
 * Unterscheidet zwischen Koordinaten und Suchbegriffen.
 * @param {string} query - Die Eingabe des Benutzers.
 */
async function performSearch(query) {
    console.log('performSearch: Suche nach:', query);
    if (!query.trim()) {
        console.log('performSearch: Leere Eingabe, zeige Favoriten/Verlauf.');
        renderResultsList();
        return;
    }
    let searchResults = [];
    const parsedCoords = parseQueryAsCoordinates(query);
    if (parsedCoords) {
        console.log('performSearch: Koordinaten gefunden:', parsedCoords);
        searchResults.push({
            display_name: `Koordinate: ${parsedCoords.lat.toFixed(5)}, ${parsedCoords.lng.toFixed(5)}`,
            lat: parsedCoords.lat,
            lon: parsedCoords.lng, // Kompatibel mit renderResultsList
            type: 'coordinate'
        });
        renderResultsList(searchResults);
    } else {
        console.log('performSearch: Keine Koordinaten, starte Nominatim-Suche.');
        try {
            const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`;
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'User-Agent': 'Skydiving-Weather-App/1.0 (anonymous)' }
            });
            if (!response.ok) throw new Error(`Nominatim API Fehler: ${response.statusText}`);
            const data = await response.json();
            console.log('performSearch: Nominatim Ergebnisse:', data);
            searchResults = data;
            renderResultsList(searchResults);
        } catch (error) {
            console.error('Fehler bei der Geocoding-Suche:', error);
            Utils.handleError("Could not find location.");
            renderResultsList([]);
        }
    }
}

/**
 * Versucht, eine Benutzereingabe als Koordinate zu parsen.
 * @param {string} query - Die Eingabe des Benutzers.
 * @returns {object|null} Ein Objekt mit {lat, lng} oder null.
 */
function parseQueryAsCoordinates(query) {
    console.log('parseQueryAsCoordinates: Eingabe:', query);
    const trimmedQuery = query.trim();
    // Unterstütze Kommas, mehrere Leerzeichen oder Tabs
    const cleanedForDecimal = trimmedQuery.replace(/[,;\t]+/, ' ').trim();
    // Flexiblerer Regex für Dezimalgraden: z. B. "48.1234 11.5678" oder "-48.1234,11.5678"
    const decMatch = cleanedForDecimal.match(/^(-?\d{1,3}(?:\.\d+)?)\s+(-?\d{1,3}(?:\.\d+)?)$/);
    if (decMatch) {
        const lat = parseFloat(decMatch[1]);
        const lng = parseFloat(decMatch[3]);
        console.log('parseQueryAsCoordinates: Dezimalgraden erkannt:', { lat, lng });
        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
            return { lat, lng };
        } else {
            console.warn('parseQueryAsCoordinates: Ungültige Koordinatenbereiche:', { lat, lng });
        }
    }
    const cleanedForMgrs = trimmedQuery.replace(/\s/g, '').toUpperCase();
    const mgrsRegex = /^[0-9]{1,2}[C-HJ-NP-X][A-HJ-NP-Z]{2}(\d{2}|\d{4}|\d{6}|\d{8}|\d{10})$/;
    if (typeof mgrs === 'undefined') {
        console.warn('parseQueryAsCoordinates: MGRS-Bibliothek nicht geladen.');
        return null;
    }
    if (mgrsRegex.test(cleanedForMgrs)) {
        try {
            const [lng, lat] = mgrs.toPoint(cleanedForMgrs);
            console.log('parseQueryAsCoordinates: MGRS erkannt:', { lat, lng });
            if (!isNaN(lat) && !isNaN(lng)) {
                return { lat, lng };
            } else {
                console.warn('parseQueryAsCoordinates: Ungültige MGRS-Koordinaten:', { lat, lng });
            }
        } catch (e) {
            console.warn('parseQueryAsCoordinates: MGRS-Parsing fehlgeschlagen:', e.message);
            return null;
        }
    }
    console.log('parseQueryAsCoordinates: Keine Koordinaten erkannt.');
    return null;
}

/**
 * Rendert die Ergebnisliste, die Favoriten, Verlauf und Suchergebnisse enthält.
 * @param {Array} searchResults - Ein Array mit Suchergebnissen von der API.
 */
function renderResultsList(searchResults = []) {
    const resultsList = document.getElementById('locationResults');
    if (!resultsList) {
        console.error('resultsList nicht gefunden.');
        return;
    }
    resultsList.innerHTML = '';
    const history = getCoordHistory();
    const favorites = history.filter(item => item.isFavorite);
    const nonFavorites = history.filter(item => !item.isFavorite);
    console.log('renderResultsList: Favoriten:', favorites);
    console.log('renderResultsList: Verlauf (nicht Favoriten):', nonFavorites);
    console.log('renderResultsList: Suchergebnisse:', searchResults);
    const createListItem = (item) => {
        const li = document.createElement('li');
        const lat = parseFloat(item.lat);
        const lng = parseFloat(item.lng || item.lon);
        if (isNaN(lat) || isNaN(lng)) {
            console.error('Ungültige Koordinaten in createListItem:', item);
            return null;
        }
        console.log('createListItem: Verarbeite Eintrag:', { lat, lng, label: item.display_name || item.label });
        li.dataset.lat = lat;
        li.dataset.lon = lng; // Speichere als lon für Konsistenz mit HTML
        const nameSpan = document.createElement('span');
        nameSpan.className = 'location-name';
        nameSpan.textContent = item.display_name || item.label;
        li.appendChild(nameSpan);
        nameSpan.addEventListener('mousedown', (e) => {
            const selectEvent = new CustomEvent('location:selected', {
                detail: { lat: lat, lng: lng }, // Verwende lng im Event
                bubbles: true,
                cancelable: true
            });
            li.dispatchEvent(selectEvent);
            addCoordToHistory(lat, lng, item.display_name || item.label, item.isFavorite || false);
            resultsList.style.display = 'none';
        });
        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'location-item-buttons';
        const favToggle = document.createElement('button');
        favToggle.className = 'favorite-toggle';
        favToggle.innerHTML = item.isFavorite ? '★' : '☆';
        if (item.isFavorite) favToggle.classList.add('is-favorite');
        favToggle.title = "Als Favorit markieren/entfernen";
        buttonsContainer.appendChild(favToggle);
        favToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('favToggle Klick für:', { lat, lng, label: item.display_name || item.label });
            toggleFavorite(lat, lng, item.display_name || item.label);
        });
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-location-btn';
        deleteBtn.textContent = '×';
        deleteBtn.title = "Diesen Eintrag löschen";
        buttonsContainer.appendChild(deleteBtn);
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Möchten Sie "${item.display_name || item.label}" wirklich löschen?`)) {
                removeLocationFromHistory(lat, lng);
            }
        });
        li.appendChild(buttonsContainer);
        return li;
    };
    if (searchResults.length > 0) {
        const heading = document.createElement('li');
        heading.className = 'results-heading';
        heading.textContent = 'Results';
        heading.style.fontWeight = 'bold';
        heading.style.background = '#f0f0f0';
        resultsList.appendChild(heading);
        searchResults.forEach(result => {
            // Normalisiere Koordinaten für Konsistenz
            const resultLat = parseFloat(result.lat);
            const resultLng = parseFloat(result.lon); // Nominatim liefert lon
            const fav = favorites.find(f => Math.abs(f.lat - resultLat) < 0.001 && Math.abs(f.lng - resultLng) < 0.001);
            result.isFavorite = !!fav;
            if (fav) result.display_name = fav.label;
            // Erstelle Eintrag mit normalisierten Koordinaten
            const normalizedResult = {
                lat: resultLat,
                lng: resultLng, // Verwende lng intern
                display_name: result.display_name,
                isFavorite: result.isFavorite
            };
            const listItem = createListItem(normalizedResult);
            if (listItem) resultsList.appendChild(listItem);
        });
    }
    if (favorites.length > 0) {
        const heading = document.createElement('li');
        heading.className = 'results-heading';
        heading.textContent = 'Favorites';
        heading.style.fontWeight = 'bold';
        heading.style.background = '#f0f0f0';
        resultsList.appendChild(heading);
        favorites.forEach(fav => {
            const listItem = createListItem(fav);
            if (listItem) resultsList.appendChild(listItem);
        });
    }
    if (nonFavorites.length > 0) {
        const heading = document.createElement('li');
        heading.className = 'results-heading';
        heading.textContent = 'Previous Locations';
        heading.style.fontWeight = 'bold';
        heading.style.background = '#f0f0f0';
        resultsList.appendChild(heading);
        nonFavorites.forEach(item => {
            const listItem = createListItem(item);
            if (listItem) resultsList.appendChild(listItem);
        });
    }
    console.log('renderResultsList: Liste gerendert.');
}

// --- Funktionen zur Verwaltung von localStorage ---

function getCoordHistory() {
    try {
        return JSON.parse(localStorage.getItem('coordHistory')) || [];
    } catch (e) {
        return [];
    }
}

function saveCoordHistory(history) {
    try {
        localStorage.setItem('coordHistory', JSON.stringify(history));
    } catch (e) {
        console.error("Error saving history:", e);
    }
}

function addCoordToHistory(lat, lng, label, isFavorite = false) {
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

function addOrUpdateFavorite(lat, lng, name, skipMessage = false) {
    if (isNaN(lat) || isNaN(lng)) {
        console.error('Ungültige Koordinaten in addOrUpdateFavorite:', { lat, lng });
        return;
    }
    if (isAddingFavorite) {
        console.log('addOrUpdateFavorite blockiert.');
        return;
    }
    isAddingFavorite = true;
    try {
        let history = getCoordHistory();
        const newLat = parseFloat(lat.toFixed(5));
        const newLng = parseFloat(lng.toFixed(5));
        console.log('addOrUpdateFavorite: Verarbeite:', { newLat, newLng, name });
        const existingEntry = history.find(entry => Math.abs(entry.lat - newLat) < 0.0001 && Math.abs(entry.lng - newLng) < 0.0001);
        if (existingEntry) {
            console.log('addOrUpdateFavorite: Aktualisiere bestehenden Eintrag:', existingEntry);
            existingEntry.isFavorite = true;
            existingEntry.label = name;
        } else {
            const newEntry = { lat: newLat, lng: newLng, label: name, isFavorite: true, timestamp: Date.now() };
            console.log('addOrUpdateFavorite: Füge neuen Eintrag hinzu:', newEntry);
            history.unshift(newEntry);
        }
        saveCoordHistory(history);
        console.log('addOrUpdateFavorite: Verlauf nach Speicherung:', JSON.stringify(history));
        if (!skipMessage) {
            Utils.handleMessage(`"${name}" als Favorit gespeichert.`);
        }
        renderResultsList();
    } catch (error) {
        console.error('Fehler in addOrUpdateFavorite:', error);
    } finally {
        isAddingFavorite = false;
        console.log('addOrUpdateFavorite abgeschlossen.');
    }
}

function toggleFavorite(lat, lng, label) {
    if (isNaN(lat) || isNaN(lng)) {
        console.error('Ungültige Koordinaten in toggleFavorite:', { lat, lng });
        return;
    }
    if (isAddingFavorite) {
        console.log('toggleFavorite blockiert: Ein Favorit wird bereits hinzugefügt.');
        return;
    }
    let history = getCoordHistory();
    const newLat = parseFloat(lat.toFixed(5));
    const newLng = parseFloat(lng.toFixed(5));
    console.log('toggleFavorite: Suche nach Eintrag mit:', { newLat, newLng, label });
    const entry = history.find(e => {
        const entryLat = parseFloat(e.lat);
        const entryLng = parseFloat(e.lng);
        return Math.abs(entryLat - newLat) < 0.0001 && Math.abs(entryLng - newLng) < 0.0001;
    });
    if (entry) {
        console.log('toggleFavorite: Bestehender Eintrag gefunden:', entry);
        if (entry.isFavorite) {
            entry.isFavorite = false;
            Utils.handleMessage(`"${entry.label}" ist kein Favorit mehr.`);
            saveCoordHistory(history);
            renderResultsList();
        } else {
            isAddingFavorite = true;
            try {
                const name = prompt("Please enter a name for this favorite:", entry.label || label);
                if (name) {
                    entry.isFavorite = true;
                    entry.label = name;
                    Utils.handleMessage(`"${name}" als Favorit gespeichert.`);
                    saveCoordHistory(history);
                    renderResultsList();
                } else {
                    entry.isFavorite = false;
                    return;
                }
            } finally {
                isAddingFavorite = false;
                console.log('toggleFavorite abgeschlossen, Sperre aufgehoben.');
            }
        }
    } else {
        console.log('toggleFavorite: Kein bestehender Eintrag, füge neuen Favoriten hinzu.');
        const name = prompt("Please enter a name for this favorite:", label);
        if (name) {
            addOrUpdateFavorite(newLat, newLng, name);
        }
    }
}

function removeLocationFromHistory(lat, lng) {
    if (isNaN(lat) || isNaN(lng)) return;
    let history = getCoordHistory();
    const updatedHistory = history.filter(entry => {
        const entryLat = parseFloat(entry.lat);
        const entryLng = parseFloat(entry.lng || entry.lon);
        return Math.abs(entryLat - lat) > 0.0001 || Math.abs(entryLng - lng) > 0.0001;
    });
    saveCoordHistory(updatedHistory);
    Utils.handleMessage("Location deleted.");
    renderResultsList();
}

// --- Exportiere die notwendigen Funktionen ---
export {
    initializeLocationSearch,
    addCoordToHistory
};