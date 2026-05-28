import { AppState } from './state.js';
import { Utils } from './utils.js';
import { Settings } from './settings.js';
import { I18n } from './i18n.js';

let adsbInterval = null;
const ADSB_ATTRIBUTION = 'ADS-B Data provided by <a href="https://www.adsbexchange.com/" target="_blank">ADSBexchange.com</a>';
const ADSB_SEARCH_RADIUS_NM = 15;
const ADSB_UPDATE_INTERVAL_MS = 10_000;

const CORS_PROXIES = [
    url => url,                                              // direkt (falls API CORS erlaubt)
    url => `https://api.cors.lol/?url=${encodeURIComponent(url)}`,
    url => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

const apiHeaders = new Headers();
apiHeaders.append("Accept", "application/json");

async function fetchWithFallback(url) {
    for (const proxy of CORS_PROXIES) {
        try {
            const response = await fetch(proxy(url), { headers: apiHeaders });
            if (response.ok) return response;
        } catch {
            // nächsten Proxy versuchen
        }
    }
    throw new Error('Alle CORS-Proxies fehlgeschlagen');
}

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
        Utils.handleMessage(I18n.t('adsb.tracking_stopped'));
        return;
    }

    if (AppState.lastLat == null || AppState.lastLng == null) {
        Utils.handleError(I18n.t('adsb.error_no_dip'));
        return;
    }

    Utils.handleMessage(I18n.t('adsb.searching'));

    try {
        const pos = { lat: AppState.lastLat, lng: AppState.lastLng };
        const apiUrl = `https://api.adsb.lol/v2/lat/${pos.lat}/lon/${pos.lng}/dist/${ADSB_SEARCH_RADIUS_NM}`;
        const response = await fetchWithFallback(apiUrl);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ msg: "Unbekannter API-Fehler" }));
            throw new Error(`API Error ${response.status}: ${errorData.msg}`);
        }

        const data = await response.json();

        if (!data.ac || data.ac.length === 0) {
            Utils.handleMessage(I18n.t('adsb.no_aircraft_found'));
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

        dispatchAdsbEvent('adsb:showSelection', { aircraftList });

    } catch (error) {
        console.error("Fehler bei der ADSB-Abfrage:", error);
        Utils.handleError(I18n.t('adsb.error_fetch_failed', { error: error.message }));
    }
}

/**
 * Startet das periodische Tracking für ein ausgewähltes Flugzeug.
 * @param {object} aircraft - Das ausgewählte Flugzeug-Objekt.
 */
export function startAircraftTracking(aircraft) {
    Utils.handleMessage(I18n.t('adsb.tracking_started', { callsign: aircraft.callsign }));

    const findShipButton = document.getElementById('findJumpShipBtn');
    if (findShipButton) {
        findShipButton.textContent = I18n.t('adsb.btn_stop');
        findShipButton.classList.remove('btn-secondary');
        findShipButton.classList.add('btn-danger');
    }

    AppState.adsbTrackPoints = [[aircraft.lat, aircraft.lon]];

    dispatchAdsbEvent('adsb:aircraftSelected', { aircraft, attribution: ADSB_ATTRIBUTION });

    const updateAircraftPosition = async () => {
        try {
            const apiUrl = `https://api.adsb.lol/v2/hex/${aircraft.icao24}`;
            const response = await fetchWithFallback(apiUrl);

            if (response.status === 404) {
                stopAircraftTracking();
                Utils.handleMessage(I18n.t('adsb.aircraft_lost', { callsign: aircraft.callsign }));
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
                    dispatchAdsbEvent('adsb:aircraftUpdated', { aircraft: updatedAircraft });
                }
            }
        } catch (error) {
            console.error("Fehler beim ADSB-Tracking:", error);
        }
    };

    updateAircraftPosition();
    adsbInterval = setInterval(updateAircraftPosition, ADSB_UPDATE_INTERVAL_MS);
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

    dispatchAdsbEvent('adsb:trackingStopped', { attribution: ADSB_ATTRIBUTION });

    const findShipButton = document.getElementById('findJumpShipBtn');
    if (findShipButton) {
        findShipButton.textContent = I18n.t('adsb.btn_find');
        findShipButton.classList.remove('btn-danger');
        findShipButton.classList.add('btn-secondary');
    }
}