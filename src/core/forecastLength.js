/**
 * @file forecastLength.js
 * @description Begrenzung der Vorhersagedauer je Wettermodell.
 */
import { WEATHER_MODELS } from './constants.js';

/** Höchstzahl der Kalendertage, die für ein Modell angefragt werden. */
export function getModelMaxForecastDays(model) {
    return WEATHER_MODELS.MAX_FORECAST_DAYS[model] ?? WEATHER_MODELS.DEFAULT_MAX_FORECAST_DAYS;
}

/** Felder, die eine Stunde mindestens haben muss, damit sie als "mit Daten" zählt. */
const REQUIRED_FIELDS = ['temperature_2m', 'wind_speed_10m'];

/**
 * Schneidet Stunden am Ende von `hourly` ab, für die das Modell keine Daten mehr liefert
 * (Open-Meteo füllt bis end_date mit null auf). Alle Arrays werden gleich gekürzt.
 * Lücken mittendrin bleiben unangetastet.
 * @param {object} hourly - Das `hourly`-Objekt der Open-Meteo-Antwort.
 * @returns {object} Ein neues `hourly`-Objekt (oder das unveränderte, wenn nichts zu kürzen ist).
 */
export function trimTrailingEmptyHours(hourly) {
    const times = hourly?.time;
    if (!Array.isArray(times) || times.length === 0) return hourly;

    const fields = REQUIRED_FIELDS.filter(f => Array.isArray(hourly[f]));
    if (fields.length === 0) return hourly;

    let last = times.length - 1;
    while (last >= 0 && !fields.every(f => Number.isFinite(hourly[f][last]))) last--;

    const keep = last + 1;
    if (keep === times.length) return hourly;

    const trimmed = {};
    for (const [key, value] of Object.entries(hourly)) {
        trimmed[key] = Array.isArray(value) && value.length === times.length ? value.slice(0, keep) : value;
    }
    return trimmed;
}
