/**
 * @file soundingManager.js
 * @description Verwaltet den Abruf und die Konvertierung von hochaufgelösten
 * ICON-D2/EU/GLOBAL Progtemp-Daten aus dem wetterheidi/sounding_data GitHub-Repository.
 * Die Daten werden in das Open-Meteo-kompatible weatherData-Format überführt,
 * sodass alle bestehenden Features (Zeitslider, Jump-Planner, Charts) unverändert
 * mit den hochaufgelösten Modelleveln des DWD arbeiten können.
 * Modellpriorität: ICON-D2 > ICON-EU > ICON-GLOBAL.
 */

import { AppState } from './state.js';

// ===================================================================
// Konstanten
// ===================================================================

/** Model-ID, die im Dropdown erscheint und intern zur Erkennung genutzt wird. */
export const SOUNDING_MODEL_ID = 'dwd_icon_d2_sounding';

const SERVER_BASE_URL = 'https://tlogpviewer.wetterheidi.de/data';
const INDEX_URL = `${SERVER_BASE_URL}/index.json`;
const RAW_BASE_URL = SERVER_BASE_URL;
const OPENMETEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const MAX_DISTANCE_KM = 20;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 Stunde

// Modellpriorität: Index 0 = höchste Auflösung / Präferenz
const MODEL_PRIORITY = ['ICON-D2', 'ICON-EU', 'ICON-GLOBAL'];

// Mapping Sounding-Modellname → OpenMeteo model-ID für den Oberflächendaten-Request
const OPENMETEO_MODEL_MAP = {
    'ICON-D2':     'icon_d2',
    'ICON-EU':     'icon_eu',
    'ICON-GLOBAL': 'icon_global',
};

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

        const bestFile = _selectBestFile(files, locationKey, targetTime);
        if (!bestFile) throw new Error('Keine aktuelle Progtemp-Datei verfügbar');

        const url = `${RAW_BASE_URL}/${bestFile.name}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`HTTP ${response.status} beim Abrufen von ${bestFile.name}`);

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

        console.log(`[soundingManager] Verwende ${bestFile.model} Sounding (${bestFile.name})`);

        // Sounding-Daten konvertieren und parallel OpenMeteo-Oberflächendaten laden
        const [weatherData, surfaceData] = await Promise.all([
            Promise.resolve(_convertToWeatherData(soundingFile, terrainElevM)),
            _fetchOpenMeteoSurface(lat, lng, soundingFile, bestFile.model),
        ]);

        // OpenMeteo-Oberflächendiagnostik überschreibt Sounding-Bodenlevel:
        // OpenMeteo ICON-D2 hat Grenzschichtparametrisierung (2m-Diagnose, Böenparametrisierung),
        // das Sounding-Bodenlevel (~10–30 m AGL) kennt diese Korrekturen nicht.
        if (surfaceData?.data) {
            _applySurfaceData(weatherData, surfaceData.data, soundingFile.map(s => s.valid_time), surfaceData.model);
        }

        return weatherData;

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
    const response = await fetch(INDEX_URL, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Server index.json: HTTP ${response.status}`);
    const names = await response.json(); // Array von Dateinamen (Strings)
    _fileListCache = names
        .filter(n => n.startsWith('sounding_ICON-') && n.endsWith('.json'))
        .map(n => ({ name: n })); // { name } damit der Rest des Codes unverändert bleibt
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
 * Wählt die beste Sounding-Datei für locationKey und targetTime.
 * Priorität: ICON-D2 > ICON-EU > ICON-GLOBAL; bei gleichem Modell neuester Run zuerst.
 * Gibt { name, model } zurück oder null wenn keine Datei gefunden.
 */
function _selectBestFile(files, locationKey, targetTime) {
    const relevant = files
        .filter(f => f.name.includes(locationKey))
        .map(f => {
            const m = f.name.match(/sounding_(ICON-[\w]+)_(\d{8})_(\d{2})Z_/);
            if (!m) return null;
            const model = m[1]; // z.B. 'ICON-D2', 'ICON-EU', 'ICON-GLOBAL'
            const y = m[2].slice(0, 4), mo = m[2].slice(4, 6), d = m[2].slice(6, 8);
            const runTime = new Date(`${y}-${mo}-${d}T${m[3].padStart(2, '0')}:00:00Z`);
            const priority = MODEL_PRIORITY.indexOf(model); // -1 für unbekannte Modelle → niedrigste Prio
            return { name: f.name, model, runTime, priority: priority === -1 ? 999 : priority };
        })
        .filter(Boolean)
        .sort((a, b) => a.priority - b.priority || b.runTime - a.runTime); // Prio aufsteigend, dann neuester Run

    if (!relevant.length) return null;
    if (!targetTime) return relevant[0];

    const target = new Date(targetTime);

    // Erst bestes Modell suchen, das den Zielzeitpunkt abdeckt
    for (const r of relevant) {
        // Jede Datei deckt step_h 0–24 ab → Zeitfenster [runTime, runTime + 24h]
        const runEnd = new Date(r.runTime.getTime() + 24 * 3600 * 1000);
        if (r.runTime <= target && target <= runEnd) return r;
    }
    return relevant[0]; // Fallback: höchste Priorität, neuester Run
}

// ===================================================================
// Private Hilfsfunktionen – OpenMeteo-Oberflächendaten
// ===================================================================

/**
 * Ruft die 5 Oberflächendiagnostiken für den Sounding-Zeitraum von OpenMeteo ab.
 * Das Modell (icon_d2 / icon_eu / icon_global) wird aus dem Sounding-Modellnamen abgeleitet.
 * Gibt null zurück wenn der Request fehlschlägt, damit der Fallback (Sounding-Bodenlevel) greift.
 */
async function _fetchOpenMeteoSurface(lat, lng, soundingFile, soundingModel) {
    try {
        const omModel = OPENMETEO_MODEL_MAP[soundingModel] ?? 'icon_d2';
        const times = soundingFile.map(s => s.valid_time);
        const startDate = times[0].slice(0, 10);
        const endDate   = times[times.length - 1].slice(0, 10);
        const params = 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m';
        const url = `${OPENMETEO_FORECAST_URL}?latitude=${lat}&longitude=${lng}&hourly=${params}&models=${omModel}&start_date=${startDate}&end_date=${endDate}&wind_speed_unit=kmh`;

        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = await response.json();
        return { data: json.hourly ?? null, model: omModel };
    } catch (e) {
        console.warn(`[soundingManager] OpenMeteo-Oberflächendaten (${soundingModel}) nicht verfügbar, Fallback auf Sounding-Bodenlevel:`, e.message);
        return null;
    }
}

/**
 * Überschreibt die 5 Oberflächenfelder in weatherData mit den OpenMeteo-Werten.
 * Matched per ISO-Zeitstempel; fehlt ein Zeitstempel in OpenMeteo bleibt der Sounding-Wert erhalten.
 */
function _applySurfaceData(weatherData, surfaceData, soundingTimes, omModel) {
    // OpenMeteo liefert hourly.time als ISO-Array
    const omTimeIndex = new Map(surfaceData.time.map((t, i) => [t, i]));

    for (let ti = 0; ti < soundingTimes.length; ti++) {
        // Sounding-Zeitstempel können Sekunden enthalten (:00), OpenMeteo endet auf :00 — normalize
        const key = soundingTimes[ti].slice(0, 16); // "YYYY-MM-DDTHH:MM"
        const oi  = omTimeIndex.get(key) ?? omTimeIndex.get(soundingTimes[ti]);
        if (oi === undefined) continue;

        if (surfaceData.temperature_2m[oi]      != null) weatherData.temperature_2m[ti]       = surfaceData.temperature_2m[oi];
        if (surfaceData.relative_humidity_2m[oi] != null) weatherData.relative_humidity_2m[ti] = surfaceData.relative_humidity_2m[oi];
        if (surfaceData.wind_speed_10m[oi]       != null) weatherData.wind_speed_10m[ti]        = surfaceData.wind_speed_10m[oi];
        if (surfaceData.wind_direction_10m[oi]   != null) weatherData.wind_direction_10m[ti]    = surfaceData.wind_direction_10m[oi];
        if (surfaceData.wind_gusts_10m[oi]       != null) weatherData.wind_gusts_10m[ti]        = surfaceData.wind_gusts_10m[oi];
    }
    console.log(`[soundingManager] Oberflächendaten (T2m, RH2m, Wind10m, Böen) aus OpenMeteo ${omModel} übernommen.`);
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
        wind_speed_10m[ti]       = sfc.wspd_kn * 1.852; // kn → km/h; wird durch OpenMeteo überschrieben
        wind_direction_10m[ti]   = sfc.wdir_deg;        // wird durch OpenMeteo überschrieben
        wind_gusts_10m[ti]       = sfc.wspd_kn * 1.852 * 1.3; // Fallback-Näherung; wird durch OpenMeteo überschrieben

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
