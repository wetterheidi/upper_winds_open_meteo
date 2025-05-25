"use strict";

import { Settings } from './settings.js';
import { Utils } from './utils.js';

// External dependencies (must be set by app.js)
let moveMarkerCallback = null;

function setMoveMarkerCallback(callback) {
    moveMarkerCallback = callback;
}

// Initialize coordinate storage in localStorage
function initCoordStorage() {
    if (!localStorage.getItem('coordHistory')) {
        localStorage.setItem('coordHistory', JSON.stringify([]));
        console.log('Initialized coordHistory in localStorage');
    }
}

// Retrieve coordinate history from localStorage
function getCoordHistory() {
    try {
        return JSON.parse(localStorage.getItem('coordHistory')) || [];
    } catch (error) {
        console.error('Failed to parse coordHistory:', error);
        Utils.handleError('Failed to load coordinate history.');
        return [];
    }
}

// Format a coordinate pair for display in the dropdown
function formatCoordLabel(lat, lng, format) {
    if (isNaN(lat) || isNaN(lng)) {
        console.warn('Invalid coordinates for formatting:', { lat, lng });
        return 'Invalid coordinates';
    }
    if (format === 'DMS') {
        try {
            const latDMS = Utils.decimalToDms(lat, true);
            const lngDMS = Utils.decimalToDms(lng, false);
            return `${latDMS.deg}°${latDMS.min}'${latDMS.sec.toFixed(3)}"${latDMS.dir} ${lngDMS.deg}°${lngDMS.min}'${lngDMS.sec.toFixed(3)}"${lngDMS.dir}`;
        } catch (e) {
            console.warn('DMS formatting failed:', e);
            Utils.handleError('Failed to format DMS coordinates.');
            return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        }
    } else if (format === 'MGRS') {
        try {
            const mgrsCoord = mgrs.forward([lng, lat], 10);
            console.log('Formatted MGRS:', { lat, lng, mgrsCoord });
            return mgrsCoord;
        } catch (e) {
            console.warn('MGRS format failed:', e);
            Utils.handleError('Failed to format MGRS coordinates.');
            return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        }
    }
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

// Add a coordinate pair to history, maintaining a limit
function addCoordToHistory(lat, lng) {
    if (isNaN(lat) || isNaN(lng)) {
        console.warn('Cannot add invalid coordinates to history:', { lat, lng });
        Utils.handleError('Invalid coordinates cannot be added to history.');
        return;
    }
    const history = getCoordHistory();
    const format = Settings.state.userSettings.coordFormat || 'Decimal';
    const newLat = parseFloat(lat.toFixed(5));
    const newLng = parseFloat(lng.toFixed(5));
    const newEntry = {
        lat: newLat,
        lng: newLng,
        label: formatCoordLabel(newLat, newLng, format),
        isFavorite: false,
        timestamp: Date.now()
    };
    const existing = history.find(
        entry => Math.abs(entry.lat - newLat) < 0.0001 && Math.abs(entry.lng - newLng) < 0.0001
    );
    if (existing) {
        newEntry.isFavorite = existing.isFavorite;
        newEntry.label = existing.isFavorite ? existing.label : newEntry.label;
        history.splice(history.indexOf(existing), 1);
        console.log('Removed duplicate entry from history:', { lat: newLat, lng: newLng });
    }
    history.unshift(newEntry);
    const favorites = history.filter(entry => entry.isFavorite);
    const nonFavorites = history.filter(entry => !entry.isFavorite).slice(0, 5);
    try {
        localStorage.setItem('coordHistory', JSON.stringify([...favorites, ...nonFavorites]));
        console.log('Added to coordHistory:', { lat: newLat, lng: newLng, format });
        updateCoordDropdown();
    } catch (error) {
        console.error('Failed to save coordHistory:', error);
        Utils.handleError('Failed to save coordinate history.');
    }
}

// Toggle favorite status for a coordinate pair
function toggleFavorite(lat, lng) {
    console.log('Attempting to toggle favorite for:', { lat, lng });
    if (isNaN(lat) || isNaN(lng)) {
        console.warn('Cannot toggle favorite for invalid coordinates:', { lat, lng });
        Utils.handleError('Invalid coordinates cannot be favorited.');
        return;
    }
    const history = getCoordHistory();
    const newLat = parseFloat(lat.toFixed(5));
    const newLng = parseFloat(lng.toFixed(5));
    const entry = history.find(
        entry => Math.abs(entry.lat - newLat) < 0.0001 && Math.abs(entry.lng - newLng) < 0.0001
    );
    const format = Settings.state.userSettings.coordFormat || 'Decimal';
    if (entry) {
        console.log('Found entry in history:', entry);
        entry.isFavorite = !entry.isFavorite;
        if (entry.isFavorite) {
            entry.label = prompt('Name this favorite location:', entry.label) || entry.label;
            Utils.handleMessage(`Marked as favorite: ${entry.label}`);
        } else {
            entry.label = formatCoordLabel(entry.lat, entry.lng, format);
            Utils.handleMessage('Removed from favorites.');
        }
        try {
            localStorage.setItem('coordHistory', JSON.stringify(history));
            updateCoordDropdown();
            console.log('Updated history:', getCoordHistory());
        } catch (error) {
            console.error('Failed to save coordHistory:', error);
            Utils.handleError('Failed to save favorite status.');
        }
    } else {
        console.log('No matching coordinate, adding as favorite');
        const newEntry = {
            lat: newLat,
            lng: newLng,
            label: prompt('Name this favorite location:', formatCoordLabel(newLat, newLng, format)) || formatCoordLabel(newLat, newLng, format),
            isFavorite: true,
            timestamp: Date.now()
        };
        history.unshift(newEntry);
        try {
            localStorage.setItem('coordHistory', JSON.stringify(history));
            Utils.handleMessage(`Added favorite: ${newEntry.label}`);
            updateCoordDropdown();
        } catch (error) {
            console.error('Failed to save coordHistory:', error);
            Utils.handleError('Failed to add favorite.');
        }
    }
}

// Update the coordinate history dropdown
function updateCoordDropdown() {
    const select = document.getElementById('coordHistory');
    if (!select) {
        console.warn('Coordinate history dropdown not found');
        return;
    }
    select.innerHTML = '<option value="">Select a location</option>';
    const history = getCoordHistory();
    history.sort((a, b) => {
        if (a.isFavorite && !b.isFavorite) return -1;
        if (!a.isFavorite && b.isFavorite) return 1;
        return b.timestamp - a.timestamp;
    });
    history.forEach(entry => {
        const option = document.createElement('option');
        option.value = `${entry.lat},${entry.lng}`;
        option.text = `${entry.isFavorite ? '★ ' : ''}${entry.label}`;
        select.appendChild(option);
    });
    console.log('Updated coordHistory dropdown:', { entries: history.length });
}

// Populate coordinate input fields based on format
function populateCoordInputs(lat, lng) {
    if (isNaN(lat) || isNaN(lng)) {
        console.warn('Cannot populate inputs with invalid coordinates:', { lat, lng });
        Utils.handleError('Invalid coordinates for input fields.');
        return;
    }
    const format = Settings.state.userSettings.coordFormat || 'Decimal';
    console.log('Populating coordinate inputs:', { lat, lng, format });
    if (format === 'Decimal') {
        setInputValue('latDec', lat.toFixed(5));
        setInputValue('lngDec', lng.toFixed(5));
    } else if (format === 'DMS') {
        try {
            const latDMS = Utils.decimalToDms(lat, true);
            const lngDMS = Utils.decimalToDms(lng, false);
            setInputValue('latDeg', latDMS.deg);
            setInputValue('latMin', latDMS.min);
            setInputValue('latSec', latDMS.sec.toFixed(3));
            setInputValue('latDir', latDMS.dir);
            setInputValue('lngDeg', lngDMS.deg);
            setInputValue('lngMin', lngDMS.min);
            setInputValue('lngSec', lngDMS.sec.toFixed(3));
            setInputValue('lngDir', lngDMS.dir);
        } catch (e) {
            console.warn('Failed to populate DMS inputs:', e);
            Utils.handleError('Failed to populate DMS coordinates.');
        }
    } else if (format === 'MGRS') {
        try {
            setInputValue('mgrsCoord', mgrs.forward([lng, lat], 10));
        } catch (e) {
            console.warn('MGRS conversion failed:', e);
            Utils.handleError('Failed to populate MGRS coordinates.');
        }
    }
}

// Parse coordinates from input fields
function parseCoordinates() {
    let lat, lng;

    const format = Settings.state.userSettings.coordFormat || 'Decimal';
    console.log('Parsing coordinates for format:', format);
    if (format === 'Decimal') {
        lat = parseFloat(document.getElementById('latDec')?.value);
        lng = parseFloat(document.getElementById('lngDec')?.value);
        if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            console.warn('Invalid Decimal coordinates:', { lat, lng });
            throw new Error('Invalid Decimal Degrees coordinates');
        }
    } else if (format === 'DMS') {
        const latDeg = parseInt(document.getElementById('latDeg')?.value) || 0;
        const latMin = parseInt(document.getElementById('latMin')?.value) || 0;
        const latSec = parseFloat(document.getElementById('latSec')?.value) || 0;
        const latDir = document.getElementById('latDir')?.value || 'N';
        const lngDeg = parseInt(document.getElementById('lngDeg')?.value) || 0;
        const lngMin = parseInt(document.getElementById('lngMin')?.value) || 0;
        const lngSec = parseFloat(document.getElementById('lngSec')?.value) || 0;
        const lngDir = document.getElementById('lngDir')?.value || 'E';

        if (isNaN(latDeg) || isNaN(latMin) || isNaN(latSec) || isNaN(lngDeg) || isNaN(lngMin) || isNaN(lngSec)) {
            console.warn('Invalid DMS inputs:', { latDeg, latMin, latSec, lngDeg, lngMin, lngSec });
            throw new Error('Invalid DMS coordinates: all fields must be numeric');
        }
        if (latDeg < 0 || latDeg > 90 || latMin < 0 || latMin >= 60 || latSec < 0 || latSec >= 60 ||
            lngDeg < 0 || lngDeg > 180 || lngMin < 0 || lngMin >= 60 || lngSec < 0 || lngSec >= 60) {
            console.warn('DMS values out of range:', { latDeg, latMin, latSec, lngDeg, lngMin, lngSec });
            throw new Error('Invalid DMS coordinates: values out of range');
        }

        lat = Utils.dmsToDecimal(latDeg, latMin, latSec, latDir);
        lng = Utils.dmsToDecimal(lngDeg, lngMin, lngSec, lngDir);

        if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            console.warn('Invalid DMS conversion:', { lat, lng });
            throw new Error('Invalid DMS coordinates');
        }
    } else if (format === 'MGRS') {
        const mgrsInput = document.getElementById('mgrsCoord')?.value.trim();
        if (!mgrsInput) {
            console.warn('Empty MGRS input');
            throw new Error('MGRS coordinate cannot be empty');
        }

        console.log('Attempting to parse MGRS:', mgrsInput);

        if (!/^[0-6][0-9][A-HJ-NP-Z][A-HJ-NP-Z]{2}[0-9]+$/.test(mgrsInput)) {
            console.warn('Invalid MGRS format:', mgrsInput);
            throw new Error('MGRS format invalid. Example: 32UPU12345678 (zone, band, square, easting/northing)');
        }

        try {
            if (typeof mgrs === 'undefined') {
                console.warn('MGRS library not loaded');
                throw new Error('MGRS library not loaded. Check script inclusion.');
            }

            console.log('Calling mgrs.toPoint with:', mgrsInput);
            [lng, lat] = mgrs.toPoint(mgrsInput);
            console.log(`Parsed MGRS ${mgrsInput} to Lat: ${lat}, Lng: ${lng}`);

            if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                console.warn('Invalid MGRS coordinates:', { lat, lng });
                throw new Error('Parsed MGRS coordinates out of valid range');
            }
        } catch (e) {
            console.error('MGRS parsing failed:', e.message, 'Input:', mgrsInput);
            throw new Error(`Invalid MGRS format: ${e.message}`);
        }
    }
    console.log('Parsed coordinates:', { lat, lng, format });
    return [lat, lng];
}

// Update coordinate input fields based on format
function updateCoordInputs(format, currentLat = null, currentLng = null) {
    const coordInputs = document.getElementById('coordInputs');
    if (!coordInputs) {
        console.warn('Coordinate inputs container (#coordInputs) not found');
        return;
    }

    coordInputs.innerHTML = '';
    if (format === 'Decimal') {
        coordInputs.innerHTML = `
            <label>Latitude: <input type="number" id="latDec" step="any" placeholder="e.g., 48.0179"></label>
            <label>Longitude: <input type="number" id="lngDec" step="any" placeholder="e.g., 11.1923"></label>
        `;
    } else if (format === 'DMS') {
        coordInputs.innerHTML = `
            <label>Lat: 
                <input type="number" id="latDeg" min="0" max="90" placeholder="Deg">°
                <input type="number" id="latMin" min="0" max="59" placeholder="Min">'
                <input type="number" id="latSec" min="0" max="59.999" step="0.001" placeholder="Sec">"
                <select id="latDir"><option value="N">N</option><option value="S">S</option></select>
            </label>
            <label>Lng: 
                <input type="number" id="lngDeg" min="0" max="180" placeholder="Deg">°
                <input type="number" id="lngMin" min="0" max="59" placeholder="Min">'
                <input type="number" id="lngSec" min="0" max="59.999" step="0.001" placeholder="Sec">"
                <select id="lngDir"><option value="E">E</option><option value="W">W</option></select>
            </label>
        `;
    } else if (format === 'MGRS') {
        coordInputs.innerHTML = `
            <label>MGRS: <input type="text" id="mgrsCoord" placeholder="e.g., 32UPU12345678"></label>
        `;
    }
    coordInputs.innerHTML += `
        <label for="coordHistory">Recent/Favorites:</label>
        <select id="coordHistory" aria-label="Select recent or favorite coordinates">
            <option value="">Select a location</option>
        </select>
        <button id="favoriteBtn" style="margin-left: 10px;">Toggle Favorite</button>
    `;
    console.log(`Coordinate inputs updated to ${format}`);
    updateCoordDropdown();

    // Populate inputs with current coordinates if provided
    if (currentLat !== null && currentLng !== null && !isNaN(currentLat) && !isNaN(currentLng)) {
        populateCoordInputs(currentLat, currentLng);
    }

    // Attach event listener to favorite button
    const favoriteBtn = document.getElementById('favoriteBtn');
    if (favoriteBtn) {
        favoriteBtn.addEventListener('click', () => {
            console.log('Favorite button clicked');
            try {
                const [lat, lng] = parseCoordinates();
                toggleFavorite(lat, lng);
            } catch (error) {
                console.error('Error toggling favorite:', error);
                Utils.handleError(error.message);
            }
        });
        console.log('Attached event listener to favoriteBtn');
    }

    // Attach event listener to coordHistory dropdown
    const coordHistory = document.getElementById('coordHistory');
    if (coordHistory) {
        coordHistory.addEventListener('change', (e) => {
            if (e.target.value) {
                const [lat, lng] = e.target.value.split(',').map(parseFloat);
                console.log('Selected history coordinate:', { lat, lng });
                if (isNaN(lat) || isNaN(lng)) {
                    console.warn('Invalid coordinates selected from history:', { lat, lng });
                    Utils.handleError('Invalid coordinates selected.');
                    return;
                }
                populateCoordInputs(lat, lng);
                if (moveMarkerCallback) {
                    moveMarkerCallback(lat, lng);
                } else {
                    console.warn('moveMarkerCallback not set');
                    Utils.handleError('Marker movement not configured.');
                }
            }
        });
        console.log('Attached event listener to coordHistory');
    }
}

// Helper function to set input values safely
function setInputValue(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.value = value;
    } else {
        console.warn(`Input element ${id} not found`);
    }
}

export {
    initCoordStorage,
    getCoordHistory,
    formatCoordLabel,
    addCoordToHistory,
    toggleFavorite,
    updateCoordInputs,
    populateCoordInputs,
    parseCoordinates,
    setMoveMarkerCallback
};