// In: src/ui-web/coordinates.js

"use strict";

import { Utils } from '../core/utils.js';
import * as mgrs from 'mgrs';
import { AppState } from '../core/state.js';
import * as LocationManager from '../core/locationManager.js';

let isAddingFavorite = false;
let currentFavoriteData = null; // Zum Speichern der Daten für das Modal

// Hauptfunktion zum Initialisieren des Moduls

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
            LocationManager.addOrUpdateFavorite(currentFavoriteData.lat, currentFavoriteData.lng, name);
            renderResultsList();
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

// UI Funktionen (DOM Manipulation und Event-Handling)

/**
 * Rendert die Ergebnisliste, die Favoriten, Verlauf und Suchergebnisse enthält.
 * @param {Array} searchResults - Ein Array mit Suchergebnissen von der API.
 */
function renderResultsList(searchResults = []) {
    const resultsList = document.getElementById('locationResults');
    if (!resultsList) return;

    resultsList.innerHTML = ''; // Liste leeren
    const history = LocationManager.getCoordHistory();
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
            LocationManager.addCoordToHistory(lat, lng, item.display_name || item.label, item.isFavorite);
            renderResultsList();
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
                // 1. Zuerst die Logik ausführen
                LocationManager.removeLocationFromHistory(lat, lng);

                // 2. DANACH die UI explizit neu zeichnen
                renderResultsList();
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

function toggleFavorite(lat, lng, defaultName) {
    const history = LocationManager.getCoordHistory();
    // KORREKTUR HIER: Der Platzhalter wurde durch die eigentliche Logik ersetzt.
    const entry = history.find(e =>
        Math.abs(e.lat - lat) < 0.0001 &&
        Math.abs(e.lng - lng) < 0.0001
    );
    const isCurrentlyFavorite = entry && entry.isFavorite;

    if (isCurrentlyFavorite) {
        // Favorit entfernen -> keine Nutzereingabe nötig
        LocationManager.updateFavoriteStatus(lat, lng, defaultName, false);
    } else {
        // Favorit hinzufügen -> Namen abfragen
        const name = prompt("Enter a name for this favorite:", defaultName);
        if (name) { // Nur fortfahren, wenn der Nutzer nicht auf "Abbrechen" klickt
            LocationManager.updateFavoriteStatus(lat, lng, name, true);
        }
    }
    renderResultsList(); // UI neu zeichnen
}

/**
 * Führt die Suche aus, basierend auf der Benutzereingabe.
 * Unterscheidet zwischen Koordinaten und Suchbegriffen.
 * @param {string} query - Die Eingabe des Benutzers.
 */
async function performSearch(query) {
    if (!query.trim()) {
        renderResultsList(); // Zeige Favoriten/Verlauf
        return;
    }

    // Rufe die zentrale Logik-Funktion auf
    const searchResults = await LocationManager.performSearch(query);

    // Gib die Ergebnisse an die lokale Render-Funktion weiter
    renderResultsList(searchResults);
}

