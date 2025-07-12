"use strict";

import { Utils } from '../core/utils.js';
import * as mgrs from 'mgrs';
import { AppState } from '../core/state.js';
import * as LocationManager from '../core/locationManager.js';

let isInitialized = false;
let searchCache = JSON.parse(localStorage.getItem('searchCache')) || {};
let currentFavoriteData = null;

// Hauptfunktion zum Initialisieren des Moduls

/**
 * Initializes the location search module for the touchscreen app.
 */
export function initializeLocationSearch() {
    if (isInitialized) {
        console.log('initializeLocationSearch: Already initialized, skipping');
        return;
    }
    isInitialized = true;
    console.log('initializeLocationSearch: Starting initialization');

    const searchInput = document.getElementById('locationSearchInput');
    const resultsList = document.getElementById('locationResults');
    const searchPanel = document.getElementById('panel-search');
    const clearButton = document.getElementById('clearSearchInput');
    const saveFavoriteBtn = document.getElementById('saveFavoriteBtn');
    const favoriteModal = document.getElementById('favoriteModal');
    const favoriteNameInput = document.getElementById('favoriteNameInput');
    const submitFavoriteName = document.getElementById('submitFavoriteName');
    const cancelFavoriteName = document.getElementById('cancelFavoriteName');

    if (!searchInput) {
        console.error('initializeLocationSearch: Search input (locationSearchInput) not found in DOM');
        return;
    }
    if (!resultsList) {
        console.error('initializeLocationSearch: Results list (locationResults) not found in DOM');
        return;
    }
    if (!searchPanel) {
        console.error('initializeLocationSearch: Search panel (panel-search) not found in DOM');
        return;
    }
    console.log('initializeLocationSearch: UI elements found:', {
        searchInput: !!searchInput,
        resultsList: !!resultsList,
        searchPanel: !!searchPanel,
        clearButton: !!clearButton,
        saveFavoriteBtn: !!saveFavoriteBtn,
        favoriteModal: !!favoriteModal,
        favoriteNameInput: !!favoriteNameInput,
        submitFavoriteName: !!submitFavoriteName,
        cancelFavoriteName: !!cancelFavoriteName
    });

    if (clearButton) {
        console.log('initializeLocationSearch: Clear button found, initial state:', {
            display: clearButton.style.display,
            textContent: clearButton.textContent
        });
    } else {
        console.warn('initializeLocationSearch: Clear button (clearSearchInput) not found, clear functionality disabled');
    }

    if (saveFavoriteBtn && favoriteModal && favoriteNameInput && submitFavoriteName && cancelFavoriteName) {
        console.log('initializeLocationSearch: Favorite button and modal elements found');
    } else {
        console.warn('initializeLocationSearch: Save favorite button or modal elements missing, save functionality disabled');
    }

    if (!Utils || !Utils.debounce) {
        console.error('initializeLocationSearch: Utils.debounce is not available');
        return;
    }

    const debouncedSearch = Utils.debounce(performSearch, 750);
    console.log('initializeLocationSearch: Debounced search function created');

    // Handle search input
    const inputHandler = () => {
        console.log('initializeLocationSearch: Input event triggered, value:', searchInput.value);
        debouncedSearch(searchInput.value);
        // Show/hide clear button
        if (clearButton) {
            const shouldShow = searchInput.value.trim() !== '';
            clearButton.style.display = shouldShow ? 'block' : 'none';
            console.log('initializeLocationSearch: Clear button display set to:', clearButton.style.display);
        }
        // Ensure results list stays visible
        if (!searchPanel.classList.contains('hidden')) {
            resultsList.style.display = 'block';
            console.log('initializeLocationSearch: Results list ensured visible');
        }
    };
    searchInput.removeEventListener('input', inputHandler);
    searchInput.addEventListener('input', inputHandler);
    console.log('initializeLocationSearch: Added input event listener');

    // Handle clear button click
    if (clearButton) {
        const clearHandler = () => {
            console.log('initializeLocationSearch: Clear button clicked');
            searchInput.value = '';
            clearButton.style.display = 'none';
            console.log('initializeLocationSearch: Input cleared, clear button hidden');
            renderResultsList();
            if (!searchPanel.classList.contains('hidden')) {
                resultsList.style.display = 'block';
                console.log('initializeLocationSearch: Results list shown after clear');
            }
            searchInput.focus();
        };
        clearButton.removeEventListener('click', clearHandler);
        clearButton.addEventListener('click', clearHandler);
        console.log('initializeLocationSearch: Added clear button event listener');
    }

    // Handle favorite modal submission
    if (favoriteModal && favoriteNameInput && submitFavoriteName && cancelFavoriteName) {
        const submitFavoriteHandler = () => {
            if (!currentFavoriteData) {
                console.warn('initializeLocationSearch: No favorite data to save, closing modal');
                favoriteModal.style.display = 'none';
                favoriteNameInput.value = '';
                return;
            }
            const { lat, lng, defaultName } = currentFavoriteData;
            const name = favoriteNameInput.value.trim() || defaultName;
            console.log('initializeLocationSearch: Saving favorite with name:', name);

            // Einfach die zentrale Funktion aufrufen. 
            // Der Schutz vor Doppel-Klicks ist jetzt dort drin.
            LocationManager.addOrUpdateFavorite(lat, lng, name);

            favoriteModal.style.display = 'none';
            favoriteNameInput.value = '';
            currentFavoriteData = null;
            renderResultsList();
        };
        submitFavoriteName.removeEventListener('click', submitFavoriteHandler);
        submitFavoriteName.addEventListener('click', submitFavoriteHandler);
        console.log('initializeLocationSearch: Added submit favorite button listener');

        const cancelFavoriteHandler = () => {
            console.log('initializeLocationSearch: Cancel favorite modal');
            favoriteModal.style.display = 'none';
            favoriteNameInput.value = '';
            currentFavoriteData = null;
        };
        cancelFavoriteName.removeEventListener('click', cancelFavoriteHandler);
        cancelFavoriteName.addEventListener('click', cancelFavoriteHandler);
        console.log('initializeLocationSearch: Added cancel favorite button listener');
    }

    // Handle save favorite button click
    if (saveFavoriteBtn) {
        const saveFavoriteHandler = () => {
            console.log('initializeLocationSearch: Save favorite button clicked');
            if (AppState.lastLat === null || AppState.lastLng === null) {
                Utils.handleError("Please select a location on the map first.");
                console.log('initializeLocationSearch: No valid map coordinates');
                return;
            }
            if (!favoriteModal || !favoriteNameInput) {
                console.warn('initializeLocationSearch: Favorite modal or input missing');
                return;
            }
            currentFavoriteData = {
                lat: AppState.lastLat,
                lng: AppState.lastLng,
                defaultName: `DIP at ${AppState.lastLat.toFixed(4)}, ${AppState.lastLng.toFixed(4)}`
            };
            favoriteNameInput.value = currentFavoriteData.defaultName;
            favoriteModal.style.display = 'block';
            console.log('initializeLocationSearch: Favorite modal shown for map coordinates');
            favoriteNameInput.focus();
        };
        saveFavoriteBtn.removeEventListener('click', saveFavoriteHandler);
        saveFavoriteBtn.addEventListener('click', saveFavoriteHandler);
        console.log('initializeLocationSearch: Added save favorite button listener');
    }

    // Show results when Search Panel becomes visible
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                if (!searchPanel.classList.contains('hidden')) {
                    console.log('initializeLocationSearch: Search panel visible, rendering results');
                    renderResultsList();
                    resultsList.style.display = 'block';
                    if (clearButton) {
                        clearButton.style.display = searchInput.value.trim() ? 'block' : 'none';
                        console.log('initializeLocationSearch: Clear button display set to:', clearButton.style.display);
                    }
                } else {
                    console.log('initializeLocationSearch: Search panel hidden, hiding results');
                    resultsList.style.display = 'none';
                    if (favoriteModal) {
                        favoriteModal.style.display = 'none';
                        console.log('initializeLocationSearch: Favorite modal hidden');
                    }
                }
            }
        });
    });
    observer.observe(searchPanel, { attributes: true, attributeFilter: ['class'] });
    console.log('initializeLocationSearch: Added MutationObserver for panel-search');

    // Show results if Search Panel is already visible on init
    if (!searchPanel.classList.contains('hidden')) {
        console.log('initializeLocationSearch: Search panel is visible on init, rendering results');
        renderResultsList();
        resultsList.style.display = 'block';
        if (clearButton && searchInput.value.trim()) {
            clearButton.style.display = 'block';
            console.log('initializeLocationSearch: Clear button shown on init due to input value');
        }
    }

    // Hide results only when interacting outside the Search Panel
    const hideResultsHandler = (e) => {
        if (!searchPanel.contains(e.target) && !searchPanel.classList.contains('hidden') && (!favoriteModal || !favoriteModal.contains(e.target))) {
            console.log('initializeLocationSearch: Touch/click outside search panel and modal, hiding results');
            resultsList.style.display = 'none';
            if (favoriteModal) {
                favoriteModal.style.display = 'none';
                console.log('initializeLocationSearch: Favorite modal hidden');
            }
        }
    };
    document.removeEventListener('touchstart', hideResultsHandler);
    document.removeEventListener('click', hideResultsHandler);
    document.addEventListener('touchstart', hideResultsHandler);
    document.addEventListener('click', hideResultsHandler);
    console.log('initializeLocationSearch: Added touchstart and click event listeners');

    // Re-show results on click within panel
    const showResultsHandler = (e) => {
        if (searchPanel.contains(e.target) && !searchInput.contains(e.target) && !resultsList.contains(e.target) && (!favoriteModal || !favoriteModal.contains(e.target)) && !searchPanel.classList.contains('hidden')) {
            console.log('initializeLocationSearch: Click within search panel, showing results');
            renderResultsList();
            resultsList.style.display = 'block';
            if (clearButton && searchInput.value.trim()) {
                clearButton.style.display = 'block';
                console.log('initializeLocationSearch: Clear button shown after panel click');
            }
        }
    };
    searchPanel.removeEventListener('click', showResultsHandler);
    searchPanel.addEventListener('click', showResultsHandler);
    console.log('initializeLocationSearch: Added click listener for search panel');

    console.log('initializeLocationSearch: Initialization complete');
}

// UI Funktionen (DOM Manipulation und Event-Handling)

/**
 * Renders the results list containing favorites, history, and search results.
 * @param {Array} searchResults - Array of search results from the API.
 */
function renderResultsList(searchResults = []) {
    console.log('renderResultsList: Rendering with searchResults:', searchResults);

    const resultsList = document.getElementById('locationResults');
    if (!resultsList) {
        console.error('renderResultsList: Results list not found');
        return;
    }

    resultsList.innerHTML = '';
    const history = LocationManager.getCoordHistory();
    const favorites = history.filter(item => item.isFavorite);
    const nonFavorites = history.filter(item => !item.isFavorite);
    console.log('renderResultsList: Favorites:', favorites);
    console.log('renderResultsList: History (non-favorites):', nonFavorites);

    const createListItem = (item) => {
        console.log('createListItem: Creating item for:', item);
        const li = document.createElement('li');
        const lat = parseFloat(item.lat);
        const lng = parseFloat(item.lng || item.lon);
        if (isNaN(lat) || isNaN(lng)) {
            console.error('createListItem: Invalid coordinates:', item);
            return null;
        }
        li.dataset.lat = lat;
        li.dataset.lon = lng;
        li.className = 'search-item';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'search-item-text';
        const nameText = document.createElement('span');
        nameText.className = 'name';
        nameText.textContent = item.display_name || item.label;
        nameSpan.appendChild(nameText);
        li.appendChild(nameSpan);
        nameSpan.addEventListener('click', (e) => {
            console.log('createListItem: Location clicked:', { lat, lng });
            const selectEvent = new CustomEvent('location:selected', {
                detail: { lat: lat, lng: lng },
                bubbles: true,
                cancelable: true
            });
            li.dispatchEvent(selectEvent);
            LocationManager.addCoordToHistory(lat, lng, item.display_name || item.label, item.isFavorite || false);
            renderResultsList();
            const resultsList = document.getElementById('locationResults');
            if (resultsList) resultsList.style.display = 'none';
        });
        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'search-item-actions';
        const favToggle = document.createElement('button');
        favToggle.className = 'favorite-toggle';
        favToggle.innerHTML = item.isFavorite ? '★' : '☆';
        if (item.isFavorite) favToggle.classList.add('is-favorite');
        favToggle.title = "Toggle favorite";
        buttonsContainer.appendChild(favToggle);
        favToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('createListItem: Favorite toggle clicked for:', { lat, lng });
            if (item.isFavorite) {
                toggleFavorite(lat, lng, item.display_name || item.label);
            } else {
                if (!favoriteModal || !favoriteNameInput) {
                    console.warn('createListItem: Favorite modal or input missing');
                    return;
                }
                currentFavoriteData = {
                    lat,
                    lng,
                    defaultName: item.display_name || item.label
                };
                favoriteNameInput.value = currentFavoriteData.defaultName;
                favoriteModal.style.display = 'block';
                console.log('createListItem: Favorite modal shown for toggle');
                favoriteNameInput.focus();
            }
        });
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-location-btn';
        deleteBtn.textContent = '×';
        deleteBtn.title = "Delete this entry";
        buttonsContainer.appendChild(deleteBtn);
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('createListItem: Delete button clicked for:', { lat, lng });
            if (confirm(`Delete "${item.display_name || item.label}"?`)) {
                // 1. Zuerst die Logik ausführen
                LocationManager.removeLocationFromHistory(lat, lng);

                // 2. DANACH die UI explizit neu zeichnen
                renderResultsList();
            }
        });
        li.appendChild(buttonsContainer);
        return li;
    };

    if (searchResults.length > 0) {
        console.log('renderResultsList: Adding search results');
        const heading = document.createElement('li');
        heading.className = 'results-heading';
        heading.textContent = 'Results';
        heading.style.fontWeight = 'bold';
        heading.style.background = '#f0f0f0';
        resultsList.appendChild(heading);
        searchResults.forEach(result => {
            const resultLat = parseFloat(result.lat);
            const resultLng = parseFloat(result.lon);
            const fav = favorites.find(f => Math.abs(f.lat - resultLat) < 0.001 && Math.abs(f.lng - resultLng) < 0.001);
            result.isFavorite = !!fav;
            if (fav) result.display_name = fav.label;
            const normalizedResult = {
                lat: resultLat,
                lng: resultLng,
                display_name: result.display_name,
                isFavorite: result.isFavorite
            };
            const listItem = createListItem(normalizedResult);
            if (listItem) resultsList.appendChild(listItem);
        });
    }
    if (favorites.length > 0) {
        console.log('renderResultsList: Adding favorites');
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
        console.log('renderResultsList: Adding previous locations');
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
    console.log('renderResultsList: Rendering complete');
}

function toggleFavorite(lat, lng, defaultName) {
    const entry = LocationManager.getCoordHistory().find(e =>
        Math.abs(e.lat - lat) < 0.0001 &&
        Math.abs(e.lng - lng) < 0.0001
    );
    const isCurrentlyFavorite = entry && entry.isFavorite;

    if (isCurrentlyFavorite) {
        // Favorit entfernen
        LocationManager.updateFavoriteStatus(lat, lng, defaultName, false);
        renderResultsList();
    } else {
        // Modal für Namenseingabe anzeigen
        currentFavoriteData = { lat, lng, defaultName };
        favoriteNameInput.value = defaultName;
        favoriteModal.style.display = 'block';
        favoriteNameInput.focus();
        // Das Speichern passiert dann im Event-Listener des Modals,
        // der ebenfalls LocationManager.updateFavoriteStatus(...) aufruft.
    }
}

/**
 * Performs a search with retry logic for Nominatim API.
 * @param {string} query - The user's input.
 */
async function performSearch(query) {
    if (!query.trim()) {
        renderResultsList(); // Zeige Favoriten/Verlauf
        return;
    }

    // Rufe die ZENTRALE Logik-Funktion auf
    const searchResults = await LocationManager.performSearch(query);

    // Gib die Ergebnisse an die LOKALE Render-Funktion weiter
    renderResultsList(searchResults);
}