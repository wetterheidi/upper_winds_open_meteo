let map;
let weatherData = null;
let lastLat = null;
let lastLng = null;
let lastAltitude = null;
let currentMarker = null;
let lastModelRun = null;
let landingPatternPolygon = null;
let secondlandingPatternPolygon = null;
let thirdLandingPatternLine = null;
let finalArrow = null;
let baseArrow = null;
let downwindArrow = null;
let landingWindDir = null;
let coordInputs;
let jumpCircle = null;
let jumpCircleFull = null; // New red circle for full descent
let marker = null;

// Default settings object
const defaultSettings = {
    model: 'icon_global',
    refLevel: 'AGL',
    heightUnit: 'm',
    temperatureUnit: 'C',
    windUnit: 'kt',
    timeZone: 'Z',
    coordFormat: 'Decimal',
    downloadFormat: 'HEIDIS',
    showTable: false,
    //showCanopyParameters: false,
    canopySpeed: 20,
    descentRate: 3.5,
    showLandingPattern: false,
    landingDirection: 'LL',
    customLandingDirectionLL: '',
    customLandingDirectionRR: '',
    legHeightDownwind: 300,
    legHeightBase: 200,
    legHeightFinal: 100,
    interpStep: '200',
    lowerLimit: 0,
    upperLimit: 3000,
    baseMaps: 'Esri Street',
    calculateJump: false,      // New setting for checkbox
    openingAltitude: 1200,      // New setting for opening altitude
    exitAltitude: 3000 // New default for Exit Altitude
};

// Load settings from localStorage or use defaults
let userSettings = JSON.parse(localStorage.getItem('upperWindsSettings')) || { ...defaultSettings };
console.log(userSettings);

// Function to save settings to localStorage
function saveSettings() {
    localStorage.setItem('upperWindsSettings', JSON.stringify(userSettings));
}

// Update model run info in menu
function updateModelRunInfo() {
    const modelLabel = document.getElementById('modelLabel'); // Target the label
    const modelSelect = document.getElementById('modelSelect');
    if (modelLabel && lastModelRun) {
        const model = modelSelect.value;
        const titleContent = `Model: ${model.replace('_', ' ').toUpperCase()}\nRun: ${lastModelRun}`; // Use \n for line break in title
        modelLabel.title = titleContent; // Set the title attribute
    }
    // Optional: If you want to use local time, uncomment and adjust as async
    /*
    if (modelLabel && lastModelRun) {
        const model = modelSelect.value;
        const timeZone = document.querySelector('input[name="timeZone"]:checked')?.value || 'Z';
        const displayTime = timeZone === 'Z' || !lastLat || !lastLng
            ? lastModelRun
            : await Utils.formatLocalTime(lastModelRun.replace(' ', 'T') + ':00Z', lastLat, lastLng);
        const titleContent = `Model: ${model.replace('_', ' ').toUpperCase()}\nRun: ${displayTime}`;
        modelLabel.title = titleContent;
    }
    */
}

function updateReferenceLabels() {
    const refLevel = document.querySelector('input[name="refLevel"]:checked')?.value || 'AGL';
    console.log('Updating labels to refLevel:', refLevel);
    const meanWindResult = document.getElementById('meanWindResult');
    if (meanWindResult && meanWindResult.innerHTML) {
        const currentText = meanWindResult.innerHTML;
        const updatedText = currentText.replace(/\((\d+)-(\d+) m [A-Za-z]+\)/, `($1-$2 m ${refLevel})`);
        meanWindResult.innerHTML = updatedText;
    }
}

function calculateJump() {
    // Get values from user inputs
    const exitAltitude = parseInt(document.getElementById('exitAltitude')?.value) || 3000; // New
    const openingAltitude = parseInt(document.getElementById('openingAltitude')?.value) || 1200;
    const legHeightDownwind = parseInt(document.getElementById('legHeightDownwind')?.value) || 300;
    const descentRate = parseFloat(document.getElementById('descentRate')?.value) || 3.5;
    const canopySpeed = parseFloat(document.getElementById('canopySpeed')?.value) || 20;

    // Convert canopy speed from knots to m/s (1 kt = 0.514444 m/s)
    const canopySpeedMps = canopySpeed * 0.514444;

    // Freefall phase (exitAltitude to openingAltitude) - Assuming freefall descent rate ~50 m/s
    const freefallHeight = exitAltitude - openingAltitude;
    const freefallTime = freefallHeight / 50; // Rough estimate, adjust as needed

    // Calculate parameters for blue circle (opening altitude to downwind leg)
    const heightDistance = openingAltitude - 200 - legHeightDownwind;
    const flyTime = heightDistance / descentRate;
    const horizontalCanopyDistance = flyTime * canopySpeedMps; // Radius in meters (blue circle)

    // Calculate parameters for red circle (full descent from opening altitude)
    const heightDistanceFull = openingAltitude - 200; // Full descent
    const flyTimeFull = heightDistanceFull / descentRate;
    const horizontalCanopyDistanceFull = flyTimeFull * canopySpeedMps; // Radius in meters (red circle)

    // Calculate mean wind between openingAltitude and ground (0m AGL)
    const sliderIndex = parseInt(document.getElementById('timeSlider')?.value) || 0;
    const interpolatedData = interpolateWeatherData(sliderIndex);

    if (!interpolatedData || interpolatedData.length === 0) {
        console.warn('No interpolated weather data available for mean wind calculation');
        return null;
    }

    // Filter data between 0m and openingAltitude (AGL)
    const baseHeight = Math.round(lastAltitude);
    const lowerLimit = baseHeight; // Ground level
    const upperLimit = baseHeight + openingAltitude;

    const heights = interpolatedData.map(d => d.height);
    const dirs = interpolatedData.map(d => Number.isFinite(d.dir) ? parseFloat(d.dir) : 0);
    const spdsMps = interpolatedData.map(d => {
        const spd = Number.isFinite(d.spd) ? parseFloat(d.spd) : 0;
        return Utils.convertWind(spd, 'm/s', getWindSpeedUnit());
    });

    // Calculate U and V components (in m/s, wind FROM direction)
    const uComponents = spdsMps.map((spd, i) => -spd * Math.sin(dirs[i] * Math.PI / 180));
    const vComponents = spdsMps.map((spd, i) => -spd * Math.cos(dirs[i] * Math.PI / 180));

    // Calculate mean wind speed and direction between limits
    const meanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, lowerLimit, upperLimit);
    const meanWindDirection = meanWind[0]; // in degrees
    const meanWindSpeedMps = meanWind[1]; // in m/s

    // Calculate displacement for blue circle (opening altitude to downwind leg)
    const centerDisplacement = meanWindSpeedMps * flyTime; // Displacement for blue circle
    const displacementDirection = meanWindDirection; // Same direction for both

    // Calculate displacement for red circle (full descent)
    const centerDisplacementFull = meanWindSpeedMps * flyTimeFull; // Displacement for red circle

    // Log results for verification
    console.log('Jump Calculation Results:');
    console.log(`- Freefall: ${freefallHeight}m, ${freefallTime.toFixed(2)}s`);
    console.log(`- Opening Altitude: ${openingAltitude} m`);
    console.log(`- Blue Circle (to Downwind): Height Distance: ${heightDistance} m, Fly Time: ${flyTime.toFixed(2)} s, Radius: ${horizontalCanopyDistance.toFixed(2)} m, Displacement: ${centerDisplacement.toFixed(2)} m`);
    console.log(`- Red Circle (Full Descent): Height Distance: ${heightDistanceFull} m, Fly Time: ${flyTimeFull.toFixed(2)} s, Radius: ${horizontalCanopyDistanceFull.toFixed(2)} m, Displacement: ${centerDisplacementFull.toFixed(2)} m`);
    console.log(`- Canopy Speed: ${canopySpeedMps.toFixed(2)} m/s`);
    console.log(`- Mean Wind Speed (0-${openingAltitude}m): ${meanWindSpeedMps.toFixed(2)} m/s`);
    console.log(`- Mean Wind Direction: ${meanWindDirection.toFixed(1)}°`);

    // Update or create both jump circles with separate displacements
    updateJumpCircle(lastLat, lastLng, horizontalCanopyDistance, horizontalCanopyDistanceFull, centerDisplacement, centerDisplacementFull, displacementDirection);

    // Ensure currentMarker is at the correct position
    if (currentMarker) {
        currentMarker.setLatLng([lastLat, lastLng]);
        updateMarkerPopup(currentMarker, lastLat, lastLng, lastAltitude);
    }

    return {
        radius: horizontalCanopyDistance,
        radiusFull: horizontalCanopyDistanceFull,
        displacement: centerDisplacement,
        displacementFull: centerDisplacementFull,
        direction: displacementDirection
    };
}

function updateJumpCircle(lat, lng, radius, radiusFull, displacement, displacementFull, direction) {
    if (!map || !lat || !lng) {
        console.warn('Map or coordinates not available to update jump circles');
        return;
    }

    // Calculate new centers based on displacements and direction
    const newCenterBlue = calculateNewCenter(lat, lng, displacement, direction); // Blue circle center
    const newCenterRed = calculateNewCenter(lat, lng, displacementFull, direction); // Red circle center

    // Remove existing blue jump circle if it exists
    if (jumpCircle) {
        map.removeLayer(jumpCircle);
    }

    // Create new blue jump circle (opening altitude to downwind leg)
    jumpCircle = L.circle(newCenterBlue, {
        radius: radius, // in meters (blue circle)
        color: 'blue',
        fillColor: 'blue',
        fillOpacity: 0.2,
        weight: 2
    }).addTo(map);

    // Remove existing red jump circle if it exists
    if (jumpCircleFull) {
        map.removeLayer(jumpCircleFull);
    }

    currentMarker.setLatLng([lat, lng]);
    updateMarkerPopup(currentMarker, lat, lng, lastAltitude);

    // Create new red jump circle (full descent from opening altitude)
    jumpCircleFull = L.circle(newCenterRed, {
        radius: radiusFull, // in meters (red circle)
        color: 'red',
        fillColor: 'red',
        fillOpacity: 0.2,
        weight: 2
    }).addTo(map);
}

function calculateNewCenter(lat, lng, distance, bearing) {
    const R = 6371000; // Earth's radius in meters
    const lat1 = lat * Math.PI / 180; // Convert to radians
    const lng1 = lng * Math.PI / 180;
    const bearingRad = bearing * Math.PI / 180; // Wind FROM direction

    const delta = distance / R; // Angular distance

    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(delta) +
        Math.cos(lat1) * Math.sin(delta) * Math.cos(bearingRad));
    const lng2 = lng1 + Math.atan2(Math.sin(bearingRad) * Math.sin(delta) * Math.cos(lat1),
        Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2));

    // Convert back to degrees
    const newLat = lat2 * 180 / Math.PI;
    const newLng = lng2 * 180 / Math.PI;

    // Normalize longitude to [-180, 180]
    const normalizedLng = ((newLng + 540) % 360) - 180;

    return [newLat, normalizedLng];
}

function getTemperatureUnit() {
    return document.querySelector('input[name="temperatureUnit"]:checked')?.value || 'C';
}

function getHeightUnit() {
    return document.querySelector('input[name="heightUnit"]:checked')?.value || 'm';
}

function getCoordinateFormat() {
    return document.querySelector('input[name="coordFormat"]:checked')?.value || 'Decimal';
}

function getInterpolationStep() {
    return parseInt(document.getElementById('interpStepSelect').value) || 200;
}

function updateHeightUnitLabels() {
    const heightUnit = getHeightUnit();
    const refLevel = document.querySelector('input[name="refLevel"]:checked')?.value || 'AGL';
    const stepLabel = document.querySelector('#controls-row label[for="interpStepSelect"]');
    stepLabel.textContent = `Step (${heightUnit}):`;

    const meanWindResult = document.getElementById('meanWindResult');
    if (meanWindResult && meanWindResult.innerHTML) {
        const currentText = meanWindResult.innerHTML;
        const regex = /\((\d+)-(\d+) m\b[^)]*\)/;
        if (regex.test(currentText)) {
            const [_, lower, upper] = currentText.match(regex);
            const newLower = Utils.convertHeight(parseFloat(lower), heightUnit);
            const newUpper = Utils.convertHeight(parseFloat(upper), heightUnit);
            meanWindResult.innerHTML = currentText.replace(regex, `(${Math.round(newLower)}-${Math.round(newUpper)} ${heightUnit} ${refLevel})`);
        }
    }

    const lowerLabel = document.querySelector('label[for="lowerLimit"]');
    const upperLabel = document.querySelector('label[for="upperLimit"]');
    lowerLabel.textContent = `Lower Limit (${heightUnit}):`;
    upperLabel.textContent = `Upper Limit (${heightUnit}):`;
}

function getWindSpeedUnit() {
    return document.querySelector('input[name="windUnit"]:checked')?.value || 'kt';
}

function updateWindUnitLabels() {
    const windSpeedUnit = getWindSpeedUnit();
    const meanWindResult = document.getElementById('meanWindResult');
    if (meanWindResult && meanWindResult.innerHTML) {
        const currentText = meanWindResult.innerHTML;
        const regex = /: (\d+(?:\.\d+)?)\s*([a-zA-Z\/]+)$/; // Match after colon and degrees
        if (regex.test(currentText)) {
            const [_, speedValue, currentUnit] = currentText.match(regex);
            const numericSpeed = parseFloat(speedValue);
            if (!isNaN(numericSpeed)) {
                const newSpeed = Utils.convertWind(numericSpeed, windSpeedUnit, currentUnit);
                const formattedSpeed = newSpeed === 'N/A' ? 'N/A' : (windSpeedUnit === 'bft' ? Math.round(newSpeed) : newSpeed.toFixed(1));
                meanWindResult.innerHTML = currentText.replace(regex, `: ${formattedSpeed} ${windSpeedUnit}`);
            }
        }
    }
}

function generateWindBarb(direction, speedKt) {
    // Convert speed to knots if not already (assuming speedKt is in knots)
    const speed = Math.round(speedKt);

    // SVG dimensions
    const width = 40;
    const height = 40;
    const centerX = width / 2;
    const centerY = height / 2;
    const staffLength = 20;

    // Determine hemisphere based on latitude (lastLat)
    const isNorthernHemisphere = typeof lastLat === 'number' && !isNaN(lastLat) ? lastLat >= 0 : true;
    const barbSide = isNorthernHemisphere ? -1 : 1; // -1 for left (Northern), 1 for right (Southern)

    // Calculate barb components
    let flags = Math.floor(speed / 50); // 50 kt flags
    let remaining = speed % 50;
    let fullBarbs = Math.floor(remaining / 10); // 10 kt full barbs
    let halfBarbs = Math.floor((remaining % 10) / 5); // 5 kt half barbs

    // Adjust for small speeds
    if (speed < 5) {
        fullBarbs = 0;
        halfBarbs = 0;
    } else if (speed < 10 && halfBarbs > 0) {
        halfBarbs = 1; // Ensure at least one half barb for 5-9 kt
    }

    // Start SVG
    let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;

    // Rotate based on wind direction (wind *from* direction)
    const rotation = direction + 180; // Staff points toward wind source (tip at origin)
    svg += `<g transform="translate(${centerX}, ${centerY}) rotate(${rotation})">`;

    // Draw the staff (vertical line, base at bottom, tip at top toward the source)
    svg += `<line x1="0" y1="${staffLength / 2}" x2="0" y2="${-staffLength / 2}" stroke="black" stroke-width="1"/>`;

    // Draw barbs on the appropriate side, at the base of the staff
    let yPos = staffLength / 2; // Start at the base (wind blowing toward this end)
    const barbSpacing = 4;

    // Flags (50 kt) - Triangle with side attached to staff, pointing to the correct side
    for (let i = 0; i < flags; i++) {
        svg += `<polygon points="0,${yPos - 5} 0,${yPos + 5} ${10 * barbSide},${yPos}" fill="black"/>`;
        yPos -= barbSpacing + 5; // Move up the staff (toward the tip)
    }

    // Full barbs (10 kt) - Straight to the correct side (perpendicular)
    for (let i = 0; i < fullBarbs; i++) {
        svg += `<line x1="0" y1="${yPos}" x2="${10 * barbSide}" y2="${yPos}" stroke="black" stroke-width="1"/>`;
        yPos -= barbSpacing;
    }

    // Half barbs (5 kt) - Straight to the correct side (perpendicular)
    if (halfBarbs > 0) {
        svg += `<line x1="0" y1="${yPos}" x2="${5 * barbSide}" y2="${yPos}" stroke="black" stroke-width="1"/>`;
    }

    // Circle for calm winds (< 5 kt)
    if (speed < 5) {
        svg += `<circle cx="0" cy="0" r="3" fill="none" stroke="black" stroke-width="1"/>`;
    }

    svg += `</g></svg>`;
    return svg;
}

function createCustomMarker(lat, lng) {
    const customIcon = L.icon({
        iconUrl: 'favicon.ico',
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32],
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        shadowSize: [41, 41],
        shadowAnchor: [13, 32]
    });
    return L.marker([lat, lng], {
        icon: customIcon,
        draggable: true
    });
}

function attachMarkerDragend(marker) {
    marker.on('dragend', async (e) => {
        const position = marker.getLatLng();
        lastLat = position.lat;
        lastLng = position.lng;
        lastAltitude = await getAltitude(lastLat, lastLng);
        updateMarkerPopup(marker, lastLat, lastLng, lastAltitude);
        if (userSettings.calculateJump) calculateJump();
        recenterMap();

        const slider = document.getElementById('timeSlider');
        const currentIndex = parseInt(slider.value) || 0;
        const currentTime = weatherData?.time?.[currentIndex] || null;

        document.getElementById('info').innerHTML = `Fetching weather and models...`;
        const availableModels = await checkAvailableModels(lastLat, lastLng);
        if (availableModels.length > 0) {
            await fetchWeather(lastLat, lastLng, currentTime);
            updateModelRunInfo();
            if (lastAltitude !== 'N/A') calculateMeanWind();
            updateLandingPattern();
        } else {
            document.getElementById('info').innerHTML = `No models available.`;
        }
    });
}

function updateMarkerPopup(marker, lat, lng, altitude) {
    console.log('Updating marker popup:', { lat, lng, altitude, format: getCoordinateFormat() });
    const coordFormat = getCoordinateFormat();
    const coords = Utils.convertCoords(lat, lng, coordFormat);
    let popupContent;
    if (coordFormat === 'MGRS') {
        popupContent = `MGRS: ${coords.lat}<br>Alt: ${altitude}m`;
    } else {
        popupContent = `Lat: ${coords.lat}<br>Lng: ${coords.lng}<br>Alt: ${altitude}m`;
    }
    // Check if the marker already has a popup bound; if not, bind one
    if (!marker.getPopup()) {
        marker.bindPopup(popupContent);
    } else {
        marker.setPopupContent(popupContent);
    }
    marker.openPopup();
}

async function getDisplayTime(utcTimeStr) {
    const timeZone = document.querySelector('input[name="timeZone"]:checked')?.value || 'Z';
    if (timeZone === 'Z' || !lastLat || !lastLng) {
        return Utils.formatTime(utcTimeStr); // Synchronous
    } else {
        return await Utils.formatLocalTime(utcTimeStr, lastLat, lastLng); // Async
    }
}

async function fetchWeatherForLocation(lat, lng, currentTime = null) {
    document.getElementById('info').innerHTML = `Fetching weather and models...`;
    const availableModels = await checkAvailableModels(lat, lng);
    if (availableModels.length > 0) {
        await fetchWeather(lat, lng, currentTime);
        updateModelRunInfo();
        if (lastAltitude !== 'N/A') calculateMeanWind();
        updateLandingPattern();
    } else {
        document.getElementById('info').innerHTML = `No models available.`;
    }
}

// Initialize the map and center it on the user's location if available
function initMap() {
    const defaultCenter = [48.0179, 11.1923];
    const defaultZoom = 10;

    map = L.map('map', {
        center: defaultCenter,
        zoom: defaultZoom,
        zoomControl: false // Disable default zoom control
    });

    // Define base layers
    const baseMaps = {
        "OpenStreetMap": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }),
        "OpenTopoMap": L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            maxZoom: 17,
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a>, <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'
        }),
        "Esri Satellite": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: '© Esri, USDA, USGS'
        }),
        "Esri Street": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: '© Esri, USGS'
        }),
        "Esri Topo": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: '© Esri, USGS'
        })
    };

    // Add Open-Meteo attribution to the map
    const openMeteoAttribution = 'Weather data by <a href="https://open-meteo.com">Open-Meteo</a>';
    map.attributionControl.addAttribution(openMeteoAttribution);

    const selectedBaseMap = userSettings.baseMap in baseMaps ? userSettings.baseMap : "Esri Street";
    const fallbackBaseMap = "OpenStreetMap"; // Fallback

    const layer = baseMaps[selectedBaseMap];
    layer.on('tileerror', () => {
        console.warn(`${selectedBaseMap} tiles failed to load, switching to ${fallbackBaseMap}`);
        if (map.hasLayer(layer)) {
            map.removeLayer(layer);
            baseMaps[fallbackBaseMap].addTo(map);
            userSettings.baseMap = fallbackBaseMap; // save Fallback 
            saveSettings();
        }
    });

    layer.addTo(map);
    // 1. Map tiles (layer control)
    L.control.layers(baseMaps, null, { position: 'topright' }).addTo(map);

    map.on('baselayerchange', function (e) {
        userSettings.baseMap = e.name;
        saveSettings();
        console.log(`Base map changed to: ${e.name}`);
    });

    // 2. Zoom control
    L.control.zoom({ position: 'topright' }).addTo(map);

    // 3. Polyline measure control
    L.control.polylineMeasure({
        position: 'topright',
        unit: 'kilometres',
        showBearings: true,
        clearMeasurementsOnStop: false,
        showClearControl: true,
        showUnitControl: true,
        tooltipTextFinish: 'Click to finish the line<br>',
        tooltipTextDelete: 'Shift-click to delete point',
        tooltipTextMove: 'Drag to move point<br>',
        tooltipTextResume: 'Click to resume line<br>',
        tooltipTextAdd: 'Click to add point<br>',
        measureControlTitleOn: 'Start measuring distance and bearing',
        measureControlTitleOff: 'Stop measuring'
    }).addTo(map);

    // Add scale control
    L.control.scale({
        position: 'bottomleft', // You can change this to 'topleft', 'topright', 'bottomright'
        metric: true,          // Show metric units (meters/kilometers)
        imperial: true,        // Show imperial units (feet/miles)
        maxWidth: 100          // Maximum width of the scale bar in pixels
    }).addTo(map);

    // Initial marker setup
    const initialAltitude = 'N/A';
    currentMarker = createCustomMarker(defaultCenter[0], defaultCenter[1]).addTo(map);
    attachMarkerDragend(currentMarker);
    currentMarker.bindPopup(''); // Bind an empty popup
    updateMarkerPopup(currentMarker, defaultCenter[0], defaultCenter[1], initialAltitude);
    if (userSettings.calculateJump) {
        calculateJump();
    }

    recenterMap();

    // Geolocation handling
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const userCoords = [position.coords.latitude, position.coords.longitude];
                map.setView(userCoords, defaultZoom);

                if (currentMarker) currentMarker.remove();
                lastLat = position.coords.latitude;
                lastLng = position.coords.longitude;
                lastAltitude = await getAltitude(lastLat, lastLng);

                currentMarker = createCustomMarker(lastLat, lastLat).addTo(map);
                attachMarkerDragend(currentMarker);
                updateMarkerPopup(currentMarker, lastLat, lastLng, lastAltitude);
                if (userSettings.calculateJump) {
                    calculateJump();
                }

                recenterMap();

                // In initMap() (geolocation success):
            await fetchWeatherForLocation(lastLat, lastLng);
            },
            async (error) => {
                console.warn(`Geolocation error: ${error.message}`);
                Utils.handleError('Unable to retrieve your location. Using default location.');
                lastLat = defaultCenter[0];
                lastLng = defaultCenter[1];
                lastAltitude = await getAltitude(lastLat, lastLng);
                updateMarkerPopup(currentMarker, lastLat, lastLng, lastAltitude);

                recenterMap();
                await fetchWeatherForLocation(lat, lng);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    } else {
        console.warn('Geolocation not supported.');
        Utils.handleError('Geolocation not supported. Using default location.');
        lastLat = defaultCenter[0];
        lastLng = defaultCenter[1];
        lastAltitude = getAltitude(lastLat, lastLng);
        updateMarkerPopup(currentMarker, lastLat, lastLng, lastAltitude);
        recenterMap();
        fetchWeatherForLocation(lat, lng);
    }
    // Create a custom Leaflet control
    L.Control.Coordinates = L.Control.extend({
        options: {
            position: 'bottomleft' // Places it in the bottom-left corner
        },
        onAdd: function (map) {
            var container = L.DomUtil.create('div', 'leaflet-control-coordinates');
            container.style.background = 'rgba(255, 255, 255, 0.8)';
            container.style.padding = '5px';
            container.style.borderRadius = '4px';
            container.style.boxShadow = '0 2px 5px rgba(0, 0, 0, 0.2)';
            container.innerHTML = 'Move mouse over map';
            return container;
        }
    });

    // Add the control to the map
    var coordsControl = new L.Control.Coordinates();
    coordsControl.addTo(map);

    // Update coordinates on mousemove
    map.on('mousemove', function (e) {
        const coordFormat = getCoordinateFormat();
        if (coordFormat === 'MGRS') {

            var mgrs = Utils.decimalToMgrs(e.latlng.lat, e.latlng.lng);
            coordsControl.getContainer().innerHTML = `MGRS: ${mgrs}`;
        } else {
            var lat = e.latlng.lat.toFixed(5);
            var lng = e.latlng.lng.toFixed(5);
            coordsControl.getContainer().innerHTML = `Lat: ${lat}, Lng: ${lng}`;
        }
    });

    // Reset text on mouseout
    map.on('mouseout', function () {
        coordsControl.getContainer().innerHTML = 'Move mouse over map';
    });


    // Map click event for placing new marker
    map.on('dblclick', async (e) => {
        const { lat, lng } = e.latlng;
        lastLat = lat;
        lastLng = lng;
        lastAltitude = await getAltitude(lat, lng);

        // Remove existing marker and create a new one
        if (currentMarker) currentMarker.remove();
        currentMarker = createCustomMarker(lat, lng).addTo(map);
        attachMarkerDragend(currentMarker);

        // Update popup for the new marker
        updateMarkerPopup(currentMarker, lastLat, lastLng, lastAltitude);
        if (userSettings.calculateJump) {
            calculateJump();
        }

        recenterMap();

        // Preserve the current slider time before fetching new data
        const currentTime = weatherData?.time?.[parseInt(document.getElementById('timeSlider').value) || 0] || null;
        await fetchWeatherForLocation(lat, lng, currentTime);
    });

    let lastTapTime = 0;
    const tapThreshold = 300; // milliseconds between taps for a double-tap
    const mapContainer = map.getContainer();

    mapContainer.addEventListener('touchstart', async (e) => {
        if (e.touches.length !== 1) return; // Only handle single-finger taps

        const currentTime = new Date().getTime();
        const timeSinceLastTap = currentTime - lastTapTime;

        if (timeSinceLastTap < tapThreshold && timeSinceLastTap > 0) {
            e.preventDefault(); // Prevent default zoom behavior

            // Convert touch coordinates to map latlng
            const rect = mapContainer.getBoundingClientRect();
            const touchX = e.touches[0].clientX - rect.left;
            const touchY = e.touches[0].clientY - rect.top;
            const latlng = map.containerPointToLatLng([touchX, touchY]);

            const { lat, lng } = latlng;
            lastLat = lat;
            lastLng = lng;
            lastAltitude = await getAltitude(lat, lng);

            if (currentMarker) currentMarker.remove();
            currentMarker = createCustomMarker(lat, lng).addTo(map);
            attachMarkerDragend(currentMarker);

            updateMarkerPopup(currentMarker, lastLat, lastLng, lastAltitude);
            if (userSettings.calculateJump) {
                calculateJump();
            }

            recenterMap();

            const slider = document.getElementById('timeSlider');
            const currentIndex = parseInt(slider.value) || 0;
            const currentTime = weatherData?.time?.[currentIndex] || null;
            await fetchWeatherForLocation(lat, lng);
        }

        lastTapTime = currentTime;
    }, { passive: false }); // Set passive: false to allow preventDefault()

}

function recenterMap() {
    if (map && currentMarker) {
        map.invalidateSize(); // Update map dimensions
        map.panTo(currentMarker.getLatLng()); // Center on marker
        console.log('Map recentered on marker at:', currentMarker.getLatLng());
    } else {
        console.warn('Cannot recenter map: map or marker not defined');
    }
}

async function getAltitude(lat, lng) {
    const { elevation } = await Utils.getLocationData(lat, lng);
    console.log('Fetched elevation from Open-Meteo:', elevation);
    return elevation !== 'N/A' ? elevation : 'N/A';
}

async function fetchWeather(lat, lon, currentTime = null) {
    try {
        document.getElementById('loading').style.display = 'block';
        const modelSelect = document.getElementById('modelSelect');
        const modelMap = {
            'icon_seamless': 'dwd_icon',
            'icon_global': 'dwd_icon',
            'icon_eu': 'dwd_icon_eu',
            'icon_d2': 'dwd_icon_d2',
            'ecmwf_ifs025': 'ecmwf_ifs025',
            'ecmwf_aifs025': 'ecmwf_aifs025_single', // Note: should this be 'ecmwf_aifs025'?
            'gfs_seamless': 'ncep_gfs013',
            'gfs_global': 'ncep_gfs025',
            'gfs_hrrr': 'ncep_hrrr_conus',
            'arome_france': 'meteofrance_arome_france0025',
            'gem_hrdps_continental': 'cmc_gem_hrdps',
            'gem_regional': 'cmc_gem_rdps'
        };
        const model = modelMap[modelSelect.value] || modelSelect.value;

        // Fetch model run time
        console.log('Fetching meta for model:', model);
        const metaResponse = await fetch(`https://api.open-meteo.com/data/${model}/static/meta.json`);
        if (!metaResponse.ok) {
            const errorText = await metaResponse.text();
            console.error('Meta fetch failed:', metaResponse.status, errorText);
            throw new Error(`Meta fetch failed: ${metaResponse.status} - ${errorText}`);
        }
        const metaData = await metaResponse.json();
        console.log('Meta data:', metaData);

        const runDate = new Date(metaData.last_run_initialisation_time * 1000);
        const utcNow = new Date(Date.UTC(
            new Date().getUTCFullYear(),
            new Date().getUTCMonth(),
            new Date().getUTCDate(),
            new Date().getUTCHours(),
            new Date().getUTCMinutes(),
            new Date().getUTCSeconds()
        ));
        const year = runDate.getUTCFullYear();
        const month = String(runDate.getUTCMonth() + 1).padStart(2, '0');
        const day = String(runDate.getUTCDate()).padStart(2, '0');
        const hour = String(runDate.getUTCHours()).padStart(2, '0');
        const minute = String(runDate.getUTCMinutes()).padStart(2, '0');
        lastModelRun = `${year}-${month}-${day} ${hour}${minute}Z`;
        console.log('Model Run Time (UTC):', lastModelRun, runDate);

        // Calculate forecast start time with proper day increment
        let newHour = (runDate.getUTCHours() + 6) % 24;
        let newDay = runDate.getUTCDate() + Math.floor((runDate.getUTCHours() + 6) / 24);
        let newMonth = runDate.getUTCMonth();
        let newYear = runDate.getUTCFullYear();
        if (newDay > new Date(newYear, newMonth + 1, 0).getUTCDate()) {
            newDay = 1;
            newMonth = (newMonth + 1) % 12;
            if (newMonth === 0) newYear++;
        }
        let startDate = new Date(Date.UTC(newYear, newMonth, newDay, newHour));
        console.log('Calculated startDate:', startDate.toISOString());
        if (startDate > utcNow) {
            console.warn(`Forecast start ${Utils.formatTime(startDate.toISOString())} is in the future; using current UTC date instead.`);
            startDate = utcNow;
        }
        const startYear = startDate.getUTCFullYear();
        const startMonth = String(startDate.getUTCMonth() + 1).padStart(2, '0');
        const startDay = String(startDate.getUTCDate()).padStart(2, '0');
        const startDateStr = `${startYear}-${startMonth}-${startDay}`;

        const endDate = new Date(Date.UTC(
            startDate.getUTCFullYear(),
            startDate.getUTCMonth(),
            startDate.getUTCDate() + (modelSelect.value === 'icon_d2' ? 2 : 7)
        ));
        const endYear = endDate.getUTCFullYear();
        const endMonth = String(endDate.getUTCMonth() + 1).padStart(2, '0');
        const endDay = String(endDate.getUTCDate()).padStart(2, '0');
        const endDateStr = `${endYear}-${endMonth}-${endDay}`;

        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
            `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,` +
            `temperature_1000hPa,relative_humidity_1000hPa,wind_speed_1000hPa,wind_direction_1000hPa,geopotential_height_1000hPa,` +
            `temperature_950hPa,relative_humidity_950hPa,wind_speed_950hPa,wind_direction_950hPa,geopotential_height_950hPa,` +
            `temperature_925hPa,relative_humidity_925hPa,wind_speed_925hPa,wind_direction_925hPa,geopotential_height_925hPa,` +
            `temperature_900hPa,relative_humidity_900hPa,wind_speed_900hPa,wind_direction_900hPa,geopotential_height_900hPa,` +
            `temperature_850hPa,relative_humidity_850hPa,wind_speed_850hPa,wind_direction_850hPa,geopotential_height_850hPa,` +
            `temperature_800hPa,relative_humidity_800hPa,wind_speed_800hPa,wind_direction_800hPa,geopotential_height_800hPa,` +
            `temperature_700hPa,relative_humidity_700hPa,wind_speed_700hPa,wind_direction_700hPa,geopotential_height_700hPa,` +
            `temperature_600hPa,relative_humidity_600hPa,wind_speed_600hPa,wind_direction_600hPa,geopotential_height_600hPa,` +
            `temperature_500hPa,relative_humidity_500hPa,wind_speed_500hPa,wind_direction_500hPa,geopotential_height_500hPa,` +
            `temperature_400hPa,relative_humidity_400hPa,wind_speed_400hPa,wind_direction_400hPa,geopotential_height_400hPa,` +
            `temperature_300hPa,relative_humidity_300hPa,wind_speed_300hPa,wind_direction_300hPa,geopotential_height_300hPa,` +
            `temperature_250hPa,relative_humidity_250hPa,wind_speed_250hPa,wind_direction_250hPa,geopotential_height_250hPa,` +
            `temperature_200hPa,relative_humidity_200hPa,wind_speed_200hPa,wind_direction_200hPa,geopotential_height_200hPa` +
            `&models=${modelSelect.value}&start_date=${startDateStr}&end_date=${endDateStr}`;

        console.log('Fetching weather from (UTC):', url);
        const response = await fetch(url);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Weather fetch failed:', response.status, errorText);
            throw new Error(`HTTP error! Status: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        console.log('Raw API Response:', data);
        console.log('Raw ECMWF API Response:', data.hourly);

        // Check if hourly data exists
        if (!data.hourly || !data.hourly.time) {
            console.error('No hourly data in response:', data);
            throw new Error('No hourly data returned from API');
        }

        const targetIndex = 0;
        const firstTime = data.hourly.time[targetIndex];
        console.log(`Using first available time (UTC): ${firstTime} at index: ${targetIndex}`);

        // Truncation logic remains unchanged
        const criticalSurfaceVars = ['temperature_2m', 'wind_speed_10m', 'wind_direction_10m'];
        let lastValidIndex = data.hourly.time.length - 1;

        for (let i = data.hourly.time.length - 1; i >= 0; i--) {
            const surfaceValid = criticalSurfaceVars.every(variable => {
                const value = data.hourly[variable]?.[i];
                const isValid = value !== null && value !== undefined && !isNaN(value);
                if (!isValid) console.log(`Missing or invalid ${variable} at index ${i} for ${modelSelect.value}`);
                return isValid;
            });
            if (!surfaceValid) {
                lastValidIndex = i - 1;
                console.warn(`Trimming at index ${i} due to missing surface data`);
            } else {
                break;
            }
        }

        if (lastValidIndex < 0) {
            console.warn('No valid surface data found; defaulting to first index.');
            lastValidIndex = 0;
        }

        console.log('Last valid index after truncation:', lastValidIndex, 'Original length:', data.hourly.time.length);

        // Slice the data
        weatherData = {
            time: data.hourly.time.slice(targetIndex, lastValidIndex + 1),
            temperature_2m: data.hourly.temperature_2m?.slice(targetIndex, lastValidIndex + 1) || [],
            relative_humidity_2m: data.hourly.relative_humidity_2m?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_speed_10m: data.hourly.wind_speed_10m?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_direction_10m: data.hourly.wind_direction_10m?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_gusts_10m: data.hourly.wind_gusts_10m?.slice(targetIndex, lastValidIndex + 1) || [],
            temperature_1000hPa: data.hourly.temperature_1000hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            relative_humidity_1000hPa: data.hourly.relative_humidity_1000hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_speed_1000hPa: data.hourly.wind_speed_1000hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_direction_1000hPa: data.hourly.wind_direction_1000hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            geopotential_height_1000hPa: data.hourly.geopotential_height_1000hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            temperature_950hPa: data.hourly.temperature_950hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            relative_humidity_950hPa: data.hourly.relative_humidity_950hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_speed_950hPa: data.hourly.wind_speed_950hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_direction_950hPa: data.hourly.wind_direction_950hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            geopotential_height_950hPa: data.hourly.geopotential_height_950hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            temperature_925hPa: data.hourly.temperature_925hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            relative_humidity_925hPa: data.hourly.relative_humidity_925hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_speed_925hPa: data.hourly.wind_speed_925hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_direction_925hPa: data.hourly.wind_direction_925hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            geopotential_height_925hPa: data.hourly.geopotential_height_925hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            temperature_900hPa: data.hourly.temperature_900hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            relative_humidity_900hPa: data.hourly.relative_humidity_900hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_speed_900hPa: data.hourly.wind_speed_900hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_direction_900hPa: data.hourly.wind_direction_900hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            geopotential_height_900hPa: data.hourly.geopotential_height_900hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            temperature_850hPa: data.hourly.temperature_850hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            relative_humidity_850hPa: data.hourly.relative_humidity_850hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_speed_850hPa: data.hourly.wind_speed_850hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_direction_850hPa: data.hourly.wind_direction_850hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            geopotential_height_850hPa: data.hourly.geopotential_height_850hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            temperature_800hPa: data.hourly.temperature_800hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            relative_humidity_800hPa: data.hourly.relative_humidity_800hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_speed_800hPa: data.hourly.wind_speed_800hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_direction_800hPa: data.hourly.wind_direction_800hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            geopotential_height_800hPa: data.hourly.geopotential_height_800hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            temperature_700hPa: data.hourly.temperature_700hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            relative_humidity_700hPa: data.hourly.relative_humidity_700hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_speed_700hPa: data.hourly.wind_speed_700hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_direction_700hPa: data.hourly.wind_direction_700hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            geopotential_height_700hPa: data.hourly.geopotential_height_700hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            temperature_600hPa: data.hourly.temperature_600hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            relative_humidity_600hPa: data.hourly.relative_humidity_600hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_speed_600hPa: data.hourly.wind_speed_600hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_direction_600hPa: data.hourly.wind_direction_600hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            geopotential_height_600hPa: data.hourly.geopotential_height_600hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            temperature_500hPa: data.hourly.temperature_500hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            relative_humidity_500hPa: data.hourly.relative_humidity_500hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_speed_500hPa: data.hourly.wind_speed_500hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_direction_500hPa: data.hourly.wind_direction_500hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            geopotential_height_500hPa: data.hourly.geopotential_height_500hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            temperature_400hPa: data.hourly.temperature_400hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            relative_humidity_400hPa: data.hourly.relative_humidity_400hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_speed_400hPa: data.hourly.wind_speed_400hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_direction_400hPa: data.hourly.wind_direction_400hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            geopotential_height_400hPa: data.hourly.geopotential_height_400hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            temperature_300hPa: data.hourly.temperature_300hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            relative_humidity_300hPa: data.hourly.relative_humidity_300hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_speed_300hPa: data.hourly.wind_speed_300hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_direction_300hPa: data.hourly.wind_direction_300hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            geopotential_height_300hPa: data.hourly.geopotential_height_300hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            temperature_250hPa: data.hourly.temperature_250hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            relative_humidity_250hPa: data.hourly.relative_humidity_250hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_speed_250hPa: data.hourly.wind_speed_250hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_direction_250hPa: data.hourly.wind_direction_250hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            geopotential_height_250hPa: data.hourly.geopotential_height_250hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            temperature_200hPa: data.hourly.temperature_200hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            relative_humidity_200hPa: data.hourly.relative_humidity_200hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_speed_200hPa: data.hourly.wind_speed_200hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_direction_200hPa: data.hourly.wind_direction_200hPa?.slice(targetIndex, lastValidIndex + 1) || [],
            geopotential_height_200hPa: data.hourly.geopotential_height_200hPa?.slice(targetIndex, lastValidIndex + 1) || []
        } || {};

        // Validate UTC
        /*if (weatherData.time && weatherData.time.length > 0 && !weatherData.time[0].endsWith('Z')) {
            console.warn('Weather data time not in UTC format:', weatherData.time[0]);
        }*/
        console.log('weatherData.wind_speed_1000hPa:', weatherData.wind_speed_1000hPa);
        console.log('weatherData.wind_direction_1000hPa:', weatherData.wind_direction_1000hPa);
        console.log('WeatherData times (UTC):', weatherData.time.slice(0, 5));
        console.log('Processed weatherData:', weatherData);
        // Log the filtered weatherData (unchanged logging code omitted for brevity)

        const slider = document.getElementById('timeSlider');
        slider.min = 0;
        slider.max = weatherData.time.length - 1;

        if (weatherData.time.length <= 1) {
            console.warn('Only one time step available, disabling slider interactivity');
            slider.disabled = true;
            slider.style.opacity = '0.5';
            slider.style.cursor = 'not-allowed';
            document.getElementById('info').innerHTML += '<br><strong>Note:</strong> Only one forecast time available. Slider disabled.';
        } else {
            slider.disabled = false;
            slider.style.opacity = '1';
            slider.style.cursor = 'pointer';
        }

        // Set the slider to the closest time to currentTime (if provided and valid)
        let newSliderIndex = 0;
        if (currentTime && weatherData.time.length > 0 && currentTime !== null) {
            const currentTimestamp = new Date(currentTime).getTime();
            let minDiff = Infinity;
            weatherData.time.forEach((time, index) => {
                const timeTimestamp = new Date(time).getTime();
                const diff = Math.abs(timeTimestamp - currentTimestamp);
                if (diff < minDiff) {
                    minDiff = diff;
                    newSliderIndex = index;
                }
            });
            console.log(`Closest time to ${currentTime}: ${weatherData.time[newSliderIndex]} at index ${newSliderIndex}`);
        } else {
            console.log('No valid current time provided or invalid, defaulting to index 0');
        }

        slider.value = Math.min(newSliderIndex, weatherData.time.length - 1);
        console.log('Slider set to index:', slider.value, 'corresponding to:', weatherData.time[slider.value]);

        // Set landingWindDir
        landingWindDir = weatherData.wind_direction_10m[slider.value] || null;
        console.log('Initial landingWindDir set to:', landingWindDir);

        // Update custom landing direction inputs
        const customLandingDirectionLLInput = document.getElementById('customLandingDirectionLL');
        const customLandingDirectionRRInput = document.getElementById('customLandingDirectionRR');
        if (customLandingDirectionLLInput && customLandingDirectionRRInput && landingWindDir !== null) {
            customLandingDirectionLLInput.value = Math.round(landingWindDir);
            customLandingDirectionRRInput.value = Math.round(landingWindDir);
        }

        // Update UI
        await updateWeatherDisplay(slider.value, currentTime);
        updateLandingPattern();
        console.log('UI updated with index:', slider.value, 'time:', weatherData.time[slider.value]);

        // Validation timeout (unchanged)
        setTimeout(() => {
            const slider = document.getElementById('timeSlider');
            console.log('SetTimeout triggered - Slider state: min:', slider.min, 'max:', slider.max, 'value:', slider.value,
                'weatherData.time.length:', weatherData?.time?.length);
            const displayedTime = document.getElementById('selectedTime').innerHTML.replace('Selected Time: ', '');
            const expectedTime = Utils.formatTime(weatherData.time[slider.value]);
            if (displayedTime !== expectedTime || !weatherData.time[slider.value]) {
                console.error(`UI mismatch or invalid time: Displayed ${displayedTime} but expected ${expectedTime}, forcing correction`);
                const validIndex = Math.min(slider.value, weatherData.time.length - 1);
                slider.value = validIndex >= 0 ? validIndex : 0;
                updateWeatherDisplay(slider.value, currentTime);
                document.getElementById('selectedTime').innerHTML = `Selected Time: ${weatherData.time[slider.value].replace('T', ' ').slice(0, -3)}Z`;
                document.getElementById('info').innerHTML = '';
                updateWeatherDisplay(slider.value, currentTime);
            }
            if (weatherData.time.length > 1) {
                if (slider.disabled || slider.style.pointerEvents === 'none') {
                    console.warn('Slider was disabled or blocked, fixing now');
                    slider.disabled = false;
                    slider.style.pointerEvents = 'auto';
                    slider.style.opacity = '1';
                    slider.style.cursor = 'pointer';
                }
                console.log('Slider enabled, final value:', slider.value, 'max:', slider.max);
            }
        }, 2000);

        document.getElementById('loading').style.display = 'none';
        return data;
    } catch (error) {
        weatherData = weatherData || {};
        document.getElementById('loading').style.display = 'none';
        console.error("Weather fetch error:", error);
        console.error("Weather fetch error for ECMWF:", error);
        Utils.handleError(`Could not load ECMWF weather data: ${error.message}`);
        Utils.handleError(`Could not load weather data: ${error.message}`);
        throw error;
    }
}

async function updateWeatherDisplay(index, originalTime = null) {
    if (!weatherData || !weatherData.time || index < 0 || index >= weatherData.time.length) {
        console.error('No weather data available or index out of bounds:', index);
        document.getElementById('info').innerHTML = 'No weather data available';
        document.getElementById('selectedTime').innerHTML = 'Selected Time: ';
        const slider = document.getElementById('timeSlider');
        if (slider) slider.value = 0;
        return;
    }

    // Set landingWindDir to the surface wind direction at the current index
    landingWindDir = weatherData.wind_direction_10m[index] || null;
    console.log('landingWindDir updated to:', landingWindDir);

    // Update custom landing direction inputs with the new surface wind direction
    const customLandingDirectionLLInput = document.getElementById('customLandingDirectionLL');
    const customLandingDirectionRRInput = document.getElementById('customLandingDirectionRR');
    if (customLandingDirectionLLInput && customLandingDirectionRRInput && landingWindDir !== null) {
        customLandingDirectionLLInput.value = Math.round(landingWindDir);
        customLandingDirectionRRInput.value = Math.round(landingWindDir);
    }

    const refLevel = document.querySelector('input[name="refLevel"]:checked')?.value || 'AGL';
    const heightUnit = getHeightUnit();
    const windSpeedUnit = getWindSpeedUnit();
    const temperatureUnit = getTemperatureUnit();
    const time = await getDisplayTime(weatherData.time[index]); // Await is fine here because function is async
    const interpolatedData = interpolateWeatherData(index);

    let output = `<table>`;
    output += `<tr><th>Height (${heightUnit} ${refLevel})</th><th>Dir (deg)</th><th>Spd (${windSpeedUnit})</th><th>Wind</th><th>T (${temperatureUnit === 'C' ? '°C' : '°F'})</th></tr>`; interpolatedData.forEach((data, idx) => {
        const spd = parseFloat(data.spd);
        let rowClass = '';
        if (windSpeedUnit === 'bft') {
            const bft = Math.round(spd);
            if (bft <= 1) rowClass = 'wind-low';
            else if (bft <= 3) rowClass = 'wind-moderate';
            else if (bft <= 4) rowClass = 'wind-high';
            else rowClass = 'wind-very-high';
        } else {
            const spdInKt = Utils.convertWind(spd, 'kt', windSpeedUnit);
            if (spdInKt <= 3) rowClass = 'wind-low';
            else if (spdInKt <= 10) rowClass = 'wind-moderate';
            else if (spdInKt <= 16) rowClass = 'wind-high';
            else rowClass = 'wind-very-high';
        }
        const displayHeight = Utils.convertHeight(data.displayHeight, heightUnit);
        const displayTemp = Utils.convertTemperature(data.temp, temperatureUnit === 'C' ? '°C' : '°F');
        const formattedTemp = displayTemp === 'N/A' ? 'N/A' : displayTemp.toFixed(0);
        let formattedWind;
        if (idx === 0 && data.gust !== undefined && Number.isFinite(data.gust)) {
            const spdValue = windSpeedUnit === 'bft' ? Math.round(spd) : spd.toFixed(0);
            const gustValue = windSpeedUnit === 'bft' ? Math.round(data.gust) : data.gust.toFixed(0);
            formattedWind = `${spdValue} G ${gustValue}`;
        } else {
            formattedWind = data.spd === 'N/A' ? 'N/A' : (windSpeedUnit === 'bft' ? Math.round(data.spd) : data.spd.toFixed(0));
        }

        // Convert speed to knots for wind barbs
        const speedKt = Math.round(Utils.convertWind(spd, 'kt', windSpeedUnit) / 5) * 5;
        const windBarbSvg = data.dir === 'N/A' || isNaN(speedKt) ? 'N/A' : generateWindBarb(data.dir, speedKt);

        output += `<tr class="${rowClass}"><td>${Math.round(displayHeight)}</td><td>${Utils.roundToTens(data.dir)}</td><td>${formattedWind}</td><td>${windBarbSvg}</td><td>${formattedTemp}</td></tr>`;
    });
    output += `</table>`;
    document.getElementById('info').innerHTML = output;
    document.getElementById('selectedTime').innerHTML = `Selected Time: ${time}`;
    updateLandingPattern();
}

async function checkAvailableModels(lat, lon) {
    const modelList = [
        'icon_seamless', 'icon_global', 'icon_eu', 'icon_d2', 'ecmwf_ifs025', 'ecmwf_aifs025_single', 'gfs_seamless', 'gfs_global', 'gfs_hrrr', 'arome_france', 'gem_hrdps_continental', 'gem_regional'
    ];

    let availableModels = [];
    for (const model of modelList) {
        try {
            const response = await fetch(
                `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&models=${model}`
            );
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();
            if (data.hourly && data.hourly.temperature_2m && data.hourly.temperature_2m.length > 0) {
                availableModels.push(model);
            }
        } catch (error) {
            console.log(`${model} not available: ${error.message}`);
        }
    }

    const modelSelect = document.getElementById('modelSelect');
    modelSelect.innerHTML = '';
    availableModels.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model.replace('_', ' ').toUpperCase();
        modelSelect.appendChild(option);
    });

    const modelDisplay = availableModels.length > 0
        ? `<br><strong>Available Models:</strong><ul>${availableModels.map(m => `<li>${m.replace('_', ' ').toUpperCase()}</li>`).join('')}</ul>`
        : '<br><strong>Available Models:</strong> None';

    const currentContent = document.getElementById('info').innerHTML;
    document.getElementById('info').innerHTML = currentContent + modelDisplay;

    return availableModels;
}

function interpolateWeatherData(index) {
    if (!weatherData || !weatherData.time || lastAltitude === 'N/A') return [];

    const heightUnit = getHeightUnit();
    const temperatureUnit = getTemperatureUnit();
    const windSpeedUnit = getWindSpeedUnit();
    let step = parseInt(document.getElementById('interpStepSelect').value) || 200;
    step = heightUnit === 'ft' ? step / 3.28084 : step;

    const refLevel = document.querySelector('input[name="refLevel"]:checked')?.value || 'AGL';
    const baseHeight = Math.round(lastAltitude);
    const surfaceHeight = refLevel === 'AGL' ? 0 : baseHeight;

    // Surface data
    const surfaceData = {
        displayHeight: surfaceHeight,
        height: baseHeight,
        temp: weatherData.temperature_2m?.[index] ?? 'N/A',
        rh: weatherData.relative_humidity_2m?.[index] ?? 'N/A',
        dir: weatherData.wind_direction_10m?.[index] ?? 'N/A',
        spd: Utils.convertWind(weatherData.wind_speed_10m?.[index], windSpeedUnit, 'km/h') ?? 'N/A',
        spdKt: Utils.convertWind(weatherData.wind_speed_10m?.[index], 'kt', 'km/h') ?? 'N/A',
        gust: Utils.convertWind(weatherData.wind_gusts_10m?.[index], windSpeedUnit, 'km/h') ?? 'N/A',
        gustKt: Utils.convertWind(weatherData.wind_gusts_10m?.[index], 'kt', 'km/h') ?? 'N/A'
    };

    // Pre-filter valid pressure level data points
    const levels = ['200hPa', '250hPa', '300hPa', '400hPa', '500hPa', '600hPa', '700hPa', '800hPa', '850hPa', '900hPa', '925hPa', '950hPa', '1000hPa'];
    const dataPoints = levels
        .map(level => {
            const levelKey = level.replace(' ', '');
            const gh = weatherData[`geopotential_height_${levelKey}`]?.[index];
            if (gh === undefined || gh === null || isNaN(gh)) return null;
            return {
                level,
                height: Math.round(gh),
                temp: weatherData[`temperature_${levelKey}`]?.[index] ?? 'N/A',
                rh: weatherData[`relative_humidity_${levelKey}`]?.[index] ?? 'N/A',
                dir: weatherData[`wind_direction_${levelKey}`]?.[index] ?? 'N/A',
                spd: Utils.convertWind(weatherData[`wind_speed_${levelKey}`]?.[index], windSpeedUnit, 'km/h') ?? 'N/A',
                spdKt: Utils.convertWind(weatherData[`wind_speed_${levelKey}`]?.[index], 'kt', 'km/h') ?? 'N/A'
            };
        })
        .filter(point => point !== null)
        .sort((a, b) => a.height - b.height); // Ascending order

    if (!dataPoints.length) {
        const dew = Utils.calculateDewpoint(surfaceData.temp, surfaceData.rh) ?? 'N/A';
        return [{ ...surfaceData, pressure: 'N/A', dew }];
    }

    // Pressure interpolation setup: Use only levels with valid data
    const pressureLevels = dataPoints.map(p => parseInt(p.level.replace('hPa', ''))); // Ascending: [200, 250, ..., 1000]
    const pressureHeights = dataPoints.map(p => p.height); // Ascending: [11720, 10323, ..., 141]

    // Log for debugging
    console.log('Pressure levels:', pressureLevels);
    console.log('Pressure heights:', pressureHeights);

    // Prepare wind components for all pressure levels
    const uComponents = dataPoints.map(p =>
        p.spdKt === 'N/A' || p.dir === 'N/A' ? 'N/A' : -p.spdKt * Math.sin(p.dir * Math.PI / 180)
    );
    const vComponents = dataPoints.map(p =>
        p.spdKt === 'N/A' || p.dir === 'N/A' ? 'N/A' : -p.spdKt * Math.cos(p.dir * Math.PI / 180)
    );

    // Start with surface data
    const dewSurface = Utils.calculateDewpoint(surfaceData.temp, surfaceData.rh) ?? 'N/A';
    const pressureSurface = Utils.interpolatePressure(surfaceData.height, pressureLevels, pressureHeights);
    const interpolated = [{
        ...surfaceData,
        pressure: pressureSurface === 'N/A' ? 'N/A' : pressureSurface.toFixed(1),
        dew: dewSurface
    }];

    // Interpolate between valid points
    const maxHeight = dataPoints[dataPoints.length - 1].height;
    const heightRange = refLevel === 'AGL' ? maxHeight - baseHeight : maxHeight;

    for (let hp = surfaceHeight + step; hp <= heightRange; hp += step) {
        const actualHp = refLevel === 'AGL' ? hp + baseHeight : hp;
        const lower = dataPoints.filter(p => p.height <= actualHp).pop();
        const upper = dataPoints.find(p => p.height > actualHp);
        if (!lower || !upper) continue;

        const temp = Utils.gaussianInterpolation(lower.temp, upper.temp, lower.height, upper.height, actualHp);
        const rh = Math.max(0, Math.min(100, Utils.gaussianInterpolation(lower.rh, upper.rh, lower.height, upper.height, actualHp)));

        const wind = Utils.interpolateWindAtAltitude(actualHp, pressureLevels, pressureHeights, uComponents, vComponents);
        let spdKt, spd, dir;
        if (wind.u === 'Invalid input' || wind.v === 'Invalid input' || wind.u === 'Interpolation error' || wind.v === 'Interpolation error') {
            spdKt = 'N/A';
            spd = 'N/A';
            dir = 'N/A';
        } else {
            spdKt = Utils.windSpeed(wind.u, wind.v);
            spd = Utils.convertWind(spdKt, windSpeedUnit, 'kt');
            dir = Utils.windDirection(wind.u, wind.v);
        }

        const dew = Utils.calculateDewpoint(temp, rh);
        const pressure = Utils.interpolatePressure(actualHp, pressureLevels, pressureHeights);

        interpolated.push({
            height: actualHp,
            displayHeight: refLevel === 'AGL' ? hp : actualHp,
            pressure: pressure === 'N/A' ? 'N/A' : pressure.toFixed(1),
            temp: temp ?? 'N/A',
            dew: dew ?? 'N/A',
            dir: dir ?? 'N/A',
            spd: spd ?? 'N/A',
            rh: rh ?? 'N/A'
        });
    }
    console.log('Interpolated result:', interpolated);
    return interpolated;
}

function calculateMeanWind() {
    console.log('Calculating mean wind with model:', document.getElementById('modelSelect').value, 'weatherData:', weatherData);
    const index = document.getElementById('timeSlider').value || 0;
    const interpolatedData = interpolateWeatherData(index);
    let lowerLimitInput = parseFloat(document.getElementById('lowerLimit').value) || 0;
    let upperLimitInput = parseFloat(document.getElementById('upperLimit').value);
    const refLevel = document.querySelector('input[name="refLevel"]:checked')?.value || 'AGL';
    const heightUnit = getHeightUnit();
    const windSpeedUnit = getWindSpeedUnit();
    const baseHeight = Math.round(lastAltitude);

    if (!weatherData || lastAltitude === 'N/A') {
        handleError('Cannot calculate mean wind: missing data or altitude');
        return;
    }

    // Convert inputs to meters
    lowerLimitInput = heightUnit === 'ft' ? lowerLimitInput / 3.28084 : lowerLimitInput;
    upperLimitInput = heightUnit === 'ft' ? upperLimitInput / 3.28084 : upperLimitInput;

    if ((refLevel === 'AMSL') && lowerLimitInput < baseHeight) {
        Utils.handleError(`Lower limit adjusted to terrain altitude (${baseHeight} m ${refLevel}) as it cannot be below ground level in ${refLevel} mode.`);
        lowerLimitInput = baseHeight;
        document.getElementById('lowerLimit').value = Utils.convertHeight(lowerLimitInput, heightUnit);
    }

    const lowerLimit = refLevel === 'AGL' ? lowerLimitInput + baseHeight : lowerLimitInput;
    const upperLimit = refLevel === 'AGL' ? upperLimitInput + baseHeight : upperLimitInput;

    if (isNaN(lowerLimitInput) || isNaN(upperLimitInput) || lowerLimitInput >= upperLimitInput) {
        Utils.handleError('Invalid layer limits. Ensure Lower < Upper and both are numbers.');
        return;
    }

    // Check if interpolatedData is valid
    if (!interpolatedData || interpolatedData.length === 0) {
        Utils.handleError('No valid weather data available to calculate mean wind.');
        return;
    }

    // Use raw heights and speeds in knots
    const heights = interpolatedData.map(d => d.height); // Actual height in meters
    const dirs = interpolatedData.map(d => parseFloat(d.dir) || 0);
    const spdsKt = interpolatedData.map(d => Utils.convertWind(parseFloat(d.spd) || 0, 'kt', windSpeedUnit)); // Ensure knots

    const xKomponente = spdsKt.map((spd, i) => -spd * Math.sin(dirs[i] * Math.PI / 180));
    const yKomponente = spdsKt.map((spd, i) => -spd * Math.cos(dirs[i] * Math.PI / 180));

    const meanWind = Utils.calculateMeanWind(heights, xKomponente, yKomponente, lowerLimit, upperLimit);
    const [dir, spd] = meanWind;

    const roundedDir = Utils.roundToTens(dir);
    const displayLower = Math.round(Utils.convertHeight(lowerLimitInput, heightUnit));
    const displayUpper = Math.round(Utils.convertHeight(upperLimitInput, heightUnit));
    const displaySpd = Utils.convertWind(spd, windSpeedUnit, 'kt');
    const formattedSpd = displaySpd === 'N/A' ? 'N/A' : (windSpeedUnit === 'bft' ? Math.round(displaySpd) : displaySpd.toFixed(1));
    const result = `Mean wind (${displayLower}-${displayUpper} ${heightUnit} ${refLevel}): ${roundedDir}° ${formattedSpd} ${windSpeedUnit}`;
    document.getElementById('meanWindResult').innerHTML = result;
    console.log('Calculated Mean Wind:', result, 'u:', meanWind[2], 'v:', meanWind[3]);
}

function downloadTableAsAscii(format) {
    if (!weatherData || !weatherData.time) {
        Utils.handleError('No weather data available to download.');
        return;
    }

    const index = document.getElementById('timeSlider').value || 0;
    const model = document.getElementById('modelSelect').value.toUpperCase();
    const time = Utils.formatTime(weatherData.time[index]).replace(' ', '_');
    const filename = `${time}_${model}_${format}.txt`;

    // Define format-specific required settings
    const formatRequirements = {
        'ATAK': {
            interpStep: 1000,
            heightUnit: 'ft',
            refLevel: 'AGL',
            windUnit: 'kt'
        },
        'Windwatch': {
            interpStep: 100,
            heightUnit: 'ft',
            refLevel: 'AGL',
            windUnit: 'km/h'
        },
        'HEIDIS': {
            interpStep: 100,
            heightUnit: 'm',
            refLevel: 'AGL',
            temperatureUnit: 'C',
            windUnit: 'm/s'
        },
        'Customized': {} // No strict requirements, use current settings
    };

    // Store original settings
    const originalSettings = {
        interpStep: getInterpolationStep(),
        heightUnit: getHeightUnit(),
        refLevel: document.querySelector('input[name="refLevel"]:checked')?.value || 'AGL',
        windUnit: getWindSpeedUnit(),
        temperatureUnit: getTemperatureUnit()
    };

    // Get current settings
    let currentSettings = { ...originalSettings };

    // Check and adjust settings if format has specific requirements
    const requiredSettings = formatRequirements[format];
    if (requiredSettings && Object.keys(requiredSettings).length > 0) {
        let settingsAdjusted = false;

        // Check each required setting and adjust if necessary
        for (const [key, requiredValue] of Object.entries(requiredSettings)) {
            if (currentSettings[key] !== requiredValue) {
                settingsAdjusted = true;
                switch (key) {
                    case 'interpStep':
                        document.getElementById('interpStepSelect').value = requiredValue;
                        userSettings.interpStep = requiredValue;
                        break;
                    case 'heightUnit':
                        document.querySelector(`input[name="heightUnit"][value="${requiredValue}"]`).checked = true;
                        userSettings.heightUnit = requiredValue;
                        break;
                    case 'refLevel':
                        document.querySelector(`input[name="refLevel"][value="${requiredValue}"]`).checked = true;
                        userSettings.refLevel = requiredValue;
                        break;
                    case 'windUnit':
                        document.querySelector(`input[name="windUnit"][value="${requiredValue}"]`).checked = true;
                        userSettings.windUnit = requiredValue;
                        break;
                    case 'temperatureUnit':
                        document.querySelector(`input[name="temperatureUnit"][value="${requiredValue}"]`).checked = true;
                        userSettings.temperatureUnit = requiredValue;
                        break;
                }
                currentSettings[key] = requiredValue;
            }
        }

        if (settingsAdjusted) {
            saveSettings();
            console.log(`Adjusted settings for ${format} compatibility:`, requiredSettings);
            updateHeightUnitLabels(); // Update UI labels if heightUnit changes
            updateWindUnitLabels();   // Update UI labels if windUnit changes
            updateReferenceLabels();  // Update UI labels if refLevel changes
        }
    }

    // Prepare content based on format
    let content = '';
    let separator = ' '; // Default separator "space"
    const heightUnit = getHeightUnit();
    const temperatureUnit = getTemperatureUnit();
    const windSpeedUnit = getWindSpeedUnit();
    const refLevel = document.querySelector('input[name="refLevel"]:checked')?.value || 'AGL';

    if (format === 'ATAK') {
        content = `Alt Dir Spd\n${heightUnit}${refLevel}\n`;
    } else if (format === 'Windwatch') {
        const elevation = heightUnit === 'ft' ? Math.round(lastAltitude * 3.28084) : Math.round(lastAltitude);
        content = `Version 1.0, ID = 9999999999\n${time}, Ground Level: ${elevation} ft\nWindsond ${model}\n AGL[ft] Wind[°] Speed[km/h]\n`;
    } else if (format === 'HEIDIS') {
        const heightHeader = refLevel === 'AGL' ? `h(${heightUnit}AGL)` : `h(${heightUnit}AMSL)`;
        const temperatureHeader = temperatureUnit === 'C' ? '°C' : '°F';
        const windSpeedHeader = windSpeedUnit;
        content = `${heightHeader} p(hPa) T(${temperatureHeader}) Dew(${temperatureHeader}) Dir(°) Spd(${windSpeedHeader}) RH(%)`;
    } else if (format === 'Customized') {
        const heightHeader = refLevel === 'AGL' ? `h(${heightUnit}AGL)` : `h(${heightUnit}AMSL)`;
        const temperatureHeader = temperatureUnit === 'C' ? '°C' : '°F';
        const windSpeedHeader = windSpeedUnit;
        content = `${heightHeader} p(hPa) T(${temperatureHeader}) Dew(${temperatureHeader}) Dir(°) Spd(${windSpeedHeader}) RH(%)`;
    }

    // Generate surface data
    const baseHeight = Math.round(lastAltitude);
    const surfaceHeight = refLevel === 'AGL' ? 0 : baseHeight;
    const surfaceTemp = weatherData.temperature_2m?.[index];
    const surfaceRH = weatherData.relative_humidity_2m?.[index];
    const surfaceSpd = weatherData.wind_speed_10m?.[index];
    const surfaceDir = weatherData.wind_direction_10m?.[index];
    const surfaceDew = Utils.calculateDewpoint(surfaceTemp, surfaceRH);
    const pressureLevels = ['1000hPa', '950hPa', '925hPa', '900hPa', '850hPa', '800hPa', '700hPa', '600hPa', '500hPa', '400hPa', '300hPa', '250hPa', '200hPa'];
    const availablePressure = pressureLevels.find(level => weatherData[`geopotential_height_${level}`]?.[index] !== undefined);
    const surfacePressure = availablePressure ? Utils.interpolatePressure(baseHeight,
        pressureLevels.map(l => parseInt(l)),
        pressureLevels.map(l => weatherData[`geopotential_height_${l}`]?.[index]).filter(h => h !== undefined)) : 'N/A';

    const displaySurfaceHeight = Math.round(Utils.convertHeight(surfaceHeight, heightUnit));
    const displaySurfaceTemp = Utils.convertTemperature(surfaceTemp, temperatureUnit);
    const displaySurfaceDew = Utils.convertTemperature(surfaceDew, temperatureUnit);
    const displaySurfaceSpd = Utils.convertWind(surfaceSpd, windSpeedUnit, 'km/h');
    const formattedSurfaceTemp = displaySurfaceTemp === 'N/A' ? 'N/A' : displaySurfaceTemp.toFixed(1);
    const formattedSurfaceDew = displaySurfaceDew === 'N/A' ? 'N/A' : displaySurfaceDew.toFixed(1);
    const formattedSurfaceSpd = displaySurfaceSpd === 'N/A' ? 'N/A' : (windSpeedUnit === 'bft' ? Math.round(displaySurfaceSpd) : displaySurfaceSpd.toFixed(1));
    const formattedSurfaceDir = surfaceDir === 'N/A' || surfaceDir === undefined ? 'N/A' : Math.round(surfaceDir);
    const formattedSurfaceRH = surfaceRH === 'N/A' || surfaceRH === undefined ? 'N/A' : Math.round(surfaceRH);

    if (format === 'ATAK') {
        content += `${displaySurfaceHeight}${separator}${formattedSurfaceDir}${separator}${formattedSurfaceSpd}\n`;
    } else if (format === 'Windwatch') {
        content += `${displaySurfaceHeight}${separator}${formattedSurfaceDir}${separator}${formattedSurfaceSpd}\n`;
    } else if (format === 'HEIDIS') {
        content += `\n${displaySurfaceHeight}${separator}${surfacePressure === 'N/A' ? 'N/A' : surfacePressure.toFixed(1)}${separator}${formattedSurfaceTemp}${separator}${formattedSurfaceDew}${separator}${formattedSurfaceDir}${separator}${formattedSurfaceSpd}${separator}${formattedSurfaceRH}\n`;
    } else if (format === 'Customized') {
        content += `\n${displaySurfaceHeight}${separator}${surfacePressure === 'N/A' ? 'N/A' : surfacePressure.toFixed(1)}${separator}${formattedSurfaceTemp}${separator}${formattedSurfaceDew}${separator}${formattedSurfaceDir}${separator}${formattedSurfaceSpd}${separator}${formattedSurfaceRH}\n`;
    }

    // Generate interpolated data
    const interpolatedData = interpolateWeatherData(index);
    if (!interpolatedData || interpolatedData.length === 0) {
        Utils.handleError('No interpolated data available to download.');
        return;
    }

    interpolatedData.forEach(data => {
        if (data.displayHeight !== surfaceHeight) {
            const displayHeight = Math.round(Utils.convertHeight(data.displayHeight, heightUnit));
            const displayTemperature = Utils.convertTemperature(data.temp, temperatureUnit);
            const displayDew = Utils.convertTemperature(data.dew, temperatureUnit);
            const displaySpd = Utils.convertWind(data.spd, windSpeedUnit, getWindSpeedUnit()); // Use current windUnit
            const formattedTemp = displayTemperature === 'N/A' ? 'N/A' : displayTemperature.toFixed(1);
            const formattedDew = displayDew === 'N/A' ? 'N/A' : displayDew.toFixed(1);
            const formattedSpd = displaySpd === 'N/A' ? 'N/A' : (windSpeedUnit === 'bft' ? Math.round(displaySpd) : displaySpd.toFixed(1));
            const formattedDir = data.dir === 'N/A' ? 'N/A' : Math.round(data.dir);
            const formattedRH = data.rh === 'N/A' ? 'N/A' : Math.round(data.rh);

            if (format === 'ATAK') {
                content += `${displayHeight}${separator}${formattedDir}${separator}${formattedSpd}\n`;
            } else if (format === 'Windwatch') {
                content += `${displayHeight}${separator}${formattedDir}${separator}${formattedSpd}\n`;
            } else if (format === 'HEIDIS') {
                content += `${displayHeight}${separator}${data.pressure}${separator}${formattedTemp}${separator}${formattedDew}${separator}${formattedDir}${separator}${formattedSpd}${separator}${formattedRH}\n`;
            } else if (format === 'Customized') {
                content += `${displayHeight}${separator}${data.pressure}${separator}${formattedTemp}${separator}${formattedDew}${separator}${formattedDir}${separator}${formattedSpd}${separator}${formattedRH}\n`;
            }
        }
    });

    // Create and trigger the download
    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    // Optionally revert settings (commented out to persist changes in UI)
    document.getElementById('interpStepSelect').value = originalSettings.interpStep;
    document.querySelector(`input[name="heightUnit"][value="${originalSettings.heightUnit}"]`).checked = true;
    document.querySelector(`input[name="refLevel"][value="${originalSettings.refLevel}"]`).checked = true;
    document.querySelector(`input[name="windUnit"][value="${originalSettings.windUnit}"]`).checked = true;
    document.querySelector(`input[name="temperatureUnit"][value="${originalSettings.temperatureUnit}"]`).checked = true;
    userSettings.interpStep = originalSettings.interpStep;
    userSettings.heightUnit = originalSettings.heightUnit;
    userSettings.refLevel = originalSettings.refLevel;
    userSettings.windUnit = originalSettings.windUnit;
    userSettings.temperatureUnit = originalSettings.temperatureUnit;
    saveSettings();
    updateHeightUnitLabels();
    updateWindUnitLabels();
    updateReferenceLabels();
}


function updateLandingPattern() {
    const showLandingPattern = document.getElementById('showLandingPattern').checked;
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

    // Remove existing layers
    [landingPatternPolygon, secondlandingPatternPolygon, thirdLandingPatternLine, finalArrow, baseArrow, downwindArrow].forEach(layer => {
        if (layer) {
            layer.remove();
            layer = null;
        }
    });

    if (!showLandingPattern || !weatherData || !weatherData.time || !currentMarker || sliderIndex >= weatherData.time.length) {
        console.log('Landing pattern not updated: missing data or not enabled');
        return;
    }

    const markerLatLng = currentMarker.getLatLng();
    const lat = markerLatLng.lat;
    const lng = markerLatLng.lng;
    const baseHeight = Math.round(lastAltitude);

    const interpolatedData = interpolateWeatherData(sliderIndex);
    if (!interpolatedData || interpolatedData.length === 0) {
        console.warn('No interpolated data available for landing pattern calculation');
        return;
    }

    const heights = interpolatedData.map(d => d.height);
    const dirs = interpolatedData.map(d => Number.isFinite(d.dir) ? parseFloat(d.dir) : 0);
    const spdsKt = interpolatedData.map(d => Number.isFinite(d.spd) ? Utils.convertWind(parseFloat(d.spd), 'kt', getWindSpeedUnit()) : 0);
    const uComponents = spdsKt.map((spd, i) => -spd * Math.sin(dirs[i] * Math.PI / 180));
    const vComponents = spdsKt.map((spd, i) => -spd * Math.cos(dirs[i] * Math.PI / 180));

    // Determine effective landing direction based on selected pattern and input
    let effectiveLandingWindDir;
    if (landingDirection === 'LL' && customLandingDirLL !== null && !isNaN(customLandingDirLL) && customLandingDirLL >= 0 && customLandingDirLL <= 359) {
        effectiveLandingWindDir = customLandingDirLL;
    } else if (landingDirection === 'RR' && customLandingDirRR !== null && !isNaN(customLandingDirRR) && customLandingDirRR >= 0 && customLandingDirRR <= 359) {
        effectiveLandingWindDir = customLandingDirRR;
    } else {
        effectiveLandingWindDir = Number.isFinite(landingWindDir) ? landingWindDir : dirs[0]; // Fallback to surface wind
    }

    if (!Number.isFinite(effectiveLandingWindDir)) {
        console.warn('Invalid landing wind direction:', effectiveLandingWindDir);
        return;
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

    // Final Leg (0-100m AGL)
    const finalLimits = [baseHeight, baseHeight + LEG_HEIGHT_FINAL];
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

    const finalCourse = (effectiveLandingWindDir + 180) % 360;
    const finalWindAngle = Utils.calculateWindAngle(effectiveLandingWindDir, finalWindDir);
    const { crosswind: finalCrosswind, headwind: finalHeadwind } = Utils.calculateWindComponents(finalWindSpeedKt, finalWindAngle);
    const finalWca = Utils.calculateWCA(finalCrosswind, CANOPY_SPEED_KT) * (finalCrosswind >= 0 ? 1 : -1);
    const finalGroundSpeedKt = Utils.calculateGroundSpeed(CANOPY_SPEED_KT, finalHeadwind);
    const finalTime = LEG_HEIGHT_FINAL / DESCENT_RATE_MPS;
    const finalLength = finalGroundSpeedKt * 1.852 / 3.6 * finalTime;
    const finalBearing = (effectiveLandingWindDir + 180) % 360;
    const finalEnd = calculateLegEndpoint(lat, lng, finalBearing, finalGroundSpeedKt, finalTime);

    landingPatternPolygon = L.polyline([[lat, lng], finalEnd], {
        color: 'red',
        weight: 3,
        opacity: 0.8,
        dashArray: '5, 10'
    }).addTo(map);

    // Add a fat blue arrow in the middle of the final leg pointing to landing direction
    const finalMidLat = (lat + finalEnd[0]) / 2;
    const finalMidLng = (lng + finalEnd[1]) / 2;
    const finalArrowBearing = (finalWindDir - 90 + 180) % 360; // Points in direction of the mean wind at final

    // Create a custom arrow icon using Leaflet’s DivIcon
    const finalArrowIcon = L.divIcon({
        className: 'custom-arrow',
        html: `
        <svg width="40" height="20" viewBox="0 0 40 20" style="transform: rotate(${finalArrowBearing}deg); transform-origin: center;">
            <line x1="0" y1="10" x2="30" y2="10" stroke=${finalArrowColor} stroke-width="4" />
            <polygon points="30,5 40,10 30,15" fill=${finalArrowColor} />
        </svg>`,
        iconSize: [30, 30], // Size of the arrow
        iconAnchor: [15, 15] // Center the arrow
    });

    // Place the arrow at the midpoint
    finalArrow = L.marker([finalMidLat, finalMidLng], {
        icon: finalArrowIcon,
        rotationAngle: finalArrowBearing, // This ensures proper rotation if using a marker
        rotationOrigin: 'center center'
    }).addTo(map);

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

    const baseCourse = Utils.calculateCourseFromHeading(baseHeading, baseWindDir, baseWindSpeedKt, CANOPY_SPEED_KT).trueCourse;
    console.log('Base Course:', baseCourse);
    const baseWindAngle = Utils.calculateWindAngle(baseCourse, baseWindDir);
    const { crosswind: baseCrosswind, headwind: baseHeadwind } = Utils.calculateWindComponents(baseWindSpeedKt, baseWindAngle);
    const baseWca = Utils.calculateWCA(baseCrosswind, CANOPY_SPEED_KT) * (baseCrosswind >= 0 ? 1 : -1);
    let baseBearing = (baseCourse + 180) % 360;
    const baseTime = (LEG_HEIGHT_BASE - LEG_HEIGHT_FINAL) / DESCENT_RATE_MPS;
    const baseGroundSpeedKt = CANOPY_SPEED_KT + baseHeadwind;
    if (baseGroundSpeedKt < 0) {
        baseBearing = (baseBearing + 180) % 360; // Reverse the course
        console.log('Base ground speed is negative:', baseGroundSpeedKt, 'New course:', baseBearing);
    }
    const baseLength = baseGroundSpeedKt * 1.852 / 3.6 * baseTime;
    const baseEnd = calculateLegEndpoint(finalEnd[0], finalEnd[1], baseBearing, baseGroundSpeedKt, baseTime);

    secondlandingPatternPolygon = L.polyline([finalEnd, baseEnd], {
        color: 'red',
        weight: 3,
        opacity: 0.8,
        dashArray: '5, 10'
    }).addTo(map);

    // Add a fat blue arrow in the middle of the base leg pointing to landing direction
    const baseMidLat = (finalEnd[0] + baseEnd[0]) / 2;
    const baseMidLng = (finalEnd[1] + baseEnd[1]) / 2;
    const baseArrowBearing = (baseWindDir - 90 + 180) % 360; // Points in direction of the mean wind at base

    // Create a custom arrow icon using Leaflet’s DivIcon
    const baseArrowIcon = L.divIcon({
        className: 'custom-arrow',
        html: `
        <svg width="40" height="20" viewBox="0 0 40 20" style="transform: rotate(${baseArrowBearing}deg); transform-origin: center;">
            <line x1="0" y1="10" x2="30" y2="10" stroke=${baseArrowColor} stroke-width="4" />
            <polygon points="30,5 40,10 30,15" fill=${baseArrowColor} />
        </svg>`,
        iconSize: [30, 30], // Size of the arrow
        iconAnchor: [15, 15] // Center the arrow
    });

    // Place the arrow at the midpoint
    baseArrow = L.marker([baseMidLat, baseMidLng], {
        icon: baseArrowIcon,
        rotationAngle: baseArrowBearing, // This ensures proper rotation if using a marker
        rotationOrigin: 'center center'
    }).addTo(map);

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
    const downwindGroundSpeedKt = CANOPY_SPEED_KT + downwindHeadwind; // Corrected to use raw headwind
    const downwindTime = (LEG_HEIGHT_DOWNWIND - LEG_HEIGHT_BASE) / DESCENT_RATE_MPS;
    const downwindLength = downwindGroundSpeedKt * 1.852 / 3.6 * downwindTime;
    const downwindEnd = calculateLegEndpoint(baseEnd[0], baseEnd[1], downwindCourse, downwindGroundSpeedKt, downwindTime);

    thirdLandingPatternLine = L.polyline([baseEnd, downwindEnd], {
        color: 'red',
        weight: 3,
        opacity: 0.8,
        dashArray: '5, 10'
    }).addTo(map);

    // Add a fat blue arrow in the middle of the downwind leg pointing to landing direction
    const downwindMidLat = (baseEnd[0] + downwindEnd[0]) / 2;
    const downwindMidLng = (baseEnd[1] + downwindEnd[1]) / 2;
    const downwindArrowBearing = (downwindWindDir - 90 + 180) % 360; // Points in direction of the mean wind at downwind

    // Create a custom arrow icon using Leaflet’s DivIcon
    const downwindArrowIcon = L.divIcon({
        className: 'custom-arrow',
        html: `
        <svg width="40" height="20" viewBox="0 0 40 20" style="transform: rotate(${downwindArrowBearing}deg); transform-origin: center;">
            <line x1="0" y1="10" x2="30" y2="10" stroke=${downwindArrowColor} stroke-width="4" />
            <polygon points="30,5 40,10 30,15" fill=${downwindArrowColor} />
        </svg>`,
        iconSize: [30, 30], // Size of the arrow
        iconAnchor: [15, 15] // Center the arrow
    });

    // Place the arrow at the midpoint
    downwindArrow = L.marker([downwindMidLat, downwindMidLng], {
        icon: downwindArrowIcon,
        rotationAngle: downwindArrowBearing, // This ensures proper rotation if using a marker
        rotationOrigin: 'center center'
    }).addTo(map);

    console.log(`Landing Pattern Updated:
        Final Leg: Wind: ${finalWindDir.toFixed(1)}° @ ${finalWindSpeedKt.toFixed(1)}kt, Course: ${finalCourse.toFixed(1)}°, WCA: ${finalWca.toFixed(1)}°, GS: ${finalGroundSpeedKt.toFixed(1)}kt, HW: ${finalHeadwind.toFixed(1)}kt, Length: ${finalLength.toFixed(1)}m
        Base Leg: Wind: ${baseWindDir.toFixed(1)}° @ ${baseWindSpeedKt.toFixed(1)}kt, Course: ${baseCourse.toFixed(1)}°, WCA: ${baseWca.toFixed(1)}°, GS: ${baseGroundSpeedKt.toFixed(1)}kt, HW: ${baseHeadwind.toFixed(1)}kt, Length: ${baseLength.toFixed(1)}m
        Downwind Leg: Wind: ${downwindWindDir.toFixed(1)}° @ ${downwindWindSpeedKt.toFixed(1)}kt, Course: ${downwindCourse.toFixed(1)}°, WCA: ${downwindWca.toFixed(1)}°, GS: ${downwindGroundSpeedKt.toFixed(1)}kt, HW: ${downwindHeadwind.toFixed(1)}kt, Length: ${downwindLength.toFixed(1)}m`);

    map.fitBounds([[lat, lng], finalEnd, baseEnd, downwindEnd], { padding: [50, 50] });
}

function displayError(message) {
    console.log('displayError called with:', message);
    let errorElement = document.getElementById('error-message');
    if (!errorElement) {
        errorElement = document.createElement('div');
        errorElement.id = 'error-message';
        errorElement.style.position = 'fixed';
        errorElement.style.top = '0';
        errorElement.style.left = '0';
        errorElement.style.width = '100%';
        errorElement.style.backgroundColor = ' #ffcccc';
        errorElement.style.borderRadius = '0 0 5px 5px';
        errorElement.style.color = '#000000';
        errorElement.style.padding = '10px';
        errorElement.style.zIndex = '9999';
        errorElement.style.display = 'block'; // Set initially
        document.body.appendChild(errorElement);
        console.log('New error element created and appended');
    }
    errorElement.textContent = message;
    errorElement.style.display = 'block'; // Ensure it’s visible
    console.log('Error element state:', {
        display: errorElement.style.display,
        text: errorElement.textContent,
        position: errorElement.style.position,
        zIndex: errorElement.style.zIndex
    });
    // Reset any existing timeout and set a new one
    clearTimeout(window.errorTimeout); // Prevent overlap from multiple calls
    window.errorTimeout = setTimeout(() => {
        errorElement.style.display = 'none';
        console.log('Error hidden after 5s');
    }, 5000);
}

document.addEventListener('DOMContentLoaded', () => {
    // Initialize settings and UI
    initializeSettings();
    initializeUIElements();
    initializeMap();

    // Setup event listeners
    setupSliderEvents();
    setupModelSelectEvents();
    setupDownloadEvents();
    setupMenuEvents();
    setupRadioEvents();
    setupInputEvents();
    setupCheckboxEvents();
    setupCoordinateEvents();
    setupResetButton();
});

// Initialize settings
function initializeSettings() {
    userSettings = JSON.parse(localStorage.getItem('upperWindsSettings')) || { ...defaultSettings };
    console.log('Loaded userSettings:', userSettings);
}

// Initialize UI elements based on user settings
function initializeUIElements() {
    setElementValue('modelSelect', userSettings.model);
    setRadioValue('refLevel', userSettings.refLevel);
    setRadioValue('heightUnit', userSettings.heightUnit);
    setRadioValue('temperatureUnit', userSettings.temperatureUnit);
    setRadioValue('windUnit', userSettings.windUnit);
    setRadioValue('timeZone', userSettings.timeZone);
    setRadioValue('coordFormat', userSettings.coordFormat);
    setRadioValue('downloadFormat', userSettings.downloadFormat);
    setRadioValue('landingDirection', userSettings.landingDirection);
    setInputValue('canopySpeed', userSettings.canopySpeed);
    setInputValue('descentRate', userSettings.descentRate);
    setInputValue('legHeightDownwind', userSettings.legHeightDownwind);
    setInputValue('legHeightBase', userSettings.legHeightBase);
    setInputValue('legHeightFinal', userSettings.legHeightFinal);
    setInputValue('customLandingDirectionLL', userSettings.customLandingDirectionLL);
    setInputValue('customLandingDirectionRR', userSettings.customLandingDirectionRR);
    setInputValue('lowerLimit', userSettings.lowerLimit);
    setInputValue('upperLimit', userSettings.upperLimit);
    setInputValue('openingAltitude', userSettings.openingAltitude);
    setInputValue('exitAltitude', userSettings.exitAltitude);
    setInputValue('interpStepSelect', userSettings.interpStep);
    setCheckboxValue('showTableCheckbox', userSettings.showTable);
    setCheckboxValue('calculateJumpCheckbox', userSettings.calculateJump);
    setCheckboxValue('showLandingPattern', userSettings.showLandingPattern);

    updateUIState();
}

function setElementValue(id, value) {
    const element = document.getElementById(id);
    if (element) element.value = value;
    else console.warn(`Element ${id} not found`);
}

function setRadioValue(name, value) {
    const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
    if (radio) radio.checked = true;
    else console.warn(`Radio ${name} with value ${value} not found`);
}

function setInputValue(id, value) {
    const element = document.getElementById(id);
    if (element) element.value = value;
}

function setCheckboxValue(id, value) {
    const element = document.getElementById(id);
    if (element) element.checked = value;
}

function updateUIState() {
    const info = document.getElementById('info');
    if (info) info.style.display = userSettings.showTable ? 'block' : 'none';
    const customLL = document.getElementById('customLandingDirectionLL');
    const customRR = document.getElementById('customLandingDirectionRR');
    if (customLL) customLL.disabled = userSettings.landingDirection !== 'LL';
    if (customRR) customRR.disabled = userSettings.landingDirection !== 'RR';
    updateHeightUnitLabels();
    updateWindUnitLabels();
}

// Initialize map
function initializeMap() {
    console.log('Initializing map...');
    initMap();
}

// Handle slider-specific logic
function setupSliderEvents() {
    const slider = document.getElementById('timeSlider');
    if (!slider) return Utils.handleError('Slider element missing.');

    slider.value = 0;
    slider.setAttribute('autocomplete', 'off');

    const debouncedUpdate = debounce(async (index) => {
        if (weatherData && index >= 0 && index < weatherData.time.length) {
            await updateWeatherDisplay(index);
            if (lastLat && lastLng && lastAltitude !== 'N/A') {
                calculateMeanWind();
                if (userSettings.calculateJump) calculateJump();
            }
        } else {
            slider.value = 0;
            await updateWeatherDisplay(0);
            if (lastLat && lastLng && lastAltitude !== 'N/A') {
                calculateMeanWind();
                if (userSettings.calculateJump) calculateJump();
            }
        }
    }, 100);

    slider.addEventListener('input', (e) => debouncedUpdate(parseInt(e.target.value)));
    slider.addEventListener('change', (e) => debouncedUpdate(parseInt(e.target.value)));
}

// Setup model select events
function setupModelSelectEvents() {
    const modelSelect = document.getElementById('modelSelect');
    if (!modelSelect) return;
    modelSelect.addEventListener('change', async () => {
        if (lastLat && lastLng) {
            const currentIndex = getSliderValue();
            const currentTime = weatherData?.time?.[currentIndex] || null;
            document.getElementById('info').innerHTML = `Fetching weather with ${modelSelect.value}...`;
            await fetchWeather(lastLat, lastLng, currentTime);
            updateModelRunInfo();
            await updateWeatherDisplay(currentIndex);
            updateReferenceLabels();
            if (lastAltitude !== 'N/A') calculateMeanWind();
            userSettings.model = modelSelect.value;
            saveSettings();
        } else {
            Utils.handleError('Please select a position on the map first.');
        }
    });
}

// Setup download events
function setupDownloadEvents() {
    const downloadButton = document.getElementById('downloadButton');
    if (downloadButton) {
        downloadButton.addEventListener('click', () => {
            const downloadFormat = getDownloadFormat();
            downloadTableAsAscii(downloadFormat);
        });
    }
}

// Setup menu events
function setupMenuEvents() {
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const menu = document.getElementById('menu');
    if (hamburgerBtn && menu) {
        hamburgerBtn.addEventListener('click', () => menu.classList.toggle('hidden'));
        const menuItems = menu.querySelectorAll('span');
        menuItems.forEach(item => {
            item.addEventListener('click', (e) => {
                const submenu = item.nextElementSibling;
                if (submenu && submenu.classList.contains('submenu')) {
                    submenu.classList.toggle('hidden');
                    menu.querySelectorAll('.submenu').forEach(other => {
                        const isAncestor = other.contains(item);
                        if (other !== submenu && !isAncestor && !other.classList.contains('hidden')) {
                            other.classList.add('hidden');
                        }
                    });
                }
                e.stopPropagation();
            });
        });
        document.addEventListener('click', (e) => {
            if (!menu.contains(e.target) && !hamburgerBtn.contains(e.target)) {
                menu.querySelectorAll('.submenu').forEach(submenu => submenu.classList.add('hidden'));
            }
        });
    }
}

// Setup radio events
function setupRadioEvents() {
    setupRadioGroup('refLevel', () => {
        updateReferenceLabels();
        if (weatherData && lastLat && lastLng) {
            updateWeatherDisplay(getSliderValue());
            if (lastAltitude !== 'N/A') calculateMeanWind();
        }
    });
    setupRadioGroup('heightUnit', () => {
        updateHeightUnitLabels();
        if (weatherData && lastLat && lastLng) {
            updateWeatherDisplay(getSliderValue());
            if (lastAltitude !== 'N/A') calculateMeanWind();
        }
    });
    setupRadioGroup('temperatureUnit', () => {
        if (weatherData && lastLat && lastLng) {
            updateWeatherDisplay(getSliderValue());
            if (lastAltitude !== 'N/A') calculateMeanWind();
        }
    });
    setupRadioGroup('windUnit', () => {
        updateWindUnitLabels();
        if (weatherData && lastLat && lastLng) {
            updateWeatherDisplay(getSliderValue());
            if (lastAltitude !== 'N/A') calculateMeanWind();
        }
    });
    setupRadioGroup('timeZone', async () => {
        if (weatherData && lastLat && lastLng) {
            await updateWeatherDisplay(getSliderValue());
            updateModelRunInfo();
        }
    });
    setupRadioGroup('coordFormat', () => {
        updateCoordInputs(userSettings.coordFormat);
        if (currentMarker && lastLat && lastLng) {
            updateMarkerPopup(currentMarker, lastLat, lastLng, lastAltitude);
        }
    });
    setupRadioGroup('downloadFormat', () => {
        console.log('Download format changed:', getDownloadFormat());
    });
    setupRadioGroup('landingDirection', () => {
        const customLL = document.getElementById('customLandingDirectionLL');
        const customRR = document.getElementById('customLandingDirectionRR');
        const landingDirection = userSettings.landingDirection;
        if (customLL) {
            customLL.disabled = landingDirection !== 'LL';
            if (landingDirection === 'LL' && !customLL.value && landingWindDir !== null) {
                customLL.value = Math.round(landingWindDir);
                userSettings.customLandingDirectionLL = parseInt(customLL.value);
                saveSettings();
            }
        }
        if (customRR) {
            customRR.disabled = landingDirection !== 'RR';
            if (landingDirection === 'RR' && !customRR.value && landingWindDir !== null) {
                customRR.value = Math.round(landingWindDir);
                userSettings.customLandingDirectionRR = parseInt(customRR.value);
                saveSettings();
            }
        }
        if (weatherData && lastLat && lastLng) {
            updateLandingPattern();
            recenterMap();
        }
    });
}

function setupRadioGroup(name, callback) {
    const radios = document.querySelectorAll(`input[name="${name}"]`);
    radios.forEach(radio => {
        radio.addEventListener('change', () => {
            userSettings[name] = document.querySelector(`input[name="${name}"]:checked`).value;
            saveSettings();
            console.log(`${name} changed to:`, userSettings[name]);
            callback();
        });
    });
}

function getSliderValue() {
    return parseInt(document.getElementById('timeSlider')?.value) || 0;
}

function getDownloadFormat() {
    return document.querySelector('input[name="downloadFormat"]:checked')?.value || 'csv';
}

// Setup input events
function setupInputEvents() {
    setupInput('lowerLimit', 'input', 300, (value) => {
        if (weatherData && lastLat && lastLng && lastAltitude !== 'N/A') calculateMeanWind();
    });
    setupInput('upperLimit', 'input', 300, (value) => {
        if (weatherData && lastLat && lastLng && lastAltitude !== 'N/A') calculateMeanWind();
    });
    setupInput('openingAltitude', 'change', 300, (value) => {
        if (!isNaN(value) && value >= 500 && value <= 5000) {
            if (userSettings.calculateJump && weatherData && lastLat && lastLng) calculateJump();
        } else {
            Utils.handleError('Opening altitude must be between 500 and 5000 meters.');
            setInputValue('openingAltitude', 1200);
            userSettings.openingAltitude = 1200;
            saveSettings();
        }
    });
    setupInput('exitAltitude', 'change', 300, (value) => {
        if (!isNaN(value) && value >= 500 && value <= 15000) {
            if (userSettings.calculateJump && weatherData && lastLat && lastLng) calculateJump();
        } else {
            Utils.handleError('Exit altitude must be between 500 and 15000 meters.');
            setInputValue('exitAltitude', 3000);
            userSettings.exitAltitude = 3000;
            saveSettings();
        }
    });
    setupInput('canopySpeed', 'change', 300, (value) => {
        if (!isNaN(value) && value >= 5 && value <= 50) {
            if (weatherData && lastLat && lastLng) updateLandingPattern();
        } else {
            Utils.handleError('Canopy speed must be between 5 and 50 kt.');
            setInputValue('canopySpeed', 20);
            userSettings.canopySpeed = 20;
            saveSettings();
        }
    });
    setupInput('descentRate', 'change', 300, (value) => {
        if (!isNaN(value) && value >= 1 && value <= 10) {
            if (weatherData && lastLat && lastLng) updateLandingPattern();
        } else {
            Utils.handleError('Descent rate must be between 1 and 10 m/s.');
            setInputValue('descentRate', 3);
            userSettings.descentRate = 3;
            saveSettings();
        }
    });
    setupInput('interpStepSelect', 'change', 300, (value) => {
        if (weatherData && lastLat && lastLng) {
            updateWeatherDisplay(getSliderValue());
            if (lastAltitude !== 'N/A') calculateMeanWind();
        }
    });
    setupLegHeightInput('legHeightFinal', 100);
    setupLegHeightInput('legHeightBase', 200);
    setupLegHeightInput('legHeightDownwind', 300);
    setupInput('customLandingDirectionLL', 'change', 300, (value) => {
        const customDir = parseInt(value, 10);
        if (!isNaN(customDir) && customDir >= 0 && customDir <= 359) {
            if (userSettings.landingDirection === 'LL' && weatherData && lastLat && lastLng) {
                updateLandingPattern();
                recenterMap();
            }
        } else {
            Utils.handleError('Landing direction must be between 0 and 359°.');
            setInputValue('customLandingDirectionLL', landingWindDir || 0);
            userSettings.customLandingDirectionLL = landingWindDir || 0;
            saveSettings();
        }
    });
    setupInput('customLandingDirectionRR', 'change', 300, (value) => {
        const customDir = parseInt(value, 10);
        if (!isNaN(customDir) && customDir >= 0 && customDir <= 359) {
            if (userSettings.landingDirection === 'RR' && weatherData && lastLat && lastLng) {
                updateLandingPattern();
                recenterMap();
            }
        } else {
            Utils.handleError('Landing direction must be between 0 and 359°.');
            setInputValue('customLandingDirectionRR', landingWindDir || 0);
            userSettings.customLandingDirectionRR = landingWindDir || 0;
            saveSettings();
        }
    });
}

function setupInput(id, eventType, debounceTime, callback) {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener(eventType, debounce(() => {
        const value = input.type === 'number' ? parseFloat(input.value) : input.value;
        userSettings[id] = value;
        saveSettings();
        console.log(`${id} changed to:`, value);
        callback(value);
    }, debounceTime));
}

function validateLegHeights(final, base, downwind) {
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

function setupLegHeightInput(id, defaultValue) {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener('blur', () => {
        const value = parseInt(input.value) || defaultValue;
        userSettings[id] = value;
        saveSettings();
        const finalInput = document.getElementById('legHeightFinal');
        const baseInput = document.getElementById('legHeightBase');
        const downwindInput = document.getElementById('legHeightDownwind');
        if (!isNaN(value) && value >= 50 && value <= 1000 && validateLegHeights(finalInput, baseInput, downwindInput)) {
            if (weatherData && lastLat && lastLng) {
                updateLandingPattern();
                if (id === 'legHeightDownwind' && userSettings.calculateJump) calculateJump();
                recenterMap();
            }
        } else {
            let adjustedValue = defaultValue;
            const finalVal = parseInt(finalInput?.value) || 100;
            const baseVal = parseInt(baseInput?.value) || 200;
            const downwindVal = parseInt(downwindInput?.value) || 300;
            if (id === 'legHeightFinal') adjustedValue = Math.min(baseVal - 1, 100);
            if (id === 'legHeightBase') adjustedValue = Math.max(finalVal + 1, Math.min(downwindVal - 1, 200));
            if (id === 'legHeightDownwind') adjustedValue = Math.max(baseVal + 1, 300);
            input.value = adjustedValue;
            userSettings[id] = adjustedValue;
            saveSettings();
            Utils.handleError(`Adjusted ${id} to ${adjustedValue} to maintain valid leg order.`);
        }
    });
}

// Setup checkbox events
function setupCheckboxEvents() {
    setupCheckbox('showTableCheckbox', 'showTable', () => {
        const info = document.getElementById('info');
        if (info) info.style.display = userSettings.showTable ? 'block' : 'none';
        if (userSettings.showTable && weatherData && lastLat && lastLng) {
            updateWeatherDisplay(getSliderValue());
        }
        recenterMap();
    });

    setupCheckbox('calculateJumpCheckbox', 'calculateJump', () => {
        console.log('calculateJumpCheckbox callback triggered, current checked:', document.getElementById('calculateJumpCheckbox').checked);
        console.log('userSettings.calculateJump before toggle:', userSettings.calculateJump);
        toggleSubmenu('calculateJumpCheckbox', userSettings.calculateJump);
        console.log('userSettings.calculateJump after toggle:', userSettings.calculateJump);
        if (userSettings.calculateJump) {
            if (weatherData && lastLat && lastLng) {
                console.log('Calling calculateJump with:', { weatherData, lastLat, lastLng });
                calculateJump();
            } else {
                console.warn('Cannot calculate jump: Missing data', { weatherData: !!weatherData, lastLat, lastLng });
                Utils.handleError('Please click the map to set a location first.');
            }
        } else {
            console.log('Clearing jump circles');
            clearJumpCircles();
        }
    });

    setupCheckbox('showLandingPattern', 'showLandingPattern', () => {
        toggleSubmenu('showLandingPattern', userSettings.showLandingPattern);
        if (userSettings.showLandingPattern && weatherData && lastLat && lastLng) {
            updateLandingPattern();
            recenterMap();
        }
    });
}

function setupCheckbox(id, settingsKey, callback) {
    const checkbox = document.getElementById(id);
    if (!checkbox) {
        console.warn(`Checkbox with ID "${id}" not found`);
        return;
    }
    checkbox.addEventListener('change', () => {
        const newValue = checkbox.checked;
        console.log(`${id} changed to:`, newValue);
        userSettings[settingsKey] = newValue; // Use settingsKey instead of id
        saveSettings();
        callback();
    });
}

function toggleSubmenu(id, isVisible) {
    const checkbox = document.getElementById(id);
    const submenu = checkbox?.parentElement.nextElementSibling;
    if (submenu) {
        submenu.classList.toggle('hidden', !isVisible);
        console.log('Submenu visibility:', !submenu.classList.contains('hidden'));
    } else {
        console.warn(`Submenu for ${id} not found`);
    }
}

function clearJumpCircles() {
    if (jumpCircle) {
        map.removeLayer(jumpCircle);
        jumpCircle = null;
    }
    if (jumpCircleFull) {
        map.removeLayer(jumpCircleFull);
        jumpCircleFull = null;
    }
}

// Setup coordinate events
function setupCoordinateEvents() {
    const coordInputs = document.getElementById('coordInputs');
    if (coordInputs) {
        updateCoordInputs(userSettings.coordFormat);
    } else {
        console.warn('Coordinate inputs container (#coordInputs) not found');
    }

    const moveMarkerBtn = document.getElementById('moveMarkerBtn');
    if (moveMarkerBtn) {
        moveMarkerBtn.addEventListener('click', async () => {
            try {
                const [lat, lng] = parseCoordinates();
                lastLat = lat;
                lastLng = lng;
                lastAltitude = await getAltitude(lat, lng);

                if (currentMarker) {
                    currentMarker.setLatLng([lat, lng]);
                } else {
                    currentMarker = createCustomMarker(lat, lng).addTo(map);
                }

                updateMarkerPopup(currentMarker, lat, lng, lastAltitude);
                if (userSettings.calculateJump) {
                    calculateJump();
                }
                recenterMap();
                await fetchWeatherForLocation(lat, lng);
            } catch (error) {
                Utils.handleError(error.message);
            }
        });
    }
}

function updateCoordInputs(format) {
    const coordInputs = document.getElementById('coordInputs');
    if (!coordInputs) return;

    coordInputs.innerHTML = ''; // Clear existing inputs
    if (format === 'Decimal') {
        coordInputs.innerHTML = `
            <label>Latitude: <input type="number" id="latDec" step="any" placeholder="e.g., 48.0179"></label>
            <label>Longitude: <input type="number" id="lngDec" step="any" placeholder="e.g., 11.1923"></label>
        `;
    } else if (format === 'DMS') {
        coordInputs.innerHTML = `
            <label>Lat: 
                <input type="number" id="latDeg" min="0" max="90" placeholder="Deg">°
                <input type="number" id="latMin" min="0" max="59" placeholder="Min">'
                <input type="number" id="latSec" min="0" max="59.999" step="0.001" placeholder="Sec">"
                <select id="latDir"><option value="N">N</option><option value="S">S</option></select>
            </label>
            <label>Lng: 
                <input type="number" id="lngDeg" min="0" max="180" placeholder="Deg">°
                <input type="number" id="lngMin" min="0" max="59" placeholder="Min">'
                <input type="number" id="lngSec" min="0" max="59.999" step="0.001" placeholder="Sec">"
                <select id="lngDir"><option value="E">E</option><option value="W">W</option></select>
            </label>
        `;
    } else if (format === 'MGRS') {
        coordInputs.innerHTML = `
            <label>MGRS: <input type="text" id="mgrsCoord" placeholder="e.g., 32UPU12345678"></label>
        `;
    }
    console.log(`Coordinate inputs updated to ${format}`);
}

function parseCoordinates() {
    let lat, lng;

    if (userSettings.coordFormat === 'Decimal') {
        lat = parseFloat(document.getElementById('latDec')?.value);
        lng = parseFloat(document.getElementById('lngDec')?.value);
        if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            throw new Error('Invalid Decimal Degrees coordinates');
        }
    } else if (userSettings.coordFormat === 'DMS') {
        const latDeg = parseInt(document.getElementById('latDeg')?.value) || 0;
        const latMin = parseInt(document.getElementById('latMin')?.value) || 0;
        const latSec = parseFloat(document.getElementById('latSec')?.value) || 0;
        const latDir = document.getElementById('latDir')?.value;
        const lngDeg = parseInt(document.getElementById('lngDeg')?.value) || 0;
        const lngMin = parseInt(document.getElementById('lngMin')?.value) || 0;
        const lngSec = parseFloat(document.getElementById('lngSec')?.value) || 0;
        const lngDir = document.getElementById('lngDir')?.value;

        lat = Utils.dmsToDecimal(latDeg, latMin, latSec, latDir);
        lng = Utils.dmsToDecimal(lngDeg, lngMin, lngSec, lngDir);

        if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            throw new Error('Invalid DMS coordinates');
        }
    } else if (userSettings.coordFormat === 'MGRS') {
        const mgrsInput = document.getElementById('mgrsCoord')?.value.trim();
        if (!mgrsInput) {
            throw new Error('MGRS coordinate cannot be empty');
        }

        console.log('Attempting to parse MGRS:', mgrsInput);

        if (!/^[0-6][0-9][A-HJ-NP-Z][A-HJ-NP-Z]{2}[0-9]+$/.test(mgrsInput)) {
            throw new Error('MGRS format invalid. Example: 32UPU12345678 (zone, band, square, easting/northing)');
        }

        try {
            if (typeof mgrs === 'undefined') {
                throw new Error('MGRS library not loaded. Check script inclusion.');
            }

            console.log('Calling mgrs.toPoint with:', mgrsInput);
            [lng, lat] = mgrs.toPoint(mgrsInput);
            console.log(`Parsed MGRS ${mgrsInput} to Lat: ${lat}, Lng: ${lng}`);

            if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                throw new Error('Parsed MGRS coordinates out of valid range');
            }
        } catch (e) {
            console.error('MGRS parsing failed:', e.message, 'Input:', mgrsInput);
            throw new Error(`Invalid MGRS format: ${e.message}`);
        }
    }
    return [lat, lng];
}

// Setup reset button
function setupResetButton() {
    const resetButton = document.createElement('button');
    resetButton.textContent = 'Reset Settings';
    resetButton.style.margin = '10px';
    document.getElementById('bottom-container').appendChild(resetButton);
    resetButton.addEventListener('click', () => {
        userSettings = { ...defaultSettings };
        saveSettings();
        location.reload();
    });
}

// Placeholder for debounce (implement this if not already defined)
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}