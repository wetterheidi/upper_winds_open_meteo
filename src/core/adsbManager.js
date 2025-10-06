// src/core/adsbManager.js

"use strict";

import { AppState } from './state.js';
import { Utils } from './utils.js';
import * as mapManager from '../ui-web/mapManager.js';
import { Settings } from './settings.js';

let adsbInterval = null;
const CORS_PROXY = 'https://corsproxy.io/?';

// NEU: Definiere den Attributions-String als Konstante, um Tippfehler zu vermeiden
const ADSB_ATTRIBUTION = 'ADS-B Data provided by <a href="https://www.adsbexchange.com/" target="_blank">ADSBexchange.com</a>';

const apiHeaders = new Headers();
apiHeaders.append("Accept", "application/json");

/**
 * Funktion als An/Aus-Schalter. Startet die Suche oder stoppt ein laufendes Tracking.
 */
export async function findAndSelectJumpShip() {
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
        const apiUrl = `https://api.adsb.lol/v2/lat/${pos.lat}/lon/${pos.lng}/dist/15`;
        
        const response = await fetch(CORS_PROXY + encodeURIComponent(apiUrl), { headers: apiHeaders });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ msg: "Unbekannter API-Fehler" }));
            throw new Error(`API Error ${response.status}: ${errorData.msg}`);
        }

        const data = await response.json();

        if (!data.ac || data.ac.length === 0) {
            Utils.handleMessage("Keine Flugzeuge in der Nähe gefunden.");
            return;
        }

        const aircraftList = data.ac
            .filter(ac => ac.lat && ac.lon && ac.alt_baro)
            .map(ac => ({
                icao24: ac.hex,
                callsign: ac.flight ? ac.flight.trim() : 'N/A',
                altitude: ac.alt_baro,
                lat: ac.lat,
                lon: ac.lon,
                track: ac.track,
                velocity: ac.gs,
                vertical_rate: ac.baro_rate
            }));

        showAircraftSelectionModal(aircraftList);

    } catch (error) {
        console.error("Fehler bei der ADSB-Abfrage:", error);
        Utils.handleError(`Konnte Flugzeugdaten nicht abrufen: ${error.message}`);
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
    aircraftList.sort((a, b) => b.altitude - a.altitude);

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
    
    // UI-Anpassungen für den Button
    const findShipButton = document.getElementById('findJumpShipBtn');
    if (findShipButton) {
        findShipButton.textContent = "Stop ADSB Tracking";
        findShipButton.classList.remove('btn-secondary');
        findShipButton.classList.add('btn-danger');
    }

    if (AppState.aircraftMarker) AppState.map.removeLayer(AppState.aircraftMarker);
    
    AppState.adsbTrackPoints = [[aircraft.lat, aircraft.lon]];
    mapManager.clearAircraftTrack();

    const marker = mapManager.createAircraftMarker(aircraft.lat, aircraft.lon, aircraft.track);
    marker.bindTooltip("", { permanent: true, direction: 'top', offset: [0, -15], className: 'adsb-tooltip' });
    updateAircraftTooltip(aircraft);

    // NEU: Attribution zur Karte hinzufügen
    if (AppState.map && AppState.map.attributionControl) {
        AppState.map.attributionControl.addAttribution(ADSB_ATTRIBUTION);
    }

    const updateAircraftPosition = async () => {
        try {
            const apiUrl = `https://api.adsb.lol/v2/hex/${aircraft.icao24}`;
            const response = await fetch(CORS_PROXY + encodeURIComponent(apiUrl), { headers: apiHeaders });
            
            if (response.status === 404) {
                stopAircraftTracking();
                Utils.handleMessage(`${aircraft.callsign} ist nicht mehr sichtbar. Tracking gestoppt.`);
                return;
            }
            if (!response.ok) throw new Error(`API Error ${response.status}`);

            const data = await response.json();

            if (data.ac && data.ac.length > 0) {
                const state = data.ac[0];
                const updatedAircraft = {
                    icao24: state.hex,
                    callsign: state.flight ? state.flight.trim() : 'N/A',
                    lat: state.lat, lon: state.lon, track: state.track,
                    altitude: state.alt_baro, velocity: state.gs, vertical_rate: state.baro_rate
                };

                if (AppState.aircraftMarker && updatedAircraft.lat && updatedAircraft.lon) {
                    AppState.aircraftMarker.setLatLng([updatedAircraft.lat, updatedAircraft.lon]);
                    AppState.aircraftMarker.setRotationAngle(updatedAircraft.track);
                    updateAircraftTooltip(updatedAircraft);
                    AppState.adsbTrackPoints.push([updatedAircraft.lat, updatedAircraft.lon]);
                    mapManager.drawAircraftTrack(AppState.adsbTrackPoints);
                }
            }
        } catch (error) {
            console.error("Fehler beim ADSB-Tracking:", error);
        }
    };

    updateAircraftPosition();
    adsbInterval = setInterval(updateAircraftPosition, 10000); 
}

/**
 * Stoppt das ADSB-Tracking und setzt die UI zurück.
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

    mapManager.clearAircraftTrack();
    AppState.adsbTrackPoints = [];

    // NEU: Attribution von der Karte entfernen
    if (AppState.map && AppState.map.attributionControl) {
        AppState.map.attributionControl.removeAttribution(ADSB_ATTRIBUTION);
    }

    const findShipButton = document.getElementById('findJumpShipBtn');
    if (findShipButton) {
        findShipButton.textContent = "Find Aircraft";
        findShipButton.classList.remove('btn-danger');
        findShipButton.classList.add('btn-secondary');
    }
}

/**
 * Aktualisiert den Inhalt des Tooltips für den Flugzeug-Marker.
 * @param {object} aircraftData - Die aktuellen Flugdaten.
 * @private
 */
function updateAircraftTooltip(aircraftData) {
    if (!AppState.aircraftMarker) return;

    const heightUnit = Settings.getValue('heightUnit', 'm');
    const speedUnit = Settings.getValue('windUnit', 'kt');

    const altitudeFt = aircraftData.altitude;
    const altitudeText = heightUnit === 'm' 
        ? `${Math.round(altitudeFt * 0.3048)} m`
        : `${altitudeFt} ft`;

    const speedKt = aircraftData.velocity;
    const speed = Utils.convertWind(speedKt, speedUnit, 'kt');
    const speedText = `${(speedUnit === 'bft' ? Math.round(speed) : speed.toFixed(0))} ${speedUnit}`;

    let verticalRateText = "Level";
    if (aircraftData.vertical_rate) {
        const rateFPM = aircraftData.vertical_rate;
        if (rateFPM > 100) verticalRateText = `+${rateFPM} ft/min`;
        else if (rateFPM < -100) verticalRateText = `${rateFPM} ft/min`;
    }

    const tooltipContent = `
        <strong>${aircraftData.callsign || 'N/A'}</strong><br>
        Altitude: ${altitudeText}<br>
        Speed: ${speedText}<br>
        V/S: ${verticalRateText}
    `;

    AppState.aircraftMarker.setTooltipContent(tooltipContent);
}