/**
 * @file displayManager.js
 * @description Dieses Modul ist verantwortlich für die Aktualisierung der Benutzeroberfläche (UI).
 * Es nimmt verarbeitete Daten entgegen und sorgt für die korrekte Darstellung in den
 * UI-Panels (z.B. Wettertabelle) und auf der Karte (z.B. Landemuster, JRT).
 */

import { AppState } from '../core/state.js';
import { Settings, getInterpolationStep } from '../core/settings.js';
import { Utils } from '../core/utils.js';
import { getSliderValue } from '../ui-mobile/ui.js';
import * as mapManager from './mapManager.js';
import * as weatherManager from '../core/weatherManager.js';
import { UI_DEFAULTS } from '../core/constants.js'; // UI_DEFAULTS für LANDING_PATTERN_MIN_ZOOM
import * as JumpPlanner from '../core/jumpPlanner.js';
import { generateWindspinne } from '../core/windchart.js';
import { DateTime } from 'luxon';

// ===================================================================
// 1. Wetter- und Info-Anzeigen
// ===================================================================

/**
 * Rendert die detaillierte Wettertabelle basierend auf dem ausgewählten Zeitindex.
 * Die Funktion interpoliert die Roh-Wetterdaten, erstellt die komplette HTML-Tabelle 
 * mit allen Höhenstufen, Werten und Styling-Klassen und fügt sie in das Info-Element ein.
 * @param {number} index - Der Index des Zeitschiebereglers, für den die Daten angezeigt werden sollen.
 * @param {string|null} [originalTime=null] - Ein optionaler Zeitstempel, der für die Anzeige verwendet werden kann.
 * @returns {Promise<void>}
 */
export async function updateWeatherDisplay(index, tableContainerId, timeContainerId, originalTime = null) {
    console.log(`updateWeatherDisplay called for index: ${index} -> into ${tableContainerId}`);

    const tableContainer = document.getElementById(tableContainerId);
    const timeContainer = document.getElementById(timeContainerId);

    // Sicherheitsprüfung: Stellen sicher, dass die Container existieren
    if (!tableContainer || !timeContainer) {
        console.error('Target container(s) for weather display not found!', { tableContainerId, timeContainerId });
        return;
    }

    if (!AppState.weatherData || !AppState.weatherData.time || index < 0 || index >= AppState.weatherData.time.length) {
        console.error('No weather data available or index out of bounds:', index);
        tableContainer.innerHTML = '<p style="padding: 20px; text-align: center;">No weather data available</p>';
        timeContainer.innerHTML = 'Selected Time: ';
        const slider = document.getElementById('timeSlider');
        if (slider) slider.value = 0;
        return;
    }

    // START: NEUER CODEBLOCK FÜR KONSOLENAUSGABE
    const visibility = AppState.weatherData.visibility?.[index];
    const weatherCode = AppState.weatherData.weather_code?.[index];
    const significantWeather = Utils.translateWmoCodeToTaf(weatherCode); // Übersetzen

    console.log(`--- Bodenwetter für Index ${index} ---`);
    console.log(`Sichtweite (Visibility): ${visibility ?? 'N/A'} m`);
    console.log(`Wetter-Code (WMO 4677): ${weatherCode ?? 'N/A'} (${significantWeather})`);
    console.log(`---------------------------------`);
    // ENDE: NEUER CODEBLOCK

    AppState.landingWindDir = AppState.weatherData.wind_direction_10m[index] || null;
    console.log('landingWindDir updated to:', AppState.landingWindDir);

    const customLandingDirectionLLInput = document.getElementById('customLandingDirectionLL');
    const customLandingDirectionRRInput = document.getElementById('customLandingDirectionRR');
    if (customLandingDirectionLLInput && customLandingDirectionRRInput && AppState.landingWindDir !== null) {
        customLandingDirectionLLInput.value = Math.round(AppState.landingWindDir);
        customLandingDirectionRRInput.value = Math.round(AppState.landingWindDir);
    }

    const refLevel = document.getElementById('refLevel')?.value || 'AGL';
    const heightUnit = Settings.getValue('heightUnit', 'radio', 'm');
    const windSpeedUnit = Settings.getValue('windUnit', 'radio', 'kt');
    const temperatureUnit = Settings.getValue('temperatureUnit', 'radio', 'C');
    // Pass lat and lng to getDisplayTime
    const timeZone = Settings.getValue('timeZone', 'radio', 'Z');
    const time = await Utils.getDisplayTime(AppState.weatherData.time[index], AppState.lastLat, AppState.lastLng, timeZone);
    const interpStep = getInterpolationStep();
    const interpolatedData = weatherManager.interpolateWeatherData(
        AppState.weatherData,
        index,
        interpStep,
        Math.round(AppState.lastAltitude),
        heightUnit
    );
    const surfaceHeight = refLevel === 'AMSL' && AppState.lastAltitude !== 'N/A' ? Math.round(AppState.lastAltitude) : 0;

    // NEU: Das obere Limit aus dem UI-Element auslesen
    const upperLimit = parseInt(document.getElementById('upperLimit')?.value) || 3000;

    // NEU: Die interpolierten Daten basierend auf dem Limit filtern
    const filteredData = interpolatedData.filter(data => data.displayHeight <= upperLimit);

    // NEU: Zuerst alle Zeilen als HTML-Strings generieren
    const tableRowsHtml = filteredData.map(data => {
        // ... (Die gesamte Logik zur Berechnung von windClass, humidityClass, displayHeight, etc. bleibt hier drin) ...
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

        const cloudCover = data.cc;
        let cloudCoverClass = '';
        if (cloudCover !== 'N/A' && Number.isFinite(cloudCover)) {
            if (cloudCover <= 10) cloudCoverClass = 'cloud-cover-clear';
            else if (cloudCover <= 25) cloudCoverClass = 'cloud-cover-few';
            else if (cloudCover <= 50) cloudCoverClass = 'cloud-cover-scattered';
            else if (cloudCover <= 87) cloudCoverClass = 'cloud-cover-broken';
            else cloudCoverClass = 'cloud-cover-overcast';
        }

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
        const windBarbSvg = data.dir === 'N/A' || isNaN(speedKt) ? 'N/A' : Utils.generateWindBarb(data.dir, speedKt);

        return `<tr class="${windClass} ${cloudCoverClass}">
                    <td>${Math.round(displayHeight)}</td>
                    <td>${Utils.roundToTens(data.dir)}</td>
                    <td>${formattedWind}</td>
                    <td>${windBarbSvg}</td>
                    <td>${formattedTemp}</td>
                    <td>${Math.round(data.rh)}</td>
                    <td>${data.cc}</td> <!-- NEUE SPALTE für Wolkenbedeckung -->
                </tr>`;
    }).join(''); // .join('') fügt alle Zeilen zu einem einzigen String zusammen

    // NEU: Die gesamte Tabelle in einer einzigen, lesbaren Vorlage erstellen
    const output = `
        <table id="weatherTable">
            <thead>
                <tr>
                    <th>Height (${heightUnit} ${refLevel})</th>
                    <th>Dir (deg)</th>
                    <th>Spd (${windSpeedUnit})</th>
                    <th>Wind</th>
                    <th>T (${temperatureUnit === 'C' ? '°C' : '°F'})</th>
                    <th>RH (%)</th>
                    <th>CC (%)</th> <!-- NEUE SPALTE für Wolkenbedeckung -->
                </tr>
            </thead>
            <tbody>
                ${tableRowsHtml}
            </tbody>
        </table>`;

    tableContainer.innerHTML = output; // <-- Nutzt den Parameter
    timeContainer.innerHTML = `Selected Time: ${time}`; // <-- Nutzt den Parameter
    if (interpolatedData.length > 0) {
        const userMaxHoehe = parseInt(document.getElementById('upperLimit')?.value) || 3000;
        generateWindspinne(interpolatedData, userMaxHoehe);
    }
}

/**
 * Aktualisiert den Inhalt des Popups für den Hauptmarker (`currentMarker`).
 * Holt die aktuellen Koordinaten, die Höhe und den QFE-Wert aus dem AppState
 * und rendert den Inhalt neu. Forciert das Öffnen des Popups.
 * @returns {Promise<void>}
 */
export async function refreshMarkerPopup() {
    if (!AppState.currentMarker || AppState.lastLat === null) {
        return;
    }

    const lat = AppState.lastLat;
    const lng = AppState.lastLng;
    const altitude = AppState.lastAltitude;

    // NEU: Die aktuell ausgewählte Höheneinheit abfragen
    const heightUnit = Settings.getValue('heightUnit', 'radio', 'm');

    // NEU: Höhe und Einheit für die Anzeige vorbereiten
    let displayAltitude = 'N/A';
    let displayUnit = '';

    if (altitude !== 'N/A') {
        if (heightUnit === 'ft') {
            displayAltitude = Math.round(Utils.convertHeight(altitude, 'ft'));
            displayUnit = 'ft';
        } else {
            displayAltitude = altitude; // bleibt in Metern
            displayUnit = 'm';
        }
    }

    const coordFormat = Settings.getValue('coordFormat', 'radio', 'Decimal');
    const sliderIndex = getSliderValue();
    const weatherCode = AppState.weatherData.weather_code?.[sliderIndex]; // Wettercode holen
    const significantWeather = Utils.translateWmoCodeToTaf(weatherCode); // Übersetzen

    const coords = Utils.convertCoords(lat, lng, coordFormat);



    let popupContent;
    if (coordFormat === 'MGRS') {
        popupContent = `MGRS: ${coords.lat}<br>Alt: ${displayAltitude} ${displayUnit}`;
    } else {
        const formatDMS = (dms) => `${dms.deg}°${dms.min}'${dms.sec.toFixed(0)}" ${dms.dir}`;
        if (coordFormat === 'DMS') {
            popupContent = `Lat: ${formatDMS(Utils.decimalToDms(lat, true))}<br>Lng: ${formatDMS(Utils.decimalToDms(lng, false))}<br>Alt: ${displayAltitude} ${displayUnit}`;
        } else {
            popupContent = `Lat: ${lat.toFixed(5)}<br>Lng: ${lng.toFixed(5)}<br>Alt: ${displayAltitude} ${displayUnit}`;
        }
    }

    if (AppState.weatherData && AppState.weatherData.surface_pressure) {
        const surfacePressure = AppState.weatherData.surface_pressure[sliderIndex];
        if (surfacePressure) {
            popupContent += ` QFE: ${surfacePressure.toFixed(0)} hPa`;
        } else {
            popupContent += ` QFE: N/A`;
        }
        // NEU: Signifikantes Wetter zum Popup hinzufügen, falls relevant
        if (significantWeather && significantWeather !== 'N/A' && significantWeather !== 'SKC') {
             popupContent += `<br>Weather: ${significantWeather}`;
        }
    } else {
        popupContent += ` QFE: N/A`;
    }

    mapManager.updatePopupContent(AppState.currentMarker, popupContent);
}

/**
 * Aktualisiert den Inhalt des Popups für die Modell-Informationen.
 */
export function updateModelInfoPopup() {
    const modelInfoPopup = document.getElementById('modelInfoPopup');
    const modelSelect = document.getElementById('modelSelect');
    if (!modelInfoPopup || !modelSelect) return;

    const model = modelSelect.value;
    const modelRun = AppState.lastModelRun || "N/A"; // Holt den Model-Run aus dem AppState

    const titleContent = `Model: ${model.replace(/_/g, ' ').toUpperCase()}\\nRun: ${modelRun}`;

    // Ersetzt Zeilenumbrüche durch <br> für die HTML-Anzeige
    modelInfoPopup.innerHTML = titleContent.replace(/\\n/g, '<br>');
}

/**
 * Erstellt und positioniert Datums-Labels unterhalb des Time-Sliders.
 * Die Funktion erkennt den Tageswechsel intelligent basierend auf der
 * ausgewählten Zeitzone und positioniert die Rand-Labels korrekt.
 */
export async function updateSliderLabels() {
    const slider = document.getElementById('timeSlider');
    const labelsContainer = document.getElementById('slider-labels');
    if (!slider || !labelsContainer || !AppState.weatherData || !AppState.weatherData.time) {
        if (labelsContainer) labelsContainer.innerHTML = '';
        return;
    }

    labelsContainer.innerHTML = '';
    const timeArray = AppState.weatherData.time;
    const totalSteps = parseInt(slider.max, 10);
    if (totalSteps <= 0) return;

    const timeZoneSetting = Settings.getValue('timeZone', 'radio', 'Z');
    let locationTimezone = 'utc';
    if (timeZoneSetting === 'loc' && AppState.lastLat) {
        const locData = await Utils.getLocationData(AppState.lastLat, AppState.lastLng);
        locationTimezone = locData.timezone || 'utc';
    }

    let lastDay = null;

    for (let index = 0; index < timeArray.length; index++) {
        const timeStr = timeArray[index];
        const dt = DateTime.fromISO(timeStr, { zone: 'utc' }).setZone(locationTimezone);
        const currentDay = dt.day;

        if (currentDay !== lastDay) {
            let bestIndexForNewDay = index;
            let minHourDiff = Math.abs(dt.hour);

            for (let j = 1; j < 4 && (index + j) < timeArray.length; j++) {
                const nextDt = DateTime.fromISO(timeArray[index + j], { zone: 'utc' }).setZone(locationTimezone);
                if (nextDt.day === currentDay) {
                    if (Math.abs(nextDt.hour) < minHourDiff) {
                        minHourDiff = Math.abs(nextDt.hour);
                        bestIndexForNewDay = index + j;
                    }
                } else {
                    break;
                }
            }

            if (currentDay !== lastDay) {
                const label = document.createElement('div');
                label.className = 'slider-label';
                label.textContent = dt.toFormat('MMM dd');
                
                const positionPercent = (bestIndexForNewDay / totalSteps) * 100;

                if (bestIndexForNewDay === 0) {
                    label.style.left = '0';
                    label.style.transform = 'translateX(0)';
                } else if (positionPercent > 98) {
                    label.style.left = '100%';
                    label.style.transform = 'translateX(-100%)';
                } else {
                    label.style.left = `${positionPercent}%`;
                    label.style.transform = 'translateX(0)';
                }
                
                labelsContainer.appendChild(label);
                lastDay = currentDay;
            }
        }
    }
}

// ===================================================================
// 2. Sprung-Visualisierungen
// ===================================================================

/**
 * Zeichnet oder entfernt das Landemuster auf der Karte.
 * Prüft den aktuellen Zoom-Level und ob das Feature aktiviert ist.
 * Holt die berechneten Koordinaten vom jumpPlanner und weist den mapManager an,
 * die Linien und Pfeile für das Muster zu zeichnen.
 * @returns {void}
 */
export function updateLandingPatternDisplay() {
    // Schritt 1: Alle Vorbedingungen prüfen (unverändert)
    if (!AppState.currentMarker || typeof AppState.currentMarker.getLatLng !== 'function') return;

    const markerLatLng = AppState.currentMarker.getLatLng();
    if (!markerLatLng) return;

    if (!Settings.state.userSettings.showLandingPattern || !AppState.weatherData || AppState.map.getZoom() < UI_DEFAULTS.LANDING_PATTERN_MIN_ZOOM) {
        mapManager.drawLandingPattern(null);
        return;
    }

    // Schritt 2: Daten für die Berechnung sammeln (unverändert)
    const sliderIndex = parseInt(document.getElementById('timeSlider').value) || 0;
    const interpStep = getInterpolationStep();
    const heightUnit = Settings.getValue('heightUnit', 'm');
    const windUnit = Settings.getValue('windUnit', 'kt');
    const baseHeight = Math.round(AppState.lastAltitude);

    const interpolatedData = weatherManager.interpolateWeatherData(
        AppState.weatherData, sliderIndex, interpStep, baseHeight, heightUnit
    );

    if (!interpolatedData || interpolatedData.length === 0) {
        mapManager.drawLandingPattern(null);
        return;
    }

    // Schritt 3: Zentrale Funktion für die Bein-Koordinaten aufrufen (unverändert)
    const patternCoords = JumpPlanner.calculateLandingPatternCoords(markerLatLng.lat, markerLatLng.lng, interpolatedData);

    if (!patternCoords) {
        mapManager.drawLandingPattern(null);
        return;
    }

    const { downwindStart, baseStart, finalStart, landingPoint } = patternCoords;

    // ================== NEU: Logik für Windpfeile wiederhergestellt ==================
    const heights = interpolatedData.map(d => d.height);
    const uComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'kt', 'km/h') * Math.sin(d.dir * Math.PI / 180));
    const vComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'kt', 'km/h') * Math.cos(d.dir * Math.PI / 180));

    const LEG_HEIGHT_FINAL = parseInt(document.getElementById('legHeightFinal').value) || 100;
    const LEG_HEIGHT_BASE = parseInt(document.getElementById('legHeightBase').value) || 200;
    const LEG_HEIGHT_DOWNWIND = parseInt(document.getElementById('legHeightDownwind').value) || 300;

    // Mittelwind für jeden Leg berechnen
    const finalMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, baseHeight, baseHeight + LEG_HEIGHT_FINAL);
    const baseMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, baseHeight + LEG_HEIGHT_FINAL, baseHeight + LEG_HEIGHT_BASE);
    const downwindMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, baseHeight + LEG_HEIGHT_BASE, baseHeight + LEG_HEIGHT_DOWNWIND);

    // Helferfunktion zur Farbcodierung der Pfeile
    const getArrowColor = (windSpeedKt) => {
        if (windSpeedKt <= 3) return 'lightblue';
        if (windSpeedKt <= 10) return 'lightgreen';
        if (windSpeedKt <= 16) return '#f5f34f';
        return '#ffcccc';
    };

    // Helferfunktion zur Formatierung des Tooltips
    const formatWindSpeed = (speedKt) => {
        const convertedSpeed = Utils.convertWind(speedKt, windUnit, 'kt');
        return windUnit === 'bft' ? Math.round(convertedSpeed) : convertedSpeed.toFixed(1);
    };

    // Die "Bauanleitung" für den mapManager erstellen
    const patternData = {
        legs: [
            { path: [landingPoint, finalStart] },
            { path: [finalStart, baseStart] },
            { path: [baseStart, downwindStart] }
        ],
        arrows: [
            {
                position: [(landingPoint[0] + finalStart[0]) / 2, (landingPoint[1] + finalStart[1]) / 2],
                bearing: (finalMeanWind[0] - 90 + 180) % 360,
                color: getArrowColor(finalMeanWind[1]),
                tooltipText: `${Math.round(finalMeanWind[0])}° ${formatWindSpeed(finalMeanWind[1])} ${windUnit}`
            },
            {
                position: [(finalStart[0] + baseStart[0]) / 2, (finalStart[1] + baseStart[1]) / 2],
                bearing: (baseMeanWind[0] - 90 + 180) % 360,
                color: getArrowColor(baseMeanWind[1]),
                tooltipText: `${Math.round(baseMeanWind[0])}° ${formatWindSpeed(baseMeanWind[1])} ${windUnit}`
            },
            {
                position: [(baseStart[0] + downwindStart[0]) / 2, (baseStart[1] + downwindStart[1]) / 2],
                bearing: (downwindMeanWind[0] - 90 + 180) % 360,
                color: getArrowColor(downwindMeanWind[1]),
                tooltipText: `${Math.round(downwindMeanWind[0])}° ${formatWindSpeed(downwindMeanWind[1])} ${windUnit}`
            }
        ]
    };
    // ================== ENDE DER WIEDERHERGESTELLTEN LOGIK ==================

    // Den mapManager anweisen, das Muster zu zeichnen
    mapManager.drawLandingPattern(patternData);
}

/**
 * Steuert die Anzeige des Jump Run Tracks auf der Karte.
 * Holt die berechneten Track-Daten vom jumpPlanner und übergibt sie
 * an den mapManager zum Zeichnen der Anfluglinie und des Flugzeug-Markers.
 * @returns {void}
 */
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
        Settings.state.userSettings.calculateJump;

    // Wenn die Bedingungen NICHT erfüllt sind, lösche den Track.
    if (!shouldShow) {
        console.log('Conditions not met to show JRT, clearing display.');
        mapManager.drawJumpRunTrack(null); // Sagt dem mapManager, alles zu löschen.
        AppState.lastTrackData = null; // Setzt die gespeicherten Track-Daten zurück.

        const directionInput = document.getElementById('jumpRunTrackDirection');
        if (directionInput && !Settings.state.userSettings.customJumpRunDirection) {
            directionInput.value = '';
        }

        return; // Beendet die Funktion hier.
    }

    // Wenn die Bedingungen erfüllt sind, zeichne den Track.
    // Neuer Code:
    const sliderIndex = getSliderValue();
    const interpStep = getInterpolationStep(); // Wert in der UI-Schicht holen
    const heightUnit = Settings.getValue('heightUnit', 'radio', 'm'); // Höheinheit aus den Einstellungen
    const interpolatedData = weatherManager.interpolateWeatherData(
        AppState.weatherData, // Das Haupt-Wetterdatenobjekt
        sliderIndex,
        interpStep,
        Math.round(AppState.lastAltitude),
        heightUnit
    ); // Und an die Core-Funktion übergeben
    const harpAnchor = AppState.harpMarker ? AppState.harpMarker.getLatLng() : null;
    const trackData = JumpPlanner.jumpRunTrack(interpolatedData, harpAnchor);

    const directionInput = document.getElementById('jumpRunTrackDirection');

    if (trackData && trackData.latlngs?.length === 2 && trackData.latlngs.every(ll => Number.isFinite(ll[0]) && Number.isFinite(ll[1]))) {
        console.log('Drawing jump run track with data:', trackData);

        if (directionInput && !Settings.state.userSettings.customJumpRunDirection) {
            directionInput.value = trackData.direction;
        }

        const drawData = {
            path: {
                latlngs: trackData.latlngs,
                options: { color: 'orange', weight: 5, opacity: 0.8 },
                tooltipText: `Jump Run: ${trackData.direction}°, ${trackData.trackLength} m`,
                originalLatLngs: AppState.lastTrackData?.latlngs?.length === 2 ? AppState.lastTrackData.latlngs : trackData.latlngs
            },
            approachPath: trackData.approachLatLngs?.length === 2 && trackData.approachLatLngs.every(ll => Number.isFinite(ll[0]) && Number.isFinite(ll[1])) ? {
                latlngs: trackData.approachLatLngs,
                options: { color: 'orange', weight: 5, opacity: 0.8, dashArray: '5, 10' },
                tooltipText: `Approach: ${trackData.direction}°, ${trackData.approachLength} m`,
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
        if (directionInput && !Settings.state.userSettings.customJumpRunDirection) {
            directionInput.value = '';
        }
    }
}