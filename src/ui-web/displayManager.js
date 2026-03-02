/**
 * @file displayManager.js
 * @description Dieses Modul ist verantwortlich für die Aktualisierung der Benutzeroberfläche (UI).
 * Es nimmt verarbeitete Daten entgegen und sorgt für die korrekte Darstellung in den
 * UI-Panels (z.B. Wettertabelle) und auf der Karte (z.B. Landemuster, JRT).
 */

import { AppState } from '../core/state.js';
import { Settings, getInterpolationStep } from '../core/settings.js';
import { Utils } from '../core/utils.js';
// KORREKTUR für Web: Normalerweise importiert displayManager.js aus './ui.js'. 
// Im bereitgestellten File war 'getSliderValue' aus '../ui-mobile/ui.js' importiert, was ungewöhnlich für Web ist, 
// aber ich folge dem lokalen './ui.js' Pattern, da die Datei ui.js im Web-Ordner existiert.
// Falls oben 'import ... from '../ui-mobile/ui.js'' steht, ändere ich das hier auf den korrekten relativen Pfad für Web:
import { getSliderValue, displayWarning } from '../ui-mobile/ui.js';
import * as mapManager from './mapManager.js';
import * as weatherManager from '../core/weatherManager.js';
import { UI_DEFAULTS, WIND_THRESHOLDS } from '../core/constants.js'; // UI_DEFAULTS für LANDING_PATTERN_MIN_ZOOM
import * as JumpPlanner from '../core/jumpPlanner.js';
import { generateWindspinne } from '../core/windchart.js';
import { DateTime } from 'luxon';
import { I18n } from '../core/i18n.js'; // <--- NEU: Importiert

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
        tableContainer.innerHTML = `<p style="padding: 20px; text-align: center;">${I18n.t('weather.no_data')}</p>`;
        timeContainer.innerHTML = I18n.t('common.selected_time');
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

    if (!AppState.isLandingDirectionLocked) {
        const customLandingDirectionLLInput = document.getElementById('customLandingDirectionLL');
        const customLandingDirectionRRInput = document.getElementById('customLandingDirectionRR');
        if (customLandingDirectionLLInput && customLandingDirectionRRInput && AppState.landingWindDir !== null) {
            const trueDir = Math.round(AppState.landingWindDir);
            customLandingDirectionLLInput.value = Math.round(Utils.applyNorthReference(trueDir, AppState.lastLat, AppState.lastLng));
            customLandingDirectionRRInput.value = Math.round(Utils.applyNorthReference(trueDir, AppState.lastLat, AppState.lastLng));
            // True-Wert in Settings speichern, damit northReference-Wechsel korrekt umrechnet
            Settings.state.userSettings.customLandingDirectionLL = trueDir;
            Settings.state.userSettings.customLandingDirectionRR = trueDir;
            Settings.save();
        }
    } else {
        console.log('Landing direction is locked. Skipping input field update.');
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
    const style = getComputedStyle(document.body);
    const barbColor = style.getPropertyValue('--text-primary').trim();

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
        let groundWindExceedsThreshold = false;
        const surfaceDisplayHeight = refLevel === 'AMSL' ? (heightUnit === 'ft' ? Math.round(surfaceHeight * 3.28084) : surfaceHeight) : 0;

        if (Math.round(data.displayHeight) === surfaceDisplayHeight) {
            const spdInKt = Utils.convertWind(spd, 'kt', 'km/h');
            if (spdInKt > WIND_THRESHOLDS.SURFACE_WIND_WARNING_KT) {
                groundWindExceedsThreshold = true;
            }

            if (AppState.weatherData.wind_gusts_10m[index] !== undefined && Number.isFinite(AppState.weatherData.wind_gusts_10m[index])) {
                const gustSpd_kmh = AppState.weatherData.wind_gusts_10m[index];
                const convertedGust = Utils.convertWind(gustSpd_kmh, windSpeedUnit, 'km/h');
                const gustInKt = Utils.convertWind(gustSpd_kmh, 'kt', 'km/h');

                const spdValue = windSpeedUnit === 'bft' ? Math.round(convertedSpd) : convertedSpd.toFixed(0);
                let gustValue = windSpeedUnit === 'bft' ? Math.round(convertedGust) : convertedGust.toFixed(0);

                // KORRIGIERTE LOGIK: Prüft die Böe unabhängig und wendet die Klasse nur auf den Wert an
                if (gustInKt > WIND_THRESHOLDS.GUST_WARNING_KT) {
                    gustValue = `<span class="gust-exceeds-threshold">${gustValue}</span>`;
                }

                formattedWind = `${spdValue} G ${gustValue}`;

            } else {
                formattedWind = convertedSpd === 'N/A' ? 'N/A' : (windSpeedUnit === 'bft' ? Math.round(convertedSpd) : convertedSpd.toFixed(0));
            }
        } else {
            formattedWind = convertedSpd === 'N/A' ? 'N/A' : (windSpeedUnit === 'bft' ? Math.round(convertedSpd) : convertedSpd.toFixed(0));
        }

        const speedKt = Math.round(Utils.convertWind(spd, 'kt', 'km/h') / 5) * 5;
        const windBarbSvg = data.dir === 'N/A' || isNaN(speedKt) ? 'N/A' : Utils.generateWindBarb(data.dir, speedKt, null, barbColor);

        // Die Klasse wird nur noch auf die <td> angewendet, `formattedWind` enthält potenziell das Span-Element
        return `<tr class="${windClass} ${cloudCoverClass}">
                    <td>${Math.round(displayHeight)}</td>
                    <td>${Utils.roundToTens(data.dir)}</td>
                    <td class="${groundWindExceedsThreshold ? 'wind-speed-exceeds-threshold' : ''}">${formattedWind}</td>
                    <td>${windBarbSvg}</td>
                    <td>${formattedTemp}</td>
                    <td>${Math.round(data.rh)}</td>
                    <td>${data.cc}</td>
                </tr>`;
    }).join('');

    // NEU: Die gesamte Tabelle in einer einzigen, lesbaren Vorlage erstellen
    const output = `
        <table id="weatherTable">
            <thead>
                <tr>
                    <th>${I18n.t('weather.altitude')} (${heightUnit} ${refLevel})</th>
                    <th>${I18n.t('weather.table.direction')}</th>
                    <th>${I18n.t('weather.wind_speed')} (${windSpeedUnit})</th>
                    <th>${I18n.t('weather.wind')}</th>
                    <th>${I18n.t('weather.temp').charAt(0)} (${temperatureUnit === 'C' ? '°C' : '°F'})</th>
                    <th>${I18n.t('weather.humidity')} (%)</th>
                    <th>${I18n.t('weather.clouds')} (%)</th>
                </tr>
            </thead>
            <tbody>
                ${tableRowsHtml}
            </tbody>
        </table>`;

    tableContainer.innerHTML = output; // <-- Nutzt den Parameter
    timeContainer.innerHTML = `${I18n.t('common.selected_time')} ${time}`;
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
export async function refreshMarkerPopup(expanded = false, open = false) {
    if (!AppState.currentMarker || AppState.lastLat === null) {
        return;
    }

    const lat = AppState.lastLat;
    const lng = AppState.lastLng;
    const altitude = AppState.lastAltitude;
    const heightUnit = Settings.getValue('heightUnit', 'radio', 'm');
    let displayAltitude = 'N/A';
    let displayUnit = heightUnit;
    let qfeText = 'N/A';

    if (altitude !== 'N/A') {
        displayAltitude = Math.round(Utils.convertHeight(altitude, heightUnit));
    }

    if (altitude !== 'N/A' && AppState.weatherData && AppState.weatherData.surface_pressure) {
        const sliderIndex = getSliderValue();
        const surfacePressure = AppState.weatherData.surface_pressure[sliderIndex];
        const temperature = AppState.weatherData.temperature_2m?.[sliderIndex] || 15;
        const qfe = Utils.calculateQFE(surfacePressure, altitude, altitude, temperature);
        if (qfe !== 'N/A') {
            qfeText = `${qfe} hPa`;
        }
    }

    // Lokalisierung von "Alt"
    const altitudeContent = `<br>${I18n.t('map.marker_popup.alt')}: ${displayAltitude} ${displayUnit}<br>QFE: ${qfeText}`;
    let popupContent = '';

    if (expanded) {
        const dms = Utils.decimalToDms(lat, true);
        const ddm = Utils.decimalToDecimalMinutes(lat, true);
        const dmsLng = Utils.decimalToDms(lng, false);
        const ddmLng = Utils.decimalToDecimalMinutes(lng, false);

        const declination = Utils.getMagneticDeclination(lat, lng);
        const declSign = declination >= 0 ? 'E' : 'W';
        const declText = `${Math.abs(declination).toFixed(1)}° ${declSign}`;

        popupContent = `
            <div style="font-size: 11px; line-height: 1.4;">
                Decimal: ${lat.toFixed(5)}, ${lng.toFixed(5)}<br>
                DDM: ${ddm.deg}° ${ddm.min.toFixed(3)}' ${ddm.dir}, ${ddmLng.deg}° ${ddmLng.min.toFixed(3)}' ${ddmLng.dir}<br>
                DMS: ${dms.deg}°${dms.min}'${dms.sec.toFixed(0)}" ${dms.dir}, ${dmsLng.deg}°${dmsLng.min}'${dmsLng.sec.toFixed(0)}" ${dmsLng.dir}<br>
                MGRS: ${Utils.decimalToMgrs(lat, lng)}<br>
                ${I18n.t('map.magnetic_declination')}: ${declText}
            </div>
            ${altitudeContent}<br>
            <a href="#" class="toggle-coords-format" data-marker-type="dip" data-expanded="true" style="font-size: 11px;">${I18n.t('map.show_less')}</a>
        `;
    } else {
        const coordFormat = Settings.getValue('coordFormat', 'radio', 'Decimal');
        const coords = Utils.convertCoords(lat, lng, coordFormat);
        const formatDDM = (ddm) => `${ddm.deg}° ${ddm.min.toFixed(3)}' ${ddm.dir}`;
        const formatDMS = (dms) => `${dms.deg}°${dms.min}'${dms.sec.toFixed(0)}" ${dms.dir}`;
        let coordDisplay = '';

        // Lokalisierung von "Lat" und "Lng"
        if (coordFormat === 'MGRS') {
            coordDisplay = `MGRS: ${coords.lat}`;
        } else if (coordFormat === 'DMS') {
            coordDisplay = `${I18n.t('map.lat')}: ${formatDMS(coords.lat)}<br>${I18n.t('map.lng')}: ${formatDMS(coords.lng)}`;
        } else if (coordFormat === 'DDM') {
            coordDisplay = `${I18n.t('map.lat')}: ${formatDDM(coords.lat)}<br>${I18n.t('map.lng')}: ${formatDDM(coords.lng)}`;
        } else {
            coordDisplay = `${I18n.t('map.lat')}: ${coords.lat}<br>${I18n.t('map.lng')}: ${coords.lng}`;
        }

        popupContent = `
            ${coordDisplay}
            ${altitudeContent}<br>
            <a href="#" class="toggle-coords-format" data-marker-type="dip" data-expanded="false" style="font-size: 11px;">${I18n.t('map.show_more')}</a>
        `;
    }

    mapManager.updatePopupContent(AppState.currentMarker, popupContent, open);
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

    // LOKALISIERUNG: Nutzt 'common.forecast_model' und 'weather.model_run'
    const titleContent = `${I18n.t('common.forecast_model')}: ${model.replace(/_/g, ' ').toUpperCase()}\\n${I18n.t('weather.model_run')} ${modelRun}`;

    // Ersetzt Zeilenumbrüche durch <br> für die HTML-Anzeige (unverändert)
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
    if (
        timeZoneSetting === 'loc' &&
        Number.isFinite(AppState.lastLat) &&
        Number.isFinite(AppState.lastLng)
    ) {
        const locData = await Utils.getLocationData(AppState.lastLat, AppState.lastLng);
        locationTimezone = locData.timezone || 'utc';
    }

    let lastDay = null;
    // Referenz für Heute/Morgen-Check
    const now = DateTime.now().setZone(locationTimezone).startOf('day');

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

                // Nutzt Luxon-Lokalisierung für ein einheitliches Datumsformat (z.B. "Okt 24" / "Oct 24")
                // I18n.getCurrentLanguage() stellt sicher, dass die Sprache aus deinem i18n-Modul verwendet wird.
                label.textContent = dt.setLocale(I18n.getCurrentLanguage() || 'en').toFormat('MMM dd');

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

/**
 * Aktualisiert den Hintergrund des Zeitschiebereglers, um Stunden mit Warnungen hervorzuheben.
 * @param {number[]} alertIndices - Ein Array der Stunden-Indizes mit Warnungen.
 */
export function updateAlertSliderBackground(alertIndices) {
    const highlightTrack = document.getElementById('slider-track-highlight');
    const slider = document.getElementById('timeSlider');
    if (!highlightTrack || !slider) return;

    const totalHours = parseInt(slider.max) + 1;
    if (totalHours <= 0 || alertIndices.length === 0) {
        highlightTrack.style.background = 'var(--background-interactive)';
        return;
    }

    const stops = [];
    const alertColor = 'var(--color-danger)';
    const defaultColor = 'var(--background-interactive)';

    for (let i = 0; i < totalHours; i++) {
        const color = alertIndices.includes(i) ? alertColor : defaultColor;
        const startPercent = (i / totalHours) * 100;
        const endPercent = ((i + 1) / totalHours) * 100;
        stops.push(`${color} ${startPercent}%`);
        stops.push(`${color} ${endPercent}%`);
    }

    highlightTrack.style.background = `linear-gradient(to right, ${stops.join(', ')})`;
}

/**
 * Überprüft unabhängig von der visuellen Darstellung (Kreise an/aus),
 * ob der Wind in der Safety Height kritisch ist.
 * Zeigt eine Warnung in der Snackbar an, falls das Halten unmöglich ist.
 */
export function checkSafetyHeightWindWarning() {
    // 1. Grundprüfung: Haben wir Wetterdaten und ist die Sprungberechnung aktiv? (unverändert)
    if (!AppState.weatherData || !Settings.state.userSettings.calculateJump) return;

    // Safety Height direkt prüfen. Wenn 0, brauchen wir nicht warnen. (unverändert)
    const safetyHeight = Settings.state.userSettings.safetyHeight || 0;
    const downwindStart = Settings.state.userSettings.legHeightDownwind || 0;
    const safetyHeightAGL = safetyHeight + downwindStart;
    if (safetyHeight <= 0) return;

    // 2. Daten interpolieren (unverändert)
    const sliderIndex = getSliderValue();
    const interpStep = getInterpolationStep();
    const heightUnit = Settings.getValue('heightUnit', 'radio', 'm');

    const interpolatedData = weatherManager.interpolateWeatherData(
        AppState.weatherData,
        sliderIndex,
        interpStep,
        Math.round(AppState.lastAltitude),
        heightUnit
    );

    // 3. Berechnung durchführen (unverändert)
    const calcResult = JumpPlanner.calculateExitCircle(interpolatedData);

    // Prüfen auf Error-Objekt aus dem Hierarchy-Check (unverändert)
    if (calcResult && calcResult.error) {
        displayWarning(calcResult.error);
        return;
    }

    // 4. Warnung ausgeben (LOKALISIERT)
    if (calcResult && calcResult.safetyWindWarning) {
        // Nutzt den Key 'weather.safety_warning_msg' mit Platzhaltern
        const safetyMsg = I18n.t('weather.safety_warning_msg')
            .replace('{height}', safetyHeightAGL)
            .replace('{unit}', heightUnit)
            .replace('{limit}', downwindStart)
            .replace('{current}', '...'); // Hier wird im Original nur auf die Grenzwerte hingewiesen

        displayWarning(safetyMsg);
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
    const heightUnit = Settings.getValue('heightUnit', 'radio', 'm');
    const windUnit = Settings.getValue('windUnit', 'radio', 'kt');
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

    // ================== Logik für Windpfeile (Berechnung unverändert) ==================
    const heights = interpolatedData.map(d => d.height);
    const uComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'kt', 'km/h') * Math.sin(d.dir * Math.PI / 180));
    const vComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'kt', 'km/h') * Math.cos(d.dir * Math.PI / 180));

    // 1. Rohwerte aus dem DOM lesen (Web-spezifisch via getElementById)
    const legFinalRaw = parseInt(document.getElementById('legHeightFinal').value) || 100;
    const legBaseRaw = parseInt(document.getElementById('legHeightBase').value) || 200;
    const legDownRaw = parseInt(document.getElementById('legHeightDownwind').value) || 300;

    // 2. Einheit prüfen und Werte in Meter konvertieren (unverändert)
    let legFinalM, legBaseM, legDownM;

    if (heightUnit === 'ft') {
        legFinalM = Utils.convertFeetToMeters(legFinalRaw);
        legBaseM = Utils.convertFeetToMeters(legBaseRaw);
        legDownM = Utils.convertFeetToMeters(legDownRaw);
    } else {
        legFinalM = legFinalRaw;
        legBaseM = legBaseRaw;
        legDownM = legDownRaw;
    }

    // 3. Mittelwind für jeden Leg berechnen (unverändert)
    const finalMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, baseHeight, baseHeight + legFinalM);
    const baseMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, baseHeight + legFinalM, baseHeight + legBaseM);
    const downwindMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, baseHeight + legBaseM, baseHeight + legDownM);

    const getArrowColor = (windSpeedKt) => {
        if (windSpeedKt <= 3) return 'lightblue';
        if (windSpeedKt <= 10) return 'lightgreen';
        if (windSpeedKt <= 16) return '#f5f34f';
        return '#ffcccc';
    };

    const formatWindSpeed = (speedKt) => {
        const convertedSpeed = Utils.convertWind(speedKt, windUnit, 'kt');
        return windUnit === 'bft' ? Math.round(convertedSpeed) : convertedSpeed.toFixed(1);
    };

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

    mapManager.drawLandingPattern(patternData);
}

/**
 * Steuert die Anzeige des Jump Run Tracks auf der Karte.
 * Holt die berechneten Track-Daten vom jumpPlanner und übergibt sie
 * an den mapManager zum Zeichnen der Anfluglinie und des Flugzeug-Markers.
 * @returns {void}
 */
// Modul-Variable für die letzten JRT-Zeichendaten (für Pin Jump)
let lastTrackDrawData = null;

export function getLastTrackDrawData() {
    return lastTrackDrawData;
}

export function updateJumpRunTrackDisplay() {
    console.log('updateJumpRunTrackDisplay called');
    if (!AppState.map) {
        console.warn('Map not initialized, cannot update jump run track display');
        return;
    }

    // Wenn ein Pin aktiv ist, nicht die Live-Berechnung zeichnen
    if (AppState.activePinId !== null) {
        console.log('Active pin present, skipping live JRT display.');
        return;
    }

    // Prüfe alle Bedingungen, ob der Track angezeigt werden soll. (unverändert)
    const shouldShow =
        Settings.state.userSettings.showJumpRunTrack &&
        AppState.weatherData &&
        AppState.lastLat &&
        AppState.lastLng &&
        Settings.state.userSettings.calculateJump;

    if (!shouldShow) {
        console.log('Conditions not met to show JRT, clearing display.');
        mapManager.drawJumpRunTrack(null);
        AppState.lastTrackData = null;

        const directionInput = document.getElementById('jumpRunTrackDirection');
        if (directionInput && !Settings.state.userSettings.customJumpRunDirection) {
            directionInput.value = '';
        }

        return;
    }

    // Daten interpolieren (unverändert)
    const sliderIndex = getSliderValue();
    const interpStep = getInterpolationStep();
    const heightUnit = Settings.getValue('heightUnit', 'radio', 'm');
    const interpolatedData = weatherManager.interpolateWeatherData(
        AppState.weatherData,
        sliderIndex,
        interpStep,
        Math.round(AppState.lastAltitude),
        heightUnit
    );
    const harpAnchor = AppState.harpMarker ? AppState.harpMarker.getLatLng() : null;
    const trackData = JumpPlanner.jumpRunTrack(interpolatedData, harpAnchor);

    const directionInput = document.getElementById('jumpRunTrackDirection');

    if (trackData && trackData.latlngs?.length === 2 && trackData.latlngs.every(ll => Number.isFinite(ll[0]) && Number.isFinite(ll[1]))) {
        console.log('Drawing jump run track with data:', trackData);

        if (directionInput && !Settings.state.userSettings.customJumpRunDirection) {
            directionInput.value = Math.round(Utils.applyNorthReference(trackData.direction, AppState.lastLat, AppState.lastLng));
        }

        // --- LOKALISIERUNG DER TOOLTIPS ---
        // Nutzt Platzhalter für Richtung und Distanz
        const displayDir = Utils.formatDirectionOutput(trackData.direction, AppState.lastLat, AppState.lastLng, false);
        const jumpRunTooltip = I18n.t('planner.jump_run_tooltip')
            .replace('{dir}', displayDir)
            .replace('{dist}', trackData.trackLength);

        const approachTooltip = I18n.t('planner.approach_tooltip')
            .replace('{dir}', displayDir)
            .replace('{dist}', trackData.approachLength);

        const drawData = {
            path: {
                latlngs: trackData.latlngs,
                options: { color: 'orange', weight: 5, opacity: 0.8 },
                tooltipText: jumpRunTooltip, // Ersetzt statisches `Jump Run: ${trackData.direction}°, ${trackData.trackLength} m`
                originalLatLngs: AppState.lastTrackData?.latlngs?.length === 2 ? AppState.lastTrackData.latlngs : trackData.latlngs
            },
            approachPath: trackData.approachLatLngs?.length === 2 && trackData.approachLatLngs.every(ll => Number.isFinite(ll[0]) && Number.isFinite(ll[1])) ? {
                latlngs: trackData.approachLatLngs,
                options: { color: 'orange', weight: 5, opacity: 0.8, dashArray: '5, 10' },
                tooltipText: approachTooltip, // Ersetzt statisches `Approach: ${trackData.direction}°, ${trackData.approachLength} m`
                originalLatLngs: AppState.lastTrackData?.approachLatLngs?.length === 2 ? AppState.lastTrackData.approachLatLngs : trackData.approachLatLngs
            } : null,
            trackLength: trackData.trackLength,
            airplane: {
                position: L.latLng(trackData.latlngs[1][0], trackData.latlngs[1][1]),
                bearing: trackData.direction,
                originalPosition: AppState.lastTrackData?.latlngs?.[1] && Number.isFinite(AppState.lastTrackData.latlngs[1][0]) ?
                    L.latLng(AppState.lastTrackData.latlngs[1][0], AppState.lastTrackData.latlngs[1][1]) :
                    L.latLng(trackData.latlngs[1][0], trackData.latlngs[1][1]),
            }
        };
        lastTrackDrawData = drawData;
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
        mapManager.drawJumpRunTrack(null);
        AppState.lastTrackData = null;
        if (directionInput && !Settings.state.userSettings.customJumpRunDirection) {
            directionInput.value = '';
        }
    }
}