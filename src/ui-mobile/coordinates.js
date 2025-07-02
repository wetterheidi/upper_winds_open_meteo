"use strict";

import { Utils } from '../core/utils.js';
import * as mgrs from 'mgrs';
import { AppState } from '../core/state.js';

let isAddingFavorite = false;
let isInitialized = false;
let searchCache = JSON.parse(localStorage.getItem('searchCache')) || {};
let currentFavoriteData = null;

/**
 * Initializes the location search module for the touchscreen app.
 */
function initializeLocationSearch() {
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
            if (isAddingFavorite) {
                console.log('initializeLocationSearch: Blocked, favorite addition in progress');
                return;
            }
            isAddingFavorite = true;
            try {
                addOrUpdateFavorite(lat, lng, name);
                addCoordToHistory(lat, lng, name, true);
                Utils.handleMessage(`"${name}" saved as favorite.`);
            } finally {
                isAddingFavorite = false;
                console.log('initializeLocationSearch: Favorite save completed');
            }
            favoriteModal.style.display = 'none';
            favoriteNameInput.value = '';
            currentFavoriteData = null;
            renderResultsList();
            if (!searchPanel.classList.contains('hidden')) {
                resultsList.style.display = 'block';
            }
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

/**
 * Performs a search with retry logic for Nominatim API.
 * @param {string} query - The user's input.
 */
async function performSearch(query) {
    console.log('performSearch: Called with query:', query);
    
    if (!query.trim()) {
        console.log('performSearch: Empty query, rendering favorites/history');
        renderResultsList();
        return;
    }

    let searchResults = [];
    const parsedCoords = parseQueryAsCoordinates(query);
    if (parsedCoords) {
        console.log('performSearch: Parsed coordinates:', parsedCoords);
        searchResults.push({
            display_name: `Coordinate: ${parsedCoords.lat.toFixed(5)}, ${parsedCoords.lng.toFixed(5)}`,
            lat: parsedCoords.lat,
            lon: parsedCoords.lng,
            type: 'coordinate'
        });
        renderResultsList(searchResults);
        return;
    }

    // Check cache or history for results
    if (searchCache[query]) {
        console.log('performSearch: Using cached results for:', query);
        searchResults = searchCache[query];
        renderResultsList(searchResults);
        return;
    }
    // Fallback to history for partial matches
    const history = getCoordHistory();
    const historyMatch = history.find(item => item.label.toLowerCase().includes(query.toLowerCase()));
    if (historyMatch) {
        console.log('performSearch: Using history match for:', query);
        searchResults = [{
            display_name: historyMatch.label,
            lat: historyMatch.lat,
            lon: historyMatch.lng,
            isFavorite: historyMatch.isFavorite
        }];
        renderResultsList(searchResults);
        return;
    }

    console.log('performSearch: No coordinates or cache, initiating Nominatim search');
    const maxRetries = 3;
    const retryDelay = 2000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`;
            console.log(`performSearch: Attempt ${attempt}/${maxRetries}, Fetching from URL:`, url);
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Skydiving-Weather-App/1.0 (anonymous)',
                    'Accept': 'application/json',
                    'Origin': window.location.origin
                },
                mode: 'cors',
                credentials: 'omit'
            });
            console.log('performSearch: Fetch response status:', response.status);
            if (!response.ok) {
                throw new Error(`Nominatim API Error: ${response.statusText}`);
            }
            const data = await response.json();
            console.log('performSearch: Nominatim results:', data);
            searchResults = data;
            // Cache results
            searchCache[query] = searchResults;
            try {
                localStorage.setItem('searchCache', JSON.stringify(searchCache));
            } catch (e) {
                console.warn('performSearch: Failed to save search cache:', e);
            }
            renderResultsList(searchResults);
            return;
        } catch (error) {
            console.error(`performSearch: Attempt ${attempt}/${maxRetries} failed:`, error);
            if (attempt === maxRetries) {
                console.error('performSearch: All retries failed');
                Utils.handleError("Could not find location. Please check your network and try again.");
                renderResultsList([]);
                return;
            }
            console.log(`performSearch: Retrying after ${retryDelay}ms...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }
}

/**
 * Attempts to parse user input as coordinates.
 * @param {string} query - The user's input.
 * @returns {object|null} An object with {lat, lng} or null.
 */
function parseQueryAsCoordinates(query) {
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
    const history = getCoordHistory();
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
            addCoordToHistory(lat, lng, item.display_name || item.label, item.isFavorite || false);
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
                removeLocationFromHistory(lat, lng);
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

/**
 * Local Storage Management
 */
function getCoordHistory() {
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

function saveCoordHistory(history) {
    console.log('saveCoordHistory: Saving history:', history);
    try {
        localStorage.setItem('coordHistory', JSON.stringify(history));
        console.log('saveCoordHistory: History saved');
    } catch (e) {
        console.error('saveCoordHistory: Error saving history:', e);
    }
}

function addCoordToHistory(lat, lng, label, isFavorite = false) {
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
    renderResultsList();
}

function addOrUpdateFavorite(lat, lng, name, skipMessage = false) {
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
        renderResultsList();
        _dispatchFavoritesUpdate();
    } catch (error) {
        console.error('addOrUpdateFavorite: Error:', error);
    } finally {
        isAddingFavorite = false;
        console.log('addOrUpdateFavorite: Completed');
    }
}

function toggleFavorite(lat, lng, defaultName) {
    console.log('toggleFavorite: Processing:', { lat, lng, defaultName });
    if (isNaN(lat) || isNaN(lng)) {
        console.error('toggleFavorite: Invalid coordinates');
        return;
    }
    const favoriteModal = document.getElementById('favoriteModal');
    const favoriteNameInput = document.getElementById('favoriteNameInput');
    if (!favoriteModal || !favoriteNameInput) {
        console.warn('toggleFavorite: Favorite modal or input missing, cannot prompt for name');
        addOrUpdateFavorite(lat, lng, defaultName);
        return;
    }
    const history = getCoordHistory();
    const entry = history.find(e => {
        const entryLat = parseFloat(e.lat);
        const entryLng = parseFloat(e.lng);
        return Math.abs(entryLat - lat) < 0.001 && Math.abs(entryLng - lng) < 0.001;
    });
    if (entry && entry.isFavorite) {
        console.log('toggleFavorite: Removing favorite status for:', entry);
        entry.isFavorite = false;
        Utils.handleMessage(`"${entry.label}" removed from favorites.`);
        saveCoordHistory(history);
        renderResultsList();
        _dispatchFavoritesUpdate();
    } else {
        currentFavoriteData = {
            lat,
            lng,
            defaultName: entry ? (entry.label || defaultName) : defaultName
        };
        favoriteNameInput.value = currentFavoriteData.defaultName;
        favoriteModal.style.display = 'block';
        console.log('toggleFavorite: Favorite modal shown');
        favoriteNameInput.focus();
    }
}

/**
 * Dispatches an update event for favorites.
 */
function _dispatchFavoritesUpdate() {
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

/**
 * Removes a location from history.
 * @param {number} lat - Latitude of the location.
 * @param {number} lng - Longitude of the location.
 */
function removeLocationFromHistory(lat, lng) {
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
    renderResultsList();
    _dispatchFavoritesUpdate();
}

// --- Exports ---
export {
    initializeLocationSearch,
    addCoordToHistory,
    getCoordHistory,
    parseQueryAsCoordinates
};