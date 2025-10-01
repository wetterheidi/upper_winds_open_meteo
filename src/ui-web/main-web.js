// =================================================================
//  1. IMPORTE & GLOBALE VARIABLEN
// =================================================================
// Beschreibung: Alle Abhängigkeiten von anderen Modulen werden hier zentral geladen.

import { AppState } from '../core/state.js';
import { Utils } from '../core/utils.js';
import { Settings, getInterpolationStep, setAppContext } from '../core/settings.js';
import { UI_DEFAULTS } from '../core/constants.js';
import * as EventManager from './eventManager.js';
import * as Coordinates from '../ui-web/coordinates.js';
import * as JumpPlanner from '../core/jumpPlanner.js';
import * as mapManager from './mapManager.js';
import * as weatherManager from '../core/weatherManager.js';
import { cacheVisibleTiles, cacheTilesForDIP } from '../core/tileCache.js';
import { getSliderValue, displayError, displayMessage, displayProgress, hideProgress, applyDeviceSpecificStyles } from './ui.js';
import * as AutoupdateManager from '../core/autoupdateManager.js';
import * as displayManager from './displayManager.js';
import * as liveTrackingManager from '../core/liveTrackingManager.js';
import * as EnsembleManager from '../core/ensembleManager.js';
import * as LocationManager from '../core/locationManager.js';
import { DateTime } from 'luxon';

"use strict";

// Eine debounced-Version der Sprungberechnung, um bei schnellen UI-Änderungen
// die Performance zu schonen.
export const debouncedCalculateJump = Utils.debounce(calculateJump, 300);

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

// =================================================================
//  2. EINSTELLUNGS-HELFER (GETTER)
// =================================================================
// Beschreibung: Kurze und klare Funktionen, um auf häufig genutzte
// Benutzereinstellungen zuzugreifen. Das vermeidet wiederholten Code.

Utils.setErrorHandler(displayError);
Utils.setMessageHandler(displayMessage);
Utils.handleMessage = displayMessage;

export const getTemperatureUnit = () => Settings.getValue('temperatureUnit', 'radio', 'C');
export const getHeightUnit = () => Settings.getValue('heightUnit', 'radio', 'm');
export const getWindSpeedUnit = () => Settings.getValue('windUnit', 'radio', 'kt');
export const getCoordinateFormat = () => Settings.getValue('coordFormat', 'radio', 'Decimal');
export const getDownloadFormat = () => Settings.getValue('downloadFormat', 'radio', 'csv');

// =================================================================
//  3. INITIALISIERUNG
// =================================================================
// Beschreibung: Diese Funktionen werden beim Start der Anwendung aufgerufen,
// um den Grundzustand herzustellen, die UI zu initialisieren und
// die Event-Listener zu registrieren.

/**
 * Initialisiert den Hauptzustand der Anwendung. Setzt den App-Kontext (Web vs. Mobile),
 * lädt die Einstellungen und stellt sicher, dass Features (wie der Planner)
 * basierend auf dem Speicher freigeschaltet sind.
 */
function initializeApp() {
    setAppContext(true);
    Settings.initialize();

    // VEREINFACHT: Diese Zeilen sind nicht mehr nötig. Landing Pattern und Calculate Jump
    // sind in der mobilen App immer "verfügbar", da der Planner-Tab immer da ist.
    // Settings.state.isLandingPatternUnlocked = true;
    // Settings.state.isCalculateJumpUnlocked = true;

    // Die Prüfung für den Planner bleibt bestehen, falls Sie sie zukünftig nutzen wollen.
    Settings.state.isPlannerUnlocked = Settings.state.unlockedFeatures.planner;
    console.log('Initial unlock status for planner:', Settings.state.isPlannerUnlocked);

    if (AppState.isInitialized) {
        return;
    }
    AppState.isInitialized = true;
    console.log('Initializing app');
}

/**
 * Füllt alle UI-Elemente (Dropdowns, Checkboxen, Input-Felder) mit den Werten,
 * die aus dem Speicher geladen wurden. Stellt den letzten Zustand der UI wieder her.
 */
function initializeUIElements() {
    applySettingToSelect('modelSelect', Settings.state.userSettings.model);
    applySettingToSelect('refLevel', Settings.state.userSettings.refLevel);
    applySettingToSelect('heightUnit', Settings.state.userSettings.heightUnit);
    applySettingToSelect('temperatureUnit', Settings.state.userSettings.temperatureUnit);
    applySettingToSelect('windUnit', Settings.state.userSettings.windUnit);
    applySettingToSelect('timeZone', Settings.state.userSettings.timeZone);
    applySettingToSelect('coordFormat', Settings.state.userSettings.coordFormat);
    applySettingToSelect('downloadFormat', Settings.state.userSettings.downloadFormat);
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
    applySettingToInput('safetyHeight', Settings.state.userSettings.safetyHeight);
    applySettingToSelect('interpStep', Settings.state.userSettings.interpStep);
    applySettingToInput('aircraftSpeedKt', Settings.state.userSettings.aircraftSpeedKt);
    applySettingToInput('jumpRunTrackOffset', Settings.state.userSettings.jumpRunTrackOffset);
    applySettingToInput('numberOfJumpers', Settings.state.userSettings.numberOfJumpers);
    applySettingToCheckbox('showTableCheckbox', Settings.state.userSettings.showTable);
    applySettingToCheckbox('calculateJumpCheckbox', Settings.state.userSettings.calculateJump);
    applySettingToCheckbox('showLandingPattern', Settings.state.userSettings.showLandingPattern);
    applySettingToCheckbox('showJumpRunTrack', Settings.state.userSettings.showJumpRunTrack);
    applySettingToCheckbox('showCanopyAreaCheckbox', Settings.state.userSettings.showCanopyArea);
    applySettingToCheckbox('showExitAreaCheckbox', Settings.state.userSettings.showExitArea);
    applySettingToCheckbox('showCutAwayFinder', Settings.state.userSettings.showCutAwayFinder);
    applySettingToInput('terrainClearance', Settings.state.userSettings.terrainClearance);
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

// =================================================================
//  4. KERNLOGIK & "CONTROLLER"-FUNKTIONEN
// =================================================================
// Beschreibung: Dies sind die zentralen Funktionen, die Berechnungen anstoßen
// und den Zustand der Anwendung verändern. Sie werden typischerweise durch
// Benutzerinteraktionen (Events) aufgerufen.

/**
 * Orchestriert die gesamte Berechnung und Visualisierung des Sprungablaufs.
 * Diese Funktion ist ein zentraler Controller: Sie sammelt Daten aus der UI und dem AppState,
 * ruft die Berechnungslogik im `jumpPlanner` auf und weist den `mapManager` an,
 * die Ergebnisse (Exit-Kreise, Schirmfahrt-Bereiche etc.) auf der Karte zu zeichnen.
 */
export function calculateJump() {
    const index = getSliderValue();
    const interpStep = getInterpolationStep();
    const heightUnit = getHeightUnit();
    let openingAltitude = Settings.state.userSettings.openingAltitude;
    let exitAltitude = Settings.state.userSettings.exitAltitude;

    // Konvertiere die Höhen in Meter, bevor sie an die Physik-Engine gehen
    if (heightUnit === 'ft') {
        openingAltitude = Utils.convertFeetToMeters(openingAltitude);
        exitAltitude = Utils.convertFeetToMeters(exitAltitude);
    }

    if (!Settings.state.userSettings.calculateJump) {
        mapManager.drawJumpVisualization(null);
        mapManager.drawCutAwayVisualization(null);
        return;
    }

    if (!AppState.weatherData || !AppState.lastLat || !AppState.lastLng) {
        mapManager.drawJumpVisualization(null);
        return;
    }

    // Daten einmal zentral vorbereiten
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
                center: [exitResult.greenLatFull, exitResult.greenLngFull],
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
                center: [exitResult.greenLat, exitResult.greenLng],
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
            cutawayDrawData = {
                center: result.center,
                radius: result.radius,
                tooltipContent: result.tooltipContent
            };
        }
    }
    mapManager.drawCutAwayVisualization(cutawayDrawData);
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

/**
 * Berechnet den Mittelwind für die in der UI definierten Höhenschichten.
 * Liest die Werte aus den Input-Feldern, holt die interpolierten Wetterdaten
 * und ruft die Berechnungslogik in `Utils.js` auf. Das Ergebnis wird
 * direkt in das entsprechende UI-Element geschrieben.
 */
export function calculateMeanWind() {
    console.log('Calculating mean wind with model:', document.getElementById('modelSelect').value, 'weatherData:', AppState.weatherData);

    const refLevel = document.getElementById('refLevel')?.value || 'AGL'; // KORREKTUR: Liest das Dropdown-Menü aus
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

        // Setze das Ergebnisfeld auf einen klaren Status
        document.getElementById('meanWindResult').innerHTML = 'Mean wind: N/A (Layer is below ground)';

        return;
    }

    if (refLevel === 'AMSL' && lowerLimit < baseHeight) {
        // Die Benachrichtigung bleibt erhalten
        Utils.handleMessage(`Note: Lower limit adjusted to terrain altitude (${Math.round(Utils.convertHeight(baseHeight, heightUnit))} ${heightUnit}) as it cannot be below ground level.`);

        //Berechne den korrigierten Wert in der aktuell angezeigten Einheit
        const correctedLowerLimit = Math.round(Utils.convertHeight(baseHeight, heightUnit));

        //Aktualisiere das Input-Feld in der UI
        applySettingToInput('lowerLimit', correctedLowerLimit);

        //Speichere die Korrektur in den Settings
        Settings.state.userSettings.lowerLimit = correctedLowerLimit;
        Settings.save();

        //Setze die lokale Variable für die laufende Berechnung auf den korrekten Wert (in Metern)
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
 * Holt die Wetterdaten für die aktuell eingestellte Stunde, wenn die Autoupdate-Funktion
 * aktiv ist. Stößt danach alle notwendigen UI-Updates und Neuberechnungen an.
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

        await displayManager.updateWeatherDisplay(currentHour, 'weather-table-container', 'selectedTime'); // NEU
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

/**
 * Erstellt eine Textdatei mit den Wetterdaten im ausgewählten Format und stößt den Download an.
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

    const formatRequirements = {
        'ATAK': { interpStep: 1000, heightUnit: 'ft', refLevel: 'AGL', windUnit: 'kt' },
        'Windwatch': { interpStep: 100, heightUnit: 'ft', refLevel: 'AGL', windUnit: 'km/h' },
        'HEIDIS': { interpStep: 100, heightUnit: 'm', refLevel: 'AGL', temperatureUnit: 'C', windUnit: 'm/s' },
        'Customized': {}
    };

    const requirements = formatRequirements[format] || {};

    const exportSettings = {
        interpStep: requirements.interpStep || getInterpolationStep(),
        heightUnit: requirements.heightUnit || Settings.getValue('heightUnit', 'radio', 'm'),
        refLevel: requirements.refLevel || document.querySelector('input[name="refLevel"]:checked')?.value || 'AGL',
        windUnit: requirements.windUnit || Settings.getValue('windUnit', 'radio', 'kt'),
        temperatureUnit: requirements.temperatureUnit || Settings.getValue('temperatureUnit', 'radio', 'C')
    };

    const interpolatedData = weatherManager.interpolateWeatherData(
        AppState.weatherData,
        index,
        exportSettings.interpStep,
        Math.round(AppState.lastAltitude),
        exportSettings.heightUnit
    );

    if (!interpolatedData || interpolatedData.length === 0) {
        Utils.handleError('No interpolated data available to download.');
        return;
    }

    let content = '';
    let header = '';

    switch (format) {
        case 'ATAK':
            header = `Alt\tDir\tSpd\n${exportSettings.heightUnit}${exportSettings.refLevel}\tdeg\tkts\n`;
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

    interpolatedData.forEach(data => {
        const displayHeight = Math.round(data.displayHeight);
        const displayDir = Math.round(data.dir);
        const displaySpd = Utils.convertWind(data.spd, exportSettings.windUnit, 'km/h');
        const formattedSpd = Number.isFinite(displaySpd) ? (exportSettings.windUnit === 'bft' ? Math.round(displaySpd) : displaySpd.toFixed(1)) : 'N/A';

        if (format === 'ATAK' || format === 'Windwatch') {
            content += `${displayHeight}\t${displayDir}\t${Math.round(displaySpd)}\n`;
        } else {
            const displayPressure = data.pressure === 'N/A' ? 'N/A' : data.pressure.toFixed(1);
            const displayTemp = Utils.convertTemperature(data.temp, exportSettings.temperatureUnit);
            const formattedTemp = displayTemp === 'N/A' ? 'N/A' : displayTemp.toFixed(1);
            const displayDew = Utils.convertTemperature(data.dew, exportSettings.temperatureUnit);
            const formattedDew = displayDew === 'N/A' ? 'N/A' : displayDew.toFixed(1);
            const formattedRH = data.rh === 'N/A' ? 'N/A' : Math.round(data.rh);
            content += `${displayHeight} ${displayPressure} ${formattedTemp} ${formattedDew} ${displayDir} ${formattedSpd} ${formattedRH}\n`;
        }
    });

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

/**
 * Erstellt eine Textdatei mit dem zeitlichen Verlauf der Bodendaten (TAB-getrennt) 
 * und stößt den Download an.
 */
async function downloadSurfaceDataAsAscii() {
    if (!AppState.weatherData || !AppState.weatherData.time) {
        Utils.handleError('No weather data available to download.');
        return;
    }

    // NEU: temperature_2m aus den Wetterdaten extrahieren
    const { time, wind_direction_10m, wind_speed_10m, wind_gusts_10m, visibility, weather_code, temperature_2m } = AppState.weatherData;
    const windUnit = getWindSpeedUnit();
    const tempUnit = getTemperatureUnit(); // Temperatureinheit abrufen
    const timeZone = Settings.getValue('timeZone', 'radio', 'Z'); // Holt die aktuelle Zeitzonen-Einstellung
    const model = document.getElementById('modelSelect').value.toUpperCase();
    const timeForFilename = Utils.formatTime(time[0]).replace(' ', '_');
    const filename = `${timeForFilename}_${model}_Surface.txt`;

    const timeHeader = `Time (${timeZone})`;
    let content = `Date\t${timeHeader}\tWind Dir (°)\tWind Spd/Gust (${windUnit})\tVisibility (m)\tWeather\tTemp (${tempUnit})\n`;

    for (let i = 0; i < time.length; i++) {
        const displayTime = await Utils.getDisplayTime(time[i], AppState.lastLat, AppState.lastLng, timeZone);

        // NEU: Trennt Datum und Zeit korrekt, behält die Zeitzonen-Abkürzung bei
        const timeParts = displayTime.split(' ');
        const date = timeParts[0];
        const timeStr = timeParts.length > 1 ? timeParts[1] : ''; // z.B. "1200CEST" oder "1000Z"

        const speed = Utils.convertWind(wind_speed_10m[i], windUnit, 'km/h');
        const gust = Utils.convertWind(wind_gusts_10m[i], windUnit, 'km/h');
        const formattedSpeed = (typeof speed === 'number') ? speed.toFixed(0) : 'N/A';
        const formattedGust = (typeof gust === 'number') ? gust.toFixed(0) : 'N/A';
        const windString = `${formattedSpeed} G ${formattedGust}`;

        const temp = Utils.convertTemperature(temperature_2m[i], tempUnit);
        const formattedTemp = (typeof temp === 'number') ? temp.toFixed(1) : 'N/A';

        const visibilityStr = visibility?.[i] ?? 'N/A';
        const weatherStr = Utils.translateWmoCodeToTaf(weather_code?.[i]);

        // NEU: formatierte Temperatur zur Zeile hinzufügen
        content += `${date}\t${timeStr}\t${wind_direction_10m[i]}\t${windString}\t${visibilityStr}\t${weatherStr}\t${formattedTemp}\n`;
    }

    // Die Logik zum Speichern der Datei bleibt unverändert
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

/**
 * Erstellt einen vollständigen, formatierten Wetter-Tagesbericht und löst den Download aus.
 */
async function exportComprehensiveReport() {
    if (!AppState.weatherData || !AppState.lastLat || !AppState.lastLng) {
        Utils.handleError("No weather data available for the report.");
        return;
    }

    // 1. Header-Informationen und allgemeine Einstellungen sammeln
    const lat = AppState.lastLat;
    const lng = AppState.lastLng;
    const model = document.getElementById('modelSelect').value.toUpperCase();
    const modelRun = AppState.lastModelRun || "N/A";
    const today = DateTime.utc().toFormat('yyyy-MM-dd');
    
    const windUnit = getWindSpeedUnit();
    const tempUnit = getTemperatureUnit();
    const heightUnit = getHeightUnit();
    const timeZone = Settings.getValue('timeZone', 'radio', 'Z');

    let locationName = "Unknown Location";
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        const data = await response.json();
        locationName = data.display_name || `Lat ${lat.toFixed(4)}, Lon ${lng.toFixed(4)}`;
    } catch (e) {
        console.warn("Reverse geocoding failed, using coordinates as location name.");
        locationName = `Lat ${lat.toFixed(4)}, Lon ${lng.toFixed(4)}`;
    }

    let reportContent = `DZMaster - WEATHER BRIEFING\n`;
    reportContent += "============================================================\n";
    reportContent += `Location:       ${locationName}\n`;
    reportContent += `Model:          ${model}\n`;
    reportContent += `Model Run:      ${modelRun}\n`;
    reportContent += `Forecast Day:   ${today}\n`;
    reportContent += "============================================================\n\n";

    // 2. Bodendaten-Tabelle erstellen
    reportContent += "SURFACE DATA (Today)\n";
    reportContent += "------------------------------------------------------------\n";
    
    const { time, wind_direction_10m, wind_speed_10m, wind_gusts_10m, visibility, weather_code, temperature_2m } = AppState.weatherData;
    const timeHeader = `Time(${timeZone})`;

    reportContent += `Date      \t${timeHeader}\tDir\t        Spd(${windUnit})\t        Temp(${tempUnit})\t        Vis(m)\t        Weather\n`;

    const todayIndices = time.map((t, i) => DateTime.fromISO(t).toFormat('yyyy-MM-dd') === today ? i : -1).filter(i => i !== -1);

    for (const i of todayIndices) {
        const displayTime = await Utils.getDisplayTime(time[i], lat, lng, timeZone);
        const [date, timeStr] = displayTime.split(' ');

        const speed = Utils.convertWind(wind_speed_10m[i], windUnit, 'km/h');
        const gust = Utils.convertWind(wind_gusts_10m[i], windUnit, 'km/h');
        const windString = `${(typeof speed === 'number' ? speed.toFixed(0) : 'N/A')} G ${(typeof gust === 'number' ? gust.toFixed(0) : 'N/A')}`;
        
        const temp = Utils.convertTemperature(temperature_2m[i], tempUnit);
        const formattedTemp = (typeof temp === 'number') ? temp.toFixed(1) : 'N/A';

        const visibilityStr = visibility?.[i] ?? 'N/A';
        const weatherStr = Utils.translateWmoCodeToTaf(weather_code?.[i]);

        reportContent += `${date}\t${timeStr}\t${wind_direction_10m[i]}°\t\t${windString}\t\t${formattedTemp}\t\t${visibilityStr}\t\t${weatherStr}\n`;
    }

    // 3. Stündliche Höhendaten im "Customized"-Format hinzufügen
    reportContent += `\n\nUPPER AIR DATA (Today, hourly, up to 3000m AGL)\n`;
    reportContent += "============================================================\n";
    
    const upperAirSettings = { interpStep: 100, heightUnit: heightUnit, refLevel: 'AGL' };

    for (const i of todayIndices) {
        const displayTime = await Utils.getDisplayTime(time[i], lat, lng, 'Z');
        reportContent += `\n--- ${displayTime} ---\n`;
        // NEU: Spaltenüberschrift für Cloud Cover (CC) hinzugefügt
        reportContent += `h(${heightUnit}AGL)\tp(hPa)\tT(${tempUnit})\tDew(${tempUnit})\tDir(°)\tSpd(${windUnit})\tRH(%)\tCC(%)\n`;
        
        const interpolatedData = weatherManager.interpolateWeatherData(
            AppState.weatherData, i, upperAirSettings.interpStep, Math.round(AppState.lastAltitude), upperAirSettings.heightUnit
        );

        interpolatedData
            .filter(data => data.displayHeight <= (heightUnit === 'ft' ? 9843 : 3000))
            .forEach(data => {
                const temp = Utils.convertTemperature(data.temp, tempUnit);
                const dew = Utils.convertTemperature(data.dew, tempUnit);
                const spd = Utils.convertWind(data.spd, windUnit, 'km/h');

                const row = [
                    data.displayHeight,
                    (typeof data.pressure === 'number' ? data.pressure.toFixed(1) : 'N/A'),
                    (typeof temp === 'number' ? temp.toFixed(1) : 'N/A'),
                    (typeof dew === 'number' ? dew.toFixed(1) : 'N/A'),
                    (typeof data.dir === 'number' ? Math.round(data.dir) : 'N/A'),
                    (typeof spd === 'number' ? spd.toFixed(1) : 'N/A'),
                    (typeof data.rh === 'number' ? Math.round(data.rh) : 'N/A'),
                    // NEU: Wert für Cloud Cover hinzugefügt
                    (typeof data.cc === 'number' ? Math.round(data.cc) : 'N/A')
                ];
                reportContent += row.join('\t') + '\n';
            });
    }

    // 4. Download anstoßen (unverändert)
    const filename = `DZMaster_Briefing_${today}.txt`;
    const blob = new Blob([reportContent], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

/**
 * Setzt die manuell eingegebene Richtung für den Jump Run Track zurück
 * und löst bei Bedarf eine Neuzeichnung mit der berechneten Richtung aus.
 * @param {boolean} [triggerUpdate=true] - Wenn true, wird der Track sofort neu gezeichnet.
 */
export function resetJumpRunDirection(triggerUpdate = true) {
    // 1. Gespeicherten Wert in den Settings löschen
    Settings.state.userSettings.customJumpRunDirection = null;
    Settings.save();
    console.log('Persisted custom JRT direction has been reset.');

    // 2. Eingabefeld in der UI leeren
    const directionInput = document.getElementById('jumpRunTrackDirection');
    if (directionInput) {
        directionInput.value = '';
    }

    // 3. Optional die Anzeige aktualisieren (nur wenn der Track noch sichtbar ist)
    if (triggerUpdate && Settings.state.userSettings.showJumpRunTrack && AppState.weatherData) {
        displayManager.updateJumpRunTrackDisplay();
    }
}

// =================================================================
//  5. UI-UPDATE & "VIEW"-FUNKTIONEN
// =================================================================
// Beschreibung: Diese Funktionen sind dafür zuständig, die Benutzeroberfläche
// zu aktualisieren, wenn sich Daten oder der Zustand der Anwendung ändern.

/**
 * Aktualisiert die gesamte Wetteranzeige, nachdem neue Wetterdaten geladen wurden.
 * Setzt den Zeit-Slider, die Wettertabelle, das Marker-Popup und die Modell-Infos
 * auf den neuesten Stand und stößt Neuberechnungen für den Sprungablauf an.
 * @param {object} newWeatherData - Das neu von der API abgerufene Wetterdatenobjekt.
 * @param {number|null} [preservedIndex=null] - Der Index des Sliders, der beibehalten werden soll.
 */
export async function updateUIWithNewWeatherData(newWeatherData, preservedIndex = null) {
    AppState.weatherData = newWeatherData;
    const slider = document.getElementById('timeSlider');

    if (!slider) return;

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

    await displayManager.updateWeatherDisplay(slider.value, 'weather-table-container', 'selectedTime');
    await displayManager.refreshMarkerPopup();
    if (AppState.lastAltitude !== 'N/A') {
        calculateMeanWind();
    }
    displayManager.updateModelInfoPopup();
    console.log("Model changed. Triggering recalculation of jump parameters.");
    displayManager.updateLandingPatternDisplay();
    if (Settings.state.userSettings.calculateJump) {
        calculateJump();
    }
    if (Settings.state.userSettings.showJumpRunTrack) {
        displayManager.updateJumpRunTrackDisplay();
    }
}

/**
 * Aktualisiert den Zustand von UI-Elementen, die voneinander abhängig sind.
 * (z.B. Deaktivieren von Checkboxen, wenn eine übergeordnete Funktion ausgeschaltet ist).
 */
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
}
function updateLockStatesUI() {
    // Update Planner Icon
    const plannerIcon = document.querySelector('.sidebar-icon[data-panel-id="panel-planner"]');
    if (plannerIcon) {
        if (Settings.isFeatureUnlocked('planner')) {
            plannerIcon.style.opacity = '1';
            plannerIcon.title = 'Planner';
        } else {
            plannerIcon.style.opacity = '0.5';
            plannerIcon.title = 'Feature locked. Click to enter password.';
        }
    }

    // Update Data Icon
    const dataIcon = document.querySelector('.sidebar-icon[data-panel-id="panel-data"]');
    if (dataIcon) {
        if (Settings.isFeatureUnlocked('data')) {
            dataIcon.style.opacity = '1';
            dataIcon.title = 'Data';
        } else {
            dataIcon.style.opacity = '0.5';
            dataIcon.title = 'Feature locked. Click to enter password.';
        }
    }
}

/**
 * Aktualisiert die Jump-Master-Linie auf der Karte und die Daten im Jumpmaster-Panel.
 * Wird bei jeder neuen GPS-Position aufgerufen, wenn das Live-Tracking aktiv ist.
 * @param {object|null} [positionData=null] - Die neuesten Positionsdaten vom GPS.
 */
export function updateJumpMasterLineAndPanel(positionData = null) {
    const showJML = Settings.state.userSettings.showJumpMasterLine;
    let dataForDashboard = null;
    let livePos = null;

    // Zuerst prüfen, ob Live-Tracking überhaupt aktiv ist.
    if (AppState.watchId !== null) {
        // Wenn Tracking aktiv ist, haben wir immer Daten für das Haupt-Dashboard.
        livePos = AppState.liveMarker ? AppState.liveMarker.getLatLng() : null;

        dataForDashboard = positionData || { // Nimm neue Daten oder die zuletzt bekannten
            latitude: livePos ? livePos.lat : AppState.lastLatitude,
            longitude: livePos ? livePos.lng : AppState.lastLongitude,
            speedMs: AppState.lastSmoothedSpeedMs,
            direction: AppState.lastDirection,
            deviceAltitude: AppState.lastDeviceAltitude,
            altitudeAccuracy: AppState.lastAltitudeAccuracy,
            accuracy: AppState.lastAccuracy
        };
        dataForDashboard.showJumpMasterLine = showJML; // Füge den Checkbox-Status hinzu
    }

    // Wenn die JML-Linie angezeigt werden soll UND wir eine Position haben:
    if (showJML && livePos) {
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
            // Berechne die Daten und zeichne die Linie
            const distance = AppState.map.distance(livePos, targetPos);
            const bearing = Math.round(Utils.calculateBearing(livePos.lat, livePos.lng, targetPos.lat, targetPos.lng));
            const speedMs = dataForDashboard.speedMs > 1 ? dataForDashboard.speedMs : 1;
            const tot = Math.round(distance / speedMs);

            dataForDashboard.jumpMasterLineData = { distance, bearing, tot, target: targetName };
            mapManager.drawJumpMasterLine(livePos, targetPos);
        }
    } else {
        // Wenn die Linie nicht angezeigt werden soll, räume sie auf.
        mapManager.clearJumpMasterLine();
    }

    // Aktualisiere das Dashboard IMMER am Ende.
    // Die Funktion ist schlau genug zu wissen, was sie mit den Daten (oder null) tun soll.
    updateJumpMasterDashboard(dataForDashboard);
}

function updateJumpMasterDashboard(data) {
    const dashboard = document.getElementById('jumpmaster-dashboard');
    if (!dashboard) return;

    // Dashboard sichtbar machen, wenn Daten vorhanden sind, sonst verstecken.
    if (!data) {
        dashboard.classList.add('hidden');
        return;
    }
    dashboard.classList.remove('hidden');

    // UI-Elemente referenzieren
    const coordsEl = document.getElementById('dashboard-jm-coords');
    const altitudeEl = document.getElementById('dashboard-jm-altitude');
    const directionEl = document.getElementById('dashboard-jm-direction');
    const speedEl = document.getElementById('dashboard-jm-speed');
    const accuracyEl = document.getElementById('dashboard-jm-accuracy');
    const varioEl = document.getElementById('dashboard-jm-vario');

    // Werte formatieren und anzeigen
    const settings = {
        heightUnit: getHeightUnit(),
        effectiveWindUnit: getWindSpeedUnit() === 'bft' ? 'kt' : getWindSpeedUnit(),
        coordFormat: getCoordinateFormat(),
        refLevel: Settings.getValue('refLevel', 'radio', 'AGL')
    };

    const coords = Utils.convertCoords(data.latitude, data.longitude, settings.coordFormat);
    let coordText;

    if (settings.coordFormat === 'MGRS') {
        // MGRS ist ein einzelner String
        coordText = coords.lat;
    } else if (settings.coordFormat === 'DMS') {
        // Format für Grad, Minuten, Sekunden
        const formatDMS = (dms) => `${dms.deg}°${dms.min}'${dms.sec.toFixed(0)}" ${dms.dir}`;
        coordText = `${formatDMS(coords.lat)}, ${formatDMS(coords.lng)}`;
    } else {
        // Standard-Dezimalformat
        coordText = `${coords.lat}, ${coords.lng}`;
    }

    coordsEl.textContent = coordText; // Die korrigierte Zeile

    let altText = "N/A";
    if (data.deviceAltitude !== null) {
        let displayAltitude = (settings.refLevel === 'AGL' && AppState.lastAltitude) ? data.deviceAltitude - parseFloat(AppState.lastAltitude) : data.deviceAltitude;
        altText = `${Math.round(Utils.convertHeight(displayAltitude, settings.heightUnit))} ${settings.heightUnit}`;
    }
    altitudeEl.textContent = altText;

    directionEl.textContent = `${data.direction}°`;
    const displaySpeed = Utils.convertWind(data.speedMs, settings.effectiveWindUnit, 'm/s');
    const formattedSpeed = settings.effectiveWindUnit === 'bft' ? Math.round(displaySpeed) : displaySpeed.toFixed(1);
    speedEl.textContent = `${formattedSpeed} ${settings.effectiveWindUnit}`;
    accuracyEl.textContent = `± ${Math.round(Utils.convertHeight(data.accuracy, settings.heightUnit))} ${settings.heightUnit}`;
    if (varioEl) {
        const { rateOfClimbMps } = data;
        const varioUnit = settings.heightUnit === 'ft' ? 'ft/min' : 'm/s';
        let displayVario = 'N/A';
        varioEl.classList.remove('vario-climb', 'vario-descent');

        if (rateOfClimbMps !== null && Number.isFinite(rateOfClimbMps)) {
            if (varioUnit === 'ft/min') {
                // Umrechnung von m/s zu ft/min ( * 3.28084 * 60)
                displayVario = (rateOfClimbMps * 196.85).toFixed(0);
            } else {
                displayVario = rateOfClimbMps.toFixed(1);
            }

            // Farbliche Kennzeichnung
            if (rateOfClimbMps > 0.5) {
                varioEl.classList.add('vario-climb');
            } else if (rateOfClimbMps < -0.5) {
                varioEl.classList.add('vario-descent');
            }
        }
        varioEl.textContent = `${displayVario} ${varioUnit}`;
    }

    const jmlDetails = document.getElementById('jumpmaster-line-details');
    const showJML = data.showJumpMasterLine;

    // Schritt 1: Blende den Detail-Container basierend auf der Checkbox ein oder aus.
    jmlDetails.classList.toggle('hidden', !showJML);

    // Schritt 2: Wenn der Container sichtbar ist, fülle ihn.
    if (showJML) {
        const targetLabel = document.getElementById('dashboard-jm-target-label');
        const bearingEl = document.getElementById('dashboard-jm-bearing');
        const distanceEl = document.getElementById('dashboard-jm-distance');
        const totEl = document.getElementById('dashboard-jm-tot');

        // Entweder mit echten Daten füllen...
        if (data.jumpMasterLineData) {
            const settings = { heightUnit: getHeightUnit() }; // Holen der Einheit für die Distanz
            targetLabel.textContent = `JML to ${data.jumpMasterLineData.target}`;
            bearingEl.textContent = `${data.jumpMasterLineData.bearing}°`;
            distanceEl.textContent = `${Math.round(Utils.convertHeight(data.jumpMasterLineData.distance, settings.heightUnit))} ${settings.heightUnit}`;
            totEl.textContent = data.jumpMasterLineData.tot < 1200 ? `X - ${data.jumpMasterLineData.tot} s` : 'N/A';
        }
        // ...oder mit Platzhaltern, falls noch keine Daten da sind.
        else {
            targetLabel.textContent = 'JML to --';
            bearingEl.textContent = '--';
            distanceEl.textContent = '--';
            totEl.textContent = '--';
        }
    }
}

// =================================================================
//  6. EVENT LISTENER SETUP
// =================================================================
// Beschreibung: Hier werden alle Event-Listener der Anwendung registriert.
// Diese Funktionen werden nur einmal beim Start in `DOMContentLoaded` aufgerufen.
// Sie lauschen auf Benutzerinteraktionen und System-Events und rufen die
// entsprechenden Controller-Funktionen auf.

/**
 * Registriert alle globalen Event-Listener für die Anwendung.
 * Dies umfasst benutzerdefinierte Events wie 'map:moved' oder 'ui:settingChanged'
 * sowie DOM-Events, die von verschiedenen UI-Komponenten ausgelöst werden.
 */
function setupAppEventListeners() {
    console.log("[App] Setting up application event listeners...");

    document.addEventListener('map:moved', () => {
        console.log('[main-web] Map has moved or zoomed. Updating visualizations based on new view.');

        const currentZoom = AppState.map.getZoom();

        // Überprüft, ob die Sprungberechnung aktiv ist
        if (Settings.state.userSettings.calculateJump && AppState.weatherData && AppState.lastLat) {
            if (currentZoom < UI_DEFAULTS.MIN_ZOOM || currentZoom > UI_DEFAULTS.MAX_ZOOM) {
                mapManager.drawJumpVisualization(null); // This hides the circles
            } else {
                // This is the missing part: redraw the circles when zooming back in
                calculateJump();
            }
        }

        // Überprüft, ob der Jump Run Track angezeigt werden soll
        if (Settings.state.userSettings.showJumpRunTrack) {
            if (currentZoom < UI_DEFAULTS.MIN_ZOOM || currentZoom > UI_DEFAULTS.MAX_ZOOM) {
                mapManager.drawJumpRunTrack(null); // Blendet JRT aus
            } else {
                // NEU: Zeichnet den JRT neu, wenn der Zoom wieder im gültigen Bereich ist
                displayManager.updateJumpRunTrackDisplay();
            }
        }

        // Das Landing Pattern wird weiterhin bei jeder Bewegung aktualisiert
        if (Settings.state.userSettings.showLandingPattern) {
            displayManager.updateLandingPatternDisplay();
        }

        if (Settings.state.userSettings.selectedEnsembleModels.length > 0) {
            if (currentZoom < UI_DEFAULTS.MIN_ZOOM || currentZoom > UI_DEFAULTS.MAX_ZOOM) {
                EnsembleManager.clearEnsembleVisualizations();
            } else {
                EnsembleManager.processAndVisualizeEnsemble(getSliderValue(), getInterpolationStep());
            }
        }

        // Das Caching bei Kartenbewegung bleibt unverändert
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

    document.addEventListener('map:mousemove', (event) => {
        const { lat, lng } = event.detail;
        AppState.lastMouseLatLng = { lat, lng }; // Position für den Callback speichern

        const coordFormat = getCoordinateFormat();
        let coordText;

        // Koordinaten-Text korrekt formatieren
        if (coordFormat === 'MGRS') {
            const mgrsVal = Utils.decimalToMgrs(lat, lng);
            coordText = `MGRS: ${mgrsVal || 'N/A'}`;
        } else if (coordFormat === 'DMS') {
            const formatDMS = (dms) => `${dms.deg}°${dms.min}'${dms.sec.toFixed(0)}" ${dms.dir}`;
            coordText = `Lat: ${formatDMS(Utils.decimalToDms(lat, true))}, Lng: ${formatDMS(Utils.decimalToDms(lng, false))}`;
        } else {
            coordText = `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;
        }

        // Sofortiges Update mit "Fetching..."
        if (AppState.coordsControl) {
            AppState.coordsControl.update(`${coordText}<br>Elevation: Fetching...<br>QFE: Fetching...`);
        }

        // Debounced-Funktion aufrufen
        Utils.debouncedGetElevationAndQFE(lat, lng, ({ elevation }) => {
            // Callback wird ausgeführt, wenn die Daten da sind
            if (AppState.lastMouseLatLng && AppState.coordsControl) {
                // Nur aktualisieren, wenn die Maus noch in der Nähe ist
                const deltaLat = Math.abs(AppState.lastMouseLatLng.lat - lat);
                const deltaLng = Math.abs(AppState.lastMouseLatLng.lng - lng);
                const threshold = 0.05;

                if (deltaLat < threshold && deltaLng < threshold) {
                    const heightUnit = getHeightUnit();
                    let displayElevation = elevation === 'N/A' ? 'N/A' : elevation;
                    if (displayElevation !== 'N/A') {
                        displayElevation = Utils.convertHeight(displayElevation, heightUnit);
                        displayElevation = Math.round(displayElevation);
                    }

                    let qfeText = 'N/A';
                    if (elevation !== 'N/A' && AppState.weatherData && AppState.weatherData.surface_pressure) {
                        const sliderIndex = parseInt(document.getElementById('timeSlider')?.value) || 0;
                        const surfacePressure = AppState.weatherData.surface_pressure[sliderIndex];
                        const temperature = AppState.weatherData.temperature_2m?.[sliderIndex] || 15;
                        const referenceElevation = AppState.lastAltitude !== 'N/A' ? AppState.lastAltitude : 0;
                        const qfe = Utils.calculateQFE(surfacePressure, elevation, referenceElevation, temperature);
                        qfeText = qfe !== 'N/A' ? `${qfe} hPa` : 'N/A';
                    }

                    AppState.coordsControl.update(`${coordText}<br>Elevation: ${displayElevation} ${displayElevation === 'N/A' ? '' : heightUnit}<br>QFE: ${qfeText}`);
                }
            }
        });
    });

    document.addEventListener('map:location_selected', async (event) => {
        const { lat, lng, source } = event.detail;
        console.log(`App: Event 'map:location_selected' von '${source}' empfangen.`);

        // 1. Marker-Position im AppState und UI aktualisieren
        AppState.lastLat = lat;
        AppState.lastLng = lng;
        AppState.lastAltitude = await Utils.getAltitude(lat, lng);

        // Informiere das Coordinates-Modul über die neue Position
        LocationManager.addCoordToHistory(lat, lng);

        // Bewege den Marker (falls die Aktion nicht schon vom Marker selbst kam)
        if (source !== 'marker_drag') {
            // Annahme: Sie haben eine moveMarker-Funktion im mapManager
            mapManager.moveMarker(lat, lng);
        }

        // 2. Kernlogik ausführen
        resetJumpRunDirection(true);
        await weatherManager.fetchWeatherForLocation(lat, lng);

        if (Settings.state.userSettings.calculateJump) {
            calculateJump();
            JumpPlanner.calculateCutAway();
        }

        mapManager.recenterMap(true);
        AppState.isManualPanning = false;

        // 3. UI-Updates anstoßen, die von den neuen Daten abhängen
        displayManager.updateJumpRunTrackDisplay();
        displayManager.updateLandingPatternDisplay();
    });

    document.addEventListener('favorites:updated', (event) => {
        const { favorites } = event.detail;
        console.log('[App] Favorites updated, redrawing markers on map.');
        mapManager.updateFavoriteMarkers(favorites);
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
            console.log('[main-web] Event "track:loaded" empfangen, starte korrigierte Aktionen.');

            // Deaktiviere Autoupdate, wenn ein historischer Track geladen wird.
            if (historicalDate) {
                const autoupdateCheckbox = document.getElementById('autoupdateCheckbox');
                if (autoupdateCheckbox) {
                    autoupdateCheckbox.checked = false;
                }
                AutoupdateManager.stopAutoupdate();
                Settings.state.userSettings.autoupdate = false;
                Settings.save();
                Utils.handleMessage("Autoupdate disabled for historical track viewing.");
            }

            // Schritt 1: Marker auf der Karte erstellen oder aktualisieren.
            await mapManager.createOrUpdateMarker(lat, lng);

            // Schritt 2: Wetterdaten für den spezifischen Zeitstempel des Tracks abrufen.
            const newWeatherData = await weatherManager.fetchWeatherForLocation(lat, lng, timestamp);

            if (newWeatherData) {
                AppState.weatherData = newWeatherData; // Daten im globalen Zustand speichern.

                // Schritt 3: Den korrekten Index für den Slider finden.
                const slider = document.getElementById('timeSlider');
                if (slider && AppState.weatherData.time) {
                    slider.max = AppState.weatherData.time.length - 1;
                    slider.disabled = slider.max <= 0;

                    // Finde den Index im neuen Wetterdaten-Array, der am besten zum Track-Zeitstempel passt.
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
                    // Setze den Slider genau auf diesen Zeitpunkt!
                    slider.value = bestIndex;
                }
            }

            // Schritt 4: Alle UI-Elemente mit den neuen, zeitlich korrekten Daten aktualisieren.
            await displayManager.updateWeatherDisplay(getSliderValue(), 'weather-table-container', 'selectedTime');
            await displayManager.refreshMarkerPopup();
            calculateMeanWind();
            calculateJump();
            displayManager.updateLandingPatternDisplay();

            // Zeige die Track-Zusammenfassung an
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
        console.log("[main-web] Event 'ui:sliderChanged' empfangen, spezifische Updates werden ausgeführt.");

        try {
            const sliderIndex = getSliderValue();
            if (AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                // 1. Die Haupt-Wettertabelle anzeigen lassen
                await displayManager.updateWeatherDisplay(sliderIndex, 'weather-table-container', 'selectedTime'); // NEU
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

                EnsembleManager.processAndVisualizeEnsemble(sliderIndex, getInterpolationStep());
            }
        } catch (error) {
            console.error('Error during slider update:', error);
            displayError(error.message);
        }
    });

    document.addEventListener('ui:settingChanged', async (e) => {
        const { name, value } = e.detail;
        console.log(`[main-web] Setting '${name}' changed to '${value}'. Performing updates.`);

        // Update der Wetteranzeige für alle Einheiten-Änderungen
        if (['refLevel', 'heightUnit', 'temperatureUnit', 'windUnit', 'timeZone'].includes(name)) {
            await displayManager.updateWeatherDisplay(getSliderValue(), 'weather-table-container', 'selectedTime');
        }

        // Neuberechnungen basierend auf der geänderten Einstellung anstoßen
        switch (name) {
            case 'heightUnit':
            case 'windUnit':
            case 'refLevel':
                calculateMeanWind();
                if (Settings.getValue('calculateJump', 'checkbox', false)) {
                    calculateJump();
                }
                displayManager.updateLandingPatternDisplay();
                updateJumpMasterLineAndPanel();
                await displayManager.refreshMarkerPopup();
                break;

            case 'coordFormat':
                await displayManager.refreshMarkerPopup();
                updateJumpMasterLineAndPanel();
                // Aktualisiert auch die Koordinatenanzeige unten links
                if (AppState.map && AppState.lastMouseLatLng) {
                    const mouseMoveEvent = new MouseEvent('mousemove', {
                        bubbles: true,
                        cancelable: true,
                        clientX: AppState.lastMouseLatLng.x,
                        clientY: AppState.lastMouseLatLng.y
                    });
                    AppState.map.getContainer().dispatchEvent(mouseMoveEvent);
                }
                break;
        }
    });

    document.addEventListener('ui:radioGroupChanged', async (e) => {
        const { name, value } = e.detail;
        console.log(`[main-web] Radio group '${name}' changed to '${value}'. Performing updates.`);

        if (name === 'heightUnit') {
            const lowerLimitInput = document.getElementById('lowerLimit');
            const upperLimitInput = document.getElementById('upperLimit');

            if (lowerLimitInput && upperLimitInput) {
                let lowerValue = parseFloat(lowerLimitInput.value);
                let upperValue = parseFloat(upperLimitInput.value);

                if (!isNaN(lowerValue) && !isNaN(upperValue)) {
                    if (value === 'ft') { // von m auf ft
                        lowerLimitInput.value = Math.round(lowerValue * 3.28084);
                        upperLimitInput.value = Math.round(upperValue * 3.28084);
                    } else { // von ft auf m
                        lowerLimitInput.value = Math.round(lowerValue / 3.28084);
                        upperLimitInput.value = Math.round(upperValue / 3.28084);
                    }
                    // Speichere die neuen Werte in den Settings, damit sie konsistent bleiben
                    Settings.state.userSettings.lowerLimit = lowerLimitInput.value;
                    Settings.state.userSettings.upperLimit = upperLimitInput.value;
                    Settings.save();
                }
            }
        }

        // Prüfen, ob ein Update der Wetteranzeige notwendig ist
        if (['refLevel', 'heightUnit', 'temperatureUnit', 'windUnit', 'timeZone'].includes(name)) {
            await displayManager.updateWeatherDisplay(getSliderValue(), 'weather-table-container', 'selectedTime');
        }

        // Jetzt steuern wir spezifische Aktionen basierend auf der geänderten Einstellung
        switch (name) {
            case 'heightUnit':
            case 'windUnit':
            case 'refLevel':
                // Diese Einheiten beeinflussen alle Berechnungen
                calculateMeanWind();
                if (Settings.getValue('calculateJump', 'checkbox', false)) {
                    calculateJump();
                }
                displayManager.updateLandingPatternDisplay();
                updateJumpMasterLineAndPanel();
                await displayManager.refreshMarkerPopup(); // Das Popup muss auch die neuen Einheiten zeigen
                break;

            case 'coordFormat':
                await displayManager.refreshMarkerPopup();
                updateJumpMasterLineAndPanel();
                break;

            case 'landingDirection':
                updateUIState();
                displayManager.updateLandingPatternDisplay();
                calculateJump(); // Exit und blaue Kreise müssen neu berechnet werden
                break;
        }
    });

    document.addEventListener('ui:inputChanged', async (e) => {
        const { name, value } = e.detail;
        console.log(`[main-web] Input for '${name}' changed to '${value}'.`);

        switch (name) {
            // --- Spezialfall: Flugzeuggeschwindigkeit ---
            case 'aircraftSpeedKt':
                const separation = JumpPlanner.getSeparationFromTAS(value);
                setInputValueSilently('jumperSeparation', separation);
                Settings.state.userSettings.jumperSeparation = separation;
                Settings.save();
                if (AppState.weatherData) {
                    debouncedCalculateJump();
                    EnsembleManager.processAndVisualizeEnsemble(getSliderValue());
                }
                displayManager.updateJumpRunTrackDisplay();
                break;

            //Eigener Fall für die Cut-Away-Höhe ---
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
            case 'safetyHeight':
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
                    EnsembleManager.processAndVisualizeEnsemble(getSliderValue());
                }
                break;

            // ... (die restlichen cases bleiben) ...
            case 'jumpRunTrackDirection':
            case 'jumpRunTrackOffset':
            case 'jumpRunTrackForwardOffset':
                if (AppState.weatherData) {
                    displayManager.updateJumpRunTrackDisplay();
                }
                break;

            case 'lowerLimit':
            case 'upperLimit':
            case 'interpStep':
                if (AppState.weatherData) {
                    await displayManager.updateWeatherDisplay(getSliderValue(), 'weather-table-container', 'selectedTime');
                    calculateMeanWind();
                }
                break;

            case 'customLandingDirectionLL':
            case 'customLandingDirectionRR':
                if (AppState.weatherData) {
                    displayManager.updateLandingPatternDisplay();
                    calculateJump(); // Exit und blaue Kreise müssen neu berechnet werden
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
        console.log(`[main-web] Model changed to ${e.detail.model}. Fetching new data.`);

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
        console.log("[main-web] Jump feature changed, recalculating jump.");
        if (AppState.weatherData && AppState.lastLat && AppState.lastLng && Settings.state.userSettings.calculateJump) {
            calculateJump();
        }
    });

    document.addEventListener('ui:showJumpRunTrackChanged', (e) => {
        const isChecked = e.detail.checked;

        if (isChecked) {
            // Wenn die Box aktiviert wird, zeichne den Track.
            // Die Logik hier verwendet jetzt entweder den berechneten Wert 
            // oder einen neu eingegebenen benutzerdefinierten Wert.
            displayManager.updateJumpRunTrackDisplay();
        } else {
            // Wenn die Box DEAKTIVIERT wird:

            // 1. Die Visualisierung von der Karte entfernen.
            mapManager.drawJumpRunTrack(null);

            // 2. Die benutzerdefinierte Richtung und das Eingabefeld zurücksetzen.
            // Das 'false' als Parameter verhindert ein unnötiges Neuzeichnen.
            resetJumpRunDirection(false);
        }
    });

    document.addEventListener('ui:showCutAwayFinderChanged', (e) => {
        const isChecked = e.detail.checked;
        console.log(`[main-web] Cut Away Finder toggled: ${isChecked}`);

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
        console.log(`[main-web] Live Tracking toggled: ${isChecked}`);

        if (isChecked) {
            liveTrackingManager.startPositionTracking();
        } else {
            liveTrackingManager.stopPositionTracking();
        }
    });

    document.addEventListener('ui:landingPatternEnabled', () => {
        console.log('[main-web] Landing pattern enabled, updating display.');
        displayManager.updateLandingPatternDisplay();
    });

    document.addEventListener('ui:landingPatternDisabled', () => {
        console.log('[main-web] Landing pattern disabled, clearing display.');
        mapManager.drawLandingPattern(null);
    });

    document.addEventListener('ui:showTableChanged', (e) => {
        const isChecked = e.detail.checked;
        console.log(`[main-web] Show Table toggled: ${isChecked}`);

        const info = document.getElementById('info');
        if (info) {
            info.style.display = isChecked ? 'block' : 'none';
        }

        // Wenn die Tabelle eingeschaltet wird, muss sie mit den aktuellen Daten gefüllt werden.
        if (isChecked && AppState.weatherData && AppState.lastLat && AppState.lastLng) {
            displayManager.updateWeatherDisplay(getSliderValue(), 'weather-table-container', 'selectedTime');
        }

        mapManager.recenterMap();
    });

    document.addEventListener('ui:showJumpMasterLineChanged', () => {
        console.log('[main-web] Jump Master Line checkbox changed, forcing dashboard update.');
        updateJumpMasterLineAndPanel();
    });

    document.addEventListener('ui:jumpMasterLineTargetChanged', () => {
        console.log('[main-web] Jump Master Line target changed, updating panel and line.');
        updateJumpMasterLineAndPanel();
    });

    document.addEventListener('ui:downloadClicked', () => {
        console.log('[main-web] Download button clicked.');

        const downloadFormat = getDownloadFormat();
        if (downloadFormat === 'SurfaceData') {
            downloadSurfaceDataAsAscii();
        } else if (downloadFormat === 'ComprehensiveReport') { // NEUER FALL
            exportComprehensiveReport();
        } else {
            downloadTableAsAscii(downloadFormat);
        }
    });

    document.addEventListener('ui:clearDateClicked', async () => {
        console.log('[main-web] Clear date button clicked.');

        const datePicker = document.getElementById('historicalDatePicker');
        if (datePicker) {
            datePicker.value = '';
            if (AppState.lastLat && AppState.lastLng) {
                try {
                    // Aktuelle Wetterdaten neu laden
                    const newWeatherData = await weatherManager.fetchWeatherForLocation(AppState.lastLat, AppState.lastLng, null);

                    if (newWeatherData) {
                        //Rufe die zentrale Funktion auf, die alle spezifischen Updates durchführt
                        await updateUIWithNewWeatherData(newWeatherData);
                    }
                } catch (error) {
                    displayError(error.message);
                }
            }
        }
    });

    document.addEventListener('ui:recalculateJump', () => {
        console.log('[main-web] Recalculate jump triggered.');
        if (AppState.weatherData && AppState.lastLat && AppState.lastLng && Settings.state.userSettings.calculateJump) {
            calculateJump();
        }
    });

    document.addEventListener('ui:invalidInput', (e) => {
        const { id, defaultValue } = e.detail;
        console.log(`[main-web] Received invalid input for ${id}. Resetting UI to ${defaultValue}.`);

        // Hier wird die Funktion aufgerufen, die vorher im eventManager stand
        applySettingToInput(id, defaultValue);
    });
}

// =================================================================
//  7. ANWENDUNGS-STARTPUNKT
// =================================================================
// Beschreibung: Der Code in diesem Block wird ausgeführt, sobald das
// HTML-Dokument vollständig geladen ist. Er startet die gesamte Anwendung.

document.addEventListener('DOMContentLoaded', async () => {
    initializeApp();
    initializeUIElements();
    updateLockStatesUI();
    applyDeviceSpecificStyles();
    await mapManager.initializeMap();
    setupAppEventListeners();
    AutoupdateManager.setupAutoupdate();

    // EINZIGER AUFRUF FÜR ALLE EVENT LISTENER
    EventManager.initializeEventListeners();

    Coordinates.initializeLocationSearch();
    // Initiales Zeichnen der Favoriten-Marker beim Start
    const initialFavorites = LocationManager.getCoordHistory().filter(item => item.isFavorite);
    if (initialFavorites.length > 0) {
        console.log(`[App] Found ${initialFavorites.length} favorite(s) on startup, plotting on map.`);
        mapManager.updateFavoriteMarkers(initialFavorites);
    }

    document.addEventListener('cutaway:marker_placed', () => {
        console.log("App: Event 'cutaway:marker_placed' empfangen. Neuberechnung wird ausgelöst.");
        if (AppState.weatherData && AppState.lastLat && AppState.lastLng) {
            calculateJump();
        }
    });

    document.addEventListener('track:dragend', (event) => {
        console.log("App: Event 'track:dragend' empfangen. Neuberechnung der Offsets relativ zum Ankerpunkt (DIP oder HARP).");

        const { newPosition, originalTrackData } = event.detail;

        // Schritt 1: Den korrekten Ankerpunkt bestimmen (HARP oder DIP)
        let anchorPosition;
        const harpAnchor = AppState.harpMarker ? AppState.harpMarker.getLatLng() : null;

        // Wenn ein HARP-Marker existiert, ist er IMMER der Anker
        if (harpAnchor) {
            anchorPosition = harpAnchor;
            console.log("JRT-Ankerpunkt ist HARP.");
        } else {
            anchorPosition = L.latLng(AppState.lastLat, AppState.lastLng);
            console.log("JRT-Ankerpunkt ist DIP.");
        }

        const trackLength = originalTrackData.trackLength;
        const trackDirection = originalTrackData.airplane.bearing;
        const newEndPoint = newPosition; // Die neue Position des Flugzeugs

        // Schritt 2: Den NEUEN STARTPUNKT des Tracks berechnen, indem wir vom neuen Endpunkt zurückgehen.
        const [newStartLat, newStartLng] = Utils.calculateNewCenter(
            newEndPoint.lat,
            newEndPoint.lng,
            trackLength, // Die GESAMTE Länge des Tracks
            (trackDirection + 180) % 360 // Entgegen der Flugrichtung
        );
        const newStartPoint = L.latLng(newStartLat, newStartLng);

        // Schritt 3: Den Verschiebungs-Vektor vom Ankerpunkt zum NEUEN STARTPUNKT berechnen.
        const totalDistance = AppState.map.distance(anchorPosition, newStartPoint);
        const bearingFromAnchorToStart = Utils.calculateBearing(anchorPosition.lat, anchorPosition.lng, newStartPoint.lat, newStartPoint.lng);

        // Schritt 4: Den Vektor in Vorwärts- und Quer-Offsets zerlegen.
        let angleDifference = bearingFromAnchorToStart - trackDirection;
        angleDifference = (angleDifference + 180) % 360 - 180; // Winkel normalisieren

        const angleRad = angleDifference * (Math.PI / 180);
        const forwardOffset = Math.round(totalDistance * Math.cos(angleRad));
        const lateralOffset = Math.round(totalDistance * Math.sin(angleRad));

        // Schritt 5: Settings und UI aktualisieren.
        Settings.state.userSettings.jumpRunTrackOffset = lateralOffset;
        Settings.state.userSettings.jumpRunTrackForwardOffset = forwardOffset;
        Settings.save();

        setInputValueSilently('jumpRunTrackOffset', lateralOffset);
        setInputValueSilently('jumpRunTrackForwardOffset', forwardOffset);

        // Schritt 6: Den Track neu zeichnen lassen. Die `jumpPlanner` Funktion verwendet
        // jetzt den Anker + die neuen Offsets und kommt zum korrekten Ergebnis.
        displayManager.updateJumpRunTrackDisplay();
    });

    document.addEventListener('harp:updated', () => {
        console.log('[App] HARP has been updated, triggering JRT recalculation.');
        displayManager.updateJumpRunTrackDisplay();
    });

    document.addEventListener('location:selected', async (event) => {
        const { lat, lng, source } = event.detail;
        console.log(`App: Event 'location:selected' empfangen. Quelle: ${source}`);
        mapManager.clearTerrainWarning(); // Alte Terrain-Analyse sofort entfernen
        AppState.terrainAnalysisCache = null;

        const loadingElement = document.getElementById('loading');
        if (loadingElement) loadingElement.style.display = 'block';

        try {
            const sliderIndex = getSliderValue();
            const currentTimeToPreserve = AppState.weatherData?.time?.[sliderIndex] || null;

            const newWeatherData = await weatherManager.fetchWeatherForLocation(lat, lng, currentTimeToPreserve);

            if (newWeatherData) {
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
                cacheTilesForDIP({
                    map: AppState.map,
                    lastLat: lat,
                    lastLng: lng,
                    baseMaps: AppState.baseMaps,
                    onProgress: displayProgress,
                    onComplete: displayMessage,
                    onCancel: () => displayMessage('Caching cancelled.'),
                    radiusKm: 5,
                    silent: true // <- DIESE ZEILE IST ENTSCHEIDEND
                });
            }

            if (Settings.state.userSettings.selectedEnsembleModels.length > 0) {
                console.log("DIP moved, triggering ensemble recalculation...");
                const ensembleSuccess = await EnsembleManager.fetchEnsembleWeatherData();
                if (ensembleSuccess) {
                    EnsembleManager.processAndVisualizeEnsemble(getSliderValue());
                }
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

    document.addEventListener('ui:lockStateChanged', updateLockStatesUI);
});

// =================================================================
//  8. HILFSFUNKTIONEN (INTERN)
// =================================================================
// Beschreibung: Kleinere Helfer, die hauptsächlich von `initializeUIElements`
// verwendet werden, um den Code sauber zu halten.

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