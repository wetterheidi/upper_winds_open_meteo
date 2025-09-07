import { AppState } from '../core/state.js';
import { Settings, getInterpolationStep } from '../core/settings.js';
import { Utils } from '../core/utils.js';
import { getSliderValue } from './ui.js';
import * as mapManager from './mapManager.js';
import * as weatherManager from '../core/weatherManager.js';
import { UI_DEFAULTS } from '../core/constants.js'; // UI_DEFAULTS für LANDING_PATTERN_MIN_ZOOM
import * as JumpPlanner from '../core/jumpPlanner.js';
import { getCoordinateFormat, getHeightUnit, getTemperatureUnit, getWindSpeedUnit } from './main-mobile.js';


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
    const heightUnit = getHeightUnit();
    const coordFormat = getCoordinateFormat();

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

    const refLevel = Settings.getValue('refLevel', 'AGL');
    const heightUnit = getHeightUnit();
    const windSpeedUnit = getWindSpeedUnit();
    const temperatureUnit = getTemperatureUnit();
    // Pass lat and lng to getDisplayTime
    const timeZone = Settings.getValue('timeZone', 'Z');
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

        // Gibt den fertigen HTML-String für eine Zeile zurück
        return `<tr class="${windClass} ${cloudCoverClass}">
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

    if (!shouldShow) {
        console.log('Conditions not met to show JRT, clearing display.');
        mapManager.drawJumpRunTrack(null); // Sagt dem mapManager, alles zu löschen.
        AppState.lastTrackData = null; // Setzt die gespeicherten Track-Daten zurück.
        
        const directionInput = document.getElementById('jumpRunTrackDirection');
        if (directionInput && !Settings.state.userSettings.customJumpRunDirection) {
            directionInput.value = '';
        }
        return;
    }

    const sliderIndex = getSliderValue();
    const interpStep = getInterpolationStep();
    const heightUnit = getHeightUnit();
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
            trackLength: trackData.trackLength,
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
        mapManager.drawJumpRunTrack(null);
        AppState.lastTrackData = null;
        if (directionInput && !Settings.state.userSettings.customJumpRunDirection) {
            directionInput.value = '';
        }
    }
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

    const titleContent = `Model: ${model.replace(/_/g, ' ').toUpperCase()}\nRun: ${modelRun}`;

    // Ersetzt Zeilenumbrüche durch <br> für die HTML-Anzeige
    modelInfoPopup.innerHTML = titleContent.replace(/\n/g, '<br>');
}