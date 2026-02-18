/**
 * @file coordinates.js (für ui-web)
 * @description Initialisiert die UI-Komponenten für die Ortssuche und Favoritenverwaltung
 * in der Web-Ansicht (Sidebar).
 */

"use strict";

import { Utils } from '../core/utils.js';
import { AppState } from '../core/state.js';
import * as LocationManager from '../core/locationManager.js';
import { I18n } from '../core/i18n.js';

let currentFavoriteData = null; // Speichert temporär die Daten für das Favoriten-Modal

/**
 * Initialisiert alle Event-Listener für das Such-Panel in der Web-UI.
 */
export function initializeLocationSearch() {
    const searchInput = document.getElementById('locationSearchInput');
    const resultsList = document.getElementById('locationResults');
    const clearButton = document.getElementById('clearSearchInput');
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

    searchInput.addEventListener('input', () => {
        debouncedSearch(searchInput.value);
        clearButton.style.display = searchInput.value.trim() ? 'block' : 'none';
    });

    clearButton.addEventListener('click', () => {
        searchInput.value = '';
        clearButton.style.display = 'none';
        renderResultsList(); // Zeigt wieder Favoriten & Verlauf an
        searchInput.focus();
    });

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
        favoriteModal.style.display = 'flex';
    });

    submitFavoriteName.addEventListener('click', () => {
        if (currentFavoriteData) {
            const name = favoriteNameInput.value.trim() || currentFavoriteData.defaultName;
            LocationManager.addOrUpdateFavorite(currentFavoriteData.lat, currentFavoriteData.lng, name);
            renderResultsList();
        }
        favoriteModal.style.display = 'none';
        currentFavoriteData = null;
    });

    cancelFavoriteName.addEventListener('click', () => {
        favoriteModal.style.display = 'none';
        currentFavoriteData = null;
    });

    // Initial das Panel mit Favoriten/Verlauf füllen
    renderResultsList();

    document.addEventListener('favorites:updated', () => {
        console.log('[Coordinates] Received favorites:updated event. Rerendering list.');
        renderResultsList();
    });
}


/**
 * Rendert die Ergebnisliste, die Favoriten, Verlauf und Suchergebnisse anzeigt.
 * @param {object[]} [searchResults=[]] - Ein optionales Array mit Suchergebnissen.
 */
function renderResultsList(searchResults = []) {
    const resultsList = document.getElementById('locationResults');
    if (!resultsList) return;

    resultsList.innerHTML = ''; // Liste immer zuerst leeren

    const history = LocationManager.getCoordHistory();
    const favorites = history.filter(item => item.isFavorite);
    const recents = history.filter(item => !item.isFavorite);

    // Helferfunktion zum Erstellen eines Abschnitts (z.B. "Favorites")
    const createSection = (title, items) => {
        if (items.length === 0) return;

        const sectionDiv = document.createElement('div');
        sectionDiv.className = 'search-section';
        const heading = document.createElement('h5');
        heading.textContent = title;
        sectionDiv.appendChild(heading);

        const ul = document.createElement('ul');
        items.forEach(item => {
            const li = _createListItem(item);
            if (li) ul.appendChild(li);
        });
        sectionDiv.appendChild(ul);
        resultsList.appendChild(sectionDiv);
    };

    createSection(I18n.t('location.results_title'), searchResults);
    createSection(I18n.t('location.favorites_title'), favorites);
    createSection(I18n.t('location.recent_searches_title'), recents);
}

/**
 * Erstellt ein einzelnes Listenelement für die Ergebnisliste.
 * @param {object} item - Das Datenobjekt (aus Suche, Verlauf oder Favoriten).
 * @returns {HTMLLIElement|null} Das erstellte Listenelement.
 * @private
 */
function _createListItem(item) {
    const lat = parseFloat(item.lat);
    const lng = parseFloat(item.lng || item.lon);
    if (isNaN(lat) || isNaN(lng)) return null;

    const li = document.createElement('li');
    li.className = 'search-item';

    const textContainer = document.createElement('div');
    textContainer.className = 'search-item-text';
    textContainer.innerHTML = `<span class="name">${item.display_name || item.label}</span>`;

    // Klick auf den Text-Container wählt den Ort aus
    textContainer.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('location:selected', { detail: { lat, lng, source: 'search' }, bubbles: true }));
        LocationManager.addCoordToHistory(lat, lng, item.display_name || item.label, item.isFavorite);
        // Wechselt zurück zur Kartenansicht
        document.querySelector('.tab-button[data-panel="map"]').click();
    });
    li.appendChild(textContainer);

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'search-item-actions';

    // --- HOME DZ BUTTON ---
    if (item.isFavorite) {
        const homeBtn = document.createElement('button');
        homeBtn.innerHTML = '🏠';
        homeBtn.title = I18n.t('location.set_home_dz');
        // Die CSS-Klasse wird basierend auf dem 'isHomeDZ'-Flag gesetzt
        homeBtn.className = `home-toggle ${item.isHomeDZ ? 'is-home' : ''}`;

        homeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (item.isHomeDZ) {
                LocationManager.clearHomeDZ();
            } else {
                LocationManager.setHomeDZ(lat, lng);
            }
            // **DER ENTSCHEIDENDE FIX:**
            // Zeichne die gesamte Liste sofort neu, um die Änderung sichtbar zu machen.
            renderResultsList();
        });
        actionsDiv.appendChild(homeBtn);
    }

    // --- FAVORITEN-STERN ---
    const favToggle = document.createElement('button');
    favToggle.className = `favorite-toggle ${item.isFavorite ? 'is-favorite' : ''}`;
    favToggle.innerHTML = '★';
    favToggle.title = I18n.t('location.toggle_favorite');
    favToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(lat, lng, item.display_name || item.label);
    });
    actionsDiv.appendChild(favToggle);

    // --- LÖSCHEN-BUTTON ---
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = '×';
    deleteBtn.title = I18n.t('location.delete_entry');
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(I18n.t('location.delete_confirm').replace('{name}', item.display_name || item.label))) {
            LocationManager.removeLocationFromHistory(lat, lng);
            renderResultsList();
        }
    });
    actionsDiv.appendChild(deleteBtn);

    li.appendChild(actionsDiv);
    return li;
}

/**
 * Schaltet den Favoritenstatus eines Ortes um. Zeigt bei Bedarf das Modal zur Namensgebung an.
 * @param {number} lat - Breite.
 * @param {number} lng - Länge.
 * @param {string} defaultName - Der Standardname, falls der Nutzer keinen eingibt.
 */
function toggleFavorite(lat, lng, defaultName, onFinish) {
    const entry = LocationManager.getCoordHistory().find(e => Math.abs(e.lat - lat) < 0.0001 && Math.abs(e.lng - lng) < 0.0001);
    const isCurrentlyFavorite = entry && entry.isFavorite;

    if (isCurrentlyFavorite) {
        LocationManager.updateFavoriteStatus(lat, lng, defaultName, false);
        if (onFinish) onFinish(); // Führe den Callback sofort aus
    } else {
        currentFavoriteData = { lat, lng, defaultName };
        const favoriteModal = document.getElementById('favoriteModal');
        const favoriteNameInput = document.getElementById('favoriteNameInput');
        favoriteNameInput.value = defaultName;

        // Sorge dafür, dass nach dem Schließen des Modals (egal wie) neu gezeichnet wird
        const modalConfirm = () => {
            const name = favoriteNameInput.value.trim() || currentFavoriteData.defaultName;
            LocationManager.addOrUpdateFavorite(lat, lng, name);
            if (onFinish) onFinish();
            favoriteModal.style.display = 'none';
        };
        const modalCancel = () => {
            if (onFinish) onFinish();
            favoriteModal.style.display = 'none';
        };

        // Event-Listener im Modal neu zuweisen
        document.getElementById('submitFavoriteName').textContent = I18n.t('common.save');
        document.getElementById('cancelFavoriteName').textContent = I18n.t('common.cancel');

        favoriteModal.style.display = 'block';
    }
}

/**
 * Führt die Suche aus und aktualisiert die Ergebnisliste.
 * @param {string} query - Die Eingabe des Benutzers.
 */
async function performSearch(query) {
    if (!query.trim()) {
        renderResultsList(); // Zeige Favoriten/Verlauf an, wenn die Suche leer ist
        return;
    }
    const searchResults = await LocationManager.performSearch(query);
    renderResultsList(searchResults);
}