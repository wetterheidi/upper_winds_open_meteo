// jumpPlanner.js
import { AppState } from './state.js';
import { Settings } from './settings.js';
import { Utils } from './utils.js';
import { JUMP_RUN_DEFAULTS, CUTAWAY_VISUALIZATION_RADIUS_METERS, JUMPER_SEPARATION_TABLE, CONVERSIONS, FREEFALL_PHYSICS, ISA_CONSTANTS, CANOPY_OPENING_BUFFER_METERS, CUTAWAY_VERTICAL_SPEEDS_MPS } from './constants.js';

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
    if (tas === 'N/A') {
        console.warn('TAS calculation failed, using default separation');
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
 * Simuliert die Freifall-Trajektorie eines Springers von der Exit- bis zur Öffnungshöhe.
 * Berücksichtigt den anfänglichen Vorwärtswurf aus dem Flugzeug und den Windversatz auf verschiedenen Höhen.
 * @param {object} weatherData - Das komplette Wetterdatenobjekt von der API.
 * @param {number} exitAltitude - Die Ausstiegshöhe in Metern AGL.
 * @param {number} openingAltitude - Die geplante Öffnungshöhe in Metern AGL.
 * @param {object[]} interpolatedData - Die bereits interpolierten Wetterdaten für die Berechnung.
 * @param {number} startLat - Die geographische Breite des Absetzpunktes (DIP).
 * @param {number} startLng - Die geographische Länge des Absetzpunktes (DIP).
 * @param {number} elevation - Die Geländehöhe am Absetzpunkt in Metern AMSL.
 * @returns {{time: number, distance: number, directionDeg: number, path: object[]}|null} Ein Objekt mit Freifallzeit, Versatzdistanz, Richtung und dem Trajektorienpfad, oder null bei einem Fehler.
 */
export function calculateFreeFall(weatherData, exitAltitude, openingAltitude, interpolatedData, startLat, startLng, elevation) {
    if (!weatherData || !weatherData.time || !interpolatedData || interpolatedData.length === 0) return null;
    if (!Number.isFinite(startLat) || !Number.isFinite(startLng) || !Number.isFinite(elevation)) return null;

    const hStart = elevation + exitAltitude;
    const hStop = elevation + openingAltitude - CANOPY_OPENING_BUFFER_METERS;
    
    // Pass interpolatedData down to jumpRunTrack
    const jumpRunData = jumpRunTrack(interpolatedData);
    const jumpRunDirection = jumpRunData ? jumpRunData.direction : 0;
    const aircraftSpeedKt = Settings.state.userSettings.aircraftSpeedKt;
    const exitAltitudeFt = exitAltitude / 0.3048;
    const aircraftSpeedTAS = Utils.calculateTAS(aircraftSpeedKt, exitAltitudeFt);
    let aircraftSpeedMps = (aircraftSpeedTAS === 'N/A') ? (aircraftSpeedKt * CONVERSIONS.KNOTS_TO_MPS) : (aircraftSpeedTAS * CONVERSIONS.KNOTS_TO_MPS);
    
    const vxInitial = Math.cos(jumpRunDirection * Math.PI / 180) * aircraftSpeedMps;
    const vyInitial = Math.sin(jumpRunDirection * Math.PI / 180) * aircraftSpeedMps;

    const heights = interpolatedData.map(d => d.height);
    const windDirs = interpolatedData.map(d => Number.isFinite(d.dir) ? parseFloat(d.dir) : 0);
    const windSpdsMps = interpolatedData.map(d => Utils.convertWind(parseFloat(d.spd) || 0, 'm/s', 'km/h'));
    const tempsC = interpolatedData.map(d => d.temp);
    
    const trajectory = [{ time: 0, height: hStart, vz: 0, vxGround: vxInitial, vyGround: vyInitial, x: 0, y: 0 }];
    const surfacePressure = weatherData.surface_pressure[0] || 1013.25;

    let current = trajectory[0];
    while (current.height > hStop) {
        const windDir = Utils.linearInterpolate(heights, windDirs, current.height);
        const windSpd = Utils.linearInterpolate(heights, windSpdsMps, current.height);
        const tempC = Utils.linearInterpolate(heights, tempsC, current.height);
        const tempK = tempC + CONVERSIONS.CELSIUS_TO_KELVIN;
        const Rl = ISA_CONSTANTS.GAS_CONSTANT_AIR, g = ISA_CONSTANTS.GRAVITY, dt = 0.5;
        const rho = (surfacePressure * 100 * Math.exp(-g * (current.height - elevation) / (Rl * tempK))) / (Rl * tempK);
        const windDirTo = (windDir + 180) % 360;
        const vxWind = windSpd * Math.cos(windDirTo * Math.PI / 180);
        const vyWind = windSpd * Math.sin(windDirTo * Math.PI / 180);
        const vxAir = current.vxGround - vxWind;
        const vyAir = current.vyGround - vyWind;
        const vAirMag = Math.sqrt(vxAir * vxAir + vyAir * vyAir);
        const cdVertical = 1, areaVertical = FREEFALL_PHYSICS.DEFAULT_AREA_VERTICAL, mass = FREEFALL_PHYSICS.DEFAULT_MASS_KG, cdHorizontal = FREEFALL_PHYSICS.DEFAULT_DRAG_COEFFICIENT, areaHorizontal = FREEFALL_PHYSICS.DEFAULT_AREA_HORIZONTAL;
        const bv = 0.5 * cdVertical * areaVertical * rho / mass;
        const bh = 0.5 * cdHorizontal * areaHorizontal * rho / mass;
        const az = -g - bv * current.vz * Math.abs(current.vz);
        const ax = -bh * vAirMag * vxAir;
        const ay = -bh * vAirMag * vyAir;

        let nextHeight = current.height + current.vz * dt;
        let nextVz = current.vz + az * dt;
        let nextTime = current.time + dt;
        if (nextHeight <= hStop) {
            const fraction = (current.height - hStop) / (current.height - nextHeight);
            nextTime = current.time + dt * fraction;
            nextHeight = hStop;
            nextVz = current.vz + az * dt * fraction;
        }
        const next = {
            time: nextTime, height: nextHeight, vz: nextVz,
            vxGround: vxInitial === 0 ? vxWind : current.vxGround + ax * dt,
            vyGround: vyInitial === 0 ? vyWind : current.vyGround + ay * dt,
            x: current.x + (vxInitial === 0 ? vxWind : current.vxGround) * dt,
            y: current.y + (vyInitial === 0 ? vyWind : current.vyGround) * dt
        };
        trajectory.push(next);
        current = next;
        if (next.height === hStop) break;
    }

    const final = trajectory[trajectory.length - 1];
    const distance = Math.sqrt(final.x * final.x + final.y * final.y);
    let directionDeg = Math.atan2(final.y, final.x) * 180 / Math.PI;
    directionDeg = (directionDeg + 360) % 360;

    return {
        time: final.time, distance: distance, directionDeg: directionDeg,
        path: trajectory.map(p => ({ latLng: Utils.calculateNewCenter(startLat, startLng, Math.sqrt(p.x * p.x + p.y * p.y), Math.atan2(p.y, p.x) * 180 / Math.PI), height: p.height, time: p.time })),
    };
}

/**
 * Berechnet die Position und den Radius der möglichen Exit-Bereiche (grüne Kreise).
 * Diese Kreise repräsentieren den Bereich, in dem sich der Springer nach dem Freifall befindet,
 * relativ zum geplanten Landepunkt.
 * @param {object[]} interpolatedData - Die interpolierten Wetterdaten.
 * @returns {{greenLat: number, greenLng: number, darkGreenLat: number, darkGreenLng: number, greenRadius: number, darkGreenRadius: number, freeFallDirection: number, freeFallDistance: number, freeFallTime: number}|null} Ein Objekt mit den Koordinaten und Radien für die Visualisierung oder null.
 */
export function calculateExitCircle(interpolatedData) {
    if (!Settings.state.userSettings.showExitArea || !Settings.state.userSettings.calculateJump || !AppState.weatherData || !AppState.lastLat || !AppState.lastLng) return null;
    if (!interpolatedData || interpolatedData.length === 0) return null;

    const exitAltitude = parseInt(document.getElementById('exitAltitude')?.value) || 3000;
    const openingAltitude = parseInt(document.getElementById('openingAltitude')?.value) || 1200;
    const legHeightDownwind = parseInt(document.getElementById('legHeightDownwind')?.value) || 300;
    const descentRate = parseFloat(document.getElementById('descentRate')?.value) || 3.5;
    const canopySpeedMps = (parseFloat(document.getElementById('canopySpeed')?.value) || 20) * CONVERSIONS.KNOTS_TO_MPS;
    const safetyHeight = Settings.state.userSettings.safetyHeight || 0; // NEU

    const reductionDistance = (safetyHeight / descentRate) * canopySpeedMps;

    const heights = interpolatedData.map(d => d.height);
    const uComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'm/s', 'km/h') * Math.sin(d.dir * Math.PI / 180));
    const vComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'm/s', 'km/h') * Math.cos(d.dir * Math.PI / 180));
    const elevation = Math.round(AppState.lastAltitude);
    
    const flyTime = (openingAltitude - CANOPY_OPENING_BUFFER_METERS - legHeightDownwind) / descentRate;
    const horizontalCanopyDistance = flyTime * canopySpeedMps;
    const flyTimeFull = (openingAltitude - CANOPY_OPENING_BUFFER_METERS) / descentRate;
    const horizontalCanopyDistanceFull = flyTimeFull * canopySpeedMps;

    const meanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, elevation + safetyHeight + legHeightDownwind, elevation + openingAltitude - CANOPY_OPENING_BUFFER_METERS);
    const meanWindFull = Utils.calculateMeanWind(heights, uComponents, vComponents, elevation + safetyHeight, elevation + openingAltitude - CANOPY_OPENING_BUFFER_METERS);

    const landingPatternCoords = calculateLandingPatternCoords(AppState.lastLat, AppState.lastLng, interpolatedData);
    let { downwindLat: blueLat, downwindLng: blueLng } = landingPatternCoords;
    if (!Number.isFinite(blueLat)) { blueLat = AppState.lastLat; blueLng = AppState.lastLng; }
    
    const newCenterBlue = Utils.calculateNewCenter(blueLat, blueLng, meanWind[1] * flyTime, meanWind[0]);
    const newCenterRed = Utils.calculateNewCenter(AppState.lastLat, AppState.lastLng, meanWindFull[1] * flyTimeFull, meanWindFull[0]);

    const freeFallResult = calculateFreeFall(AppState.weatherData, exitAltitude, openingAltitude, interpolatedData, AppState.lastLat, AppState.lastLng, elevation);
    if (!freeFallResult) return null;

    const greenShiftDirection = (freeFallResult.directionDeg + 180) % 360;
    const greenCenter = Utils.calculateNewCenter(newCenterRed[0], newCenterRed[1], freeFallResult.distance, greenShiftDirection);
    const darkGreenCenter = Utils.calculateNewCenter(newCenterBlue[0], newCenterBlue[1], freeFallResult.distance, greenShiftDirection);

    return {
        greenLat: greenCenter[0], greenLng: greenCenter[1], 
        darkGreenLat: darkGreenCenter[0], darkGreenLng: darkGreenCenter[1],
        // NEU: Reduziere die Radien, aber stelle sicher, dass sie nicht negativ werden
        greenRadius: Math.max(0, horizontalCanopyDistanceFull - reductionDistance), 
        darkGreenRadius: Math.max(0, horizontalCanopyDistance - reductionDistance),
        freeFallDirection: freeFallResult.directionDeg, 
        freeFallDistance: freeFallResult.distance, 
        freeFallTime: freeFallResult.time
    };
}

export function calculateCutAway(interpolatedData) {
    if (!AppState.map || AppState.cutAwayLat === null || AppState.cutAwayLng === null || !AppState.weatherData || AppState.lastAltitude === 'N/A' || !interpolatedData || interpolatedData.length === 0) {
        return null;
    }
    
    const elevation = Math.round(AppState.lastAltitude);
    const cutAwayAltitude = Settings.state.userSettings.cutAwayAltitude;
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
    
    const stateLabel = Settings.state.userSettings.cutAwayState.replace(/([A-Z])/g, ' $1').trim();
    const tooltipContent = `<b>Cut-Away (${stateLabel})</b><br>Cut-Away Altitude: ${cutAwayAltitude} m<br>Displacement: ${meanWindDirection.toFixed(0)}°, ${displacementDistance.toFixed(0)} m<br>Descent Time/Speed: ${descentTime.toFixed(0)} s at ${verticalSpeedSelected.toFixed(1)} m/s<br>`;
    
    return { center: [centerLat, centerLng], radius: CUTAWAY_VISUALIZATION_RADIUS_METERS, tooltipContent };
}

/**
 * Berechnet die potenziellen Reichweiten unter dem geöffneten Fallschirm (blaue und rote Kreise).
 * Berücksichtigt den Windversatz während der Schirmfahrt und die Vorwärtsfahrt des Schirms.
 * Das Ergebnis beinhaltet Daten für mehrere Höhenstufen (blaue Kreise), um den Öffnungsbereich darzustellen.
 * @param {object[]} interpolatedData - Die interpolierten Wetterdaten.
 * @returns {object|null} Ein Objekt mit allen notwendigen Daten für die Visualisierung der Schirmfahrtbereiche oder null.
 */
export function calculateCanopyCircles(interpolatedData) {
    if (!Settings.state.userSettings.showCanopyArea || !Settings.state.userSettings.calculateJump || !AppState.weatherData || !AppState.lastLat || !AppState.lastLng) return null;
    if (!interpolatedData || interpolatedData.length === 0) return null;

    const exitAltitude = parseInt(document.getElementById('exitAltitude')?.value) || 3000;
    const openingAltitude = parseInt(document.getElementById('openingAltitude')?.value) || 1200;
    const legHeightDownwind = parseInt(document.getElementById('legHeightDownwind')?.value) || 300;
    const descentRate = parseFloat(document.getElementById('descentRate')?.value) || 3.5;
    const canopySpeedMps = (parseFloat(document.getElementById('canopySpeed')?.value) || 20) * CONVERSIONS.KNOTS_TO_MPS;
    const safetyHeight = Settings.state.userSettings.safetyHeight || 0; // NEU

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
    
    const freeFallResult = calculateFreeFall(AppState.weatherData, exitAltitude, openingAltitude, interpolatedData, AppState.lastLat, AppState.lastLng, elevation);
    if (!freeFallResult) return null;

    const landingPatternCoords = calculateLandingPatternCoords(AppState.lastLat, AppState.lastLng, interpolatedData);
    let { downwindLat: blueLat, downwindLng: blueLng } = landingPatternCoords;
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
            additionalBlueRadii.push(Math.max(0, currentRadius - reductionDistance));
            additionalBlueDisplacements.push(currentMeanWind[1] * currentFlyTime);
            additionalBlueDirections.push(currentMeanWind[0]);
            additionalBlueUpperLimits.push(currentUpper - elevation);
        }
    }

    return {
        blueLat, blueLng, redLat: AppState.lastLat, redLng: AppState.lastLng,
        radius: Math.max(0, horizontalCanopyDistance - reductionDistance), 
        radiusFull: Math.max(0, horizontalCanopyDistanceFull - reductionDistance),
        additionalBlueRadii, additionalBlueDisplacements, additionalBlueDirections, additionalBlueUpperLimits,
        displacement: meanWind[1] * flyTime, direction: meanWind[0],
        displacementFull: meanWindFull[1] * flyTimeFull, directionFull: meanWindFull[0],
        meanWindForFullCanopyDir: meanWindFull[0], meanWindForFullCanopySpeedMps: meanWindFull[1],
        freeFallDirection: freeFallResult.directionDeg, freeFallDistance: freeFallResult.distance, freeFallTime: freeFallResult.time
    };
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

    if (!AppState.weatherData || !anchorLat || !anchorLng || AppState.lastAltitude === 'N/A' || !interpolatedData || !interpolatedData.length) {
        return null;
    }
    
    const openingAltitude = parseInt(document.getElementById('openingAltitude')?.value) || 1000;
    const elevation = Math.round(AppState.lastAltitude);
    
    const heights = interpolatedData.map(d => d.height);
    const uComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'm/s', 'km/h') * Math.sin(d.dir * Math.PI / 180));
    const vComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'm/s', 'km/h') * Math.cos(d.dir * Math.PI / 180));
    const meanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, elevation, elevation + openingAltitude);
    if(!meanWind) return null;
    
    let jumpRunTrackDirection = Math.round(meanWind[0]);
    const customDirection = parseFloat(Settings.state.userSettings.customJumpRunDirection);
    if (Number.isFinite(customDirection) && customDirection >= 0 && customDirection <= 360) {
        jumpRunTrackDirection = customDirection;
    }
    
    const exitAltitude = parseInt(document.getElementById('exitAltitude')?.value) || 3000;
    const exitHeightM = elevation + exitAltitude;
    const aircraftSpeedKt = Settings.state.userSettings.aircraftSpeedKt || 90;
    const tasKt = Utils.calculateTAS(aircraftSpeedKt, exitHeightM / 0.3048);
    
    // --- START DER KORREKTUR ---
    // Wir initialisieren groundSpeedMps mit einem sinnvollen Fallback-Wert.
    let groundSpeedMps = aircraftSpeedKt * CONVERSIONS.KNOTS_TO_MPS; 

    if (tasKt !== 'N/A' && Number.isFinite(tasKt)) {
        // Wenn TAS berechnet werden kann, wird groundSpeedMps mit dem exakten Wert überschrieben.
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
    // --- ENDE DER KORREKTUR ---
    
    const trackLength = Math.max(JUMP_RUN_DEFAULTS.MIN_TRACK_LENGTH_M, Math.min(JUMP_RUN_DEFAULTS.MAX_TRACK_LENGTH_M, Math.round((Settings.state.userSettings.numberOfJumpers || 10) * (Settings.state.userSettings.jumperSeparation || 5) * groundSpeedMps)));
    const approachLength = Math.max(JUMP_RUN_DEFAULTS.MIN_APPROACH_LENGTH_M, Math.min(JUMP_RUN_DEFAULTS.MAX_APPROACH_LENGTH_M, Math.round(groundSpeedMps * JUMP_RUN_DEFAULTS.APPROACH_TIME_SECONDS)));
    
    const lateralOffset = Settings.state.userSettings.jumpRunTrackOffset || 0;
    const forwardOffset = Settings.state.userSettings.jumpRunTrackForwardOffset || 0;
    
    const initialStartPoint = [anchorLat, anchorLng];
    const initialEndPoint = Utils.calculateNewCenter(initialStartPoint[0], initialStartPoint[1], trackLength, jumpRunTrackDirection);

    const shiftDistance = Math.sqrt(lateralOffset**2 + forwardOffset**2);
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
 * Berechnet die geographischen Koordinaten der Eckpunkte des Landemusters.
 * Startet am Landepunkt (DIP) und rechnet von dort aus rückwärts (Final, Base, Downwind),
 * um die Koordinaten für jeden Leg-Startpunkt zu ermitteln.
 * @param {number} lat - Die geographische Breite des Landepunkts (DIP).
 * @param {number} lng - Die geographische Länge des Landepunkts (DIP).
 * @param {object[]} interpolatedData - Die interpolierten Wetterdaten.
 * @returns {{downwindLat: number, downwindLng: number, downwindStart: number[], baseStart: number[], finalStart: number[], landingPoint: number[]}|null} Ein Objekt mit den Koordinaten der Eckpunkte oder null bei Fehler.
 */
export function calculateLandingPatternCoordsOLD(lat, lng, interpolatedData) {
    if (!interpolatedData || interpolatedData.length === 0 || !AppState.lastAltitude) return null;

    const CANOPY_SPEED_KT = parseInt(document.getElementById('canopySpeed').value) || 20;
    const DESCENT_RATE_MPS = parseFloat(document.getElementById('descentRate').value) || 3.5;
    const LEG_HEIGHT_FINAL = parseInt(document.getElementById('legHeightFinal').value) || 100;
    const LEG_HEIGHT_BASE = parseInt(document.getElementById('legHeightBase').value) || 200;
    const LEG_HEIGHT_DOWNWIND = parseInt(document.getElementById('legHeightDownwind').value) || 300;
    const baseHeight = Math.round(AppState.lastAltitude);

    const heights = interpolatedData.map(d => d.height);
    const uComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'kt', 'km/h') * Math.sin(d.dir * Math.PI / 180));
    const vComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'kt', 'km/h') * Math.cos(d.dir * Math.PI / 180));

    const landingDirectionSetting = document.querySelector('input[name="landingDirection"]:checked')?.value || 'LL';
    const customLandingDirInput = document.getElementById(landingDirectionSetting === 'LL' ? 'customLandingDirectionLL' : 'customLandingDirectionRR');
    const customLandingDir = customLandingDirInput ? parseInt(customLandingDirInput.value, 10) : NaN;
    let effectiveLandingWindDir = Number.isFinite(customLandingDir) ? customLandingDir : (Number.isFinite(AppState.landingWindDir) ? AppState.landingWindDir : interpolatedData[0]?.dir);

    if (!Number.isFinite(effectiveLandingWindDir)) return null;

    const calculateLegEndpoint = (startLat, startLng, bearing, groundSpeedKt, timeSec) => {
        const speedMps = groundSpeedKt * (1.852 / 3.6); // Knots to m/s
        const lengthMeters = speedMps * timeSec;
        return Utils.calculateNewCenter(startLat, startLng, lengthMeters, (bearing + 180) % 360);
    };

    // Final Leg
    const finalMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, baseHeight, baseHeight + LEG_HEIGHT_FINAL);
    const finalCourse = effectiveLandingWindDir;
    const { groundSpeed: finalGroundSpeedKt } = Utils.calculateFlightParameters(finalCourse, finalMeanWind[0], finalMeanWind[1], CANOPY_SPEED_KT);
    const finalStart = calculateLegEndpoint(lat, lng, finalCourse, finalGroundSpeedKt, LEG_HEIGHT_FINAL / DESCENT_RATE_MPS);

    // Base Leg
    const baseMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, baseHeight + LEG_HEIGHT_FINAL, baseHeight + LEG_HEIGHT_BASE);
    const baseHeading = (effectiveLandingWindDir + (landingDirectionSetting === 'LL' ? 90 : -90) + 360) % 360;
    const { trueCourse: baseCourse, groundSpeed: baseGroundSpeedKt } = Utils.calculateCourseFromHeading(baseHeading, baseMeanWind[0], baseMeanWind[1], CANOPY_SPEED_KT);
    const baseStart = calculateLegEndpoint(finalStart[0], finalStart[1], baseCourse, baseGroundSpeedKt, (LEG_HEIGHT_BASE - LEG_HEIGHT_FINAL) / DESCENT_RATE_MPS);

    // Downwind Leg
    const downwindMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, baseHeight + LEG_HEIGHT_BASE, baseHeight + LEG_HEIGHT_DOWNWIND);
    const downwindCourse = effectiveLandingWindDir;
    const { groundSpeed: downwindGroundSpeedKt } = Utils.calculateFlightParameters(downwindCourse, downwindMeanWind[0], downwindMeanWind[1], CANOPY_SPEED_KT);
    const downwindStart = calculateLegEndpoint(baseStart[0], baseStart[1], downwindCourse, downwindGroundSpeedKt, (LEG_HEIGHT_DOWNWIND - LEG_HEIGHT_BASE) / DESCENT_RATE_MPS);

    return {
        downwindLat: downwindStart[0],
        downwindLng: downwindStart[1],
        downwindStart: downwindStart,
        baseStart: baseStart,
        finalStart: finalStart,
        landingPoint: [lat, lng]
    };
}
// in src/core/jumpPlanner.js

export function calculateLandingPatternCoords(lat, lng, interpolatedData) {
    // Diese Funktion enthält jetzt die korrekte, erprobte Logik.
    if (!interpolatedData || interpolatedData.length === 0 || !AppState.lastAltitude) return null;

    const CANOPY_SPEED_KT = parseInt(document.getElementById('canopySpeed').value) || 20;
    const DESCENT_RATE_MPS = parseFloat(document.getElementById('descentRate').value) || 3.5;
    const LEG_HEIGHT_FINAL = parseInt(document.getElementById('legHeightFinal').value) || 100;
    const LEG_HEIGHT_BASE = parseInt(document.getElementById('legHeightBase').value) || 200;
    const LEG_HEIGHT_DOWNWIND = parseInt(document.getElementById('legHeightDownwind').value) || 300;
    const baseHeight = Math.round(AppState.lastAltitude);

    const heights = interpolatedData.map(d => d.height);
    const uComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'kt', 'km/h') * Math.sin(d.dir * Math.PI / 180));
    const vComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'kt', 'km/h') * Math.cos(d.dir * Math.PI / 180));

    const landingDirectionSetting = document.querySelector('input[name="landingDirection"]:checked')?.value || 'LL';
    const customLandingDirInput = document.getElementById(landingDirectionSetting === 'LL' ? 'customLandingDirectionLL' : 'customLandingDirectionRR');
    const customLandingDir = customLandingDirInput ? parseInt(customLandingDirInput.value, 10) : NaN;
    let effectiveLandingWindDir = Number.isFinite(customLandingDir) ? customLandingDir : (Number.isFinite(AppState.landingWindDir) ? AppState.landingWindDir : interpolatedData[0]?.dir);

    if (!Number.isFinite(effectiveLandingWindDir)) return null;

    const calculateLegEndpoint = (startLat, startLng, bearing, groundSpeedKt, timeSec) => {
        const speedMps = groundSpeedKt * (1.852 / 3.6); // Knots to m/s
        const lengthMeters = speedMps * timeSec;
        return Utils.calculateNewCenter(startLat, startLng, lengthMeters, bearing);
    };

    // Final Leg
    const finalMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, baseHeight + LEG_HEIGHT_FINAL, baseHeight + LEG_HEIGHT_BASE);
    const finalCourse = effectiveLandingWindDir;
    const { groundSpeed: finalGroundSpeedKt } = Utils.calculateFlightParameters(finalCourse, finalMeanWind[0], finalMeanWind[1], CANOPY_SPEED_KT);
    const finalStart = calculateLegEndpoint(lat, lng, (finalCourse + 180) % 360, finalGroundSpeedKt, LEG_HEIGHT_FINAL / DESCENT_RATE_MPS);

    // Base Leg
    const baseMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, baseHeight + LEG_HEIGHT_BASE, baseHeight + LEG_HEIGHT_DOWNWIND);
    const baseHeading = (effectiveLandingWindDir + (landingDirectionSetting === 'LL' ? 90 : -90) + 360) % 360;
    const { trueCourse: baseCourse, groundSpeed: baseGroundSpeedKt } = Utils.calculateCourseFromHeading(baseHeading, baseMeanWind[0], baseMeanWind[1], CANOPY_SPEED_KT);
    const baseStart = calculateLegEndpoint(finalStart[0], finalStart[1], (baseCourse + 180) % 360, baseGroundSpeedKt, (LEG_HEIGHT_BASE - LEG_HEIGHT_FINAL) / DESCENT_RATE_MPS);

    // Downwind Leg
    const downwindMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, baseHeight + LEG_HEIGHT_DOWNWIND, baseHeight + LEG_HEIGHT_DOWNWIND + 100); // 100m layer for downwind
    const downwindCourse = (effectiveLandingWindDir + 180) % 360;
    const { groundSpeed: downwindGroundSpeedKt } = Utils.calculateFlightParameters(downwindCourse, downwindMeanWind[0], downwindMeanWind[1], CANOPY_SPEED_KT);
    const downwindStart = calculateLegEndpoint(baseStart[0], baseStart[1], (downwindCourse + 180) % 360, downwindGroundSpeedKt, (LEG_HEIGHT_DOWNWIND - LEG_HEIGHT_BASE) / DESCENT_RATE_MPS);

    return {
        downwindStart: downwindStart,
        baseStart: baseStart,
        finalStart: finalStart,
        landingPoint: [lat, lng]
    };
}