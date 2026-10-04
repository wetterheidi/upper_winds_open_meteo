/**
 * @file modelLevelManager.js
 * @description Verwaltet den Abruf und die Konvertierung von hochaufgelösten nativen
 * ICON-Modelllevel-Daten (D2/EU/GLOBAL) von privaten Open-Meteo-kompatiblen Servern
 * (primär open-meteo.wetterheidi.de, Michaels Server als Fallback, s. openMeteoServers.js).
 * Die Daten werden in das Open-Meteo-Pressure-Level-Format überführt, sodass alle
 * bestehenden Features (Zeitslider, Jump-Planner, Charts) unverändert mit den
 * hochaufgelösten Modelleveln arbeiten können.
 *
 * Höhensystematik (wie dronecast): die Modelllevel sind GELÄNDEFOLGEND. Höhe über
 * Grund = `height_agl_levelN` (Höhe über Modellgrund), bezogen auf die echte
 * DEM90-Geländehöhe am Punkt: geopotential_height = DEM + height_agl. Weicht die
 * Modell-Orographie stark vom Gelände ab, wird das NICHT in eine Verschiebung des
 * Profils übersetzt, sondern separat angezeigt (AppState.lastOrography, Modell-Info).
 * Die Oberflächenfelder werden mit `elevation=<DEM>` abgefragt, gelten also wie
 * bisher (öffentliche Instanz) für die DEM-Höhe -- insbesondere surface_pressure
 * für den QFE am DIP. Für das untere Ende der Säule nutzt die Interpolation dagegen
 * den Modell-Bodendruck (`surface_pressure_model`), der zum geländefolgenden Profil
 * passt.
 */

import { AppState } from './state.js';
import { Utils } from './utils.js';
import { CONVERSIONS } from './constants.js';
import {
    ICON_SERVERS, OM_PUBLIC, hostOf, fetchJsonFromServers, fetchDemElevation,
    isFreshRunMeta, hasValuesFromNow,
} from './openMeteoServers.js';

// ===================================================================
// Konstanten
// ===================================================================

const MODEL_LEVEL_NLEVELS = {
    icon_d2:     65,
    icon_eu:     74,
    icon_global: 120,
};

const SURFACE_FIELDS = ['surface_pressure', 'temperature_2m', 'relative_humidity_2m', 'wind_speed_10m',
    'wind_direction_10m', 'wind_gusts_10m', 'visibility', 'weather_code',
    'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high'];

/** Modell-Keys, für die Modelllevel-Daten priorisiert versucht werden. */
export const MODEL_LEVEL_ELIGIBLE = Object.keys(MODEL_LEVEL_NLEVELS);

// ===================================================================
// Öffentliche API
// ===================================================================

/**
 * Aktueller Modelllauf (meta.json) für ein ICON-Modell von den ICON-Servern
 * (bevorzugter zuerst). Ein Server mit veraltetem Lauf (> 24 h) gilt als gescheitert --
 * sonst legt weatherManager das Abfragefenster in die Vergangenheit.
 * @param {string} modelKey - 'icon_d2' | 'icon_eu' | 'icon_global'
 * @param {string} dataset - z. B. 'dwd_icon_d2'
 * @returns {Promise<{meta: object, server: string}>}
 */
export async function fetchIconRunMeta(modelKey, dataset) {
    const { data, server } = await fetchJsonFromServers(ICON_SERVERS[modelKey], `/data/${dataset}/static/meta.json`, {
        timeoutMs: 15000, validate: isFreshRunMeta,
    });
    return { meta: data, server };
}

/**
 * Ruft native Modelllevel-Daten für den gegebenen ICON-Modell-Key ab und konvertiert
 * sie in ein Open-Meteo-Pressure-Level-kompatibles weatherData-Objekt.
 * Setzt AppState.customPressureLevels auf die abgeleiteten nativen Level,
 * AppState.lastDataServer auf die tatsächlich liefernden Server und
 * AppState.lastOrography auf Modell- vs. DEM-Geländehöhe.
 * Die ICON-Server werden der Reihe nach probiert; ein Server gilt als gescheitert bei
 * Netzwerk-/HTTP-Fehler, leerer Antwort oder unbrauchbaren Daten (z. B. HTTP 200 mit
 * lauter null bei kaputter Ingestion).
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
        const servers = ICON_SERVERS[modelKey];
        if (!nLevels || !servers) {
            throw new Error(`Modelllevel-Server nicht konfiguriert für '${modelKey}'`);
        }

        // DEM90-Höhe zuerst: Bezug der geländefolgenden Level UND `elevation` der
        // Oberflächenabfrage (s. Kopfkommentar). Statisch und gecacht.
        const dem = await fetchDemElevation(lat, lon);

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
        levelParams.push('pressure_msl', 'surface_pressure_model');

        // wind_speed_unit=ms explizit erzwingen: die U/V-Komponenten der Modelllevel werden
        // unten mit einem festen m/s→km/h-Faktor umgerechnet, um mit dem Rest von weatherData
        // (km/h) konsistent zu sein. cell_selection=nearest wie in dronecast: dieselbe
        // Gitterzelle für Level- und Oberflächenabfrage, unabhängig von der Höhe.
        const query = `/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${levelParams.join(',')}&models=${modelKey}&start_date=${startDateStr}&end_date=${endDateStr}&wind_speed_unit=ms&cell_selection=nearest`;

        // Oberflächendaten parallel zu den Level-Versuchen holen.
        const surfacePromise = _fetchSurfaceData(lat, lon, modelKey, startDateStr, endDateStr, dem);
        surfacePromise.catch(() => {}); // Fehler wird unten beim await geworfen

        let lastError = null;
        for (const serverBase of servers) {
            const isFallback = serverBase !== servers[0];
            const host = hostOf(serverBase);
            let weatherData, levelJson;
            try {
                const levelResponse = await fetch(`${serverBase}${query}`, { signal: AbortSignal.timeout(30000) });
                if (!levelResponse.ok) {
                    throw new Error(`Modelllevel-Server ${host} (${modelKey}): HTTP ${levelResponse.status}`);
                }
                levelJson = await levelResponse.json();
                if (!levelJson.hourly?.time?.length) {
                    throw new Error(`Modelllevel-Server ${host} (${modelKey}): leere Antwort`);
                }
                if (!_hasWindData(levelJson.hourly, nLevels)) {
                    throw new Error(`Modelllevel-Server ${host} (${modelKey}): keine Winddaten ab jetzt (nur null)`);
                }
                // Ohne DEM (alle Höhen-Server ausgefallen): auf die Modell-Geländehöhe
                // beziehen -- dann entspricht "über Grund" "über Modellgrund".
                const baseElevation = Number.isFinite(dem) ? dem : levelJson.elevation;
                weatherData = _convertToWeatherData(levelJson.hourly, baseElevation, nLevels);
            } catch (e) {
                console.warn(`[modelLevelManager] ${host} nicht nutzbar, versuche nächsten Server:`, e.message);
                lastError = e;
                continue;
            }

            const surface = await surfacePromise;
            _applySurfaceData(weatherData, surface.hourly);
            weatherData.surface_pressure_model = levelJson.hourly.surface_pressure_model
                ?? new Array(weatherData.time.length).fill(null);

            AppState.lastDataServer = {
                host, fallback: isFallback,
                surfaceHost: hostOf(surface.server), surfaceFallback: surface.server !== servers[0],
            };
            AppState.lastOrography = {
                modelM: Number.isFinite(levelJson.elevation) ? levelJson.elevation : null,
                demM: Number.isFinite(dem) ? dem : null,
            };
            console.log(`[modelLevelManager] Modelllevel-Daten für ${modelKey} von ${host}${isFallback ? ' (Fallback)' : ''}, Oberfläche von ${hostOf(surface.server)} geladen (${AppState.customPressureLevels.length} Level, ${weatherData.time.length} Zeitschritte, DEM ${dem ?? '–'} m, Modell ${levelJson.elevation} m).`);
            return weatherData;
        }
        throw lastError ?? new Error(`Kein Modelllevel-Server für '${modelKey}' erreichbar`);

    } catch (e) {
        // Customlevels zurücksetzen, damit der Fallback auf STANDARD_PRESSURE_LEVELS greift
        AppState.customPressureLevels = null;
        AppState.lastOrography = null;
        throw e;
    }
}

// ===================================================================
// Private Hilfsfunktionen – Oberflächendaten
// ===================================================================

/** true, wenn am bodennächsten Level ab der aktuellen Stunde mindestens ein echter Windwert vorliegt. */
function _hasWindData(hourly, nLevels) {
    return hasValuesFromNow(hourly, `wind_u_component_level${nLevels}`);
}

/**
 * Ruft die Oberflächenfelder für denselben Zeitraum ab, mit demselben Modell-Key wie
 * die Modelllevel-Daten (gleiche Grenzschichtparametrisierung). Server-Kette: ICON-
 * Server (bevorzugter zuerst), zuletzt die öffentliche Instanz. `elevation=<DEM>`
 * sorgt dafür, dass T2m/Bodendruck wie bisher für die echte Geländehöhe gelten (die
 * ICON-Server würden sonst auf die Modellhöhe rechnen). Felder, die auf dem liefernden
 * Server durchgehend null sind, werden gezielt von der öffentlichen Instanz ergänzt.
 * @returns {Promise<{hourly: object, server: string}>}
 */
async function _fetchSurfaceData(lat, lon, modelKey, startDateStr, endDateStr, dem) {
    const build = (fields) => `/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${fields.join(',')}&models=${modelKey}&start_date=${startDateStr}&end_date=${endDateStr}&cell_selection=nearest`
        + (Number.isFinite(dem) ? `&elevation=${dem}` : '');
    const servers = [...ICON_SERVERS[modelKey], OM_PUBLIC];
    const { data, server } = await fetchJsonFromServers(servers, build(SURFACE_FIELDS), {
        timeoutMs: 15000,
        validate: (d) => hasValuesFromNow(d.hourly, 'temperature_2m'),
    });
    const hourly = data.hourly;

    const empty = SURFACE_FIELDS.filter((f) => !(hourly[f] || []).some((v) => v != null));
    if (empty.length && server !== OM_PUBLIC) {
        try {
            const { data: extra } = await fetchJsonFromServers([OM_PUBLIC], build(empty), { timeoutMs: 15000 });
            const idx = new Map(extra.hourly.time.map((t, i) => [t, i]));
            for (const f of empty) {
                if (!(extra.hourly[f] || []).some((v) => v != null)) continue;
                hourly[f] = hourly.time.map((t) => (idx.has(t) ? extra.hourly[f][idx.get(t)] : null));
            }
        } catch { /* Ergänzung ist optional -- Felder bleiben dann leer */ }
    }
    return { hourly, server };
}

/**
 * Überschreibt die Oberflächenfelder in weatherData mit den Werten aus surfaceHourly.
 * Matched per ISO-Zeitstempel. Wirft, wenn nicht jeder Zeitschritt zugeordnet werden kann,
 * damit der Aufrufer komplett auf Pressure-Level zurückfällt statt mit Lücken weiterzuarbeiten.
 */
function _applySurfaceData(weatherData, surfaceHourly) {
    const timeIndex = new Map(surfaceHourly.time.map((t, i) => [t, i]));
    const n = weatherData.time.length;

    for (const field of SURFACE_FIELDS) weatherData[field] = new Array(n);

    for (let ti = 0; ti < n; ti++) {
        const oi = timeIndex.get(weatherData.time[ti]);
        if (oi === undefined) {
            throw new Error(`Oberflächendaten: kein Zeitstempel-Match für ${weatherData.time[ti]}`);
        }
        for (const field of SURFACE_FIELDS) weatherData[field][ti] = surfaceHourly[field]?.[oi] ?? null;
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
 * @param {number|undefined} elevationHint - Bezugshöhe der geländefolgenden Level (Meter MSL):
 *   DEM90-Höhe am Punkt, ersatzweise die Modell-Geländehöhe (Root-Feld 'elevation')
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

    // Bezugshöhe (s. fetchModelLevelData: DEM90, ersatzweise Modellhöhe); Fallback:
    // hypsometrische Schätzung aus dem bodennächsten Level und pressure_msl des ersten Zeitschritts.
    // geopotential_height = Bezugshöhe + height_agl -> "über Grund" = über Modellgrund
    // (geländefolgend, wie dronecast).
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
