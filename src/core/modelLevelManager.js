/**
 * @file modelLevelManager.js
 * @description Verwaltet den Abruf und die Konvertierung von hochaufgelösten nativen
 * ICON-Modelllevel-Daten (D2/EU/GLOBAL) von Michaels privaten Open-Meteo-kompatiblen
 * Servern. Die Daten werden in das Open-Meteo-Pressure-Level-Format überführt, sodass
 * alle bestehenden Features (Zeitslider, Jump-Planner, Charts) unverändert mit den
 * hochaufgelösten Modelleveln arbeiten können.
 */

import { AppState } from './state.js';
import { Utils } from './utils.js';
import { API_URLS, CONVERSIONS } from './constants.js';

// ===================================================================
// Konstanten
// ===================================================================

const MODEL_LEVEL_SERVERS = {
    icon_d2:     'https://open-meteo.mah.priv.at',
    icon_eu:     'https://open-meteo.mah.priv.at',
    icon_global: 'https://open-meteo-temp.mah.priv.at',
};

const MODEL_LEVEL_NLEVELS = {
    icon_d2:     65,
    icon_eu:     74,
    icon_global: 120,
};

/** Modell-Keys, für die Modelllevel-Daten priorisiert versucht werden. */
export const MODEL_LEVEL_ELIGIBLE = Object.keys(MODEL_LEVEL_SERVERS);

// ===================================================================
// Öffentliche API
// ===================================================================

/**
 * Ruft native Modelllevel-Daten für den gegebenen ICON-Modell-Key ab und konvertiert
 * sie in ein Open-Meteo-Pressure-Level-kompatibles weatherData-Objekt.
 * Setzt AppState.customPressureLevels auf die abgeleiteten nativen Level.
 * Wirft bei jedem Fehler (Netzwerk, Bbox außerhalb, unvollständige Daten) einen Error —
 * der Aufrufer (weatherManager.fetchWeather) entscheidet dann über den Fallback auf
 * Pressure-Level-Daten.
 * @param {number} lat
 * @param {number} lon
 * @param {string} modelKey - 'icon_d2' | 'icon_eu' | 'icon_global'
 * @param {string} startDateStr - 'yyyy-MM-dd'
 * @param {string} endDateStr - 'yyyy-MM-dd'
 * @returns {Promise<object>}
 */
export async function fetchModelLevelData(lat, lon, modelKey, startDateStr, endDateStr) {
    try {
        const nLevels = MODEL_LEVEL_NLEVELS[modelKey];
        const serverBase = MODEL_LEVEL_SERVERS[modelKey];
        if (!nLevels || !serverBase) {
            throw new Error(`Modelllevel-Server nicht konfiguriert für '${modelKey}'`);
        }

        const levelParams = [];
        for (let l = 1; l <= nLevels; l++) {
            levelParams.push(
                `wind_u_component_level${l}`,
                `wind_v_component_level${l}`,
                `temperature_level${l}`,
                `height_agl_level${l}`,
                `relative_humidity_level${l}`,
                `pressure_level${l}`,
                `cloud_cover_level${l}`
            );
        }
        levelParams.push('pressure_msl');

        // wind_speed_unit=ms explizit erzwingen: die U/V-Komponenten der Modelllevel werden
        // unten mit einem festen m/s→km/h-Faktor umgerechnet, um mit dem Rest von weatherData
        // (km/h) konsistent zu sein.
        const url = `${serverBase}/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${levelParams.join(',')}&models=${modelKey}&start_date=${startDateStr}&end_date=${endDateStr}&wind_speed_unit=ms`;

        const [levelResponse, surfaceHourly] = await Promise.all([
            fetch(url, { signal: AbortSignal.timeout(30000) }),
            _fetchSurfaceData(lat, lon, modelKey, startDateStr, endDateStr),
        ]);

        if (!levelResponse.ok) {
            throw new Error(`Modelllevel-Server (${modelKey}): HTTP ${levelResponse.status}`);
        }
        const levelJson = await levelResponse.json();
        if (!levelJson.hourly?.time?.length) {
            throw new Error(`Modelllevel-Server (${modelKey}): leere Antwort`);
        }

        const weatherData = _convertToWeatherData(levelJson.hourly, levelJson.elevation, nLevels);
        _applySurfaceData(weatherData, surfaceHourly);

        console.log(`[modelLevelManager] Modelllevel-Daten für ${modelKey} geladen (${AppState.customPressureLevels.length} Level, ${weatherData.time.length} Zeitschritte).`);
        return weatherData;

    } catch (e) {
        // Customlevels zurücksetzen, damit der Fallback auf STANDARD_PRESSURE_LEVELS greift
        AppState.customPressureLevels = null;
        throw e;
    }
}

// ===================================================================
// Private Hilfsfunktionen – Oberflächendaten
// ===================================================================

/**
 * Ruft die Oberflächenfelder für denselben Zeitraum von der öffentlichen Open-Meteo-API ab,
 * mit demselben Modell-Key wie die Modelllevel-Daten (gleiche Grenzschichtparametrisierung).
 */
async function _fetchSurfaceData(lat, lon, modelKey, startDateStr, endDateStr) {
    const params = 'surface_pressure,temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,weather_code,cloud_cover_low,cloud_cover_mid,cloud_cover_high';
    const url = `${API_URLS.FORECAST}?latitude=${lat}&longitude=${lon}&hourly=${params}&models=${modelKey}&start_date=${startDateStr}&end_date=${endDateStr}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Oberflächendaten (${modelKey}): HTTP ${response.status}`);
    const json = await response.json();
    if (!json.hourly?.time?.length) throw new Error(`Oberflächendaten (${modelKey}): leere Antwort`);
    return json.hourly;
}

/**
 * Überschreibt die Oberflächenfelder in weatherData mit den Werten aus surfaceHourly.
 * Matched per ISO-Zeitstempel. Wirft, wenn nicht jeder Zeitschritt zugeordnet werden kann,
 * damit der Aufrufer komplett auf Pressure-Level zurückfällt statt mit Lücken weiterzuarbeiten.
 */
function _applySurfaceData(weatherData, surfaceHourly) {
    const timeIndex = new Map(surfaceHourly.time.map((t, i) => [t, i]));
    const n = weatherData.time.length;
    const fields = ['surface_pressure', 'temperature_2m', 'relative_humidity_2m', 'wind_speed_10m',
        'wind_direction_10m', 'wind_gusts_10m', 'visibility', 'weather_code',
        'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high'];

    for (const field of fields) weatherData[field] = new Array(n);

    for (let ti = 0; ti < n; ti++) {
        const oi = timeIndex.get(weatherData.time[ti]);
        if (oi === undefined) {
            throw new Error(`Oberflächendaten: kein Zeitstempel-Match für ${weatherData.time[ti]}`);
        }
        for (const field of fields) weatherData[field][ti] = surfaceHourly[field][oi];
    }
}

// ===================================================================
// Private Hilfsfunktionen – Datenkonvertierung
// ===================================================================

/**
 * Konvertiert die Modelllevel-'hourly'-Antwort (l = 1..nLevels je Variable) in ein
 * Open-Meteo-Pressure-Level-kompatibles weatherData-Objekt.
 *
 * Die Druckstufenkeys werden aus dem ersten Zeitschritt abgeleitet (Integer-Rundung,
 * nach Druck absteigend sortiert — unabhängig von der rohen Level-Nummerierung der API,
 * da deren Zählrichtung (Boden→Top oder Top→Boden) serverseitig variieren kann).
 * AppState.customPressureLevels wird gesetzt, damit interpolateWeatherData alle
 * nativen Level statt der 13 Standard-Druckstufen nutzt.
 *
 * @param {object} hourly - Das 'hourly'-Objekt der Modelllevel-API-Antwort
 * @param {number|undefined} elevationHint - Root-Feld 'elevation' der API-Antwort (Meter MSL)
 * @param {number} nLevels
 */
function _convertToWeatherData(hourly, elevationHint, nLevels) {
    const n = hourly.time.length;

    // Level-Reihenfolge aus dem ersten Zeitschritt ableiten (Druck absteigend = Höhe aufsteigend)
    const levelPressures = [];
    for (let l = 1; l <= nLevels; l++) {
        const p = hourly[`pressure_level${l}`]?.[0];
        if (p != null) levelPressures.push({ l, p });
    }
    if (levelPressures.length < 2) {
        throw new Error('Modelllevel: zu wenige gültige Level im ersten Zeitschritt');
    }
    levelPressures.sort((a, b) => b.p - a.p);

    const pressureKeys = [];
    const seen = new Set();
    for (const { p } of levelPressures) {
        let key = Math.round(p);
        while (seen.has(key)) key++;
        seen.add(key);
        pressureKeys.push(key);
    }
    AppState.customPressureLevels = pressureKeys;

    // Geländehöhe: bevorzugt aus dem Root-Feld 'elevation' der API-Antwort; Fallback:
    // hypsometrische Schätzung aus dem bodennächsten Level und pressure_msl des ersten Zeitschritts.
    let elevationM = elevationHint;
    if (!Number.isFinite(elevationM)) {
        const pmsl0 = hourly.pressure_msl?.[0];
        const pLowest0 = levelPressures[0].p;
        elevationM = (Number.isFinite(pmsl0) && pmsl0 > 0)
            ? 44330 * (1 - Math.pow(pLowest0 / pmsl0, 0.1903))
            : 0;
        console.warn('[modelLevelManager] Kein "elevation"-Feld in der API-Antwort, nutze hypsometrische Schätzung:', elevationM.toFixed(0), 'm');
    }

    const levelArrays = {};
    for (const key of pressureKeys) {
        levelArrays[`temperature_${key}hPa`]         = new Array(n);
        levelArrays[`relative_humidity_${key}hPa`]   = new Array(n);
        levelArrays[`wind_speed_${key}hPa`]          = new Array(n);
        levelArrays[`wind_direction_${key}hPa`]      = new Array(n);
        levelArrays[`geopotential_height_${key}hPa`] = new Array(n);
        levelArrays[`cloud_cover_${key}hPa`]         = new Array(n);
    }

    for (let ti = 0; ti < n; ti++) {
        for (let ki = 0; ki < levelPressures.length; ki++) {
            const l = levelPressures[ki].l;
            const key = pressureKeys[ki];

            const u = hourly[`wind_u_component_level${l}`]?.[ti];
            const v = hourly[`wind_v_component_level${l}`]?.[ti];
            const hAgl = hourly[`height_agl_level${l}`]?.[ti];

            levelArrays[`temperature_${key}hPa`][ti]         = hourly[`temperature_level${l}`]?.[ti] ?? null;
            levelArrays[`relative_humidity_${key}hPa`][ti]   = hourly[`relative_humidity_level${l}`]?.[ti] ?? null;
            levelArrays[`wind_speed_${key}hPa`][ti]          = (u != null && v != null) ? Utils.windSpeed(u, v) * CONVERSIONS.MPS_TO_KMH : null;
            levelArrays[`wind_direction_${key}hPa`][ti]      = (u != null && v != null) ? Utils.windDirection(u, v) : null;
            levelArrays[`geopotential_height_${key}hPa`][ti] = (hAgl != null) ? hAgl + elevationM : null;
            levelArrays[`cloud_cover_${key}hPa`][ti]         = hourly[`cloud_cover_level${l}`]?.[ti] ?? null;
        }
    }

    return {
        time: hourly.time,
        ...levelArrays
    };
}
