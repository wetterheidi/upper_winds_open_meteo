// =================================================================
//  1. IMPORTE & GLOBALE VARIABLEN
// =================================================================
// Beschreibung: Alle Abhängigkeiten von anderen Modulen werden hier zentral geladen.

import { AppState } from '../core/state.js';
import { Utils } from '../core/utils.js';
import { Settings, getInterpolationStep, setAppContext } from '../core/settings.js';
import { UI_DEFAULTS } from '../core/constants.js';
import { SensorManager } from './sensorManager.js';
import * as EventManager from './eventManager.js';
import * as Coordinates from './coordinates.js';
import * as JumpPlanner from '../core/jumpPlanner.js';
import * as mapManager from './mapManager.js';
import { saveRecordedTrack } from '../core/trackManager.js';
import * as weatherManager from '../core/weatherManager.js';
import { cacheVisibleTiles, cacheTilesForDIP } from '../core/tileCache.js';
import { getSliderValue, displayError, displayMessage, displayProgress, hideProgress, applyDeviceSpecificStyles } from './ui.js';
import * as AutoupdateManager from '../core/autoupdateManager.js';
import { DateTime } from 'luxon';
import * as displayManager from './displayManager.js';
import * as liveTrackingManager from '../core/liveTrackingManager.js';
import * as EnsembleManager from '../core/ensembleManager.js';
import * as LocationManager from '../core/locationManager.js';
import { getCapacitor } from '../core/capacitor-adapter.js';
import { Directory } from '@capacitor/filesystem';

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

export const getTemperatureUnit = () => Settings.getValue('temperatureUnit', 'C');
export const getHeightUnit = () => Settings.getValue('heightUnit', 'm');
export const getWindSpeedUnit = () => Settings.getValue('windUnit', 'kt');
export const getCoordinateFormat = () => Settings.getValue('coordFormat', 'Decimal');
export const getDownloadFormat = () => Settings.getValue('downloadFormat', 'csv');

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
    applySettingToSelect('maxForecastTime', Settings.state.userSettings.maxForecastTime); // Hinzugefügt
    applySettingToInput('aircraftSpeedKt', Settings.state.userSettings.aircraftSpeedKt);
    applySettingToInput('jumpRunTrackOffset', Settings.state.userSettings.jumpRunTrackOffset);
    applySettingToInput('numberOfJumpers', Settings.state.userSettings.numberOfJumpers);
    applySettingToCheckbox('showTableCheckbox', Settings.state.userSettings.showTable);
    applySettingToCheckbox('showJumpRunTrack', Settings.state.userSettings.showJumpRunTrack);
    applySettingToCheckbox('showCanopyAreaCheckbox', Settings.state.userSettings.showCanopyArea);
    applySettingToCheckbox('showExitAreaCheckbox', Settings.state.userSettings.showExitArea);
    applySettingToCheckbox('showCutAwayFinder', Settings.state.userSettings.showCutAwayFinder);
    applySettingToInput('terrainClearance', Settings.state.userSettings.terrainClearance);
    Settings.state.userSettings.isCustomJumpRunDirection = Settings.state.userSettings.isCustomJumpRunDirection || false;

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
    if (directionSpan) directionSpan.textContent = '-';

    // Explizit den Slider auf die aktuelle Stunde setzen
    const slider = document.getElementById('timeSlider');
    if (slider) {
        const currentUtcHour = new Date().getUTCHours();
        slider.value = currentUtcHour;
        console.log(`[App] Initialized timeSlider to current UTC hour: ${currentUtcHour}`);
    }

    updateUIState();
}

function updateLockStatesUI() {
    // Update Planner Tab Button
    const plannerTab = document.querySelector('.tab-button[data-panel="planner"]');
    if (plannerTab) {
        if (Settings.isFeatureUnlocked('planner')) {
            plannerTab.style.opacity = '1';
            plannerTab.title = 'Planner';
        } else {
            plannerTab.style.opacity = '0.5';
            plannerTab.title = 'Feature locked. Tap to enter password.';
        }
    }

    // Update Data Tab Button
    const dataTab = document.querySelector('.tab-button[data-panel="data"]');
    if (dataTab) {
        if (Settings.isFeatureUnlocked('data')) {
            dataTab.style.opacity = '1';
            dataTab.title = 'Data';
        } else {
            dataTab.style.opacity = '0.5';
            dataTab.title = 'Feature locked. Tap to enter password.';
        }
    }
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

    if (heightUnit === 'ft') {
        openingAltitude = Utils.convertFeetToMeters(openingAltitude);
        exitAltitude = Utils.convertFeetToMeters(exitAltitude);
    }

    if (!Settings.state.userSettings.calculateJump) {
        mapManager.drawJumpVisualization(null);
        mapManager.drawCutAwayVisualization(null);
        return;
    }

    if (!AppState.weatherData || AppState.lastLat == null || AppState.lastLng == null) {
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
                tooltip: tooltipContent
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
    if (!Settings.state.userSettings.showJumpRunTrack || !Settings.state.userSettings.calculateJump || !AppState.weatherData || AppState.lastLat == null || AppState.lastLng == null) {
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

    const refLevel = Settings.getValue('refLevel', 'AGL');
    const heightUnit = getHeightUnit();
    const windSpeedUnit = getWindSpeedUnit();

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
    if (AppState.lastLat == null || AppState.lastLng == null) {
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

        await displayManager.updateWeatherDisplay(currentHour, 'weather-table-container', 'selectedTime');
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
export async function downloadTableAsAscii(format) {
    if (!AppState.weatherData || !AppState.weatherData.time) {
        Utils.handleError('No weather data available to download.');
        return;
    }

    // --- Datenvorbereitung (unverändert) ---
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
        heightUnit: requirements.heightUnit || Settings.getValue('heightUnit', 'm'),
        refLevel: requirements.refLevel || Settings.getValue('refLevel', 'AGL'),
        windUnit: requirements.windUnit || Settings.getValue('windUnit', 'kt'),
        temperatureUnit: requirements.temperatureUnit || Settings.getValue('temperatureUnit', 'C')
    };
    const interpolatedData = weatherManager.interpolateWeatherData(
        AppState.weatherData, index, exportSettings.interpStep, Math.round(AppState.lastAltitude), exportSettings.heightUnit
    );

    if (!interpolatedData || interpolatedData.length === 0) {
        Utils.handleError('No interpolated data available to download.');
        return;
    }

    let content = '';
    let header = '';
    // --- Header-Erstellung (unverändert) ---
    switch (format) {
        case 'ATAK':
            header = `Alt\tDir\tSpd\n${exportSettings.heightUnit}${exportSettings.refLevel}\tdeg\tkts\n`;
            break;
        case 'Windwatch':
            const elevationFt = Math.round(Utils.convertHeight(AppState.lastAltitude, 'ft'));
            header = `Version 1.0, ID = 9999999999\n${time}, Ground Level: ${elevationFt} ft\nWindsond ${model}\nAGL[ft] Wind[°] Speed[km/h]\n`;
            break;
        default:
            header = `h(${exportSettings.heightUnit}${exportSettings.refLevel}) p(hPa) T(${exportSettings.temperatureUnit}) Dew(${exportSettings.temperatureUnit}) Dir(°) Spd(${exportSettings.windUnit}) RH(%)\n`;
            break;
    }
    content += header;
    // --- Inhalts-Erstellung (unverändert) ---
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

    // --- NEUE SPEICHERLOGIK ---
    try {
        const { Filesystem, isNative } = await getCapacitor();
        if (isNative && Filesystem) {
            // Native mobile App: Verwende die Filesystem API
            await Filesystem.writeFile({
                path: filename,
                data: content,
                directory: Directory.Documents, // Speichert im "Dokumente"-Ordner
                encoding: 'utf8'
            });
            Utils.handleMessage(`File saved: ${filename}`);
        } else {
            // Fallback für Webbrowser
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
    } catch (error) {
        console.error("Error saving file:", error);
        Utils.handleError("Could not save file.");
    }
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

    // Datenvorbereitung (unverändert)
    const { time, wind_direction_10m, wind_speed_10m, wind_gusts_10m, visibility, weather_code, temperature_2m } = AppState.weatherData;
    const windUnit = getWindSpeedUnit();
    const tempUnit = getTemperatureUnit();
    const timeZone = Settings.getValue('timeZone', 'radio', 'Z');
    const model = document.getElementById('modelSelect').value.toUpperCase();
    const timeForFilename = Utils.formatTime(time[0]).replace(' ', '_');
    const filename = `${timeForFilename}_${model}_Surface.txt`;

    const timeHeader = `Time (${timeZone})`;
    let content = `Date\t${timeHeader}\tWind Dir (°)\tWind Spd/Gust (${windUnit})\tVisibility (m)\tWeather\tTemp (${tempUnit})\n`;

    for (let i = 0; i < time.length; i++) {
        const displayTime = await Utils.getDisplayTime(time[i], AppState.lastLat, AppState.lastLng, timeZone);
        const timeParts = displayTime.split(' ');
        const date = timeParts[0];
        const timeStr = timeParts.length > 1 ? timeParts[1] : '';

        const speed = Utils.convertWind(wind_speed_10m[i], windUnit, 'km/h');
        const gust = Utils.convertWind(wind_gusts_10m[i], windUnit, 'km/h');
        const formattedSpeed = (typeof speed === 'number') ? speed.toFixed(0) : 'N/A';
        const formattedGust = (typeof gust === 'number') ? gust.toFixed(0) : 'N/A';
        const windString = `${formattedSpeed} G ${formattedGust}`;

        const temp = Utils.convertTemperature(temperature_2m[i], tempUnit);
        const formattedTemp = (typeof temp === 'number') ? temp.toFixed(1) : 'N/A';

        const visibilityStr = visibility?.[i] ?? 'N/A';
        const weatherStr = Utils.translateWmoCodeToTaf(weather_code?.[i]);

        content += `${date}\t${timeStr}\t${wind_direction_10m[i]}\t${windString}\t${visibilityStr}\t${weatherStr}\t${formattedTemp}\n`;
    }

    // --- KORRIGIERTE SPEICHERLOGIK ---
    try {
        const { Filesystem, isNative, Directory } = await getCapacitor();
        if (isNative && Filesystem) {
            // Native mobile App: Verwende die Filesystem API
            await Filesystem.writeFile({
                path: filename,
                data: content,
                directory: Directory.Documents, // Speichert im "Dokumente"-Ordner
                encoding: 'utf8'
            });
            Utils.handleMessage(`File saved: ${filename}`);
        } else {
            // Fallback für Webbrowser
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
    } catch (error) {
        console.error("Error saving surface data file:", error);
        Utils.handleError("Could not save file.");
    }
}

/**
 * Erstellt einen vollständigen, formatierten Wetter-Tagesbericht als HTML-Seite
 * und öffnet diesen in einem neuen Tab.
 */
async function exportComprehensiveReportAsHtml() {
    if (!AppState.weatherData || AppState.lastLat == null || AppState.lastLng == null) {
        Utils.handleError("No weather data available for the report.");
        return;
    }

    // --- Schritt 1: HTML-Inhalt generieren (Dieser Teil bleibt exakt gleich) ---
    const lat = AppState.lastLat;
    const lng = AppState.lastLng;
    const model = document.getElementById('modelSelect').value.toUpperCase();
    const modelRun = AppState.lastModelRun || "N/A";
    const today = DateTime.utc().toFormat('yyyy-MM-dd');

    const windUnit = getWindSpeedUnit();
    const tempUnit = getTemperatureUnit();
    const heightUnit = getHeightUnit();
    const timeZone = Settings.getValue('timeZone', 'radio', 'Z');
    const upperAirLimit = Settings.getValue('upperLimit', 'number', 3000);

    let locationName = `Lat ${lat.toFixed(4)}, Lon ${lng.toFixed(4)}`;
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        const data = await response.json();
        locationName = data.display_name || locationName;
    } catch (e) {
        console.warn("Reverse geocoding failed, using coordinates.");
    }

    let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">

    <meta name="viewport" content="width=device-width, initial-scale=1.0, minimum-scale=0.5, maximum-scale=3, user-scalable=yes">    <title>DZMaster Weather Briefing</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 10px; }
        .container { width: 100%; margin: 0 auto; padding: 0; }
        h1, h2, h3 { color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; margin-top: 20px; }
        
        /* *** START DER ÄNDERUNGEN *** */

        .table-wrapper { 
            overflow-x: auto; 
            -webkit-overflow-scrolling: touch; /* Flüssiges Scrollen auf iOS */
            border: 1px solid #ddd;
            border-radius: 8px;
            margin-top: 20px;
        }
        table { 
            width: 100%; 
            border-collapse: collapse; 
            font-size: 0.9em; 
        }
        th, td { 
            padding: 8px 12px; 
            border: 1px solid #ddd; 
            text-align: center; /* Zentriert für bessere Lesbarkeit */
            white-space: nowrap; /* Verhindert Zeilenumbrüche in Zellen */
        }

        /* *** ENDE DER ÄNDERUNGEN *** */
        
        th { background-color: #f2f2f2; font-weight: bold; }
        tr:nth-child(even) { background-color: #f9f9f9; }
        .header-info { background-color: #ecf0f1; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        .header-info p { margin: 5px 0; }
        .section { margin-top: 30px; }

        @media (max-width: 768px) {
            body {
                -webkit-text-size-adjust: 100%; /* Verhindert, dass iOS die Schrift automatisch vergrößert */
            }
            table {
                font-size: 8px; /* Kleinere Schrift in der Tabelle auf mobilen Geräten */
            }
            th, td {
                padding: 3px 4px; /* Kompakteres Padding */
            }

            h1, h2, h3 { padding-bottom: 3 px; margin-top: 10px; font-size: 13px;}

            .header-info { padding: 8px; margin-bottom: 10px; font-size: 10px;}

        }
    </style>
</head>
<body>
<div class="container">
    <h1>DZMaster - Weather Briefing</h1>
    <div class="header-info">
        <p><strong>Location:</strong> ${locationName}</p>
        <p><strong>Model:</strong> ${model}</p>
        <p><strong>Model Run:</strong> ${modelRun}</p>
        <p><strong>Forecast Day:</strong> ${today}</p>
    </div>

    <div class="section">
        <h2>Surface Data (Today)</h2>
        <div class="table-wrapper">
        <table>
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Time (${timeZone})</th>
                    <th>Wind Dir (°)</th>
                    <th>Wind (${windUnit})</th>
                    <th>Visibility (m)</th>
                    <th>Weather</th>
                    <th>Clouds</th>
                    <th>Temp (${tempUnit})</th>
                </tr>
            </thead>
            <tbody>`;

    const { time, wind_direction_10m, wind_speed_10m, wind_gusts_10m, visibility, weather_code, temperature_2m } = AppState.weatherData;
    const todayIndices = time.map((t, i) => DateTime.fromISO(t).toFormat('yyyy-MM-dd') === today ? i : -1).filter(i => i !== -1);

    for (const i of todayIndices) {
        const displayTime = await Utils.getDisplayTime(time[i], lat, lng, timeZone);
        const [date, timeStr] = displayTime.split(' ');
        const speed = Utils.convertWind(wind_speed_10m[i], windUnit, 'km/h');
        const gust = Utils.convertWind(wind_gusts_10m[i], windUnit, 'km/h');
        const windString = `${(typeof speed === 'number' ? speed.toFixed(0) : 'N/A')} G ${(typeof gust === 'number' ? gust.toFixed(0) : 'N/A')}`;
        const temp = Utils.convertTemperature(temperature_2m[i], tempUnit);
        const interpolatedDataForHour = weatherManager.interpolateWeatherData(
            AppState.weatherData, i, 100, Math.round(AppState.lastAltitude), heightUnit
        );
        const cloudLayerString = Utils.getCloudLayersForMetar(interpolatedDataForHour, heightUnit);
        const visibilityStr = Utils.formatVisibility(visibility?.[i]);
        const windDirectionFormatted = Utils.formatWindDirection(wind_direction_10m[i]);

        html += `<tr>
            <td>${date}</td>
            <td>${timeStr}</td>
            <td>${windDirectionFormatted}</td>
            <td>${windString}</td>
            <td>${visibilityStr}</td>
            <td>${Utils.translateWmoCodeToTaf(weather_code?.[i])}</td>
            <td>${cloudLayerString}</td>
            <td>${(typeof temp === 'number' ? temp.toFixed(1) : 'N/A')}</td>
        </tr>`;
    }

    html += `</tbody></table></div></div>`; // Die Tabelle wird im Wrapper geschlossen

    html += `<div class="section">
                <h2>Upper Air Data (Today, hourly, up to ${upperAirLimit}${heightUnit} AGL)</h2>`;

    for (const i of todayIndices) {
        const displayTime = await Utils.getDisplayTime(time[i], lat, lng, 'Z');
        html += `<h3>${displayTime}</h3>
                 <div class="table-wrapper">
                 <table>
                    <thead>
                        <tr>
                            <th>h(${heightUnit} AGL)</th>
                            <th>p(hPa)</th>
                            <th>T(${tempUnit})</th>
                            <th>Dew(${tempUnit})</th>
                            <th>Dir(°)</th>
                            <th>Spd(${windUnit})</th>
                            <th>RH(%)</th>
                            <th>Clouds(%)</th>
                        </tr>
                    </thead>
                    <tbody>`;

        const interpolatedData = weatherManager.interpolateWeatherData(
            AppState.weatherData, i, 100, Math.round(AppState.lastAltitude), heightUnit
        );

        interpolatedData
            .filter(data => data.displayHeight <= upperAirLimit)
            .forEach(data => {
                const temp = Utils.convertTemperature(data.temp, tempUnit);
                const dew = Utils.convertTemperature(data.dew, tempUnit);
                const spd = Utils.convertWind(data.spd, windUnit, 'km/h');
                const dirFormatted = Utils.formatWindDirection(data.dir);

                html += `<tr>
                    <td>${data.displayHeight}</td>
                    <td>${(typeof data.pressure === 'number' ? data.pressure.toFixed(1) : 'N/A')}</td>
                    <td>${(typeof temp === 'number' ? temp.toFixed(1) : 'N/A')}</td>
                    <td>${(typeof dew === 'number' ? dew.toFixed(1) : 'N/A')}</td>
                    <td>${dirFormatted}</td>
                    <td>${(typeof spd === 'number' ? spd.toFixed(1) : 'N/A')}</td>
                    <td>${(typeof data.rh === 'number' ? Math.round(data.rh) : 'N/A')}</td>
                    <td>${(typeof data.cc === 'number' ? Math.round(data.cc) : 'N/A')}</td>
                </tr>`;
            });
        html += `</tbody></table></div>`;
    }

    html += `</div></div></body></html>`;


    // --- Schritt 2: HTML-Inhalt als Datei speichern (Dieser Teil ist NEU) ---
    try {
        // Hole die Capacitor-Module über den Adapter
        const { Filesystem, Directory, Browser, Capacitor, isNative } = await getCapacitor();

        if (isNative && Filesystem && Browser && Capacitor) {
            const timeForFilename = DateTime.utc().toFormat('yyyy-MM-dd_HHmm');
            const model = document.getElementById('modelSelect').value.toUpperCase();
            const permanentFilename = `DZMaster/DZMaster_Briefing_${timeForFilename}_${model}.html`;

            // Datei für den Benutzer speichern
            await Filesystem.writeFile({
                path: permanentFilename,
                data: html,
                directory: Directory.Documents,
                encoding: 'utf8',
                recursive: true
            });
            Utils.handleMessage(`Briefing saved in Documents/DZMaster`);

            // Temporäre Datei für die Anzeige speichern
            const tempFilename = 'briefing_temp.html';
            const writeResult = await Filesystem.writeFile({
                path: tempFilename,
                data: html,
                directory: Directory.Cache,
                encoding: 'utf8',
                recursive: true
            });

            // *** START DER NEUEN LOGIK ***
            // Konvertiere den nativen Pfad in eine vom lokalen Webserver lesbare URL
            const serverUrl = Capacitor.convertFileSrc(writeResult.uri);

            // Finde das Modal und das Iframe und zeige sie an
            const modal = document.getElementById('htmlReportModal');
            const iframe = document.getElementById('reportIframe');

            if (modal && iframe) {
                iframe.src = serverUrl;
                modal.style.display = 'flex';
            } else {
                // Fallback, falls die UI-Elemente nicht gefunden werden
                throw new Error("HTML report modal components not found in the DOM.");
            }
            // *** ENDE DER NEUEN LOGIK ***

        } else {
            // Web-Fallback (bleibt unverändert)
            const newTab = window.open();
            newTab.document.open();
            newTab.document.write(html);
            newTab.document.close();
        }
    } catch (error) {
        console.error("Error saving or showing HTML briefing:", error);
        Utils.handleError("Could not save or show briefing file.");
    }
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
    AppState.cloudThresholds = weatherManager.analyzeCloudLayers(newWeatherData);

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

    // Geänderte Logik für den Slider
    const maxForecastTime = Settings.getValue('maxForecastTime', 'Maximum');
    let maxSliderIndex = lastValidIndex;

    if (maxForecastTime !== 'Maximum') {
        const maxDays = parseInt(maxForecastTime, 10);
        const maxHours = (maxDays * 24) - 1; // -1, da der Index bei 0 beginnt
        if (lastValidIndex > maxHours) {
            maxSliderIndex = maxHours;
        }
    }
    slider.max = maxSliderIndex;
    slider.disabled = slider.max <= 0;

    // Logik zur Positionierung des Sliders
    if (preservedIndex !== null && preservedIndex <= maxSliderIndex) {
        slider.value = preservedIndex;
        console.log(`Slider restored to preserved index: ${preservedIndex}`);
    } else {
        const currentUtcHour = new Date().getUTCHours();
        if (currentUtcHour <= maxSliderIndex) {
            slider.value = currentUtcHour;
        } else {
            slider.value = maxSliderIndex;
        }
        console.log(`Slider set to default (current hour or max): ${slider.value}`);
    }

    await displayManager.updateSliderLabels();

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
    if (showJumpRunTrackCheckbox) showJumpRunTrackCheckbox.disabled = false; // Keine Sperre durch calculateJump
    if (showExitAreaCheckbox) showExitAreaCheckbox.disabled = false; // Keine Sperre durch calculateJump
}

/**
 * Aktualisiert die Jump-Master-Linie auf der Karte und die Daten im Jumpmaster-Panel.
 * Wird bei jeder neuen GPS-Position aufgerufen, wenn das Live-Tracking aktiv ist.
 * @param {object|null} [positionData=null] - Die neuesten Positionsdaten vom GPS.
 */
export function updateJumpMasterLineAndPanel(positionData = null) {
    console.log('[main-mobile] Event "tracking:positionUpdated" received. Data:', event.detail);

    // 1. Grundvoraussetzung: Ist Live-Tracking überhaupt aktiv?
    // Wenn kein Live-Marker da ist, ist Tracking aus -> alles aufräumen und beenden.
    if (!AppState.liveMarker) {
        mapManager.clearJumpMasterLine();
        mapManager.hideLivePositionControl();
        updateJumpMasterDashboard(null);
        return;
    }

    // 2. Basis-Positionsdaten zusammenstellen
    const livePos = AppState.liveMarker.getLatLng();
    if (!livePos) return; // Sicherheitsabfrage

    const dataForUpdate = positionData || {
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
            const speedMs = dataForUpdate.speedMs > 1 ? dataForUpdate.speedMs : 1;
            const tot = Math.round(distance / speedMs);
            jumpMasterLineData = { distance, bearing, tot, target: targetName };
            mapManager.drawJumpMasterLine(livePos, targetPos);
        }
    } else {
        // Wenn die Checkbox nicht aktiv ist, sicherstellen, dass die Linie entfernt wird
        mapManager.clearJumpMasterLine();
    }

    // SAMMELT ALLE BENÖTIGTEN EINSTELLUNGEN
    const settingsForPanel = {
        heightUnit: getHeightUnit(),
        effectiveWindUnit: getWindSpeedUnit() === 'bft' ? 'kt' : getWindSpeedUnit(),
        coordFormat: getCoordinateFormat(),
        refLevel: Settings.getValue('refLevel', 'AGL')
    };

    // ERSTELLT DAS FINALE DATENOBJEKT FÜR ALLE UI-KOMPONENTEN
    const fullUpdateData = {
        ...dataForUpdate,
        showJumpMasterLine: showJML,
        jumpMasterLineData,
        ...settingsForPanel // Fügt die Einheiten hinzu
    };

    // Aktualisiert das Jumpmaster-Dashboard (inkl. der Detailansicht)
    updateJumpMasterDashboard(fullUpdateData);

    // Aktualisiert das Live-Position-Overlay auf der Karte
    mapManager.updateLivePositionControl(fullUpdateData);
}

function updateJumpMasterDashboard(data) {
    const dashboard = document.getElementById('jumpmaster-view-mobile');
    if (!dashboard) return;

    if (!data) {
        const jmlDetails = document.getElementById('jumpmaster-line-details-mobile');
        if (jmlDetails) jmlDetails.classList.add('hidden');
        return;
    }

    // --- Block 1: Haupt-Dashboard ---
    const mainElements = {
        coordsEl: document.getElementById('dashboard-jm-coords-mobile'),
        altitudeEl: document.getElementById('dashboard-jm-altitude-mobile'),
        directionEl: document.getElementById('dashboard-jm-direction-mobile'),
        speedEl: document.getElementById('dashboard-jm-speed-mobile'),
        varioEl: document.getElementById('dashboard-jm-vario-mobile'),
        accuracyEl: document.getElementById('dashboard-jm-accuracy-mobile')
    };

    // Prüfen, ob alle Hauptelemente vorhanden sind
    if (Object.values(mainElements).some(el => !el)) {
        console.error("Jumpmaster Dashboard: Ein oder mehrere Haupt-UI-Elemente wurden nicht gefunden. Bitte überprüfen Sie die IDs.");
        return;
    }

    const { heightUnit, effectiveWindUnit, coordFormat, refLevel, latitude, longitude, deviceAltitude, accuracy, speedMs, direction, showJumpMasterLine, jumpMasterLineData, rateOfClimbMps } = data;

    // Hauptwerte aktualisieren...
    const coords = Utils.convertCoords(latitude, longitude, coordFormat);
    let coordText;
    const formatDDM = (ddm) => `${ddm.deg}° ${ddm.min.toFixed(3)}' ${ddm.dir}`;
    const formatDMS = (dms) => `${dms.deg}°${dms.min}'${dms.sec.toFixed(0)}" ${dms.dir}`;

    if (coordFormat === 'MGRS') {
        coordText = coords.lat;
    } else if (coordFormat === 'DMS') {
        coordText = `${formatDMS(coords.lat)}, ${formatDMS(coords.lng)}`;
    } else if (coordFormat === 'DDM') {
        coordText = `${formatDDM(coords.lat)}, ${formatDDM(coords.lng)}`;
    } else {
        coordText = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    }

    mainElements.coordsEl.textContent = coordText; mainElements.altitudeEl.textContent = deviceAltitude !== null ? `${Math.round(Utils.convertHeight(deviceAltitude - (refLevel === 'AGL' ? AppState.lastAltitude || 0 : 0), heightUnit))} ${heightUnit}` : "N/A";
    mainElements.directionEl.textContent = `${direction}°`;
    const displaySpeed = Utils.convertWind(speedMs, effectiveWindUnit, 'm/s');
    mainElements.speedEl.textContent = `${Number.isFinite(displaySpeed) ? displaySpeed.toFixed(1) : 'N/A'} ${effectiveWindUnit}`;
    mainElements.accuracyEl.textContent = `± ${Math.round(Utils.convertHeight(accuracy, heightUnit))} ${heightUnit}`;
    if (mainElements.varioEl) {
        const varioUnit = heightUnit === 'ft' ? 'ft/min' : 'm/s';
        let displayVario = 'N/A';
        mainElements.varioEl.classList.remove('vario-climb', 'vario-descent');

        if (rateOfClimbMps !== null && Number.isFinite(rateOfClimbMps)) {
            if (varioUnit === 'ft/min') {
                displayVario = (rateOfClimbMps * 196.85).toFixed(0);
            } else {
                displayVario = rateOfClimbMps.toFixed(1);
            }

            // Farbliche Kennzeichnung
            if (rateOfClimbMps > 0.5) {
                mainElements.varioEl.classList.add('vario-climb');
            } else if (rateOfClimbMps < -0.5) {
                mainElements.varioEl.classList.add('vario-descent');
            }
        }
        mainElements.varioEl.textContent = `${displayVario} ${varioUnit}`;
    }

    // --- Block 2: JML Toggle ---
    const dipBtn = document.getElementById('jml-target-dip-btn');
    const harpBtn = document.getElementById('jml-target-harp-btn');
    if (dipBtn && harpBtn) {
        dipBtn.classList.toggle('active', Settings.state.userSettings.jumpMasterLineTarget === 'DIP');
        harpBtn.classList.toggle('active', Settings.state.userSettings.jumpMasterLineTarget === 'HARP');
        harpBtn.style.opacity = AppState.harpMarker ? 1 : 0.5;
    }

    // --- Block 3: JML Detailansicht ---
    const jmlDetails = document.getElementById('jumpmaster-line-details-mobile');
    if (jmlDetails) {
        jmlDetails.classList.toggle('hidden', !showJumpMasterLine);

        if (showJumpMasterLine && jumpMasterLineData) {
            // DETAILLIERTE PRÜFUNG: Jedes Element einzeln prüfen und loggen, falls es fehlt.
            const detailElements = {
                targetLabel: document.getElementById('dashboard-jm-target-label-mobile'),
                bearingEl: document.getElementById('dashboard-jm-bearing-mobile'),
                distanceEl: document.getElementById('dashboard-jm-distance-mobile'),
                totEl: document.getElementById('dashboard-jm-tot-mobile')
            };

            let allDetailsFound = true;
            for (const key in detailElements) {
                if (!detailElements[key]) {
                    console.error(`Jumpmaster Dashboard Fehler: Das Detail-Element für '${key}' (erwartete ID: ${key.replace('El', '-mobile').replace('targetLabel', 'dashboard-jm-target-label-mobile')}) wurde nicht in der index.html gefunden!`);
                    allDetailsFound = false;
                }
            }

            if (allDetailsFound) {
                detailElements.targetLabel.textContent = `JML to ${jumpMasterLineData.target}`;
                detailElements.bearingEl.textContent = `${jumpMasterLineData.bearing}°`;
                detailElements.distanceEl.textContent = `${Math.round(Utils.convertHeight(jumpMasterLineData.distance, heightUnit))} ${heightUnit}`;
                detailElements.totEl.textContent = jumpMasterLineData.tot < 1200 ? `X - ${jumpMasterLineData.tot} s` : 'N/A';
            }
        }
    }
}

/**
 * Updates the dashboard panel with the latest live tracking data,
 * including glide ratios.
 * @param {object} data - The position data from the tracking event.
 */
function updateDashboardPanel(data) {
    if (!data) return;

    const { latitude, longitude, deviceAltitude, speedMs, descentRateMps, direction } = data;

    // --- Altitude & Range ---
    const altitudeEl = document.getElementById('dashboard-altitude');
    const altitudeUnitEl = document.getElementById('dashboard-altitude-unit');
    const rangeEl = document.getElementById('dashboard-range');
    const rangeUnitEl = document.getElementById('dashboard-range-unit');
    const heightUnit = getHeightUnit();

    if (deviceAltitude !== null && altitudeEl && altitudeUnitEl) {
        const altitudeAGL = deviceAltitude - (AppState.lastAltitude || 0);
        const displayAltitude = Math.round(Utils.convertHeight(altitudeAGL, heightUnit));
        altitudeEl.textContent = displayAltitude;
        altitudeUnitEl.textContent = `${heightUnit} abv DIP`;

        if (rangeEl && rangeUnitEl && descentRateMps > 0.1) {
            const timeToGround = altitudeAGL / descentRateMps;
            const rangeMeters = speedMs * timeToGround;

            let displayRange;
            let displayUnit;

            // KORREKTUR: Berücksichtigt jetzt 'ft' und 'mi'
            if (heightUnit === 'ft') {
                const rangeFeet = Utils.convertHeight(rangeMeters, 'ft');
                if (rangeFeet > 5280) { // Wenn über eine Meile
                    displayRange = (rangeFeet / 5280).toFixed(1);
                    displayUnit = 'mi';
                } else {
                    displayRange = Math.round(rangeFeet);
                    displayUnit = 'ft';
                }
            } else { // Standard 'm'
                if (rangeMeters > 1000) {
                    displayRange = (rangeMeters / 1000).toFixed(1);
                    displayUnit = 'km';
                } else {
                    displayRange = Math.round(rangeMeters);
                    displayUnit = 'm';
                }
            }
            rangeEl.textContent = displayRange;
            rangeUnitEl.textContent = displayUnit;
        } else if (rangeEl) {
            rangeEl.textContent = "---";
        }
    }

    // --- Speed, Direction, Bearing, Distance, Glide Ratios ---
    const speedEl = document.getElementById('dashboard-speed');
    const speedUnitEl = document.getElementById('dashboard-speed-unit');
    const windUnit = getWindSpeedUnit();
    if (speedMs !== null && speedEl && speedUnitEl) {
        const displaySpeed = Utils.convertWind(speedMs, windUnit, 'm/s');
        speedEl.textContent = windUnit === 'bft' ? Math.round(displaySpeed) : displaySpeed.toFixed(0);
        speedUnitEl.textContent = windUnit;
    }

    const directionEl = document.getElementById('dashboard-direction');
    if (direction !== 'N/A' && directionEl) {
        directionEl.textContent = Math.round(direction);
    }

    const dipMarker = AppState.currentMarker;
    const bearingEl = document.getElementById('dashboard-bearing');
    const distanceEl = document.getElementById('dashboard-distance');
    const distanceUnitEl = document.getElementById('dashboard-distance-unit');
    let distanceMeters = null;

    if (dipMarker && bearingEl && distanceEl && distanceUnitEl) {
        const livePos = L.latLng(latitude, longitude);
        const dipPos = dipMarker.getLatLng();
        distanceMeters = livePos.distanceTo(dipPos);

        let displayDistance;
        let displayDistUnit;

        // KORREKTUR: Berücksichtigt jetzt 'ft' und 'mi' für die Distanz
        if (heightUnit === 'ft') {
            const distanceFeet = Utils.convertHeight(distanceMeters, 'ft');
            if (distanceFeet > 5280) { // Wenn über eine Meile
                displayDistance = (distanceFeet / 5280).toFixed(1);
                displayDistUnit = 'mi';
            } else {
                displayDistance = Math.round(distanceFeet);
                displayDistUnit = 'ft';
            }
        } else { // Standard 'm'
            if (distanceMeters > 1000) {
                displayDistance = (distanceMeters / 1000).toFixed(1);
                displayDistUnit = 'km';
            } else {
                displayDistance = Math.round(distanceMeters);
                displayDistUnit = 'm';
            }
        }

        distanceEl.textContent = displayDistance;
        distanceUnitEl.textContent = displayDistUnit;

        const bearing = Math.round(Utils.calculateBearing(latitude, longitude, dipPos.lat, dipPos.lng));
        bearingEl.textContent = bearing;
    }

    // ... (Der restliche Teil der Funktion für Gleitverhältnisse bleibt unverändert)
    const glideRequiredEl = document.getElementById('dashboard-glide-required');
    const glideCurrentEl = document.getElementById('dashboard-glide-current');
    let requiredRatio = null;
    let currentRatio = null;

    if (dipMarker && distanceMeters !== null && glideRequiredEl) {
        const dipAltitude = AppState.lastAltitude || 0;
        const altitudeDifference = deviceAltitude - dipAltitude;
        if (altitudeDifference > 1) {
            requiredRatio = distanceMeters / altitudeDifference;
            glideRequiredEl.textContent = requiredRatio.toFixed(1);
        } else {
            glideRequiredEl.textContent = "---";
        }
    }

    if (glideCurrentEl && speedMs > 0 && descentRateMps > 0.1) {
        currentRatio = speedMs / descentRateMps;
        glideCurrentEl.textContent = currentRatio.toFixed(1);
    } else {
        glideCurrentEl.textContent = "---";
    }

    if (glideCurrentEl && requiredRatio !== null && currentRatio !== null) {
        const tolerance = 0.10 * requiredRatio;
        glideCurrentEl.classList.remove('glide-good', 'glide-ok', 'glide-bad');
        if (currentRatio > requiredRatio + tolerance) {
            glideCurrentEl.classList.add('glide-good');
        } else if (currentRatio < requiredRatio - tolerance) {
            glideCurrentEl.classList.add('glide-bad');
        } else {
            glideCurrentEl.classList.add('glide-ok');
        }
    } else if (glideCurrentEl) {
        glideCurrentEl.classList.remove('glide-good', 'glide-ok', 'glide-bad');
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
        console.log('[main-mobile] Map has moved or zoomed. Updating visualizations based on new view.');

        const currentZoom = AppState.map.getZoom();

        if (Settings.state.userSettings.calculateJump && AppState.weatherData && AppState.lastLat) {
            if (currentZoom < UI_DEFAULTS.MIN_ZOOM || currentZoom > UI_DEFAULTS.MAX_ZOOM) {
                mapManager.drawJumpVisualization(null); // This hides the circles
            } else {
                // This is the missing part: redraw the circles when zooming back in
                calculateJump();
            }
        }
        if (Settings.state.userSettings.showJumpRunTrack) {
            if (currentZoom < UI_DEFAULTS.MIN_ZOOM || currentZoom > UI_DEFAULTS.MAX_ZOOM) {
                mapManager.drawJumpRunTrack(null); // JRT ausblenden
            } else {
                // NEU: Wenn der Zoom wieder im gültigen Bereich ist, den JRT neu zeichnen.
                displayManager.updateJumpRunTrackDisplay();
            }
        }
        if (Settings.state.userSettings.showLandingPattern) {
            displayManager.updateLandingPatternDisplay();
        }
        if (Settings.state.userSettings.selectedEnsembleModels.length > 0) {
            if (currentZoom < UI_DEFAULTS.MIN_ZOOM || currentZoom > UI_DEFAULTS.MAX_ZOOM) {
                // `clearEnsembleVisualizations` aus dem `ensembleManager` aufrufen.
                EnsembleManager.clearEnsembleVisualizations();
            } else {
                // `processAndVisualizeEnsemble` mit dem aktuellen Slider-Wert aufrufen, um die Visualisierungen neu zu zeichnen.
                EnsembleManager.processAndVisualizeEnsemble(getSliderValue(), getInterpolationStep());
            }
        }
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
            if (!event || !event.detail) {
                Utils.handleError('Received invalid track data. Please try again.');
                return;
            }

            const { lat, lng, timestamp, historicalDate, summary } = event.detail;
            console.log('[main-mobile] Event "track:loaded" empfangen, starte Aktionen.');

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

            // Schritt 1: Marker auf der Karte erstellen ODER aktualisieren.
            // Diese Funktion setzt auch die Geländehöhe (lastAltitude), worauf wir warten.
            await mapManager.createOrUpdateMarker(lat, lng);

            // Schritt 2: Wetterdaten für den spezifischen Zeitstempel des Tracks abrufen.
            const newWeatherData = await weatherManager.fetchWeatherForLocation(lat, lng, timestamp);

            if (newWeatherData) {
                AppState.weatherData = newWeatherData;

                // Schritt 3: Den korrekten Index für den Slider finden.
                const slider = document.getElementById('timeSlider');
                if (slider && AppState.weatherData.time && timestamp) {
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
                    slider.value = bestIndex;
                }
            }
            console.log("Performing specific updates after track load...");
            // Schritt 4: Alle UI-Elemente mit den neuen, zeitlich korrekten Daten aktualisieren.
            await displayManager.updateWeatherDisplay(getSliderValue(), 'weather-table-container', 'selectedTime');
            await displayManager.refreshMarkerPopup();
            if (AppState.lastAltitude !== 'N/A') {
                calculateMeanWind();
                if (Settings.state.userSettings.calculateJump) {
                    calculateJump();
                }
                displayManager.updateLandingPatternDisplay();
            }
            //            updateJumpMasterLineAndPanel();

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
            console.error('Erroro processing track:loaded:', error);
            Utils.handleError('Could not load track data completely.');
        } finally {
            if (loadingElement) {
                loadingElement.style.display = 'none';
            }
        }
    });

    document.addEventListener('tracking:positionUpdated', (event) => {
        console.log('[main-mobile] Event "tracking:positionUpdated" received. Data:', event.detail);
        updateJumpMasterLineAndPanel(event.detail);
        updateDashboardPanel(event.detail);
        if (AppState.isAutoRecording) {
            SensorManager.checkLanding(event.detail.descentRateMps);
        }
    });

    document.addEventListener('jml:targetChanged', () => {
        updateJumpMasterLineAndPanel();
    });

    document.addEventListener('harp:updated', () => {
        console.log('[App] HARP has been updated, resetting offsets and triggering JRT recalculation.');

        // NEU: Setzt die sichtbaren Input-Felder auf 0 zurück.
        setInputValueSilently('jumpRunTrackOffset', 0);
        setInputValueSilently('jumpRunTrackForwardOffset', 0);

        // Bestehende Logik zum Neuzeichnen des Tracks und der JM-Linie
        displayManager.updateJumpRunTrackDisplay();
        // Die folgende Zeile ist nur in main-mobile.js relevant
        if (typeof updateJumpMasterLineAndPanel === 'function') {
            updateJumpMasterLineAndPanel();
        }
    });

    document.addEventListener('ui:sliderChanged', async (e) => {
        console.log("[main-mobile] Event 'ui:sliderChanged' empfangen, spezifische Updates werden ausgeführt.");

        try {
            const sliderIndex = getSliderValue();
            if (AppState.weatherData && AppState.lastLat && AppState.lastLng) {
                // 1. Die Haupt-Wettertabelle anzeigen lassen
                await displayManager.updateWeatherDisplay(sliderIndex, 'weather-table-container', 'selectedTime');
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

    document.addEventListener('ui:radioGroupChanged', async (e) => {
        const { name } = e.detail;
        console.log(`[main-mobile] Radio group '${name}' changed. Performing specific updates.`);

        // Zuerst führen wir Aktionen aus, die fast immer nötig sind,
        // oder die die Grundlage für weitere Berechnungen bilden.
        if (['refLevel', 'heightUnit', 'temperatureUnit', 'windUnit'].includes(name)) {
            await displayManager.updateWeatherDisplay(getSliderValue(), 'weather-table-container', 'selectedTime');
        }
        // Jetzt steuern wir spezifische Aktionen basierend auf der geänderten Einstellung
        switch (name) {
            case 'heightUnit':
                // Ihr Wunsch: Koordinaten-Anzeige bei Mausover aktualisieren
                if (AppState.lastMouseLatLng) {
                    const { lat, lng } = AppState.lastMouseLatLng;
                    const coordFormat = getCoordinateFormat();
                    let coordText = coordFormat === 'MGRS' ? `MGRS: ${Utils.decimalToMgrs(lat, lng)}` : `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;
                    Utils.debouncedGetElevationAndQFE(lat, lng, { lat, lng }, ({ elevation, qfe }, requestLatLng) => {
                        if (AppState.lastMouseLatLng && Math.abs(AppState.lastMouseLatLng.lat - requestLatLng.lat) < 0.05) {
                            const heightUnit = getHeightUnit(); // Holt die *neue* Einheit
                            let displayElevation = (elevation !== 'N/A') ? Math.round(Utils.convertHeight(elevation, heightUnit)) : 'N/A';
                            AppState.coordsControl.update(`${coordText}<br>Elevation: ${displayElevation} ${displayElevation === 'N/A' ? '' : heightUnit}`);
                        }
                    });
                }
                //GPX-Tooltips aktualisieren (Logik bleibt hier, wird bei Bedarf getriggert)
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
                                layer.setTooltipContent(Utils.getTooltipContent(closestPoint, closestIndex, AppState.gpxPoints, groundAltitude, windUnit, heightUnit)).openTooltip(latlng);
                            });
                        }
                    });
                }

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
                calculateJump(); // Auch die Exit-Kreise und die blauen Kreise müssen neu berechnet werden
                if (AppState.map) { AppState.map.invalidateSize(); }
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
                    EnsembleManager.processAndVisualizeEnsemble(getSliderValue());
                }
                displayManager.updateJumpRunTrackDisplay();
                break;

            //Eigener Fall für die Cut-Away-Höhe ---
            case 'cutAwayAltitude':
                if (AppState.weatherData && AppState.cutAwayLat !== null) {
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

            // ... (die restlichen cases bleiben wie im vorherigen Schritt) ...
            case 'jumpRunTrackDirection':
                // Offsets bei manueller Richtungsänderung zurücksetzen
                Settings.state.userSettings.jumpRunTrackOffset = 0;
                Settings.state.userSettings.jumpRunTrackForwardOffset = 0;
                setInputValueSilently('jumpRunTrackOffset', 0);
                setInputValueSilently('jumpRunTrackForwardOffset', 0);
                Settings.save(); // Wichtig: Geänderte Offsets speichern

                if (AppState.weatherData) {
                    displayManager.updateJumpRunTrackDisplay();
                    calculateJump(); // Exit Circles SOFORT neu berechnen
                }
                break;

            case 'jumpRunTrackOffset':
            case 'jumpRunTrackForwardOffset':
                if (AppState.weatherData) {
                    displayManager.updateJumpRunTrackDisplay();
                    calculateJump(); // Auch bei Offset-Änderung Kreise neu berechnen
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
                    calculateJump(); // Exit Circles und blaue Kreise müssen neu berechnet werden
                    if (AppState.map) { AppState.map.invalidateSize(); }
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

        if (isChecked) {
            // Wenn die Box aktiviert wird, zeichne den Track.
            // Die Logik hier verwendet jetzt entweder den berechneten Wert 
            // oder einen neu eingegebenen benutzerdefinierten Wert.
            displayManager.updateJumpRunTrackDisplay();
        } else {
            // 1. Die Visualisierung von der Karte entfernen.
            mapManager.drawJumpRunTrack(null);

            // 2. Die benutzerdefinierte Richtung und das Eingabefeld zurücksetzen.
            // Das 'false' als Parameter verhindert ein unnötiges Neuzeichnen.
            resetJumpRunDirection(false);
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
        if (downloadFormat === 'SurfaceData') {
            downloadSurfaceDataAsAscii();
        } else if (downloadFormat === 'ComprehensiveReport') { // NEUER FALL
            exportComprehensiveReportAsHtml();
        } else {
            downloadTableAsAscii(downloadFormat);
        }
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
        console.log('[main-mobile] Recalculate jump triggered.');
        if (AppState.weatherData && AppState.lastLat && AppState.lastLng && Settings.state.userSettings.calculateJump) {
            calculateJump();
        }
    });

    document.addEventListener('ui:landingPatternEnabled', () => {
        console.log('[main-mobile] Landing pattern enabled, updating display.');
        displayManager.updateLandingPatternDisplay();
    });

    document.addEventListener('ui:landingPatternDisabled', () => {
        console.log('[main-mobile] Landing pattern disabled, clearing display.');
        mapManager.drawLandingPattern(null); // Ruft die Funktion zum Löschen des Musters auf
    });

    document.addEventListener('ui:invalidInput', (e) => {
        const { id, defaultValue } = e.detail;
        console.log(`[main-mobile] Received invalid input for ${id}. Resetting UI to ${defaultValue}.`);

        applySettingToInput(id, defaultValue);
    });

    document.addEventListener('setting:changed', async (e) => {
        const { key } = e.detail;
        console.log(`[main-mobile] Setting '${key}' changed. Triggering UI updates.`);

        if (key === 'timeZone') {
            await displayManager.updateSliderLabels();
        }

        // Hinzugefügte Logik
        if (key === 'maxForecastTime') {
            if (AppState.lastLat && AppState.lastLng) {
                const timeIndexToPreserve = getSliderValue();
                const currentTime = AppState.weatherData?.time?.[timeIndexToPreserve] || null;

                const newWeatherData = await weatherManager.fetchWeatherForLocation(AppState.lastLat, AppState.lastLng, currentTime);
                if (newWeatherData) {
                    await updateUIWithNewWeatherData(newWeatherData, timeIndexToPreserve);
                }
            }
        }

        // All Einheiten-Änderungen erfordern jetzt eine breite Aktualisierung
        const settingsThatTriggerFullUpdate = [
            'refLevel', 'heightUnit', 'windUnit', 'temperatureUnit', 'timeZone', 'coordFormat'
        ];

        if (settingsThatTriggerFullUpdate.includes(key)) {
            // Führe alle notwendigen UI-Updates aus
            await displayManager.updateWeatherDisplay(getSliderValue(), 'weather-table-container', 'selectedTime');

            //Ruft die Funktion auf, die die Labels aktualisiert
            if (key === 'heightUnit' || key === 'refLevel') { }

            if (AppState.lastAltitude !== 'N/A') {
                calculateMeanWind();
            }
            if (Settings.getValue('calculateJump', false)) {
                calculateJump();
            }

            displayManager.updateLandingPatternDisplay();
            updateJumpMasterLineAndPanel();
            await displayManager.refreshMarkerPopup();

            // Wichtig: explizites Update des Fadenkreuz-Displays
            if (AppState.map) {
                AppState.map.fire('move');
            }
        }
    });

    document.addEventListener('sensor:armed', () => {
        const armButton = document.getElementById('arm-recording-button');
        const manualButton = document.getElementById('manual-recording-button');
        if (armButton) {
            armButton.textContent = "Armed";
            armButton.classList.add('armed');
            armButton.classList.remove('recording');
        }
        if (manualButton) {
            manualButton.disabled = true; // Manuellen Button sperren, wenn "scharf"
        }
    });

    document.addEventListener('sensor:disarmed', () => {
        const armButton = document.getElementById('arm-recording-button');
        const manualButton = document.getElementById('manual-recording-button');
        if (armButton) {
            armButton.textContent = "Arm Recording";
            armButton.classList.remove('armed', 'recording');
        }
        if (manualButton) {
            manualButton.disabled = false; // Manuellen Button wieder freigeben
        }
    });

    document.addEventListener('sensor:freefall_detected', () => {
        // Nur starten, wenn das System "scharf" ist und nicht bereits aufzeichnet
        if (AppState.isArmed && !AppState.isAutoRecording) {
            console.log("Freefall detected, starting automatic recording...");
            AppState.isAutoRecording = true;
            AppState.recordedTrackPoints = []; // Startet eine saubere Aufzeichnung

            liveTrackingManager.startPositionTracking(); // Stellt sicher, dass das GPS-Tracking läuft

            // Aktualisiert den Button-Text und die Optik
            const armButton = document.getElementById('arm-recording-button');
            if (armButton) {
                armButton.textContent = "Recording...";
                armButton.classList.add('recording');
            }
            Utils.handleMessage("Freefall detected! Recording started.");
        }
    });

    document.addEventListener('track:point_added', () => {
        if (AppState.recordedTrackPoints.length > 1) {
            mapManager.drawRecordedTrack(AppState.recordedTrackPoints);
        }
    });

    document.addEventListener('sensor:disarmed', () => {
        // ... bestehender Code
        mapManager.clearRecordedTrack(); // Linie entfernen
    });

    document.addEventListener('sensor:landing_detected', () => {
        saveRecordedTrack();
        AppState.isAutoRecording = false;

        // Button-Zustände zurücksetzen
        const manualButton = document.getElementById('manual-recording-button');
        if (manualButton) {
            manualButton.textContent = "Start Recording";
            manualButton.classList.remove('recording');
        }
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

    // In der mobilen App soll die Tabelle im Data-Panel immer angezeigt werden.
    Settings.state.userSettings.showTable = true;
    applyDeviceSpecificStyles();

    // Explizit den Slider auf die aktuelle Stunde setzen
    const slider = document.getElementById('timeSlider');
    if (slider) {
        const currentUtcHour = new Date().getUTCHours();
        slider.value = currentUtcHour;
        console.log(`[App] Initialized timeSlider to current UTC hour: ${currentUtcHour}`);
    }

    // KORREKTUR: Der Event-Listener wird hier registriert, BEVOR das Event ausgelöst wird.
    document.addEventListener('location:selected', async (event) => {
        const { lat, lng, source } = event.detail;
        console.log(`App: Event 'location:selected' empfangen. Quelle: ${source}, Koordinaten: ${lat}, ${lng}`);
        mapManager.clearTerrainWarning(); // Alte Terrain-Analyse sofort entfernen
        AppState.terrainAnalysisCache = null;

        // Validierung der Koordinaten
        if (!Utils.isValidLatLng(lat, lng)) {
            console.warn('[App] Ungültige Koordinaten empfangen:', { lat, lng });
            Utils.handleError('Ungültige Position ausgewählt. Verwende Standardposition.');
            return;
        }

        const loadingElement = document.getElementById('loading');
        if (loadingElement) loadingElement.style.display = 'block';

        try {
            AppState.lastLat = lat;
            AppState.lastLng = lng;

            const isInitialLoad = (source === 'geolocation' || source === 'geolocation_fallback');
            const currentTimeToPreserve = isInitialLoad ? null : (AppState.weatherData?.time?.[getSliderValue()] || null);

            console.log(`[App] Fetching weather data for lat: ${lat}, lng: ${lng}, time: ${currentTimeToPreserve || 'current'}`);
            const newWeatherData = await weatherManager.fetchWeatherForLocation(lat, lng, currentTimeToPreserve);

            if (newWeatherData) {
                console.log('[App] Weather data loaded successfully:', newWeatherData);
                await updateUIWithNewWeatherData(newWeatherData, isInitialLoad ? null : getSliderValue());
            } else {
                AppState.weatherData = null;
                Utils.handleError('Keine Wetterdaten verfügbar.');
            }

            await mapManager.createOrUpdateMarker(lat, lng);
            await displayManager.refreshMarkerPopup();

            if (source !== 'marker_click') {
                mapManager.recenterMap(true);
            }
            AppState.isManualPanning = false;

            if (source === 'geolocation' || source === 'geolocation_fallback') {
                console.log('[App] Starting initial caching after geolocation...');
                cacheTilesForDIP({
                    map: AppState.map,
                    lastLat: lat,
                    lastLng: lng,
                    baseMaps: AppState.baseMaps,
                    onProgress: displayProgress,
                    onComplete: displayMessage,
                    onCancel: () => displayMessage('Caching cancelled.'),
                    radiusKm: 5,
                    silent: true
                });
            }
        } catch (error) {
            console.error('[App] Fehler beim Verarbeiten von "location:selected":', error);
            displayError(error.message);
        } finally {
            if (loadingElement) loadingElement.style.display = 'none';
        }
    });

    // Initialisiert die Karte und prüft, ob Wetterdaten geladen wurden
    try {
        console.log('[App] Starting map initialization...');
        await mapManager.initializeMap();
        console.log('[App] Map initialization completed.');

        // Prüfe, ob Wetterdaten geladen wurden
        if (!AppState.weatherData) {
            console.warn('[App] No weather data loaded after map initialization.');
            // Prüfe, ob eine gültige Position vorliegt
            if (!Utils.isValidLatLng(AppState.lastLat, AppState.lastLng)) {
                console.warn('[App] Keine gültige Position nach Karteninitialisierung. Verwende Fallback.');
                const fallbackLat = 51.505; // Beispiel: London
                const fallbackLng = -0.09;
                AppState.lastLat = fallbackLat;
                AppState.lastLng = fallbackLng;
                document.dispatchEvent(new CustomEvent('location:selected', {
                    detail: { lat: fallbackLat, lng: fallbackLng, source: 'geolocation_fallback' }
                }));
            } else {
                // Gültige Position vorhanden, aber keine Wetterdaten -> erneuter Versuch
                console.log('[App] Retrying weather data fetch with existing coordinates:', AppState.lastLat, AppState.lastLng);
                document.dispatchEvent(new CustomEvent('location:selected', {
                    detail: { lat: AppState.lastLat, lng: AppState.lastLng, source: 'geolocation_retry' }
                }));
            }
        }
    } catch (error) {
        console.error('[App] Fehler bei der Karteninitialisierung:', error);
        displayError('Konnte Karte nicht initialisieren. Verwende Standardposition.');

        // Fallback: Verwende eine Standardposition
        const fallbackLat = 51.505; // Beispiel: London
        const fallbackLng = -0.09;
        console.log(`[App] Using fallback coordinates: ${fallbackLat}, ${fallbackLng}`);
        AppState.lastLat = fallbackLat;
        AppState.lastLng = fallbackLng;
        document.dispatchEvent(new CustomEvent('location:selected', {
            detail: { lat: fallbackLat, lng: fallbackLng, source: 'geolocation_fallback' }
        }));
    }

    // Alle anderen Listener können sicher nach der Karteninitialisierung eingerichtet werden.
    setupAppEventListeners();
    AutoupdateManager.setupAutoupdate();
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

        let anchorPosition;
        const harpAnchor = AppState.harpMarker ? AppState.harpMarker.getLatLng() : null;

        if (harpAnchor) {
            anchorPosition = harpAnchor;
            console.log("JRT-Ankerpunkt ist HARP.");
        } else {
            anchorPosition = L.latLng(AppState.lastLat, AppState.lastLng);
            console.log("JRT-Ankerpunkt ist DIP.");
        }

        const trackLength = originalTrackData.trackLength;
        const trackDirection = originalTrackData.airplane.bearing;
        const newEndPoint = newPosition;

        const [newStartLat, newStartLng] = Utils.calculateNewCenter(
            newEndPoint.lat,
            newEndPoint.lng,
            trackLength,
            (trackDirection + 180) % 360
        );
        const newStartPoint = L.latLng(newStartLat, newStartLng);

        const totalDistance = AppState.map.distance(anchorPosition, newStartPoint);
        const bearingFromAnchorToStart = Utils.calculateBearing(anchorPosition.lat, anchorPosition.lng, newStartPoint.lat, newStartPoint.lng);

        let angleDifference = bearingFromAnchorToStart - trackDirection;
        angleDifference = (angleDifference + 180) % 360 - 180;

        const angleRad = angleDifference * (Math.PI / 180);
        const forwardOffset = Math.round(totalDistance * Math.cos(angleRad));
        const lateralOffset = Math.round(totalDistance * Math.sin(angleRad));

        Settings.state.userSettings.jumpRunTrackOffset = lateralOffset;
        Settings.state.userSettings.jumpRunTrackForwardOffset = forwardOffset;
        Settings.save();

        setInputValueSilently('jumpRunTrackOffset', lateralOffset);
        setInputValueSilently('jumpRunTrackForwardOffset', forwardOffset);

        displayManager.updateJumpRunTrackDisplay();
    });

    document.addEventListener('harp:updated', () => {
        console.log('[App] HARP has been updated, triggering JRT recalculation.');
        displayManager.updateJumpRunTrackDisplay();
    });

    document.addEventListener('ui:lockStateChanged', updateLockStatesUI);

    setTimeout(() => {
        if (AppState.map) {
            console.log("[App] Finalizing layout: invalidating map size and redrawing overlays.");
            AppState.map.invalidateSize();

            // Erzwinge eine Neuberechnung und Neuzeichnung der Overlays,
            // nachdem die Kartengröße finalisiert wurde.
            if (Settings.state.userSettings.showJumpRunTrack) {
                displayManager.updateJumpRunTrackDisplay();
            }
            if (Settings.state.userSettings.showLandingPattern) {
                displayManager.updateLandingPatternDisplay();
            }
            // `calculateJump` zeichnet alle Kreise (Exit, Canopy etc.) neu
            if (Settings.state.userSettings.calculateJump) {
                calculateJump();
            }
        }
    }, 250); // Ein etwas längerer Timeout für mehr Sicherheit auf langsameren Geräten.
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

window.simulateFreefall = () => document.dispatchEvent(new CustomEvent('sensor:freefall_detected'));