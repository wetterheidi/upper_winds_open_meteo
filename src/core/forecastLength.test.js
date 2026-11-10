import { describe, it, expect } from 'vitest';
import { getModelMaxForecastDays, trimTrailingEmptyHours } from './forecastLength.js';

describe('getModelMaxForecastDays', () => {
    it('liefert modellspezifische Grenzen', () => {
        expect(getModelMaxForecastDays('icon_d2')).toBe(2);
        expect(getModelMaxForecastDays('gfs_hrrr')).toBe(2);
        expect(getModelMaxForecastDays('ncep_rrfs_north_america')).toBe(4);
        expect(getModelMaxForecastDays('icon_eu')).toBe(5);
    });
    it('fällt für unbekannte Modelle auf 7 Tage zurück', () => {
        expect(getModelMaxForecastDays('ecmwf_ifs025')).toBe(7);
    });
});

describe('trimTrailingEmptyHours', () => {
    const hourly = {
        time: ['t0', 't1', 't2', 't3', 't4'],
        temperature_2m: [1, null, 3, null, null],
        wind_speed_10m: [5, 6, 7, 8, null],
        wind_speed_850hPa: [9, 9, 9, null, null],
    };

    it('schneidet leere Stunden am Ende in allen Arrays ab', () => {
        const r = trimTrailingEmptyHours(hourly);
        expect(r.time).toEqual(['t0', 't1', 't2']);
        expect(r.wind_speed_10m).toEqual([5, 6, 7]);
        expect(r.wind_speed_850hPa).toEqual([9, 9, 9]);
    });

    it('lässt Lücken mittendrin stehen', () => {
        expect(trimTrailingEmptyHours(hourly).temperature_2m).toEqual([1, null, 3]);
    });

    it('gibt vollständige Daten unverändert zurück', () => {
        const full = { time: ['a', 'b'], temperature_2m: [1, 2], wind_speed_10m: [3, 4] };
        expect(trimTrailingEmptyHours(full)).toBe(full);
    });

    it('liefert eine leere Zeitreihe, wenn gar keine Daten da sind', () => {
        const empty = { time: ['a'], temperature_2m: [null], wind_speed_10m: [null] };
        expect(trimTrailingEmptyHours(empty).time).toEqual([]);
    });
});
