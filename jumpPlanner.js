// jumpPlanner.js
import { AppState } from './state.js';
import { Settings } from './settings.js';
import { Utils } from './utils.js';
import { Constants, CONVERSIONS, FREEFALL_PHYSICS, ISA_CONSTANTS, CANOPY_OPENING_BUFFER_METERS, CUTAWAY_VERTICAL_SPEEDS_MPS } from './constants.js';

export function getSeparationFromTAS(ias) {
    const exitAltitudeFt = Settings.state.userSettings.exitAltitude * CONVERSIONS.METERS_TO_FEET;
    const tas = Utils.calculateTAS(ias, exitAltitudeFt);
    if (tas === 'N/A') {
        console.warn('TAS calculation failed, using default separation');
        return Settings.defaultSettings.jumperSeparation;
    }
    const speeds = Object.keys(Constants.jumperSeparationTable).map(Number).sort((a, b) => b - a);
    let closestSpeed = speeds[0];
    for (const speed of speeds) {
        if (tas <= speed) closestSpeed = speed;
        else break;
    }
    const separation = Constants.jumperSeparationTable[closestSpeed] || 7;
    return separation;
}

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
        const windDir = Utils.LIP(heights, windDirs, current.height);
        const windSpd = Utils.LIP(heights, windSpdsMps, current.height);
        const tempC = Utils.LIP(heights, tempsC, current.height);
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

export function calculateExitCircle(interpolatedData) {
    if (!Settings.state.userSettings.showExitArea || !Settings.state.userSettings.calculateJump || !AppState.weatherData || !AppState.lastLat || !AppState.lastLng) return null;
    if (!interpolatedData || interpolatedData.length === 0) return null;

    const exitAltitude = parseInt(document.getElementById('exitAltitude')?.value) || 3000;
    const openingAltitude = parseInt(document.getElementById('openingAltitude')?.value) || 1200;
    const legHeightDownwind = parseInt(document.getElementById('legHeightDownwind')?.value) || 300;
    const descentRate = parseFloat(document.getElementById('descentRate')?.value) || 3.5;
    const canopySpeedMps = (parseFloat(document.getElementById('canopySpeed')?.value) || 20) * CONVERSIONS.KNOTS_TO_MPS;

    const heights = interpolatedData.map(d => d.height);
    const uComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'm/s', 'km/h') * Math.sin(d.dir * Math.PI / 180));
    const vComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'm/s', 'km/h') * Math.cos(d.dir * Math.PI / 180));
    const elevation = Math.round(AppState.lastAltitude);
    
    const flyTime = (openingAltitude - CANOPY_OPENING_BUFFER_METERS - legHeightDownwind) / descentRate;
    const horizontalCanopyDistance = flyTime * canopySpeedMps;
    const flyTimeFull = (openingAltitude - CANOPY_OPENING_BUFFER_METERS) / descentRate;
    const horizontalCanopyDistanceFull = flyTimeFull * canopySpeedMps;

    const meanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, elevation + legHeightDownwind, elevation + openingAltitude - CANOPY_OPENING_BUFFER_METERS);
    const meanWindFull = Utils.calculateMeanWind(heights, uComponents, vComponents, elevation, elevation + openingAltitude - CANOPY_OPENING_BUFFER_METERS);

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
        greenLat: greenCenter[0], greenLng: greenCenter[1], darkGreenLat: darkGreenCenter[0], darkGreenLng: darkGreenCenter[1],
        greenRadius: horizontalCanopyDistanceFull, darkGreenRadius: horizontalCanopyDistance,
        freeFallDirection: freeFallResult.directionDeg, freeFallDistance: freeFallResult.distance, freeFallTime: freeFallResult.time
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
    
    return { center: [centerLat, centerLng], radius: 150, tooltipContent };
}

export function calculateCanopyCircles(interpolatedData) {
    if (!Settings.state.userSettings.showCanopyArea || !Settings.state.userSettings.calculateJump || !AppState.weatherData || !AppState.lastLat || !AppState.lastLng) return null;
    if (!interpolatedData || interpolatedData.length === 0) return null;

    const exitAltitude = parseInt(document.getElementById('exitAltitude')?.value) || 3000;
    const openingAltitude = parseInt(document.getElementById('openingAltitude')?.value) || 1200;
    const legHeightDownwind = parseInt(document.getElementById('legHeightDownwind')?.value) || 300;
    const descentRate = parseFloat(document.getElementById('descentRate')?.value) || 3.5;
    const canopySpeedMps = (parseFloat(document.getElementById('canopySpeed')?.value) || 20) * CONVERSIONS.KNOTS_TO_MPS;

    const heights = interpolatedData.map(d => d.height);
    const uComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'm/s', 'km/h') * Math.sin(d.dir * Math.PI / 180));
    const vComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'm/s', 'km/h') * Math.cos(d.dir * Math.PI / 180));
    const elevation = Math.round(AppState.lastAltitude);
    
    const flyTime = (openingAltitude - CANOPY_OPENING_BUFFER_METERS - legHeightDownwind) / descentRate;
    const horizontalCanopyDistance = flyTime * canopySpeedMps;
    const flyTimeFull = (openingAltitude - CANOPY_OPENING_BUFFER_METERS) / descentRate;
    const horizontalCanopyDistanceFull = flyTimeFull * canopySpeedMps;

    const meanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, elevation + legHeightDownwind, elevation + openingAltitude - CANOPY_OPENING_BUFFER_METERS);
    const meanWindFull = Utils.calculateMeanWind(heights, uComponents, vComponents, elevation, elevation + openingAltitude - CANOPY_OPENING_BUFFER_METERS);
    
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
            additionalBlueRadii.push(currentRadius);
            additionalBlueDisplacements.push(currentMeanWind[1] * currentFlyTime);
            additionalBlueDirections.push(currentMeanWind[0]);
            additionalBlueUpperLimits.push(currentUpper - elevation);
        }
    }

    return {
        blueLat, blueLng, redLat: AppState.lastLat, redLng: AppState.lastLng,
        radius: horizontalCanopyDistance, radiusFull: horizontalCanopyDistanceFull,
        additionalBlueRadii, additionalBlueDisplacements, additionalBlueDirections, additionalBlueUpperLimits,
        displacement: meanWind[1] * flyTime, direction: meanWind[0],
        displacementFull: meanWindFull[1] * flyTimeFull, directionFull: meanWindFull[0],
        meanWindForFullCanopyDir: meanWindFull[0], meanWindForFullCanopySpeedMps: meanWindFull[1],
        freeFallDirection: freeFallResult.directionDeg, freeFallDistance: freeFallResult.distance, freeFallTime: freeFallResult.time
    };
}

export function jumpRunTrack(interpolatedData) {
    if (!AppState.weatherData || !AppState.lastLat || !AppState.lastLng || AppState.lastAltitude === 'N/A' || !interpolatedData || interpolatedData.length === 0) {
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
    if (Number.isFinite(customDirection) && customDirection >= 0 && customDirection <= 359) {
        jumpRunTrackDirection = customDirection;
    }
    
    const exitAltitude = parseInt(document.getElementById('exitAltitude')?.value) || 3000;
    const exitHeightM = elevation + exitAltitude;
    const tasKt = Utils.calculateTAS(Settings.state.userSettings.aircraftSpeedKt || 90, exitHeightM / 0.3048);
    let groundSpeedMps = null, trackLength = 2000, approachLength = 2000, approachLatLngs = null;
    
    if(tasKt !== 'N/A' && Number.isFinite(tasKt)) {
        const windDirAtExit = Utils.LIP(heights.map(h => h - elevation), interpolatedData.map(d => d.dir), exitAltitude);
        const windSpeedMpsAtExit = Utils.LIP(heights.map(h => h - elevation), interpolatedData.map(d => Utils.convertWind(d.spd, 'm/s', 'km/h')), exitAltitude);
        const tasMps = tasKt * CONVERSIONS.KNOTS_TO_MPS;
        const windToRad = (windDirAtExit + 180) * Math.PI / 180;
        const windU = windSpeedMpsAtExit * Math.sin(windToRad);
        const windV = windSpeedMpsAtExit * Math.cos(windToRad);
        const headingRad = jumpRunTrackDirection * Math.PI / 180;
        const tasU = tasMps * Math.sin(headingRad);
        const tasV = tasMps * Math.cos(headingRad);
        groundSpeedMps = Math.sqrt(Math.pow(tasU + windU, 2) + Math.pow(tasV + windV, 2));

        trackLength = Math.max(100, Math.min(10000, Math.round((Settings.state.userSettings.numberOfJumpers || 10) * (Settings.state.userSettings.jumperSeparation || 5) * groundSpeedMps)));
        approachLength = Math.max(100, Math.min(20000, Math.round(groundSpeedMps * 120)));
    }
    
    const lateralOffset = Settings.state.userSettings.jumpRunTrackOffset || 0;
    const forwardOffset = Settings.state.userSettings.jumpRunTrackForwardOffset || 0;
    
    // KORREKTUR: Verwende die saubere Vektormethode zur Berechnung des Mittelpunkts
    const bearingToCenter = (Math.atan2(lateralOffset, forwardOffset) * 180 / Math.PI + 360) % 360;
    const distanceFromCenter = Math.sqrt(lateralOffset**2 + forwardOffset**2);
    const finalBearing = (jumpRunTrackDirection + bearingToCenter + 360) % 360;
    const [centerLat, centerLng] = Utils.calculateNewCenter(AppState.lastLat, AppState.lastLng, distanceFromCenter, finalBearing);
    
    const halfLength = trackLength / 2;
    const startPoint = Utils.calculateNewCenter(centerLat, centerLng, halfLength, (jumpRunTrackDirection + 180) % 360);
    const endPoint = Utils.calculateNewCenter(centerLat, centerLng, halfLength, jumpRunTrackDirection);
    
    if(groundSpeedMps){
        const approachStartPoint = Utils.calculateNewCenter(startPoint[0], startPoint[1], approachLength, (jumpRunTrackDirection + 180) % 360);
        approachLatLngs = [startPoint, approachStartPoint];
    }

    return {
        direction: jumpRunTrackDirection, trackLength, meanWindDirection: meanWind[0], meanWindSpeed: meanWind[1],
        latlngs: [startPoint, endPoint], approachLatLngs, approachLength, approachTime: 120
    };
}

export function calculateLandingPatternCoords(lat, lng, interpolatedData) {
    if (!interpolatedData || interpolatedData.length === 0) return { downwindLat: lat, downwindLng: lng };
    
    const CANOPY_SPEED_KT = parseInt(document.getElementById('canopySpeed').value) || 20;
    const DESCENT_RATE_MPS = parseFloat(document.getElementById('descentRate').value) || 3.5;
    const LEG_HEIGHT_FINAL = parseInt(document.getElementById('legHeightFinal').value) || 100;
    const LEG_HEIGHT_BASE = parseInt(document.getElementById('legHeightBase').value) || 200;
    const LEG_HEIGHT_DOWNWIND = parseInt(document.getElementById('legHeightDownwind').value) || 300;
    const baseHeight = Math.round(AppState.lastAltitude);
    
    const heights = interpolatedData.map(d => d.height);
    const uComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'kt', 'km/h') * Math.sin(d.dir * Math.PI / 180));
    const vComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'kt', 'km/h') * Math.cos(d.dir * Math.PI / 180));
    
    const landingDirection = document.querySelector('input[name="landingDirection"]:checked')?.value || 'LL';
    const customLandingDir = parseInt(document.getElementById(landingDirection === 'LL' ? 'customLandingDirectionLL' : 'customLandingDirectionRR')?.value, 10);
    let effectiveLandingWindDir = Number.isFinite(customLandingDir) ? customLandingDir : (Number.isFinite(AppState.landingWindDir) ? AppState.landingWindDir : interpolatedData[0].dir);
    
    const calculateLegEndpoint = (startLat, startLng, bearing, groundSpeedKt, timeSec) => {
        const speedMps = groundSpeedKt * CONVERSIONS.KNOTS_TO_MPS;
        const lengthMeters = speedMps * timeSec;
        const [endLat, endLng] = Utils.calculateNewCenter(startLat, startLng, lengthMeters, bearing);
        return [endLat, endLng];
    };
    
    const finalMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, baseHeight, baseHeight + LEG_HEIGHT_FINAL);
    const finalCourse = (effectiveLandingWindDir + 180) % 360;
    const finalGroundSpeedKt = Utils.calculateGroundSpeed(CANOPY_SPEED_KT, Utils.calculateWindComponents(finalMeanWind[1], Utils.calculateWindAngle(finalCourse, finalMeanWind[0])).headwind);
    const finalEnd = calculateLegEndpoint(lat, lng, finalCourse, finalGroundSpeedKt, LEG_HEIGHT_FINAL / DESCENT_RATE_MPS);
    
    const baseMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, baseHeight + LEG_HEIGHT_FINAL, baseHeight + LEG_HEIGHT_BASE);
    const baseHeading = (effectiveLandingWindDir + (landingDirection === 'LL' ? 90 : -90) + 360) % 360;
    const baseCourseObj = Utils.calculateCourseFromHeading(baseHeading, baseMeanWind[0], baseMeanWind[1], CANOPY_SPEED_KT);
    const baseEnd = calculateLegEndpoint(finalEnd[0], finalEnd[1], (baseCourseObj.trueCourse + 180) % 360, baseCourseObj.groundSpeed, (LEG_HEIGHT_BASE - LEG_HEIGHT_FINAL) / DESCENT_RATE_MPS);
    
    const downwindMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, baseHeight + LEG_HEIGHT_BASE, baseHeight + LEG_HEIGHT_DOWNWIND);
    const downwindGroundSpeedKt = Utils.calculateGroundSpeed(CANOPY_SPEED_KT, Utils.calculateWindComponents(downwindMeanWind[1], Utils.calculateWindAngle(effectiveLandingWindDir, downwindMeanWind[0])).headwind);
    const downwindEnd = calculateLegEndpoint(baseEnd[0], baseEnd[1], effectiveLandingWindDir, downwindGroundSpeedKt, (LEG_HEIGHT_DOWNWIND - LEG_HEIGHT_BASE) / DESCENT_RATE_MPS);
    
    return { downwindLat: downwindEnd[0], downwindLng: downwindEnd[1] };
}