// == Project: Skydiving Weather and Jump Planner ==
// == Constants and Global Variables ==
import { AppState } from './state.js';
import { Utils } from './utils.js';
import { Settings } from './settings.js';
import { Constants, FEATURE_PASSWORD } from './constants.js';
import * as EventManager from './eventManager.js'; // NEUER IMPORT
import { displayMessage, displayProgress, displayError, hideProgress, updateOfflineIndicator, isMobileDevice } from './ui.js';
import { TileCache, cacheTilesForDIP, debouncedCacheVisibleTiles } from './tileCache.js';
import { setupCacheManagement, setupCacheSettings } from './cacheUI.js';
import * as Coordinates from './coordinates.js';
import { initializeLocationSearch } from './coordinates.js'; // <-- HIER ERGÄNZEN
import { interpolateColor, generateWindBarb } from "./uiHelpers.js";
import { handleHarpPlacement, createHarpMarker, clearHarpMarker } from './harpMarker.js';
import { loadGpxTrack, loadCsvTrackUTC } from './trackManager.js';
import * as JumpPlanner from './jumpPlanner.js';
import * as mapManager from './mapManager.js';
import * as weatherManager from './weatherManager.js';
import * as EnsembleManager from './ensembleManager.js';
import { getSliderValue} from './ui.js';

"use strict";

export const debouncedCalculateJump = Utils.debounce(calculateJump, 300);
export const getDownloadFormat = () => Settings.getValue('downloadFormat', 'radio', 'csv');

// == Tile caching ==
Utils.handleMessage = displayMessage;

// == Map Initialization and Interaction ==
L.Control.Coordinates = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function (map) {
        var container = L.DomUtil.create('div', 'leaflet-control-coordinates');
        container.style.background = 'rgba(255, 255, 255, 0.8)';
        container.style.padding = '5px';
        container.style.borderRadius = '4px';
        container.style.boxShadow = '0 2px 5px rgba(0, 0, 0, 0.2)';
        container.innerHTML = 'Move mouse over map';
        this._container = container;
        return container;
    },
    update: function (content) {
        this._container.innerHTML = content;
    }
});
let elevationCache = new Map();
let qfeCache = new Map();
let lastTapTime = 0;
export const debouncedGetElevationAndQFE = Utils.debounce(async (lat, lng, requestLatLng, callback) => {
    const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    const sliderIndex = getSliderValue(); // getSliderValue muss hier zugreifbar sein
    const weatherCacheKey = `${cacheKey}-${sliderIndex}`;
    let elevation, qfe;

    if (elevationCache.has(cacheKey)) {
        elevation = elevationCache.get(cacheKey);
    } else {
        try {
            elevation = await Utils.getAltitude(lat, lng);
            elevationCache.set(cacheKey, elevation);
        } catch (error) {
            console.warn('Failed to fetch elevation:', error);
            elevation = 'N/A';
        }
    }

    if (qfeCache.has(weatherCacheKey)) {
        qfe = qfeCache.get(weatherCacheKey);
    } else {
        if (AppState.weatherData && AppState.weatherData.surface_pressure && sliderIndex >= 0 && sliderIndex < AppState.weatherData.surface_pressure.length) {
            const surfacePressure = AppState.weatherData.surface_pressure[sliderIndex];
            const temperature = AppState.weatherData.temperature_2m?.[sliderIndex] || 16.1;
            const referenceElevation = AppState.lastAltitude !== 'N/A' ? AppState.lastAltitude : 339;
            qfe = Utils.calculateQFE(surfacePressure, elevation, referenceElevation, temperature);
            qfeCache.set(weatherCacheKey, qfe);
            console.log('Calculated QFE:', { lat, lng, surfacePressure, elevation, referenceElevation, temperature, qfe });
        } else {
            console.warn('Surface pressure not available for QFE:', {
                hasWeatherData: !!AppState.weatherData,
                hasSurfacePressure: !!AppState.weatherData?.surface_pressure,
                sliderIndexValid: sliderIndex >= 0 && sliderIndex < (AppState.weatherData?.surface_pressure?.length || 0)
            });
            qfe = 'N/A';
        }
    }
    callback({ elevation, qfe }, requestLatLng);
}, 500);

// == Marker and popup functions ==
export async function refreshMarkerPopup() {
    if (!AppState.currentMarker || AppState.lastLat === null) {
        return;
    }

    const lat = AppState.lastLat;
    const lng = AppState.lastLng;
    const altitude = AppState.lastAltitude;
    const coordFormat = Settings.getValue('coordFormat', 'radio', 'Decimal');
    const sliderIndex = getSliderValue();

    const coords = Utils.convertCoords(lat, lng, coordFormat);

    let popupContent;
    if (coordFormat === 'MGRS') {
        popupContent = `MGRS: ${coords.lat}<br>Alt: ${altitude} m`;
    } else {
        const formatDMS = (dms) => `${dms.deg}°${dms.min}'${dms.sec.toFixed(0)}" ${dms.dir}`;
        if (coordFormat === 'DMS') {
            popupContent = `Lat: ${formatDMS(Utils.decimalToDms(lat, true))}<br>Lng: ${formatDMS(Utils.decimalToDms(lng, false))}<br>Alt: ${altitude} m`;
        } else {
            popupContent = `Lat: ${lat.toFixed(5)}<br>Lng: ${lng.toFixed(5)}<br>Alt: ${altitude} m`;
        }
    }

    if (AppState.weatherData && AppState.weatherData.surface_pressure) {
        const surfacePressure = AppState.weatherData.surface_pressure[sliderIndex];
        if (surfacePressure) {
            popupContent += ` QFE: ${surfacePressure.toFixed(0)} hPa`;
        } else {
            popupContent += ` QFE: N/A`;
        }
    } else {
        popupContent += ` QFE: N/A`;
    }

    mapManager.updatePopupContent(AppState.currentMarker, popupContent);
}

// == Weather Data Handling ==
export async function updateWeatherDisplay(index, originalTime = null) {
    console.log(`updateWeatherDisplay called with index: ${index}, Time: ${AppState.weatherData.time[index]}`);
    if (!AppState.weatherData || !AppState.weatherData.time || index < 0 || index >= AppState.weatherData.time.length) {
        console.error('No weather data available or index out of bounds:', index);
        document.getElementById('info').innerHTML = 'No weather data available';
        document.getElementById('selectedTime').innerHTML = 'Selected Time: ';
        const slider = document.getElementById('timeSlider');
        if (slider) slider.value = 0;
        return;
    }

    AppState.landingWindDir = AppState.weatherData.wind_direction_10m[index] || null;
    console.log('landingWindDir updated to:', AppState.landingWindDir);

    const customLandingDirectionLLInput = document.getElementById('customLandingDirectionLL');
    const customLandingDirectionRRInput = document.getElementById('customLandingDirectionRR');
    if (customLandingDirectionLLInput && customLandingDirectionRRInput && AppState.landingWindDir !== null) {
        customLandingDirectionLLInput.value = Math.round(AppState.landingWindDir);
        customLandingDirectionRRInput.value = Math.round(AppState.landingWindDir);
    }

    const refLevel = document.querySelector('input[name="refLevel"]:checked')?.value || 'AGL';
    const heightUnit = Settings.getValue('heightUnit', 'radio', 'm');
    const windSpeedUnit = Settings.getValue('windUnit', 'radio', 'kt');
    const temperatureUnit = Settings.getValue('temperatureUnit', 'radio', 'C');
    // Pass lat and lng to getDisplayTime
    const time = await Utils.getDisplayTime(AppState.weatherData.time[index], AppState.lastLat, AppState.lastLng);
    const interpolatedData = weatherManager.interpolateWeatherData(index);
    const surfaceHeight = refLevel === 'AMSL' && AppState.lastAltitude !== 'N/A' ? Math.round(AppState.lastAltitude) : 0;

    if (!Settings.state.userSettings.showTable) {
        document.getElementById('info').innerHTML = '';
        document.getElementById('selectedTime').innerHTML = `Selected Time: ${time}`;
        return;
    }

    let output = `<table id="weatherTable">`;
    output += `<tr><th>Height (${heightUnit} ${refLevel})</th><th>Dir (deg)</th><th>Spd (${windSpeedUnit})</th><th>Wind</th><th>T (${temperatureUnit === 'C' ? '°C' : '°F'})</th></tr>`;
    interpolatedData.forEach((data, idx) => {
        const spd = parseFloat(data.spd);
        let windClass = '';
        if (windSpeedUnit === 'bft') {
            const spdInKt = Utils.convertWind(spd, 'kt', 'km/h');
            const bft = Utils.knotsToBeaufort(spdInKt);
            if (bft <= 1) windClass = 'wind-low';
            else if (bft <= 3) windClass = 'wind-moderate';
            else if (bft <= 4) windClass = 'wind-high';
            else windClass = 'wind-very-high';
        } else {
            const spdInKt = Utils.convertWind(spd, 'kt', 'km/h');
            if (spdInKt <= 3) windClass = 'wind-low';
            else if (spdInKt <= 10) windClass = 'wind-moderate';
            else if (spdInKt <= 16) windClass = 'wind-high';
            else windClass = 'wind-very-high';
        }

        // Apply conditional background color based on RH
        const humidity = data.rh;
        let humidityClass = '';
        if (humidity !== 'N/A' && Number.isFinite(humidity)) {
            if (humidity < 65) {
                humidityClass = 'humidity-low';
            } else if (humidity >= 65 && humidity <= 85) {
                humidityClass = 'humidity-moderate';
            } else if (humidity > 85 && humidity < 100) {
                humidityClass = 'humidity-high';
            } else if (humidity === 100) {
                humidityClass = 'humidity-saturated';
            }
        }
        console.log(`Row ${idx}: RH=${humidity}, windClass=${windClass}, humidityClass=${humidityClass}`);

        const displayHeight = refLevel === 'AMSL' ? data.displayHeight + (heightUnit === 'ft' ? Math.round(surfaceHeight * 3.28084) : surfaceHeight) : data.displayHeight;
        const displayTemp = Utils.convertTemperature(data.temp, temperatureUnit === 'C' ? '°C' : '°F');
        const formattedTemp = displayTemp === 'N/A' ? 'N/A' : displayTemp.toFixed(0);

        const convertedSpd = Utils.convertWind(spd, windSpeedUnit, 'km/h');
        let formattedWind;
        const surfaceDisplayHeight = refLevel === 'AMSL' ? (heightUnit === 'ft' ? Math.round(surfaceHeight * 3.28084) : surfaceHeight) : 0;
        if (Math.round(displayHeight) === surfaceDisplayHeight && AppState.weatherData.wind_gusts_10m[index] !== undefined && Number.isFinite(AppState.weatherData.wind_gusts_10m[index])) {
            const gustSpd = AppState.weatherData.wind_gusts_10m[index];
            const convertedGust = Utils.convertWind(gustSpd, windSpeedUnit, 'km/h');
            const spdValue = windSpeedUnit === 'bft' ? Math.round(convertedSpd) : convertedSpd.toFixed(0);
            const gustValue = windSpeedUnit === 'bft' ? Math.round(convertedGust) : convertedGust.toFixed(0);
            formattedWind = `${spdValue} G ${gustValue}`;
        } else {
            formattedWind = convertedSpd === 'N/A' ? 'N/A' : (windSpeedUnit === 'bft' ? Math.round(convertedSpd) : convertedSpd.toFixed(0));
        }

        const speedKt = Math.round(Utils.convertWind(spd, 'kt', 'km/h') / 5) * 5;
        const windBarbSvg = data.dir === 'N/A' || isNaN(speedKt) ? 'N/A' : generateWindBarb(data.dir, speedKt);

        output += `<tr class="${windClass} ${humidityClass}">
            <td>${Math.round(displayHeight)}</td>
            <td>${Utils.roundToTens(data.dir)}</td>
            <td>${formattedWind}</td>
            <td>${windBarbSvg}</td>
            <td>${formattedTemp}</td>
        </tr>`;
    });
    output += `</table>`;
    document.getElementById('info').innerHTML = output;
    document.getElementById('selectedTime').innerHTML = `Selected Time: ${time}`;
    updateLandingPatternDisplay();
}
export function calculateMeanWind() {
    console.log('Calculating mean wind with model:', document.getElementById('modelSelect').value, 'weatherData:', AppState.weatherData);
    const index = document.getElementById('timeSlider').value || 0;
    const interpolatedData = weatherManager.interpolateWeatherData(index);
    let lowerLimitInput = parseFloat(document.getElementById('lowerLimit').value) || 0;
    let upperLimitInput = parseFloat(document.getElementById('upperLimit').value);
    const refLevel = document.querySelector('input[name="refLevel"]:checked')?.value || 'AGL';
    const heightUnit = Settings.getValue('heightUnit', 'radio', 'm');
    const windSpeedUnit = Settings.getValue('windUnit', 'radio', 'kt');
    const baseHeight = Math.round(AppState.lastAltitude);

    if (!AppState.weatherData || AppState.lastAltitude === 'N/A') {
        handleError('Cannot calculate mean wind: missing data or altitude');
        return;
    }

    // Convert inputs to meters
    lowerLimitInput = heightUnit === 'ft' ? lowerLimitInput / 3.28084 : lowerLimitInput;
    upperLimitInput = heightUnit === 'ft' ? upperLimitInput / 3.28084 : upperLimitInput;

    if ((refLevel === 'AMSL') && lowerLimitInput < baseHeight) {
        Utils.handleError(`Lower limit adjusted to terrain altitude (${baseHeight} m ${refLevel}) as it cannot be below ground level in ${refLevel} mode.`);
        lowerLimitInput = baseHeight;
        document.getElementById('lowerLimit').value = Utils.convertHeight(lowerLimitInput, heightUnit);
    }

    const lowerLimit = refLevel === 'AGL' ? lowerLimitInput + baseHeight : lowerLimitInput;
    const upperLimit = refLevel === 'AGL' ? upperLimitInput + baseHeight : upperLimitInput;

    if (isNaN(lowerLimitInput) || isNaN(upperLimitInput) || lowerLimitInput >= upperLimitInput) {
        Utils.handleError('Invalid layer limits. Ensure Lower < Upper and both are numbers.');
        return;
    }

    // Check if interpolatedData is valid
    if (!interpolatedData || interpolatedData.length === 0) {
        Utils.handleError('No valid weather data available to calculate mean wind.');
        return;
    }

    // Use raw heights and speeds in knots
    const heights = interpolatedData.map(d => d.height);
    const dirs = interpolatedData.map(d => parseFloat(d.dir) || 0);
    const spds = interpolatedData.map(d => Utils.convertWind(parseFloat(d.spd) || 0, windSpeedUnit, 'km/h')); // Fixed order

    const xKomponente = spds.map((spd, i) => -spd * Math.sin(dirs[i] * Math.PI / 180));
    const yKomponente = spds.map((spd, i) => -spd * Math.cos(dirs[i] * Math.PI / 180));

    const meanWind = Utils.calculateMeanWind(heights, xKomponente, yKomponente, lowerLimit, upperLimit);
    const [dir, spd] = meanWind;

    const roundedDir = Utils.roundToTens(dir) === 0 && dir >= 0 && dir < 5 ? 360 : Utils.roundToTens(dir);
    const displayLower = Math.round(Utils.convertHeight(lowerLimitInput, heightUnit));
    const displayUpper = Math.round(Utils.convertHeight(upperLimitInput, heightUnit));
    const displaySpd = Utils.convertWind(spd, windSpeedUnit, 'kt');
    const formattedSpd = Number.isFinite(spd) ? (windSpeedUnit === 'bft' ? Math.round(spd) : spd.toFixed(1)) : 'N/A';
    const result = `Mean wind (${displayLower}-${displayUpper} ${heightUnit} ${refLevel}): ${roundedDir}° ${formattedSpd} ${windSpeedUnit}`;
    document.getElementById('meanWindResult').innerHTML = result;
    console.log('Calculated Mean Wind:', result, 'u:', meanWind[2], 'v:', meanWind[3]);
}
export function downloadTableAsAscii(format) {
    if (!AppState.weatherData || !AppState.weatherData.time) {
        Utils.handleError('No weather data available to download.');
        return;
    }

    const index = document.getElementById('timeSlider').value || 0;
    const model = document.getElementById('modelSelect').value.toUpperCase();
    const time = Utils.formatTime(AppState.weatherData.time[index]).replace(' ', '_');
    const filename = `${time}_${model}_${format}.txt`;

    // Define format-specific required settings
    const formatRequirements = {
        'ATAK': {
            interpStep: 1000,
            heightUnit: 'ft',
            refLevel: 'AGL',
            windUnit: 'kt'
        },
        'Windwatch': {
            interpStep: 100,
            heightUnit: 'ft',
            refLevel: 'AGL',
            windUnit: 'km/h'
        },
        'HEIDIS': {
            interpStep: 100,
            heightUnit: 'm',
            refLevel: 'AGL',
            temperatureUnit: 'C',
            windUnit: 'm/s'
        },
        'Customized': {} // No strict requirements, use current settings
    };

    // Store original settings
    const originalSettings = {
        interpStep: getInterpolationStep(),
        heightUnit: Settings.getValue('heightUnit', 'radio', 'm'),
        refLevel: document.querySelector('input[name="refLevel"]:checked')?.value || 'AGL',
        windUnit: Settings.getValue('windUnit', 'radio', 'kt'),
        temperatureUnit: Settings.getValue('temperatureUnit', 'radio', 'C')
    };

    // Get current settings
    let currentSettings = { ...originalSettings };

    // Check and adjust settings if format has specific requirements
    const requiredSettings = formatRequirements[format];
    if (requiredSettings && Object.keys(requiredSettings).length > 0) {
        let settingsAdjusted = false;

        // Check each required setting and adjust if necessary
        for (const [key, requiredValue] of Object.entries(requiredSettings)) {
            if (currentSettings[key] !== requiredValue) {
                settingsAdjusted = true;
                switch (key) {
                    case 'interpStep':
                        document.getElementById('interpStepSelect').value = requiredValue;
                        Settings.state.userSettings.interpStep = requiredValue;
                        break;
                    case 'heightUnit':
                        document.querySelector(`input[name="heightUnit"][value="${requiredValue}"]`).checked = true;
                        Settings.state.userSettings.heightUnit = requiredValue;
                        break;
                    case 'refLevel':
                        document.querySelector(`input[name="refLevel"][value="${requiredValue}"]`).checked = true;
                        Settings.state.userSettings.refLevel = requiredValue;
                        break;
                    case 'windUnit':
                        document.querySelector(`input[name="windUnit"][value="${requiredValue}"]`).checked = true;
                        Settings.state.userSettings.windUnit = requiredValue;
                        break;
                    case 'temperatureUnit':
                        document.querySelector(`input[name="temperatureUnit"][value="${requiredValue}"]`).checked = true;
                        Settings.state.userSettings.temperatureUnit = requiredValue;
                        break;
                }
                currentSettings[key] = requiredValue;
            }
        }

        if (settingsAdjusted) {
            Settings.save();
            console.log(`Adjusted settings for ${format} compatibility:`, requiredSettings);
            Settings.updateUnitLabels(); // Update UI labels if heightUnit changes
            Settings.updateUnitLabels();   // Update UI labels if windUnit changes
            Settings.updateUnitLabels();
            // Update UI labels if refLevel changes
        }
    }

    // Prepare content based on format
    let content = '';
    let separator = ' '; // Default separator "space"
    const heightUnit = Settings.getValue('heightUnit', 'radio', 'm');
    const temperatureUnit = Settings.getValue('temperatureUnit', 'radio', 'C');
    const windSpeedUnit = Settings.getValue('windUnit', 'radio', 'kt');
    const refLevel = document.querySelector('input[name="refLevel"]:checked')?.value || 'AGL';

    if (format === 'ATAK') {
        content = `Alt Dir Spd\n${heightUnit}${refLevel}\n`;
    } else if (format === 'Windwatch') {
        const elevation = heightUnit === 'ft' ? Math.round(AppState.lastAltitude * 3.28084) : Math.round(AppState.lastAltitude);
        content = `Version 1.0, ID = 9999999999\n${time}, Ground Level: ${elevation} ft\nWindsond ${model}\n AGL[ft] Wind[°] Speed[km/h]\n`;
    } else if (format === 'HEIDIS') {
        const heightHeader = refLevel === 'AGL' ? `h(${heightUnit}AGL)` : `h(${heightUnit}AMSL)`;
        const temperatureHeader = temperatureUnit === 'C' ? '°C' : '°F';
        const windSpeedHeader = windSpeedUnit;
        content = `${heightHeader} p(hPa) T(${temperatureHeader}) Dew(${temperatureHeader}) Dir(°) Spd(${windSpeedHeader}) RH(%)`;
    } else if (format === 'Customized') {
        const heightHeader = refLevel === 'AGL' ? `h(${heightUnit}AGL)` : `h(${heightUnit}AMSL)`;
        const temperatureHeader = temperatureUnit === 'C' ? '°C' : '°F';
        const windSpeedHeader = windSpeedUnit;
        content = `${heightHeader} p(hPa) T(${temperatureHeader}) Dew(${temperatureHeader}) Dir(°) Spd(${windSpeedHeader}) RH(%)`;
    }

    // Generate surface data with fetched surface_pressure
    const baseHeight = Math.round(AppState.lastAltitude);
    const surfaceHeight = refLevel === 'AGL' ? 0 : baseHeight;
    const surfaceTemp = AppState.weatherData.temperature_2m?.[index];
    const surfaceRH = AppState.weatherData.relative_humidity_2m?.[index];
    const surfaceSpd = AppState.weatherData.wind_speed_10m?.[index];
    const surfaceDir = AppState.weatherData.wind_direction_10m?.[index];
    const surfaceDew = Utils.calculateDewpoint(surfaceTemp, surfaceRH);
    const surfacePressure = AppState.weatherData.surface_pressure[index]; // Use fetched surface pressure directly

    const displaySurfaceHeight = Math.round(Utils.convertHeight(surfaceHeight, heightUnit));
    const displaySurfaceTemp = Utils.convertTemperature(surfaceTemp, temperatureUnit);
    const displaySurfaceDew = Utils.convertTemperature(surfaceDew, temperatureUnit);
    const displaySurfaceSpd = Utils.convertWind(surfaceSpd, windSpeedUnit, 'km/h');
    const formattedSurfaceTemp = displaySurfaceTemp === 'N/A' ? 'N/A' : displaySurfaceTemp.toFixed(1);
    const formattedSurfaceDew = displaySurfaceDew === 'N/A' ? 'N/A' : displaySurfaceDew.toFixed(1);
    const formattedSurfaceSpd = displaySurfaceSpd === 'N/A' ? 'N/A' : (windSpeedUnit === 'bft' ? Math.round(displaySurfaceSpd) : displaySurfaceSpd.toFixed(1));
    const formattedSurfaceDir = surfaceDir === 'N/A' || surfaceDir === undefined ? 'N/A' : Math.round(surfaceDir);
    const formattedSurfaceRH = surfaceRH === 'N/A' || surfaceRH === undefined ? 'N/A' : Math.round(surfaceRH);

    if (format === 'ATAK') {
        content += `${displaySurfaceHeight}${separator}${formattedSurfaceDir}${separator}${formattedSurfaceSpd}\n`;
    } else if (format === 'Windwatch') {
        content += `${displaySurfaceHeight}${separator}${formattedSurfaceDir}${separator}${formattedSurfaceSpd}\n`;
    } else if (format === 'HEIDIS') {
        content += `\n${displaySurfaceHeight}${separator}${surfacePressure === 'N/A' ? 'N/A' : surfacePressure.toFixed(1)}${separator}${formattedSurfaceTemp}${separator}${formattedSurfaceDew}${separator}${formattedSurfaceDir}${separator}${formattedSurfaceSpd}${separator}${formattedSurfaceRH}\n`;
    } else if (format === 'Customized') {
        content += `\n${displaySurfaceHeight}${separator}${surfacePressure === 'N/A' ? 'N/A' : surfacePressure.toFixed(1)}${separator}${formattedSurfaceTemp}${separator}${formattedSurfaceDew}${separator}${formattedSurfaceDir}${separator}${formattedSurfaceSpd}${separator}${formattedSurfaceRH}\n`;
    }

    // Generate interpolated data
    const interpolatedData = weatherManager.interpolateWeatherData(index);
    if (!interpolatedData || interpolatedData.length === 0) {
        Utils.handleError('No interpolated data available to download.');
        return;
    }

    interpolatedData.forEach(data => {
        if (data.displayHeight !== surfaceHeight) {
            const displayHeight = Math.round(Utils.convertHeight(data.displayHeight, heightUnit));
            const displayPressure = data.pressure === 'N/A' ? 'N/A' : data.pressure.toFixed(1);
            const displayTemperature = Utils.convertTemperature(data.temp, temperatureUnit);
            const displayDew = Utils.convertTemperature(data.dew, temperatureUnit);
            const displaySpd = Utils.convertWind(data.spd, windSpeedUnit, Settings.getValue('windUnit', 'radio', 'kt')); // Use current windUnit
            const formattedTemp = displayTemperature === 'N/A' ? 'N/A' : displayTemperature.toFixed(1);
            const formattedDew = displayDew === 'N/A' ? 'N/A' : displayDew.toFixed(1);
            const formattedSpd = displaySpd === 'N/A' ? 'N/A' : (windSpeedUnit === 'bft' ? Math.round(displaySpd) : displaySpd.toFixed(1));
            const formattedDir = data.dir === 'N/A' ? 'N/A' : Math.round(data.dir);
            const formattedRH = data.rh === 'N/A' ? 'N/A' : Math.round(data.rh);

            if (format === 'ATAK') {
                content += `${displayHeight}${separator}${formattedDir}${separator}${formattedSpd}\n`;
            } else if (format === 'Windwatch') {
                content += `${displayHeight}${separator}${formattedDir}${separator}${formattedSpd}\n`;
            } else if (format === 'HEIDIS') {
                content += `${displayHeight}${separator}${displayPressure}${separator}${formattedTemp}${separator}${formattedDew}${separator}${formattedDir}${separator}${formattedSpd}${separator}${formattedRH}\n`;
            } else if (format === 'Customized') {
                content += `${displayHeight}${separator}${displayPressure}${separator}${formattedTemp}${separator}${formattedDew}${separator}${formattedDir}${separator}${formattedSpd}${separator}${formattedRH}\n`;
            }
        }
    });

    // Create and trigger the download
    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    // Optionally revert settings (commented out to persist changes in UI)
    document.getElementById('interpStepSelect').value = originalSettings.interpStep;
    document.querySelector(`input[name="heightUnit"][value="${originalSettings.heightUnit}"]`).checked = true;
    document.querySelector(`input[name="refLevel"][value="${originalSettings.refLevel}"]`).checked = true;
    document.querySelector(`input[name="windUnit"][value="${originalSettings.windUnit}"]`).checked = true;
    document.querySelector(`input[name="temperatureUnit"][value="${originalSettings.temperatureUnit}"]`).checked = true;
    Settings.state.userSettings.interpStep = originalSettings.interpStep;
    Settings.state.userSettings.heightUnit = originalSettings.heightUnit;
    Settings.state.userSettings.refLevel = originalSettings.refLevel;
    Settings.state.userSettings.windUnit = originalSettings.windUnit;
    Settings.state.userSettings.temperatureUnit = originalSettings.temperatureUnit;
    Settings.save();
    Settings.updateUnitLabels();
    Settings.updateUnitLabels();
    Settings.updateUnitLabels();

}

// == Ensemble Data Handling ==


// == Autoupdate Functionality ==
export function setupAutoupdate() {
    const autoupdateCheckbox = document.getElementById('autoupdateCheckbox');
    if (!autoupdateCheckbox) {
        console.warn('Autoupdate checkbox not found');
        return;
    }

    // Initialize checkbox state
    autoupdateCheckbox.checked = Settings.state.userSettings.autoupdate;
    console.log('Autoupdate checkbox initialized:', autoupdateCheckbox.checked);

    autoupdateCheckbox.addEventListener('change', () => {
        Settings.state.userSettings.autoupdate = autoupdateCheckbox.checked;
        Settings.save();
        console.log('Autoupdate changed to:', autoupdateCheckbox.checked);

        // Check if historical date is set
        const historicalDatePicker = document.getElementById('historicalDatePicker');
        if (autoupdateCheckbox.checked && historicalDatePicker?.value) {
            autoupdateCheckbox.checked = false;
            Settings.state.userSettings.autoupdate = false;
            Settings.save();
            Utils.handleError('Autoupdate cannot be enabled with a historical date set.');
            return;
        }

        if (autoupdateCheckbox.checked) {
            startAutoupdate();
        } else {
            stopAutoupdate();
        }
    });

    // Start autoupdate if enabled on load
    if (Settings.state.userSettings.autoupdate && !document.getElementById('historicalDatePicker')?.value) {
        startAutoupdate();
    }
}
export function startAutoupdate() {
    if (AppState.autoupdateInterval) {
        console.log('Autoupdate already running, skipping start');
        return;
    }

    if (!navigator.onLine) {
        console.warn('Cannot start autoupdate: offline');
        Utils.handleError('Cannot enable autoupdate while offline.');
        document.getElementById('autoupdateCheckbox').checked = false;
        Settings.state.userSettings.autoupdate = false;
        Settings.save();
        return;
    }

    console.log('Starting autoupdate');
    updateToCurrentHour();

    // Check every minute for hour changes
    AppState.autoupdateInterval = setInterval(() => {
        const now = new Date();
        const currentHour = now.getUTCHours();
        const slider = document.getElementById('timeSlider');
        const currentSliderHour = parseInt(slider?.value) || 0;

        if (currentHour !== currentSliderHour) {
            console.log(`Hour changed to ${currentHour}, updating weather data`);
            updateToCurrentHour();
        }
    }, 60 * 1000); // Every minute

    Utils.handleMessage('Autoupdate enabled');
}
export function stopAutoupdate() {
    if (AppState.autoupdateInterval) {
        clearInterval(AppState.autoupdateInterval);
        AppState.autoupdateInterval = null;
        console.log('Autoupdate stopped');
        Utils.handleMessage('Autoupdate disabled');
    }
}
export async function updateToCurrentHour() {
    if (!AppState.lastLat || !AppState.lastLng) {
        console.warn('No location selected, cannot update weather data');
        Utils.handleError('Please select a location to enable autoupdate.');
        stopAutoupdate();
        document.getElementById('autoupdateCheckbox').checked = false;
        Settings.state.userSettings.autoupdate = false;
        Settings.save();
        return;
    }

    if (!navigator.onLine) {
        console.warn('Cannot update weather data: offline');
        Utils.handleError('Cannot update weather data while offline.');
        stopAutoupdate();
        document.getElementById('autoupdateCheckbox').checked = false;
        Settings.state.userSettings.autoupdate = false;
        Settings.save();
        return;
    }

    const slider = document.getElementById('timeSlider');
    if (!slider) {
        console.warn('Time slider not found, cannot update to current hour');
        return;
    }

    const now = new Date();
    const currentHour = now.getUTCHours();
    slider.value = currentHour;
    console.log(`Set slider to current hour: ${currentHour}`);

    try {
        await fetchWeatherForLocation(AppState.lastLat, AppState.lastLng, null, false);
        console.log('Weather data fetched for current hour');

        await updateWeatherDisplay(currentHour);
        if (AppState.lastAltitude !== 'N/A') {
            calculateMeanWind();
        }
        if (Settings.state.userSettings.calculateJump && isCalculateJumpUnlocked) {
            debouncedCalculateJump();
            JumpPlanner.calculateCutAway();
            if (Settings.state.userSettings.showJumpRunTrack) {
                updateJumpRunTrackDisplay();
            }
        }
        console.log('Updated all displays for current hour');
    } catch (error) {
        console.error('Error updating to current hour:', error);
        Utils.handleError('Failed to update weather data: ' + error.message);
    }
}

// == Landing Pattern, Jump and Free Fall Calculations ==
export function calculateJump() {
    if (!Settings.state.isCalculateJumpUnlocked || !Settings.state.userSettings.calculateJump) {
        mapManager.drawJumpVisualization(null);
        mapManager.drawCutAwayVisualization(null);
        return;
    }

    if (!AppState.weatherData || !AppState.lastLat || !AppState.lastLng) {
        mapManager.drawJumpVisualization(null);
        return;
    }

    // Daten einmal zentral vorbereiten
    const sliderIndex = getSliderValue();
    const interpolatedData = weatherManager.interpolateWeatherData(sliderIndex);


    const visualizationData = {
        exitCircles: [],
        canopyCircles: [],
        canopyLabels: []
    };

    // --- EXIT AREA ---
    if (Settings.state.userSettings.showExitArea) {
        const exitResult = JumpPlanner.calculateExitCircle(interpolatedData); // Korrekt
        if (exitResult) {
            // Der hellgrüne Kreis (gesamter möglicher Bereich)
            visualizationData.exitCircles.push({
                center: [exitResult.greenLat, exitResult.greenLng],
                radius: exitResult.greenRadius,
                color: 'green',
                fillColor: 'green',
                fillOpacity: 0.2,
                weight: 2
            });

            // Erstellen des Tooltip-Inhalts
            const tooltipContent = `
                Exit areas calculated with:<br>
                Throw/Drift: ${Number.isFinite(exitResult.freeFallDirection) ? Math.round(exitResult.freeFallDirection) : 'N/A'}° ${Number.isFinite(exitResult.freeFallDistance) ? Math.round(exitResult.freeFallDistance) : 'N/A'} m<br>
                Free Fall Time: ${exitResult.freeFallTime != null && !isNaN(exitResult.freeFallTime) ? Math.round(exitResult.freeFallTime) : 'N/A'} sec
            `;

            // Der dunkelgrüne Kreis (Bereich bis zum Downwind) bekommt den Tooltip
            visualizationData.exitCircles.push({
                center: [exitResult.darkGreenLat, exitResult.darkGreenLng],
                radius: exitResult.darkGreenRadius,
                color: 'darkgreen',
                fillColor: 'darkgreen',
                fillOpacity: 0.2,
                weight: 2,
                tooltip: tooltipContent // Hier wird der Tooltip hinzugefügt
            });
        }
    }

    // --- CANOPY AREA ---
    if (Settings.state.userSettings.showCanopyArea) {
        const canopyResult = JumpPlanner.calculateCanopyCircles(interpolatedData); // Korrekt
        if (canopyResult) {
            const redCenter = Utils.calculateNewCenter(canopyResult.redLat, canopyResult.redLng, canopyResult.displacementFull, canopyResult.directionFull);
            visualizationData.canopyCircles.push({
                center: redCenter,
                radius: canopyResult.radiusFull,
                color: 'red',
                weight: 2,
                opacity: 0.8,
                fillOpacity: 0
            });

            canopyResult.additionalBlueRadii.forEach((radius, i) => {
                const center = Utils.calculateNewCenter(canopyResult.blueLat, canopyResult.blueLng, canopyResult.additionalBlueDisplacements[i], canopyResult.additionalBlueDirections[i]);
                visualizationData.canopyCircles.push({
                    center: center,
                    radius: radius,
                    color: 'blue',
                    weight: 1,
                    fillColor: 'blue',
                    fillOpacity: 0.1,
                    opacity: 1 // Rand ist voll sichtbar
                });
                visualizationData.canopyLabels.push({
                    center: center,
                    radius: radius,
                    text: `${Math.round(canopyResult.additionalBlueUpperLimits[i])}m`
                });
            });
        }
    }

    mapManager.drawJumpVisualization(visualizationData);

    // --- CUT-AWAY-FINDER ---
    let cutawayDrawData = null;
    if (Settings.state.userSettings.showCutAwayFinder && AppState.cutAwayLat !== null) {
        const result = JumpPlanner.calculateCutAway(interpolatedData); // Daten übergeben
        if (result) {
            // Erstelle die "Bauanleitung" für den Cut-Away-Kreis.
            cutawayDrawData = {
                center: result.center,
                radius: result.radius,
                tooltipContent: result.tooltipContent
            };
        }
    }
    // Übergib die fertige Bauanleitung an den Zeichner (auch wenn sie 'null' ist, um alte Kreise zu löschen).
    mapManager.drawCutAwayVisualization(cutawayDrawData);
}
export function resetJumpRunDirection(triggerUpdate = true) {
    AppState.customJumpRunDirection = null;
    const directionInput = document.getElementById('jumpRunTrackDirection');
    if (directionInput) {
        directionInput.value = '';
        console.log('Cleared jumpRunTrackDirection input');
    }
    console.log('Reset JRT direction to calculated');
    if (triggerUpdate && Settings.state.userSettings.showJumpRunTrack && AppState.weatherData && AppState.lastLat && AppState.lastLng) {
        console.log('Triggering JRT update after reset');
        updateJumpRunTrackDisplay();
    }
}
export function calculateJumpRunTrack() {
    if (!Settings.state.userSettings.showJumpRunTrack || !Settings.state.userSettings.calculateJump || !AppState.weatherData || !AppState.lastLat || !AppState.lastLng) {
        console.log('Skipping calculateJumpRunTrack: conditions not met');
        return null;
    }
    console.log('Calculating jump run track...');
    updateJumpRunTrackDisplay();
    const trackData = JumpPlanner.jumpRunTrack();
    return trackData;
}
export function validateLegHeights(final, base, downwind) {
    const finalVal = parseInt(final.value) || 100;
    const baseVal = parseInt(base.value) || 200;
    const downwindVal = parseInt(downwind.value) || 300;

    if (baseVal <= finalVal) {
        Utils.handleError('Base leg must start higher than final leg.');
        return false;
    }
    if (downwindVal <= baseVal) {
        Utils.handleError('Downwind leg must start higher than base leg.');
        return false;
    }
    return true;
}
export function updateLandingPatternDisplay() {

    // --- TEIL A: DATEN SAMMELN UND PRÜFEN (1:1 aus Ihrer alten Funktion) ---
    if (!Settings.state.isLandingPatternUnlocked || !Settings.state.userSettings.showLandingPattern) {
        mapManager.drawLandingPattern(null); // Alte Visualisierungen löschen
        return;
    }

    if (!AppState.weatherData || !AppState.lastLat) {
        mapManager.drawLandingPattern(null);
        return;
    }

    const currentZoom = AppState.map.getZoom();
    if (currentZoom < Constants.landingPatternMinZoom) {
        console.log('Landing pattern not displayed - zoom too low:', currentZoom);
        // Sende den Befehl "Alles wegmachen" an den Maler und beende die Funktion.
        mapManager.drawLandingPattern(null);
        return;
    }

    //... (alle Zeilen von "const sliderIndex = ..." bis "if (!interpolatedData ...)") ...
    const sliderIndex = parseInt(document.getElementById('timeSlider').value) || 0;
    const landingDirection = document.querySelector('input[name="landingDirection"]:checked')?.value || 'LL';
    const customLandingDirectionLLInput = document.getElementById('customLandingDirectionLL');
    const customLandingDirectionRRInput = document.getElementById('customLandingDirectionRR');
    const customLandingDirLL = customLandingDirectionLLInput ? parseInt(customLandingDirectionLLInput.value, 10) : null;
    const customLandingDirRR = customLandingDirectionRRInput ? parseInt(customLandingDirectionRRInput.value, 10) : null;

    const CANOPY_SPEED_KT = parseInt(document.getElementById('canopySpeed').value) || 20;
    const DESCENT_RATE_MPS = parseFloat(document.getElementById('descentRate').value) || 3.5;
    const LEG_HEIGHT_FINAL = parseInt(document.getElementById('legHeightFinal').value) || 100;
    const LEG_HEIGHT_BASE = parseInt(document.getElementById('legHeightBase').value) || 200;

    const LEG_HEIGHT_DOWNWIND = parseInt(document.getElementById('legHeightDownwind').value) || 300;
    const markerLatLng = AppState.currentMarker.getLatLng();
    const lat = markerLatLng.lat;
    const lng = markerLatLng.lng;
    const baseHeight = Math.round(AppState.lastAltitude);
    const interpolatedData = weatherManager.interpolateWeatherData(sliderIndex);
    if (!interpolatedData || interpolatedData.length === 0) return;


    // *** HIER IST DIE KORREKTUR: FÜGEN SIE DIESEN BLOCK EIN ***
    // Holt die aktuellen Einstellungen aus dem HTML-Dokument.


    const heights = interpolatedData.map(d => d.height);
    const dirs = interpolatedData.map(d => Number.isFinite(d.dir) ? parseFloat(d.dir) : 0);
    const spdsKt = interpolatedData.map(d => Utils.convertWind(parseFloat(d.spd) || 0, 'kt', 'km/h'));
    const uComponents = spdsKt.map((spd, i) => -spd * Math.sin(dirs[i] * Math.PI / 180));
    const vComponents = spdsKt.map((spd, i) => -spd * Math.cos(dirs[i] * Math.PI / 180));

    // Determine effective landing direction based on selected pattern and input
    let effectiveLandingWindDir;
    if (landingDirection === 'LL' && Number.isFinite(customLandingDirLL) && customLandingDirLL >= 0 && customLandingDirLL <= 359) {
        effectiveLandingWindDir = customLandingDirLL;
    } else if (landingDirection === 'RR' && Number.isFinite(customLandingDirRR) && customLandingDirRR >= 0 && customLandingDirRR <= 359) {
        effectiveLandingWindDir = customLandingDirRR;
    } else {
        effectiveLandingWindDir = Number.isFinite(AppState.landingWindDir) ? AppState.landingWindDir : dirs[0];
    }

    if (!Number.isFinite(effectiveLandingWindDir)) {
        console.warn('Invalid landing wind direction:', effectiveLandingWindDir);
        return;
    }

    // Helper function to convert wind speed to user-selected unit
    function formatWindSpeed(speedKt) {
        const unit = Settings.getValue('windUnit', 'radio', 'kt');
        const convertedSpeed = Utils.convertWind(speedKt, unit, 'kt');
        if (unit === 'bft') {
            return Math.round(convertedSpeed); // Beaufort scale is integer
        }
        return convertedSpeed.toFixed(1); // Other units to one decimal
    }

    const calculateLegEndpoint = (startLat, startLng, bearing, groundSpeedKt, timeSec) => {
        const speedMps = groundSpeedKt * 1.852 / 3.6;
        const lengthMeters = speedMps * timeSec;
        const metersPerDegreeLat = 111000;
        const distanceDeg = lengthMeters / metersPerDegreeLat;
        const radBearing = bearing * Math.PI / 180;
        const deltaLat = distanceDeg * Math.cos(radBearing);
        const deltaLng = distanceDeg * Math.sin(radBearing) / Math.cos(startLat * Math.PI / 180);
        return [startLat + deltaLat, startLng + deltaLng];
    };

    // --- TEIL B: ALLE BERECHNUNGEN (1:1 aus Ihrer alten Funktion) ---
    // Der gesamte Block, der die Punkte, Winde und Farben berechnet.

    const finalLimits = [baseHeight, baseHeight + LEG_HEIGHT_FINAL];
    console.log('Final limits:', finalLimits);
    const finalMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, ...finalLimits);
    const finalWindDir = finalMeanWind[0];
    const finalWindSpeedKt = finalMeanWind[1];
    if (!Number.isFinite(finalWindSpeedKt) || !Number.isFinite(finalWindDir)) {
        console.warn('Invalid mean wind for final leg:', finalMeanWind);
        return;
    }

    let finalArrowColor = null;
    if (finalWindSpeedKt <= 3) {
        finalArrowColor = 'lightblue';
    } else if (finalWindSpeedKt <= 10) {
        finalArrowColor = 'lightgreen';
    } else if (finalWindSpeedKt <= 16) {
        finalArrowColor = '#f5f34f';
    } else {
        finalArrowColor = '#ffcccc';
    }

    const finalCourse = effectiveLandingWindDir;
    const finalWindAngle = Utils.calculateWindAngle(finalCourse, finalWindDir);
    const { crosswind: finalCrosswind, headwind: finalHeadwind } = Utils.calculateWindComponents(finalWindSpeedKt, finalWindAngle);
    const finalWca = Utils.calculateWCA(finalCrosswind, CANOPY_SPEED_KT) * (finalCrosswind >= 0 ? 1 : -1);
    const finalHeading = Utils.normalizeAngle(finalCourse - finalWca);
    const finalCourseObj = Utils.calculateCourseFromHeading(finalHeading, finalWindDir, finalWindSpeedKt, CANOPY_SPEED_KT);
    const finalGroundSpeedKt = finalCourseObj.groundSpeed;
    const finalTime = LEG_HEIGHT_FINAL / DESCENT_RATE_MPS;
    const finalLength = finalGroundSpeedKt * 1.852 / 3.6 * finalTime;
    const finalBearing = (effectiveLandingWindDir + 180) % 360;
    const finalEnd = calculateLegEndpoint(lat, lng, finalBearing, finalGroundSpeedKt, finalTime);
    // Add a fat blue arrow in the middle of the final leg pointing to landing direction
    const finalMidLat = (lat + finalEnd[0]) / 2;
    const finalMidLng = (lng + finalEnd[1]) / 2;
    const finalArrowBearing = (finalWindDir - 90 + 180) % 360; // Points in direction of the mean wind at final

    // Base Leg (100-200m AGL)
    const baseLimits = [baseHeight + LEG_HEIGHT_FINAL, baseHeight + LEG_HEIGHT_BASE];
    const baseMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, ...baseLimits);
    const baseWindDir = baseMeanWind[0];
    const baseWindSpeedKt = baseMeanWind[1];
    if (!Number.isFinite(baseWindSpeedKt) || !Number.isFinite(baseWindDir)) {
        console.warn('Invalid mean wind for base leg:', baseMeanWind);
        return;
    }

    let baseArrowColor = null;
    if (baseWindSpeedKt <= 3) {
        baseArrowColor = 'lightblue';
    } else if (baseWindSpeedKt <= 10) {
        baseArrowColor = 'lightgreen';
    } else if (baseWindSpeedKt <= 16) {
        baseArrowColor = '#f5f34f';
    } else {
        baseArrowColor = '#ffcccc';
    }

    console.log('********* Landing Direction: ', landingDirection, 'Effective Landing Wind Dir:', effectiveLandingWindDir);
    let baseHeading = 0;
    if (landingDirection === 'LL') {
        baseHeading = (effectiveLandingWindDir + 90) % 360;
        console.log('Base Heading:', baseHeading);
    } else if (landingDirection === 'RR') {
        baseHeading = (effectiveLandingWindDir - 90 + 360) % 360;
        console.log('Base Heading:', baseHeading);
    }

    const baseCourseObj = Utils.calculateCourseFromHeading(baseHeading, baseWindDir, baseWindSpeedKt, CANOPY_SPEED_KT);
    const baseCourse = baseCourseObj.trueCourse;
    const baseGroundSpeedKt = baseCourseObj.groundSpeed;
    let baseBearing = (baseCourse + 180) % 360;
    if (baseGroundSpeedKt < 0) {
        baseBearing = (baseBearing + 180) % 360; // Reverse the course
        console.log('Base ground speed is negative:', baseGroundSpeedKt, 'New course:', baseBearing);
    }
    const baseTime = (LEG_HEIGHT_BASE - LEG_HEIGHT_FINAL) / DESCENT_RATE_MPS;
    const baseLength = baseGroundSpeedKt * 1.852 / 3.6 * baseTime;
    console.log('Base Course:', baseCourse);
    const baseWindAngle = Utils.calculateWindAngle(baseCourse, baseWindDir);
    const { crosswind: baseCrosswind, headwind: baseHeadwind } = Utils.calculateWindComponents(baseWindSpeedKt, baseWindAngle);
    const baseWca = Utils.calculateWCA(baseCrosswind, CANOPY_SPEED_KT) * (baseCrosswind >= 0 ? 1 : -1);

    const baseEnd = calculateLegEndpoint(finalEnd[0], finalEnd[1], baseBearing, baseGroundSpeedKt, baseTime);

    // Add a fat blue arrow in the middle of the base leg pointing to landing direction
    const baseMidLat = (finalEnd[0] + baseEnd[0]) / 2;
    const baseMidLng = (finalEnd[1] + baseEnd[1]) / 2;
    const baseArrowBearing = (baseWindDir - 90 + 180) % 360; // Points in direction of the mean wind at base

    // Downwind Leg (200-300m AGL)
    const downwindLimits = [baseHeight + LEG_HEIGHT_BASE, baseHeight + LEG_HEIGHT_DOWNWIND];
    const downwindMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, ...downwindLimits);
    const downwindWindDir = downwindMeanWind[0];
    const downwindWindSpeedKt = downwindMeanWind[1];
    if (!Number.isFinite(downwindWindSpeedKt) || !Number.isFinite(downwindWindDir)) {
        console.warn('Invalid mean wind for downwind leg:', downwindMeanWind);
        return;
    }

    let downwindArrowColor = null;
    if (downwindWindSpeedKt <= 3) {
        downwindArrowColor = 'lightblue';
    } else if (downwindWindSpeedKt <= 10) {
        downwindArrowColor = 'lightgreen';
    } else if (downwindWindSpeedKt <= 16) {
        downwindArrowColor = '#f5f34f';
    } else {
        downwindArrowColor = '#ffcccc';
    }

    const downwindCourse = effectiveLandingWindDir;
    const downwindWindAngle = Utils.calculateWindAngle(downwindCourse, downwindWindDir);
    const { crosswind: downwindCrosswind, headwind: downwindHeadwind } = Utils.calculateWindComponents(downwindWindSpeedKt, downwindWindAngle);
    const downwindWca = Utils.calculateWCA(downwindCrosswind, CANOPY_SPEED_KT) * (downwindCrosswind >= 0 ? 1 : -1);
    const downwindHeading = Utils.normalizeAngle((downwindCourse - downwindWca + 180) % 360);
    const downwindCourseObj = Utils.calculateCourseFromHeading(downwindHeading, downwindWindDir, downwindWindSpeedKt, CANOPY_SPEED_KT);
    const downwindGroundSpeedKt = downwindCourseObj.groundSpeed;
    const downwindTime = (LEG_HEIGHT_DOWNWIND - LEG_HEIGHT_BASE) / DESCENT_RATE_MPS;
    const downwindLength = downwindGroundSpeedKt * 1.852 / 3.6 * downwindTime;
    const downwindEnd = calculateLegEndpoint(baseEnd[0], baseEnd[1], downwindCourse, downwindGroundSpeedKt, downwindTime);

    // Berechnet die exakten Mittelpunkte für die Platzierung der Windpfeile.
    const finalMidPoint = [(lat + finalEnd[0]) / 2, (lng + finalEnd[1]) / 2];
    const baseMidPoint = [(finalEnd[0] + baseEnd[0]) / 2, (finalEnd[1] + baseEnd[1]) / 2];
    const downwindMidPoint = [(baseEnd[0] + downwindEnd[0]) / 2, (baseEnd[1] + downwindEnd[1]) / 2];

    // Add a fat blue arrow in the middle of the downwind leg pointing to landing direction
    const downwindMidLat = (baseEnd[0] + downwindEnd[0]) / 2;
    const downwindMidLng = (baseEnd[1] + downwindEnd[1]) / 2;
    const downwindArrowBearing = (downwindWindDir - 90 + 180) % 360; // Points in direction of the mean wind at downwind

    console.log(`Landing Pattern Updated:
        Final Leg: Wind: ${finalWindDir.toFixed(1)}° @ ${finalWindSpeedKt.toFixed(1)}kt, Course: ${finalCourse.toFixed(1)}°, WCA: ${finalWca.toFixed(1)}°, GS: ${finalGroundSpeedKt.toFixed(1)}kt, HW: ${finalHeadwind.toFixed(1)}kt, Length: ${finalLength.toFixed(1)}m
        Base Leg: Wind: ${baseWindDir.toFixed(1)}° @ ${baseWindSpeedKt.toFixed(1)}kt, Course: ${baseCourse.toFixed(1)}°, WCA: ${baseWca.toFixed(1)}°, GS: ${baseGroundSpeedKt.toFixed(1)}kt, HW: ${baseHeadwind.toFixed(1)}kt, Length: ${baseLength.toFixed(1)}m
        Downwind Leg: Wind: ${downwindWindDir.toFixed(1)}° @ ${downwindWindSpeedKt.toFixed(1)}kt, Course: ${downwindCourse.toFixed(1)}°, WCA: ${downwindWca.toFixed(1)}°, GS: ${downwindGroundSpeedKt.toFixed(1)}kt, HW: ${downwindHeadwind.toFixed(1)}kt, Length: ${downwindLength.toFixed(1)}m`);

    // Logs für Feldversuch Bobby
    const selectedTime = AppState.weatherData.time[sliderIndex]; // Zeit aus den Wetterdaten basierend auf dem Slider-Index
    console.log('+++++++++ Koordinaten Pattern:', selectedTime);
    console.log('Coordinates DIP: ', lat, lng, 'Altitude DIP:', baseHeight);
    console.log('Coordinates final end: ', finalEnd[0], finalEnd[1], 'Leg Height:', baseHeight + LEG_HEIGHT_FINAL);
    console.log('Coordinates base end: ', baseEnd[0], baseEnd[1], 'Leg Height:', baseHeight + LEG_HEIGHT_BASE);
    console.log('Coordinates downwind end: ', downwindEnd[0], downwindEnd[1], 'Leg Height:', baseHeight + LEG_HEIGHT_DOWNWIND);

    // --- TEIL C: DIE "BAUANLEITUNG" FÜR DEN KELLNER ERSTELLEN ---
    // Hier fassen wir alle Ergebnisse sauber zusammen.
    const patternData = {
        legs: [
            { path: [[lat, lng], finalEnd], options: { color: 'red', weight: 3, opacity: 0.8, dashArray: '5, 10' } },
            { path: [finalEnd, baseEnd], options: { color: 'red', weight: 3, opacity: 0.8, dashArray: '5, 10' } },
            { path: [baseEnd, downwindEnd], options: { color: 'red', weight: 3, opacity: 0.8, dashArray: '5, 10' } }
        ],
        arrows: [
            {
                position: finalMidPoint,
                bearing: (finalWindDir - 90 + 180) % 360,
                color: finalArrowColor,
                tooltipText: `${Math.round(finalWindDir)}° ${formatWindSpeed(finalWindSpeedKt)}${Settings.getValue('windUnit', 'radio', 'kt')}` // Ihr alter Tooltip-Text
            },
            {
                position: baseMidPoint,
                bearing: (baseMeanWind[0] - 90 + 180) % 360,
                color: baseArrowColor,
                tooltipText: `${Math.round(baseWindDir)}° ${formatWindSpeed(baseWindSpeedKt)}${Settings.getValue('windUnit', 'radio', 'kt')}`
            },
            {
                position: downwindMidPoint,
                bearing: (downwindMeanWind[0] - 90 + 180) % 360,
                color: downwindArrowColor,
                tooltipText: `${Math.round(downwindWindDir)}° ${formatWindSpeed(downwindWindSpeedKt)}${Settings.getValue('windUnit', 'radio', 'kt')}`
            }
        ]
    };

    // --- TEIL D: DEN KELLNER MIT DER FERTIGEN BESTELLUNG LOSSCHICKEN ---
    mapManager.drawLandingPattern(patternData);
}
export function updateJumpRunTrackDisplay() {
    console.log('updateJumpRunTrackDisplay called');
    if (!AppState.map) {
        console.warn('Map not initialized, cannot update jump run track display');
        return;
    }

    // Prüfe alle Bedingungen, ob der Track angezeigt werden soll.
    const shouldShow =
        Settings.state.userSettings.showJumpRunTrack &&
        AppState.weatherData &&
        AppState.lastLat &&
        AppState.lastLng &&
        Settings.state.isCalculateJumpUnlocked &&
        Settings.state.userSettings.calculateJump;

    // Wenn die Bedingungen NICHT erfüllt sind, lösche den Track.
    if (!shouldShow) {
        console.log('Conditions not met to show JRT, clearing display.');
        mapManager.drawJumpRunTrack(null); // Sagt dem mapManager, alles zu löschen.
        AppState.lastTrackData = null; // Setzt die gespeicherten Track-Daten zurück.
        return; // Beendet die Funktion hier.
    }

    // Wenn die Bedingungen erfüllt sind, zeichne den Track.
    // Neuer Code:
    const sliderIndex = getSliderValue();
    const interpolatedData = weatherManager.interpolateWeatherData(sliderIndex);
    const trackData = JumpPlanner.jumpRunTrack(interpolatedData);
    if (trackData && trackData.latlngs?.length === 2 && trackData.latlngs.every(ll => Number.isFinite(ll[0]) && Number.isFinite(ll[1]))) {
        console.log('Drawing jump run track with data:', trackData);
        const drawData = {
            path: {
                latlngs: trackData.latlngs,
                options: { color: 'orange', weight: 5, opacity: 0.8 },
                tooltipText: `Jump Run Track: ${trackData.direction}°, Length: ${trackData.trackLength} m`,
                originalLatLngs: AppState.lastTrackData?.latlngs?.length === 2 ? AppState.lastTrackData.latlngs : trackData.latlngs
            },
            approachPath: trackData.approachLatLngs?.length === 2 && trackData.approachLatLngs.every(ll => Number.isFinite(ll[0]) && Number.isFinite(ll[1])) ? {
                latlngs: trackData.approachLatLngs,
                options: { color: 'orange', weight: 3, opacity: 0.6, dashArray: '5, 10' },
                tooltipText: `Approach Path: ${trackData.direction}°, Length: ${trackData.approachLength} m`,
                originalLatLngs: AppState.lastTrackData?.approachLatLngs?.length === 2 ? AppState.lastTrackData.approachLatLngs : trackData.approachLatLngs
            } : null,
            trackLength: trackData.trackLength, // Wichtig für Drag-and-Drop
            airplane: {
                position: L.latLng(trackData.latlngs[1][0], trackData.latlngs[1][1]),
                bearing: trackData.direction,
                originalPosition: AppState.lastTrackData?.latlngs?.[1] && Number.isFinite(AppState.lastTrackData.latlngs[1][0]) ?
                    L.latLng(AppState.lastTrackData.latlngs[1][0], AppState.lastTrackData.latlngs[1][1]) :
                    L.latLng(trackData.latlngs[1][0], trackData.latlngs[1][1]),
            }
        };
        mapManager.drawJumpRunTrack(drawData);
        AppState.lastTrackData = {
            latlngs: trackData.latlngs,
            approachLatLngs: trackData.approachLatLngs,
            direction: trackData.direction,
            trackLength: trackData.trackLength,
            approachLength: trackData.approachLength
        };
        console.log('Updated AppState.lastTrackData:', AppState.lastTrackData);
    } else {
        console.warn('No valid track data to display:', trackData);
        mapManager.drawJumpRunTrack(null); // Sicherheitshalber auch hier löschen
        AppState.lastTrackData = null;
    }
}

// == Live Tracking ==
/**
 * Aktualisiert die Jump Master Line und das Live-Info-Panel.
 * Holt sich die Position vom Live-Marker und berechnet alle Werte neu.
 * @param {object|null} positionData - Optionale, frische Positionsdaten von einem Event.
 */
export function updateJumpMasterLineAndPanel(positionData = null) {
    // Wenn es noch keinen Live-Marker gibt, können wir nichts tun.
    if (!AppState.liveMarker) {
        return;
    }

    const livePos = AppState.liveMarker.getLatLng();
    if (!livePos) {
        return;
    }

    // 1. Baue IMMER das Basis-Datenobjekt mit den Live-Positionsdaten.
    //    Nutze frische Daten vom Event, falls vorhanden, sonst die zuletzt gespeicherten.
    const data = positionData ? positionData : {
        latitude: livePos.lat,
        longitude: livePos.lng,
        speedMs: AppState.lastSmoothedSpeedMs,
        direction: AppState.lastDirection,
        deviceAltitude: AppState.lastDeviceAltitude,
        altitudeAccuracy: AppState.lastAltitudeAccuracy,
        accuracy: AppState.lastAccuracy
    };

    let jumpMasterLineData = null;
    const showJML = Settings.state.userSettings.showJumpMasterLine;

    // 2. Prüfe, ob die JML-Logik ausgeführt werden soll.
    if (showJML) {
        let targetPos = null;
        let targetName = '';

        // Ziel bestimmen (DIP oder HARP)
        if (Settings.state.userSettings.jumpMasterLineTarget === 'HARP' && AppState.harpMarker) {
            targetPos = AppState.harpMarker.getLatLng();
            targetName = 'HARP';
        } else if (AppState.currentMarker) {
            targetPos = AppState.currentMarker.getLatLng();
            targetName = 'DIP';
        }

        // Wenn ein Ziel da ist, berechne die JML-Daten und zeichne die Linie.
        if (targetPos) {
            const distance = AppState.map.distance(livePos, targetPos);
            const bearing = Math.round(Utils.calculateBearing(livePos.lat, livePos.lng, targetPos.lat, targetPos.lng));
            const speedMs = data.speedMs > 1 ? data.speedMs : 1;
            const tot = Math.round(distance / speedMs);
            jumpMasterLineData = { distance, bearing, tot, target: targetName };
            mapManager.drawJumpMasterLine(livePos, targetPos);
        }
    } else {
        // Wenn die JML nicht angezeigt werden soll, stelle sicher, dass die Linie auf der Karte entfernt wird.
        mapManager.clearJumpMasterLine();
    }

    // 3. Sammle die Einstellungen für die Anzeige.
    const settingsForPanel = {
        heightUnit: Settings.getValue('heightUnit', 'radio', 'm'),
        effectiveWindUnit: Settings.getValue('windUnit', 'radio', 'kt') === 'bft' ? 'kt' : Settings.getValue('windUnit', 'radio', 'kt'),
        coordFormat: Settings.getValue('coordFormat', 'radio', 'Decimal'),
        refLevel: Settings.getValue('refLevel', 'radio', 'AGL')
    };

    // 4. Rufe IMMER die Funktion zur Panel-Aktualisierung auf.
    //    Sie bekommt alle Basisdaten und die (potenziell leeren) JML-Daten.
    mapManager.updateLivePositionControl({
        ...data,
        showJumpMasterLine: showJML,
        jumpMasterLineData,
        ...settingsForPanel
    });
}

// == UI and Event Handling ==
function initializeApp() {
    Settings.initialize();
    // Synchronize global variables with Settings.state.unlockedFeatures
    Settings.state.isLandingPatternUnlocked = Settings.state.unlockedFeatures.landingPattern;
    Settings.state.isCalculateJumpUnlocked = Settings.state.unlockedFeatures.calculateJump;
    Settings.state.userSettings.showJumpMasterLine = false;
    console.log('Initial unlock status:', { isLandingPatternUnlocked: Settings.state.isLandingPatternUnlocked, isCalculateJumpUnlocked: Settings.state.isCalculateJumpUnlocked });

    if (AppState.isInitialized) {
        console.log('App already initialized, skipping');
        return;
    }
    AppState.isInitialized = true;
    console.log('Initializing app');
}
function initializeUIElements() {
    setElementValue('modelSelect', Settings.state.userSettings.model);
    setRadioValue('refLevel', Settings.state.userSettings.refLevel);
    setRadioValue('heightUnit', Settings.state.userSettings.heightUnit);
    setRadioValue('temperatureUnit', Settings.state.userSettings.temperatureUnit);
    setRadioValue('windUnit', Settings.state.userSettings.windUnit);
    setRadioValue('timeZone', Settings.state.userSettings.timeZone);
    setRadioValue('coordFormat', Settings.state.userSettings.coordFormat);
    setRadioValue('downloadFormat', Settings.state.userSettings.downloadFormat);
    setRadioValue('landingDirection', Settings.state.userSettings.landingDirection);
    setInputValue('canopySpeed', Settings.state.userSettings.canopySpeed);
    setInputValue('descentRate', Settings.state.userSettings.descentRate);
    setInputValue('legHeightDownwind', Settings.state.userSettings.legHeightDownwind);
    setInputValue('legHeightBase', Settings.state.userSettings.legHeightBase);
    setInputValue('legHeightFinal', Settings.state.userSettings.legHeightFinal);
    setInputValue('customLandingDirectionLL', Settings.state.userSettings.customLandingDirectionLL);
    setInputValue('customLandingDirectionRR', Settings.state.userSettings.customLandingDirectionRR);
    setInputValue('lowerLimit', Settings.state.userSettings.lowerLimit);
    setInputValue('upperLimit', Settings.state.userSettings.upperLimit);
    setInputValue('openingAltitude', Settings.state.userSettings.openingAltitude);
    setInputValue('exitAltitude', Settings.state.userSettings.exitAltitude);
    setInputValue('interpStepSelect', Settings.state.userSettings.interpStep);
    setInputValue('aircraftSpeedKt', Settings.state.userSettings.aircraftSpeedKt);
    setInputValue('numberOfJumpers', Settings.state.userSettings.numberOfJumpers);
    setCheckboxValue('showTableCheckbox', Settings.state.userSettings.showTable);
    setCheckboxValue('calculateJumpCheckbox', Settings.state.userSettings.calculateJump);
    setCheckboxValue('showLandingPattern', Settings.state.userSettings.showLandingPattern);
    setCheckboxValue('showJumpRunTrack', Settings.state.userSettings.showJumpRunTrack);
    setInputValue('jumpRunTrackOffset', Settings.state.userSettings.jumpRunTrackOffset);
    setCheckboxValue('showCanopyAreaCheckbox', Settings.state.userSettings.showCanopyArea);
    setCheckboxValue('showExitAreaCheckbox', Settings.state.userSettings.showExitArea);
    Settings.state.userSettings.isCustomJumpRunDirection = Settings.state.userSettings.isCustomJumpRunDirection || false;

    // Ensure UI reflects the stored custom direction without overwriting
    const customLL = document.getElementById('customLandingDirectionLL');
    const customRR = document.getElementById('customLandingDirectionRR');
    if (customLL && Settings.state.userSettings.customLandingDirectionLL !== '' && !isNaN(Settings.state.userSettings.customLandingDirectionLL)) {
        customLL.value = Settings.state.userSettings.customLandingDirectionLL;
    }
    if (customRR && Settings.state.userSettings.customLandingDirectionRR !== '' && !isNaN(Settings.state.userSettings.customLandingDirectionRR)) {
        customRR.value = Settings.state.userSettings.customLandingDirectionRR;
    }
    const separation = JumpPlanner.getSeparationFromTAS(Settings.state.userSettings.aircraftSpeedKt);
    setInputValue('jumperSeparation', separation);
    Settings.state.userSettings.jumperSeparation = separation;
    Settings.save();

    // Set initial tooltip and style for locked state
    const landingPatternCheckbox = document.getElementById('showLandingPattern');
    const calculateJumpCheckbox = document.getElementById('calculateJumpCheckbox');
    if (landingPatternCheckbox) {
        landingPatternCheckbox.title = (Settings.isFeatureUnlocked('landingPattern') && Settings.state.isLandingPatternUnlocked) ? '' : 'Feature locked. Click to enter password.';
        landingPatternCheckbox.style.opacity = (Settings.isFeatureUnlocked('landingPattern') && Settings.state.isLandingPatternUnlocked) ? '1' : '0.5';
        console.log('Initialized showLandingPattern UI:', { checked: landingPatternCheckbox.checked, opacity: landingPatternCheckbox.style.opacity });
    }
    if (calculateJumpCheckbox) {
        calculateJumpCheckbox.title = (Settings.isFeatureUnlocked('calculateJump') && Settings.state.isCalculateJumpUnlocked) ? '' : 'Feature locked. Click to enter password.';
        calculateJumpCheckbox.style.opacity = (Settings.isFeatureUnlocked('calculateJump') && Settings.state.isCalculateJumpUnlocked) ? '1' : '0.5';
        console.log('Initialized calculateJumpCheckbox UI:', { checked: calculateJumpCheckbox.checked, opacity: calculateJumpCheckbox.style.opacity });
    }

    const jumpMasterCheckbox = document.getElementById('showJumpMasterLine');
    if (jumpMasterCheckbox) {
        jumpMasterCheckbox.disabled = !Settings.state.userSettings.trackPosition;
        jumpMasterCheckbox.style.opacity = jumpMasterCheckbox.disabled ? '0.5' : '1';
        jumpMasterCheckbox.title = jumpMasterCheckbox.disabled ? 'Enable Live Tracking to use Jump Master Line' : '';
    }

    const directionSpan = document.getElementById('jumpRunTrackDirection');
    if (directionSpan) directionSpan.textContent = '-'; // Initial placeholder
    updateUIState();
}
function updateUIState() {
    const info = document.getElementById('info');
    if (info) info.style.display = Settings.state.userSettings.showTable ? 'block' : 'none';
    const customLL = document.getElementById('customLandingDirectionLL');
    const customRR = document.getElementById('customLandingDirectionRR');
    const showJumpRunTrackCheckbox = document.getElementById('showJumpRunTrack');
    const showExitAreaCheckbox = document.getElementById('showExitAreaCheckbox');
    if (customLL) customLL.disabled = Settings.state.userSettings.landingDirection !== 'LL';
    if (customRR) customRR.disabled = Settings.state.userSettings.landingDirection !== 'RR';
    if (showJumpRunTrackCheckbox) showJumpRunTrackCheckbox.disabled = !Settings.state.userSettings.calculateJump;
    if (showExitAreaCheckbox) showExitAreaCheckbox.disabled = !Settings.state.userSettings.calculateJump; // Disable unless calculateJump is on
    Settings.updateUnitLabels();
}

// == Setup values ==
function setCheckboxValue(id, value) {
    const element = document.getElementById(id);
    if (element) element.checked = value;
}
function setElementValue(id, value) {
    const element = document.getElementById(id);
    if (element) element.value = value;
    else console.warn(`Element ${id} not found`);
}
export function setInputValue(id, value) {
    const element = document.getElementById(id);
    if (element) element.value = value;
}
export function setInputValueSilently(id, value) {
    const input = document.getElementById(id);
    if (input) {
        const lastValue = input.value;
        input.value = value;
        console.log(`Set ${id} silently:`, { old: lastValue, new: value });
    }
}
function setRadioValue(name, value) {
    const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (radio) radio.checked = true;
    else console.warn(`Radio ${name} with value ${value} not found`);
}
export async function updateAllDisplays() {
    console.log('updateAllDisplays called');
    try {
        const sliderIndex = getSliderValue();
        if (AppState.weatherData && AppState.lastLat && AppState.lastLng) {
            await updateWeatherDisplay(sliderIndex);
            if (AppState.lastAltitude !== 'N/A') calculateMeanWind();
            if (Settings.state.userSettings.showLandingPattern) updateLandingPatternDisplay();
            if (Settings.state.userSettings.calculateJump) {
                debouncedCalculateJump();
                if (Settings.state.userSettings.showJumpRunTrack) updateJumpRunTrackDisplay();
            }
            mapManager.recenterMap();
        }

    } catch (error) {
        console.error('Error in updateAllDisplays:', error);
    }
}

function setupAppEventListeners() {
    console.log("[App] Setting up application event listeners...");

    document.addEventListener('tracking:started', () => {
        const jumpMasterCheckbox = document.getElementById('showJumpMasterLine');
        if (jumpMasterCheckbox) {
            jumpMasterCheckbox.disabled = false;
            jumpMasterCheckbox.style.opacity = '1';
            jumpMasterCheckbox.title = '';
        }
    });

    document.addEventListener('tracking:stopped', () => {
        const jumpMasterCheckbox = document.getElementById('showJumpMasterLine');
        if (jumpMasterCheckbox) {
            jumpMasterCheckbox.checked = false;
            jumpMasterCheckbox.disabled = true;
            jumpMasterCheckbox.style.opacity = '0.5';
            jumpMasterCheckbox.title = 'Enable Live Tracking to use Jump Master Line';
        }
        if (Settings.state.userSettings.showJumpMasterLine) {
            Settings.state.userSettings.showJumpMasterLine = false;
            Settings.save();
        }
        updateJumpMasterLineAndPanel();
    });

    document.addEventListener('ui:showJumpMasterLineChanged', () => {
        updateJumpMasterLineAndPanel();
    });

    document.addEventListener('jml:targetChanged', () => {
        updateJumpMasterLineAndPanel();
    });

    document.addEventListener('tracking:positionUpdated', (event) => {
        updateJumpMasterLineAndPanel(event.detail);
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    initializeApp();
    initializeUIElements(); // <-- HIER DEN AUFRUF HINZUFÜGEN
    await mapManager.initializeMap();
    setupCacheManagement(); // <-- NEUER AUFRUF HIER
    setupCacheSettings();
    setupAppEventListeners();

    // EINZIGER AUFRUF FÜR ALLE EVENT LISTENER
    EventManager.initializeEventListeners();

    Coordinates.initializeLocationSearch();
    document.addEventListener('cutaway:marker_placed', () => {
        console.log("App: Event 'cutaway:marker_placed' empfangen. Neuberechnung wird ausgelöst.");
        if (AppState.weatherData && AppState.lastLat && AppState.lastLng) {
            calculateJump();
        }
    });
    // NEU: track:dragend-Listener hier platzieren
    document.addEventListener('track:dragend', (event) => {
        console.log("App: Event 'track:dragend' empfangen. Neuberechnung der Offsets relativ zum DIP.");

        const { newPosition, originalTrackData } = event.detail;

        // 1. Hole den DIP (Bezugspunkt) und die Track-Daten
        const dipPosition = L.latLng(AppState.lastLat, AppState.lastLng);
        const trackLength = originalTrackData.trackLength;
        const trackDirection = originalTrackData.airplane.bearing;

        // 2. Die neue Position ist das vordere Ende des Tracks. Berechne daraus den neuen Mittelpunkt des Tracks.
        const newEndPoint = newPosition;
        const [newCenterLat, newCenterLng] = Utils.calculateNewCenter(
            newEndPoint.lat,
            newEndPoint.lng,
            trackLength / 2, // Distanz
            (trackDirection + 180) % 360 // Peilung (rückwärts entlang des Tracks)
        );
        const newCenterPoint = L.latLng(newCenterLat, newCenterLng);

        // 3. Berechne den totalen Verschiebungs-Vektor vom DIP zum neuen Mittelpunkt.
        const totalDistance = AppState.map.distance(dipPosition, newCenterPoint);
        const bearingFromDipToCenter = Utils.calculateBearing(dipPosition.lat, dipPosition.lng, newCenterPoint.lat, newCenterPoint.lng);

        // 4. Berechne die Winkeldifferenz zwischen dem Verschiebungs-Vektor und der Track-Richtung.
        let angleDifference = bearingFromDipToCenter - trackDirection;
        // Normalisiere den Winkel auf einen Wert zwischen -180 und 180
        angleDifference = (angleDifference + 180) % 360 - 180;

        // 5. Zerlege die Gesamtverschiebung in Vorwärts- und Quer-Komponenten.
        const angleRad = angleDifference * (Math.PI / 180);
        const forwardOffset = Math.round(totalDistance * Math.cos(angleRad));
        const lateralOffset = Math.round(totalDistance * Math.sin(angleRad));

        // 6. Aktualisiere die Settings und die UI-Eingabefelder.
        Settings.state.userSettings.jumpRunTrackOffset = lateralOffset;
        Settings.state.userSettings.jumpRunTrackForwardOffset = forwardOffset;
        Settings.save();

        setInputValueSilently('jumpRunTrackOffset', lateralOffset);
        setInputValueSilently('jumpRunTrackForwardOffset', forwardOffset);

        // 7. Zeichne den Track neu, um die Änderungen zu übernehmen.
        updateJumpRunTrackDisplay();
    });

    document.addEventListener('location:selected', async (event) => {
        const { lat, lng, source } = event.detail;
        console.log(`App: Event 'location:selected' empfangen. Quelle: ${source}`);

        const loadingElement = document.getElementById('loading');
        if (loadingElement) loadingElement.style.display = 'block';

        try {
            const sliderIndex = getSliderValue();
            const currentTimeToPreserve = AppState.weatherData?.time?.[sliderIndex] || null;

            const newWeatherData = await weatherManager.fetchWeatherForLocation(lat, lng, currentTimeToPreserve);

            if (newWeatherData) {
                AppState.weatherData = newWeatherData;
                AppState.lastLat = lat;
                AppState.lastLng = lng;

                const slider = document.getElementById('timeSlider');
                if (slider) {
                    slider.max = AppState.weatherData.time.length ? AppState.weatherData.time.length - 1 : 0;
                    slider.disabled = slider.max <= 0;

                    let initialIndex = 0;
                    // *** HIER IST DIE KORREKTUR ***
                    if (currentTimeToPreserve && AppState.weatherData.time) {
                        // Dieser Block ist für das Beibehalten der Zeit bei Standortwechsel (funktioniert bereits)
                        const targetTimestamp = luxon.DateTime.fromISO(currentTimeToPreserve, { zone: 'utc' }).toMillis();
                        let minDiff = Infinity;
                        AppState.weatherData.time.forEach((time, idx) => {
                            const diff = Math.abs(luxon.DateTime.fromISO(time, { zone: 'utc' }).toMillis() - targetTimestamp);
                            if (diff < minDiff) {
                                minDiff = diff;
                                initialIndex = idx;
                            }
                        });
                    } else if (AppState.weatherData && AppState.weatherData.time) {
                        // NEUER BLOCK: Dieser else-if-Block ist für den initialen Ladevorgang.
                        // Er findet den Index, der der aktuellen Uhrzeit am nächsten ist.
                        const now = luxon.DateTime.utc().toMillis();
                        let minDiff = Infinity;
                        AppState.weatherData.time.forEach((time, idx) => {
                            const timeMillis = luxon.DateTime.fromISO(time, { zone: 'utc' }).toMillis();
                            const diff = Math.abs(timeMillis - now);
                            if (diff < minDiff) {
                                minDiff = diff;
                                initialIndex = idx;
                            }
                        });
                        console.log(`[app.js] Initial load: Found closest time to now at index ${initialIndex}`);
                    }

                    slider.value = initialIndex; // Setze den Slider auf den korrekt ermittelten Index
                }

                await updateAllDisplays();
                await refreshMarkerPopup();
                Settings.updateModelRunInfo(AppState.lastModelRun, lat, lng);
            } else {
                AppState.weatherData = null;
            }

            await mapManager.createOrUpdateMarker(lat, lng);
            Coordinates.updateCurrentMarkerPosition(lat, lng);
            mapManager.recenterMap(true);
            AppState.isManualPanning = false;

            if (Settings.state.userSettings.showJumpMasterLine) {
                updateJumpMasterLineAndPanel();
            }
        } catch (error) {
            console.error('Fehler beim Verarbeiten von "location:selected":', error);
            displayError(error.message);
        } finally {
            if (loadingElement) loadingElement.style.display = 'none';
        }
    });

    document.addEventListener('map:zoomend', (event) => {
        console.log("App: Event 'map:zoomend' empfangen.");

        // Hier ist jetzt das neue Zuhause für die Anwendungslogik!
        if (Settings.state.userSettings.calculateJump && AppState.weatherData && AppState.lastLat) {
            calculateJump();
        }
        if (Settings.state.userSettings.showJumpRunTrack) {
            updateJumpRunTrackDisplay();
        }
        if (Settings.state.userSettings.showLandingPattern) {
            updateLandingPatternDisplay();
        }

    });
});