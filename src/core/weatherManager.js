/**
 * @file weatherManager.js
 * @description Dieses Modul ist verantwortlich für die gesamte Kommunikation mit der
 * Open-Meteo Wetter-API. Es ruft Wetterdaten ab, prüft die Verfügbarkeit von
 * Modellen und bereitet die Rohdaten durch Interpolation für die Anwendung auf.
 */

import { AppState } from './state.js';
import { Utils } from './utils.js';
import { Settings } from './settings.js';
import { WEATHER_MODELS, API_URLS, STANDARD_PRESSURE_LEVELS, THUNDERSTORM_CODES, CONVERSIONS } from './constants.js';
import { DateTime } from 'luxon';
import { I18n } from './i18n.js';
import { SOUNDING_MODEL_ID, checkSoundingAvailability, fetchSoundingData } from './soundingManager.js';

// ===================================================================
// 1. Öffentliche Hauptfunktionen (API des Moduls)
// ===================================================================

/**
 * Analysiert die Roh-Wetterdaten, um für jeden Zeitpunkt dynamische
 * Feuchtigkeitsschwellenwerte für die Wolkenerkennung zu bestimmen.
 * @param {object} weatherData - Das 'hourly' Objekt aus der API-Antwort.
 * @returns {object[]} Ein Array von Schwellenwert-Objekten für jeden Zeitpunkt.
 */
export function analyzeCloudLayers(weatherData) {
    if (!weatherData || !weatherData.time || weatherData.time.length === 0) {
        return [];
    }

    const thresholds = [];
    const pressureLevels = AppState.customPressureLevels || STANDARD_PRESSURE_LEVELS;

    for (let i = 0; i < weatherData.time.length; i++) {
        const groundTemp = weatherData.temperature_2m[i];
        let stockwerke = { low: [], mid: [], high: [] };

        // 1. Druckstufen den Stockwerken zuordnen
        for (const p of pressureLevels) {
            const temp = weatherData[`temperature_${p}hPa`]?.[i];
            const height = weatherData[`geopotential_height_${p}hPa`]?.[i];

            if (temp === null || height === null || temp === undefined || height === undefined) continue;

            if (groundTemp <= 0) { // Sonderfall Kaltluft
                if (height <= 2000) stockwerke.low.push(p);
                else if (temp > -30) stockwerke.mid.push(p);
                else stockwerke.high.push(p);
            } else { // Normalfall
                if (temp > 0) stockwerke.low.push(p);
                else if (temp > -30) stockwerke.mid.push(p);
                else stockwerke.high.push(p);
            }
        }

        // 2. maxCC und RH-Schwelle pro Stockwerk berechnen
        const getThreshold = (pLevels, defaultHigh, defaultLow) => {
            if (pLevels.length === 0) return 95; // Konservativer Fallback
            const maxCC = Math.max(...pLevels.map(p => weatherData[`cloud_cover_${p}hPa`]?.[i] || 0));
            return maxCC > 50 ? defaultHigh : defaultLow;
        };

        thresholds.push({
            low: getThreshold(stockwerke.low, 90, 75),
            mid: getThreshold(stockwerke.mid, 85, 70),
            high: 65 // Fester Wert für hohe Wolken
        });
    }

    console.log('[WeatherManager] Cloud layer thresholds analyzed for all timesteps.');
    return thresholds;
}

/**
 * Zentraler Einstiegspunkt zum Abrufen von Wetterdaten für einen Standort.
 * Orchestriert die Prüfung verfügbarer Modelle und den eigentlichen Datenabruf.
 * @param {number} lat - Die geographische Breite des Standorts.
 * @param {number} lng - Die geographische Länge des Standorts.
 * @param {string|null} [currentTime=null] - Ein optionaler ISO-Zeitstempel für historische Daten.
 * @param {string|null} [historicalDateOverride=null] - Erzwingt den Abruf historischer Daten für dieses
 *        Datum ('yyyy-MM-dd'), unabhängig davon, ob es heute oder in der Vergangenheit liegt. Wird von der
 *        Track-Ladefunktion genutzt, damit auch Tracks vom selben Tag historische Daten laden.
 * @returns {Promise<object|null>} Ein Promise, das zum 'hourly' Wetterdatenobjekt auflöst, oder null bei einem Fehler.
 */
export async function fetchWeatherForLocation(lat, lng, currentTime = null, historicalDateOverride = null) {
    console.log('[weatherManager] Starting full weather fetch for location:', { lat, lng });

    // 1. Prüfen, welche Modelle verfügbar sind (Open-Meteo + Progtemp parallel)
    const [availableModels, soundingAvailable] = await Promise.all([
        checkAvailableModels(lat, lng),
        checkSoundingAvailability(lat, lng)
    ]);

    // Progtemp-Option am Ende der Liste eintragen, wenn ein Standort im 20-km-Umkreis liegt
    if (soundingAvailable) {
        availableModels.push(SOUNDING_MODEL_ID);
    }

    // 2. Ein Event auslösen, damit die UI sich aktualisieren kann
    document.dispatchEvent(new CustomEvent('models:available', {
        detail: { availableModels }
    }));

    // 3. Die eigentlichen Wetterdaten für das aktuell ausgewählte Modell abrufen
    const weatherData = await fetchWeather(lat, lng, currentTime, historicalDateOverride);
    return weatherData;
}

/**
 * Sucht den Index in weatherData.time, der einem gegebenen ISO-Zeitstempel am nächsten liegt.
 * Normiert beide Strings auf "YYYY-MM-DDTHH" für modell-unabhängigen Vergleich.
 * @param {object} weatherData
 * @param {string} isoTime - ISO-Zeitstempel (mit oder ohne Z-Suffix)
 * @returns {number}
 */
export function findTimeIndex(weatherData, isoTime) {
    if (!weatherData?.time?.length || !isoTime) return 0;
    const targetPrefix = isoTime.substring(0, 13); // "YYYY-MM-DDTHH"
    let bestIndex = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < weatherData.time.length; i++) {
        const diff = Math.abs(weatherData.time[i].substring(0, 13).localeCompare(targetPrefix));
        if (diff < bestDiff) { bestDiff = diff; bestIndex = i; }
        // Exakter Treffer
        if (weatherData.time[i].substring(0, 13) === targetPrefix) return i;
    }
    return bestIndex;
}

/**
 * Ermittelt den Slider-Index für den aktuellen UTC-Zeitpunkt in den geladenen Wetterdaten.
 * Funktioniert korrekt für beliebige Startzeiten (00Z Open-Meteo, 06Z/12Z/... Progtemp).
 * @param {object} weatherData - Das aktuelle weatherData-Objekt mit einem 'time'-Array.
 * @returns {number} Der Index des nächstgelegenen vergangenen oder gleichen Zeitschritts,
 *                   oder der letzte verfügbare Index falls alle Zeiten in der Vergangenheit liegen.
 */
export function findCurrentTimeIndex(weatherData) {
    if (!weatherData?.time?.length) return 0;
    // UTC-Stunde als String "YYYY-MM-DDTHH" aufbauen — kein Date-Parsing nötig.
    // Funktioniert für Open-Meteo ("2026-04-08T12:00", kein Z) und Sounding ("2026-04-08T12:00Z")
    // gleichermaßen, da ISO-Timestamps lexikografisch sortierbar sind.
    const now = new Date();
    const nowPrefix =
        now.getUTCFullYear() + '-' +
        String(now.getUTCMonth() + 1).padStart(2, '0') + '-' +
        String(now.getUTCDate()).padStart(2, '0') + 'T' +
        String(now.getUTCHours()).padStart(2, '0');
    let bestIndex = 0;
    for (let i = 0; i < weatherData.time.length; i++) {
        if (weatherData.time[i].substring(0, 13) <= nowPrefix) bestIndex = i;
        else break;
    }
    return bestIndex;
}

/**
 * Interpoliert die Roh-Wetterdaten für einen bestimmten Zeitpunkt, um eine detaillierte,
 * höhenabhängige Wettertabelle zu erstellen.
 * HINWEIS (ToDo): Diese Funktion ist stark vom globalen `AppState` abhängig. Zukünftig
 * könnte sie so umgestaltet werden, dass sie alle benötigten Daten als Parameter erhält.
 * @param {number} sliderIndex - Der Index des Zeitschiebereglers.
 * @returns {object[]} Ein Array von Objekten mit den Wetterdaten für jede Höhenstufe.
 */
export function interpolateWeatherData(weatherData, sliderIndex, interpStep, baseHeight, heightUnit) {
    if (!weatherData || !weatherData.time || sliderIndex >= weatherData.time.length) {
        console.warn('No weather data provided or index out of bounds for interpolation');
        return [];
    }

    const currentThresholds = AppState.cloudThresholds[sliderIndex];
    if (!currentThresholds) {
        console.warn(`[DIAG2] No cloudThresholds at index ${sliderIndex}, total=${AppState.cloudThresholds.length}, weatherData.time.length=${weatherData.time.length}, time=${weatherData.time[sliderIndex]}`);
        AppState.cloudThresholds = analyzeCloudLayers(weatherData);
        if (!AppState.cloudThresholds[sliderIndex]) {
            console.error('Cloud threshold analysis failed. Cannot interpolate weather data.');
            return [];
        }
    }

    const allPressureLevels = AppState.customPressureLevels || STANDARD_PRESSURE_LEVELS;

    // Filtere Drucklevel nur, wenn ALLE benötigten Daten für diesen Level vorhanden sind.
    let validPressureLevels = allPressureLevels.filter(hPa => {
        const height = weatherData[`geopotential_height_${hPa}hPa`]?.[sliderIndex];
        // temp und rh werden für die Validierung nicht mehr benötigt
        const speed = weatherData[`wind_speed_${hPa}hPa`]?.[sliderIndex];
        const dir = weatherData[`wind_direction_${hPa}hPa`]?.[sliderIndex];

        // Es werden nur noch die für die Sprungberechnung kritischen Werte geprüft.
        return [height, speed, dir].every(val => val != null);
    });

    // DIAGNOSE: Zeige für Sounding-Daten bei < 2 valid levels was fehlt
    if (validPressureLevels.length < 2 && AppState.customPressureLevels) {
        const sample = allPressureLevels.slice(0, 5);
        console.error(`[interpolate] DIAG sliderIndex=${sliderIndex} validLevels=${validPressureLevels.length}/${allPressureLevels.length} baseHeight=${baseHeight} time=${weatherData.time[sliderIndex]}`);
        sample.forEach(hPa => {
            const h = weatherData[`geopotential_height_${hPa}hPa`]?.[sliderIndex];
            const s = weatherData[`wind_speed_${hPa}hPa`]?.[sliderIndex];
            const d = weatherData[`wind_direction_${hPa}hPa`]?.[sliderIndex];
            console.error(`  key${hPa}: height=${h} speed=${s} dir=${d}`);
        });
    }

    const ccPressureLevels = allPressureLevels.filter(hPa => {
        const height = weatherData[`geopotential_height_${hPa}hPa`]?.[sliderIndex];
        const cc = weatherData[`cloud_cover_${hPa}hPa`]?.[sliderIndex];
        return height != null && cc != null;
    });

    const ccHeightData = ccPressureLevels.map(hPa => weatherData[`geopotential_height_${hPa}hPa`][sliderIndex]);
    const ccValueData = ccPressureLevels.map(hPa => weatherData[`cloud_cover_${hPa}hPa`][sliderIndex]);

    if (validPressureLevels.length < 2) {
        console.warn('Insufficient valid pressure level data for interpolation:', validPressureLevels);
        return [];
    }

    // Sammle die Daten der validen Drucklevel
    let heightData = validPressureLevels.map(hPa => weatherData[`geopotential_height_${hPa}hPa`][sliderIndex]);
    let tempData = validPressureLevels.map(hPa => weatherData[`temperature_${hPa}hPa`][sliderIndex]);
    let rhData = validPressureLevels.map(hPa => weatherData[`relative_humidity_${hPa}hPa`][sliderIndex]);
    let ccData = validPressureLevels.map(hPa => weatherData[`cloud_cover_${hPa}hPa`]?.[sliderIndex]);
    let spdData = validPressureLevels.map(hPa => weatherData[`wind_speed_${hPa}hPa`][sliderIndex]);
    let dirData = validPressureLevels.map(hPa => weatherData[`wind_direction_${hPa}hPa`][sliderIndex]);

    // Deduplizierung: Einträge entfernen, wo die Höhe nicht streng monoton steigt.
    // Ursache: _closestLevel() kann für zwei Referenz-Druckniveaus dasselbe Sounding-Level
    // zurückgeben → identische geopotential_height → Division durch 0 in linearInterpolate.
    {
        const toKeep = heightData.map((h, i) => i === 0 || h > heightData[i - 1]);
        if (toKeep.includes(false)) {
            const filt = (arr) => arr.filter((_, i) => toKeep[i]);
            heightData        = filt(heightData);
            validPressureLevels = filt(validPressureLevels);
            tempData          = filt(tempData);
            rhData            = filt(rhData);
            ccData            = filt(ccData);
            spdData           = filt(spdData);
            dirData           = filt(dirData);
        }
    }

    // Füge Bodendaten hinzu, um die Interpolation nach unten hin zu verbessern
    const surfacePressure = weatherData.surface_pressure[sliderIndex];
    if (surfacePressure === null || surfacePressure === undefined) {
        console.warn('Surface pressure missing');
        return [];
    }

    let uComponents = spdData.map((spd, i) => -spd * Math.sin(dirData[i] * Math.PI / 180));
    let vComponents = spdData.map((spd, i) => -spd * Math.cos(dirData[i] * Math.PI / 180));

    const lowestPressureLevel = Math.max(...validPressureLevels);
    const hLowest = weatherData[`geopotential_height_${lowestPressureLevel}hPa`][sliderIndex];
    if (surfacePressure > lowestPressureLevel && Number.isFinite(hLowest)) {
        const interpStepInMeters = heightUnit === 'ft' ? interpStep * CONVERSIONS.FEET_TO_METERS : interpStep;
        const stepsBetween = Math.floor((hLowest - baseHeight) / interpStepInMeters);

        const uSurface = -weatherData.wind_speed_10m[sliderIndex] * Math.sin(weatherData.wind_direction_10m[sliderIndex] * Math.PI / 180);
        const vSurface = -weatherData.wind_speed_10m[sliderIndex] * Math.cos(weatherData.wind_direction_10m[sliderIndex] * Math.PI / 180);
        const uLowest = uComponents[validPressureLevels.indexOf(lowestPressureLevel)];
        const vLowest = vComponents[validPressureLevels.indexOf(lowestPressureLevel)];

        for (let i = stepsBetween - 1; i >= 1; i--) {
            const h = baseHeight + i * interpStepInMeters;
            if (h >= hLowest) continue;
            const fraction = (h - baseHeight) / (hLowest - baseHeight);
            const logPSurface = Math.log(surfacePressure);
            const logPLowest = Math.log(lowestPressureLevel);
            const logP = logPSurface + fraction * (logPLowest - logPSurface);
            const p = Math.exp(logP);

            const logHeight = Math.log(h - baseHeight + 1);
            const logH0 = Math.log(1);
            const logH1 = Math.log(hLowest - baseHeight);
            const u = Utils.linearInterpolate([logH0, logH1], [uSurface, uLowest], logHeight);
            const v = Utils.linearInterpolate([logH0, logH1], [vSurface, vLowest], logHeight);
            const spd = Utils.windSpeed(u, v);
            const dir = Utils.windDirection(u, v);

            heightData.unshift(h);
            validPressureLevels.unshift(p);
            tempData.unshift(Utils.linearInterpolate([baseHeight, hLowest], [weatherData.temperature_2m[sliderIndex], weatherData[`temperature_${lowestPressureLevel}hPa`][sliderIndex]], h));
            rhData.unshift(Utils.linearInterpolate([baseHeight, hLowest], [weatherData.relative_humidity_2m[sliderIndex], weatherData[`relative_humidity_${lowestPressureLevel}hPa`][sliderIndex]], h));
            spdData.unshift(spd);
            dirData.unshift(dir);
            uComponents.unshift(u);
            vComponents.unshift(v);
        }

        heightData.unshift(baseHeight);
        validPressureLevels.unshift(surfacePressure);
        tempData.unshift(weatherData.temperature_2m[sliderIndex]);
        rhData.unshift(weatherData.relative_humidity_2m[sliderIndex]);
        spdData.unshift(weatherData.wind_speed_10m[sliderIndex]);
        dirData.unshift(weatherData.wind_direction_10m[sliderIndex]);
        uComponents.unshift(uSurface);
        vComponents.unshift(vSurface);
    }

    const minPressureIndex = validPressureLevels.indexOf(Math.min(...validPressureLevels));
    const maxHeightASL = heightData[minPressureIndex];
    const maxHeightAGL = maxHeightASL - baseHeight;
    if (maxHeightAGL <= 0 || isNaN(maxHeightAGL)) {
        console.warn(`[DIAG3] Invalid maxHeight at sliderIndex=${sliderIndex} time=${weatherData.time[sliderIndex]}: maxHeightASL=${maxHeightASL} baseHeight=${baseHeight} minPressure=${validPressureLevels[minPressureIndex]} validLevels=${validPressureLevels.length} heightData[0]=${heightData[0]} heightData.last=${heightData[heightData.length-1]}`);
        return [];
    }

    const maxHeightInUnit = heightUnit === 'ft' ? maxHeightAGL * CONVERSIONS.METERS_TO_FEET : maxHeightAGL;
    const steps = Math.floor(maxHeightInUnit / interpStep);
    const heightsInUnit = Array.from({ length: steps + 1 }, (_, i) => i * interpStep);

    const interpolatedData = [];
    heightsInUnit.forEach(height => {
        const heightAGLInMeters = heightUnit === 'ft' ? height * CONVERSIONS.FEET_TO_METERS : height;
        const heightASLInMeters = baseHeight + heightAGLInMeters;

        let dataPoint;

        let cc = 0; // Standardwert ist 0
        if (ccHeightData.length > 0) {
            // Finde den Index des nächstgelegenen realen Datenpunktes
            let closestPressureLevelIndex = 0;
            let minDistance = Infinity;

            ccHeightData.forEach((h, index) => {
                const distance = Math.abs(heightASLInMeters - h);
                if (distance < minDistance) {
                    minDistance = distance;
                    closestPressureLevelIndex = index;
                }
            });
            cc = ccValueData[closestPressureLevelIndex]; // Weise den Wert zu
        }

        if (heightAGLInMeters === 0) {
            const lowestAltitudePressureLevel = Math.max(...validPressureLevels);
            const surfaceCloudCover = weatherData[`cloud_cover_${lowestAltitudePressureLevel}hPa`]?.[sliderIndex] ?? 'N/A';

            dataPoint = {
                height: heightASLInMeters,
                pressure: surfacePressure,
                temp: weatherData.temperature_2m[sliderIndex],
                rh: weatherData.relative_humidity_2m[sliderIndex],
                cc: surfaceCloudCover,
                spd: weatherData.wind_speed_10m[sliderIndex],
                dir: weatherData.wind_direction_10m[sliderIndex],
                dew: Utils.calculateDewpoint(weatherData.temperature_2m[sliderIndex], weatherData.relative_humidity_2m[sliderIndex])
            };
        } else {
            const pressure = Utils.interpolatePressure(heightASLInMeters, validPressureLevels, heightData);
            const windComponents = Utils.interpolateWindAtAltitude(heightASLInMeters, validPressureLevels, heightData, uComponents, vComponents);
            const spd = Utils.windSpeed(windComponents.u, windComponents.v);
            const dir = Utils.windDirection(windComponents.u, windComponents.v);
            const temp = Utils.linearInterpolate(heightData, tempData, heightASLInMeters);
            const rh = Utils.linearInterpolate(heightData, rhData, heightASLInMeters);
            const dew = Utils.calculateDewpoint(temp, rh);

            dataPoint = {
                height: heightASLInMeters,
                pressure: Number.isFinite(pressure) ? Number(pressure.toFixed(1)) : 'N/A',
                temp: Number.isFinite(temp) ? Number(temp.toFixed(1)) : 'N/A',
                rh: Number.isFinite(rh) ? Number(rh.toFixed(0)) : 'N/A',
                cc: Number.isFinite(cc) ? Number(cc.toFixed(0)) : 'N/A',
                spd: Number.isFinite(spd) ? Number(spd.toFixed(1)) : 'N/A',
                dir: Number.isFinite(dir) ? Number(dir.toFixed(0)) : 'N/A',
                dew: Number.isFinite(dew) ? Number(dew.toFixed(1)) : 'N/A'
            };
        }

        if (Number.isFinite(dataPoint.temp) && Number.isFinite(dataPoint.rh)) {
            const temp = dataPoint.temp;
            const rh = dataPoint.rh;
            let rhThreshold;

            const groundTemp = weatherData.temperature_2m[sliderIndex];

            // Bestimme das Stockwerk und den passenden Schwellenwert
            if (groundTemp <= 0) { // Sonderfall Kaltluft
                if (heightAGLInMeters <= 2000) {
                    rhThreshold = currentThresholds.low;
                } else if (temp > -30) {
                    rhThreshold = currentThresholds.mid;
                } else {
                    rhThreshold = currentThresholds.high;
                }
            } else { // Normalfall
                if (temp > 0) {
                    rhThreshold = currentThresholds.low;
                } else if (temp > -30) {
                    rhThreshold = currentThresholds.mid;
                } else {
                    rhThreshold = currentThresholds.high;
                }
            }

            // Finale Entscheidung: Wolke ja oder nein?
            if (rh < rhThreshold) {
                dataPoint.cc = 0; // Setze Bedeckung auf 0, wenn die Luft zu trocken ist.
            }
        }

        dataPoint.displayHeight = height;
        interpolatedData.push(dataPoint);
    });

    return interpolatedData;
}

// ===================================================================
// 2. Interne API-Kommunikation
// ===================================================================

/**
 * Stellt die eigentliche API-Anfrage an Open-Meteo, um die Roh-Wetterdaten abzurufen.
 * Erstellt die korrekte URL für entweder eine Vorhersage oder eine historische Anfrage,
 * basierend auf dem übergebenen Zeitstempel und dem ausgewählten Wettermodell.
 * @param {number} lat - Die geographische Breite.
 * @param {number} lon - Die geographische Länge.
 * @param {string|null} [currentTime=null] - Ein optionaler ISO-Zeitstempel.
 * @returns {Promise<object|null>} Das 'hourly' Objekt aus der API-Antwort oder null bei einem Fehler.
 * @private
 */
async function fetchWeather(lat, lon, currentTime = null, historicalDateOverride = null) {
    // Sende ein Event, damit die UI den Lade-Spinner anzeigen kann
    // Nachricht ist nun übersetzt
    document.dispatchEvent(new CustomEvent('loading:start', { detail: { message: I18n.t('common.fetching_weather') } }));

    try {
        const selectedModelValue = document.getElementById('modelSelect')?.value || Settings.defaultSettings.model;

        if (!selectedModelValue) {
            throw new Error(I18n.t('messages.no_model_selected'));
        }

        // Progtemp-Modell abfangen: Sounding-Daten statt Open-Meteo laden
        if (selectedModelValue === SOUNDING_MODEL_ID) {
            return await fetchSoundingData(lat, lon, currentTime);
        }

        // Bei regulären Modellen sicherstellen, dass keine Progtemp-Level aktiv sind
        AppState.customPressureLevels = null;

        const modelMap = WEATHER_MODELS.API_MAP;
        const modelApiIdentifierForMeta = modelMap[selectedModelValue] || selectedModelValue;

        let isHistorical = false;
        let startDateStr, endDateStr;
        const today = DateTime.utc().startOf('day');
        let targetDateForAPI = null;

        if (historicalDateOverride) {
            // Track-Fall: Für das Track-Datum werden immer historische Daten geladen – auch wenn der
            // Track vom selben Tag stammt. Die historical-forecast-API liefert für heute bereits den
            // vollen Tag (Analyse + Kurzfrist), daher ist das auch für taggleiche Sprünge korrekt.
            const overrideDate = DateTime.fromISO(historicalDateOverride, { zone: 'utc' }).startOf('day');
            if (overrideDate.isValid && overrideDate <= today) {
                isHistorical = true;
                targetDateForAPI = overrideDate;
            }
        } else if (currentTime) {
            let parsedTime = DateTime.fromISO(currentTime, { zone: 'utc' });
            if (parsedTime.isValid) {
                targetDateForAPI = parsedTime.startOf('day');
                if (targetDateForAPI < today) isHistorical = true;
            }
        } else {
            const pickerDate = document.getElementById('historicalDatePicker')?.value;
            if (pickerDate) {
                let parsedPickerDate = DateTime.fromISO(pickerDate, { zone: 'utc' }).startOf('day');
                if (parsedPickerDate < today) {
                    isHistorical = true;
                    targetDateForAPI = parsedPickerDate;
                }
            }
        }

        let baseUrl = API_URLS.FORECAST;
        if (isHistorical && targetDateForAPI) {
            baseUrl = API_URLS.HISTORICAL;
            startDateStr = endDateStr = targetDateForAPI.toFormat('yyyy-MM-dd');
            AppState.lastModelRun = I18n.t('messages.historical_data_label');
        } else {
            // Normale Forecast-Logik zur Bestimmung des Zeitfensters
            let runDate;
            try {
                const metaUrl = `https://api.open-meteo.com/data/${modelApiIdentifierForMeta}/static/meta.json`;
                const metaResponse = await fetch(metaUrl);
                const metaData = await metaResponse.json();
                runDate = new Date(metaData.last_run_initialisation_time * 1000);
                AppState.lastModelRun = runDate.toISOString().replace('T', ' ').substring(0, 16) + 'Z';
            } catch (e) {
                runDate = DateTime.utc().toJSDate();
                AppState.lastModelRun = "N/A";
            }
            let forecastStart = DateTime.fromJSDate(runDate).setZone('utc').plus({ hours: 6 });
            if (forecastStart > DateTime.utc()) forecastStart = DateTime.utc();
            startDateStr = forecastStart.toFormat('yyyy-MM-dd');

            // Geänderte Logik für das Enddatum
            const modelMaxDays = selectedModelValue.includes('_d2') ? 2 : 7;
            const userMaxForecast = Settings.getValue('maxForecastTime', 'Maximum');
            let forecastDays = modelMaxDays;

            if (userMaxForecast !== 'Maximum') {
                const userMaxDays = parseInt(userMaxForecast, 10);
                if (userMaxDays > modelMaxDays) {
                    Utils.handleMessage(I18n.t('messages.model_days_limit', { model: selectedModelValue, days: modelMaxDays }));
                }
                forecastDays = Math.min(modelMaxDays, userMaxDays);
            }

            endDateStr = forecastStart.plus({ days: forecastDays - 1 }).toFormat('yyyy-MM-dd');
        }

        const hourlyParams = "surface_pressure,temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,weather_code,cloud_cover_low,cloud_cover_mid,cloud_cover_high,temperature_1000hPa,relative_humidity_1000hPa,wind_speed_1000hPa,wind_direction_1000hPa,geopotential_height_1000hPa,cloud_cover_1000hPa,temperature_950hPa,relative_humidity_950hPa,wind_speed_950hPa,wind_direction_950hPa,geopotential_height_950hPa,cloud_cover_950hPa,temperature_925hPa,relative_humidity_925hPa,wind_speed_925hPa,wind_direction_925hPa,geopotential_height_925hPa,cloud_cover_925hPa,temperature_900hPa,relative_humidity_900hPa,wind_speed_900hPa,wind_direction_900hPa,geopotential_height_900hPa,cloud_cover_900hPa,temperature_850hPa,relative_humidity_850hPa,wind_speed_850hPa,wind_direction_850hPa,geopotential_height_850hPa,cloud_cover_850hPa,temperature_800hPa,relative_humidity_800hPa,wind_speed_800hPa,wind_direction_800hPa,geopotential_height_800hPa,cloud_cover_800hPa,temperature_700hPa,relative_humidity_700hPa,wind_speed_700hPa,wind_direction_700hPa,geopotential_height_700hPa,cloud_cover_700hPa,temperature_600hPa,relative_humidity_600hPa,wind_speed_600hPa,wind_direction_600hPa,geopotential_height_600hPa,cloud_cover_600hPa,temperature_500hPa,relative_humidity_500hPa,wind_speed_500hPa,wind_direction_500hPa,geopotential_height_500hPa,cloud_cover_500hPa,temperature_400hPa,relative_humidity_400hPa,wind_speed_400hPa,wind_direction_400hPa,geopotential_height_400hPa,cloud_cover_400hPa,temperature_300hPa,relative_humidity_300hPa,wind_speed_300hPa,wind_direction_300hPa,geopotential_height_300hPa,cloud_cover_300hPa,temperature_250hPa,relative_humidity_250hPa,wind_speed_250hPa,wind_direction_250hPa,geopotential_height_250hPa,cloud_cover_250hPa,temperature_200hPa,relative_humidity_200hPa,wind_speed_200hPa,wind_direction_200hPa,geopotential_height_200hPa,cloud_cover_200hPa";
        const url = `${baseUrl}?latitude=${lat}&longitude=${lon}&hourly=${hourlyParams}&models=${selectedModelValue}&start_date=${startDateStr}&end_date=${endDateStr}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) {
            if (response.status === 429) {
                throw new Error(I18n.t('messages.api_limit_reached'));
            }
            let errorDetail = '';
            try {
                const errData = await response.json();
                if (errData.reason) errorDetail = `: ${errData.reason}`;
            } catch {}
            throw new Error(I18n.t('messages.api_http_error', { status: response.status }) + errorDetail);
        }
        const data = await response.json();
        if (!data.hourly || !data.hourly.time || !data.hourly.time.length) throw new Error(I18n.t('messages.hourly_data_missing'));
        return data.hourly;

    } catch (error) {
        console.error("[fetchWeather] Error:", error);
        let userMessage;
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
            userMessage = I18n.t('messages.api_timeout');
        } else {
            userMessage = `${I18n.t('messages.weather_fetch_error')} (${error.message})`;
        }
        Utils.handleError(userMessage);
        return null;
    } finally {
        // Sende ein Event, damit die UI den Lade-Spinner ausblenden kann
        document.dispatchEvent(new CustomEvent('loading:stop'));
    }
}

/**
 * Überprüft dynamisch, welche der vordefinierten Wettermodelle für die gegebenen
 * Koordinaten verfügbar sind, indem es für jedes Modell eine Testanfrage sendet.
 * Aktualisiert anschließend die Benutzeroberfläche (die Modell-Auswahlliste).
 * @param {number} lat - Die geographische Breite.
 * @param {number} lon - Die geographische Länge.
 * @returns {Promise<string[]>} Ein Array mit den Namen der verfügbaren Modelle.
 */
async function checkAvailableModels(lat, lon) {
    const modelList = WEATHER_MODELS.LIST;
    let availableModels = [];
    for (const model of modelList) {
        try {
            const response = await fetch(`${API_URLS.FORECAST}?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&models=${model}`);
            if (response.ok) {
                const data = await response.json();
                if (data.hourly && data.hourly.temperature_2m && data.hourly.temperature_2m.some(t => t !== null)) {
                    availableModels.push(model);
                }
            } else {
                if (response.status === 429) {
                    // Spezifische Warnung für diesen Fall in der Konsole (bleibt meist englisch für Devs)
                    console.warn(`API-Limit beim Prüfen von Modell '${model}' erreicht.`);
                } else {
                    console.warn(`Modell '${model}' ist nicht verfügbar (Server-Antwort: ${response.status})`);
                }
            }
        } catch (e) {
            // Dieser Block wird nur noch bei reinen Netzwerkfehlern ausgeführt.
            console.error(`Netzwerkfehler beim Abruf von Modell '${model}':`, e);
        }
    }
    return availableModels;
}

/**
 * Überprüft die stündlichen Wetterdaten auf Überschreitungen der Alarm-Grenzwerte.
 * @param {object} weatherData - Das 'hourly' Objekt aus der API-Antwort.
 * @returns {{highWinds: number[], highGusts: number[], thunderstorms: number[], cloudAlerts: number[]}} Ein Objekt mit Arrays von Indizes, an denen die Grenzwerte überschritten wurden.
 */
export function checkWeatherAlerts(weatherData) {
    const windConfig = Settings.state.userSettings.alerts.wind;
    const gustConfig = Settings.state.userSettings.alerts.gust;
    const thunderstormConfig = Settings.state.userSettings.alerts.thunderstorm;
    const cloudsConfig = Settings.state.userSettings.alerts.clouds;

    // Detailliertes Logging der aktuellen Alert-Einstellungen
    console.log('[checkWeatherAlerts] Current Alert Settings:', { windConfig, gustConfig, thunderstormConfig, cloudsConfig });

    if (!weatherData || !weatherData.time) {
        console.log('[checkWeatherAlerts] No weather data or time array found.');
        return { highWinds: [], highGusts: [], thunderstorms: [], cloudAlerts: [] };
    }

    const highWinds = [], highGusts = [], thunderstorms = [], cloudAlerts = [];
    const categoryOrder = { 'FEW': 1, 'SCT': 2, 'BKN': 3, 'OVC': 4 };
    const alertCoverThreshold = categoryOrder[cloudsConfig.cover] || 3; // Fallback auf BKN

    // Hilfsfunktion
    const getMetarCategory = (cc) => {
        if (cc === null || cc === undefined || isNaN(cc)) return null;
        if (cc <= 5) return null;
        if (cc <= 25) return 'FEW';
        if (cc <= 50) return 'SCT';
        if (cc <= 87) return 'BKN';
        return 'OVC';
    };

    console.log(`[checkWeatherAlerts] Checking ${weatherData.time.length} time steps...`);

    for (let i = 0; i < weatherData.time.length; i++) {
        const timeStr = weatherData.time[i];
        const windSpeed_kmh = weatherData.wind_speed_10m[i];
        const gustSpeed_kmh = weatherData.wind_gusts_10m[i];
        const weatherCode = weatherData.weather_code[i];

        // --- Wind Alert Logging ---
        if (windConfig.enabled && windSpeed_kmh !== null && !isNaN(windSpeed_kmh)) {
            const windSpeed_kt = Utils.convertWind(windSpeed_kmh, 'kt', 'km/h');
            if (windSpeed_kt > windConfig.threshold) {
                highWinds.push(i);
                console.log(`[checkWeatherAlerts] Wind Alert triggered at index ${i} (${timeStr}): Speed ${windSpeed_kt.toFixed(1)} kt > Threshold ${windConfig.threshold} kt`);
            }
        }

        // --- Gust Alert Logging ---
        if (gustConfig.enabled && gustSpeed_kmh !== null && !isNaN(gustSpeed_kmh)) {
            const gustSpeed_kt = Utils.convertWind(gustSpeed_kmh, 'kt', 'km/h');
            if (gustSpeed_kt > gustConfig.threshold) {
                highGusts.push(i);
                console.log(`[checkWeatherAlerts] Gust Alert triggered at index ${i} (${timeStr}): Gust ${gustSpeed_kt.toFixed(1)} kt > Threshold ${gustConfig.threshold} kt`);
            }
        }

        // --- Thunderstorm Alert Logging ---
        if (thunderstormConfig.enabled && weatherCode !== null && !isNaN(weatherCode)) {
            if (THUNDERSTORM_CODES.includes(weatherCode)) {
                thunderstorms.push(i);
                console.log(`[checkWeatherAlerts] Thunderstorm Alert triggered at index ${i} (${timeStr}): Code ${weatherCode}`);
            }
        }

        // --- Cloud Alert Logging ---
        if (cloudsConfig.enabled) {
            // Hole interpolierte Daten NUR für diese Stunde, um Performance zu sparen
            const interpolatedHourData = interpolateWeatherData(weatherData, i, 500, Math.round(AppState.lastAltitude), 'm');
            let cloudAlertTriggeredForHour = false; // Flag für diese Stunde

            for (const point of interpolatedHourData) {
                const pointCategory = getMetarCategory(point.cc);
                if (!pointCategory) continue; // Überspringen, wenn keine signifikante Bewölkung

                const pointCoverLevel = categoryOrder[pointCategory];
                const pointBaseAGL = point.displayHeight; // Ist bereits AGL in Metern

                if (pointCoverLevel >= alertCoverThreshold && pointBaseAGL < cloudsConfig.base) {
                    if (!cloudAlertTriggeredForHour) { // Nur einmal pro Stunde loggen und pushen
                        cloudAlerts.push(i);
                        console.log(`[checkWeatherAlerts] Cloud Alert triggered at index ${i} (${timeStr}): Layer ${pointCategory} at ${pointBaseAGL}m < Threshold ${cloudsConfig.base}m (Min Cover: ${cloudsConfig.cover})`);
                        cloudAlertTriggeredForHour = true;
                    }
                    // Optional: break; // Wenn du nur den *ersten* auslösenden Layer pro Stunde sehen willst
                }
            }
        }
    }
    console.log('[checkWeatherAlerts] Finished check. Results:', { highWinds, highGusts, thunderstorms, cloudAlerts });
    return { highWinds, highGusts, thunderstorms, cloudAlerts };
}