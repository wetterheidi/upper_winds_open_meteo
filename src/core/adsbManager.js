// src/core/adsbManager.js

"use strict";

import { AppState } from './state.js';
import { Utils } from './utils.js';
import * as mapManager from '../ui-web/mapManager.js';
import { Settings } from './settings.js';

let adsbInterval = null;
let isPausedForRateLimit = false; // Flag, um die Pausierung zu steuern

/**
 * Funktion als An/Aus-Schalter. Startet die Suche oder stoppt ein laufendes Tracking.
 */
export async function findAndSelectJumpShip() {
    // Wenn das Tracking bereits läuft, fungiert der Klick als "Stopp"-Befehl.
    if (adsbInterval) {
        stopAircraftTracking();
        Utils.handleMessage("ADSB-Tracking gestoppt.");
        return;
    }

    if (!AppState.liveMarker) {
        Utils.handleError("Bitte starte zuerst das Live-Tracking.");
        return;
    }
    
    Utils.handleMessage("Suche nach Flugzeugen in der Nähe...");

    try {
        const pos = AppState.liveMarker.getLatLng();
        const bbox = [pos.lat - 0.3, pos.lat + 0.3, pos.lng - 0.3, pos.lng + 0.3].join(',');
        const response = await fetch(`https://opensky-network.org/api/states/all?lamin=${bbox.split(',')[0]}&lomin=${bbox.split(',')[2]}&lamax=${bbox.split(',')[1]}&lomax=${bbox.split(',')[3]}`);
        
        if (!response.ok) throw new Error(`OpenSky API Error: ${response.status}`);
        const data = await response.json();

        if (!data.states || data.states.length === 0) {
            Utils.handleMessage("Keine Flugzeuge in der Nähe gefunden.");
            return;
        }

        const aircraftList = data.states
            .filter(s => s[5] && s[6] && s[7]) 
            .map(s => ({
                icao24: s[0], callsign: s[1].trim() || 'N/A', altitude: Math.round(s[7] * 3.28084),
                lat: s[6], lon: s[5], track: s[10], velocity: s[9], vertical_rate: s[11]
            }));

        showAircraftSelectionModal(aircraftList);

    } catch (error) {
        console.error("Fehler bei der ADSB-Abfrage:", error);
        Utils.handleError("Konnte Flugzeugdaten nicht abrufen.");
    }
}


/**
 * Zeigt das Modal zur Flugzeugauswahl an.
 * @param {object[]} aircraftList - Die Liste der Flugzeuge.
 * @private
 */
function showAircraftSelectionModal(aircraftList) {
    const modal = document.getElementById('adsbSelectionModal');
    const list = document.getElementById('aircraftList');
    const cancelBtn = document.getElementById('adsbCancel');

    if (!modal || !list || !cancelBtn) return;

    list.innerHTML = ''; 

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
    
    // UI-Button anpassen, um als "Stop"-Button zu fungieren
    const findShipButton = document.getElementById('findJumpShipBtn');
    if (findShipButton) {
        findShipButton.textContent = "Stop ADSB Tracking";
        findShipButton.classList.remove('btn-secondary');
        findShipButton.classList.add('btn-danger'); // Macht den Button rot
    }

    if (AppState.aircraftMarker) AppState.map.removeLayer(AppState.aircraftMarker);
    
    const marker = mapManager.createAircraftMarker(aircraft.lat, aircraft.lon, aircraft.track);
    marker.bindTooltip("", { permanent: true, direction: 'top', offset: [0, -15], className: 'adsb-tooltip' });
    updateAircraftTooltip(aircraft);

    // Diese innere Funktion wird periodisch aufgerufen
    const updateAircraftPosition = async () => {
        if (isPausedForRateLimit) {
            console.log("ADSB-Tracking ist wegen Rate-Limit pausiert.");
            return; // Nichts tun, während wir pausieren
        }

        try {
            const response = await fetch(`https://opensky-network.org/api/states/all?icao24=${aircraft.icao24}`);
            
            // NEUE FEHLERBEHANDLUNG
            if (response.status === 429) {
                console.warn("ADSB Rate-Limit erreicht. Pausiere für 60 Sekunden.");
                Utils.handleError("API-Limit erreicht. ADSB-Tracking pausiert für 60s.");
                isPausedForRateLimit = true;
                setTimeout(() => {
                    isPausedForRateLimit = false;
                    console.log("ADSB-Tracking nach Pause wieder aufgenommen.");
                }, 60000); // 60 Sekunden warten
                return;
            }
            if (!response.ok) throw new Error(`API Error: ${response.status}`);

            const data = await response.json();

            if (data.states && data.states[0]) {
                const state = data.states[0];
                const updatedAircraft = {
                    callsign: state[1].trim() || 'N/A', lat: state[6], lon: state[5], track: state[10],
                    altitude: state[7], velocity: state[9], vertical_rate: state[11]
                };

                if (AppState.aircraftMarker && updatedAircraft.lat && updatedAircraft.lon) {
                    AppState.aircraftMarker.setLatLng([updatedAircraft.lat, updatedAircraft.lon]);
                    AppState.aircraftMarker.setRotationAngle(updatedAircraft.track);
                    updateAircraftTooltip(updatedAircraft);
                }
            } else {
                stopAircraftTracking();
                Utils.handleMessage(`${aircraft.callsign} ist nicht mehr sichtbar. Tracking gestoppt.`);
            }
        } catch (error) {
            // Fängt auch den JSON-Parsing-Fehler bei "Too many requests"-Text ab
            if (error instanceof SyntaxError) {
                 console.error("Fehler beim ADSB-Tracking: API-Antwort war kein gültiges JSON. Wahrscheinlich ein Rate-Limit.");
            } else {
                console.error("Fehler beim ADSB-Tracking:", error);
            }
        }
    };

    updateAircraftPosition(); // Sofortiger erster Aufruf
    adsbInterval = setInterval(updateAircraftPosition, 10000); // Intervall auf 10 Sekunden erhöht
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

    // Button-Zustand zurücksetzen
    const findShipButton = document.getElementById('findJumpShipBtn');
    if (findShipButton) {
        findShipButton.textContent = "Find Jump Ship";
        findShipButton.classList.remove('btn-danger');
        findShipButton.classList.add('btn-secondary');
    }
}

/**
 * Aktualisiert den Inhalt des Tooltips für den Flugzeug-Marker.
 * @param {object} aircraftData - Die aktuellen Flugdaten vom ADSB-Signal.
 * @private
 */
function updateAircraftTooltip(aircraftData) {
    if (!AppState.aircraftMarker) return;

    const heightUnit = Settings.getValue('heightUnit', 'm');
    const speedUnit = Settings.getValue('windUnit', 'kt');

    const altitude = Math.round(Utils.convertHeight(aircraftData.altitude, heightUnit));
    const altitudeText = `${altitude} ${heightUnit}`;

    const speed = Utils.convertWind(aircraftData.velocity, speedUnit, 'm/s');
    const speedText = `${(speedUnit === 'bft' ? Math.round(speed) : speed.toFixed(0))} ${speedUnit}`;

    let verticalRateText = "---";
    if (aircraftData.vertical_rate) {
        const rateFPM = Math.round(aircraftData.vertical_rate * 196.85);
        if (rateFPM > 50) verticalRateText = `+${rateFPM} ft/min`;
        else if (rateFPM < -50) verticalRateText = `${rateFPM} ft/min`;
        else verticalRateText = "Level";
    }

    const tooltipContent = `
        <strong>${aircraftData.callsign || 'N/A'}</strong><br>
        Höhe: ${altitudeText}<br>
        Speed: ${speedText}<br>
        V/S: ${verticalRateText}
    `;

    AppState.aircraftMarker.setTooltipContent(tooltipContent);
}