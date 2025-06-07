// coordinates.js - Neu gestaltet für eine intuitive Orts-Suche

"use strict";

import { Settings } from './settings.js';
import { Utils } from './utils.js';

// Callbacks, die von app.js gesetzt werden, um mit der Karte zu interagieren
let moveMarkerCallback = null;
let getCurrentMarkerPositionCallback = null;

/**
 * Initialisiert das gesamte Location-Search-Modul.
 * Diese Funktion wird von app.js aufgerufen.
 */
function initializeLocationSearch() {
    // Referenzen zu den neuen UI-Elementen
    const searchInput = document.getElementById('locationSearchInput');
    const resultsList = document.getElementById('locationResults');
    const saveFavoriteBtn = document.getElementById('saveCurrentLocationBtn');

    if (!searchInput || !resultsList || !saveFavoriteBtn) {
        console.error('Einige Elemente der Ortssuche wurden nicht im DOM gefunden.');
        return;
    }

    // Debounced-Version der Suchfunktion, um die API-Anfragen zu begrenzen
    const debouncedSearch = Utils.debounce(performSearch, 300);

    // Event Listener für das Suchfeld
    searchInput.addEventListener('input', () => {
        debouncedSearch(searchInput.value);
    });

    // Zeigt die Liste an, wenn der Benutzer in das Feld klickt
    searchInput.addEventListener('focus', () => {
        renderResultsList(); // Zeigt Favoriten/Verlauf sofort an
        resultsList.style.display = 'block';
    });

    // Verbirgt die Liste, wenn der Benutzer aus dem Feld klickt (mit einer kleinen Verzögerung)
    searchInput.addEventListener('blur', () => {
        setTimeout(() => {
            resultsList.style.display = 'none';
        }, 200); // Verzögerung, damit Klicks auf Listeneinträge noch registriert werden
    });

    // Event Listener für den "Favorit speichern"-Button
    saveFavoriteBtn.addEventListener('click', () => {
        if (getCurrentMarkerPositionCallback) {
            const pos = getCurrentMarkerPositionCallback();
            if (pos && pos.lat && pos.lng) {
                const name = prompt("Please enter a name for this favorit:");
                if (name) {
                    addOrUpdateFavorite(pos.lat, pos.lng, name);
                }
            } else {
                Utils.handleError("No valid marker position.");
            }
        }
    });

    // Initial das UI rendern
    renderResultsList();
}

/**
 * Führt die Suche aus, basierend auf der Benutzereingabe.
 * Unterscheidet zwischen Koordinaten und Suchbegriffen.
 * @param {string} query - Die Eingabe des Benutzers.
 */
async function performSearch(query) {
    if (!query.trim()) {
        renderResultsList(); // Zeigt nur Favoriten/Verlauf bei leerer Eingabe
        return;
    }

    let searchResults = [];
    const parsedCoords = parseQueryAsCoordinates(query);

    if (parsedCoords) {
        // Wenn die Eingabe als Koordinate erkannt wurde
        searchResults.push({
            display_name: `Koordinate: ${parsedCoords.lat.toFixed(5)}, ${parsedCoords.lng.toFixed(5)}`,
            lat: parsedCoords.lat,
            lon: parsedCoords.lng, // <<< KORREKTUR HIER: Stellt sicher, dass 'lon' den Wert von 'lng' erhält
            type: 'coordinate'
        });
        renderResultsList(searchResults);
    } else {
        // Wenn es keine Koordinate ist, Nominatim API für die Ortssuche verwenden
        try {
            const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`;
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'User-Agent': 'Skydiving-Weather-App/1.0 (anonymous)' }
            });
            if (!response.ok) throw new Error(`Nominatim API Fehler: ${response.statusText}`);
            const data = await response.json();
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
 * Erkennt Dezimalgrade und MGRS (mit oder ohne Leerzeichen).
 * @param {string} query - Die Eingabe des Benutzers.
 * @returns {object|null} Ein Objekt mit {lat, lng} oder null.
 */
function parseQueryAsCoordinates(query) {
    const trimmedQuery = query.trim();

    // 1. Versuch: Dezimalgrade (z.B. "48.123, -11.456" oder "48.123 -11.456")
    const cleanedForDecimal = trimmedQuery.replace(',', ' ');
    const decMatch = cleanedForDecimal.match(/^(-?\d{1,3}(\.\d+)?)\s+(-?\d{1,3}(\.\d+)?)$/);
    if (decMatch) {
        const lat = parseFloat(decMatch[1]);
        const lng = parseFloat(decMatch[3]);
        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
            console.log("Eingabe als Dezimalgrad erkannt.");
            return { lat, lng };
        }
    }

    // 2. Versuch: MGRS (z.B. "32U PU 12345 67890" oder "32UPU1234567890")
    const cleanedForMgrs = trimmedQuery.replace(/\s/g, '').toUpperCase();
    // Ein robusterer Regex für MGRS: Zone, Band, Square, und eine gerade Anzahl von Ziffern.
    const mgrsRegex = /^[0-9]{1,2}[C-HJ-NP-X][A-HJ-NP-Z]{2}(\d{2}|\d{4}|\d{6}|\d{8}|\d{10})$/;

    if (typeof mgrs !== 'undefined' && mgrsRegex.test(cleanedForMgrs)) {
        try {
            const [lng, lat] = mgrs.toPoint(cleanedForMgrs);
            if (!isNaN(lat) && !isNaN(lng)) {
                console.log("Eingabe als MGRS erkannt.");
                return { lat, lng };
            }
        } catch (e) {
            // Fängt Fehler von der mgrs.toPoint-Bibliothek ab, falls das Format doch ungültig ist.
            console.warn("MGRS-Parsing fehlgeschlagen, obwohl Regex passte:", e.message);
            return null;
        }
    }

    // Wenn keine Koordinate erkannt wurde
    return null;
}


/**
 * Rendert die Ergebnisliste, die Favoriten, Verlauf und Suchergebnisse enthält.
 * @param {Array} searchResults - Ein Array mit Suchergebnissen von der API.
 */
function renderResultsList(searchResults = []) {
    const resultsList = document.getElementById('locationResults');
    if (!resultsList) return;

    resultsList.innerHTML = '';
    const history = getCoordHistory();
    const favorites = history.filter(item => item.isFavorite);
    const nonFavorites = history.filter(item => !item.isFavorite);

// Funktion zum Erstellen eines Listeneintrags (JETZT MIT LÖSCHFUNKTION)
    const createListItem = (item) => {
        const li = document.createElement('li');
        
        // KORREKTUR: Sicherstellen, dass lat und lon/lng korrekt gelesen werden
        const lat = parseFloat(item.lat);
        const lon = parseFloat(item.lon || item.lng); // Akzeptiert 'lon' ODER 'lng'
        
        if (isNaN(lat) || isNaN(lon)) return null; // Ungültigen Eintrag überspringen

        li.dataset.lat = lat;
        li.dataset.lon = lon;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'location-name';
        nameSpan.textContent = item.display_name || item.label;
        li.appendChild(nameSpan);

        nameSpan.addEventListener('mousedown', (e) => {
            e.preventDefault();
            if (moveMarkerCallback) {
                moveMarkerCallback(lat, lon);
                addCoordToHistory(lat, lon, item.display_name || item.label, item.isFavorite || false);
                resultsList.style.display = 'none';
            }
        });

        // Container für die Buttons (Favorit & Löschen)
        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'location-item-buttons';
        
        // Favoriten-Stern
        const favToggle = document.createElement('button');
        favToggle.className = 'favorite-toggle';
        favToggle.innerHTML = item.isFavorite ? '★' : '☆';
        if(item.isFavorite) favToggle.classList.add('is-favorite');
        favToggle.title = "Als Favorit markieren/entfernen";
        buttonsContainer.appendChild(favToggle);

        favToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavorite(lat, lon, item.display_name || item.label);
        });

        // NEU: Löschen-Button hinzufügen
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-location-btn';
        deleteBtn.innerHTML = '×'; // Ein einfaches 'x' als Symbol
        deleteBtn.title = "Diesen Eintrag löschen";
        buttonsContainer.appendChild(deleteBtn);

        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Möchten Sie "${item.display_name || item.label}" wirklich löschen?`)) {
                removeLocationFromHistory(lat, lon);
            }
        });

        li.appendChild(buttonsContainer);
        return li;
    };

    // Rendere Suchergebnisse
    if (searchResults.length > 0) {
        const heading = document.createElement('li');
        heading.className = 'results-heading';
        heading.textContent = 'Suchergebnisse';
        heading.style.fontWeight = 'bold';
        heading.style.background = '#f0f0f0';
        resultsList.appendChild(heading);
        searchResults.forEach(result => {
            // Prüfen, ob dieser Ort bereits ein Favorit ist
            const fav = favorites.find(f => Math.abs(f.lat - result.lat) < 0.001 && Math.abs(f.lng - result.lon) < 0.001);
            result.isFavorite = !!fav;
            if (fav) result.display_name = fav.label; // Wenn Favorit, benutze den gespeicherten Namen

            resultsList.appendChild(createListItem(result));
        });
    }

    // Rendere Favoriten
    if (favorites.length > 0) {
        const heading = document.createElement('li');
        heading.className = 'results-heading';
        heading.textContent = 'Favorites';
        heading.style.fontWeight = 'bold';
        heading.style.background = '#f0f0f0';
        resultsList.appendChild(heading);
        favorites.forEach(fav => resultsList.appendChild(createListItem(fav)));
    }

    // Rendere Verlauf
    if (nonFavorites.length > 0) {
        const heading = document.createElement('li');
        heading.className = 'results-heading';
        heading.textContent = 'Previous Locations';
        heading.style.fontWeight = 'bold';
        heading.style.background = '#f0f0f0';
        resultsList.appendChild(heading);
        nonFavorites.forEach(item => resultsList.appendChild(createListItem(item)));
    }
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

    // Entferne alte Einträge für dieselbe Koordinate
    history = history.filter(entry => Math.abs(entry.lat - newLat) > 0.0001 || Math.abs(entry.lng - newLng) > 0.0001);

    // Füge neuen Eintrag am Anfang hinzu
    history.unshift({
        lat: newLat,
        lng: newLng,
        label: label,
        isFavorite: isFavorite,
        timestamp: Date.now()
    });

    // Begrenze die Anzahl der Nicht-Favoriten
    const favorites = history.filter(e => e.isFavorite);
    const nonFavorites = history.filter(e => !e.isFavorite).slice(0, 5); // Behalte 5 letzte Orte

    saveCoordHistory([...favorites, ...nonFavorites]);
    renderResultsList();
}

function addOrUpdateFavorite(lat, lng, name) {
    if (isNaN(lat) || isNaN(lng)) return;

    let history = getCoordHistory();
    const newLat = parseFloat(lat.toFixed(5));
    const newLng = parseFloat(lng.toFixed(5));

    // Prüfen, ob der Ort bereits existiert
    const existingEntry = history.find(entry => Math.abs(entry.lat - newLat) < 0.0001 && Math.abs(entry.lng - newLng) < 0.0001);

    if (existingEntry) {
        existingEntry.isFavorite = true;
        existingEntry.label = name;
    } else {
        history.unshift({
            lat: newLat,
            lng: newLng,
            label: name,
            isFavorite: true,
            timestamp: Date.now()
        });
    }

    saveCoordHistory(history);
    Utils.handleMessage(`"${name}" als Favorit gespeichert.`);
    renderResultsList();
}

/**
 * Schaltet den Favoriten-Status eines Ortes um (ohne ihn zu löschen).
 * @param {number} lat - Die Latitude des Ortes.
 * @param {number} lng - Die Longitude des Ortes.
 * @param {string} label - Das aktuelle Label des Ortes.
 */
function toggleFavorite(lat, lng, label) {
    if (isNaN(lat) || isNaN(lng)) return;
    
    let history = getCoordHistory();
    const entry = history.find(e => {
        const entryLat = parseFloat(e.lat);
        const entryLng = parseFloat(e.lon || e.lng);
        return Math.abs(entryLat - lat) < 0.0001 && Math.abs(entryLng - lng) < 0.0001;
    });

    if (entry) {
        // Schalte den Favoriten-Status einfach um.
        entry.isFavorite = !entry.isFavorite;

        if (entry.isFavorite) {
            // Wenn es zum Favorit wird, nach einem Namen fragen (optional)
            const name = prompt("Please enter a name for this favorite:", entry.label || label);
            if (name) {
                entry.label = name;
                Utils.handleMessage(`"${name}" als Favorit gespeichert.`);
            } else {
                // Wenn der Benutzer abbricht, den Vorgang rückgängig machen.
                entry.isFavorite = false;
                return; // Beende die Funktion hier
            }
        } else {
            Utils.handleMessage(`"${entry.label}" ist kein Favorit mehr.`);
        }
    } else {
        // Sollte nicht vorkommen, da der Button nur bei existierenden Einträgen angezeigt wird.
        // Sicherheitshalber: Neuen Favoriten hinzufügen.
        addOrUpdateFavorite(lat, lng, label);
    }

    saveCoordHistory(history);
    renderResultsList(); // Liste neu zeichnen, um den geänderten Stern anzuzeigen
}

/**
 * Entfernt einen Ort vollständig aus dem Verlauf und den Favoriten.
 * @param {number} lat - Die Latitude des zu löschenden Ortes.
 * @param {number} lng - Die Longitude des zu löschenden Ortes.
 */
function removeLocationFromHistory(lat, lng) {
    if (isNaN(lat) || isNaN(lng)) return;

    let history = getCoordHistory();
    
    // Filtere den Eintrag heraus, der gelöscht werden soll
    const updatedHistory = history.filter(entry => {
        const entryLat = parseFloat(entry.lat);
        const entryLng = parseFloat(entry.lng || entry.lon);
        return Math.abs(entryLat - lat) > 0.0001 || Math.abs(entryLng - lng) > 0.0001;
    });

    saveCoordHistory(updatedHistory);
    Utils.handleMessage("Location deleted.");
    renderResultsList(); // Rendere die Liste neu, um die Änderung anzuzeigen
}


// --- Exportiere die notwendigen Funktionen ---

export {
    initializeLocationSearch,
    setMoveMarkerCallback,
    setCurrentMarkerPositionCallback,
    addCoordToHistory
};


/**
 * Setzt die Callback-Funktion, um den Marker auf der Karte zu bewegen.
 * @param {function} callback - Die Funktion aus app.js, die (lat, lng) entgegennimmt.
 */
function setMoveMarkerCallback(callback) {
    moveMarkerCallback = callback;
}

/**
 * Setzt die Callback-Funktion, um die aktuelle Position des Markers abzufragen.
 * @param {function} callback - Die Funktion aus app.js, die {lat, lng} zurückgibt.
 */
function setCurrentMarkerPositionCallback(callback) {
    getCurrentMarkerPositionCallback = callback;
}