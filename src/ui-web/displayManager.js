import { AppState } from '../core/state.js';
import { Settings, getInterpolationStep } from '../core/settings.js';
import { Utils } from '../core/utils.js';
import { getSliderValue } from '../ui-mobile/ui.js';
import * as mapManager from './mapManager.js';
import * as weatherManager from '../core/weatherManager.js';
import { UI_DEFAULTS } from '../core/constants.js'; // UI_DEFAULTS für LANDING_PATTERN_MIN_ZOOM
import * as JumpPlanner from '../core/jumpPlanner.js';


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
    } else {
        popupContent += ` QFE: N/A`;
    }

    mapManager.updatePopupContent(AppState.currentMarker, popupContent);
}

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
    const timeZone = Settings.getValue('timeZone', 'radio', 'Z');
    const time = await Utils.getDisplayTime(AppState.weatherData.time[index], AppState.lastLat, AppState.lastLng, timeZone);
    const interpStep = getInterpolationStep(); // Wert in der UI-Schicht holen
    const interpolatedData = weatherManager.interpolateWeatherData(
        AppState.weatherData, // Das Haupt-Wetterdatenobjekt
        index,
        interpStep,
        Math.round(AppState.lastAltitude),
        heightUnit
    ); // Und an die Core-Funktion übergeben
    const surfaceHeight = refLevel === 'AMSL' && AppState.lastAltitude !== 'N/A' ? Math.round(AppState.lastAltitude) : 0;

    if (!Settings.state.userSettings.showTable) {
        tableContainer.innerHTML = ''; // Leert den Tabellen-Container
        timeContainer.innerHTML = `Selected Time: ${time}`; // Setzt die Zeit
        return;
    }

    // NEU: Zuerst alle Zeilen als HTML-Strings generieren
    const tableRowsHtml = interpolatedData.map(data => {
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
        const humidity = data.rh;
        let humidityClass = '';
        if (humidity !== 'N/A' && Number.isFinite(humidity)) {
            if (humidity < 65) humidityClass = 'humidity-low';
            else if (humidity >= 65 && humidity <= 85) humidityClass = 'humidity-moderate';
            else if (humidity > 85 && humidity < 100) humidityClass = 'humidity-high';
            else if (humidity === 100) humidityClass = 'humidity-saturated';
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

        // Gibt den fertigen HTML-String für eine Zeile zurück
        return `<tr class="${windClass} ${humidityClass}">
                    <td>${Math.round(displayHeight)}</td>
                    <td>${Utils.roundToTens(data.dir)}</td>
                    <td>${formattedWind}</td>
                    <td>${windBarbSvg}</td>
                    <td>${formattedTemp}</td>
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
                </tr>
            </thead>
            <tbody>
                ${tableRowsHtml}
            </tbody>
        </table>`;

    tableContainer.innerHTML = output; // <-- Nutzt den Parameter
    timeContainer.innerHTML = `Selected Time: ${time}`; // <-- Nutzt den Parameter
}

/**
 * Zeichnet oder entfernt das Landemuster auf der Karte.
 * Prüft den aktuellen Zoom-Level und ob das Feature aktiviert ist.
 * Holt die berechneten Koordinaten vom jumpPlanner und weist den mapManager an,
 * die Linien und Pfeile für das Muster zu zeichnen.
 * @returns {void}
 */
export function updateLandingPatternDisplay() {

    // 1. Prüft, ob der Marker existiert UND ob es ein valides Objekt mit der getLatLng-Methode ist.
    if (!AppState.currentMarker || typeof AppState.currentMarker.getLatLng !== 'function') {
        console.warn("Landing pattern update skipped: AppState.currentMarker is not a valid marker object yet.", AppState.currentMarker);
        return;
    }

    const markerLatLng = AppState.currentMarker.getLatLng();

    // 2. Zusätzliche Sicherheitsprüfung für den Fall, dass getLatLng() aus irgendeinem Grund undefined zurückgibt.
    if (!markerLatLng) {
        console.error("Could not get LatLng from the current marker. Aborting landing pattern update.", AppState.currentMarker);
        return;
    }

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
    if (currentZoom < UI_DEFAULTS.LANDING_PATTERN_MIN_ZOOM) {
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
    const lat = markerLatLng.lat;
    const lng = markerLatLng.lng;
    const baseHeight = Math.round(AppState.lastAltitude);
    const interpStep = getInterpolationStep(); // Wert in der UI-Schicht holen
    const heightUnit = Settings.getValue('heightUnit', 'radio', 'm'); // Höheinheit aus den Einstellungen
    const interpolatedData = weatherManager.interpolateWeatherData(
        AppState.weatherData, // Das Haupt-Wetterdatenobjekt
        sliderIndex,
        interpStep,
        Math.round(AppState.lastAltitude),
        heightUnit
    ); // Und an die Core-Funktion übergeben
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
                options: { color: 'orange', weight: 5, opacity: 0.8, dashArray: '5, 10' },
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