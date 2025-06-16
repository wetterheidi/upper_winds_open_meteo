// == Project: Skydiving Weather and Jump Planner ==
// == Constants and Global Variables ==
import { AppState } from './state.js';
import { Utils } from './utils.js';
import { Settings, getInterpolationStep } from './settings.js';
import { UI_DEFAULTS } from './constants.js';
import * as EventManager from './eventManager.js';
import { displayMessage, displayError } from './ui.js';
import * as Coordinates from './coordinates.js';
import * as JumpPlanner from './jumpPlanner.js';
import * as mapManager from './mapManager.js';
import * as weatherManager from './weatherManager.js';
import { getSliderValue } from './ui.js';
import * as AutoupdateManager from './autoupdateManager.js';
import 'leaflet/dist/leaflet.css';
import { DateTime } from 'luxon';
import 'leaflet-gpx';
import * as displayManager from './displayManager.js';
import * as L from 'leaflet';
window.L = L; // <-- DIESE ZEILE MUSS BLEIBEN

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

// == Weather Data Handling ==

/**
 * Holt die Benutzereingaben für die Höhenlimits, stößt die Berechnung des Mittelwindes
 * in 'utils.js' an und schreibt das formatierte Ergebnis in das entsprechende HTML-Element.
 * Dient als Controller-Funktion für die Mittelwind-Anzeige.
 */
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
/**
 * Erstellt eine Textdatei mit den Wetterdaten im ausgewählten Format und stößt den Download an.
 * Passt die Datenaufbereitung je nach gewähltem Format an (HEIDIS, ATAK, etc.).
 * @param {string} format - Das gewünschte Ausgabeformat (z.B. 'HEIDIS', 'ATAK').
 */
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

// == Autoupdate Functionality ==

/**
 * Aktualisiert die Wetterdaten auf die aktuell laufende Stunde.
 * Wird vom autoupdateManager aufgerufen, um sicherzustellen, dass die Anzeige
 * immer die relevanteste Vorhersage zeigt.
 */
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
        await weatherManager.fetchWeatherForLocation(AppState.lastLat, AppState.lastLng, null, false);
        console.log('Weather data fetched for current hour');

        await displayManager.updateWeatherDisplay(currentHour);
        if (AppState.lastAltitude !== 'N/A') {
            calculateMeanWind();
        }
        if (Settings.state.userSettings.calculateJump && Settings.state.isCalculateJumpUnlocked) {
            debouncedCalculateJump();
            JumpPlanner.calculateCutAway();
            if (Settings.state.userSettings.showJumpRunTrack) {
                displayManager.updateJumpRunTrackDisplay();
            }
        }
        console.log('Updated all displays for current hour');
    } catch (error) {
        console.error('Error updating to current hour:', error);
        Utils.handleError('Failed to update weather data: ' + error.message);
    }
}

// == Landing Pattern, Jump and Free Fall Stuff ==

/**
 * Orchestriert die gesamte Berechnung und Visualisierung des Sprungablaufs.
 * Holt die notwendigen Daten aus dem AppState, ruft die Berechnungslogik
 * im jumpPlanner auf und weist den mapManager an, die Ergebnisse (Exit-Kreise,
 * Canopy-Bereiche, Cut-Away-Punkt) auf der Karte zu zeichnen.
 */
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
        displayManager.updateJumpRunTrackDisplay();
    }
}
export function calculateJumpRunTrack() {
    if (!Settings.state.userSettings.showJumpRunTrack || !Settings.state.userSettings.calculateJump || !AppState.weatherData || !AppState.lastLat || !AppState.lastLng) {
        console.log('Skipping calculateJumpRunTrack: conditions not met');
        return null;
    }
    console.log('Calculating jump run track...');
    displayManager.updateJumpRunTrackDisplay();
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

// == Live Tracking ==
export function updateJumpMasterLineAndPanel(positionData = null) {
    // Die Variable, die steuert, ob die Linie angezeigt werden soll.
    const showJML = Settings.state.userSettings.showJumpMasterLine;

    // --- NEUE, ROBUSTERE LOGIK ---

    // 1. Prüfe als Allererstes, ob die Linie überhaupt sichtbar sein soll.
    if (!showJML) {
        // Wenn nicht, lösche die Linie und blende das Info-Panel aus. Fertig.
        mapManager.clearJumpMasterLine();
        mapManager.hideLivePositionControl();
        return;
    }

    // 2. Nur wenn die Linie angezeigt werden soll, prüfen wir, ob die dafür nötigen Daten da sind.
    if (!AppState.liveMarker) {
        // Wir können die Linie nicht ohne Live-Position zeichnen, also sicherheitshalber aufräumen.
        mapManager.clearJumpMasterLine();
        return;
    }

    // --- Ab hier bleibt die bestehende Logik zum Zeichnen der Linie unverändert ---
    const livePos = AppState.liveMarker.getLatLng();
    if (!livePos) {
        return;
    }

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
    let targetPos = null;
    let targetName = '';

    if (Settings.state.userSettings.jumpMasterLineTarget === 'HARP' && AppState.harpMarker) {
        targetPos = AppState.harpMarker.getLatLng();
        targetName = 'HARP';
    } else if (AppState.currentMarker) {
        targetPos = AppState.currentMarker.getLatLng();
        targetName = 'DIP';
    }

    if (targetPos) {
        const distance = AppState.map.distance(livePos, targetPos);
        const bearing = Math.round(Utils.calculateBearing(livePos.lat, livePos.lng, targetPos.lat, targetPos.lng));
        const speedMs = data.speedMs > 1 ? data.speedMs : 1;
        const tot = Math.round(distance / speedMs);
        jumpMasterLineData = { distance, bearing, tot, target: targetName };
        mapManager.drawJumpMasterLine(livePos, targetPos);
    }

    const settingsForPanel = {
        heightUnit: Settings.getValue('heightUnit', 'radio', 'm'),
        effectiveWindUnit: Settings.getValue('windUnit', 'radio', 'kt') === 'bft' ? 'kt' : Settings.getValue('windUnit', 'radio', 'kt'),
        coordFormat: Settings.getValue('coordFormat', 'radio', 'Decimal'),
        refLevel: Settings.getValue('refLevel', 'radio', 'AGL')
    };

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
    applySettingToSelect('modelSelect', Settings.state.userSettings.model);
    applySettingToRadio('refLevel', Settings.state.userSettings.refLevel);
    applySettingToRadio('heightUnit', Settings.state.userSettings.heightUnit);
    applySettingToRadio('temperatureUnit', Settings.state.userSettings.temperatureUnit);
    applySettingToRadio('windUnit', Settings.state.userSettings.windUnit);
    applySettingToRadio('timeZone', Settings.state.userSettings.timeZone);
    applySettingToRadio('coordFormat', Settings.state.userSettings.coordFormat);
    applySettingToRadio('downloadFormat', Settings.state.userSettings.downloadFormat);
    applySettingToRadio('landingDirection', Settings.state.userSettings.landingDirection);
    applySettingToInput('canopySpeed', Settings.state.userSettings.canopySpeed);
    applySettingToInput('descentRate', Settings.state.userSettings.descentRate);
    applySettingToInput('legHeightDownwind', Settings.state.userSettings.legHeightDownwind);
    applySettingToInput('legHeightBase', Settings.state.userSettings.legHeightBase);
    applySettingToInput('legHeightFinal', Settings.state.userSettings.legHeightFinal);
    applySettingToInput('customLandingDirectionLL', Settings.state.userSettings.customLandingDirectionLL);
    applySettingToInput('customLandingDirectionRR', Settings.state.userSettings.customLandingDirectionRR);
    applySettingToInput('lowerLimit', Settings.state.userSettings.lowerLimit);
    applySettingToInput('upperLimit', Settings.state.userSettings.upperLimit);
    applySettingToInput('openingAltitude', Settings.state.userSettings.openingAltitude);
    applySettingToInput('exitAltitude', Settings.state.userSettings.exitAltitude);
    applySettingToInput('interpStepSelect', Settings.state.userSettings.interpStep);
    applySettingToInput('aircraftSpeedKt', Settings.state.userSettings.aircraftSpeedKt);
    applySettingToInput('jumpRunTrackOffset', Settings.state.userSettings.jumpRunTrackOffset);
    applySettingToInput('numberOfJumpers', Settings.state.userSettings.numberOfJumpers);
    applySettingToCheckbox('showTableCheckbox', Settings.state.userSettings.showTable);
    applySettingToCheckbox('calculateJumpCheckbox', Settings.state.userSettings.calculateJump);
    applySettingToCheckbox('showLandingPattern', Settings.state.userSettings.showLandingPattern);
    applySettingToCheckbox('showJumpRunTrack', Settings.state.userSettings.showJumpRunTrack);
    applySettingToCheckbox('showCanopyAreaCheckbox', Settings.state.userSettings.showCanopyArea);
    applySettingToCheckbox('showExitAreaCheckbox', Settings.state.userSettings.showExitArea);
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
    applySettingToInput('jumperSeparation', separation);
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
export function updateUIState() {
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
// in app.js

/**
 * Aktualisiert den AppState und die UI-Komponenten (insb. den Slider)
 * basierend auf neu geladenen Wetterdaten.
 * @param {object} newWeatherData Die neu von der API abgerufenen Wetterdaten.
 */
export async function updateUIWithNewWeatherData(newWeatherData) {
    AppState.weatherData = newWeatherData;
    const slider = document.getElementById('timeSlider');

    if (!slider) return;

    // Hilfsfunktion, um den letzten gültigen Index zu finden
    const findLastValidDataIndex = (weatherData) => {
        // Wir nutzen temperature_2m als repräsentatives Array
        const dataArray = weatherData?.temperature_2m;
        if (!dataArray || dataArray.length === 0) return 0;
        for (let i = dataArray.length - 1; i >= 0; i--) {
            if (dataArray[i] !== null && dataArray[i] !== undefined) {
                return i; // Das ist der letzte Index mit einem gültigen Wert
            }
        }
        return 0; // Fallback, falls alle Werte null sind
    };

    const lastValidIndex = findLastValidDataIndex(newWeatherData);
    console.log(`Daten sind gültig bis Index: ${lastValidIndex}. Setze Slider-Maximum.`);

    slider.max = lastValidIndex;
    slider.disabled = slider.max <= 0;

    // Den initialen Wert des Sliders auf die aktuelle Zeit setzen,
    // aber sicherstellen, dass er nicht außerhalb des neuen Maximums liegt.
    const now = new Date().getTime();
    let closestIndex = 0;
    let minDiff = Infinity;
    newWeatherData.time.forEach((time, idx) => {
        if (idx <= lastValidIndex) { // Nur gültige Zeiten berücksichtigen
            const diff = Math.abs(new Date(time).getTime() - now);
            if (diff < minDiff) {
                minDiff = diff;
                closestIndex = idx;
            }
        }
    });

    slider.value = closestIndex;

    // Nachdem der Slider korrekt eingestellt ist, die gesamte Anzeige aktualisieren
    await updateAllDisplays();
    Settings.updateModelRunInfo(AppState.lastModelRun, AppState.lastLat, AppState.lastLng);
}
/**
 * Stößt eine Aktualisierung verschiedener UI-Komponenten an.
 * Diese Funktion dient als Wrapper, um nach einer Datenänderung mehrere
 * Anzeige-Funktionen aus dem displayManager aufzurufen.
 * @deprecated Diese Funktion wird schrittweise durch direktere Aufrufe in den Event-Handlern ersetzt, um die Logik klarer zu gestalten.
 */
export async function updateAllDisplays() {
    console.log('updateAllDisplays called');
    try {
        const sliderIndex = getSliderValue();
        if (AppState.weatherData && AppState.lastLat && AppState.lastLng) {

            // === DER DIRIGENT BEI DER ARBEIT ===
            // Jeder Schritt wird explizit von hier aus gesteuert.

            // 1. Die Haupt-Wettertabelle anzeigen lassen
            await displayManager.updateWeatherDisplay(sliderIndex);

            // 2. Das Popup des Markers aktualisieren lassen
            await displayManager.refreshMarkerPopup();

            // 3. Die Mittelwind-Berechnung UND Anzeige durchführen (lokale Funktion)
            if (AppState.lastAltitude !== 'N/A') {
                calculateMeanWind();
            }

            // 4. Das Landemuster anzeigen lassen (hat eigene Logik)
            displayManager.updateLandingPatternDisplay();

            // 5. Die Sprung-Visualisierungen steuern
            if (Settings.state.userSettings.calculateJump) {
                calculateJump(); // Diese Funktion kümmert sich um Exit/Canopy/Cutaway
            }

            // 6. Den Jump Run Track steuern
            if (Settings.state.userSettings.showJumpRunTrack) {
                displayManager.updateJumpRunTrackDisplay();
            }
        }

    } catch (error) {
        console.error('Error in updateAllDisplays:', error);
        displayError(error.message);
    }
}

// == Setup values ==
function applySettingToCheckbox(id, value) {
    const element = document.getElementById(id);
    if (element) element.checked = value;
}
function applySettingToSelect(id, value) {
    const element = document.getElementById(id);
    if (element) element.value = value;
    else console.warn(`Element ${id} not found`);
}
export function applySettingToInput(id, value) {
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
function applySettingToRadio(name, value) {
    const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (radio) radio.checked = true;
    else console.warn(`Radio ${name} with value ${value} not found`);
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
    setupAppEventListeners();
    AutoupdateManager.setupAutoupdate();

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
        displayManager.updateJumpRunTrackDisplay();
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
                await updateUIWithNewWeatherData(newWeatherData);
            } else {
                AppState.weatherData = null;
            }

            await mapManager.createOrUpdateMarker(lat, lng);
            await displayManager.refreshMarkerPopup();
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

        const currentZoom = AppState.map.getZoom();

        // Hier ist jetzt das neue Zuhause für die Anwendungslogik!
        if (Settings.state.userSettings.calculateJump && AppState.weatherData && AppState.lastLat) {
            // Prüfe, ob der aktuelle Zoom im gewünschten Bereich liegt
            if (currentZoom >= UI_DEFAULTS.MIN_ZOOM && currentZoom <= UI_DEFAULTS.MAX_ZOOM) {
                // Ja, also Kreise berechnen und zeichnen
                calculateJump();
            } else {
                // Nein, also alle bestehenden Sprung-Visualisierungen löschen
                mapManager.drawJumpVisualization(null);
                //mapManager.drawCutAwayVisualization(null);
            }
        }

        if (Settings.state.userSettings.showJumpRunTrack) {
            if (currentZoom >= UI_DEFAULTS.MIN_ZOOM && currentZoom <= UI_DEFAULTS.MAX_ZOOM) {
                displayManager.updateJumpRunTrackDisplay();
            } else {
                // Nein, also alle bestehenden Sprung-Visualisierungen löschen
                mapManager.drawJumpRunTrack(null);
            }
        }
        if (Settings.state.userSettings.showLandingPattern) {
            displayManager.updateLandingPatternDisplay();
        }

    });

    document.addEventListener('autoupdate:tick', async (event) => {
        // Nur reagieren, wenn Autoupdate in den Settings auch wirklich aktiv ist
        if (!Settings.state.userSettings.autoupdate) {
            return;
        }

        const now = new Date();
        const slider = document.getElementById('timeSlider');
        if (!slider) return;

        const currentUtcHour = now.getUTCHours();
        const sliderHour = parseInt(slider.value, 10);

        // Nur updaten, wenn sich die Stunde geändert hat, oder beim allerersten Start des Timers
        if (currentUtcHour !== sliderHour || event.detail.isInitialTick) {
            console.log(`[App] Autoupdate triggered. Current Hour: ${currentUtcHour}, Slider Hour: ${sliderHour}`);
            await updateToCurrentHour();
        }
    });
});
