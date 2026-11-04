import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('./state.js', () => ({ AppState: { customPressureLevels: null, cloudThresholds: [] } }));
vi.mock('./settings.js', () => ({ Settings: { defaultSettings: {}, getValue: () => null, state: { userSettings: {} } } }));
vi.mock('./i18n.js', () => ({ I18n: { t: (k) => k } }));

import { AppState } from './state.js';
import { interpolateWeatherData, analyzeCloudLayers } from './weatherManager.js';
import {
    PROFILE_PRESETS, SURFACE_WIND_MAX_GAP_M, ProfileImportError,
    decodeProfileBytes, detectProfilePreset, parseProfileFilename, parseProfileNumber,
    parseProfileText, cleanProfile, buildCustomProfileWeatherData,
} from './customProfileImport.js';

// Die Beispieldateien liegen bewusst nicht im Repo (src/core/testdata/ ist in .gitignore).
// Fehlen sie, werden die dateibasierten Tests übersprungen; die übrigen laufen immer.
const dataPath = (name) => fileURLToPath(new URL(`./testdata/${name}`, import.meta.url));
const load = (name) => decodeProfileBytes(readFileSync(dataPath(name)));
const NINJO_FILE = 'NinJo_2018-08-16-0900_ICONEU_06Z.txt';
const WINDSOND_FILE = 'Windson_2020-07-07_1340.txt';
const HAS_TESTDATA = existsSync(dataPath(NINJO_FILE)) && existsSync(dataPath(WINDSOND_FILE));
const describeWithData = describe.skipIf(!HAS_TESTDATA);

let ninjoText, windsondText;
beforeAll(() => {
    if (!HAS_TESTDATA) return;
    ninjoText = load(NINJO_FILE);
    windsondText = load(WINDSOND_FILE);
});

/** Wie die App: Keys setzen, Wolkenschwellen analysieren, Tabelle interpolieren (m, 100-m-Schritte). */
function interpolate(result, step = 100) {
    AppState.customPressureLevels = result.pressureLevels;
    AppState.cloudThresholds = analyzeCloudLayers(result.weatherData);
    return interpolateWeatherData(result.weatherData, 0, step, result.anchorElevationM, 'm');
}
const atAgl = (rows, agl) => rows.find(r => r.displayHeight === agl);
const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

describeWithData('Erkennung am Inhalt', () => {
    it('erkennt beide Formate', () => {
        expect(detectProfilePreset(ninjoText)).toBe('ninjo');
        expect(detectProfilePreset(windsondText)).toBe('windsond');
    });
});

describe('Erkennung & Metadaten', () => {
    it('erkennt unbekannte Formate nicht', () => {
        expect(detectProfilePreset('foo bar\n1 2 3')).toBeNull();
    });

    it('liest Datum/Uhrzeit aus dem Dateinamen, UTC nur als Vorschlag bei Laufkürzel', () => {
        expect(parseProfileFilename(NINJO_FILE)).toEqual({ date: '2018-08-16', time: '09:00', timezoneHint: 'UTC' });
        expect(parseProfileFilename(WINDSOND_FILE)).toEqual({ date: '2020-07-07', time: '13:40', timezoneHint: null });
        expect(parseProfileFilename('profil.txt')).toBeNull();
    });

    it('parst deutsches Zahlenformat mit Tausenderpunkt', () => {
        expect(parseProfileNumber('72.228', 'comma')).toBe(72228);
        expect(parseProfileNumber('-53,8', 'comma')).toBe(-53.8);
        expect(parseProfileNumber('932.85', 'point')).toBe(932.85);
        expect(parseProfileNumber('-', 'point')).toBeNull();
    });
});

describeWithData('NinJo (ICON-EU-TEMP)', () => {
    it('erkennt Dezimalkomma und liest die Spalten laut Vorlage', () => {
        const parsed = parseProfileText(ninjoText, PROFILE_PRESETS.ninjo);
        expect(parsed.decimal).toBe('comma');
        expect(parsed.heightRef).toBe('AMSL');
        expect(parsed.levels).toHaveLength(70);

        const top = parsed.levels[0];
        expect(top).toMatchObject({ pressure: 42, height: 22015, temperature: -53.8, dewpoint: -86, windDirection: 127 });
        expect(top.windSpeedKmh).toBeCloseTo(8 * 1.852, 6);

        const bottom = parsed.levels.at(-1);
        expect(bottom).toMatchObject({ pressure: 934, height: 734, temperature: 20, windDirection: 85 });
        expect(bottom.humidity).toBeCloseTo(67, 0); // Datei-Spalte 7: 67 %
    });

    it('baut weatherData mit Boden = unterstes Level und läuft durch die Interpolation', () => {
        const parsed = parseProfileText(ninjoText, PROFILE_PRESETS.ninjo);
        const result = buildCustomProfileWeatherData(parsed, { timeUtc: '2018-08-16T09:00' });

        expect(result.groundElevationM).toBe(734);
        expect(result.surfaceWindSource).toBe('profile');
        expect(result.weatherData.time).toEqual(['2018-08-16T09:00']);
        expect(result.weatherData.surface_pressure[0]).toBe(934);
        expect(result.weatherData.wind_direction_10m[0]).toBe(85);

        const rows = interpolate(result);
        expect(rows.length).toBeGreaterThan(200);
        // 850 hPa liegt bei 1540 m MSL = 806 m AGL: 108°, 5 kn
        const r = atAgl(rows, 800);
        expect(angleDiff(r.dir, 108)).toBeLessThan(5);
        expect(r.spd).toBeCloseTo(5 * 1.852, 0);
    });
});

describeWithData('Windsond', () => {
    it('liest Kopfzeile, Latin-1 und fehlenden Bodenwind', () => {
        const parsed = parseProfileText(windsondText, PROFILE_PRESETS.windsond);
        expect(parsed.heightRef).toBe('AGL');
        expect(parsed.levels.length).toBeGreaterThan(3000);
        expect(parsed.levels[0]).toMatchObject({ height: 10, pressure: 932.85, windDirection: null, windSpeedKmh: null });
        expect(parsed.levels[1].windDirection).toBe(63.7);
        expect(parsed.levels[1].windSpeedKmh).toBeCloseTo(7.98 * 3.6, 6);
    });

    it('säubert auf streng fallende ganzzahlige Druck-Keys (Ausreißer bei 22,5 km)', () => {
        const parsed = parseProfileText(windsondText, PROFILE_PRESETS.windsond);
        const cleaned = cleanProfile(parsed.levels);
        expect(cleaned.length).toBeLessThan(1000);
        for (let i = 1; i < cleaned.length; i++) {
            expect(Math.round(cleaned[i].pressure)).toBeLessThan(Math.round(cleaned[i - 1].pressure));
            expect(cleaned[i].height).toBeGreaterThan(cleaned[i - 1].height);
        }
        // Der Ausreißer 22490 m / 38.31 hPa darf nicht übrig bleiben
        expect(cleaned.find(l => l.height === 22490)).toBeUndefined();
    });

    it('verlangt die Starthöhe bei Höhen über Grund', () => {
        const parsed = parseProfileText(windsondText, PROFILE_PRESETS.windsond);
        expect(() => buildCustomProfileWeatherData(parsed, { timeUtc: '2020-07-07T11:40' }))
            .toThrow(expect.objectContaining({ code: 'GROUND_ELEVATION_MISSING' }));
    });

    it('nimmt den ersten gültigen Wind (20 m AGL) als Bodenwind und interpoliert', () => {
        const parsed = parseProfileText(windsondText, PROFILE_PRESETS.windsond);
        const result = buildCustomProfileWeatherData(parsed, { timeUtc: '2020-07-07T11:40', groundElevationM: 700 });

        expect(result.surfaceWindSource).toBe('profile');
        expect(result.weatherData.wind_direction_10m[0]).toBe(63.7);
        // Unterster Punkt 10 m über Grund -> Bodendruck leicht höher als 932.85
        expect(result.weatherData.surface_pressure[0]).toBeGreaterThan(933);
        expect(result.weatherData.surface_pressure[0]).toBeLessThan(934.5);
        expect(result.weatherData['geopotential_height_932hPa'][0]).toBe(720);

        const rows = interpolate(result);
        expect(rows.at(-1).displayHeight).toBeGreaterThan(25000);
        // Rohdaten 3000 m AGL: 293.3°, 9.43 m/s
        const r = atAgl(rows, 3000);
        expect(angleDiff(r.dir, 293.3)).toBeLessThan(5);
        expect(r.spd).toBeCloseTo(9.43 * 3.6, 0);
        expect(atAgl(rows, 0).spd).toBeCloseTo(7.98 * 3.6, 1);
    });
});

describe('Bodenwind-Regel', () => {
    const synthetic = (firstWindAgl) => ({
        heightRef: 'AGL',
        levels: [
            { pressure: 1000, height: 0, temperature: 15, humidity: 60, windDirection: null, windSpeedKmh: null },
            { pressure: 1000 - firstWindAgl / 9, height: firstWindAgl, temperature: 14, humidity: 60, windDirection: 270, windSpeedKmh: 20 },
            { pressure: 900, height: 1000, temperature: 8, humidity: 60, windDirection: 280, windSpeedKmh: 30 },
        ],
    });

    it(`akzeptiert Wind bis ${SURFACE_WIND_MAX_GAP_M} m über Grund`, () => {
        const r = buildCustomProfileWeatherData(synthetic(SURFACE_WIND_MAX_GAP_M), { timeUtc: 't', groundElevationM: 0 });
        expect(r.weatherData.wind_direction_10m[0]).toBe(270);
    });

    it('meldet SURFACE_WIND_MISSING, wenn der erste Wind zu hoch liegt, und nimmt manuellen Wind an', () => {
        const parsed = synthetic(200);
        let err;
        try { buildCustomProfileWeatherData(parsed, { timeUtc: 't', groundElevationM: 0 }); } catch (e) { err = e; }
        expect(err).toBeInstanceOf(ProfileImportError);
        expect(err.code).toBe('SURFACE_WIND_MISSING');

        const r = buildCustomProfileWeatherData(parsed, { timeUtc: 't', groundElevationM: 0, surfaceWind: { direction: 250, speedKmh: 10 } });
        expect(r.surfaceWindSource).toBe('manual');
        expect(r.weatherData.wind_direction_10m[0]).toBe(250);
    });
});

describeWithData('Verankerung am DIP (geländefolgend)', () => {
    it('verschiebt ein AMSL-Profil auf die DIP-Höhe, Höhen über Grund bleiben gleich', () => {
        const parsed = parseProfileText(ninjoText, PROFILE_PRESETS.ninjo);
        const result = buildCustomProfileWeatherData(parsed, { timeUtc: '2018-08-16T09:00', anchorElevationM: 500 });
        expect(result.groundElevationM).toBe(734);
        expect(result.anchorElevationM).toBe(500);
        // 850 hPa: 1540 m MSL im Profil = 806 m über Profilboden -> 1306 m MSL am DIP
        expect(result.weatherData['geopotential_height_850hPa'][0]).toBe(1306);

        const rows = interpolate(result);
        const r = atAgl(rows, 800);
        expect(angleDiff(r.dir, 108)).toBeLessThan(5);
        expect(rows[0].height).toBe(500);
    });
});
