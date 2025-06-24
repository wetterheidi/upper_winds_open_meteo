// == Project: Skydiving Weather and Jump Planner ==
// == Constants and Global Variables ==
import { AppState } from '../core/state.js';
import { Utils } from '../core/utils.js';
import { Settings, getInterpolationStep } from '../core/settings.js';
import { UI_DEFAULTS } from '../core/constants.js';
import * as EventManager from './eventManager.js';
import * as Coordinates from '../ui-common/coordinates.js';
import * as JumpPlanner from '../core/jumpPlanner.js';
import * as mapManager from '../ui-common/mapManager.js';
import * as weatherManager from '../core/weatherManager.js';
import { cacheVisibleTiles, cacheTilesForDIP } from '../core/tileCache.js';
import { getSliderValue, displayError, displayMessage, displayProgress, hideProgress, applyDeviceSpecificStyles } from '../ui-common/ui.js';
import * as AutoupdateManager from '../core/autoupdateManager.js';
import { DateTime } from 'luxon';
import * as displayManager from '../ui-common/displayManager.js';
import * as liveTrackingManager from '../core/liveTrackingManager.js'; // <-- DIESE ZEILE HINZUFÜGEN


export const getTemperatureUnit = () => Settings.getValue('temperatureUnit', 'radio', 'C');
export const getHeightUnit = () => Settings.getValue('heightUnit', 'radio', 'm');
export const getWindSpeedUnit = () => Settings.getValue('windUnit', 'radio', 'kt');
export const getCoordinateFormat = () => Settings.getValue('coordFormat', 'radio', 'Decimal');


"use strict";

export const debouncedCalculateJump = Utils.debounce(calculateJump, 300);
export const getDownloadFormat = () => Settings.getValue('downloadFormat', 'radio', 'csv');

// == Tile caching ==
Utils.setErrorHandler(displayError);
Utils.setMessageHandler(displayMessage);
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

    // KORREKTUR: Deklarationen an den Anfang der Funktion verschoben
    const refLevel = document.querySelector('input[name="refLevel"]:checked')?.value || 'AGL';
    const heightUnit = Settings.getValue('heightUnit', 'radio', 'm');
    const windSpeedUnit = Settings.getValue('windUnit', 'radio', 'kt');

    const index = document.getElementById('timeSlider').value || 0;
    const interpolatedData = weatherManager.interpolateWeatherData(
        AppState.weatherData,
        index,
        getInterpolationStep(),
        Math.round(AppState.lastAltitude),
        heightUnit
    );
    let lowerLimitInput = parseFloat(document.getElementById('lowerLimit').value) || 0;
    let upperLimitInput = parseFloat(document.getElementById('upperLimit').value);
    const baseHeight = Math.round(AppState.lastAltitude);

    if (!AppState.weatherData || AppState.lastAltitude === 'N/A') {
        Utils.handleError('Cannot calculate mean wind: missing data or altitude');
        return;
    }

    // Convert inputs to meters
    lowerLimitInput = heightUnit === 'ft' ? lowerLimitInput / 3.28084 : lowerLimitInput;
    upperLimitInput = heightUnit === 'ft' ? upperLimitInput / 3.28084 : upperLimitInput;

    let lowerLimit = refLevel === 'AGL' ? lowerLimitInput + baseHeight : lowerLimitInput;
    let upperLimit = refLevel === 'AGL' ? upperLimitInput + baseHeight : upperLimitInput;

    if (isNaN(lowerLimitInput) || isNaN(upperLimitInput) || lowerLimitInput >= upperLimitInput) {
        Utils.handleError('Invalid layer limits. Ensure Lower < Upper and both are numbers.');
        return;
    }

    if (refLevel === 'AMSL' && upperLimit < baseHeight) {
        Utils.handleError(`The entire selected layer (${Math.round(Utils.convertHeight(lowerLimit, heightUnit))}-${Math.round(Utils.convertHeight(upperLimit, heightUnit))} ${heightUnit}) is below the terrain altitude of ${Math.round(Utils.convertHeight(baseHeight, heightUnit))} ${heightUnit}.`);

        // NEU: Setze das Ergebnisfeld auf einen klaren Status
        document.getElementById('meanWindResult').innerHTML = 'Mean wind: N/A (Layer is below ground)';

        return;
    }

    if (refLevel === 'AMSL' && lowerLimit < baseHeight) {
        // Die Benachrichtigung bleibt erhalten
        Utils.handleMessage(`Note: Lower limit adjusted to terrain altitude (${Math.round(Utils.convertHeight(baseHeight, heightUnit))} ${heightUnit}) as it cannot be below ground level.`);

        // NEU: Berechne den korrigierten Wert in der aktuell angezeigten Einheit
        const correctedLowerLimit = Math.round(Utils.convertHeight(baseHeight, heightUnit));

        // NEU: Aktualisiere das Input-Feld in der UI
        applySettingToInput('lowerLimit', correctedLowerLimit);

        // NEU: Speichere die Korrektur in den Settings
        Settings.state.userSettings.lowerLimit = correctedLowerLimit;
        Settings.save();

        // NEU: Setze die lokale Variable für die laufende Berechnung auf den korrekten Wert (in Metern)
        lowerLimit = baseHeight;
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

    // 1. Anforderungen für das gewählte Format holen
    const formatRequirements = {
        'ATAK': { interpStep: 1000, heightUnit: 'ft', refLevel: 'AGL', windUnit: 'kt' },
        'Windwatch': { interpStep: 100, heightUnit: 'ft', refLevel: 'AGL', windUnit: 'km/h' },
        'HEIDIS': { interpStep: 100, heightUnit: 'm', refLevel: 'AGL', temperatureUnit: 'C', windUnit: 'm/s' },
        'Customized': {} // Keine festen Anforderungen
    };

    const requirements = formatRequirements[format] || {};

    // 2. Export-Einstellungen definieren: Entweder aus den Requirements oder aus der UI
    const exportSettings = {
        interpStep: requirements.interpStep || getInterpolationStep(),
        heightUnit: requirements.heightUnit || Settings.getValue('heightUnit', 'radio', 'm'),
        refLevel: requirements.refLevel || document.querySelector('input[name="refLevel"]:checked')?.value || 'AGL',
        windUnit: requirements.windUnit || Settings.getValue('windUnit', 'radio', 'kt'),
        temperatureUnit: requirements.temperatureUnit || Settings.getValue('temperatureUnit', 'radio', 'C')
    };
    console.log(`Generating export for '${format}' with settings:`, exportSettings);

    // 3. Wetterdaten mit den korrekten Export-Einstellungen interpolieren
    const interpolatedData = weatherManager.interpolateWeatherData(
        AppState.weatherData,
        index,
        exportSettings.interpStep,
        Math.round(AppState.lastAltitude),
        exportSettings.heightUnit // WICHTIG: Die korrekte Einheit wird hier übergeben
    );

    if (!interpolatedData || interpolatedData.length === 0) {
        Utils.handleError('No interpolated data available to download.');
        return;
    }

    // 4. Header und Datenzeilen basierend auf den Export-Einstellungen erstellen
    let content = '';
    let header = '';

    switch (format) {
        case 'ATAK':
            header = `Alt Dir Spd\n${exportSettings.heightUnit}${exportSettings.refLevel}\n`;
            break;
        case 'Windwatch':
            const elevationFt = Math.round(Utils.convertHeight(AppState.lastAltitude, 'ft'));
            header = `Version 1.0, ID = 9999999999\n${time}, Ground Level: ${elevationFt} ft\nWindsond ${model}\nAGL[ft] Wind[°] Speed[km/h]\n`;
            break;
        case 'HEIDIS':
        case 'Customized':
        default:
            header = `h(${exportSettings.heightUnit}${exportSettings.refLevel}) p(hPa) T(${exportSettings.temperatureUnit}) Dew(${exportSettings.temperatureUnit}) Dir(°) Spd(${exportSettings.windUnit}) RH(%)\n`;
            break;
    }
    content += header;

    // Datenzeilen generieren
    interpolatedData.forEach(data => {
        const displayHeight = Math.round(data.displayHeight);
        const displayDir = Math.round(data.dir);
        // Werte explizit in die Ziel-Einheit des Exports umrechnen
        const displaySpd = Utils.convertWind(data.spd, exportSettings.windUnit, 'km/h');
        const formattedSpd = Number.isFinite(displaySpd) ? (exportSettings.windUnit === 'bft' ? Math.round(displaySpd) : displaySpd.toFixed(1)) : 'N/A';

        if (format === 'ATAK' || format === 'Windwatch') {
            content += `${displayHeight} ${displayDir} ${Math.round(displaySpd)}\n`;
        } else { // HEIDIS & Customized
            const displayPressure = data.pressure === 'N/A' ? 'N/A' : data.pressure.toFixed(1);
            const displayTemp = Utils.convertTemperature(data.temp, exportSettings.temperatureUnit);
            const formattedTemp = displayTemp === 'N/A' ? 'N/A' : displayTemp.toFixed(1);
            const displayDew = Utils.convertTemperature(data.dew, exportSettings.temperatureUnit);
            const formattedDew = displayDew === 'N/A' ? 'N/A' : displayDew.toFixed(1);
            const formattedRH = data.rh === 'N/A' ? 'N/A' : Math.round(data.rh);
            content += `${displayHeight} ${displayPressure} ${formattedTemp} ${formattedDew} ${displayDir} ${formattedSpd} ${formattedRH}\n`;
        }
    });

    // 5. Download auslösen (bleibt unverändert)
    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
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
    const index = getSliderValue();
    const interpStep = getInterpolationStep();
    const heightUnit = getHeightUnit();
    let openingAltitude = Settings.state.userSettings.openingAltitude;
    let exitAltitude = Settings.state.userSettings.exitAltitude;

    // NEU: Konvertiere die Höhen in Meter, bevor sie an die Physik-Engine gehen
    if (heightUnit === 'ft') {
        openingAltitude = Utils.convertFeetToMeters(openingAltitude);
        exitAltitude = Utils.convertFeetToMeters(exitAltitude);
    }

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
    const interpolatedData = weatherManager.interpolateWeatherData(
        AppState.weatherData, // Das Haupt-Wetterdatenobjekt
        index,
        interpStep,
        Math.round(AppState.lastAltitude),
        heightUnit
    );


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
    // 1. Grundvoraussetzung: Ist Live-Tracking überhaupt aktiv?
    // Wenn kein Live-Marker da ist, ist Tracking aus -> alles aufräumen und beenden.
    if (!AppState.liveMarker) {
        mapManager.clearJumpMasterLine();
        mapManager.hideLivePositionControl();
        return;
    }

    // 2. Basis-Positionsdaten zusammenstellen
    const livePos = AppState.liveMarker.getLatLng();
    if (!livePos) return; // Sicherheitsabfrage

    const data = positionData || { // Fallback, falls keine neuen Daten übergeben wurden
        latitude: livePos.lat,
        longitude: livePos.lng,
        speedMs: AppState.lastSmoothedSpeedMs,
        direction: AppState.lastDirection,
        deviceAltitude: AppState.lastDeviceAltitude,
        altitudeAccuracy: AppState.lastAltitudeAccuracy,
        accuracy: AppState.lastAccuracy
    };

    // 3. Jump-Master-Line-Daten NUR berechnen, wenn die Checkbox aktiv ist
    const showJML = Settings.state.userSettings.showJumpMasterLine;
    let jumpMasterLineData = null; // Standardmäßig leer

    if (showJML) {
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
    } else {
        // Wenn die Checkbox nicht aktiv ist, sicherstellen, dass die Linie entfernt wird
        mapManager.clearJumpMasterLine();
    }

    // 4. Das Panel IMMER aktualisieren, solange das Tracking läuft
    // Die updateLivePositionControl-Funktion im mapManager ist schlau genug, die JML-Infos
    // nur anzuzeigen, wenn jumpMasterLineData nicht null ist.
    const settingsForPanel = {
        heightUnit: Settings.getValue('heightUnit', 'radio', 'm'),
        effectiveWindUnit: Settings.getValue('windUnit', 'radio', 'kt') === 'bft' ? 'kt' : Settings.getValue('windUnit', 'radio', 'kt'),
        coordFormat: Settings.getValue('coordFormat', 'radio', 'Decimal'),
        refLevel: Settings.getValue('refLevel', 'radio', 'AGL')
    };

    mapManager.updateLivePositionControl({
        ...data,
        showJumpMasterLine: showJML,
        jumpMasterLineData, // ist entweder ein Objekt mit Daten oder null
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


/**
 * Aktualisiert den AppState und die UI-Komponenten (insb. den Slider)
 * basierend auf neu geladenen Wetterdaten.
 * @param {object} newWeatherData Die neu von der API abgerufenen Wetterdaten.
 */
export async function updateUIWithNewWeatherData(newWeatherData, preservedIndex = null) {
    AppState.weatherData = newWeatherData;
    const slider = document.getElementById('timeSlider');

    if (!slider) return;

    // ... (Logik für lastValidIndex bleibt unverändert) ...
    const findLastValidDataIndex = (weatherData) => {
        const dataArray = weatherData?.temperature_2m;
        if (!dataArray || dataArray.length === 0) return 0;
        for (let i = dataArray.length - 1; i >= 0; i--) {
            if (dataArray[i] !== null && dataArray[i] !== undefined) {
                return i;
            }
        }
        return 0;
    };

    const lastValidIndex = findLastValidDataIndex(newWeatherData);
    slider.max = lastValidIndex;
    slider.disabled = slider.max <= 0;

    // NEUE LOGIK:
    // Wenn ein Index übergeben wurde und dieser gültig ist, verwenden wir ihn.
    // Ansonsten verwenden wir das Standardverhalten (aktuelle Stunde).
    if (preservedIndex !== null && preservedIndex <= lastValidIndex) {
        slider.value = preservedIndex;
        console.log(`Slider restored to preserved index: ${preservedIndex}`);
    } else {
        const currentUtcHour = new Date().getUTCHours();
        if (currentUtcHour <= lastValidIndex) {
            slider.value = currentUtcHour;
        } else {
            slider.value = lastValidIndex;
        }
        console.log(`Slider set to default (current hour or max): ${slider.value}`);
    }

    // ... (restliche Funktion bleibt unverändert)
    await displayManager.updateWeatherDisplay(slider.value, 'weather-table-container', 'selectedTime');
    await displayManager.refreshMarkerPopup();
    if (AppState.lastAltitude !== 'N/A') {
        calculateMeanWind();
    }
    Settings.updateModelRunInfo(AppState.lastModelRun, AppState.lastLat, AppState.lastLng);
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

    document.addEventListener('map:moved', () => {
        console.log('[main-mobile] Map has moved or zoomed. Updating visualizations based on new view.');

        // Die komplette Logik aus dem alten mapMoveHandler kommt hierher:
        const currentZoom = AppState.map.getZoom();

        if (Settings.state.userSettings.calculateJump && AppState.weatherData && AppState.lastLat) {
            if (currentZoom >= UI_DEFAULTS.MIN_ZOOM && currentZoom <= UI_DEFAULTS.MAX_ZOOM) {
                calculateJump();
            } else {
                mapManager.drawJumpVisualization(null);
            }
        }
        if (Settings.state.userSettings.showJumpRunTrack) {
            if (currentZoom >= UI_DEFAULTS.MIN_ZOOM && currentZoom <= UI_DEFAULTS.MAX_ZOOM) {
                displayManager.updateJumpRunTrackDisplay();
            } else {
                mapManager.drawJumpRunTrack(null);
            }
        }
        if (Settings.state.userSettings.showLandingPattern) {
            displayManager.updateLandingPatternDisplay();
        }

        // Die Caching-Logik kann hier ebenfalls angestoßen werden, falls gewünscht,
        // oder separat bleiben, wie im eventManager gezeigt.
        cacheVisibleTiles({
            map: AppState.map,
            baseMaps: AppState.baseMaps,
            onProgress: displayProgress,
            onComplete: (message) => {
                hideProgress();
                if (message) Utils.handleMessage(message);
            },
            onCancel: () => {
                hideProgress();
                Utils.handleMessage('Caching cancelled.');
            }
        });
    });

    document.addEventListener('map:location_selected', async (event) => {
        const { lat, lng, source } = event.detail;
        console.log(`App: Event 'map:location_selected' von '${source}' empfangen.`);

        // --- HIER IST JETZT DIE GESAMTE ANWENDUNGSLOGIK ---

        // 1. Marker-Position im AppState und UI aktualisieren
        AppState.lastLat = lat;
        AppState.lastLng = lng;
        AppState.lastAltitude = await Utils.getAltitude(lat, lng);

        // Informiere das Coordinates-Modul über die neue Position
        Coordinates.addCoordToHistory(lat, lng);

        // Bewege den Marker (falls die Aktion nicht schon vom Marker selbst kam)
        if (source !== 'marker_drag') {
            // Annahme: Sie haben eine moveMarker-Funktion im mapManager
            // Dies ist ein Befehl von app.js an mapManager.js
            mapManager.moveMarker(lat, lng);
        }

        // 2. Kernlogik ausführen
        resetJumpRunDirection(true); // resetJumpRunDirection muss in app.js sein
        await weatherManager.fetchWeatherForLocation(lat, lng); // fetchWeather... muss in app.js sein

        if (Settings.state.userSettings.calculateJump) {
            calculateJump(); // calculateJump muss in app.js sein
            JumpPlanner.calculateCutAway();
        }

        mapManager.recenterMap(true); // recenterMap ist jetzt im mapManager
        AppState.isManualPanning = false;

        // 3. UI-Updates anstoßen, die von den neuen Daten abhängen
        displayManager.updateJumpRunTrackDisplay(); // update... Funktionen sind jetzt im mapManager
        displayManager.updateLandingPatternDisplay();
    });

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

    document.addEventListener('track:loaded', async (event) => {
        const loadingElement = document.getElementById('loading');
        try {
            const { lat, lng, timestamp, historicalDate, summary } = event.detail;
            console.log('[main-mobile] Event "track:loaded" empfangen, starte Aktionen.');

            // =======================================================
            // HIER DIE NEUE LOGIK EINFÜGEN
            // =======================================================
            if (historicalDate) {
                console.log("Historischer Track geladen, deaktiviere Autoupdate.");
                const autoupdateCheckbox = document.getElementById('autoupdateCheckbox');
                if (autoupdateCheckbox) {
                    autoupdateCheckbox.checked = false;
                }
                // Stoppe den laufenden Autoupdate-Prozess
                AutoupdateManager.stopAutoupdate();
                // Speichere die neue Einstellung
                Settings.state.userSettings.autoupdate = false;
                Settings.save();
                Utils.handleMessage("Autoupdate disabled for historical track viewing.");
            }
            // =======================================================
            // ENDE DER NEUEN LOGIK
            // =======================================================

            await mapManager.createOrUpdateMarker(lat, lng);
            const newWeatherData = await weatherManager.fetchWeatherForLocation(lat, lng, timestamp);
            if (newWeatherData) {
                AppState.weatherData = newWeatherData; // Daten im AppState speichern

                // 2. Den Slider auf den richtigen Zeitpunkt setzen
                const slider = document.getElementById('timeSlider');
                if (slider && AppState.weatherData.time) {
                    slider.max = AppState.weatherData.time.length - 1;
                    slider.disabled = slider.max <= 0;

                    // Finde den Index, der am besten zum Track-Zeitstempel passt
                    const targetTimestamp = new Date(timestamp).getTime();
                    let bestIndex = 0;
                    let minDiff = Infinity;
                    AppState.weatherData.time.forEach((time, idx) => {
                        const diff = Math.abs(new Date(time).getTime() - targetTimestamp);
                        if (diff < minDiff) {
                            minDiff = diff;
                            bestIndex = idx;
                        }
                    });
                    slider.value = bestIndex; // Slider positionieren!
                }
            }
            console.log("Performing specific updates after track load...");
            await displayManager.updateWeatherDisplay(getSliderValue());
            await displayManager.refreshMarkerPopup();
            calculateMeanWind();
            calculateJump(); // Diese Funktion beinhaltet bereits die nötigen Checks und ruft auch calculateCutAway auf
            displayManager.updateLandingPatternDisplay();
            updateJumpMasterLineAndPanel();

            const infoEl = document.getElementById('info');
            if (infoEl && summary) {
                const modelDisplayRegex = /(<br><strong>Available Models:<\/strong><ul>.*?<\/ul>|<br><strong>Available Models:<\/strong> None)/s;
                const modelInfoMatch = infoEl.innerHTML.match(modelDisplayRegex);
                infoEl.innerHTML = summary + (modelInfoMatch ? modelInfoMatch[0] : '');
            }

            if (historicalDate) {
                const historicalDatePicker = document.getElementById('historicalDatePicker');
                if (historicalDatePicker) historicalDatePicker.value = historicalDate;
            }

        } catch (error) {
            console.error('Fehler bei der Verarbeitung von track:loaded:', error);
            Utils.handleError('Konnte Track-Daten nicht vollständig verarbeiten.');
        } finally {
            if (loadingElement) {
                loadingElement.style.display = 'none';
            }
        }
    });

    document.addEventListener('tracking:positionUpdated', (event) => {
        updateJumpMasterLineAndPanel(event.detail);
    });

    document.addEventListener('jml:targetChanged', () => {
        updateJumpMasterLineAndPanel();
    });

    document.addEventListener('ui:sliderChanged', async (e) => {
        console.log("[main-mobile] Event 'ui:sliderChanged' empfangen, spezifische Updates werden ausgeführt.");

        try {
            const sliderIndex = getSliderValue();
            if (AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                // 1. Die Haupt-Wettertabelle anzeigen lassen
                await displayManager.updateWeatherDisplay(sliderIndex);
                // 2. Das Popup des Markers aktualisieren lassen
                await displayManager.refreshMarkerPopup();
                // 3. Die Mittelwind-Berechnung UND Anzeige durchführen
                if (AppState.lastAltitude !== 'N/A') {
                    calculateMeanWind();
                }
                // 4. Das Landemuster anzeigen lassen
                displayManager.updateLandingPatternDisplay();
                // 5. Die Sprung-Visualisierungen steuern
                if (Settings.state.userSettings.calculateJump) {
                    calculateJump();
                }
                // 6. Den Jump Run Track steuern
                if (Settings.state.userSettings.showJumpRunTrack) {
                    displayManager.updateJumpRunTrackDisplay();
                }
            }
        } catch (error) {
            console.error('Error during slider update:', error);
            displayError(error.message);
        }
    });

    document.addEventListener('ui:radioGroupChanged', async (e) => {
        const { name } = e.detail;
        console.log(`[main-mobile] Radio group '${name}' changed. Performing specific updates.`);

        // Zuerst führen wir Aktionen aus, die fast immer nötig sind,
        // oder die die Grundlage für weitere Berechnungen bilden.
        await displayManager.updateWeatherDisplay(getSliderValue());

        // Jetzt steuern wir spezifische Aktionen basierend auf der geänderten Einstellung
        switch (name) {
            case 'heightUnit':
                // Ihr Wunsch: Koordinaten-Anzeige bei Mausover aktualisieren
                if (AppState.lastMouseLatLng) {
                    const { lat, lng } = AppState.lastMouseLatLng;
                    const coordFormat = getCoordinateFormat();
                    let coordText = coordFormat === 'MGRS' ? `MGRS: ${Utils.decimalToMgrs(lat, lng)}` : `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;
                    debouncedGetElevationAndQFE(lat, lng, { lat, lng }, ({ elevation, qfe }, requestLatLng) => {
                        if (AppState.lastMouseLatLng && Math.abs(AppState.lastMouseLatLng.lat - requestLatLng.lat) < 0.05) {
                            const heightUnit = getHeightUnit(); // Holt die *neue* Einheit
                            let displayElevation = (elevation !== 'N/A') ? Math.round(Utils.convertHeight(elevation, heightUnit)) : 'N/A';
                            AppState.coordsControl.update(`${coordText}<br>Elevation: ${displayElevation} ${displayElevation === 'N/A' ? '' : heightUnit}`);
                        }
                    });
                }
                // Ihr Wunsch: GPX-Tooltips aktualisieren (Logik bleibt hier, wird bei Bedarf getriggert)
                if (AppState.gpxLayer && AppState.gpxPoints.length > 0) {
                    const groundAltitude = AppState.lastAltitude !== 'N/A' && !isNaN(AppState.lastAltitude) ? parseFloat(AppState.lastAltitude) : null;
                    const windUnit = getWindSpeedUnit();
                    const heightUnit = getHeightUnit();
                    AppState.gpxLayer.eachLayer(layer => {
                        if (layer instanceof L.Polyline) {
                            layer.on('mousemove', function (e) {
                                const latlng = e.latlng;
                                let closestPoint = AppState.gpxPoints[0];
                                let minDist = Infinity;
                                let closestIndex = 0;
                                AppState.gpxPoints.forEach((p, index) => {
                                    const dist = Math.sqrt(Math.pow(p.lat - latlng.lat, 2) + Math.pow(p.lng - latlng.lng, 2));
                                    if (dist < minDist) {
                                        minDist = dist;
                                        closestPoint = p;
                                        closestIndex = index;
                                    }
                                });
                                layer.setTooltipContent(getTooltipContent(closestPoint, closestIndex, AppState.gpxPoints, groundAltitude, windUnit, heightUnit)).openTooltip(latlng);
                            });
                        }
                    });
                }
            // Fall-through: Nach den spezifischen Aktionen sollen auch die allgemeinen Updates für diese Einheit laufen.

            case 'windUnit':
            case 'refLevel':
                // Diese Einheiten beeinflussen alle Berechnungen
                calculateMeanWind();
                calculateJump();
                displayManager.updateLandingPatternDisplay();
                updateJumpMasterLineAndPanel();
                await displayManager.refreshMarkerPopup(); // Das Popup muss auch die neuen Einheiten zeigen
                break;

            case 'coordFormat':
                // Beeinflusst nur das Marker-Popup und das Live-Tracking Panel
                await displayManager.refreshMarkerPopup();
                updateJumpMasterLineAndPanel();
                break;

            case 'landingDirection':
                // Beeinflusst das UI-State und das Landemuster
                updateUIState();
                displayManager.updateLandingPatternDisplay();
                break;

            // Für 'temperatureUnit', 'timeZone', 'downloadFormat' ist keine zusätzliche Aktion nötig,
            // da das `updateWeatherDisplay` am Anfang bereits alles Notwendige erledigt.
        }
    });

    document.addEventListener('ui:inputChanged', async (e) => {
        const { name, value } = e.detail;
        console.log(`[main-mobile] Input for '${name}' changed to '${value}'.`);

        switch (name) {
            // --- Spezialfall: Flugzeuggeschwindigkeit ---
            case 'aircraftSpeedKt':
                const separation = JumpPlanner.getSeparationFromTAS(value);
                setInputValueSilently('jumperSeparation', separation);
                Settings.state.userSettings.jumperSeparation = separation;
                Settings.save();
                if (AppState.weatherData) {
                    debouncedCalculateJump();
                }
                displayManager.updateJumpRunTrackDisplay();
                break;

            // --- NEU: Eigener Fall für die Cut-Away-Höhe ---
            case 'cutAwayAltitude':
                if (AppState.weatherData && AppState.cutAwayLat !== null) {
                    // calculateJump() ruft intern auch die Neuberechnung des Cut-Aways auf.
                    // Dies ist der sauberste Weg, ohne Code zu duplizieren.
                    calculateJump();
                }
                break;

            // --- Fälle, die den kompletten Sprungablauf und das Landemuster beeinflussen ---
            case 'openingAltitude':
            case 'exitAltitude':
            case 'numberOfJumpers':
            case 'jumperSeparation':
            case 'canopySpeed':
            case 'descentRate':
            case 'legHeightFinal':
            case 'legHeightBase':
            case 'legHeightDownwind':
                if (AppState.weatherData) {
                    calculateJump();
                    displayManager.updateLandingPatternDisplay();
                }
                break;

            // ... (die restlichen cases bleiben wie im vorherigen Schritt) ...
            case 'jumpRunTrackDirection':
            case 'jumpRunTrackOffset':
            case 'jumpRunTrackForwardOffset':
                if (AppState.weatherData) {
                    displayManager.updateJumpRunTrackDisplay();
                }
                break;

            case 'lowerLimit':
            case 'upperLimit':
            case 'interpStepSelect':
                if (AppState.weatherData) {
                    await displayManager.updateWeatherDisplay(getSliderValue());
                    calculateMeanWind();
                }
                break;

            case 'customLandingDirectionLL':
            case 'customLandingDirectionRR':
                if (AppState.weatherData) {
                    displayManager.updateLandingPatternDisplay();
                }
                break;

            case 'historicalDatePicker':
                if (AppState.lastLat && AppState.lastLng) {
                    const isoTime = value ? `${value}T00:00:00Z` : null;
                    const newWeatherData = await weatherManager.fetchWeatherForLocation(AppState.lastLat, AppState.lastLng, isoTime);
                    if (newWeatherData) {
                        await updateUIWithNewWeatherData(newWeatherData);
                    }
                }
                break;
        }
    });

    document.addEventListener('ui:showJumpMasterLineChanged', () => {
        updateJumpMasterLineAndPanel();
    });

    document.addEventListener('ui:modelChanged', async (e) => {
        console.log(`[main-mobile] Model changed to ${e.detail.model}. Fetching new data.`);

        if (AppState.lastLat && AppState.lastLng) {
            const timeIndexToPreserve = getSliderValue();
            const currentTime = AppState.weatherData?.time?.[timeIndexToPreserve] || null;

            const newWeatherData = await weatherManager.fetchWeatherForLocation(AppState.lastLat, AppState.lastLng, currentTime);
            if (newWeatherData) {
                await updateUIWithNewWeatherData(newWeatherData, timeIndexToPreserve);
            }
        } else {
            Utils.handleError('Please select a position on the map first.');
        }
    });

    document.addEventListener('ui:jumpFeatureChanged', () => {
        console.log("[main-mobile] Jump feature changed, recalculating jump.");
        if (AppState.weatherData && AppState.lastLat && AppState.lastLng && Settings.state.userSettings.calculateJump) {
            calculateJump();
        }
    });

    document.addEventListener('ui:showJumpRunTrackChanged', (e) => {
        const isChecked = e.detail.checked;
        console.log(`[main-mobile] Jump Run Track toggled: ${isChecked}`);

        // Die komplette if/else-Logik wird hierher verschoben:
        if (isChecked && AppState.weatherData && AppState.lastLat && AppState.lastLng && Settings.state.isCalculateJumpUnlocked && Settings.state.userSettings.calculateJump) {
            calculateJumpRunTrack();
        } else {
            // Die komplette Aufräumlogik
            mapManager.drawJumpRunTrack(null); // Eine saubere Funktion im mapManager ist hier ideal
            const directionInput = document.getElementById('jumpRunTrackDirection');
            if (directionInput) {
                const trackData = JumpPlanner.jumpRunTrack();
                directionInput.value = trackData ? trackData.direction : '';
            }
        }
    });

    document.addEventListener('ui:showCutAwayFinderChanged', (e) => {
        const isChecked = e.detail.checked;
        console.log(`[main-mobile] Cut Away Finder toggled: ${isChecked}`);

        // Die komplette if/else-Logik hierher:
        const submenu = document.getElementById('showCutAwayFinder').closest('li')?.querySelector('ul.submenu');
        if (submenu) {
            submenu.classList.toggle('hidden', !isChecked);
        }

        if (!isChecked) {
            mapManager.clearCutAwayMarker();
            AppState.cutAwayLat = null;
            AppState.cutAwayLng = null;
        }

        if (AppState.weatherData && AppState.lastLat && AppState.lastLng && Settings.state.userSettings.calculateJump) {
            calculateJump();
        }
    });

    document.addEventListener('ui:trackPositionToggled', (e) => {
        const isChecked = e.detail.checked;
        console.log(`[main-mobile] Live Tracking toggled: ${isChecked}`);

        if (isChecked) {
            liveTrackingManager.startPositionTracking();
        } else {
            liveTrackingManager.stopPositionTracking();
        }
    });

    document.addEventListener('ui:landingPatternEnabled', () => {
        console.log('[main-mobile] Landing pattern enabled, updating display.');
        displayManager.updateLandingPatternDisplay();
    });

    document.addEventListener('ui:landingPatternDisabled', () => {
        console.log('[main-mobile] Landing pattern disabled, clearing display.');
        mapManager.drawLandingPattern(null);
    });

    document.addEventListener('ui:showTableChanged', (e) => {
        const isChecked = e.detail.checked;
        console.log(`[main-mobile] Show Table toggled: ${isChecked}`);

        const info = document.getElementById('info');
        if (info) {
            info.style.display = isChecked ? 'block' : 'none';
        }

        // Wenn die Tabelle eingeschaltet wird, muss sie mit den aktuellen Daten gefüllt werden.
        if (isChecked && AppState.weatherData && AppState.lastLat && AppState.lastLng) {
            displayManager.updateWeatherDisplay(getSliderValue());
        }

        mapManager.recenterMap();
    });

    document.addEventListener('ui:jumpMasterLineTargetChanged', () => {
        console.log('[main-mobile] Jump Master Line target changed, updating panel and line.');
        updateJumpMasterLineAndPanel();
    });

    document.addEventListener('ui:downloadClicked', () => {
        console.log('[main-mobile] Download button clicked.');

        // Logik, die vorher im eventManager war:
        const downloadFormat = getDownloadFormat();
        downloadTableAsAscii(downloadFormat);
    });

    document.addEventListener('ui:clearDateClicked', async () => {
        console.log('[main-mobile] Clear date button clicked.');

        const datePicker = document.getElementById('historicalDatePicker');
        if (datePicker) {
            datePicker.value = '';
            if (AppState.lastLat && AppState.lastLng) {
                try {
                    // Aktuelle Wetterdaten neu laden
                    const newWeatherData = await weatherManager.fetchWeatherForLocation(AppState.lastLat, AppState.lastLng, null);

                    if (newWeatherData) {
                        // NEU: Rufe die zentrale Funktion auf, die alle spezifischen Updates durchführt
                        await updateUIWithNewWeatherData(newWeatherData);
                    }
                } catch (error) {
                    displayError(error.message);
                }
            }
        }
    });

    document.addEventListener('ui:recalculateJump', () => {
        console.log('[main-mobile] Recalculate jump triggered.');
        if (AppState.weatherData && AppState.lastLat && AppState.lastLng && Settings.state.userSettings.calculateJump) {
            calculateJump();
        }
    });

    document.addEventListener('ui:invalidInput', (e) => {
        const { id, defaultValue } = e.detail;
        console.log(`[main-mobile] Received invalid input for ${id}. Resetting UI to ${defaultValue}.`);

        // Hier wird die Funktion aufgerufen, die vorher im eventManager stand
        applySettingToInput(id, defaultValue);
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    initializeApp();
    initializeUIElements(); 

    // In der mobilen App soll die Tabelle im Data-Panel immer angezeigt werden.
    Settings.state.userSettings.showTable = true;
    applyDeviceSpecificStyles();

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
                // NEUE LOGIK:
                // Prüfen, ob das Event vom initialen Laden der Seite kommt.
                const isInitialLoad = (source === 'geolocation' || source === 'geolocation_fallback');

                if (isInitialLoad) {
                    // Beim initialen Laden den Zeit-Index NICHT übergeben, 
                    // damit die Funktion die aktuelle Stunde verwendet.
                    await updateUIWithNewWeatherData(newWeatherData);
                } else {
                    // Bei allen anderen Aktionen (Marker ziehen, Suche, etc.)
                    // den eingestellten Zeit-Index beibehalten.
                    await updateUIWithNewWeatherData(newWeatherData, sliderIndex);
                }
            } else {
                AppState.weatherData = null;
            }

            await mapManager.createOrUpdateMarker(lat, lng);
            await displayManager.refreshMarkerPopup();
            mapManager.recenterMap(true);
            AppState.isManualPanning = false;

            if (source === 'geolocation' || source === 'geolocation_fallback') {
                console.log("Starte initiales Caching nach Geolocation...");
                cacheVisibleTiles({
                    map: AppState.map,
                    baseMaps: AppState.baseMaps,
                    onProgress: displayProgress,
                    onComplete: (message) => {
                        hideProgress();
                        if (message) displayMessage(message);
                    },
                    onCancel: () => {
                        hideProgress();
                        displayMessage('Caching cancelled.');
                    }
                });
            }

            if (Settings.state.userSettings.showJumpMasterLine) {
                updateJumpMasterLineAndPanel();
            }
            // Caching für die neue Position anstoßen
            // Die 'geolocation'-Fälle sind schon abgedeckt, jetzt fügen wir die anderen hinzu.
            if (source === 'marker_drag' || source === 'dblclick' || source === 'search') {
                console.log(`Starte Caching für neue Position via ${source}...`);
                cacheTilesForDIP({ // Wichtig: cacheTilesForDIP, nicht cacheVisibleTiles
                    map: AppState.map,
                    lastLat: lat,
                    lastLng: lng,
                    baseMaps: AppState.baseMaps,
                    onProgress: displayProgress,
                    onComplete: (message) => {
                        hideProgress();
                        if (message) displayMessage(message);
                    },
                    onCancel: () => {
                        hideProgress();
                        displayMessage('Caching cancelled.');
                    }
                });
            }
        } catch (error) {
            console.error('Fehler beim Verarbeiten von "location:selected":', error);
            displayError(error.message);
        } finally {
            if (loadingElement) loadingElement.style.display = 'none';
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

    // Teilt Leaflet die neue, korrekte Kartengröße mit.
    setTimeout(() => {
        if (AppState.map) {
            AppState.map.invalidateSize();
        }
    }, 100); // Eine kleine Verzögerung von 100ms ist sicher.
});
