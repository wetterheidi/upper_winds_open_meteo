// coordinates.js - Neu gestaltet für eine intuitive Orts-Suche

"use strict";

import { Utils } from '../core/utils.js';
import * as mgrs from 'mgrs';
import { AppState } from '../core/state.js';

let history = [];
const HISTORY_KEY = 'coordHistory';

/**
 * Initialisiert das gesamte Location-Search-Modul.
 * Diese Funktion wird von app.js aufgerufen.
 */

function initializeLocationSearch() {
    addCoordToHistory();
    const searchInputMobile = document.getElementById('locationSearchInput');
    if (searchInputMobile) {
        searchInputMobile.addEventListener('input', (e) => {
            performSearch(e.target.value);
        });
        searchInputMobile.addEventListener('location:selected', () => {
            searchInputMobile.value = '';
            renderResultsList();
        });
    }
}

/**
 * Führt die Suche aus, basierend auf der Benutzereingabe.
 * Unterscheidet zwischen Koordinaten und Suchbegriffen.
 * @param {string} query - Die Eingabe des Benutzers.
 */
async function performSearch(query) {
    if (!query || query.length < 2) {
        renderResultsList();
        return;
    }

    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`;
    try {
        // FIX 2: Headers-Objekt mit User-Agent zur fetch-Anfrage hinzufügen
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Wetterheidi-App/1.0 (wetterheidi.app)'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        renderResultsList(data);
    } catch (error) {
        console.error('Fehler bei der Geocoding-Suche:', error);
        // Diese Zeile funktioniert jetzt, da handleError importiert ist
        Utils.handleError('Could not find location.');
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
    const favoritesList = document.getElementById('favorites-list');
    const recentsList = document.getElementById('recents-list');
    const searchResultsList = document.getElementById('search-results-list');
    const favoritesSection = document.getElementById('favorites-section');
    const recentsSection = document.getElementById('recents-section');
    const searchResultsSection = document.getElementById('search-results-section');

    if (!favoritesList) return;

    favoritesList.innerHTML = '';
    recentsList.innerHTML = '';
    searchResultsList.innerHTML = '';

    const currentHistory = getCoordHistory();
    const favorites = currentHistory.filter(item => item.isFavorite);
    const nonFavorites = currentHistory.filter(item => !item.isFavorite);

    const createListItem = (item, type) => {
        const li = document.createElement('li');
        li.className = 'search-item';
        const lat = parseFloat(item.lat);
        const lng = parseFloat(item.lng || item.lon);
        li.dataset.lat = lat;
        li.dataset.lon = lng;

        const iconSpan = document.createElement('span');
        iconSpan.className = 'search-item-icon';
        if (type === 'favorite') {
            iconSpan.innerHTML = '★';
            iconSpan.style.color = '#f3d131';
        } else if (type === 'recent') {
            iconSpan.innerHTML = '🕒';
        } else {
            iconSpan.innerHTML = '📍';
        }
        li.appendChild(iconSpan);

        const textDiv = document.createElement('div');
        textDiv.className = 'search-item-text';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'name';
        nameSpan.textContent = item.label || item.display_name;
        const detailsSpan = document.createElement('span');
        detailsSpan.className = 'details';
        detailsSpan.textContent = item.type === 'coordinate' ? 'Coordinate Lookup' : (item.address?.country || '');
        textDiv.appendChild(nameSpan);
        textDiv.appendChild(detailsSpan);
        li.appendChild(textDiv);

        li.addEventListener('mousedown', () => {
            const selectEvent = new CustomEvent('location:selected', { detail: { lat, lng } });
            document.getElementById('locationSearchInput').dispatchEvent(selectEvent);
            addCoordToHistory(lat, lng, item.label || item.display_name, item.isFavorite || false);
        });

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'search-item-actions';
        if (type !== 'favorite') {
            const favToggle = document.createElement('button');
            favToggle.innerHTML = item.isFavorite ? '★' : '☆';
            if (item.isFavorite) favToggle.classList.add('is-favorite');
            favToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleFavorite(lat, lng, item.label || item.display_name);
            });
            actionsDiv.appendChild(favToggle);
        }

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '×';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Delete "${item.label || item.display_name}"?`)) {
                removeLocationFromHistory(lat, lng);
            }
        });
        actionsDiv.appendChild(deleteBtn);
        li.appendChild(actionsDiv);
        return li;
    };

    searchResultsSection.style.display = searchResults.length > 0 ? 'block' : 'none';
    searchResults.forEach(result => {
        const fav = favorites.find(f => Math.abs(f.lat - parseFloat(result.lat)) < 0.001 && Math.abs(f.lng - parseFloat(result.lon)) < 0.001);
        result.isFavorite = !!fav;
        if (fav) result.label = fav.label;
        searchResultsList.appendChild(createListItem(result, 'search'));
    });

    favoritesSection.style.display = favorites.length > 0 ? 'block' : 'none';
    favorites.forEach(fav => favoritesList.appendChild(createListItem(fav, 'favorite')));

    recentsSection.style.display = nonFavorites.length > 0 ? 'block' : 'none';
    nonFavorites.forEach(item => recentsList.appendChild(createListItem(item, 'recent')));
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
    const item = history.find(h => h.lat === lat && h.lng === lng);
    if (item) {
        item.isFavorite = !item.isFavorite;
    } else {
        addCoordToHistory(lat, lng, label, true);
    }
    saveCoordHistory();
    renderResultsList();
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