// jumpPlanner.js
import { AppState } from './state.js';
import { Settings } from './settings.js';
import { Utils } from './utils.js';
import { Constants } from './constants.js';

export function getSeparationFromTAS(ias) {
    // ... (Dieser Teil war korrekt und bleibt unverändert)
    const exitAltitudeFt = Settings.state.userSettings.exitAltitude * 3.28084;
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

// KORREKTUR 1: Die Signatur wurde angepasst, aber der interne Aufruf von jumpRunTrack war noch fehlerhaft
export function calculateFreeFall(weatherData, exitAltitude, openingAltitude, interpolatedData, startLat, startLng, elevation) {
    console.log('Starting calculateFreeFall...', { exitAltitude, openingAltitude });

    if (!AppState.weatherData || !AppState.weatherData.time) { // Vereinfachte Prüfung
        console.warn('Invalid weather data provided');
        return null;
    }
    if (!Number.isFinite(startLat) || !Number.isFinite(startLng) || !Number.isFinite(elevation)) {
        console.warn('Invalid coordinates or elevation');
        return null;
    }

    // ... (Code für Konstanten)

    const hStart = elevation + exitAltitude;
    const hStop = elevation + openingAltitude - 200;
    
    // KORREKTUR: jumpRunTrack die interpolierten Daten übergeben
    const jumpRunData = jumpRunTrack(interpolatedData); 
    const jumpRunDirection = jumpRunData ? jumpRunData.direction : 0;
    const aircraftSpeedKt = Settings.state.userSettings.aircraftSpeedKt;
    const exitAltitudeFt = exitAltitude / 0.3048;

    // ... (Restlicher Code für calculateFreeFall bleibt gleich)
    // ... Wichtig ist, dass der Aufruf oben korrigiert wurde.
    const aircraftSpeedTAS = Utils.calculateTAS(aircraftSpeedKt, exitAltitudeFt);
    let aircraftSpeedMps;
    if (aircraftSpeedTAS === 'N/A') {
        aircraftSpeedMps = aircraftSpeedKt * 0.514444;
    } else {
        aircraftSpeedMps = aircraftSpeedTAS * 0.514444;
    }
    const vxInitial = Math.cos((jumpRunDirection) * Math.PI / 180) * aircraftSpeedMps;
    const vyInitial = Math.sin((jumpRunDirection) * Math.PI / 180) * aircraftSpeedMps;

    if (!interpolatedData || interpolatedData.length === 0) {
        console.warn('No interpolated weather data provided to calculateFreeFall');
        return null;
    }

    const heights = interpolatedData.map(d => d.height);
    const windDirs = interpolatedData.map(d => Number.isFinite(d.dir) ? parseFloat(d.dir) : 0);
    const windSpdsMps = interpolatedData.map(d => Utils.convertWind(parseFloat(d.spd) || 0, 'm/s', 'km/h'));
    const tempsC = interpolatedData.map(d => d.temp);
    
    // Annahme: sliderIndex ist für diesen Teil nicht mehr relevant oder muss anders beschafft werden,
    // wenn es um spezifische Zeitpunkte geht. Für die Berechnung selbst wird es nicht mehr gebraucht.
    const sliderIndex = 0; // Fallback, falls doch irgendwo benötigt. Besser wäre, dies auch zu entfernen.
    const surfacePressure = AppState.weatherData.surface_pressure[sliderIndex] || 1013.25;

    // ... Rest der Funktion ...
    const trajectory = [{
        time: 0,
        height: hStart,
        vz: 0,
        vxGround: vxInitial,
        vyGround: vyInitial,
        x: 0,
        y: 0
    }];

    let current = trajectory[0];
    while (current.height > hStop) {
        const windDir = Utils.LIP(heights, windDirs, current.height);
        const windSpd = Utils.LIP(heights, windSpdsMps, current.height);
        const tempC = Utils.LIP(heights, tempsC, current.height);
        const tempK = tempC + 273.15;
        const Rl = 287.102;
        const g = 9.81;
        const rho = (surfacePressure * 100 * Math.exp(-g * (current.height - elevation) / (Rl * tempK))) / (Rl * tempK);

        const windDirTo = (windDir + 180) % 360;
        const vxWind = windSpd * Math.cos(windDirTo * Math.PI / 180);
        const vyWind = windSpd * Math.sin(windDirTo * Math.PI / 180);

        const vxAir = current.vxGround - vxWind;
        const vyAir = current.vyGround - vyWind;
        const vAirMag = Math.sqrt(vxAir * vxAir + vyAir * vyAir);

        const cdVertical = 1, areaVertical = 0.5, mass = 80, cdHorizontal = 1, areaHorizontal = 0.5, dt = 0.5;
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
            time: nextTime,
            height: nextHeight,
            vz: nextVz,
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
    const directionRad = Math.atan2(final.y, final.x);
    let directionDeg = directionRad * 180 / Math.PI;
    directionDeg = (directionDeg + 360) % 360;

    return {
        time: final.time,
        height: final.height,
        vz: final.vz,
        xDisplacement: final.x,
        yDisplacement: final.y,
        path: trajectory.map(point => ({
            latLng: Utils.calculateNewCenter(startLat, startLng, Math.sqrt(point.x * point.x + point.y * point.y), Math.atan2(point.y, point.x) * 180 / Math.PI),
            height: point.height,
            time: point.time
        })),
        directionDeg: directionDeg,
        distance: distance
    };
}


// KORREKTUR 2: Ganze Funktion `calculateExitCircle` anpassen
export function calculateExitCircle(interpolatedData) {
    if (!Settings.state.userSettings.showExitArea || !Settings.state.userSettings.calculateJump || !AppState.weatherData || !AppState.lastLat || !AppState.lastLng) {
        return null;
    }
    
    if (!interpolatedData || interpolatedData.length === 0) {
        console.warn('No interpolated weather data for exit circle');
        return null;
    }

    const exitAltitude = parseInt(document.getElementById('exitAltitude')?.value) || 3000;
    const openingAltitude = parseInt(document.getElementById('openingAltitude')?.value) || 1200;
    const legHeightDownwind = parseInt(document.getElementById('legHeightDownwind')?.value) || 300;
    const descentRate = parseFloat(document.getElementById('descentRate')?.value) || 3.5;
    const canopySpeed = parseFloat(document.getElementById('canopySpeed')?.value) || 20;

    const heights = interpolatedData.map(d => d.height);
    const dirs = interpolatedData.map(d => Number.isFinite(d.dir) ? parseFloat(d.dir) : 0);
    const spdsMps = interpolatedData.map(d => Utils.convertWind(parseFloat(d.spd) || 0, 'm/s', 'km/h'));
    const uComponents = spdsMps.map((spd, i) => -spd * Math.sin(dirs[i] * Math.PI / 180));
    const vComponents = spdsMps.map((spd, i) => -spd * Math.cos(dirs[i] * Math.PI / 180));

    const canopySpeedMps = canopySpeed * 0.514444;
    const heightDistance = openingAltitude - 200 - legHeightDownwind;
    const flyTime = heightDistance / descentRate;
    const horizontalCanopyDistance = flyTime * canopySpeedMps;
    const heightDistanceFull = openingAltitude - 200;
    const flyTimeFull = heightDistanceFull / descentRate;
    const horizontalCanopyDistanceFull = flyTimeFull * canopySpeedMps;

    const elevation = Math.round(AppState.lastAltitude);
    const upperLimit = elevation + openingAltitude - 200;
    const lowerLimit = elevation + legHeightDownwind;
    const meanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, lowerLimit, upperLimit);
    const meanWindDirection = meanWind[0];
    const meanWindSpeedMps = meanWind[1];
    const meanWindFull = Utils.calculateMeanWind(heights, uComponents, vComponents, elevation, elevation + openingAltitude - 200);
    const meanWindDirectionFull = meanWindFull[0];
    const meanWindSpeedMpsFull = meanWindFull[1];

    const centerDisplacement = meanWindSpeedMps * flyTime;
    const centerDisplacementFull = meanWindSpeedMpsFull * flyTimeFull;
    const displacementDirection = meanWindDirection;
    const displacementDirectionFull = meanWindDirectionFull;

    const landingPatternCoords = calculateLandingPatternCoords(AppState.lastLat, AppState.lastLng, interpolatedData);
    let blueLat = landingPatternCoords.downwindLat;
    let blueLng = landingPatternCoords.downwindLng;
    if (!Number.isFinite(blueLat) || !Number.isFinite(blueLng)) {
        blueLat = AppState.lastLat;
        blueLng = AppState.lastLng;
    }
    const redLat = AppState.lastLat;
    const redLng = AppState.lastLng;

    const newCenterBlue = Utils.calculateNewCenter(blueLat, blueLng, centerDisplacement, displacementDirection);
    const newCenterRed = Utils.calculateNewCenter(redLat, redLng, centerDisplacementFull, displacementDirectionFull);

    const freeFallResult = calculateFreeFall(AppState.weatherData, exitAltitude, openingAltitude, interpolatedData, AppState.lastLat, AppState.lastLng, AppState.lastAltitude);
    if (!freeFallResult) {
        console.warn('Free fall calculation failed for exit circle');
        return null;
    }

    const greenShiftDirection = (freeFallResult.directionDeg + 180) % 360;
    const greenCenter = Utils.calculateNewCenter(newCenterRed[0], newCenterRed[1], freeFallResult.distance, greenShiftDirection);
    const darkGreenCenter = Utils.calculateNewCenter(newCenterBlue[0], newCenterBlue[1], freeFallResult.distance, greenShiftDirection);

    return {
        greenLat: greenCenter[0],
        greenLng: greenCenter[1],
        darkGreenLat: darkGreenCenter[0],
        darkGreenLng: darkGreenCenter[1],
        greenRadius: horizontalCanopyDistanceFull,
        darkGreenRadius: horizontalCanopyDistance,
        freeFallDirection: freeFallResult.directionDeg,
        freeFallDistance: freeFallResult.distance,
        freeFallTime: freeFallResult.time
    };
}


// KORREKTUR 3: Alle weiteren Funktionen anpassen...

export function calculateCutAway(interpolatedData) {
    if (!AppState.map) {
        return;
    }
    if (AppState.cutAwayLat === null || AppState.cutAwayLng === null) {
        return;
    }
    if (!AppState.weatherData || AppState.lastAltitude === 'N/A' || !Settings.state.userSettings.cutAwayAltitude) {
        return;
    }
    if (!interpolatedData || !Array.isArray(interpolatedData) || interpolatedData.length === 0) {
        return;
    }

    // ... (Rest der Funktion bleibt gleich, da sie `interpolatedData` schon als Parameter hatte)
    const elevation = Math.round(AppState.lastAltitude);
    const lowerLimit = elevation;
    const upperLimit = elevation + Settings.state.userSettings.cutAwayAltitude;

    const heights = interpolatedData.map(d => d.height);
    const dirs = interpolatedData.map(d => Number.isFinite(d.dir) ? parseFloat(d.dir) : 0);
    const spdsMps = interpolatedData.map(d => Utils.convertWind(parseFloat(d.spd) || 0, 'm/s', 'km/h'));
    const uComponents = spdsMps.map((spd, i) => -spd * Math.sin(dirs[i] * Math.PI / 180));
    const vComponents = spdsMps.map((spd, i) => -spd * Math.cos(dirs[i] * Math.PI / 180));

    const meanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, lowerLimit, upperLimit);
    if (!meanWind) return null;

    const meanWindDirection = meanWind[0];
    const meanWindSpeedMps = meanWind[1];
    
    // ... Rest der Logik für Cutaway ...
    const cutAwayAltitude = Settings.state.userSettings.cutAwayAltitude;
    const verticalSpeedMax = Math.sqrt((2 * 9.81 * 5) / (1.2 * 13 * 2.6));
    const verticalSpeedMean = Math.sqrt((2 * 9.81 * 5) / (1.2 * 2 * 1.5));
    const verticalSpeedMin = Math.sqrt((2 * 9.81 * 5) / (1.2 * 0.1 * 1));
    const radius = 150;
    const heightDifference = cutAwayAltitude;
    const descentTimeMin = heightDifference / verticalSpeedMin;
    const descentTimeMean = heightDifference / verticalSpeedMean;
    const descentTimeMax = heightDifference / verticalSpeedMax;
    const displacementDistanceMin = meanWindSpeedMps * descentTimeMin;
    const displacementDistanceMean = meanWindSpeedMps * descentTimeMean;
    const displacementDistanceMax = meanWindSpeedMps * descentTimeMax;
    const adjustedWindDirection = ((meanWindDirection + 180) % 360);
    const [newLatMin, newLngMin] = Utils.calculateNewCenter(AppState.cutAwayLat, AppState.cutAwayLng, displacementDistanceMin, adjustedWindDirection);
    const [newLatMean, newLngMean] = Utils.calculateNewCenter(AppState.cutAwayLat, AppState.cutAwayLng, displacementDistanceMean, adjustedWindDirection);
    const [newLatMax, newLngMax] = Utils.calculateNewCenter(AppState.cutAwayLat, AppState.cutAwayLng, displacementDistanceMax, adjustedWindDirection);

    let center, tooltipContent;
    if (Settings.state.userSettings.showCutAwayFinder && Settings.state.userSettings.calculateJump) {
        let descentTime, displacementDistance, stateLabel, verticalSpeedSelected;
        switch (Settings.state.userSettings.cutAwayState) {
            case 'Partially':
                center = [newLatMean, newLngMean];
                descentTime = descentTimeMean;
                displacementDistance = displacementDistanceMean;
                verticalSpeedSelected = verticalSpeedMean.toFixed(1);
                stateLabel = 'Partially Collapsed';
                break;
            case 'Collapsed':
                center = [newLatMin, newLngMin];
                descentTime = descentTimeMin;
                displacementDistance = displacementDistanceMin;
                verticalSpeedSelected = verticalSpeedMin.toFixed(1);
                stateLabel = 'Fully Collapsed';
                break;
            case 'Open':
                center = [newLatMax, newLngMax];
                descentTime = descentTimeMax;
                displacementDistance = displacementDistanceMax;
                verticalSpeedSelected = verticalSpeedMax.toFixed(1);
                stateLabel = 'Fully Open';
                break;
            default: return null;
        }
        tooltipContent = `<b>Cut-Away (${stateLabel})</b><br>Cut-Away Altitude: ${cutAwayAltitude} m<br>Displacement: ${meanWindDirection.toFixed(0)}°, ${displacementDistance.toFixed(0)} m<br>Descent Time/Speed: ${descentTime.toFixed(0)} s at ${verticalSpeedSelected} m/s<br>`;
        return { center, radius, tooltipContent };
    }
    return null;
}

export function calculateCanopyCircles(interpolatedData) {
    if (!Settings.state.userSettings.showCanopyArea || !Settings.state.userSettings.calculateJump || !AppState.weatherData || !AppState.lastLat || !AppState.lastLng) {
        return null;
    }
    if (!interpolatedData || interpolatedData.length === 0) {
        return null;
    }
    
    // ... (Auch hier bleibt der Rest der Funktion gleich)
    const exitAltitude = parseInt(document.getElementById('exitAltitude')?.value) || 3000;
    const openingAltitude = parseInt(document.getElementById('openingAltitude')?.value) || 1200;
    const legHeightDownwind = parseInt(document.getElementById('legHeightDownwind')?.value) || 300;
    const descentRate = parseFloat(document.getElementById('descentRate')?.value) || 3.5;
    const canopySpeed = parseFloat(document.getElementById('canopySpeed')?.value) || 20;

    const heights = interpolatedData.map(d => d.height);
    const dirs = interpolatedData.map(d => Number.isFinite(d.dir) ? parseFloat(d.dir) : 0);
    const spdsMps = interpolatedData.map(d => Utils.convertWind(parseFloat(d.spd) || 0, 'm/s', 'km/h'));
    const uComponents = spdsMps.map((spd, i) => -spd * Math.sin(dirs[i] * Math.PI / 180));
    const vComponents = spdsMps.map((spd, i) => -spd * Math.cos(dirs[i] * Math.PI / 180));

    // ... Rest der Logik für CanopyCircles ...
    const canopySpeedMps = canopySpeed * 0.514444;
    const heightDistance = openingAltitude - 200 - legHeightDownwind;
    const flyTime = heightDistance / descentRate;
    const horizontalCanopyDistance = flyTime * canopySpeedMps;
    const heightDistanceFull = openingAltitude - 200;
    const flyTimeFull = heightDistanceFull / descentRate;
    const horizontalCanopyDistanceFull = flyTimeFull * canopySpeedMps;
    const elevation = Math.round(AppState.lastAltitude);
    const upperLimit = elevation + openingAltitude - 200;
    const lowerLimit = elevation + legHeightDownwind;

    const freeFallResult = calculateFreeFall(AppState.weatherData, exitAltitude, openingAltitude, interpolatedData, AppState.lastLat, AppState.lastLng, AppState.lastAltitude);
    if (!freeFallResult) return null;
    
    const meanWindFull = Utils.calculateMeanWind(heights, uComponents, vComponents, elevation, upperLimit);
    const meanWindDirectionFull = meanWindFull[0];
    const meanWindSpeedMpsFull = meanWindFull[1];

    const landingPatternCoords = calculateLandingPatternCoords(AppState.lastLat, AppState.lastLng, interpolatedData);
    let blueLat = landingPatternCoords.downwindLat, blueLng = landingPatternCoords.downwindLng;
    if (!Number.isFinite(blueLat)) { blueLat = AppState.lastLat; blueLng = AppState.lastLng; }
    
    // ... Rest der Berechnungen ...
    const additionalBlueRadii = [];
    const additionalBlueDisplacements = [];
    const additionalBlueDirections = [];
    const additionalBlueUpperLimits = [];
    let decrement = 500;
    if ((upperLimit - lowerLimit) <= 1000) decrement = 200;
    let currentUpper = upperLimit;
    while (currentUpper >= lowerLimit + 200) {
        const currentHeightDistance = currentUpper - lowerLimit;
        const currentFlyTime = currentHeightDistance / descentRate;
        const currentRadius = currentFlyTime * canopySpeedMps;
        if (currentRadius > 0) {
            const meanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, lowerLimit, currentUpper);
            additionalBlueRadii.push(currentRadius);
            additionalBlueDisplacements.push(meanWind[1] * currentFlyTime);
            additionalBlueDirections.push(meanWind[0]);
            additionalBlueUpperLimits.push(currentUpper - elevation);
        }
        currentUpper -= decrement;
    }
    
    return {
        blueLat: blueLat,
        blueLng: blueLng,
        redLat: AppState.lastLat,
        redLng: AppState.lastLng,
        radius: horizontalCanopyDistance,
        radiusFull: horizontalCanopyDistanceFull,
        additionalBlueRadii,
        additionalBlueDisplacements,
        additionalBlueDirections,
        additionalBlueUpperLimits,
        displacement: 0, // Wird in der aufrufenden Funktion berechnet
        displacementFull: 0, // Wird in der aufrufenden Funktion berechnet
        direction: 0, // dito
        directionFull: 0, // dito
        meanWindForFullCanopyDir: meanWindDirectionFull,
        meanWindForFullCanopySpeedMps: meanWindSpeedMpsFull,
        freeFallDirection: freeFallResult.directionDeg,
        freeFallDistance: freeFallResult.distance,
        freeFallTime: freeFallResult.time
    };
}


export function jumpRunTrack(interpolatedData) {
    if (!AppState.weatherData || !AppState.lastLat || !AppState.lastLng || AppState.lastAltitude === null || AppState.lastAltitude === 'N/A') {
        return null;
    }
    if (!interpolatedData || interpolatedData.length === 0) {
        return null;
    }

    const openingAltitude = parseInt(document.getElementById('openingAltitude')?.value) || Settings.state.userSettings.openingAltitude || 1000;
    const elevation = Math.round(AppState.lastAltitude);
    const lowerLimit = elevation;
    const upperLimit = elevation + openingAltitude;

    const heights = interpolatedData.map(d => d.height);
    const dirs = interpolatedData.map(d => Number.isFinite(d.dir) ? parseFloat(d.dir) : 0);
    const spdsMps = interpolatedData.map(d => Utils.convertWind(parseFloat(d.spd) || 0, 'm/s', 'km/h'));
    const uComponents = spdsMps.map((spd, i) => -spd * Math.sin(dirs[i] * Math.PI / 180));
    const vComponents = spdsMps.map((spd, i) => -spd * Math.cos(dirs[i] * Math.PI / 180));

    const meanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, lowerLimit, upperLimit);
    if(!meanWind) return null;
    
    // ... (Rest der Funktion bleibt gleich)
    const meanWindDirection = meanWind[0];
    let jumpRunTrackDirection = Math.round(meanWindDirection);
    const customDirection = parseFloat(Settings.state.userSettings.customJumpRunDirection);
    if (Number.isFinite(customDirection) && customDirection >= 0 && customDirection <= 359) {
        jumpRunTrackDirection = customDirection;
    }

    // ... Rest der Logik für jumpRunTrack ...
    const exitAltitude = parseInt(document.getElementById('exitAltitude')?.value) || 3000;
    const exitHeightM = elevation + exitAltitude;
    const exitHeightFt = exitHeightM / 0.3048;
    const iasKt = Settings.state.userSettings.aircraftSpeedKt || 90;
    const tasKt = Utils.calculateTAS(iasKt, exitHeightFt);
    let trackLength = 2000, approachLength = 2000, groundSpeedMps = null, approachLatLngs = null;
    
    if(tasKt !== 'N/A' && Number.isFinite(tasKt)) {
        const windDirAtExit = Utils.LIP(heights, dirs, exitHeightM);
        const windSpeedMpsAtExit = Utils.LIP(heights, spdsMps, exitHeightM);
        const tasMps = tasKt * 0.514444;
        const trackRad = (jumpRunTrackDirection * Math.PI) / 180;
        const tasVx = tasMps * Math.cos(trackRad);
        const tasVy = tasMps * Math.sin(trackRad);
        const windDirToRad = ((windDirAtExit + 180) % 360) * Math.PI / 180;
        const windVx = windSpeedMpsAtExit * Math.cos(windDirToRad);
        const windVy = windSpeedMpsAtExit * Math.sin(windDirToRad);
        const groundVx = tasVx + windVx;
        const groundVy = tasVy + windVy;
        groundSpeedMps = Math.sqrt(groundVx * groundVx + groundVy * groundVy);
        
        const numberOfJumpers = parseInt(Settings.state.userSettings.numberOfJumpers) || 10;
        const jumperSeparation = parseFloat(Settings.state.userSettings.jumperSeparation) || 5;
        trackLength = Math.max(100, Math.min(10000, Math.round(numberOfJumpers * jumperSeparation * groundSpeedMps)));
        
        const approachTime = 120;
        approachLength = Math.max(100, Math.min(20000, Math.round(groundSpeedMps * approachTime)));
        
        const startPoint = Utils.calculateNewCenter(AppState.lastLat, AppState.lastLng, trackLength / 2, (jumpRunTrackDirection + 180) % 360);
        const approachEndPoint = Utils.calculateNewCenter(startPoint[0], startPoint[1], approachLength, (jumpRunTrackDirection + 180) % 360);
        approachLatLngs = [[startPoint[0], startPoint[1]], [approachEndPoint[0], approachEndPoint[1]]];
    }
    
    const halfLength = trackLength / 2;
    const startPoint = Utils.calculateNewCenter(AppState.lastLat, AppState.lastLng, halfLength, (jumpRunTrackDirection + 180) % 360);
    const endPoint = Utils.calculateNewCenter(AppState.lastLat, AppState.lastLng, halfLength, jumpRunTrackDirection);
    
    return {
        direction: jumpRunTrackDirection,
        trackLength: trackLength,
        meanWindDirection: meanWindDirection,
        meanWindSpeed: meanWind[1],
        latlngs: [startPoint, endPoint],
        approachLatLngs: approachLatLngs,
        approachLength: approachLength,
        approachTime: 120
    };
}


export function calculateLandingPatternCoords(lat, lng, interpolatedData) {
    if (!interpolatedData || interpolatedData.length === 0) {
        return { downwindLat: lat, downwindLng: lng };
    }
    
    // ... (Rest der Funktion bleibt gleich)
    const CANOPY_SPEED_KT = parseInt(document.getElementById('canopySpeed').value) || 20;
    const DESCENT_RATE_MPS = parseFloat(document.getElementById('descentRate').value) || 3.5;
    const LEG_HEIGHT_FINAL = parseInt(document.getElementById('legHeightFinal').value) || 100;
    const LEG_HEIGHT_BASE = parseInt(document.getElementById('legHeightBase').value) || 200;
    const LEG_HEIGHT_DOWNWIND = parseInt(document.getElementById('legHeightDownwind').value) || 300;
    const baseHeight = Math.round(AppState.lastAltitude);
    
    const landingDirection = document.querySelector('input[name="landingDirection"]:checked')?.value || 'LL';
    const customLandingDirLL = parseInt(document.getElementById('customLandingDirectionLL')?.value, 10) || null;
    const customLandingDirRR = parseInt(document.getElementById('customLandingDirectionRR')?.value, 10) || null;

    const heights = interpolatedData.map(d => d.height);
    const dirs = interpolatedData.map(d => Number.isFinite(d.dir) ? parseFloat(d.dir) : 0);
    const spdsKt = interpolatedData.map(d => Utils.convertWind(parseFloat(d.spd) || 0, 'kt', 'km/h'));
    const uComponents = spdsKt.map((spd, i) => -spd * Math.sin(dirs[i] * Math.PI / 180));
    const vComponents = spdsKt.map((spd, i) => -spd * Math.cos(dirs[i] * Math.PI / 180));

    let effectiveLandingWindDir;
    if (landingDirection === 'LL' && Number.isFinite(customLandingDirLL)) {
        effectiveLandingWindDir = customLandingDirLL;
    } else if (landingDirection === 'RR' && Number.isFinite(customLandingDirRR)) {
        effectiveLandingWindDir = customLandingDirRR;
    } else {
        effectiveLandingWindDir = Number.isFinite(AppState.landingWindDir) ? AppState.landingWindDir : dirs[0];
    }

    if (!Number.isFinite(effectiveLandingWindDir)) return { downwindLat: lat, downwindLng: lng };

    const calculateLegEndpoint = (startLat, startLng, bearing, groundSpeedKt, timeSec) => {
        const speedMps = groundSpeedKt * 0.514444;
        const lengthMeters = speedMps * timeSec;
        const metersPerDegreeLat = 111000;
        const distanceDeg = lengthMeters / metersPerDegreeLat;
        const radBearing = bearing * Math.PI / 180;
        const deltaLat = distanceDeg * Math.cos(radBearing);
        const deltaLng = distanceDeg * Math.sin(radBearing) / Math.cos(startLat * Math.PI / 180);
        return [startLat + deltaLat, startLng + deltaLng];
    };
    
    // ... Rest der Logik für LandingPattern ...
    const finalLimits = [baseHeight, baseHeight + LEG_HEIGHT_FINAL];
    const finalMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, ...finalLimits);
    const finalWindDir = finalMeanWind[0];
    const finalWindSpeedKt = finalMeanWind[1];
    const finalCourse = (effectiveLandingWindDir + 180) % 360;
    const finalWindAngle = Utils.calculateWindAngle(finalCourse, finalWindDir);
    const { headwind: finalHeadwind } = Utils.calculateWindComponents(finalWindSpeedKt, finalWindAngle);
    const finalGroundSpeedKt = Utils.calculateGroundSpeed(CANOPY_SPEED_KT, finalHeadwind);
    const finalTime = LEG_HEIGHT_FINAL / DESCENT_RATE_MPS;
    const finalEnd = calculateLegEndpoint(lat, lng, finalCourse, finalGroundSpeedKt, finalTime);
    
    const baseLimits = [baseHeight + LEG_HEIGHT_FINAL, baseHeight + LEG_HEIGHT_BASE];
    const baseMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, ...baseLimits);
    const baseWindDir = baseMeanWind[0];
    const baseWindSpeedKt = baseMeanWind[1];
    const baseHeading = landingDirection === 'LL' ? (effectiveLandingWindDir + 90) % 360 : (effectiveLandingWindDir - 90 + 360) % 360;
    const baseCourse = Utils.calculateCourseFromHeading(baseHeading, baseWindDir, baseWindSpeedKt, CANOPY_SPEED_KT).trueCourse;
    const { headwind: baseHeadwind } = Utils.calculateWindComponents(baseWindSpeedKt, Utils.calculateWindAngle(baseCourse, baseWindDir));
    const baseGroundSpeedKt = CANOPY_SPEED_KT - baseHeadwind;
    const baseTime = (LEG_HEIGHT_BASE - LEG_HEIGHT_FINAL) / DESCENT_RATE_MPS;
    let baseBearing = (baseCourse + 180) % 360;
    if (baseGroundSpeedKt < 0) baseBearing = (baseBearing + 180) % 360;
    const baseEnd = calculateLegEndpoint(finalEnd[0], finalEnd[1], baseBearing, baseGroundSpeedKt, baseTime);

    const downwindLimits = [baseHeight + LEG_HEIGHT_BASE, baseHeight + LEG_HEIGHT_DOWNWIND];
    const downwindMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, ...downwindLimits);
    const downwindWindDir = downwindMeanWind[0];
    const downwindWindSpeedKt = downwindMeanWind[1];
    const downwindCourse = effectiveLandingWindDir;
    const { headwind: downwindHeadwind } = Utils.calculateWindComponents(downwindWindSpeedKt, Utils.calculateWindAngle(downwindCourse, downwindWindDir));
    const downwindGroundSpeedKt = CANOPY_SPEED_KT + downwindHeadwind;
    const downwindTime = (LEG_HEIGHT_DOWNWIND - LEG_HEIGHT_BASE) / DESCENT_RATE_MPS;
    const downwindEnd = calculateLegEndpoint(baseEnd[0], baseEnd[1], downwindCourse, downwindGroundSpeedKt, downwindTime);

    return { downwindLat: downwindEnd[0], downwindLng: downwindEnd[1] };
}