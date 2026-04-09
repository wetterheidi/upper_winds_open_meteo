/**
 * @file soundingManager.js
 * @description Verwaltet den Abruf und die Konvertierung von hochaufgelösten
 * ICON-D2 Progtemp-Daten aus dem wetterheidi/sounding_data GitHub-Repository.
 * Die Daten werden in das Open-Meteo-kompatible weatherData-Format überführt,
 * sodass alle bestehenden Features (Zeitslider, Jump-Planner, Charts) unverändert
 * mit den 65 Modelleveln des DWD ICON-D2 arbeiten können.
 */

import { AppState } from './state.js';

// ===================================================================
// Konstanten
// ===================================================================

/** Model-ID, die im Dropdown erscheint und intern zur Erkennung genutzt wird. */
export const SOUNDING_MODEL_ID = 'dwd_icon_d2_sounding';

const GITHUB_API_URL = 'https://api.github.com/repos/wetterheidi/sounding_data/contents/data';
const RAW_BASE_URL = 'https://raw.githubusercontent.com/wetterheidi/sounding_data/main/data';
const MAX_DISTANCE_KM = 20;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 Stunde

// Interner Cache für die GitHub-Dateiliste
let _fileListCache = null;
let _fileListCacheTime = 0;

// ===================================================================
// Öffentliche API
// ===================================================================

/**
 * Prüft, ob für die gegebenen Koordinaten ein Progtemp-Standort innerhalb von
 * MAX_DISTANCE_KM verfügbar ist.
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<boolean>}
 */
export async function checkSoundingAvailability(lat, lng) {
    try {
        const files = await _fetchFileList();
        const locations = _extractLocations(files);
        return _findNearestLocation(lat, lng, locations) !== null;
    } catch (e) {
        console.warn('[soundingManager] Verfügbarkeitsprüfung fehlgeschlagen:', e.message);
        return false;
    }
}

/**
 * Ruft die beste verfügbare Sounding-Datei für den Standort ab und konvertiert
 * sie in ein Open-Meteo-kompatibles weatherData-Objekt.
 * Setzt AppState.customPressureLevels auf die 65 Sounding-Level.
 * @param {number} lat
 * @param {number} lng
 * @param {string|null} targetTime - ISO-Zeitstempel (für Modellauswahl)
 * @returns {Promise<object|null>}
 */
export async function fetchSoundingData(lat, lng, targetTime) {
    try {
        const files = await _fetchFileList();
        const locations = _extractLocations(files);
        const locationKey = _findNearestLocation(lat, lng, locations);
        if (!locationKey) throw new Error('Kein Progtemp-Standort im 20-km-Umkreis');

        const bestFileName = _selectBestFile(files, locationKey, targetTime);
        if (!bestFileName) throw new Error('Keine aktuelle Progtemp-Datei verfügbar');

        const url = `${RAW_BASE_URL}/${bestFileName}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`HTTP ${response.status} beim Abrufen von ${bestFileName}`);

        const soundingFile = await response.json();
        if (!Array.isArray(soundingFile) || soundingFile.length === 0) {
            throw new Error('Ungültiges Sounding-Format');
        }

        // Modell-Run-Zeitstempel für die UI setzen
        const meta = soundingFile[0];
        AppState.lastModelRun = `${meta.run_date.slice(0,4)}-${meta.run_date.slice(4,6)}-${meta.run_date.slice(6,8)} ${meta.run_hour}Z`;

        // Geländehöhe aus Oberflächendruck des ersten Zeitschritts schätzen (hypsometrische Formel).
        // Wird IMMER in AppState.lastAltitude geschrieben, damit baseHeight in interpolateWeatherData
        // exakt mit den gespeicherten geopotential_height-Werten (z_m + terrainElevM) übereinstimmt.
        const terrainElevM = Math.round(44330 * (1 - Math.pow(meta.surface_p_hPa / 1013.25, 0.1903)));
        AppState.lastAltitude = terrainElevM;
        console.log(`[soundingManager] Geländehöhe aus Oberflächendruck: ${terrainElevM}m MSL`);

        return _convertToWeatherData(soundingFile, terrainElevM);

    } catch (e) {
        console.error('[soundingManager] Fehler beim Laden des Progtempss:', e.message);
        // Customlevels zurücksetzen, damit der Fallback auf STANDARD_PRESSURE_LEVELS greift
        AppState.customPressureLevels = null;
        throw e; // wird von fetchWeather abgefangen
    }
}

// ===================================================================
// Private Hilfsfunktionen – Dateiliste & Standort-Matching
// ===================================================================

async function _fetchFileList() {
    const now = Date.now();
    if (_fileListCache && (now - _fileListCacheTime) < CACHE_TTL_MS) {
        return _fileListCache;
    }
    const response = await fetch(GITHUB_API_URL, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`GitHub API: HTTP ${response.status}`);
    const all = await response.json();
    _fileListCache = all.filter(f => f.name.startsWith('sounding_ICON-D2_') && f.name.endsWith('.json'));
    _fileListCacheTime = now;
    return _fileListCache;
}

function _extractLocations(files) {
    const seen = new Set();
    for (const f of files) {
        const m = f.name.match(/_(\d+\.\d+N_\d+\.\d+E)\.json$/);
        if (m) seen.add(m[1]);
    }
    return Array.from(seen);
}

function _haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _findNearestLocation(lat, lng, locations) {
    let bestKey = null;
    let bestDist = Infinity;
    for (const loc of locations) {
        const m = loc.match(/^(\d+\.\d+)N_(\d+\.\d+)E$/);
        if (!m) continue;
        const dist = _haversineKm(lat, lng, parseFloat(m[1]), parseFloat(m[2]));
        if (dist < bestDist) { bestDist = dist; bestKey = loc; }
    }
    return bestDist <= MAX_DISTANCE_KM ? bestKey : null;
}

/**
 * Wählt die beste (neueste) Sounding-Datei, deren Vorhersagezeitraum den
 * gewünschten Zeitpunkt abdeckt.
 */
function _selectBestFile(files, locationKey, targetTime) {
    const relevant = files
        .filter(f => f.name.includes(locationKey))
        .map(f => {
            const m = f.name.match(/sounding_ICON-D2_(\d{8})_(\d{2})Z_/);
            if (!m) return null;
            const y = m[1].slice(0, 4), mo = m[1].slice(4, 6), d = m[1].slice(6, 8);
            const runTime = new Date(`${y}-${mo}-${d}T${m[2].padStart(2, '0')}:00:00Z`);
            return { name: f.name, runTime };
        })
        .filter(Boolean)
        .sort((a, b) => b.runTime - a.runTime); // neuester Run zuerst

    if (!relevant.length) return null;
    if (!targetTime) return relevant[0].name;

    const target = new Date(targetTime);
    for (const r of relevant) {
        // Jede Datei deckt step_h 0–24 ab → Zeitfenster [runTime, runTime + 24h]
        const runEnd = new Date(r.runTime.getTime() + 24 * 3600 * 1000);
        if (r.runTime <= target && target <= runEnd) return r.name;
    }
    return relevant[0].name; // Fallback: neueste verfügbare Datei
}

// ===================================================================
// Private Hilfsfunktionen – Datenkonvertierung
// ===================================================================

/**
 * Berechnet die relative Feuchte aus Temperatur und Taupunkt (Magnus-Formel).
 */
function _rhFromTd(T_C, Td_C) {
    const es = (t) => 6.112 * Math.exp(17.67 * t / (t + 243.5));
    return Math.min(100, Math.max(0, Math.round(100 * es(Td_C) / es(T_C))));
}

/**
 * Schätzt die Bedeckung (%) aus dem Taupunktdefizit.
 * T - Td < 2°C → gesättigt (100%), > 15°C → trocken (0%).
 */
function _cloudCoverFromTd(T_C, Td_C) {
    const spread = T_C - Td_C;
    if (spread <= 2) return 100;
    if (spread >= 15) return 0;
    return Math.round(100 * (15 - spread) / 13);
}

/**
 * Findet das Level mit der nächstgelegenen Druckfläche zu targetP_hPa.
 */
function _closestLevel(levels, targetP_hPa) {
    let best = levels[0], bestDiff = Math.abs(levels[0].p_hPa - targetP_hPa);
    for (const l of levels) {
        const diff = Math.abs(l.p_hPa - targetP_hPa);
        if (diff < bestDiff) { bestDiff = diff; best = l; }
    }
    return best;
}

/**
 * Konvertiert ein Sounding-JSON-Array (25 Zeitschritte × 65 Level) in ein
 * Open-Meteo-kompatibles weatherData-Objekt.
 *
 * Druckstufenkeys werden aus dem ersten Zeitschritt abgeleitet (Integer-Rundung).
 * AppState.customPressureLevels wird gesetzt, damit interpolateWeatherData alle
 * 65 Level anstelle der 13 Standard-Druckstufen nutzt.
 *
 * @param {Array} soundingFile - Die geparste Sounding-JSON-Datei
 * @param {number} terrainElevM - Geschätzte Geländehöhe in Metern MSL (aus surface_p_hPa)
 */
function _convertToWeatherData(soundingFile, terrainElevM = 0) {
    const n = soundingFile.length;

    // --- Kanonische Drucklevel aus Zeitschritt 0 ableiten ---
    // levels sind absteigend nach level_idx sortiert (höchster Druck / niedrigste Höhe zuerst)
    const refLevels = soundingFile[0].levels;
    const refPressures = refLevels.map(l => l.p_hPa); // Referenzdrücke für alle Zeitschritte

    // Integer-Rundung + Deduplikation (falls zwei Level auf denselben Wert runden)
    const pressureKeys = [];
    const seen = new Set();
    for (const p of refPressures) {
        let key = Math.round(p);
        // Bei Kollision: nächsten freien Integer suchen
        while (seen.has(key)) key++;
        seen.add(key);
        pressureKeys.push(key);
    }

    // AppState informieren: interpolateWeatherData soll diese Level verwenden
    AppState.customPressureLevels = pressureKeys; // absteigend nach Druck = aufsteigend nach Höhe entspricht dem Sounding-Sort

    // --- Daten-Arrays initialisieren ---
    const time                = new Array(n);
    const surface_pressure    = new Array(n);
    const temperature_2m      = new Array(n);
    const relative_humidity_2m = new Array(n);
    const wind_speed_10m      = new Array(n);
    const wind_direction_10m  = new Array(n);
    const wind_gusts_10m      = new Array(n);
    const visibility          = new Array(n).fill(10000);
    const weather_code        = new Array(n).fill(0);
    const cloud_cover_low     = new Array(n).fill(0);
    const cloud_cover_mid     = new Array(n).fill(0);
    const cloud_cover_high    = new Array(n).fill(0);

    // Pro Drucklevel ein Array für jeden Zeitschritt
    const levelArrays = {};
    for (const key of pressureKeys) {
        levelArrays[`temperature_${key}hPa`]         = new Array(n);
        levelArrays[`relative_humidity_${key}hPa`]   = new Array(n);
        levelArrays[`wind_speed_${key}hPa`]          = new Array(n);
        levelArrays[`wind_direction_${key}hPa`]      = new Array(n);
        levelArrays[`geopotential_height_${key}hPa`] = new Array(n);
        levelArrays[`cloud_cover_${key}hPa`]         = new Array(n);
    }


    // --- Zeitschritte befüllen ---
    for (let ti = 0; ti < n; ti++) {
        const step   = soundingFile[ti];
        const levels = step.levels;

        time[ti]             = step.valid_time;
        // surface_pressure wird auf pressureKeys[0] (≈ Bodenlevel-Druck) gedeckelt.
        // Wenn step.surface_p_hPa durch Float-Ungenauigkeit minimal > pressureKeys[0] wäre,
        // würde interpolateWeatherData einen Surface-Extrapolationsblock auslösen, der das
        // Höhenarray nicht-monoton macht und alle Windwerte auf Bodenniveau zieht.
        surface_pressure[ti] = Math.min(step.surface_p_hPa, pressureKeys[0]);

        // Bodenwerte: niedrigstes Level (~10 m AGL)
        const sfc = levels[0];
        temperature_2m[ti]       = sfc.T_C;
        relative_humidity_2m[ti] = _rhFromTd(sfc.T_C, sfc.Td_C);
        wind_speed_10m[ti]       = sfc.wspd_kn * 1.852; // kn → km/h
        wind_direction_10m[ti]   = sfc.wdir_deg;
        wind_gusts_10m[ti]       = sfc.wspd_kn * 1.852 * 1.3; // Näherung

        // Grobe Wolkenbedeckung nach Stockwerken (für Meteogramm)
        let ccLow = 0, ccMid = 0, ccHigh = 0;

        // Pro Drucklevel: Level mit dem zum Referenzdruck nächstgelegenen Druck suchen
        for (let ki = 0; ki < pressureKeys.length; ki++) {
            const key  = pressureKeys[ki];
            const refP = refPressures[ki];
            const lev  = _closestLevel(levels, refP);

            const wspd_kmh = lev.wspd_kn * 1.852;
            const rh       = _rhFromTd(lev.T_C, lev.Td_C);
            const cc       = _cloudCoverFromTd(lev.T_C, lev.Td_C);

            levelArrays[`temperature_${key}hPa`][ti]         = lev.T_C;
            levelArrays[`relative_humidity_${key}hPa`][ti]   = rh;
            levelArrays[`wind_speed_${key}hPa`][ti]          = wspd_kmh;
            levelArrays[`wind_direction_${key}hPa`][ti]      = lev.wdir_deg;
            // z_m ist AGL (über Grund) → + terrainElevM ergibt MSL-Höhe wie Open-Meteo erwartet
            levelArrays[`geopotential_height_${key}hPa`][ti] = lev.z_m + terrainElevM;
            levelArrays[`cloud_cover_${key}hPa`][ti]         = cc;

            // Stockwerk-Zuordnung nach Höhe für cloud_cover_low/mid/high
            if (lev.z_m < 2000)       { ccLow  = Math.max(ccLow,  cc); }
            else if (lev.z_m < 6000)  { ccMid  = Math.max(ccMid,  cc); }
            else                       { ccHigh = Math.max(ccHigh, cc); }
        }

        cloud_cover_low[ti]  = ccLow;
        cloud_cover_mid[ti]  = ccMid;
        cloud_cover_high[ti] = ccHigh;

    }

    return {
        time,
        surface_pressure,
        temperature_2m,
        relative_humidity_2m,
        wind_speed_10m,
        wind_direction_10m,
        wind_gusts_10m,
        visibility,
        weather_code,
        cloud_cover_low,
        cloud_cover_mid,
        cloud_cover_high,
        ...levelArrays
    };
}
