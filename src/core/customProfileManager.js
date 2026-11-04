/**
 * @file customProfileManager.js
 * @description Hält das importierte "Eigene Profil" (AppState.customProfile) und liefert es
 * als weatherData an fetchWeather, sobald im Modell-Dropdown CUSTOM_PROFILE_MODEL_ID gewählt ist.
 * Dadurch bekommen alle Stellen, die Wetterdaten neu laden (DIP verschieben, Modellwechsel,
 * Track laden …), automatisch wieder das Profil – ohne Modelldaten beizumischen.
 *
 * Das Profil wird bei jedem Abruf neu gebaut und geländefolgend auf die aktuelle
 * Geländehöhe am DIP gelegt (AppState.lastAltitude), damit die Sprungplanung mit Höhen über
 * Grund rechnet. Weicht die Bodenhöhe des Profils stark ab, gibt es eine Warnung – gerechnet
 * wird trotzdem.
 */

import { AppState } from './state.js';
import { Utils } from './utils.js';
import { I18n } from './i18n.js';
import { CUSTOM_PROFILE_MODEL_ID, buildCustomProfileWeatherData } from './customProfileImport.js';

export { CUSTOM_PROFILE_MODEL_ID };

/** Ab dieser Differenz (m) zwischen Profilboden und Geländehöhe am DIP wird gewarnt (wie Orographie-Warnung). */
export const PROFILE_HEIGHT_MISMATCH_WARN_M = 100;

let _lastWarnedDem = null;

/** @returns {boolean} true, wenn ein Profil importiert ist (unabhängig von der Auswahl). */
export function hasCustomProfile() {
    return !!AppState.customProfile;
}

/** @returns {boolean} true, wenn ein Profil importiert und im Modell-Dropdown ausgewählt ist. */
export function isCustomProfileSelected() {
    return hasCustomProfile() && document.getElementById('modelSelect')?.value === CUSTOM_PROFILE_MODEL_ID;
}

/**
 * Setzt das aktive Profil.
 * @param {{parsed: object, presetId: string, filename: string, timeUtc: string,
 *          groundElevationM?: number, surfaceWind?: {direction: number, speedKmh: number}}} profile
 */
export function setCustomProfile(profile) {
    AppState.customProfile = profile;
    _lastWarnedDem = null;
}

export function clearCustomProfile() {
    AppState.customProfile = null;
    AppState.lastProfileGround = null;
    _lastWarnedDem = null;
}

/**
 * Höhendifferenz Profilboden − Gelände am DIP (m) oder null, wenn unbekannt.
 * @returns {number|null}
 */
export function getProfileHeightDelta() {
    const g = AppState.lastProfileGround;
    if (!g || !Number.isFinite(g.profileM) || !Number.isFinite(g.demM)) return null;
    return Math.round(g.profileM - g.demM);
}

/**
 * Baut das weatherData-Objekt des Profils für den aktuellen DIP und setzt die
 * zugehörigen AppState-Felder (Druckstufen, Datenquelle, Laufanzeige).
 * @returns {object} weatherData
 */
export function getCustomProfileWeatherData() {
    const prof = AppState.customProfile;
    if (!prof) throw new Error(I18n.t('custom_profile.none_loaded'));

    const dem = Number.isFinite(AppState.lastAltitude) ? AppState.lastAltitude : undefined;
    const result = buildCustomProfileWeatherData(prof.parsed, {
        timeUtc: prof.timeUtc,
        groundElevationM: prof.groundElevationM,
        anchorElevationM: dem,
        surfaceWind: prof.surfaceWind,
    });

    AppState.customPressureLevels = result.pressureLevels;
    AppState.lastDataSource = 'custom-profile';
    AppState.lastDataServer = null;
    AppState.lastOrography = null;
    AppState.lastModelRun = `${prof.timeUtc.replace('T', ' ')}Z`;
    AppState.lastProfileGround = { profileM: result.groundElevationM, demM: dem ?? null };

    const delta = getProfileHeightDelta();
    if (delta !== null && Math.abs(delta) >= PROFILE_HEIGHT_MISMATCH_WARN_M && _lastWarnedDem !== dem) {
        _lastWarnedDem = dem;
        Utils.handleMessage(I18n.t('custom_profile.height_mismatch_warning', {
            profile: Math.round(result.groundElevationM),
            dem: Math.round(dem),
            delta: `${delta >= 0 ? '+' : '−'}${Math.abs(delta)}`,
        }));
    }

    return result.weatherData;
}
