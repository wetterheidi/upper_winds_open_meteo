// src/core/adsbManager.js

"use strict";

import { AppState } from './state.js';
import { Utils } from './utils.js';
import * as mapManager from '../ui-web/mapManager.js'; 

let adsbInterval = null;

/**
 * Holt Flugzeugdaten von OpenSky, filtert sie und zeigt das Auswahl-Modal an.
 */
export async function findAndSelectJumpShip() {
    if (!AppState.liveMarker) {
        Utils.handleError("Bitte starte zuerst das Live-Tracking.");
        return;
    }
    if (adsbInterval) {
        stopAircraftTracking();
        Utils.handleMessage("ADSB-Tracking gestoppt.");
        return;
    }

    Utils.handleMessage("Suche nach Flugzeugen in der Nähe...");

    try {
        const pos = AppState.liveMarker.getLatLng();
        // Bounding Box: ca. 20x20 km um die aktuelle Position
        const bbox = [pos.lat - 0.3, pos.lat + 0.3, pos.lng - 0.3, pos.lng + 0.3].join(',');
        const response = await fetch(`https://opensky-network.org/api/states/all?lamin=${bbox.split(',')[0]}&lomin=${bbox.split(',')[2]}&lamax=${bbox.split(',')[1]}&lomax=${bbox.split(',')[3]}`);
        
        if (!response.ok) {
            throw new Error(`OpenSky API Error: ${response.status}`);
        }

        const data = await response.json();

        if (!data.states || data.states.length === 0) {
            Utils.handleMessage("Keine Flugzeuge in der Nähe gefunden.");
            return;
        }

        const aircraftList = data.states
            .filter(s => s[5] && s[6]) // Nur Flugzeuge mit gültigen Koordinaten
            .map(s => ({
                icao24: s[0],
                callsign: s[1].trim() || 'N/A',
                altitude: Math.round(s[7] * 3.28084), // Meter in Fuß umrechnen und runden
                lat: s[6],
                lon: s[5],
                track: s[10]
            }));

        showAircraftSelectionModal(aircraftList);

    } catch (error) {
        console.error("Fehler bei der ADSB-Abfrage:", error);
        Utils.handleError("Konnte Flugzeugdaten nicht abrufen.");
    }
}

/**
 * Zeigt das Modal mit der Liste der gefundenen Flugzeuge an.
 * @param {object[]} aircraftList - Die Liste der Flugzeuge.
 * @private
 */
function showAircraftSelectionModal(aircraftList) {
    const modal = document.getElementById('adsbSelectionModal');
    const list = document.getElementById('aircraftList');
    const cancelBtn = document.getElementById('adsbCancel');

    if (!modal || !list || !cancelBtn) return;

    list.innerHTML = ''; // Liste leeren

    aircraftList.forEach(ac => {
        const li = document.createElement('li');
        li.textContent = `${ac.callsign} / ${ac.altitude} ft`;
        li.onclick = () => {
            modal.style.display = 'none';
            startAircraftTracking(ac);
        };
        list.appendChild(li);
    });

    cancelBtn.onclick = () => {
        modal.style.display = 'none';
    };

    modal.style.display = 'flex';
}

/**
 * Startet das periodische Tracking für ein ausgewähltes Flugzeug.
 * @param {object} aircraft - Das ausgewählte Flugzeug-Objekt.
 * @private
 */
function startAircraftTracking(aircraft) {
    Utils.handleMessage(`Tracking ${aircraft.callsign}...`);

    // Ersten Marker sofort erstellen
    if (AppState.aircraftMarker) {
        AppState.map.removeLayer(AppState.aircraftMarker);
    }
    mapManager.createAircraftMarker(aircraft.lat, aircraft.lon, aircraft.track);

    // Periodisches Update starten
    adsbInterval = setInterval(async () => {
        try {
            const response = await fetch(`https://opensky-network.org/api/states/all?icao24=${aircraft.icao24}`);
            const data = await response.json();
            if (data.states && data.states[0]) {
                const state = data.states[0];
                const lat = state[6];
                const lon = state[5];
                const track = state[10];

                if (AppState.aircraftMarker && lat && lon) {
                    AppState.aircraftMarker.setLatLng([lat, lon]);
                    AppState.aircraftMarker.setRotationAngle(track);
                }
            } else {
                // Wenn das Flugzeug nicht mehr gefunden wird (außer Reichweite), Tracking stoppen
                stopAircraftTracking();
                Utils.handleMessage(`${aircraft.callsign} ist nicht mehr sichtbar. Tracking gestoppt.`);
            }
        } catch (error) {
            console.error("Fehler beim ADSB-Tracking:", error);
        }
    }, 8000); // Alle 8 Sekunden aktualisieren (schont die API)
}

/**
 * Stoppt das ADSB-Tracking und entfernt den Marker.
 */
function stopAircraftTracking() {
    if (adsbInterval) {
        clearInterval(adsbInterval);
        adsbInterval = null;
    }
    if (AppState.aircraftMarker) {
        AppState.map.removeLayer(AppState.aircraftMarker);
        AppState.aircraftMarker = null;
    }
}