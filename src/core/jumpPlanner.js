/**
 * @file jumpPlanner.js
 * @description Enthält die Kernlogik für alle Fallschirmsprung-bezogenen Berechnungen,
 * inklusive Freifall, Schirmfahrt, Landemuster und Absetzanflug (Jump Run).
 */

import { AppState } from './state.js';
import { Settings } from './settings.js';
import { Utils } from './utils.js';
import * as weatherManager from './weatherManager.js';
import { JUMP_RUN_DEFAULTS, CUTAWAY_VISUALIZATION_RADIUS_METERS, JUMPER_SEPARATION_TABLE, CONVERSIONS, FREEFALL_PHYSICS, ISA_CONSTANTS, CANOPY_OPENING_BUFFER_METERS, CUTAWAY_VERTICAL_SPEEDS_MPS } from './constants.js';
import { I18n } from './i18n.js'; // Import ergänzt

// ===================================================================
// 1. Haupt-Berechnungsfunktionen (Public API des Moduls)
// ===================================================================


/**
 * Ermittelt die empfohlene zeitliche Separation zwischen Springern basierend auf der
 * wahren Fluggeschwindigkeit (TAS) des Absetzflugzeugs.
 * Nutzt eine vordefinierte Tabelle (jumperSeparationTable), um die Separation zu bestimmen.
 * @param {number} ias - Die angezeigte Fluggeschwindigkeit (IAS) in Knoten.
 * @returns {number} Die empfohlene Separation in Sekunden.
 */
export function getSeparationFromTAS(ias) {
    const exitAltitudeFt = Settings.state.userSettings.exitAltitude * CONVERSIONS.METERS_TO_FEET;
    const tas = Utils.calculateTAS(ias, exitAltitudeFt);
    if (tas === 'N/A' || !Number.isFinite(tas) || tas <= 0) {
        console.warn('TAS calculation failed or invalid, using default separation');
        return Settings.defaultSettings.jumperSeparation;
    }
    const speeds = Object.keys(JUMPER_SEPARATION_TABLE).map(Number).sort((a, b) => b - a);
    let closestSpeed = speeds[0];
    for (const speed of speeds) {
        if (tas <= speed) closestSpeed = speed;
        else break;
    }
    const separation = JUMPER_SEPARATION_TABLE[closestSpeed] || 7;
    return separation;
}

/**
 * Berechnet die Richtung und Länge des Absetzanflugs (Jump Run Track).
 * Die Richtung wird standardmäßig gegen den mittleren Wind in der Öffnungshöhe berechnet,
 * kann aber durch eine manuelle Eingabe überschrieben werden.
 * Die Länge ergibt sich aus der Anzahl der Springer und deren Separation bei der errechneten Groundspeed.
 * @param {object[]} interpolatedData - Die interpolierten Wetterdaten.
 * @returns {{direction: number, trackLength: number, latlngs: number[][], approachLatLngs: number[][], approachLength: number, approachTime: number}|null} Ein Objekt mit den Daten des Anflugs oder null.
 */
export function jumpRunTrack(interpolatedData, harpAnchor = null) {
    const anchorLat = harpAnchor ? harpAnchor.lat : AppState.lastLat;
    const anchorLng = harpAnchor ? harpAnchor.lng : AppState.lastLng;

    if (!AppState.weatherData || anchorLat == null || anchorLng == null || AppState.lastAltitude === 'N/A' || !interpolatedData || !interpolatedData.length) {
        return null;
    }

    const heightUnit = Settings.getValue('heightUnit', 'm');

    // 2. Rohwerte aus Input lesen
    let exitAltRaw = parseInt(document.getElementById('exitAltitude')?.value) || 3000;
    let openAltRaw = parseInt(document.getElementById('openingAltitude')?.value) || 1200;

    // 3. Werte normalisieren (ALLES in Meter umrechnen für die Physik)
    let exitAltitude, openingAltitude;

    if (heightUnit === 'ft') {
        exitAltitude = Utils.convertFeetToMeters(exitAltRaw);
        openingAltitude = Utils.convertFeetToMeters(openAltRaw);
    } else {
        exitAltitude = exitAltRaw;
        openingAltitude = openAltRaw;
    }

    const elevation = Math.round(AppState.lastAltitude);

    const heights = interpolatedData.map(d => d.height);
    const uComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'm/s', 'km/h') * Math.sin(d.dir * Math.PI / 180));
    const vComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'm/s', 'km/h') * Math.cos(d.dir * Math.PI / 180));
    const meanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, elevation, elevation + openingAltitude);
    if (!meanWind) return null;

    const meanWindDirection = meanWind[0]; // Die berechnete mittlere Windrichtung

    let jumpRunTrackDirection;
    const customDirectionInput = Settings.state.userSettings.customJumpRunDirection; // Den String oder die Zahl aus den Settings holen

    if (typeof customDirectionInput === 'string') {
        const inputUpper = customDirectionInput.toUpperCase().trim();
        if (inputUpper === 'IN') {
            jumpRunTrackDirection = (meanWindDirection + 180 + 360) % 360; // Mit dem Wind
        } else if (inputUpper === 'CR+') {
            jumpRunTrackDirection = (meanWindDirection + 90 + 360) % 360; // Querwind +90°
        } else if (inputUpper === 'CR-') {
            jumpRunTrackDirection = (meanWindDirection - 90 + 360) % 360; // Querwind -90°
        } else {
            // Versuche, den String als Zahl zu parsen
            const parsedNumber = parseFloat(customDirectionInput);
            if (Number.isFinite(parsedNumber) && parsedNumber >= 0 && parsedNumber <= 360) {
                jumpRunTrackDirection = parsedNumber; // Gültige Zahl eingegeben
            } else {
                // Ungültiger String ODER ungültige Zahl -> Standard verwenden
                jumpRunTrackDirection = Math.round(meanWindDirection); // Standard: Gegen den Wind
                // Optional: Fehlermeldung oder Hinweis an den Nutzer
                console.warn(`Ungültige Eingabe '${customDirectionInput}' für Jump Run Richtung. Verwende Standardwert (gegen den Wind).`);
            }
        }
    } else if (Number.isFinite(customDirectionInput) && customDirectionInput >= 0 && customDirectionInput <= 360) {
        // Direkte Zahleneingabe (wie bisher)
        jumpRunTrackDirection = customDirectionInput;
    } else {
        // Kein oder ungültiger Input -> Standard verwenden
        jumpRunTrackDirection = Math.round(meanWindDirection); // Standard: Gegen den Wind
    }

    jumpRunTrackDirection = Math.round(jumpRunTrackDirection); // Sicherstellen, dass es eine ganze Zahl ist


    const exitHeightM = elevation + exitAltitude;
    const aircraftSpeedKt = Settings.state.userSettings.aircraftSpeedKt || 90;
    const tasKt = Utils.calculateTAS(aircraftSpeedKt, exitHeightM / 0.3048);

    let groundSpeedMps = aircraftSpeedKt * CONVERSIONS.KNOTS_TO_MPS;

    if (tasKt !== 'N/A' && Number.isFinite(tasKt)) {
        const windDirAtExit = Utils.linearInterpolate(heights.map(h => h - elevation), interpolatedData.map(d => d.dir), exitAltitude);
        const windSpeedMpsAtExit = Utils.linearInterpolate(heights.map(h => h - elevation), interpolatedData.map(d => Utils.convertWind(d.spd, 'm/s', 'km/h')), exitAltitude);
        const tasMps = tasKt * CONVERSIONS.KNOTS_TO_MPS;
        const windToRad = (windDirAtExit + 180) * Math.PI / 180;
        const windU = windSpeedMpsAtExit * Math.sin(windToRad);
        const windV = windSpeedMpsAtExit * Math.cos(windToRad);
        const headingRad = jumpRunTrackDirection * Math.PI / 180;
        const tasU = tasMps * Math.sin(headingRad);
        const tasV = tasMps * Math.cos(headingRad);
        groundSpeedMps = Math.sqrt(Math.pow(tasU + windU, 2) + Math.pow(tasV + windV, 2));
    }

    const trackLength = Math.max(JUMP_RUN_DEFAULTS.MIN_TRACK_LENGTH_M, Math.min(JUMP_RUN_DEFAULTS.MAX_TRACK_LENGTH_M, Math.round((Settings.state.userSettings.numberOfJumpers || 10) * (Settings.state.userSettings.jumperSeparation || 5) * groundSpeedMps)));
    const approachLength = Math.max(JUMP_RUN_DEFAULTS.MIN_APPROACH_LENGTH_M, Math.min(JUMP_RUN_DEFAULTS.MAX_APPROACH_LENGTH_M, Math.round(groundSpeedMps * JUMP_RUN_DEFAULTS.APPROACH_TIME_SECONDS)));

    let lateralOffsetRaw = parseInt(document.getElementById('jumpRunTrackOffset')?.value) || 0;
    let forwardOffsetRaw = parseInt(document.getElementById('jumpRunTrackForwardOffset')?.value) || 0;

    let lateralOffset, forwardOffset;

    if (heightUnit === 'ft') {
        lateralOffset = Utils.convertFeetToMeters(lateralOffsetRaw);
        forwardOffset = Utils.convertFeetToMeters(forwardOffsetRaw);
    } else {
        lateralOffset = lateralOffsetRaw;
        forwardOffset = forwardOffsetRaw;
    }

    const initialStartPoint = [anchorLat, anchorLng];
    const initialEndPoint = Utils.calculateNewCenter(initialStartPoint[0], initialStartPoint[1], trackLength, jumpRunTrackDirection);

    const shiftDistance = Math.sqrt(lateralOffset ** 2 + forwardOffset ** 2);
    const shiftAngleFromTrack = Math.atan2(lateralOffset, forwardOffset) * 180 / Math.PI;
    const absoluteShiftBearing = (jumpRunTrackDirection + shiftAngleFromTrack + 360) % 360;

    const startPoint = Utils.calculateNewCenter(initialStartPoint[0], initialStartPoint[1], shiftDistance, absoluteShiftBearing);
    const endPoint = Utils.calculateNewCenter(initialEndPoint[0], initialEndPoint[1], shiftDistance, absoluteShiftBearing);

    // Dieser Block wird jetzt immer ausgeführt, da groundSpeedMps immer einen Wert hat.
    const approachStartPoint = Utils.calculateNewCenter(startPoint[0], startPoint[1], approachLength, (jumpRunTrackDirection + 180) % 360);
    const approachLatLngs = [startPoint, approachStartPoint];

    return {
        direction: jumpRunTrackDirection, trackLength, meanWindDirection: meanWind[0], meanWindSpeed: meanWind[1],
        latlngs: [startPoint, endPoint], approachLatLngs, approachLength, approachTime: JUMP_RUN_DEFAULTS.APPROACH_TIME_SECONDS
    };
}

/**
 * Berechnet die Position und den Radius der möglichen Exit-Bereiche (grüne Kreise).
 * Diese Kreise repräsentieren den Bereich, in dem sich der Springer nach dem Freifall befindet,
 * relativ zum geplanten Landepunkt.
 * @param {object[]} interpolatedData - Die interpolierten Wetterdaten.
 * @returns {{greenLatFull: number, greenLngFull: number, greenLat: number, greenLng: number, greenRadius: number, darkGreenRadius: number, freeFallDirection: number, freeFallDistance: number, freeFallTime: number}|null} Ein Objekt mit den Koordinaten und Radien für die Visualisierung oder null.
 */
export function calculateExitCircle(interpolatedData) {
    console.log('Debug calculateExitCircle: Start', {
        showExitArea: Settings.state.userSettings.showExitArea,
        calculateJump: Settings.state.userSettings.calculateJump,
        weatherData: !!AppState.weatherData,
        lastLat: AppState.lastLat,
        lastLng: AppState.lastLng,
        lastAltitude: AppState.lastAltitude,
        interpolatedData: !!interpolatedData && interpolatedData.length > 0
    });

    if (!Settings.state.userSettings.calculateJump || !AppState.weatherData || AppState.lastLat == null || AppState.lastLng == null || AppState.lastAltitude === 'N/A') {
        console.log('Debug calculateExitCircle: Frühe Rückgabe wegen Einstellungen');
        return null;
    }
    if (!interpolatedData || interpolatedData.length === 0) {
        console.log('Debug calculateExitCircle: Frühe Rückgabe wegen interpolatedData');
        return null;
    }

    const heightUnit = Settings.getValue('heightUnit', 'm');

    // 2. Rohwerte aus Input lesen
    let exitAltRaw = parseInt(document.getElementById('exitAltitude')?.value) || 3000;
    let openAltRaw = parseInt(document.getElementById('openingAltitude')?.value) || 1200;
    let safetyRaw = parseInt(document.getElementById('safetyHeight')?.value) || 0;
    let legDownRaw = parseInt(document.getElementById('legHeightDownwind')?.value) || 300;

    // 3. Werte normalisieren (ALLES in Meter umrechnen für die Physik)
    let exitAltitude, openingAltitude, safetyHeight, legHeightDownwind;

    if (heightUnit === 'ft') {
        exitAltitude = Utils.convertFeetToMeters(exitAltRaw);
        openingAltitude = Utils.convertFeetToMeters(openAltRaw);
        safetyHeight = Utils.convertFeetToMeters(safetyRaw);
        legHeightDownwind = Utils.convertFeetToMeters(legDownRaw);
    } else {
        exitAltitude = exitAltRaw;
        openingAltitude = openAltRaw;
        safetyHeight = safetyRaw;
        legHeightDownwind = legDownRaw;
    }

    // =================================================================================
    // HIERARCHIE-CHECK (Der "Airbag" gegen Abstürze)
    // Wir erzwingen: Exit > Opening > (Safety + Downwind + Buffer)
    // =================================================================================

    // Die absolute Untergrenze für die Öffnung: Downwind-Höhe + Safety Height + Puffer
    const minOpeningAltitude = legHeightDownwind + safetyHeight + CANOPY_OPENING_BUFFER_METERS;

    // Check 1: Zu wenig Platz für Schirmfahrt
    if (openingAltitude <= minOpeningAltitude) {
        const msg = I18n.t('planner.error_opening_too_low', {
            opening: Math.round(openingAltitude),
            min: Math.round(minOpeningAltitude)
        });
        console.warn(msg);
        return { error: msg }; // <--- HIER: Error Objekt statt null
    }

    // Check 2: Exit unter Öffnung
    if (exitAltitude <= openingAltitude) {
        const msg = I18n.t('planner.error_exit_below_opening', {
            exit: Math.round(exitAltitude),
            opening: Math.round(openingAltitude)
        });
        console.warn(msg);
        return { error: msg }; // <--- HIER: Error Objekt statt null
    }

    // =================================================================================

    const descentRate = parseFloat(document.getElementById('descentRate')?.value) || 3.5;
    const canopySpeedKt = parseFloat(document.getElementById('canopySpeed')?.value) || 20;
    const canopySpeedMps = canopySpeedKt * CONVERSIONS.KNOTS_TO_MPS;

    console.log('Debug calculateExitCircle: Eingabewerte', {
        exitAltitude, openingAltitude, legHeightDownwind, descentRate, canopySpeedKt, safetyHeight
    });

    const reductionDistance = (safetyHeight / descentRate) * canopySpeedMps;

    const heights = interpolatedData.map(d => d.height);
    const uComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'm/s', 'km/h') * Math.sin(d.dir * Math.PI / 180));
    const vComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'm/s', 'km/h') * Math.cos(d.dir * Math.PI / 180));
    const elevation = Math.round(AppState.lastAltitude);

    const flyTime = (openingAltitude - CANOPY_OPENING_BUFFER_METERS - legHeightDownwind) / descentRate;
    const horizontalCanopyDistance = flyTime * canopySpeedMps;
    const flyTimeFull = (openingAltitude - CANOPY_OPENING_BUFFER_METERS) / descentRate;
    const horizontalCanopyDistanceFull = flyTimeFull * canopySpeedMps;

    console.log('Debug calculateExitCircle: Berechnungen', {
        flyTime, horizontalCanopyDistance, flyTimeFull, horizontalCanopyDistanceFull, reductionDistance
    });

    // Original Logik für die Drift (wie in deiner Datei)
    const meanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, elevation + safetyHeight + legHeightDownwind, elevation + openingAltitude - CANOPY_OPENING_BUFFER_METERS);
    const meanWindFull = Utils.calculateMeanWind(heights, uComponents, vComponents, elevation + safetyHeight, elevation + openingAltitude - CANOPY_OPENING_BUFFER_METERS);

    let safetyWindWarning = false;
    let windSpeedInSafetyLayer = 0;

    if (safetyHeight > 0) {
        // Wir prüfen den Wind NUR in der Schicht [Pattern Entry ... Pattern Entry + Safety Height]
        const meanWindSafetyLayer = Utils.calculateMeanWind(
            heights,
            uComponents,
            vComponents,
            elevation + legHeightDownwind,
            elevation + legHeightDownwind + safetyHeight
        );

        if (meanWindSafetyLayer) {
            windSpeedInSafetyLayer = meanWindSafetyLayer[1]; // Index 1 ist Speed in m/s

            // Warnung, wenn mittlerer Wind dort stärker ist als die Schirmfahrt
            if (windSpeedInSafetyLayer > canopySpeedMps) {
                safetyWindWarning = true;
                console.warn(`WARNUNG: Wind in Safety Height (${windSpeedInSafetyLayer.toFixed(1)} m/s) > Schirmfahrt (${canopySpeedMps.toFixed(1)} m/s)!`);
            }
        }
    }

    // Wenn für die berechneten Höhen kein Wind gefunden wurde, brechen wir ab, 
    // statt abzustürzen.
    if (!meanWind || !meanWindFull) {
        console.warn('calculateExitCircle: Kein Wind für den angegebenen Höhenbereich gefunden (meanWind ist null).');
        return null;
    }

    // --------------------------------

    console.log('Debug calculateExitCircle: meanWind', meanWind);
    console.log('Debug calculateExitCircle: meanWindFull', meanWindFull);

    console.log('Debug calculateExitCircle: Vor calculateLandingPatternCoords');
    const landingPatternCoords = calculateLandingPatternCoords(AppState.lastLat, AppState.lastLng, interpolatedData);
    console.log('Debug calculateExitCircle: Nach calculateLandingPatternCoords', landingPatternCoords);
    let [blueLat, blueLng] = landingPatternCoords.downwindStart;
    if (!Number.isFinite(blueLat)) {
        console.log('Debug calculateExitCircle: Fallback zu lastLat/lastLng');
        blueLat = AppState.lastLat;
        blueLng = AppState.lastLng;
    }
    const newCenterBlue = Utils.calculateNewCenter(blueLat, blueLng, meanWind[1] * flyTime, meanWind[0]);
    const newCenterRed = Utils.calculateNewCenter(AppState.lastLat, AppState.lastLng, meanWindFull[1] * flyTimeFull, meanWindFull[0]);

    console.log('Debug calculateExitCircle: newCenterBlue', newCenterBlue);
    console.log('Debug calculateExitCircle: newCenterRed', newCenterRed);

    console.log('Debug calculateExitCircle: Vor calculateFreeFall');
    const jumpRunData = jumpRunTrack(interpolatedData);
    const jumpRunDirection = jumpRunData ? jumpRunData.direction : 0;
    const freeFallResult = calculateFreeFall(AppState.weatherData, exitAltitude, openingAltitude, interpolatedData, AppState.lastLat, AppState.lastLng, elevation, jumpRunDirection);
    console.log('Debug calculateExitCircle: Nach calculateFreeFall', freeFallResult);
    if (!freeFallResult) {
        console.log('Debug calculateExitCircle: Rückgabe null wegen freeFall');
        return null;
    }

    const greenShiftDirection = (freeFallResult.directionDeg + 180) % 360;
    const greenCenterFull = Utils.calculateNewCenter(newCenterRed[0], newCenterRed[1], freeFallResult.distance, greenShiftDirection);
    const greenCenter = Utils.calculateNewCenter(newCenterBlue[0], newCenterBlue[1], freeFallResult.distance, greenShiftDirection);

    console.log(`[calculateExitCircle] freeFallResult: distance=${freeFallResult.distance.toFixed(2)} m, directionDeg=${freeFallResult.directionDeg.toFixed(1)}°`);
    console.log(`[calculateExitCircle] meanWind: dir=${meanWind[0].toFixed(1)}°, speed=${meanWind[1].toFixed(2)} m/s`);
    console.log(`[calculateExitCircle] greenCenterFull: lat=${greenCenterFull[0]}, lng=${greenCenterFull[1]}`);
    console.log(`[calculateExitCircle] greenCenter: lat=${greenCenter[0]}, lng=${greenCenter[1]}`);

    const result = {
        greenLatFull: greenCenterFull[0], greenLngFull: greenCenterFull[1],
        greenLat: greenCenter[0], greenLng: greenCenter[1],
        greenRadius: Math.max(0, horizontalCanopyDistanceFull - reductionDistance),
        darkGreenRadius: Math.max(0, horizontalCanopyDistance - reductionDistance),
        freeFallDirection: freeFallResult.directionDeg,
        freeFallDistance: freeFallResult.distance,
        freeFallTime: freeFallResult.time,
        safetyWindWarning: safetyWindWarning,
        windSpeedSafety: windSpeedInSafetyLayer,
        canopySpeed: canopySpeedMps
    };
    console.log('Debug calculateExitCircle: Ergebnis', result);
    return result;
}

/**
 * Berechnet die potenziellen Reichweiten unter dem geöffneten Fallschirm (blaue und rote Kreise).
 * Berücksichtigt den Windversatz während der Schirmfahrt und die Vorwärtsfahrt des Schirms.
 * Das Ergebnis beinhaltet Daten für mehrere Höhenstufen (blaue Kreise), um den Öffnungsbereich darzustellen.
 * @param {object[]} interpolatedData - Die interpolierten Wetterdaten.
 * @returns {object|null} Ein Objekt mit allen notwendigen Daten für die Visualisierung der Schirmfahrtbereiche oder null.
 */
export function calculateCanopyCircles(interpolatedData) {
    if (!Settings.state.userSettings.showCanopyArea || !Settings.state.userSettings.calculateJump || !AppState.weatherData || AppState.lastLat == null || AppState.lastLng == null || AppState.lastAltitude === 'N/A') return null;
    if (!interpolatedData || interpolatedData.length === 0) return null;

    const heightUnit = Settings.getValue('heightUnit', 'm');

    // 2. Rohwerte aus Input lesen
    let exitAltRaw = parseInt(document.getElementById('exitAltitude')?.value) || 3000;
    let openAltRaw = parseInt(document.getElementById('openingAltitude')?.value) || 1200;
    let safetyRaw = parseInt(document.getElementById('safetyHeight')?.value) || 0;
    let legDownRaw = parseInt(document.getElementById('legHeightDownwind')?.value) || 300;

    // 3. Werte normalisieren (ALLES in Meter umrechnen für die Physik)
    let exitAltitude, openingAltitude, safetyHeight, legHeightDownwind;

    if (heightUnit === 'ft') {
        exitAltitude = Utils.convertFeetToMeters(exitAltRaw);
        openingAltitude = Utils.convertFeetToMeters(openAltRaw);
        safetyHeight = Utils.convertFeetToMeters(safetyRaw);
        legHeightDownwind = Utils.convertFeetToMeters(legDownRaw);
    } else {
        exitAltitude = exitAltRaw;
        openingAltitude = openAltRaw;
        safetyHeight = safetyRaw;
        legHeightDownwind = legDownRaw;
    }

    const descentRate = parseFloat(document.getElementById('descentRate')?.value) || 3.5;
    const canopySpeedMps = (parseFloat(document.getElementById('canopySpeed')?.value) || 20) * CONVERSIONS.KNOTS_TO_MPS;

    const reductionDistance = (safetyHeight / descentRate) * canopySpeedMps;

    const heights = interpolatedData.map(d => d.height);
    const uComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'm/s', 'km/h') * Math.sin(d.dir * Math.PI / 180));
    const vComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'm/s', 'km/h') * Math.cos(d.dir * Math.PI / 180));
    const elevation = Math.round(AppState.lastAltitude);

    const flyTime = (openingAltitude - CANOPY_OPENING_BUFFER_METERS - legHeightDownwind) / descentRate;
    const horizontalCanopyDistance = flyTime * canopySpeedMps;
    const flyTimeFull = (openingAltitude - CANOPY_OPENING_BUFFER_METERS) / descentRate;
    const horizontalCanopyDistanceFull = flyTimeFull * canopySpeedMps;

    const meanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, elevation + legHeightDownwind, elevation + safetyHeight + openingAltitude - CANOPY_OPENING_BUFFER_METERS);
    const meanWindFull = Utils.calculateMeanWind(heights, uComponents, vComponents, elevation + safetyHeight, elevation + openingAltitude - CANOPY_OPENING_BUFFER_METERS);

    if (!meanWind || !meanWindFull) {
        console.warn('calculateCanopyCircles: Kein Wind für den angegebenen Höhenbereich gefunden (meanWind ist null).');
        return null;
    }

    const landingPatternCoords = calculateLandingPatternCoords(AppState.lastLat, AppState.lastLng, interpolatedData);
    let [blueLat, blueLng] = landingPatternCoords.downwindStart;
    if (!Number.isFinite(blueLat)) { blueLat = AppState.lastLat; blueLng = AppState.lastLng; }

    const upperLimit = elevation + openingAltitude - CANOPY_OPENING_BUFFER_METERS;
    const lowerLimit = elevation + legHeightDownwind;
    const additionalBlueRadii = [], additionalBlueDisplacements = [], additionalBlueDirections = [], additionalBlueUpperLimits = [];
    let decrement = ((upperLimit - lowerLimit) <= 1000) ? 200 : 500;
    for (let currentUpper = upperLimit; currentUpper >= lowerLimit + 200; currentUpper -= decrement) {
        const currentFlyTime = (currentUpper - lowerLimit) / descentRate;
        const currentRadius = currentFlyTime * canopySpeedMps;
        if (currentRadius > 0) {
            const currentMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, lowerLimit, currentUpper);
            if (!currentMeanWind) continue;
            additionalBlueRadii.push(Math.max(0, currentRadius - reductionDistance));
            additionalBlueDisplacements.push(currentMeanWind[1] * currentFlyTime);
            additionalBlueDirections.push(currentMeanWind[0]);
            additionalBlueUpperLimits.push(currentUpper - elevation);
        }
    }

    console.log('[calculateCanopyCircles] Debug meanWind:', meanWind);
    console.log('[calculateCanopyCircles] Debug flyTime:', flyTime);
    console.log('[calculateCanopyCircles] Debug meanWindFull:', meanWindFull);
    console.log('[calculateCanopyCircles] Debug flyTimeFull:', flyTimeFull);

    // Berechnung der tatsächlichen Mittelpunkte mit Windversatz
    const redCircleCenter = Utils.calculateNewCenter(
        AppState.lastLat,
        AppState.lastLng,
        meanWindFull[1] * flyTimeFull,
        meanWindFull[0]
    );
    console.log('[calculateCanopyCircles] Tatsächlicher Mittelpunkt roter Kreis:', {
        lat: redCircleCenter[0].toFixed(3),
        lng: redCircleCenter[1].toFixed(3)
    });

    const blueCircleCenter = Utils.calculateNewCenter(
        blueLat,
        blueLng,
        meanWind[1] * flyTime,
        meanWind[0]
    );
    console.log('[calculateCanopyCircles] Tatsächlicher Mittelpunkt blauer Kreis:', {
        lat: blueCircleCenter[0].toFixed(3),
        lng: blueCircleCenter[1].toFixed(3)
    });

    return {
        blueLat, blueLng, redLat: AppState.lastLat, redLng: AppState.lastLng,
        radius: Math.max(0, horizontalCanopyDistance - reductionDistance),
        radiusFull: Math.max(0, horizontalCanopyDistanceFull - reductionDistance),
        additionalBlueRadii, additionalBlueDisplacements, additionalBlueDirections, additionalBlueUpperLimits,
        displacement: meanWind[1] * flyTime, direction: meanWind[0],
        displacementFull: meanWindFull[1] * flyTimeFull, directionFull: meanWindFull[0],
        meanWindForFullCanopyDir: meanWindFull[0], meanWindForFullCanopySpeedMps: meanWindFull[1],
    };
}

/**
 * Berechnet die geographischen Koordinaten der Eckpunkte des Landemusters.
 * Startet am Landepunkt (DIP) und rechnet von dort aus rückwärts (Final, Base, Downwind),
 * um die Koordinaten für jeden Leg-Startpunkt zu ermitteln.
 * @param {number} lat - Die geographische Breite des Landepunkts (DIP).
 * @param {number} lng - Die geographische Länge des Landepunkts (DIP).
 * @param {object[]} interpolatedData - Die interpolierten Wetterdaten.
 * @returns {{downwindLat: number, downwindLng: number, downwindStart: number[], baseStart: number[], finalStart: number[], landingPoint: number[]}|null} Ein Objekt mit den Koordinaten der Eckpunkte oder null bei Fehler.
 */
export function calculateLandingPatternCoords(lat, lng, interpolatedData) {
    if (!interpolatedData || interpolatedData.length === 0 || AppState.lastAltitude === 'N/A') return null;

    const heightUnit = Settings.getValue('heightUnit', 'm');

    // 2. Rohwerte aus Input lesen
    let legFinalRaw = parseInt(document.getElementById('legHeightFinal')?.value) || 100;
    let legBaseRaw = parseInt(document.getElementById('legHeightBase')?.value) || 200;
    let legDownRaw = parseInt(document.getElementById('legHeightDownwind')?.value) || 300;

    // 3. Werte normalisieren (ALLES in Meter umrechnen für die Physik)
    let LEG_HEIGHT_DOWNWIND, LEG_HEIGHT_BASE, LEG_HEIGHT_FINAL;

    if (heightUnit === 'ft') {
        LEG_HEIGHT_FINAL = Utils.convertFeetToMeters(legFinalRaw);
        LEG_HEIGHT_BASE = Utils.convertFeetToMeters(legBaseRaw);
        LEG_HEIGHT_DOWNWIND = Utils.convertFeetToMeters(legDownRaw);
    } else {
        LEG_HEIGHT_FINAL = legFinalRaw;
        LEG_HEIGHT_BASE = legBaseRaw;
        LEG_HEIGHT_DOWNWIND = legDownRaw;
    }

    const CANOPY_SPEED_KT = parseInt(document.getElementById('canopySpeed').value) || 20;
    const DESCENT_RATE_MPS = parseFloat(document.getElementById('descentRate').value) || 3.5;
    const baseHeight = Math.round(AppState.lastAltitude);

    const heights = interpolatedData.map(d => d.height);
    const uComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'kt', 'km/h') * Math.sin(d.dir * Math.PI / 180));
    const vComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'kt', 'km/h') * Math.cos(d.dir * Math.PI / 180));

    const landingDirectionSetting = document.querySelector('input[name="landingDirection"]:checked')?.value || 'LL';
    const customLandingDirInput = document.getElementById(landingDirectionSetting === 'LL' ? 'customLandingDirectionLL' : 'customLandingDirectionRR');
    const rawInput = customLandingDirInput ? parseInt(customLandingDirInput.value, 10) : NaN;
    // DOM-Wert ist ggf. magnetic → zurück in true north konvertieren
    const customLandingDir = Number.isFinite(rawInput) ? Utils.reverseNorthReference(rawInput, AppState.lastLat, AppState.lastLng) : NaN;
    let effectiveLandingWindDir = Number.isFinite(customLandingDir) ? customLandingDir : (Number.isFinite(AppState.landingWindDir) ? AppState.landingWindDir : interpolatedData[0]?.dir);

    if (!Number.isFinite(effectiveLandingWindDir)) return null;

    const calculateLegEndpoint = (startLat, startLng, bearing, groundSpeedKt, timeSec) => {
        const speedMps = groundSpeedKt * (1.852 / 3.6); // Knots to m/s
        const lengthMeters = speedMps * timeSec;
        return Utils.calculateNewCenter(startLat, startLng, lengthMeters, bearing);
    };

    // Final Leg
    const finalMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, baseHeight === 0 ? 1 : baseHeight, baseHeight + LEG_HEIGHT_FINAL);
    if (!finalMeanWind) return null;
    const finalWindDir = finalMeanWind[0];
    const finalWindSpeedKt = finalMeanWind[1];
    const finalCourse = effectiveLandingWindDir;
    const finalWindAngle = Utils.calculateWindAngle(finalCourse, finalWindDir);
    const { crosswind: finalCrosswind, headwind: finalHeadwind } = Utils.calculateWindComponents(finalWindSpeedKt, finalWindAngle);
    const finalWca = Utils.calculateWCA(finalCrosswind, CANOPY_SPEED_KT) * (finalCrosswind >= 0 ? 1 : -1);
    const { groundSpeed: finalGroundSpeedKt } = Utils.calculateFlightParameters(finalCourse, finalWindDir, finalWindSpeedKt, CANOPY_SPEED_KT);
    const finalTime = LEG_HEIGHT_FINAL / DESCENT_RATE_MPS;
    const finalLength = finalGroundSpeedKt * (1.852 / 3.6) * finalTime;
    const finalStart = calculateLegEndpoint(lat, lng, (finalCourse + 180) % 360, finalGroundSpeedKt, finalTime);

    // Base Leg
    const baseMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, baseHeight + LEG_HEIGHT_FINAL, baseHeight + LEG_HEIGHT_BASE);
    if (!baseMeanWind) return null;
    const baseWindDir = baseMeanWind[0];
    const baseWindSpeedKt = baseMeanWind[1];
    const baseHeading = (effectiveLandingWindDir + (landingDirectionSetting === 'LL' ? 90 : -90) + 360) % 360;
    const { trueCourse: baseCourse, groundSpeed: baseGroundSpeedKt } = Utils.calculateCourseFromHeading(baseHeading, baseWindDir, baseWindSpeedKt, CANOPY_SPEED_KT);
    const baseWindAngle = Utils.calculateWindAngle(baseCourse, baseWindDir);
    const { crosswind: baseCrosswind, headwind: baseHeadwind } = Utils.calculateWindComponents(baseWindSpeedKt, baseWindAngle);
    const baseWca = Utils.calculateWCA(baseCrosswind, CANOPY_SPEED_KT) * (baseCrosswind >= 0 ? 1 : -1);
    let baseBearing = (baseCourse + 180) % 360;
    if (baseGroundSpeedKt < 0) {
        baseBearing = (baseBearing + 180) % 360; // Reverse the course
    }
    const baseTime = (LEG_HEIGHT_BASE - LEG_HEIGHT_FINAL) / DESCENT_RATE_MPS;
    const baseLength = baseGroundSpeedKt * (1.852 / 3.6) * baseTime;
    const baseStart = calculateLegEndpoint(finalStart[0], finalStart[1], baseBearing, baseGroundSpeedKt, baseTime);

    // Downwind Leg
    const downwindMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, baseHeight + LEG_HEIGHT_BASE, baseHeight + LEG_HEIGHT_DOWNWIND);
    if (!downwindMeanWind) return null;
    const downwindWindDir = downwindMeanWind[0];
    const downwindWindSpeedKt = downwindMeanWind[1];
    const downwindCourse = (effectiveLandingWindDir + 180) % 360;
    const downwindWindAngle = Utils.calculateWindAngle(downwindCourse, downwindWindDir);
    const { crosswind: downwindCrosswind, headwind: downwindHeadwind } = Utils.calculateWindComponents(downwindWindSpeedKt, downwindWindAngle);
    const downwindWca = Utils.calculateWCA(downwindCrosswind, CANOPY_SPEED_KT) * (downwindCrosswind >= 0 ? 1 : -1);
    const { groundSpeed: downwindGroundSpeedKt } = Utils.calculateFlightParameters(downwindCourse, downwindWindDir, downwindWindSpeedKt, CANOPY_SPEED_KT);
    const downwindTime = (LEG_HEIGHT_DOWNWIND - LEG_HEIGHT_BASE) / DESCENT_RATE_MPS;
    const downwindLength = downwindGroundSpeedKt * (1.852 / 3.6) * downwindTime;
    const downwindStart = calculateLegEndpoint(baseStart[0], baseStart[1], (downwindCourse + 180) % 360, downwindGroundSpeedKt, downwindTime);

    // Detailed console.log for each leg
    console.log(`[Pattern] Landing Pattern Updated:
        Final Leg: Wind: ${finalWindDir.toFixed(1)}° @ ${finalWindSpeedKt.toFixed(1)}kt, Course: ${finalCourse.toFixed(1)}°, WCA: ${finalWca.toFixed(1)}°, GS: ${finalGroundSpeedKt.toFixed(1)}kt, HW: ${finalHeadwind.toFixed(1)}kt, Length: ${finalLength.toFixed(1)}m
        Base Leg: Wind: ${baseWindDir.toFixed(1)}° @ ${baseWindSpeedKt.toFixed(1)}kt, Course: ${baseCourse.toFixed(1)}°, WCA: ${baseWca.toFixed(1)}°, GS: ${baseGroundSpeedKt.toFixed(1)}kt, HW: ${baseHeadwind.toFixed(1)}kt, Length: ${baseLength.toFixed(1)}m
        Downwind Leg: Wind: ${downwindWindDir.toFixed(1)}° @ ${downwindWindSpeedKt.toFixed(1)}kt, Course: ${downwindCourse.toFixed(1)}°, WCA: ${downwindWca.toFixed(1)}°, GS: ${downwindGroundSpeedKt.toFixed(1)}kt, HW: ${downwindHeadwind.toFixed(1)}kt, Length: ${downwindLength.toFixed(1)}m`);

    // Koordinaten-Logs (korrigiert für baseStart)
    console.log('[Pattern] Coordinates DIP: ', lat, lng, 'Altitude DIP:', baseHeight);
    console.log('[Pattern] Coordinates final end: ', finalStart[0], finalStart[1], 'Leg Height:', baseHeight + LEG_HEIGHT_FINAL);
    console.log('[Pattern] Coordinates base end: ', baseStart[0], baseStart[1], 'Leg Height:', baseHeight + LEG_HEIGHT_BASE);
    console.log('[Pattern] Coordinates downwind end: ', downwindStart[0], downwindStart[1], 'Leg Height:', baseHeight + LEG_HEIGHT_DOWNWIND);

    return {
        downwindStart: downwindStart,
        baseStart: baseStart,
        finalStart: finalStart,
        landingPoint: [lat, lng]
    };
}

/**
 * Berechnet den potenziellen Landebereich der Kappe nach einem Abtrennverfahren (Cut-Away).
 * @param {object[]} interpolatedData - Die interpolierten Wetterdaten.
 * @returns {{center: number[], radius: number, tooltipContent: string}|null} Ein Objekt für die Visualisierung.
 */
export function calculateCutAway(interpolatedData) {
    if (!AppState.map || AppState.cutAwayLat === null || AppState.cutAwayLng === null || !AppState.weatherData || AppState.lastAltitude === 'N/A' || !interpolatedData || interpolatedData.length === 0) {
        return null;
    }

    // 1. Einheit abrufen
    const heightUnit = Settings.getValue('heightUnit', 'm');

    // 2. Rohwerte aus Input lesen
    let cutAwayRaw = parseInt(document.getElementById('cutAwayAltitude')?.value) || 3000;

    // 3. Werte normalisieren (ALLES in Meter umrechnen für die Physik)
    let cutAwayAltitude;

    if (heightUnit === 'ft') {
        cutAwayAltitude = Utils.convertFeetToMeters(cutAwayRaw);
    } else {
        cutAwayAltitude = cutAwayRaw;
    }

    const elevation = Math.round(AppState.lastAltitude);
    const lowerLimit = elevation;
    const upperLimit = elevation + cutAwayAltitude;

    const heights = interpolatedData.map(d => d.height);
    const uComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'm/s', 'km/h') * Math.sin(d.dir * Math.PI / 180));
    const vComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'm/s', 'km/h') * Math.cos(d.dir * Math.PI / 180));

    const meanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, lowerLimit, upperLimit);
    if (!meanWind) return null;

    const [meanWindDirection, meanWindSpeedMps] = meanWind;

    const verticalSpeeds = { 'Open': CUTAWAY_VERTICAL_SPEEDS_MPS.OPEN, 'Partially': CUTAWAY_VERTICAL_SPEEDS_MPS.PARTIALLY, 'Collapsed': CUTAWAY_VERTICAL_SPEEDS_MPS.COLLAPSED }; // Pre-calculated speeds
    const verticalSpeedSelected = verticalSpeeds[Settings.state.userSettings.cutAwayState] || verticalSpeeds['Partially'];
    const descentTime = cutAwayAltitude / verticalSpeedSelected;
    const displacementDistance = meanWindSpeedMps * descentTime;
    const adjustedWindDirection = (meanWindDirection + 180) % 360;

    const [centerLat, centerLng] = Utils.calculateNewCenter(AppState.cutAwayLat, AppState.cutAwayLng, displacementDistance, adjustedWindDirection);

    // 1. Mapping der internen Werte auf die Übersetzungs-Keys
    const stateMapping = {
        'Open': 'planner.state_open',
        'Partially': 'planner.state_partially',
        'Collapsed': 'planner.state_collapsed'
    };

    // 2. Den aktuellen Status auslesen und den passenden übersetzten Text holen
    const rawState = Settings.state.userSettings.cutAwayState;
    const translatedState = I18n.t(stateMapping[rawState] || 'planner.state_partially');

    // 3. Den Tooltip mit dem übersetzten Status zusammenbauen
    const tooltipContent = `<b>${I18n.t('planner.cutaway_title', { state: translatedState })}</b><br>` +
        `${I18n.t('planner.cutaway_alt')}: ${cutAwayAltitude} m<br>` +
        `${I18n.t('planner.cutaway_displacement')}: ${meanWindDirection.toFixed(0)}°, ${displacementDistance.toFixed(0)} m<br>` +
        `${I18n.t('planner.cutaway_time_speed')}: ${descentTime.toFixed(0)} s / ${verticalSpeedSelected.toFixed(1)} m/s<br>`;

    return { center: [centerLat, centerLng], radius: CUTAWAY_VISUALIZATION_RADIUS_METERS, tooltipContent };
}

export async function analyzeTerrainClearance() {
    // 1. Notwendige Daten und Parameter sammeln (wie zuvor)
    const sliderIndex = parseInt(document.getElementById('timeSlider')?.value) || 0;
    const interpStep = Settings.getValue('interpStep', 'select', 200);
    const heightUnit = Settings.getValue('heightUnit', 'm');
    const interpolatedData = weatherManager.interpolateWeatherData(
        AppState.weatherData, sliderIndex, interpStep, Math.round(AppState.lastAltitude), heightUnit
    );

    const descentRate = parseFloat(document.getElementById('descentRate')?.value) || 3.5;
    const canopySpeedMps = (parseFloat(document.getElementById('canopySpeed')?.value) || 20) * CONVERSIONS.KNOTS_TO_MPS;
    const dipElevation = AppState.lastAltitude;

    // 2. Den kleinsten blauen Kreis identifizieren.
    const canopyResult = calculateCanopyCircles(interpolatedData);
    if (!canopyResult || canopyResult.additionalBlueRadii.length === 0) {
        throw new Error(I18n.t('planner.error_terrain_calc'));
    }

    const smallestCircleIndex = canopyResult.additionalBlueRadii.length - 1;
    const circleRadius = canopyResult.additionalBlueRadii[smallestCircleIndex];
    const baseLat = canopyResult.blueLat;
    const baseLng = canopyResult.blueLng;
    const displacement = canopyResult.additionalBlueDisplacements[smallestCircleIndex];
    const direction = canopyResult.additionalBlueDirections[smallestCircleIndex];
    const circleCenter = Utils.calculateNewCenter(baseLat, baseLng, displacement, direction);
    const entryAltitudeAGL = canopyResult.additionalBlueUpperLimits[smallestCircleIndex];
    const downwindStartPoint = L.latLng(baseLat, baseLng);

    // Zeigt die Parameter des zu analysierenden Bereichs an
    console.log(`--- TERRAIN ANALYSIS STARTED ---
    - Analyzing Circle Center: ${circleCenter[0].toFixed(4)}, ${circleCenter[1].toFixed(4)}
    - Circle Radius: ${circleRadius.toFixed(0)}m
    - Skydiver Entry Altitude: ${entryAltitudeAGL.toFixed(0)}m AGL (${(dipElevation + entryAltitudeAGL).toFixed(0)}m MSL)
    -----------------------------`);

    const cacheKey = `${circleCenter[0].toFixed(4)}_${circleCenter[1].toFixed(4)}_${circleRadius.toFixed(0)}`;
    let pointsWithGroundEle = [];

    if (AppState.terrainAnalysisCache && AppState.terrainAnalysisCache.key === cacheKey) {
        console.log("Using cached terrain elevation data.");
        Utils.handleMessage(I18n.t('planner.cached_terrain_data'));
        pointsWithGroundEle = AppState.terrainAnalysisCache.data;
    } else {
        // 3. Ein Raster von Punkten INNERHALB des Kreises erstellen (wie zuvor)
        const gridSpacingMeters = 75;
        const pointsToCheck = [];
        const centerLatLng = L.latLng(circleCenter);

        for (let i = -circleRadius; i <= circleRadius; i += gridSpacingMeters) {
            for (let j = -circleRadius; j <= circleRadius; j += gridSpacingMeters) {
                if (i * i + j * j <= circleRadius * circleRadius) {
                    const pointLat = centerLatLng.lat + (i / 111320);
                    const pointLng = centerLatLng.lng + (j / (111320 * Math.cos(centerLatLng.lat * Math.PI / 180)));
                    pointsToCheck.push(L.latLng(pointLat, pointLng));
                }
            }
        }

        if (pointsToCheck.length === 0) return [];

        // 4. Geländehöhen in Batches abrufen mit Pause zwischen Batches
        const batchSize = 100;
        let failedPoints = 0;
        for (let i = 0; i < pointsToCheck.length; i += batchSize) {
            const batch = pointsToCheck.slice(i, i + batchSize);
            Utils.handleMessage(I18n.t('planner.terrain_analyzing', {
                current: i + batch.length,
                total: pointsToCheck.length
            }));

            // Pause zwischen Batches, um Rate Limiting zu vermeiden
            if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, 300));
            }

            const elevations = await Utils.getMultipleAltitudes(batch);

            for (let j = 0; j < batch.length; j++) {
                const point = batch[j];
                const groundEle = elevations[j];
                if (groundEle === 'N/A') failedPoints++;
                pointsWithGroundEle.push({ ...point, groundEle: groundEle !== 'N/A' ? groundEle : null });
            }
        }

        if (failedPoints > 0) {
            console.warn(`Terrain analysis: ${failedPoints} of ${pointsToCheck.length} elevation points failed (likely rate limited).`);
            Utils.handleError(I18n.t('planner.terrain_rate_limited'));
        }

        // Speichere die frisch abgerufenen Daten im Cache für die nächste Analyse
        AppState.terrainAnalysisCache = {
            key: cacheKey,
            data: pointsWithGroundEle
        };
        console.log("Terrain elevation data has been cached.");
    }


    // 5. Springerhöhe pro Punkt berechnen (proportional zur Distanz vom Downwind-Einstieg)
    const maxDist = displacement + circleRadius;
    const altitudeRange = (circleRadius / canopySpeedMps) * descentRate;
    const lowerAltAGL = entryAltitudeAGL - altitudeRange;

    const dangerousPoints = [];
    const allAnalyzedPoints = [];

    let clearanceRaw = parseInt(document.getElementById('terrainClearance')?.value) || 100;
    let requiredClearance;

    if (heightUnit === 'ft') {
        requiredClearance = Utils.convertFeetToMeters(clearanceRaw);
    } else {
        requiredClearance = clearanceRaw;
    }
    for (const point of pointsWithGroundEle) {
        const groundElevation = point.groundEle;

        if (groundElevation === null) continue;

        const distToDownwind = AppState.map.distance(point, downwindStartPoint);
        const fraction = Math.min(distToDownwind / maxDist, 1);
        const skydiverAltAGL = lowerAltAGL + fraction * altitudeRange;
        const skydiverMslAltitude = dipElevation + skydiverAltAGL;
        const clearance = skydiverMslAltitude - groundElevation;

        allAnalyzedPoints.push({
            lat: point.lat, lng: point.lng,
            clearance, groundElevation, skydiverMslAltitude
        });

        if (clearance < requiredClearance) {
            dangerousPoints.push(point);
        }
    }

    AppState.terrainAllPoints = allAnalyzedPoints;
    AppState.terrainRequiredClearance = requiredClearance;

    console.log(`--- TERRAIN ANALYSIS FINISHED ---
    - Points Analyzed: ${allAnalyzedPoints.length}
    - Dangerous Points Found: ${dangerousPoints.length}
    --------------------------------`);

    return dangerousPoints;
}

// ===================================================================
// 2. Interne Kernphysik & Simulation
// ===================================================================

/**
 * Simuliert die Freifall-Trajektorie eines Springers von der Exit- bis zur Öffnungshöhe.
 * Berücksichtigt den anfänglichen Vorwärtswurf aus dem Flugzeug und den Windversatz auf verschiedenen Höhen.
 * @param {object} weatherData - Das komplette Wetterdatenobjekt von der API.
 * @param {number} exitAltitude - Die Ausstiegshöhe in Metern AGL.
 * @param {number} openingAltitude - Die geplante Öffnungshöhe in Metern AGL.
 * @param {object[]} interpolatedData - Die bereits interpolierten Wetterdaten für die Berechnung.
 * @param {number} startLat - Die geographische Breite des Absetzpunktes (DIP).
 * @param {number} startLng - Die geographische Länge des Absetzpunktes (DIP).
 * @param {number} elevation - Die Geländehöhe am Absetzpunkt in Metern AMSL.
 * @param {number} jumpRunDirection - Die Richtung des Anflugs in Grad.
 * @returns {{time: number, distance: number, directionDeg: number, path: object[]}|null} Ein Objekt mit Freifallzeit, Versatzdistanz, Richtung und dem Trajektorienpfad.
 * @private
 */
export function calculateFreeFall(weatherData, exitAltitude, openingAltitude, interpolatedData, startLat, startLng, elevation, jumpRunDirection) {
    // --- 1. Eingabe-Validierung ---
    if (!weatherData || !interpolatedData || interpolatedData.length === 0) {
        Utils.handleError(I18n.t('planner.freefall_weather_data_missing'));
        return null;
    }
    if (!Utils.isValidLatLng(startLat, startLng) || !Number.isFinite(elevation)) {
        Utils.handleError(I18n.t('planner.freefall_invalid_coordinates'));
        return null;
    }
    if (exitAltitude <= openingAltitude) {
        Utils.handleError(I18n.t('planner.freefall_exit_altitude_invalid'));
        return null;
    }

    console.log("--- calculateFreeFall: Berechnung gestartet ---");

    // --- 2. Parameter & Konstanten extrahieren ---
    const { TERMINAL_VELOCITY_VERTICAL_MPS, GRAVITY_ACCELERATION, HORIZONTAL_DRAG_TAU_SECONDS } = FREEFALL_PHYSICS;
    const aircraftSpeedKt = Settings.state.userSettings.aircraftSpeedKt;
    const exitAltitudeFt = exitAltitude / CONVERSIONS.FEET_TO_METERS;

    // --- 3. Ground Speed am Absetzpunkt berechnen ---
    const aircraftSpeedTAS = Utils.calculateTAS(aircraftSpeedKt, exitAltitudeFt);
    let groundSpeedMps = aircraftSpeedKt * CONVERSIONS.KNOTS_TO_MPS; // Fallback

    if (Number.isFinite(aircraftSpeedTAS)) {
        const heightsAGL = interpolatedData.map(d => d.height - elevation);
        const windDirAtExit = Utils.linearInterpolate(heightsAGL, interpolatedData.map(d => d.dir), exitAltitude);
        const windSpeedMpsAtExit = Utils.linearInterpolate(heightsAGL, interpolatedData.map(d => Utils.convertWind(d.spd, 'm/s', 'km/h')), exitAltitude);

        const tasMps = aircraftSpeedTAS * CONVERSIONS.KNOTS_TO_MPS;
        const windToRad = (windDirAtExit + 180) * Math.PI / 180;
        const windU = windSpeedMpsAtExit * Math.sin(windToRad);
        const windV = windSpeedMpsAtExit * Math.cos(windToRad);
        const headingRad = jumpRunDirection * Math.PI / 180;
        const tasU = tasMps * Math.sin(headingRad);
        const tasV = tasMps * Math.cos(headingRad);
        groundSpeedMps = Math.sqrt((tasU + windU) ** 2 + (tasV + windV) ** 2);
    }
    console.log(`[Freifall-Input] JRT-Richtung: ${jumpRunDirection}°, TAS: ${aircraftSpeedTAS} kt, Berechnete Ground Speed: ${groundSpeedMps.toFixed(1)} m/s`);

    // --- 4. Dauer des Freien Falls berechnen ---
    const heightDiff = exitAltitude - openingAltitude;
    const accelTime = TERMINAL_VELOCITY_VERTICAL_MPS / GRAVITY_ACCELERATION;
    const accelDist = 0.5 * GRAVITY_ACCELERATION * accelTime ** 2;
    const constDist = heightDiff > accelDist ? heightDiff - accelDist : 0;
    const constTime = constDist / TERMINAL_VELOCITY_VERTICAL_MPS;
    const totalTime = accelTime + constTime;

    // --- 5. Wurf-Vektor (Throw) berechnen ---
    const throwDistance = groundSpeedMps * HORIZONTAL_DRAG_TAU_SECONDS;
    const throwDirection = jumpRunDirection;

    // --- 6. Abdrift-Vektor (Drift) durch Wind berechnen ---
    const uComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'm/s', 'km/h') * Math.sin(d.dir * Math.PI / 180));
    const vComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'm/s', 'km/h') * Math.cos(d.dir * Math.PI / 180));
    const meanWind = Utils.calculateMeanWind(interpolatedData.map(d => d.height), uComponents, vComponents, elevation + openingAltitude, elevation + exitAltitude);

    if (!meanWind) {
        Utils.handleError(I18n.t('planner.freefall_mean_wind_calculation_failed'));
        return null;
    }

    const [avgWindDir, avgWindSpeedMps] = meanWind;
    console.log(`[Freifall-Input] Mittelwind: ${avgWindDir.toFixed(0)}° @ ${(avgWindSpeedMps * 3.6 / 1.852).toFixed(1)} kt`);

    const driftToDir = (avgWindDir + 180) % 360;
    const driftDistance = avgWindSpeedMps * totalTime;
    console.log(`[Freifall-Ergebnis] Wurf: ${throwDirection.toFixed(0)}°, Distanz: ${throwDistance.toFixed(0)} m`);
    console.log(`[Freifall-Ergebnis] Abdrift: ${driftToDir.toFixed(0)}°, Distanz: ${driftDistance.toFixed(0)} m`);

    // --- 7. Gesamtversatz (Throw + Drift) berechnen ---
    const throwX = throwDistance * Math.cos(throwDirection * Math.PI / 180);
    const throwY = throwDistance * Math.sin(throwDirection * Math.PI / 180);
    const driftX = driftDistance * Math.cos(driftToDir * Math.PI / 180);
    const driftY = driftDistance * Math.sin(driftToDir * Math.PI / 180);

    const totalX = throwX + driftX;
    const totalY = throwY + driftY;
    const totalDistance = Math.sqrt(totalX ** 2 + totalY ** 2);
    const totalDirection = (Math.atan2(totalY, totalX) * 180 / Math.PI + 360) % 360;

    // --- 8. Ergebnis zusammenstellen ---
    const finalPosition = Utils.calculateNewCenter(startLat, startLng, totalDistance, totalDirection);

    const path = [
        { latLng: { lat: startLat, lng: startLng }, height: elevation + exitAltitude, time: 0 },
        { latLng: { lat: finalPosition[0], lng: finalPosition[1] }, height: elevation + openingAltitude, time: totalTime }
    ];

    console.log(`[Freifall-Ergebnis] Zeit: ${totalTime.toFixed(1)} s, Distanz: ${totalDistance.toFixed(0)} m, Richtung: ${totalDirection.toFixed(1)}°`);
    console.log("--- calculateFreeFall: Berechnung beendet ---");

    return {
        time: totalTime,
        distance: totalDistance,
        directionDeg: totalDirection,
        path: path
    };
}