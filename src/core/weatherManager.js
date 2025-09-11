/**
 * @file weatherManager.js
 * @description Dieses Modul ist verantwortlich für die gesamte Kommunikation mit der
 * Open-Meteo Wetter-API. Es ruft Wetterdaten ab, prüft die Verfügbarkeit von
 * Modellen und bereitet die Rohdaten durch Interpolation für die Anwendung auf.
 */

import { AppState } from './state.js';
import { Utils } from './utils.js';
import { Settings } from './settings.js';
import { WEATHER_MODELS, API_URLS, STANDARD_PRESSURE_LEVELS } from './constants.js';
import { DateTime } from 'luxon';

// ===================================================================
// 1. Öffentliche Hauptfunktionen (API des Moduls)
// ===================================================================

/**
 * Zentraler Einstiegspunkt zum Abrufen von Wetterdaten für einen Standort.
 * Orchestriert die Prüfung verfügbarer Modelle und den eigentlichen Datenabruf.
 * @param {number} lat - Die geographische Breite des Standorts.
 * @param {number} lng - Die geographische Länge des Standorts.
 * @param {string|null} [currentTime=null] - Ein optionaler ISO-Zeitstempel für historische Daten.
 * @returns {Promise<object|null>} Ein Promise, das zum 'hourly' Wetterdatenobjekt auflöst, oder null bei einem Fehler.
 */
export async function fetchWeatherForLocation(lat, lng, currentTime = null) {
    console.log('[weatherManager] Starting full weather fetch for location:', { lat, lng });

    // 1. Prüfen, welche Modelle verfügbar sind
    const availableModels = await checkAvailableModels(lat, lng);

    // 2. Ein Event auslösen, damit die UI sich aktualisieren kann
    document.dispatchEvent(new CustomEvent('models:available', {
        detail: { availableModels }
    }));

    // 3. Die eigentlichen Wetterdaten für das aktuell ausgewählte Modell abrufen
    const weatherData = await fetchWeather(lat, lng, currentTime);
    return weatherData;
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

    const allPressureLevels = STANDARD_PRESSURE_LEVELS;

    // Filtere Drucklevel nur, wenn ALLE benötigten Daten für diesen Level vorhanden sind.
    const validPressureLevels = allPressureLevels.filter(hPa => {
        const height = weatherData[`geopotential_height_${hPa}hPa`]?.[sliderIndex];
        const temp = weatherData[`temperature_${hPa}hPa`]?.[sliderIndex];
        const rh = weatherData[`relative_humidity_${hPa}hPa`]?.[sliderIndex];
        const speed = weatherData[`wind_speed_${hPa}hPa`]?.[sliderIndex];
        const dir = weatherData[`wind_direction_${hPa}hPa`]?.[sliderIndex];
        
        // Prüfe, ob alle Werte nicht null oder undefined sind.
        return [height, temp, rh, speed, dir].every(val => val != null);
    });


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
    if (surfacePressure > lowestPressureLevel && Number.isFinite(hLowest) && hLowest > baseHeight) {
        const stepsBetween = Math.floor((hLowest - baseHeight) / interpStep);

        const uSurface = -weatherData.wind_speed_10m[sliderIndex] * Math.sin(weatherData.wind_direction_10m[sliderIndex] * Math.PI / 180);
        const vSurface = -weatherData.wind_speed_10m[sliderIndex] * Math.cos(weatherData.wind_direction_10m[sliderIndex] * Math.PI / 180);
        const uLowest = uComponents[validPressureLevels.indexOf(lowestPressureLevel)];
        const vLowest = vComponents[validPressureLevels.indexOf(lowestPressureLevel)];

        for (let i = stepsBetween - 1; i >= 1; i--) {
            const h = baseHeight + i * interpStep;
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
        console.warn('Invalid max height at lowest pressure level:', { maxHeightASL, baseHeight, minPressure: validPressureLevels[minPressureIndex] });
        return [];
    }

    const maxHeightInUnit = heightUnit === 'ft' ? maxHeightAGL * 3.28084 : maxHeightAGL;
    const steps = Math.floor(maxHeightInUnit / interpStep);
    const heightsInUnit = Array.from({ length: steps + 1 }, (_, i) => i * interpStep);

    const interpolatedData = [];
    heightsInUnit.forEach(height => {
        const heightAGLInMeters = heightUnit === 'ft' ? height / 3.28084 : height;
        const heightASLInMeters = baseHeight + heightAGLInMeters;

        let dataPoint;
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
            const cc = Utils.linearInterpolate(heightData, ccData, heightASLInMeters);
            const dew = Utils.calculateDewpoint(temp, rh);

            dataPoint = {
                height: heightASLInMeters,
                pressure: pressure === 'N/A' ? 'N/A' : Number(pressure.toFixed(1)),
                temp: Number(temp.toFixed(1)),
                rh: Number(rh.toFixed(0)),
                cc: Number(cc.toFixed(0)),
                spd: Number(spd.toFixed(1)),
                dir: Number(dir.toFixed(0)),
                dew: Number(dew.toFixed(1))
            };
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
async function fetchWeather(lat, lon, currentTime = null) {
    // Sende ein Event, damit die UI den Lade-Spinner anzeigen kann
    document.dispatchEvent(new CustomEvent('loading:start', { detail: { message: 'Fetching Weather...' } }));

    try {
        const selectedModelValue = document.getElementById('modelSelect')?.value || Settings.defaultSettings.model;
        if (!selectedModelValue) throw new Error("No weather model selected.");

        const modelMap = WEATHER_MODELS.API_MAP;
        const modelApiIdentifierForMeta = modelMap[selectedModelValue] || selectedModelValue;

        let isHistorical = false;
        let startDateStr, endDateStr;
        const today = DateTime.utc().startOf('day');
        let targetDateForAPI = null;

        if (currentTime) {
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
            AppState.lastModelRun = "N/A (Historical Data)";
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
            const forecastDays = selectedModelValue.includes('_d2') ? 2 : 7;
            endDateStr = forecastStart.plus({ days: forecastDays }).toFormat('yyyy-MM-dd');
        }

        const hourlyParams = "surface_pressure,temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_1000hPa,relative_humidity_1000hPa,wind_speed_1000hPa,wind_direction_1000hPa,geopotential_height_1000hPa,cloud_cover_1000hPa,temperature_950hPa,relative_humidity_950hPa,wind_speed_950hPa,wind_direction_950hPa,geopotential_height_950hPa,cloud_cover_950hPa,temperature_925hPa,relative_humidity_925hPa,wind_speed_925hPa,wind_direction_925hPa,geopotential_height_925hPa,cloud_cover_925hPa,temperature_900hPa,relative_humidity_900hPa,wind_speed_900hPa,wind_direction_900hPa,geopotential_height_900hPa,cloud_cover_900hPa,temperature_850hPa,relative_humidity_850hPa,wind_speed_850hPa,wind_direction_850hPa,geopotential_height_850hPa,cloud_cover_850hPa,temperature_800hPa,relative_humidity_800hPa,wind_speed_800hPa,wind_direction_800hPa,geopotential_height_800hPa,cloud_cover_800hPa,temperature_700hPa,relative_humidity_700hPa,wind_speed_700hPa,wind_direction_700hPa,geopotential_height_700hPa,cloud_cover_700hPa,temperature_600hPa,relative_humidity_600hPa,wind_speed_600hPa,wind_direction_600hPa,geopotential_height_600hPa,cloud_cover_600hPa,temperature_500hPa,relative_humidity_500hPa,wind_speed_500hPa,wind_direction_500hPa,geopotential_height_500hPa,cloud_cover_500hPa,temperature_400hPa,relative_humidity_400hPa,wind_speed_400hPa,wind_direction_400hPa,geopotential_height_400hPa,cloud_cover_400hPa,temperature_300hPa,relative_humidity_300hPa,wind_speed_300hPa,wind_direction_300hPa,geopotential_height_300hPa,cloud_cover_300hPa,temperature_250hPa,relative_humidity_250hPa,wind_speed_250hPa,wind_direction_250hPa,geopotential_height_250hPa,cloud_cover_250hPa,temperature_200hPa,relative_humidity_200hPa,wind_speed_200hPa,wind_direction_200hPa,geopotential_height_200hPa,cloud_cover_200hPa";
        const url = `${baseUrl}?latitude=${lat}&longitude=${lon}&hourly=${hourlyParams}&models=${selectedModelValue}&start_date=${startDateStr}&end_date=${endDateStr}`;
        const response = await fetch(url);
        if (!response.ok) {
            // NEU: Spezifische Fehlermeldung für Rate-Limiting
            if (response.status === 429) {
                throw new Error("API-Limit reached. Please wait a moment and retry again.");
            }
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const data = await response.json();
        if (!data.hourly || !data.hourly.time || !data.hourly.time.length) throw new Error('No hourly data in API response.');
        return data.hourly;

    } catch (error) {
        console.error("[fetchWeather] Error:", error);
        Utils.handleError(`Failed to fetch weather: ${error.message}`); // KORRIGIERTE ZEILE
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
                    // Spezifische Warnung für diesen Fall in der Konsole
                    console.warn(`API-Limit beim Prüfen von Modell '${model}' erreicht.`);
                    // Optional: Man könnte hier eine einmalige Nachricht an den Benutzer senden.
                } else {
                    console.warn(`Modell '${model}' ist nicht verfügbar (Server-Antwort: ${response.status})`);
                }
            }
        } catch (e) {
            // Dieser Block wird nur noch bei reinen Netzwerkfehlern ausgeführt.
            console.error(`Netzwerkfehler beim Abruf von Modell '${model}':`, e);
        }
    }
    /*updateModelSelectUI(availableModels);
    updateEnsembleModelUI(availableModels);
    cleanupSelectedEnsembleModels(availableModels);*/
    return availableModels;
}

// HINWEIS: Diese Funktion gibt es in ähnlicher Weise auch in utils.js. Überprüfen, ob diese hir entfernt werden kann!
export const debouncedGetElevationAndQFE = Utils.debounce(async (lat, lng) => {
    try {
        const data = await Utils.getElevationAndQFE(lat, lng, AppState.apiKey);
        if (data) {
            const elevationInput = document.getElementById('elevation');
            const qfeInput = document.getElementById('qfe');

            if (elevationInput) {
                elevationInput.value = data.elevation.toFixed(1);
            }
            if (qfeInput) {
                qfeInput.value = data.qfe.toFixed(2);
            }

            AppState.currentElevation = data.elevation;
            Settings.state.userSettings.qfe = data.qfe;
        }
    } catch (error) {
        console.error('Error fetching elevation and QFE:', error);
    }
}, 500);
