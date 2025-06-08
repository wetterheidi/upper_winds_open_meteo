// jumpPlanner.js
import { AppState } from './state.js';
import { getWindSpeedUnit, getHeightUnit, interpolateWeatherData } from './app.js'; // Temporär, bis AppState ausgelagert ist
import { Settings } from './settings.js';
import { Utils } from './utils.js';
import { Constants } from './constants.js';

export function getSeparationFromTAS(ias) {
    // Convert exitAltitude from meters to feet (1m = 3.28084ft)
    const exitAltitudeFt = Settings.state.userSettings.exitAltitude * 3.28084;

    // Calculate TAS using Utils.calculateTAS
    const tas = Utils.calculateTAS(ias, exitAltitudeFt);
    if (tas === 'N/A') {
        console.warn('TAS calculation failed, using default separation');
        return defaultSettings.jumperSeparation; // Fallback to default (5s)
    }

    // Round TAS to nearest table key
    const speeds = Object.keys(Constants.jumperSeparationTable).map(Number).sort((a, b) => b - a);
    let closestSpeed = speeds[0]; // Default to highest speed
    for (const speed of speeds) {
        if (tas <= speed) closestSpeed = speed;
        else break;
    }

    // Return separation from table, default to 7 seconds if not found
    const separation = Constants.jumperSeparationTable[closestSpeed] || 7;
    console.log(`Calculated TAS: ${tas}kt, Closest speed: ${closestSpeed}kt, Separation: ${separation}s`);
    return separation;
}

export function calculateFreeFall(weatherData, exitAltitude, openingAltitude, sliderIndex, startLat, startLng, elevation) {
    console.log('Starting calculateFreeFall...', { exitAltitude, openingAltitude, sliderIndex });

    if (!AppState.weatherData || !AppState.weatherData.time || !AppState.weatherData.surface_pressure) {
        console.warn('Invalid weather data provided');
        return null;
    }
    if (!Number.isFinite(startLat) || !Number.isFinite(startLng) || !Number.isFinite(elevation)) {
        console.warn('Invalid coordinates or elevation');
        return null;
    }

    // RW values
    const mass = 80; // jumpers mass
    const g = 9.81; //Erdbeschleunigung
    const Rl = 287.102; //gas constant dry air
    const cdHorizontal = 1; // Widerstandswert horizontal
    const areaHorizontal = 0.5; // Auftriebsfläche horizontal
    const cdVertical = 1; // Widerstandswert vertikal
    const areaVertical = 0.5; //Auftriebsfläche vertikal
    const dt = 0.5;

    const hStart = elevation + exitAltitude;
    const hStop = elevation + openingAltitude - 200; //calculate until canopy is open
    const jumpRunData = jumpRunTrack();
    const jumpRunDirection = jumpRunData ? jumpRunData.direction : 0;
    const aircraftSpeedKt = Settings.state.userSettings.aircraftSpeedKt; // Use user-defined IAS speed
    const exitAltitudeFt = exitAltitude / 0.3048; // Convert to feet (adjust if elevation matters)

    const aircraftSpeedTAS = Utils.calculateTAS(aircraftSpeedKt, exitAltitudeFt);
    let aircraftSpeedMps;
    if (aircraftSpeedTAS === 'N/A') {
        console.warn('TAS calculation failed, using IAS', aircraftSpeedKt);
        aircraftSpeedMps = aircraftSpeedKt * 0.514444;
    } else {
        aircraftSpeedMps = aircraftSpeedTAS * 0.514444;
    }

    const vxInitial = Math.cos((jumpRunDirection) * Math.PI / 180) * aircraftSpeedMps;
    const vyInitial = Math.sin((jumpRunDirection) * Math.PI / 180) * aircraftSpeedMps;

    console.log('Free fall initial values: IAS', aircraftSpeedKt, 'kt, TAS', aircraftSpeedTAS, 'kt, direction', jumpRunDirection, '°');
    console.log('Free fall initial velocity: ', { vxInitial, vyInitial });

    const interpolatedData = interpolateWeatherData(sliderIndex);
    if (!interpolatedData || interpolatedData.length === 0) {
        console.warn('No interpolated weather data available');
        return null;
    }
    const heights = interpolatedData.map(d => d.height);
    const windDirs = interpolatedData.map(d => Number.isFinite(d.dir) ? parseFloat(d.dir) : 0);
    const windSpdsMps = interpolatedData.map(d => Utils.convertWind(parseFloat(d.spd) || 0, 'm/s', 'km/h'));
    const tempsC = interpolatedData.map(d => d.temp);

    const trajectory = [{
        time: 0,
        height: hStart,
        vz: 0,
        vxGround: vxInitial,
        vyGround: vyInitial,
        x: 0,
        y: 0
    }];

    const surfacePressure = AppState.weatherData.surface_pressure[sliderIndex] || 1013.25;
    const surfaceTempC = AppState.weatherData.temperature_2m[sliderIndex] || 15;
    const surfaceTempK = surfaceTempC + 273.15;
    let rho = (surfacePressure * 100) / (Rl * surfaceTempK);

    let current = trajectory[0];
    while (current.height > hStop) {
        const windDir = Utils.LIP(heights, windDirs, current.height);
        const windSpd = Utils.LIP(heights, windSpdsMps, current.height);
        const tempC = Utils.LIP(heights, tempsC, current.height);
        const tempK = tempC + 273.15;
        rho = (surfacePressure * 100 * Math.exp(-g * (current.height - elevation) / (Rl * tempK))) / (Rl * tempK);

        // Wind direction is "from," displacement is "to" (add 180°)
        const windDirTo = (windDir + 180) % 360;
        const vxWind = windSpd * Math.cos(windDirTo * Math.PI / 180); // Displacement direction
        const vyWind = windSpd * Math.sin(windDirTo * Math.PI / 180);

        const vxAir = current.vxGround - vxWind;
        const vyAir = current.vyGround - vyWind;
        const vAirMag = Math.sqrt(vxAir * vxAir + vyAir * vyAir);

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

    console.log(`Free fall from exit to opening: ${Math.round(directionDeg)}° ${Math.round(distance)} m, vz: ${final.vz.toFixed(2)} m/s`);
    console.log('Elevation used:', elevation);

    const result = {
        time: final.time,
        height: final.height,
        vz: final.vz,
        xDisplacement: final.x,
        yDisplacement: final.y,
        path: trajectory.map(point => ({
            latLng: Utils.calculateNewCenter(startLat, startLng, Math.sqrt(point.x * point.x + point.y * point.y), Math.atan2(point.y, point.x) * 180 / Math.PI),
            point_x: point.x,
            point_y: point.y,
            height: point.height,
            time: point.time,
            vz: point.vz
        })),
        directionDeg: directionDeg, // Include direction
        distance: distance // Include distance
    };
    console.log('Aircraft Speed IAS: ', aircraftSpeedKt);
    console.log('Free fall result:', result);
    console.log(`Free fall considerations output: Throw and drift: ${Math.round(directionDeg)}° ${Math.round(distance)} m ${Math.round(final.time)} s ${hStart} m ${hStop} m`);
    return result;
}

export function calculateExitCircle() {
    if (!Settings.state.userSettings.showExitArea || !Settings.state.userSettings.calculateJump || !AppState.weatherData || !AppState.lastLat || !AppState.lastLng) {
        console.log('Skipping calculateExitCircle: conditions not met');
        return null;
    }
    console.log('Calculating exit circle...', {
        lastLat: AppState.lastLat,
        lastLng: AppState.lastLng,
        lastAltitude: AppState.lastAltitude,
        sliderIndex: parseInt(document.getElementById('timeSlider')?.value) || 0
    });

    const sliderIndex = parseInt(document.getElementById('timeSlider')?.value) || 0;
    const exitAltitude = parseInt(document.getElementById('exitAltitude')?.value) || 3000;
    const openingAltitude = parseInt(document.getElementById('openingAltitude')?.value) || 1200;
    const legHeightDownwind = parseInt(document.getElementById('legHeightDownwind')?.value) || 300;
    const descentRate = parseFloat(document.getElementById('descentRate')?.value) || 3.5;
    const canopySpeed = parseFloat(document.getElementById('canopySpeed')?.value) || 20;

    const interpolatedData = interpolateWeatherData(sliderIndex);
    if (!interpolatedData || interpolatedData.length === 0) {
        console.warn('No interpolated weather data for exit circle');
        return null;
    }

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

    const landingPatternCoords = calculateLandingPatternCoords(AppState.lastLat, AppState.lastLng, interpolatedData, sliderIndex);
    let blueLat = landingPatternCoords.downwindLat;
    let blueLng = landingPatternCoords.downwindLng;
    if (!Number.isFinite(blueLat) || !Number.isFinite(blueLng)) {
        console.warn('Downwind coordinates invalid, using lastLat, lastLng as fallback');
        blueLat = AppState.lastLat;
        blueLng = AppState.lastLng;
    }
    const redLat = AppState.lastLat;
    const redLng = AppState.lastLng;

    const newCenterBlue = Utils.calculateNewCenter(blueLat, blueLng, centerDisplacement, displacementDirection);
    const newCenterRed = Utils.calculateNewCenter(redLat, redLng, centerDisplacementFull, displacementDirectionFull);

    const freeFallResult = calculateFreeFall(AppState.weatherData, exitAltitude, openingAltitude, sliderIndex, AppState.lastLat, AppState.lastLng, AppState.lastAltitude);
    if (!freeFallResult) {
        console.warn('Free fall calculation failed for exit circle');
        return null;
    }

    const greenShiftDirection = (freeFallResult.directionDeg + 180) % 360;
    const greenCenter = Utils.calculateNewCenter(newCenterRed[0], newCenterRed[1], freeFallResult.distance, greenShiftDirection);
    const darkGreenCenter = Utils.calculateNewCenter(newCenterBlue[0], newCenterBlue[1], freeFallResult.distance, greenShiftDirection);

    console.log('Exit circle calculated:', {
        greenCenter,
        darkGreenCenter,
        greenRadius: horizontalCanopyDistanceFull,
        darkGreenRadius: horizontalCanopyDistance,
        freeFallDirection: freeFallResult.directionDeg,
        freeFallDistance: freeFallResult.distance
    });

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

export function calculateCutAway() {
    if (!AppState.map) {
        console.warn('Map not initialized, cannot calculate cut-away');
        Utils.handleError('Cannot calculate cut-away: map not initialized.');
        return;
    }

    console.log('calculateCutAway called', {
        calculateJump: Settings.state.userSettings.calculateJump,
        showCanopyArea: Settings.state.userSettings.showCanopyArea,
        showCutAwayFinder: Settings.state.userSettings.showCutAwayFinder,
        cutAwayLat: AppState.cutAwayLat,
        cutAwayLng: AppState.cutAwayLng,
        cutAwayMarkerExists: !!AppState.cutAwayMarker,
        cutAwayMarkerClassName: AppState.cutAwayMarker?.options?.icon?.options?.className || 'none',
        cutAwayCircleExists: !!AppState.cutAwayCircle
    });

    // Silently skip if cut-away marker is not placed
    if (AppState.cutAwayLat === null || AppState.cutAwayLng === null) {
        console.log('Skipping calculateCutAway: cutAwayLat or cutAwayLng is null');
        return;
    }

    // Validate other required data
    if (!AppState.weatherData || AppState.lastAltitude === 'N/A' || !Settings.state.userSettings.cutAwayAltitude) {
        console.log('Cannot calculate cut-away: missing data', {
            weatherData: !!AppState.weatherData,
            lastAltitude: AppState.lastAltitude,
            cutAwayAltitude: Settings.state.userSettings.cutAwayAltitude
        });
        Utils.handleError('Cannot calculate cut-away: missing required data.');
        return;
    }

    // Get current time slider index
    const index = parseInt(document.getElementById('timeSlider')?.value) || 0;

    // Generate interpolated data
    let interpolatedData;
    try {
        if (typeof interpolateWeatherData === 'function') {
            interpolatedData = interpolateWeatherData(index);
        } else {
            console.warn('interpolateWeatherData is not a function');
            Utils.handleError('Cannot calculate cut-away: weather data processing unavailable.');
            return;
        }
    } catch (error) {
        console.warn('Error calling interpolateWeatherData:', error);
        Utils.handleError('Cannot calculate cut-away: error processing weather data.');
        return;
    }

    if (!interpolatedData || !Array.isArray(interpolatedData) || interpolatedData.length === 0) {
        console.warn('Cannot calculate cut-away: invalid interpolatedData', { interpolatedData });
        Utils.handleError('Cannot calculate cut-away: no valid weather data available.');
        return;
    }

    // Prepare altitude range for mean wind calculation
    const elevation = Math.round(AppState.lastAltitude); // Surface altitude in meters
    const lowerLimit = elevation;
    const upperLimit = elevation + Settings.state.userSettings.cutAwayAltitude; // Surface + cutAwayAltitude
    console.log('Cut-away wind limits:', { lowerLimit, upperLimit, elevation });

    // Extract wind data and convert speeds from km/h to m/s
    const heights = interpolatedData.map(d => d.height);
    const dirs = interpolatedData.map(d => Number.isFinite(d.dir) ? parseFloat(d.dir) : 0);
    const spdsMps = interpolatedData.map(d => {
        const spdKmh = Number.isFinite(d.spd) ? parseFloat(d.spd) : 0; // Speed in km/h
        return spdKmh * 0.277778; // Convert km/h to m/s (1 km/h = 0.277778 m/s)
    });

    console.log('Interpolated data for cut-away:', { heights, dirs, spdsMps });

    // Calculate U and V components
    const uComponents = spdsMps.map((spd, i) => -spd * Math.sin(dirs[i] * Math.PI / 180));
    const vComponents = spdsMps.map((spd, i) => -spd * Math.cos(dirs[i] * Math.PI / 180));

    // Compute mean wind
    const meanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, lowerLimit, upperLimit);
    if (!meanWind || !Array.isArray(meanWind) || meanWind.length < 2 || !Number.isFinite(meanWind[0]) || !Number.isFinite(meanWind[1])) {
        console.warn('Invalid mean wind calculation for cut-away:', meanWind);
        Utils.handleError('Cannot calculate cut-away: invalid wind calculation.');
        return;
    }

    const meanWindDirection = meanWind[0]; // degrees
    const meanWindSpeedMps = meanWind[1]; // m/s

    // Vertical speed calculations
    const cutAwayAltitude = Settings.state.userSettings.cutAwayAltitude; // meters
    const surfaceAltitude = AppState.lastAltitude; // meters
    const verticalSpeedMax = Math.sqrt((2 * 9.81 * 5) / (1.2 * 13 * 2.6)).toFixed(1); // m/s, Fully Open
    const verticalSpeedMean = Math.sqrt((2 * 9.81 * 5) / (1.2 * 2 * 1.5)).toFixed(1); // m/s, Partially Collapsed
    const verticalSpeedMin = Math.sqrt((2 * 9.81 * 5) / (1.2 * 0.1 * 1)).toFixed(1); // m/s, Fully Collapsed
    const radius = 150; // meters

    // Log vertical speeds
    console.log('Vertical speeds:', {
        Max: `${verticalSpeedMax} m/s (Fully Open)`,
        Mean: `${verticalSpeedMean} m/s (Partially Collapsed)`,
        Min: `${verticalSpeedMin} m/s (Fully Collapsed)`
    });

    // Calculate descent times
    const heightDifference = cutAwayAltitude; // meters
    const descentTimeMin = heightDifference / verticalSpeedMin; // seconds
    const descentTimeMean = heightDifference / verticalSpeedMean; // seconds
    const descentTimeMax = heightDifference / verticalSpeedMax; // seconds

    // Calculate displacement distances
    const displacementDistanceMin = meanWindSpeedMps * descentTimeMin; // meters
    const displacementDistanceMean = meanWindSpeedMps * descentTimeMean; // meters
    const displacementDistanceMax = meanWindSpeedMps * descentTimeMax; // meters

    // Calculate landing positions
    const adjustedWindDirection = ((meanWindDirection + 180) % 360);
    const [newLatMin, newLngMin] = Utils.calculateNewCenter(AppState.cutAwayLat, AppState.cutAwayLng, displacementDistanceMin, adjustedWindDirection);
    const [newLatMean, newLngMean] = Utils.calculateNewCenter(AppState.cutAwayLat, AppState.cutAwayLng, displacementDistanceMean, adjustedWindDirection);
    const [newLatMax, newLngMax] = Utils.calculateNewCenter(AppState.cutAwayLat, AppState.cutAwayLng, displacementDistanceMax, adjustedWindDirection);

    // Log all calculations
    console.log('Cut-away canopy calculation:', {
        cutAwayAltitude: `${cutAwayAltitude} m`,
        surfaceAltitude: `${surfaceAltitude} m`,
        meanWindSpeed: `${meanWindSpeedMps.toFixed(2)} m/s`,
        meanWindDirection: `${Math.round(adjustedWindDirection)}°`,
        descentTimeMin: `${descentTimeMin.toFixed(0)} s`,
        descentTimeMean: `${descentTimeMean.toFixed(0)} s`,
        descentTimeMax: `${descentTimeMax.toFixed(0)} s`,
        displacementDistanceMin: `${displacementDistanceMin.toFixed(0)} m`,
        displacementDistanceMean: `${displacementDistanceMean.toFixed(0)} m`,
        displacementDistanceMax: `${displacementDistanceMax.toFixed(0)} m`,
        landingPositionMin: {
            lat: newLatMin.toFixed(5),
            lng: newLngMin.toFixed(5)
        },
        landingPositionMean: {
            lat: newLatMean.toFixed(5),
            lng: newLngMean.toFixed(5)
        },
        landingPositionMax: {
            lat: newLatMax.toFixed(5),
            lng: newLngMax.toFixed(5)
        }
    });

    // Remove existing cut-away circle if present
    if (AppState.cutAwayCircle) {
        AppState.map.removeLayer(AppState.cutAwayCircle);
        AppState.cutAwayCircle = null;
        console.log('Cleared existing cut-away circle');
    }

    // Add circle for the selected cut-away state if showCutAwayFinder is enabled
    if (Settings.state.userSettings.showCutAwayFinder && Settings.state.userSettings.calculateJump) {
        let center, descentTime, displacementDistance, stateLabel, verticalSpeedSelected;
        switch (Settings.state.userSettings.cutAwayState) {
            case 'Partially':
                center = [newLatMean, newLngMean];
                descentTime = descentTimeMean;
                displacementDistance = displacementDistanceMean;
                verticalSpeedSelected = verticalSpeedMean;
                stateLabel = 'Partially Collapsed';
                break;
            case 'Collapsed':
                center = [newLatMin, newLngMin];
                descentTime = descentTimeMin;
                displacementDistance = displacementDistanceMin;
                verticalSpeedSelected = verticalSpeedMin;
                stateLabel = 'Fully Collapsed';
                break;
            case 'Open':
                center = [newLatMax, newLngMax];
                descentTime = descentTimeMax;
                displacementDistance = displacementDistanceMax;
                verticalSpeedSelected = verticalSpeedMax;
                stateLabel = 'Fully Open';
                break;
            default:
                console.warn('Unknown cutAwayState:', Settings.state.userSettings.cutAwayState);
                return;
        }

        // Create tooltip content
        const tooltipContent = `
            <b>Cut-Away (${stateLabel})</b><br>
            Cut-Away Altitude: ${cutAwayAltitude} m<br>
            Displacement: ${meanWindDirection.toFixed(0)}°, ${displacementDistance.toFixed(0)} m<br>
            Descent Time/Speed: ${descentTime.toFixed(0)} s at ${verticalSpeedSelected} m/s<br>
        `;

        // Add circle to map
        AppState.cutAwayCircle = L.circle(center, {
            radius: radius,
            color: 'purple',
            fillColor: 'purple',
            fillOpacity: 0.2,
            weight: 2
        }).addTo(AppState.map);

        // Bind tooltip
        AppState.cutAwayCircle.bindTooltip(tooltipContent, {
            permanent: false,
            direction: 'center',
            className: 'cutaway-tooltip'
        });
        console.log('Added cut-away circle:', { center, radius, stateLabel });
    }
    console.log('calculateCutAway completed', {
        cutAwayMarkerExists: !!AppState.cutAwayMarker,
        cutAwayCircleExists: !!AppState.cutAwayCircle
    });
}

export function calculateCanopyCircles() {
    if (!Settings.state.userSettings.showCanopyArea || !Settings.state.userSettings.calculateJump || !AppState.weatherData || !AppState.lastLat || !AppState.lastLng) {
        console.log('Skipping calculateCanopyCircles: conditions not met');
        return null;
    }
    console.log('Calculating canopy circles...', {
        lastLat: AppState.lastLat,
        lastLng: AppState.lastLng,
        lastAltitude: AppState.lastAltitude,
        sliderIndex: parseInt(document.getElementById('timeSlider')?.value) || 0
    });

    const sliderIndex = parseInt(document.getElementById('timeSlider')?.value) || 0;
    const exitAltitude = parseInt(document.getElementById('exitAltitude')?.value) || 3000;
    const openingAltitude = parseInt(document.getElementById('openingAltitude')?.value) || 1200;
    const legHeightDownwind = parseInt(document.getElementById('legHeightDownwind')?.value) || 300;
    const descentRate = parseFloat(document.getElementById('descentRate')?.value) || 3.5;
    const canopySpeed = parseFloat(document.getElementById('canopySpeed')?.value) || 20;

    const interpolatedData = interpolateWeatherData(sliderIndex);
    if (!interpolatedData || interpolatedData.length === 0) {
        console.warn('No interpolated weather data for canopy circles');
        return null;
    }

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
    const additionalBlueRadii = [];
    const additionalBlueDisplacements = [];
    const additionalBlueDirections = [];
    const additionalBlueUpperLimits = [];
    let decrement;
    if ((upperLimit - lowerLimit) <= 1000) {
        decrement = 200;
    } else if ((upperLimit - lowerLimit) > 1000 && (upperLimit - lowerLimit) <= 3000) {
        decrement = 500;
    } else {
        decrement = 1000;
    }
    let currentUpper = upperLimit;
    while (currentUpper >= lowerLimit + 200) {
        const currentHeightDistance = currentUpper - lowerLimit;
        const currentFlyTime = currentHeightDistance / descentRate;
        const currentRadius = currentFlyTime * canopySpeedMps;
        if (currentRadius > 0) {
            const meanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, lowerLimit, currentUpper);
            const currentMeanWindDirection = meanWind[0];
            const currentMeanWindSpeedMps = meanWind[1];
            const currentDisplacement = currentMeanWindSpeedMps * currentFlyTime;

            additionalBlueRadii.push(currentRadius);
            additionalBlueDisplacements.push(currentDisplacement);
            additionalBlueDirections.push(currentMeanWindDirection);
            additionalBlueUpperLimits.push(currentUpper - elevation);
            console.log(`Additional blue circle for ${currentUpper}m:`, {
                radius: currentRadius,
                displacement: currentDisplacement,
                direction: currentMeanWindDirection,
                heightAGL: currentUpper - elevation
            });
        }
        currentUpper -= decrement;
    }

    const freeFallResult = calculateFreeFall(AppState.weatherData, exitAltitude, openingAltitude, sliderIndex, AppState.lastLat, AppState.lastLng, AppState.lastAltitude);
    if (!freeFallResult) {
        console.warn('Free fall calculation failed for canopy circles');
        return null;
    }

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

    const landingPatternCoords = calculateLandingPatternCoords(AppState.lastLat, AppState.lastLng, interpolatedData, sliderIndex);
    let blueLat = landingPatternCoords.downwindLat;
    let blueLng = landingPatternCoords.downwindLng;
    if (!Number.isFinite(blueLat) || !Number.isFinite(blueLng)) {
        console.warn('Downwind coordinates invalid, using lastLat, lastLng as fallback');
        blueLat = AppState.lastLat;
        blueLng = AppState.lastLng;
    }
    const redLat = AppState.lastLat;
    const redLng = AppState.lastLng;

    console.log('Canopy circles calculated:', {
        blueLat,
        blueLng,
        redLat,
        redLng,
        horizontalCanopyDistance,
        horizontalCanopyDistanceFull,
        centerDisplacement,
        centerDisplacementFull,
        displacementDirection,
        displacementDirectionFull
    });

    return {
        blueLat,
        blueLng,
        redLat,
        redLng,
        radius: horizontalCanopyDistance,
        radiusFull: horizontalCanopyDistanceFull,
        additionalBlueRadii,
        additionalBlueDisplacements,
        additionalBlueDirections,
        additionalBlueUpperLimits,
        displacement: centerDisplacement,
        displacementFull: centerDisplacementFull,
        direction: meanWindDirection,
        directionFull: meanWindDirectionFull,
        meanWindForFullCanopyDir: meanWindDirectionFull,
        meanWindForFullCanopySpeedMps: meanWindSpeedMpsFull, // In m/s, wie von calculateMeanWind geliefert
        freeFallDirection: freeFallResult.directionDeg,
        freeFallDistance: freeFallResult.distance,
        freeFallTime: freeFallResult.time
    };
}

export function jumpRunTrack() {
    console.log('Starting jumpRunTrack...', {
        weatherData: !!AppState.weatherData,
        lastLat: AppState.lastLat,
        lastLng: AppState.lastLng,
        lastAltitude: AppState.lastAltitude,
        customJumpRunDirection: AppState.customJumpRunDirection,
        jumpRunTrackOffset: Settings.state.userSettings.jumpRunTrackOffset,
        jumpRunTrackForwardOffset: Settings.state.userSettings.jumpRunTrackForwardOffset
    });
    const exitAltitude = parseInt(document.getElementById('exitAltitude')?.value) || Settings.state.userSettings.exitAltitude || 3000;
    const openingAltitude = parseInt(document.getElementById('openingAltitude')?.value) || Settings.state.userSettings.openingAltitude || 1000;
    const customDirection = parseInt(document.getElementById('jumpRunTrackDirection')?.value, 10);
    const sliderIndex = parseInt(document.getElementById('timeSlider')?.value) || 0;
    const lateralOffset = parseInt(document.getElementById('jumpRunTrackOffset')?.value) || Settings.state.userSettings.jumpRunTrackOffset || 0;
    const forwardOffset = parseInt(document.getElementById('jumpRunTrackForwardOffset')?.value) || Settings.state.userSettings.jumpRunTrackForwardOffset || 0;

    if (!AppState.weatherData || !AppState.lastLat || !AppState.lastLng || AppState.lastAltitude === null || AppState.lastAltitude === 'N/A') {
        console.warn('Cannot calculate jump run track: missing data', {
            weatherData: !!AppState.weatherData,
            lastLat: AppState.lastLat,
            lastLng: AppState.lastLng,
            lastAltitude: AppState.lastAltitude
        });
        return null;
    }

    const interpolatedData = interpolateWeatherData(sliderIndex);
    if (!interpolatedData || interpolatedData.length === 0) {
        console.warn('No interpolated weather data available for sliderIndex:', sliderIndex);
        return null;
    }

    const elevation = Math.round(AppState.lastAltitude);
    const lowerLimit = elevation;
    const upperLimit = elevation + openingAltitude;
    console.log('Jump run track limits:', { lowerLimit, upperLimit, elevation });

    const heights = interpolatedData.map(d => d.height);
    const dirs = interpolatedData.map(d => Number.isFinite(d.dir) ? parseFloat(d.dir) : 0);
    const spdsMps = interpolatedData.map(d => {
        const spd = Number.isFinite(d.spd) ? parseFloat(d.spd) : 0;
        return Utils.convertWind(spd, 'm/s', getWindSpeedUnit());
    });

    console.log('Interpolated data:', { heights, dirs, spdsMps });

    const uComponents = spdsMps.map((spd, i) => -spd * Math.sin(dirs[i] * Math.PI / 180));
    const vComponents = spdsMps.map((spd, i) => -spd * Math.cos(dirs[i] * Math.PI / 180));

    const meanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, lowerLimit, upperLimit);
    const meanWindDirection = meanWind[0];
    const meanWindSpeed = meanWind[1];

    if (!Number.isFinite(meanWindDirection) || !Number.isFinite(meanWindSpeed)) {
        console.warn('Invalid mean wind calculation:', meanWind);
        return null;
    }

    let jumpRunTrackDirection;
    if (AppState.customJumpRunDirection !== null && !isNaN(AppState.customJumpRunDirection) && AppState.customJumpRunDirection >= 0 && AppState.customJumpRunDirection <= 359) {
        jumpRunTrackDirection = AppState.customJumpRunDirection;
        console.log(`Using custom jump run direction: ${jumpRunTrackDirection}°`);
    } else {
        jumpRunTrackDirection = Math.round(meanWindDirection);
        AppState.customJumpRunDirection = null;
        console.log(`Using calculated jump run direction: ${jumpRunTrackDirection}°`, {
            meanWindDirection: meanWindDirection.toFixed(1),
            inputValue: document.getElementById('jumpRunTrackDirection')?.value
        });
    }

    // Calculate ground speed at exit altitude
    const exitHeightM = elevation + exitAltitude;
    const exitHeightFt = exitHeightM / 0.3048;
    const iasKt = Settings.state.userSettings.aircraftSpeedKt || 90;
    console.log('TAS input:', { iasKt, exitHeightFt });
    const tasKt = Utils.calculateTAS(iasKt, exitHeightFt);
    console.log('TAS output:', tasKt);
    let trackLength = 2000; // Default fallback
    let approachLength = 2000; // Default fallback for approach
    let groundSpeedMps = null;
    let approachLatLngs = null;
    if (tasKt === 'N/A' || !Number.isFinite(tasKt)) {
        console.warn('Failed to calculate TAS for ground speed');
    } else {
        const windDirAtExit = Utils.LIP(heights, dirs, exitHeightM);
        const windSpeedMpsAtExit = Utils.LIP(heights, spdsMps, exitHeightM);
        const windSpeedKtAtExit = windSpeedMpsAtExit * 1.94384;

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
        const groundSpeedKt = groundSpeedMps * 1.94384;

        // Calculate dynamic track length
        const numberOfJumpers = parseInt(Settings.state.userSettings.numberOfJumpers) || 10;
        const jumperSeparation = parseFloat(Settings.state.userSettings.jumperSeparation) || 5;

        let separation;
        if (numberOfJumpers == 1) {
            separation = 200 / groundSpeedMps;
        } else if (numberOfJumpers <= 6) {
            separation = 300 / groundSpeedMps;
        } else {
            separation = 500 / groundSpeedMps;
        }
        console.log('Dynamic separation: ', separation.toFixed(0));

        if (numberOfJumpers >= 1 && jumperSeparation >= 1 && Number.isFinite(groundSpeedMps)) {
            trackLength = numberOfJumpers * jumperSeparation * groundSpeedMps;
            trackLength = Math.max(100, Math.min(10000, Math.round(trackLength)));
            console.log('Dynamic track length calculation:', {
                numberOfJumpers,
                jumperSeparation,
                groundSpeedMps: groundSpeedMps.toFixed(2),
                trackLength
            });
        } else {
            console.warn('Invalid inputs for track length, using default:', {
                numberOfJumpers,
                jumperSeparation,
                groundSpeedMps
            });
        }

        console.log('Aircraft Ground Speed Calculation:', {
            exitAltitude: exitHeightM.toFixed(1) + ' m',
            exitHeightFt: exitHeightFt.toFixed(1) + ' ft',
            ias: iasKt.toFixed(1) + ' kt',
            tas: tasKt.toFixed(1) + ' kt',
            jumpRunDirection: jumpRunTrackDirection.toFixed(1) + '°',
            windDirAtExit: windDirAtExit.toFixed(1) + '°',
            windSpeedAtExit: windSpeedKtAtExit.toFixed(1) + ' kt',
            groundSpeed: groundSpeedKt.toFixed(1) + ' kt'
        });
    }

    // Update input field only if calculated or explicitly set
    const directionInput = document.getElementById('jumpRunTrackDirection');
    if (directionInput) {
        directionInput.value = jumpRunTrackDirection;
        console.log('Updated jumpRunTrackDirection input to:', jumpRunTrackDirection);
    }

    const halfLength = trackLength / 2;

    // Apply forward/backward offset along the track direction
    let centerLat = AppState.lastLat;
    let centerLng = AppState.lastLng;
    if (forwardOffset !== 0) {
        const forwardDistance = Math.abs(forwardOffset);
        const forwardBearing = forwardOffset >= 0 ? jumpRunTrackDirection : (jumpRunTrackDirection + 180) % 360;
        [centerLat, centerLng] = Utils.calculateNewCenter(AppState.lastLat, AppState.lastLng, forwardDistance, forwardBearing);
        console.log('Applied forward/backward offset:', {
            forwardOffset,
            forwardBearing,
            centerLat,
            centerLng
        });
    }

    // Apply lateral offset perpendicular to the track direction
    if (lateralOffset !== 0) {
        const offsetDistance = Math.abs(lateralOffset);
        const offsetBearing = lateralOffset >= 0
            ? (jumpRunTrackDirection + 90) % 360
            : (jumpRunTrackDirection - 90 + 360) % 360;
        [centerLat, centerLng] = Utils.calculateNewCenter(centerLat, centerLng, offsetDistance, offsetBearing);
        console.log('Applied lateral offset:', {
            lateralOffset,
            offsetBearing,
            centerLat,
            centerLng
        });
    }

    // Calculate approach path
    const approachTime = 120; // Fixed 120 seconds
    if (Number.isFinite(groundSpeedMps)) {
        approachLength = groundSpeedMps * approachTime;
        approachLength = Math.max(100, Math.min(20000, Math.round(approachLength)));
        console.log('Approach path calculation:', {
            groundSpeedMps: groundSpeedMps.toFixed(2),
            approachTime,
            approachLength
        });

        const startPoint = Utils.calculateNewCenter(centerLat, centerLng, trackLength / 2, (jumpRunTrackDirection + 180) % 360);
        const approachEndPoint = Utils.calculateNewCenter(startPoint[0], startPoint[1], approachLength, (jumpRunTrackDirection + 180) % 360);
        approachLatLngs = [
            [startPoint[0], startPoint[1]],
            [approachEndPoint[0], approachEndPoint[1]]
        ];
    } else {
        console.warn('Invalid ground speed for approach path, using default length');
    }

    // Calculate jump run track points
    const startPoint = Utils.calculateNewCenter(centerLat, centerLng, halfLength, (jumpRunTrackDirection + 180) % 360);
    const endPoint = Utils.calculateNewCenter(centerLat, centerLng, halfLength, jumpRunTrackDirection);

    const latlngs = [
        [startPoint[0], startPoint[1]], // Rear
        [endPoint[0], endPoint[1]]      // Front
    ];

    console.log(`Jump Run Track: ${jumpRunTrackDirection}° (Mean wind: ${meanWindDirection.toFixed(1)}° @ ${meanWindSpeed.toFixed(1)} ${getWindSpeedUnit()}), Length: ${trackLength} m`);
    console.log('Jump Run Track latlngs:', latlngs);
    if (approachLatLngs) {
        console.log(`Approach Path: ${jumpRunTrackDirection}°, Length: ${approachLength} m, latlngs:`, approachLatLngs);
    }

    return {
        direction: jumpRunTrackDirection,
        trackLength: trackLength,
        meanWindDirection: meanWindDirection,
        meanWindSpeed: meanWindSpeed,
        latlngs: latlngs,
        approachLatLngs: approachLatLngs,
        approachLength: approachLength,
        approachTime: approachTime
    };
}

export function calculateLandingPatternCoords(lat, lng, interpolatedData, sliderIndex) {
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
    const spdsKt = interpolatedData.map(d => Utils.convertWind(parseFloat(d.spd) || 0, 'kt', 'km/h')); // km/h to kt
    const uComponents = spdsKt.map((spd, i) => -spd * Math.sin(dirs[i] * Math.PI / 180));
    const vComponents = spdsKt.map((spd, i) => -spd * Math.cos(dirs[i] * Math.PI / 180));

    let effectiveLandingWindDir;
    if (landingDirection === 'LL' && Number.isFinite(customLandingDirLL) && customLandingDirLL >= 0 && customLandingDirLL <= 359) {
        effectiveLandingWindDir = customLandingDirLL;
    } else if (landingDirection === 'RR' && Number.isFinite(customLandingDirRR) && customLandingDirRR >= 0 && customLandingDirRR <= 359) {
        effectiveLandingWindDir = customLandingDirRR;
    } else {
        // Only use calculated wind direction if no valid custom direction exists
        effectiveLandingWindDir = Number.isFinite(AppState.landingWindDir) ? AppState.landingWindDir : dirs[0];
    }

    if (!Number.isFinite(effectiveLandingWindDir)) {
        console.warn('Invalid landing wind direction:', effectiveLandingWindDir);
        return { downwindLat: lat, downwindLng: lng };
    }

    const calculateLegEndpoint = (startLat, startLng, bearing, groundSpeedKt, timeSec) => {
        const speedMps = groundSpeedKt * 0.514444; // kt to m/s
        const lengthMeters = speedMps * timeSec;
        const metersPerDegreeLat = 111000;
        const distanceDeg = lengthMeters / metersPerDegreeLat;
        const radBearing = bearing * Math.PI / 180;
        const deltaLat = distanceDeg * Math.cos(radBearing);
        const deltaLng = distanceDeg * Math.sin(radBearing) / Math.cos(startLat * Math.PI / 180);
        return [startLat + deltaLat, startLng + deltaLng];
    };

    // Final Leg
    const finalLimits = [baseHeight, baseHeight + LEG_HEIGHT_FINAL];
    const finalMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, ...finalLimits);
    const finalWindDir = finalMeanWind[0];
    const finalWindSpeedKt = finalMeanWind[1];
    const finalCourse = (effectiveLandingWindDir + 180) % 360;
    const finalWindAngle = Utils.calculateWindAngle(effectiveLandingWindDir, finalWindDir);
    const { crosswind: finalCrosswind, headwind: finalHeadwind } = Utils.calculateWindComponents(finalWindSpeedKt, finalWindAngle);
    const finalGroundSpeedKt = Utils.calculateGroundSpeed(CANOPY_SPEED_KT, finalHeadwind);
    const finalTime = LEG_HEIGHT_FINAL / DESCENT_RATE_MPS;
    const finalEnd = calculateLegEndpoint(lat, lng, finalCourse, finalGroundSpeedKt, finalTime);

    // Base Leg
    const baseLimits = [baseHeight + LEG_HEIGHT_FINAL, baseHeight + LEG_HEIGHT_BASE];
    const baseMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, ...baseLimits);
    const baseWindDir = baseMeanWind[0];
    const baseWindSpeedKt = baseMeanWind[1];
    const baseHeading = landingDirection === 'LL' ? (effectiveLandingWindDir + 90) % 360 : (effectiveLandingWindDir - 90 + 360) % 360;
    const baseCourse = Utils.calculateCourseFromHeading(baseHeading, baseWindDir, baseWindSpeedKt, CANOPY_SPEED_KT).trueCourse;
    const baseWindAngle = Utils.calculateWindAngle(baseCourse, baseWindDir);
    const { crosswind: baseCrosswind, headwind: baseHeadwind } = Utils.calculateWindComponents(baseWindSpeedKt, baseWindAngle);
    const baseGroundSpeedKt = CANOPY_SPEED_KT - baseHeadwind;
    const baseTime = (LEG_HEIGHT_BASE - LEG_HEIGHT_FINAL) / DESCENT_RATE_MPS;
    let baseBearing = (baseCourse + 180) % 360;
    if (baseGroundSpeedKt < 0) baseBearing = (baseBearing + 180) % 360;
    const baseEnd = calculateLegEndpoint(finalEnd[0], finalEnd[1], baseBearing, baseGroundSpeedKt, baseTime);

    // Downwind Leg
    const downwindLimits = [baseHeight + LEG_HEIGHT_BASE, baseHeight + LEG_HEIGHT_DOWNWIND];
    const downwindMeanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, ...downwindLimits);
    const downwindWindDir = downwindMeanWind[0];
    const downwindWindSpeedKt = downwindMeanWind[1];
    const downwindCourse = effectiveLandingWindDir;
    const downwindWindAngle = Utils.calculateWindAngle(downwindCourse, downwindWindDir);
    const { crosswind: downwindCrosswind, headwind: downwindHeadwind } = Utils.calculateWindComponents(downwindWindSpeedKt, downwindWindAngle);
    const downwindGroundSpeedKt = CANOPY_SPEED_KT + downwindHeadwind;
    const downwindTime = (LEG_HEIGHT_DOWNWIND - LEG_HEIGHT_BASE) / DESCENT_RATE_MPS;
    const downwindEnd = calculateLegEndpoint(baseEnd[0], baseEnd[1], downwindCourse, downwindGroundSpeedKt, downwindTime);

    return { downwindLat: downwindEnd[0], downwindLng: downwindEnd[1] };
}
