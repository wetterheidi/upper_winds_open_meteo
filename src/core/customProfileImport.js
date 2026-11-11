/**
 * @file customProfileImport.js
 * @description Import eigener Vertikalprofile ("Eigenes Profil") aus Textdateien:
 * Radiosonden (z. B. Windsond, Grawsonde) oder Modell-TEMPs aus NinJo. Das Profil ersetzt die
 * Modelldaten vollständig (keine Vermischung, auch die Bodenwerte stammen aus dem Profil).
 *
 * Ablauf: Bytes dekodieren -> Format erkennen -> Zeilen anhand einer Spaltenzuordnung
 * parsen -> Profil säubern -> weatherData-Objekt mit genau einem Zeitschritt bauen.
 *
 * Die Formate sind als reine Daten-Vorlagen (PROFILE_PRESETS) beschrieben. Eine spätere
 * benutzerdefinierte Spaltenzuordnung übergibt einfach ein eigenes Objekt derselben Form
 * an parseProfileText().
 *
 * Das Modul ist bewusst frei von AppState/DOM: Die Integration (AppState.customPressureLevels,
 * Bezugshöhe, UI) übernimmt der Aufrufer.
 */

import { CONVERSIONS } from './constants.js';

/** Model-ID für das Modell-Dropdown / AppState, analog zu SOUNDING_MODEL_ID. */
export const CUSTOM_PROFILE_MODEL_ID = 'custom_profile';

/** Max. Abstand (m) des ersten Messpunkts mit gültigem Wind vom Boden, um als Bodenwind zu gelten. */
export const SURFACE_WIND_MAX_GAP_M = 50;

/** Ab dieser relativen Feuchte (%) gilt ein Level als bewölkt (Sonden liefern keinen Bedeckungsgrad). */
export const CLOUD_RH_THRESHOLD = 95;

/**
 * Format-Vorlagen. Spaltennummern 1-basiert (wie in der Desktop-Vorlage), null = nicht vorhanden.
 * delimiter: 'auto' | 'tab' | 'whitespace' | 'semicolon' | 'comma' ('auto': Tab, wenn die Datei
 *            Tabs enthält, sonst Leerraum)
 * decimal:   'auto' | 'point' | 'comma'
 * units.height: 'm' | 'ft'; units.heightRef: 'AMSL' | 'AGL'; units.windSpeed: 'kn' | 'm/s' | 'km/h'
 */
export const PROFILE_PRESETS = Object.freeze({
    ninjo: Object.freeze({
        id: 'ninjo',
        label: 'Modelldaten (NinJo)',
        headerLines: 0,
        delimiter: 'tab',
        decimal: 'auto',
        columns: { pressure: 1, height: 3, temperature: 5, dewpoint: 6, humidity: null, windDirection: 10, windSpeed: 11 },
        units: { height: 'm', heightRef: 'AMSL', windSpeed: 'kn' },
    }),
    windsond: Object.freeze({
        id: 'windsond',
        label: 'Windsond',
        headerLines: 1,
        delimiter: 'whitespace',
        decimal: 'point',
        columns: { pressure: 2, height: 1, temperature: 3, dewpoint: 4, humidity: null, windDirection: 5, windSpeed: 6 },
        units: { height: 'm', heightRef: 'AGL', windSpeed: 'm/s' },
    }),
    // GRAWMET-Export (z. B. Graw513): "Zeit [sec] P [hPa] T Hu Ws [m/s] Wd Alt [m] Geopot [m] Rs".
    // Alt ist Höhe über Meer; die ersten Zeilen sind oft unbrauchbar (Boden mit 0 m, dann ein
    // Sprung) und werden über Druck/Temperatur repariert. Kein Taupunkt -> Feuchte aus Spalte 4.
    graw: Object.freeze({
        id: 'graw',
        label: 'Grawsonde (m/s)',
        headerLines: 0,
        delimiter: 'auto',
        decimal: 'auto',
        columns: { pressure: 2, height: 7, temperature: 3, dewpoint: null, humidity: 4, windDirection: 6, windSpeed: 5 },
        units: { height: 'm', heightRef: 'AMSL', windSpeed: 'm/s' },
        repairLeadingHeights: true,
        fillMissingPressure: true,
    }),
    // Älterer GRAW-Export (z. B. Graw509): "Zeit [sec] P [h Pa] T U Wsp [kn] Wdir Geo Pot [m']".
    // Höhe über Grund, Wind in Knoten; Druck fehlt teils ("-----") und wird aus Höhe/T ergänzt.
    graw_kn: Object.freeze({
        id: 'graw_kn',
        label: 'Grawsonde (kn)',
        headerLines: 0,
        delimiter: 'auto',
        decimal: 'auto',
        columns: { pressure: 2, height: 7, temperature: 3, dewpoint: null, humidity: 4, windDirection: 6, windSpeed: 5 },
        units: { height: 'm', heightRef: 'AGL', windSpeed: 'kn' },
        repairLeadingHeights: true,
        fillMissingPressure: true,
    }),
});

/** Fehler mit maschinenlesbarem Code, damit die UI gezielt nachfragen kann. */
export class ProfileImportError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'ProfileImportError';
        this.code = code;
    }
}

// ===================================================================
// Dekodieren & Erkennen
// ===================================================================

/**
 * Dekodiert Dateibytes: UTF-8, bei ungültigen Sequenzen Windows-1252/Latin-1
 * (Windsond-Exporte enthalten ein Latin-1-Gradzeichen).
 * @param {ArrayBuffer|Uint8Array} bytes
 * @returns {string}
 */
export function decodeProfileBytes(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(data);
    } catch {
        return new TextDecoder('windows-1252').decode(data);
    }
}

function _lines(text) {
    return text.split(/\r?\n/).filter(l => l.trim() !== '');
}

/**
 * Erkennt das Format anhand des Inhalts.
 * @param {string} text
 * @returns {string|null} Preset-ID oder null, wenn unbekannt
 */
export function detectProfilePreset(text) {
    const lines = _lines(text);
    if (lines.length === 0) return null;
    if (/^\s*Height\[m\]\s+Pressure\[hPa\]/i.test(lines[0])) return 'windsond';
    if (/^\s*(Zeit|Time)\s*\[sec\]\s+P\s*\[h\s?Pa\]/i.test(lines[0])) {
        return /\[(kn|kt)\]/i.test(lines[0]) ? 'graw_kn' : 'graw';
    }

    const sample = lines.slice(0, 10);
    const looksNinjo = sample.every(l => {
        const f = l.split('\t');
        return f.length >= 11 && /^\d+$/.test(f[0].trim());
    });
    return looksNinjo ? 'ninjo' : null;
}

/**
 * Liest Datum/Uhrzeit aus dem Dateinamen. Die Zeitzone ist nie sicher bekannt
 * (Exporte sind nicht einheitlich) -> die UI muss nachfragen; timezoneHint ist nur ein Vorschlag.
 * @param {string} filename
 * @returns {{date: string, time: string, timezoneHint: 'UTC'|null}|null}
 */
export function parseProfileFilename(filename) {
    const name = filename || '';
    // "2020-07-07_1340" (Windsond, NinJo) oder kompakt "20250331_1035" / "200922_0836" (Graw)
    const m = /(\d{4})-(\d{2})-(\d{2})[_-](\d{2})(\d{2})/.exec(name)
        || /(?:^|[_-])(\d{4}|\d{2})(\d{2})(\d{2})[_-](\d{2})(\d{2})(?!\d)/.exec(name);
    if (!m) return null;
    let [, y, mo, d, h, mi] = m;
    if (y.length === 2) y = `20${y}`;
    if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +h > 23 || +mi > 59) return null;
    // Ein Modelllauf-Kürzel wie "06Z" deutet auf UTC hin (NinJo)
    const timezoneHint = /_\d{2}Z\b/i.test(name) ? 'UTC' : null;
    return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}`, timezoneHint };
}

// ===================================================================
// Parsen
// ===================================================================

function _split(line, delimiter) {
    switch (delimiter) {
        case 'tab': return line.split('\t').map(s => s.trim());
        case 'semicolon': return line.split(';').map(s => s.trim());
        case 'comma': return line.split(',').map(s => s.trim());
        default: return line.trim().split(/\s+/);
    }
}

/**
 * Erkennt das Dezimaltrennzeichen: Kommt ein Feld wie "-53,8" vor, ist das Komma
 * Dezimaltrennzeichen und Punkte sind Tausendertrenner ("72.228" = 72228).
 */
function _detectDecimal(rows) {
    for (const fields of rows) {
        if (fields.some(f => /^-?\d+,\d+$/.test(f))) return 'comma';
    }
    return 'point';
}

/** Zahl parsen; '', '-' u. ä. -> null. */
export function parseProfileNumber(str, decimal) {
    if (str == null) return null;
    let s = String(str).trim();
    if (s === '' || /^[-–—/]+$/.test(s)) return null;
    if (decimal === 'comma') s = s.replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

/** Relative Feuchte (%) aus T und Td (Magnus-Formel, wie soundingManager). */
export function rhFromDewpoint(T, Td) {
    if (!Number.isFinite(T) || !Number.isFinite(Td)) return null;
    const es = (t) => 6.112 * Math.exp(17.67 * t / (t + 243.5));
    return Math.min(100, Math.max(0, 100 * es(Td) / es(T)));
}

function _toKmh(value, unit) {
    if (value == null) return null;
    switch (unit) {
        case 'kn': return value * CONVERSIONS.KNOTS_TO_KMH;
        case 'm/s': return value * CONVERSIONS.MPS_TO_KMH;
        default: return value;
    }
}

/**
 * Parst den Dateiinhalt anhand einer Vorlage (oder einer eigenen Spaltenzuordnung gleicher Form).
 * Zeilen ohne Druck oder Höhe werden übersprungen. Ein Wind ohne Richtung gilt als fehlend.
 * @param {string} text
 * @param {object} preset - Eintrag aus PROFILE_PRESETS oder gleich aufgebautes Objekt
 * @returns {{levels: object[], heightRef: 'AMSL'|'AGL', decimal: string, skippedRows: number}}
 */
export function parseProfileText(text, preset) {
    const lines = _lines(text).slice(preset.headerLines || 0);
    const delimiter = preset.delimiter === 'auto'
        ? (lines.some(l => l.includes('\t')) ? 'tab' : 'whitespace')
        : preset.delimiter;
    const rows = lines.map(l => _split(l, delimiter));
    const decimal = preset.decimal === 'auto'
        ? (delimiter === 'comma' ? 'point' : _detectDecimal(rows))
        : preset.decimal;

    const col = preset.columns;
    const get = (fields, c) => (c ? parseProfileNumber(fields[c - 1], decimal) : null);

    const levels = [];
    let skippedRows = 0;
    for (const fields of rows) {
        const pressure = get(fields, col.pressure);
        let height = get(fields, col.height);
        const pressureOk = pressure != null && pressure > 0;
        if (height == null || (!pressureOk && !preset.fillMissingPressure)) { skippedRows++; continue; }
        if (preset.units.height === 'ft') height *= CONVERSIONS.FEET_TO_METERS;

        const temperature = get(fields, col.temperature);
        const dewpoint = get(fields, col.dewpoint);
        const humidity = col.humidity ? get(fields, col.humidity) : rhFromDewpoint(temperature, dewpoint);

        let windDirection = get(fields, col.windDirection);
        let windSpeedKmh = _toKmh(get(fields, col.windSpeed), preset.units.windSpeed);
        if (windDirection == null || windSpeedKmh == null) { windDirection = null; windSpeedKmh = null; }

        levels.push({ pressure: pressureOk ? pressure : null, height, temperature, dewpoint, humidity, windDirection, windSpeedKmh });
    }

    if (preset.repairLeadingHeights) repairLeadingHeights(levels);
    if (preset.fillMissingPressure) fillMissingPressure(levels);
    const before = levels.length;
    for (let i = levels.length - 1; i >= 0; i--) if (levels[i].pressure == null) levels.splice(i, 1);
    skippedRows += before - levels.length;

    if (levels.length < 2) {
        throw new ProfileImportError('TOO_FEW_LEVELS', 'Die Datei enthält zu wenige auswertbare Zeilen.');
    }
    return { levels, heightRef: preset.units.heightRef, decimal, skippedRows };
}

// ===================================================================
// Säubern
// ===================================================================

const RD = 287.05;  // J/(kg K)
const G0 = 9.80665; // m/s²
const _tK = (a, b) => ((Number.isFinite(a) ? a : 15) + (Number.isFinite(b) ? b : (Number.isFinite(a) ? a : 15))) / 2 + 273.15;

/** Schichtdicke (m) zwischen zwei Messpunkten aus Druck und mittlerer Temperatur. */
function _hypsoThickness(lower, upper) {
    return RD * _tK(lower.temperature, upper.temperature) / G0 * Math.log(lower.pressure / upper.pressure);
}

/**
 * Ergänzt fehlenden Druck (in Dateireihenfolge) hypsometrisch aus Höhe und Temperatur des
 * vorigen Punkts mit Druck. Punkte vor dem ersten Druckwert bleiben ohne Druck.
 * @param {object[]} levels - wird verändert
 */
export function fillMissingPressure(levels) {
    let prev = null;
    for (const lev of levels) {
        if (lev.pressure != null) { prev = lev; continue; }
        if (!prev) continue;
        lev.pressure = prev.pressure * Math.exp(-G0 * (lev.height - prev.height) / (RD * _tK(prev.temperature, lev.temperature)));
        prev = lev;
    }
}

/**
 * Repariert unbrauchbare Höhen am Profilanfang (GRAW: Bodenzeile mit 0 m über Meer, danach
 * ein Sprung). Gesucht wird das erste Paar aufeinanderfolgender Punkte, dessen Höhendifferenz
 * zur hypsometrischen Schichtdicke passt, gefolgt von einem weiteren passenden Paar; die Punkte
 * davor werden von dort aus über Druck und Temperatur nach unten neu berechnet.
 * @param {object[]} levels - in Dateireihenfolge, wird verändert
 * @returns {number} Anzahl neu berechneter Höhen
 */
export function repairLeadingHeights(levels) {
    const fits = (a, b) => {
        if (!(a.pressure > b.pressure)) return false;
        const dzHyp = _hypsoThickness(a, b);
        return Math.abs((b.height - a.height) - dzHyp) <= Math.max(10, 0.1 * dzHyp);
    };
    const maxStart = Math.min(levels.length - 2, 20);
    for (let a = 0; a < maxStart; a++) {
        if (!fits(levels[a], levels[a + 1]) || !fits(levels[a + 1], levels[a + 2])) continue;
        for (let j = a - 1; j >= 0 && levels[j].pressure > 0; j--) {
            levels[j].height = levels[j + 1].height - _hypsoThickness(levels[j], levels[j + 1]);
        }
        return a;
    }
    return 0;
}

/**
 * Sortiert nach Höhe und behält nur Punkte, deren gerundeter Druck streng abnimmt.
 * Das entfernt Messfehler (Druck steigt mit der Höhe wieder an) und dünnt
 * hochaufgelöste Sonden (10-m-Schritte) auf höchstens einen Punkt je hPa aus,
 * sodass die ganzzahligen Druckstufen-Keys eindeutig und monoton sind.
 * @param {object[]} levels
 * @returns {object[]}
 */
export function cleanProfile(levels) {
    const sorted = [...levels].sort((a, b) => a.height - b.height);
    const kept = [];
    let lastKey = Infinity;
    let lastHeight = -Infinity;
    for (const lev of sorted) {
        const key = Math.round(lev.pressure);
        if (key >= lastKey || lev.height <= lastHeight) continue;
        kept.push(lev);
        lastKey = key;
        lastHeight = lev.height;
    }
    return kept;
}

// ===================================================================
// weatherData bauen
// ===================================================================

/**
 * Baut ein Open-Meteo-kompatibles weatherData-Objekt mit genau einem Zeitschritt.
 *
 * Höhenbezug: Bei AGL-Profilen ist groundElevationM (Starthöhe, m MSL) Pflicht; bei
 * AMSL-Profilen gilt die Höhe des untersten Levels als Boden, sofern nicht angegeben.
 * Mit anchorElevationM (Geländehöhe am DIP) wird das Profil geländefolgend verschoben, sodass
 * sein Boden auf dieser Höhe liegt – Höhen über Grund bleiben erhalten (wie bei den
 * ICON-Modelllevel-Daten, s. modelLevelManager.js).
 * Bodenwerte (T, Feuchte) stammen vom untersten Level, der Bodenwind vom ersten Level mit
 * gültigem Wind innerhalb SURFACE_WIND_MAX_GAP_M über Grund; sonst muss options.surfaceWind
 * übergeben werden (Fehlercode SURFACE_WIND_MISSING).
 *
 * @param {{levels: object[], heightRef: string}} parsed - Ergebnis von parseProfileText
 * @param {object} options
 * @param {string} options.timeUtc - "YYYY-MM-DDTHH:MM" (UTC)
 * @param {number} [options.groundElevationM] - Bodenhöhe des Profils in m MSL
 * @param {number} [options.anchorElevationM] - Höhe (m MSL), auf die der Profilboden gelegt wird
 * @param {{direction: number, speedKmh: number}} [options.surfaceWind] - manueller Bodenwind
 * @returns {{weatherData: object, pressureLevels: number[], groundElevationM: number,
 *            anchorElevationM: number, surfaceWindSource: 'profile'|'manual', levelCount: number}}
 */
export function buildCustomProfileWeatherData(parsed, options = {}) {
    const { timeUtc, surfaceWind } = options;
    if (!timeUtc) throw new ProfileImportError('TIME_MISSING', 'Zeitpunkt des Profils fehlt.');

    const levels = cleanProfile(parsed.levels);
    if (levels.length < 2) {
        throw new ProfileImportError('TOO_FEW_LEVELS', 'Nach dem Säubern bleiben zu wenige Messpunkte.');
    }

    let ground = options.groundElevationM;
    if (parsed.heightRef === 'AGL') {
        if (!Number.isFinite(ground)) {
            throw new ProfileImportError('GROUND_ELEVATION_MISSING', 'Starthöhe für Höhen über Grund fehlt.');
        }
    } else if (!Number.isFinite(ground)) {
        ground = levels[0].height;
    }
    const toMsl = (h) => (parsed.heightRef === 'AGL' ? h + ground : h);
    const anchor = Number.isFinite(options.anchorElevationM) ? options.anchorElevationM : ground;
    const shift = anchor - ground;

    const lowest = levels[0];
    const lowestMsl = toMsl(lowest.height);
    if (lowestMsl < ground - 1) {
        throw new ProfileImportError('PROFILE_BELOW_GROUND', 'Das Profil beginnt unterhalb der angegebenen Bodenhöhe.');
    }

    // Bodenwind
    let sfcDir, sfcSpd, surfaceWindSource;
    const windLevel = levels.find(l => l.windDirection != null && toMsl(l.height) - ground <= SURFACE_WIND_MAX_GAP_M);
    if (windLevel) {
        sfcDir = windLevel.windDirection;
        sfcSpd = windLevel.windSpeedKmh;
        surfaceWindSource = 'profile';
    } else if (surfaceWind && Number.isFinite(surfaceWind.direction) && Number.isFinite(surfaceWind.speedKmh)) {
        sfcDir = surfaceWind.direction;
        sfcSpd = surfaceWind.speedKmh;
        surfaceWindSource = 'manual';
    } else {
        throw new ProfileImportError('SURFACE_WIND_MISSING',
            `Kein gültiger Wind innerhalb von ${SURFACE_WIND_MAX_GAP_M} m über Grund.`);
    }

    const pressureLevels = levels.map(l => Math.round(l.pressure));
    const levelArrays = {};
    let ccLow = 0, ccMid = 0, ccHigh = 0;
    levels.forEach((lev, i) => {
        const key = pressureLevels[i];
        const cc = Number.isFinite(lev.humidity) && lev.humidity >= CLOUD_RH_THRESHOLD ? 100 : 0;
        const agl = toMsl(lev.height) - ground;
        levelArrays[`temperature_${key}hPa`] = [lev.temperature];
        levelArrays[`relative_humidity_${key}hPa`] = [lev.humidity];
        levelArrays[`wind_speed_${key}hPa`] = [lev.windSpeedKmh];
        levelArrays[`wind_direction_${key}hPa`] = [lev.windDirection];
        levelArrays[`geopotential_height_${key}hPa`] = [toMsl(lev.height) + shift];
        levelArrays[`cloud_cover_${key}hPa`] = [cc];
        if (agl < 2000) ccLow = Math.max(ccLow, cc);
        else if (agl < 6000) ccMid = Math.max(ccMid, cc);
        else ccHigh = Math.max(ccHigh, cc);
    });

    // Bodendruck: liegt der unterste Messpunkt über Grund, hypsometrisch auf den Boden
    // reduzieren. Er muss > unterstem Key sein, damit interpolateWeatherData den Bodenblock
    // einfügt; sonst exakt auf den untersten Key setzen (vgl. soundingManager).
    const dz = lowestMsl - ground;
    const tK = (Number.isFinite(lowest.temperature) ? lowest.temperature : 15) + 273.15;
    const pGround = lowest.pressure * Math.exp(9.80665 * dz / (287.05 * tK));
    const surfacePressure = (dz > 0.5 && pGround > pressureLevels[0]) ? pGround : pressureLevels[0];

    const weatherData = {
        time: [timeUtc],
        surface_pressure: [surfacePressure],
        temperature_2m: [lowest.temperature],
        relative_humidity_2m: [lowest.humidity],
        wind_speed_10m: [sfcSpd],
        wind_direction_10m: [sfcDir],
        // Keine Böen-, Sicht- und Wetterdaten im Profil: bewusst leer statt Modellwerte
        wind_gusts_10m: [null],
        visibility: [null],
        weather_code: [null],
        cloud_cover_low: [ccLow],
        cloud_cover_mid: [ccMid],
        cloud_cover_high: [ccHigh],
        ...levelArrays,
    };

    return {
        weatherData, pressureLevels, groundElevationM: ground, anchorElevationM: anchor,
        surfaceWindSource, levelCount: levels.length,
    };
}
