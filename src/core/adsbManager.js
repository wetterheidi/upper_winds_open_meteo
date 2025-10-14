// src/core/adsbManager.js

"use strict";

import { AppState } from './state.js';
import { Utils } from './utils.js';
import { Settings } from './settings.js';

let adsbInterval = null;
const CORS_PROXY = 'https://corsproxy.io/?';
const ADSB_ATTRIBUTION = 'ADS-B Data provided by <a href="https://www.adsbexchange.com/" target="_blank">ADSBexchange.com</a>';

const apiHeaders = new Headers();
apiHeaders.append("Accept", "application/json");

/**
 * Löst ein benutzerdefiniertes Event im gesamten Dokument aus.
 * @param {string} eventName - Der Name des Events.
 * @param {object} detail - Die mit dem Event zu übergebenden Daten.
 * @private
 */
function dispatchAdsbEvent(eventName, detail = {}) {
    document.dispatchEvent(new CustomEvent(eventName, { detail, bubbles: true }));
}

export async function findAndSelectJumpShip() {
    if (adsbInterval) {
        stopAircraftTracking();
        Utils.handleMessage("ADSB-Tracking gestoppt.");
        return;
    }

    if (AppState.lastLat == null || AppState.lastLng == null) {
        Utils.handleError("Bitte zuerst einen Punkt (DIP) auf der Karte auswählen.");
        return;
    }

    Utils.handleMessage("Suche nach Flugzeugen in der Nähe...");

    try {
        const pos = { lat: AppState.lastLat, lng: AppState.lastLng };
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

        // Event senden, um das UI-Modal anzuzeigen
        dispatchAdsbEvent('adsb:showSelection', { aircraftList });

    } catch (error) {
        console.error("Fehler bei der ADSB-Abfrage:", error);
        Utils.handleError(`Konnte Flugzeugdaten nicht abrufen: ${error.message}`);
    }
}

/**
 * Startet das periodische Tracking für ein ausgewähltes Flugzeug.
 * @param {object} aircraft - Das ausgewählte Flugzeug-Objekt.
 */
export function startAircraftTracking(aircraft) {
    Utils.handleMessage(`Tracking ${aircraft.callsign}...`);

    const findShipButton = document.getElementById('findJumpShipBtn');
    if (findShipButton) {
        findShipButton.textContent = "Stop ADSB Tracking";
        findShipButton.classList.remove('btn-secondary');
        findShipButton.classList.add('btn-danger');
    }

    AppState.adsbTrackPoints = [[aircraft.lat, aircraft.lon]];

    // Event zum Erstellen des Markers senden
    dispatchAdsbEvent('adsb:aircraftSelected', { aircraft, attribution: ADSB_ATTRIBUTION });

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

                if (updatedAircraft.lat && updatedAircraft.lon) {
                    AppState.adsbTrackPoints.push([updatedAircraft.lat, updatedAircraft.lon]);
                    // Event zum Aktualisieren des Markers und der Flugroute senden
                    dispatchAdsbEvent('adsb:aircraftUpdated', { aircraft: updatedAircraft });
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
export function stopAircraftTracking() {
    if (adsbInterval) {
        clearInterval(adsbInterval);
        adsbInterval = null;
    }

    AppState.adsbTrackPoints = [];

    // Event zum Beenden des Trackings und Aufräumen der UI senden
    dispatchAdsbEvent('adsb:trackingStopped', { attribution: ADSB_ATTRIBUTION });

    const findShipButton = document.getElementById('findJumpShipBtn');
    if (findShipButton) {
        findShipButton.textContent = "Find Aircraft";
        findShipButton.classList.remove('btn-danger');
        findShipButton.classList.add('btn-secondary');
    }
}