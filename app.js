
// == Project: Skydiving Weather and Jump Planner ==
// == Constants and Global Variables ==
const FEATURE_PASSWORD = "skydiver2025"; // Hardcoded password (change as needed)
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
let jumpCircle = null;
let jumpCircleFull = null; // New red circle for full descent
let jumpCircleGreen = null; // New green circle
let jumpCircleGreenLight = null; // New light green circle (blue circle radius)
let jumpRunTrackLayer = null;
let customJumpRunDirection = null; // Temporary storage for custom direction during sessionconst minZoom = 11; // Placeholder, adjust as needed
let isJumperSeparationManual = false; // Tracks if jumperSeparation is manually set
const minZoom = 11; // Placeholder, adjust as needed
const maxZoom = 14; // Placeholder, adjust as needed
const landingPatternMinZoom = 14; // New constant for landing pattern
let isLandingPatternUnlocked = false;   // Track unlock state during session
let isCalculateJumpUnlocked = false;    // Track unlock state during session
let cutAwayCircle = null; // New variable to track cut-away circle
let userSettings = JSON.parse(localStorage.getItem('upperWindsSettings')) || { ...defaultSettings };
const unlockedFeatures = JSON.parse(localStorage.getItem('unlockedFeatures')) || {};
isLandingPatternUnlocked = unlockedFeatures.landingPattern || false;
isCalculateJumpUnlocked = unlockedFeatures.calculateJump || false;
console.log('Initial unlock status:', { isLandingPatternUnlocked, isCalculateJumpUnlocked });

const getTemperatureUnit = () => getSettingValue('temperatureUnit', 'radio', 'C');
const getHeightUnit = () => getSettingValue('heightUnit', 'radio', 'm');
const getWindSpeedUnit = () => getSettingValue('windUnit', 'radio', 'kt');
const getCoordinateFormat = () => getSettingValue('coordFormat', 'radio', 'Decimal');
const getInterpolationStep = () => getSettingValue('interpStepSelect', 'select', 200);
const getDownloadFormat = () => getSettingValue('downloadFormat', 'radio', 'csv');
// == Lookup Table for Jumper Separation ==
const jumperSeparationTable = {
    135: 5,
    130: 5,
    125: 5,
    120: 5,
    115: 5,
    110: 5,
    105: 5,
    100: 6,
    95: 7,
    90: 7,
    85: 7,
    80: 8,
    75: 8,
    70: 9,
    65: 10,
    60: 10,
    55: 11,
    50: 12,
    45: 14,
    40: 15,
    35: 17,
    30: 20,
    25: 24,
    20: 30,
    15: 40,
    10: 60,
    5: 119
};
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
    calculateJump: false,
    openingAltitude: 1200,
    exitAltitude: 3000,
    showJumpRunTrack: false,
    showExitArea: false,
    jumpRunTrackOffset: 0, // Keep offset as it’s a user-configurable setting
    aircraftSpeedKt: 90, // Added for Jump Parameters
    jumperSeparation: 5,  // Added for Jump Parameters
    numberOfJumpers: 5,
    cutAwayAltitude: 1000, // Added for cut-away input
    cutAwayState: 'Partially' // Added for cut-away radio buttons
};


// == Settings Management ==
function getSettingValue(name, type = 'radio', defaultValue) {
    const selector = type === 'radio' ? `input[name="${name}"]:checked` : `#${name}`;
    const element = document.querySelector(selector);
    return element ? (type === 'select' ? parseInt(element.value) || defaultValue : element.value) : defaultValue;
}
function saveSettings() {
    try {
        localStorage.setItem('upperWindsSettings', JSON.stringify(userSettings));
        saveUnlockStatus();
    } catch (error) {
        console.warn('Failed to save settings to localStorage:', error);
    }
}
function saveUnlockStatus() {
    const unlockedFeatures = {
        landingPattern: isLandingPatternUnlocked,
        calculateJump: isCalculateJumpUnlocked
    };
    localStorage.setItem('unlockedFeatures', JSON.stringify(unlockedFeatures));
}
function initializeSettings() {
    const storedSettings = JSON.parse(localStorage.getItem('upperWindsSettings')) || {};
    userSettings = { ...defaultSettings };
    for (const key in defaultSettings) {
        if (storedSettings.hasOwnProperty(key)) {
            userSettings[key] = storedSettings[key];
        }
    }
    userSettings.jumpRunTrackOffset = 0;
    isJumperSeparationManual = false; // Start with auto separation
    console.log('Loaded userSettings:', userSettings);
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

// == Utility Functions ==
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
async function getAltitude(lat, lng) {
    const { elevation } = await Utils.getLocationData(lat, lng);
    console.log('Fetched elevation from Open-Meteo:', elevation);
    return elevation !== 'N/A' ? elevation : 'N/A';
}
function getLastFullHourUTC() {
    const now = new Date();
    const utcYear = now.getUTCFullYear();
    const utcMonth = now.getUTCMonth();
    const utcDate = now.getUTCDate();
    const utcHour = now.getUTCHours();
    const lastFullHour = new Date(Date.UTC(utcYear, utcMonth, utcDate, utcHour, 0, 0));
    console.log('Last full hour UTC:', lastFullHour.toISOString());
    return lastFullHour; // Return Date object instead of string
}
async function getDisplayTime(utcTimeStr) {
    const timeZone = document.querySelector('input[name="timeZone"]:checked')?.value || 'Z';
    if (timeZone === 'Z' || !lastLat || !lastLng) {
        return Utils.formatTime(utcTimeStr); // Synchronous
    } else {
        return await Utils.formatLocalTime(utcTimeStr, lastLat, lastLng); // Async
    }
}
function calculateBearing(lat1, lng1, lat2, lng2) {
    const toRad = deg => deg * Math.PI / 180;
    const toDeg = rad => rad * 180 / Math.PI;

    const dLon = toRad(lng2 - lng1);
    const y = Math.sin(dLon) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
        Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
    let bearing = toDeg(Math.atan2(y, x));
    bearing = (bearing + 360) % 360; // Normalize to 0-360
    return bearing;
}
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// == Map Initialization and Interaction ==
function initMap() {
    const defaultCenter = [48.0179, 11.1923];
    const defaultZoom = 11;

    map = L.map('map', {
        center: defaultCenter,
        zoom: defaultZoom,
        zoomControl: false,
        doubleClickZoom: false // Disable double-click zoom globally
    });

    // Base layers setup (unchanged)
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

    const openMeteoAttribution = 'Weather data by <a href="https://open-meteo.com">Open-Meteo</a>';
    map.attributionControl.addAttribution(openMeteoAttribution);

    const selectedBaseMap = userSettings.baseMap in baseMaps ? userSettings.baseMap : "Esri Street";
    const fallbackBaseMap = "OpenStreetMap";
    const layer = baseMaps[selectedBaseMap];
    layer.on('tileerror', () => {
        console.warn(`${selectedBaseMap} tiles failed to load, switching to ${fallbackBaseMap}`);
        if (map.hasLayer(layer)) {
            map.removeLayer(layer);
            baseMaps[fallbackBaseMap].addTo(map);
            userSettings.baseMap = fallbackBaseMap;
            saveSettings();
        }
    });
    layer.addTo(map);

    L.control.layers(baseMaps, null, { position: 'topright' }).addTo(map);
    map.on('baselayerchange', function (e) {
        userSettings.baseMap = e.name;
        saveSettings();
        console.log(`Base map changed to: ${e.name}`);
    });

    L.control.zoom({ position: 'topright' }).addTo(map);
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

    L.control.scale({
        position: 'bottomleft',
        metric: true,
        imperial: true,
        maxWidth: 100
    }).addTo(map);

    const initialAltitude = 'N/A';
    currentMarker = createCustomMarker(defaultCenter[0], defaultCenter[1]).addTo(map);
    attachMarkerDragend(currentMarker);
    updateMarkerPopup(currentMarker, defaultCenter[0], defaultCenter[1], initialAltitude, true); // Open popup initially
    if (userSettings.calculateJump) {
        calculateJump();
        calculateCutAway();
    }
    recenterMap();

    // Helper function to handle initial fetch
    async function fetchInitialWeather(lat, lng) {
        const lastFullHourUTC = getLastFullHourUTC();
        console.log('initMap: Last full hour UTC:', lastFullHourUTC.toISOString());
        let initialTime;
        if (userSettings.timeZone === 'Z') {
            initialTime = lastFullHourUTC.toISOString().replace(':00.000Z', 'Z');
        } else {
            const localTimeStr = await Utils.formatLocalTime(lastFullHourUTC.toISOString(), lastLat, lastLng);
            console.log('initMap: Local time string:', localTimeStr);
            const localDate = new Date(`${localTimeStr}:00Z`);
            initialTime = new Date(localDate.getTime() - (2 * 60 * 60 * 1000)).toISOString().replace(':00.000Z', 'Z');
        }
        console.log('initMap: initialTime:', initialTime);
        await fetchWeatherForLocation(lat, lng, initialTime, true);
    }

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

                currentMarker = createCustomMarker(lastLat, lastLng).addTo(map);
                attachMarkerDragend(currentMarker);
                updateMarkerPopup(currentMarker, lastLat, lastLng, lastAltitude, true); // Open popup initially
                if (userSettings.calculateJump) {
                    calculateJump();
                    calculateCutAway();
                }
                recenterMap();

                const lastFullHourUTC = getLastFullHourUTC();
                const initialTime = userSettings.timeZone === 'Z'
                    ? lastFullHourUTC.toISOString().replace(':00.000Z', 'Z')
                    : await Utils.formatLocalTime(lastFullHourUTC.toISOString(), lastLat, lastLng);
                await fetchWeatherForLocation(lastLat, lastLng, initialTime, true);
            },
            async (error) => {
                console.warn(`Geolocation error: ${error.message}`);
                Utils.handleError('Unable to retrieve your location. Using default location.');
                lastLat = defaultCenter[0];
                lastLng = defaultCenter[1];
                lastAltitude = await getAltitude(lastLat, lastLng);
                updateMarkerPopup(currentMarker, lastLat, lastLng, lastAltitude, true); // Open popup initially
                recenterMap();

                const lastFullHourUTC = getLastFullHourUTC();
                const initialTime = userSettings.timeZone === 'Z'
                    ? lastFullHourUTC.toISOString().replace(':00.000Z', 'Z')
                    : await Utils.formatLocalTime(lastFullHourUTC.toISOString(), lastLat, lastLng);
                await fetchWeatherForLocation(lastLat, lastLng, initialTime, true);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    } else {
        console.warn('Geolocation not supported.');
        Utils.handleError('Geolocation not supported. Using default location.');
        lastLat = defaultCenter[0];
        lastLng = defaultCenter[1];
        lastAltitude = getAltitude(lastLat, lastLng);
        updateMarkerPopup(currentMarker, lastLat, lastLng, lastAltitude, true); // Open popup initially
        recenterMap();

        const lastFullHourUTC = getLastFullHourUTC();
        console.log('initMap: Last full hour UTC:', lastFullHourUTC.toISOString());
        const initialTime = userSettings.timeZone === 'Z'
            ? lastFullHourUTC.toISOString().replace(':00.000Z', 'Z')
            : Utils.formatLocalTime(lastFullHourUTC.toISOString(), lastLat, lastLng);
        console.log('initMap: initialTime:', initialTime);
        fetchWeatherForLocation(lastLat, lastLng, initialTime, true);
    }

    // Coordinate control with elevation
    L.Control.Coordinates = L.Control.extend({
        options: { position: 'bottomleft' },
        onAdd: function (map) {
            var container = L.DomUtil.create('div', 'leaflet-control-coordinates');
            container.style.background = 'rgba(255, 255, 255, 0.8)';
            container.style.padding = '5px';
            container.style.borderRadius = '4px';
            container.style.boxShadow = '0 2px 5px rgba(0, 0, 0, 0.2)';
            container.innerHTML = 'Move mouse over map';
            this._container = container;
            return container;
        },
        update: function (content) {
            this._container.innerHTML = content;
        }
    });

    var coordsControl = new L.Control.Coordinates();
    coordsControl.addTo(map);

    // Cache for elevation to reduce API calls
    const elevationCache = new Map(); // Key: "lat,lng", Value: elevation

    // Debounced elevation fetch
    const debouncedGetElevation = debounce(async (lat, lng, requestLatLng, callback) => {
        const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
        if (elevationCache.has(cacheKey)) {
            console.log('Using cached elevation:', { lat, lng, elevation: elevationCache.get(cacheKey) });
            callback(elevationCache.get(cacheKey), requestLatLng);
            return;
        }
        try {
            const elevation = await getAltitude(lat, lng);
            elevationCache.set(cacheKey, elevation);
            console.log('Fetched elevation:', { lat, lng, elevation });
            callback(elevation, requestLatLng);
        } catch (error) {
            console.warn('Failed to fetch elevation:', error);
            callback('N/A', requestLatLng);
        }
    }, 500);

    // Track last mouse position
    let lastMouseLatLng = null;

    map.on('mousemove', function (e) {
        const coordFormat = getCoordinateFormat();
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        lastMouseLatLng = { lat, lng }; // Store current mouse position

        let coordText;
        if (coordFormat === 'MGRS') {
            const mgrs = Utils.decimalToMgrs(lat, lng);
            coordText = `MGRS: ${mgrs}`;
        } else {
            coordText = `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;
        }

        // Update immediately with coordinates and fetching status
        coordsControl.update(`${coordText}<br>Elevation: Fetching...`);

        // Fetch elevation with debounce
        debouncedGetElevation(lat, lng, { lat, lng }, (elevation, requestLatLng) => {
            // Check if mouse is still near the requested position
            if (lastMouseLatLng) {
                const deltaLat = Math.abs(lastMouseLatLng.lat - requestLatLng.lat);
                const deltaLng = Math.abs(lastMouseLatLng.lng - requestLatLng.lng);
                const threshold = 0.05; // ~5.5km, generous to account for movement
                if (deltaLat < threshold && deltaLng < threshold) {
                    console.log('Updating elevation display:', { lat: requestLatLng.lat, lng: requestLatLng.lng, elevation });
                    coordsControl.update(`${coordText}<br>Elevation: ${elevation === 'N/A' ? 'N/A' : elevation + 'm'}`);
                } else {
                    console.log('Discarded elevation update: mouse moved too far', {
                        requestLat: requestLatLng.lat,
                        requestLng: requestLatLng.lng,
                        currentLat: lastMouseLatLng.lat,
                        currentLng: lastMouseLatLng.lng
                    });
                }
            } else {
                console.warn('No lastMouseLatLng, skipping elevation update');
            }
        });
    });

    map.on('mouseout', function () {
        coordsControl.getContainer().innerHTML = 'Move mouse over map';
    });

    // Map click and touch events (unchanged from previous modification)
    map.on('dblclick', async (e) => {
        const { lat, lng } = e.latlng;
        lastLat = lat;
        lastLng = lng;
        lastAltitude = await getAltitude(lat, lng);
        console.log('Map double-clicked, moving marker to:', { lat, lng });

        if (currentMarker) currentMarker.remove();
        currentMarker = createCustomMarker(lat, lng).addTo(map);
        attachMarkerDragend(currentMarker);
        currentMarker.on('click', () => {
            if (currentMarker.getPopup()?.isOpen()) {
                currentMarker.closePopup();
            } else {
                updateMarkerPopup(currentMarker, lastLat, lastLng, lastAltitude, true);
            }
        });

        updateMarkerPopup(currentMarker, lastLat, lastLng, lastAltitude, true);
        resetJumpRunDirection(false); // Do NOT update JRT yet
        if (userSettings.calculateJump) {
            console.log('Recalculating jump for marker click');
            calculateJump();
            calculateCutAway();
        }
        recenterMap();

        const slider = document.getElementById('timeSlider');
        const currentIndex = parseInt(slider.value) || 0;
        const currentTime = weatherData?.time?.[currentIndex] || null;

        // Fetch weather data first
        await fetchWeatherForLocation(lat, lng, currentTime);

        // Now update JRT with new weather data
        if (userSettings.showJumpRunTrack) {
            console.log('Updating JRT after weather fetch for double-click');
            updateJumpRunTrack();
        }
    });


    map.on('zoomend', () => {
        const currentZoom = map.getZoom();
        console.log('Zoom level changed to:', currentZoom);

        if (userSettings.calculateJump && weatherData && lastLat && lastLng) {
            console.log('Recalculating jump for zoom:', currentZoom);
            const jumpResult = calculateJump();
            console.log('Jump result:', jumpResult);
            if (jumpResult) {
                console.log('Calling updateJumpCircle with:', {
                    blueLat: jumpResult.radius ? lastLat : 0,
                    blueLng: jumpResult.radius ? lastLng : 0,
                    redLat: jumpResult.freeFall.path[jumpResult.freeFall.path.length - 1].latLng[0],
                    redLng: jumpResult.freeFall.path[jumpResult.freeFall.path.length - 1].latLng[1],
                    radius: jumpResult.radius,
                    radiusFull: jumpResult.radiusFull,
                    displacement: jumpResult.displacement,
                    displacementFull: jumpResult.displacementFull,
                    direction: jumpResult.direction,
                    directionFull: jumpResult.directionFull,
                    freeFallDirection: jumpResult.freeFallDirection,
                    freeFallDistance: jumpResult.freeFallDistance,
                    zoom: currentZoom
                });
                updateJumpCircle(
                    jumpResult.radius ? lastLat : 0,
                    jumpResult.radius ? lastLng : 0,
                    jumpResult.freeFall.path[jumpResult.freeFall.path.length - 1].latLng[0],
                    jumpResult.freeFall.path[jumpResult.freeFall.path.length - 1].latLng[1],
                    jumpResult.radius,
                    jumpResult.radiusFull,
                    jumpResult.displacement,
                    jumpResult.displacementFull,
                    jumpResult.direction,
                    jumpResult.directionFull,
                    jumpResult.freeFallDirection,
                    jumpResult.freeFallDistance,
                    jumpResult.freeFall.time
                );
            } else {
                console.warn('calculateJump returned null, clearing jump circles');
                clearJumpCircles();
            }
        }

        if (userSettings.showJumpRunTrack) {
            console.log('Updating jump run track for zoom:', currentZoom);
            updateJumpRunTrack();
        }

        if (userSettings.showLandingPattern) {
            console.log('Updating landing pattern for zoom:', currentZoom);
            updateLandingPattern();
        }

        if (currentMarker && lastLat && lastLng) {
            currentMarker.setLatLng([lastLat, lastLng]);
            updateMarkerPopup(currentMarker, lastLat, lastLng, lastAltitude, false);
        }
    });

    // Log initial zoom to confirm map setup
    console.log('Initial zoom level:', map.getZoom());

    let lastTapTime = 0;
    const tapThreshold = 300;
    const mapContainer = map.getContainer();

    mapContainer.addEventListener('touchstart', async (e) => {
        if (e.touches.length !== 1) return;
        const currentTime = new Date().getTime();
        const timeSinceLastTap = currentTime - lastTapTime;
        if (timeSinceLastTap < tapThreshold && timeSinceLastTap > 0) {
            e.preventDefault();
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
            currentMarker.on('click', () => {
                if (currentMarker.getPopup()?.isOpen()) {
                    currentMarker.closePopup();
                } else {
                    updateMarkerPopup(currentMarker, lastLat, lastLng, lastAltitude, true);
                }
            });
            updateMarkerPopup(currentMarker, lastLat, lastLng, lastAltitude, true);
            resetJumpRunDirection(true);
            if (userSettings.calculateJump) {
                calculateJump();
                calculateCutAway();
            }
            recenterMap();
            const slider = document.getElementById('timeSlider');
            const currentIndex = parseInt(slider.value) || 0;
            const currentTime = weatherData?.time?.[currentIndex] || null;
            await fetchWeatherForLocation(lastLat, lastLng, currentTime);
        }
        lastTapTime = currentTime;
    }, { passive: false });
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
        const wasOpen = marker.getPopup()?.isOpen() || false;
        updateMarkerPopup(marker, lastLat, lastLng, lastAltitude, wasOpen);
        console.log('Marker dragged to:', { lat: lastLat, lng: lastLng });
        resetJumpRunDirection(true);
        if (userSettings.calculateJump) {
            console.log('Recalculating jump for marker drag');
            calculateJump();
            calculateCutAway();
        }
        recenterMap();
        const slider = document.getElementById('timeSlider');
        const currentIndex = parseInt(slider.value) || 0;
        const currentTime = weatherData?.time?.[currentIndex] || null;
        document.getElementById('info').innerHTML = `Fetching weather and models...`;
        const availableModels = await checkAvailableModels(lastLat, lastLng);
        if (availableModels.length > 0) {
            await fetchWeatherForLocation(lastLat, lastLng, currentTime);
            updateModelRunInfo();
            if (lastAltitude !== 'N/A') calculateMeanWind();
            updateLandingPattern();
            if (userSettings.showJumpRunTrack) {
                console.log('Updating JRT after weather fetch for marker drag');
                updateJumpRunTrack();
            }
            slider.value = currentIndex;
        } else {
            document.getElementById('info').innerHTML = `No models available.`;
        }
    });
}
async function updateMarkerPopup(marker, lat, lng, altitude, open = false) {
    console.log('Updating marker popup:', { lat, lng, altitude, format: getCoordinateFormat(), open });
    const coordFormat = getCoordinateFormat();
    const coords = Utils.convertCoords(lat, lng, coordFormat);
    const sliderIndex = getSliderValue();

    // If weatherData is missing and we have coordinates, fetch it
    if (!weatherData && lat && lng) {
        console.log('No weather data available, fetching for:', { lat, lng });
        await fetchWeatherForLocation(lat, lng, null, false);
    }

    console.log('Weather data status:', {
        weatherDataExists: !!weatherData,
        surfacePressureExists: !!weatherData?.surface_pressure,
        sliderIndex,
        surfacePressureLength: weatherData?.surface_pressure?.length,
        samplePressure: weatherData?.surface_pressure?.[sliderIndex]
    });

    let popupContent;
    if (coordFormat === 'MGRS') {
        popupContent = `MGRS: ${coords.lat}<br>Alt: ${altitude}m`;
    } else {
        popupContent = `Lat: ${coords.lat}<br>Lng: ${coords.lng}<br>Alt: ${altitude}m`;
    }

    if (weatherData && weatherData.surface_pressure && sliderIndex >= 0 && sliderIndex < weatherData.surface_pressure.length) {
        const surfacePressure = weatherData.surface_pressure[sliderIndex];
        popupContent += ` QFE: ${surfacePressure.toFixed(0)} hPa`;
    } else {
        popupContent += ` QFE: N/A`;
        console.warn('Surface pressure not available:', {
            hasWeatherData: !!weatherData,
            hasSurfacePressure: !!weatherData?.surface_pressure,
            sliderIndexValid: sliderIndex >= 0 && sliderIndex < (weatherData?.surface_pressure?.length || 0)
        });
    }

    if (!marker.getPopup()) {
        marker.bindPopup(popupContent);
    } else {
        marker.setPopupContent(popupContent);
    }

    if (open) {
        marker.openPopup();
    }
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
function initializeMap() {
    console.log('Initializing map...');
    initMap();
}

// == Weather Data Handling ==
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
async function fetchWeatherForLocation(lat, lng, currentTime = null, isInitialLoad = false) {
    document.getElementById('info').innerHTML = `Fetching weather and models...`;
    const availableModels = await checkAvailableModels(lat, lng);
    if (availableModels.length > 0) {
        await fetchWeather(lat, lng, currentTime, isInitialLoad);
        updateModelRunInfo();
        if (lastAltitude !== 'N/A') {
            calculateMeanWind();
            if (userSettings.calculateJump) {
                console.log('Recalculating jump for location change');
                calculateJump();
                calculateCutAway(); // Call calculateCutAway after calculateJump
            }
        }
        updateLandingPattern();
        restoreUIInteractivity(); // Ensure UI is responsive
    } else {
        document.getElementById('info').innerHTML = `No models available.`;
        restoreUIInteractivity(); // Even on failure, check UI
    }
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
            'ecmwf_aifs025': 'ecmwf_aifs025_single',
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
            throw new Error(`Meta fetch failed: ${metaResponse.status} - ${errorText}`);
        }
        const metaData = await metaResponse.json();
        const runDate = new Date(metaData.last_run_initialisation_time * 1000);
        const utcNow = new Date(Date.UTC(
            new Date().getUTCFullYear(),
            new Date().getUTCMonth(),
            new Date().getUTCDate(),
            new Date().getUTCHours(),
            new Date().getUTCSeconds()
        ));
        const year = runDate.getUTCFullYear();
        const month = String(runDate.getUTCMonth() + 1).padStart(2, '0');
        const day = String(runDate.getUTCDate()).padStart(2, '0');
        const hour = String(runDate.getUTCHours()).padStart(2, '0');
        const minute = String(runDate.getUTCMinutes()).padStart(2, '0');
        lastModelRun = `${year}-${month}-${day} ${hour}${minute}Z`;

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
        if (startDate > utcNow) {
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
            `&hourly=surface_pressure,temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,` +
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

        console.log('Fetching weather from:', url);
        const response = await fetch(url);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! Status: ${response.status} - ${errorText}`);
        }

        const data = await response.json();

        if (!data.hourly || !data.hourly.time) {
            throw new Error('No hourly data returned from API');
        }

        const lastValidIndex = data.hourly.time.length - 1;

        weatherData = {
            time: data.hourly.time.slice(0, lastValidIndex + 1),
            surface_pressure: data.hourly.surface_pressure?.slice(0, lastValidIndex + 1) || [],
            temperature_2m: data.hourly.temperature_2m?.slice(0, lastValidIndex + 1) || [],
            relative_humidity_2m: data.hourly.relative_humidity_2m?.slice(0, lastValidIndex + 1) || [],
            wind_speed_10m: data.hourly.wind_speed_10m?.slice(0, lastValidIndex + 1) || [],
            wind_direction_10m: data.hourly.wind_direction_10m?.slice(0, lastValidIndex + 1) || [],
            wind_gusts_10m: data.hourly.wind_gusts_10m?.slice(0, lastValidIndex + 1) || [],
            temperature_1000hPa: data.hourly.temperature_1000hPa?.slice(0, lastValidIndex + 1) || [],
            relative_humidity_1000hPa: data.hourly.relative_humidity_1000hPa?.slice(0, lastValidIndex + 1) || [],
            wind_speed_1000hPa: data.hourly.wind_speed_1000hPa?.slice(0, lastValidIndex + 1) || [],
            wind_direction_1000hPa: data.hourly.wind_direction_1000hPa?.slice(0, lastValidIndex + 1) || [],
            geopotential_height_1000hPa: data.hourly.geopotential_height_1000hPa?.slice(0, lastValidIndex + 1) || [],
            temperature_950hPa: data.hourly.temperature_950hPa?.slice(0, lastValidIndex + 1) || [],
            relative_humidity_950hPa: data.hourly.relative_humidity_950hPa?.slice(0, lastValidIndex + 1) || [],
            wind_speed_950hPa: data.hourly.wind_speed_950hPa?.slice(0, lastValidIndex + 1) || [],
            wind_direction_950hPa: data.hourly.wind_direction_950hPa?.slice(0, lastValidIndex + 1) || [],
            geopotential_height_950hPa: data.hourly.geopotential_height_950hPa?.slice(0, lastValidIndex + 1) || [],
            temperature_925hPa: data.hourly.temperature_925hPa?.slice(0, lastValidIndex + 1) || [],
            relative_humidity_925hPa: data.hourly.relative_humidity_925hPa?.slice(0, lastValidIndex + 1) || [],
            wind_speed_925hPa: data.hourly.wind_speed_925hPa?.slice(0, lastValidIndex + 1) || [],
            wind_direction_925hPa: data.hourly.wind_direction_925hPa?.slice(0, lastValidIndex + 1) || [],
            geopotential_height_925hPa: data.hourly.geopotential_height_925hPa?.slice(0, lastValidIndex + 1) || [],
            temperature_900hPa: data.hourly.temperature_900hPa?.slice(0, lastValidIndex + 1) || [],
            relative_humidity_900hPa: data.hourly.relative_humidity_900hPa?.slice(0, lastValidIndex + 1) || [],
            wind_speed_900hPa: data.hourly.wind_speed_900hPa?.slice(0, lastValidIndex + 1) || [],
            wind_direction_900hPa: data.hourly.wind_direction_900hPa?.slice(0, lastValidIndex + 1) || [],
            geopotential_height_900hPa: data.hourly.geopotential_height_900hPa?.slice(0, lastValidIndex + 1) || [],
            temperature_850hPa: data.hourly.temperature_850hPa?.slice(0, lastValidIndex + 1) || [],
            relative_humidity_850hPa: data.hourly.relative_humidity_850hPa?.slice(0, lastValidIndex + 1) || [],
            wind_speed_850hPa: data.hourly.wind_speed_850hPa?.slice(0, lastValidIndex + 1) || [],
            wind_direction_850hPa: data.hourly.wind_direction_850hPa?.slice(0, lastValidIndex + 1) || [],
            geopotential_height_850hPa: data.hourly.geopotential_height_850hPa?.slice(0, lastValidIndex + 1) || [],
            temperature_800hPa: data.hourly.temperature_800hPa?.slice(0, lastValidIndex + 1) || [],
            relative_humidity_800hPa: data.hourly.relative_humidity_800hPa?.slice(0, lastValidIndex + 1) || [],
            wind_speed_800hPa: data.hourly.wind_speed_800hPa?.slice(0, lastValidIndex + 1) || [],
            wind_direction_800hPa: data.hourly.wind_direction_800hPa?.slice(0, lastValidIndex + 1) || [],
            geopotential_height_800hPa: data.hourly.geopotential_height_800hPa?.slice(0, lastValidIndex + 1) || [],
            temperature_700hPa: data.hourly.temperature_700hPa?.slice(0, lastValidIndex + 1) || [],
            relative_humidity_700hPa: data.hourly.relative_humidity_700hPa?.slice(0, lastValidIndex + 1) || [],
            wind_speed_700hPa: data.hourly.wind_speed_700hPa?.slice(0, lastValidIndex + 1) || [],
            wind_direction_700hPa: data.hourly.wind_direction_700hPa?.slice(0, lastValidIndex + 1) || [],
            geopotential_height_700hPa: data.hourly.geopotential_height_700hPa?.slice(0, lastValidIndex + 1) || [],
            temperature_600hPa: data.hourly.temperature_600hPa?.slice(0, lastValidIndex + 1) || [],
            relative_humidity_600hPa: data.hourly.relative_humidity_600hPa?.slice(0, lastValidIndex + 1) || [],
            wind_speed_600hPa: data.hourly.wind_speed_600hPa?.slice(0, lastValidIndex + 1) || [],
            wind_direction_600hPa: data.hourly.wind_direction_600hPa?.slice(0, lastValidIndex + 1) || [],
            geopotential_height_600hPa: data.hourly.geopotential_height_600hPa?.slice(0, lastValidIndex + 1) || [],
            temperature_500hPa: data.hourly.temperature_500hPa?.slice(0, lastValidIndex + 1) || [],
            relative_humidity_500hPa: data.hourly.relative_humidity_500hPa?.slice(0, lastValidIndex + 1) || [],
            wind_speed_500hPa: data.hourly.wind_speed_500hPa?.slice(0, lastValidIndex + 1) || [],
            wind_direction_500hPa: data.hourly.wind_direction_500hPa?.slice(0, lastValidIndex + 1) || [],
            geopotential_height_500hPa: data.hourly.geopotential_height_500hPa?.slice(0, lastValidIndex + 1) || [],
            temperature_400hPa: data.hourly.temperature_400hPa?.slice(0, lastValidIndex + 1) || [],
            relative_humidity_400hPa: data.hourly.relative_humidity_400hPa?.slice(0, lastValidIndex + 1) || [],
            wind_speed_400hPa: data.hourly.wind_speed_400hPa?.slice(0, lastValidIndex + 1) || [],
            wind_direction_400hPa: data.hourly.wind_direction_400hPa?.slice(0, lastValidIndex + 1) || [],
            geopotential_height_400hPa: data.hourly.geopotential_height_400hPa?.slice(0, lastValidIndex + 1) || [],
            temperature_300hPa: data.hourly.temperature_300hPa?.slice(0, lastValidIndex + 1) || [],
            relative_humidity_300hPa: data.hourly.relative_humidity_300hPa?.slice(0, lastValidIndex + 1) || [],
            wind_speed_300hPa: data.hourly.wind_speed_300hPa?.slice(0, lastValidIndex + 1) || [],
            wind_direction_300hPa: data.hourly.wind_direction_300hPa?.slice(0, lastValidIndex + 1) || [],
            geopotential_height_300hPa: data.hourly.geopotential_height_300hPa?.slice(0, lastValidIndex + 1) || [],
            temperature_250hPa: data.hourly.temperature_250hPa?.slice(0, lastValidIndex + 1) || [],
            relative_humidity_250hPa: data.hourly.relative_humidity_250hPa?.slice(0, lastValidIndex + 1) || [],
            wind_speed_250hPa: data.hourly.wind_speed_250hPa?.slice(0, lastValidIndex + 1) || [],
            wind_direction_250hPa: data.hourly.wind_direction_250hPa?.slice(0, lastValidIndex + 1) || [],
            geopotential_height_250hPa: data.hourly.geopotential_height_250hPa?.slice(0, lastValidIndex + 1) || [],
            temperature_200hPa: data.hourly.temperature_200hPa?.slice(0, lastValidIndex + 1) || [],
            relative_humidity_200hPa: data.hourly.relative_humidity_200hPa?.slice(0, lastValidIndex + 1) || [],
            wind_speed_200hPa: data.hourly.wind_speed_200hPa?.slice(0, lastValidIndex + 1) || [],
            wind_direction_200hPa: data.hourly.wind_direction_200hPa?.slice(0, lastValidIndex + 1) || [],
            geopotential_height_200hPa: data.hourly.geopotential_height_200hPa?.slice(0, lastValidIndex + 1) || []
        };

        const slider = document.getElementById('timeSlider');
        slider.min = 0;
        slider.max = weatherData.time.length - 1;

        if (weatherData.time.length <= 1) {
            slider.disabled = true;
            slider.style.opacity = '0.5';
            slider.style.cursor = 'not-allowed';
            document.getElementById('info').innerHTML += '<br><strong>Note:</strong> Only one forecast time available.';
        } else {
            slider.disabled = false;
            slider.style.opacity = '1';
            slider.style.cursor = 'pointer';
        }

        // Set slider to closest time based on currentTime
        console.log('fetchWeather: currentTime received:', currentTime);
        console.log('Luxon available:', typeof luxon !== 'undefined' ? luxon.VERSION : 'Not loaded');
        let initialIndex = 0;
        if (currentTime && weatherData.time.length > 0) {
            let targetDate = null;
            // Handle "YYYY-MM-DD HHMM GMT+2" format
            if (typeof currentTime === 'string' && currentTime.includes('GMT')) {
                const match = currentTime.match(/^(\d{4}-\d{2}-\d{2})\s(\d{4})\sGMT([+-]\d{1,2})$/);
                if (match) {
                    const [, dateStr, timeStr, offset] = match;
                    const formattedTime = `${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}`;
                    // Parse offset number and pad to two digits
                    const offsetNum = parseInt(offset);
                    const formattedOffset = `${offsetNum >= 0 ? '+' : '-'}${Math.abs(offsetNum).toString().padStart(2, '0')}:00`;
                    const isoString = `${dateStr}T${formattedTime}:00${formattedOffset}`;
                    targetDate = luxon.DateTime.fromISO(isoString);
                    console.log('fetchWeather: Parsed ISO string:', isoString);
                } else {
                    console.warn('fetchWeather: Invalid currentTime format:', currentTime);
                }
            } else {
                // Try standard ISO format
                targetDate = luxon.DateTime.fromISO(currentTime, { zone: 'utc' });
            }
            console.log('fetchWeather: targetDate (ISO):', targetDate && targetDate.isValid ? targetDate.toISO() : null);
            if (targetDate && targetDate.isValid) {
                const targetTimestamp = targetDate.toMillis();
                console.log('fetchWeather: targetTimestamp:', targetTimestamp);
                let minDiff = Infinity;
                weatherData.time.forEach((time, index) => {
                    const timeTimestamp = luxon.DateTime.fromISO(time, { zone: 'utc' }).toMillis();
                    const diff = Math.abs(timeTimestamp - targetTimestamp);
                    if (diff < minDiff) {
                        minDiff = diff;
                        initialIndex = index;
                    }
                });
                console.log(`fetchWeather: Slider set to index ${initialIndex} for time ${weatherData.time[initialIndex]}`);
            } else {
                console.warn('fetchWeather: Failed to parse currentTime, defaulting to index 0');
            }
        } else {
            // Default to closest current or future time
            const now = luxon.DateTime.utc();
            console.log('fetchWeather: No currentTime provided, using current UTC time:', now.toISO());
            let minDiff = Infinity;
            weatherData.time.forEach((time, index) => {
                const timeTimestamp = luxon.DateTime.fromISO(time, { zone: 'utc' }).toMillis();
                const diff = Math.abs(timeTimestamp - now.toMillis());
                if (diff < minDiff) {
                    minDiff = diff;
                    initialIndex = index;
                }
            });
            console.log(`fetchWeather: Slider set to index ${initialIndex} for time ${weatherData.time[initialIndex]}`);
        }
        slider.value = initialIndex;
        await updateWeatherDisplay(initialIndex);
        document.getElementById('loading').style.display = 'none';

        // Reattach slider event listener after initial set
        slider.oninput = function () {
            console.log('Slider oninput triggered, new value:', this.value);
            updateWeatherDisplay(this.value);
        };
    } catch (error) {
        document.getElementById('loading').style.display = 'none';
        Utils.handleError(`Failed to fetch weather data: ${error.message}`);
    }
}
async function updateWeatherDisplay(index, originalTime = null) {
    console.log(`updateWeatherDisplay called with index: ${index}, Time: ${weatherData.time[index]}`);
    if (!weatherData || !weatherData.time || index < 0 || index >= weatherData.time.length) {
        console.error('No weather data available or index out of bounds:', index);
        document.getElementById('info').innerHTML = 'No weather data available';
        document.getElementById('selectedTime').innerHTML = 'Selected Time: ';
        const slider = document.getElementById('timeSlider');
        if (slider) slider.value = 0;
        return;
    }

    landingWindDir = weatherData.wind_direction_10m[index] || null;
    console.log('landingWindDir updated to:', landingWindDir);

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
    const time = await getDisplayTime(weatherData.time[index]);
    const interpolatedData = interpolateWeatherData(index);
    const surfaceHeight = refLevel === 'AMSL' && lastAltitude !== 'N/A' ? Math.round(lastAltitude) : 0; // Surface height in meters

    let output = `<table>`;
    output += `<tr><th>Height (${heightUnit} ${refLevel})</th><th>Dir (deg)</th><th>Spd (${windSpeedUnit})</th><th>Wind</th><th>T (${temperatureUnit === 'C' ? '°C' : '°F'})</th></tr>`;
    interpolatedData.forEach((data, idx) => {
        const spd = parseFloat(data.spd); // spd is in km/h from Open-Meteo
        let rowClass = '';
        if (windSpeedUnit === 'bft') {
            const bft = Math.round(spd);
            if (bft <= 1) rowClass = 'wind-low';
            else if (bft <= 3) rowClass = 'wind-moderate';
            else if (bft <= 4) rowClass = 'wind-high';
            else rowClass = 'wind-very-high';
        } else {
            const spdInKt = Utils.convertWind(spd, 'kt', 'km/h');
            if (spdInKt <= 3) rowClass = 'wind-low';
            else if (spdInKt <= 10) rowClass = 'wind-moderate';
            else if (spdInKt <= 16) rowClass = 'wind-high';
            else rowClass = 'wind-very-high';
        }
        // Adjust display height for AMSL by adding surface height in user's unit
        const displayHeight = refLevel === 'AMSL' ? data.displayHeight + (heightUnit === 'ft' ? Math.round(surfaceHeight * 3.28084) : surfaceHeight) : data.displayHeight;
        const displayTemp = Utils.convertTemperature(data.temp, temperatureUnit === 'C' ? '°C' : '°F');
        const formattedTemp = displayTemp === 'N/A' ? 'N/A' : displayTemp.toFixed(0);

        const convertedSpd = Utils.convertWind(spd, windSpeedUnit, 'km/h');
        let formattedWind;
        //console.log('Debug: displayHeight:', displayHeight, 'wind_gusts_10m:', weatherData.wind_gusts_10m[index]);
        const surfaceDisplayHeight = refLevel === 'AMSL' ? (heightUnit === 'ft' ? Math.round(surfaceHeight * 3.28084) : surfaceHeight) : 0;
        if (Math.round(displayHeight) === surfaceDisplayHeight && weatherData.wind_gusts_10m[index] !== undefined && Number.isFinite(weatherData.wind_gusts_10m[index])) {
            const gustSpd = weatherData.wind_gusts_10m[index]; // Gusts in km/h
            const convertedGust = Utils.convertWind(gustSpd, windSpeedUnit, 'km/h');
            const spdValue = windSpeedUnit === 'bft' ? Math.round(convertedSpd) : convertedSpd.toFixed(0);
            const gustValue = windSpeedUnit === 'bft' ? Math.round(convertedGust) : convertedGust.toFixed(0);
            formattedWind = `${spdValue} G ${gustValue}`;
        } else {
            formattedWind = convertedSpd === 'N/A' ? 'N/A' : (windSpeedUnit === 'bft' ? Math.round(convertedSpd) : convertedSpd.toFixed(0));
        }

        const speedKt = Math.round(Utils.convertWind(spd, 'kt', 'km/h') / 5) * 5;
        const windBarbSvg = data.dir === 'N/A' || isNaN(speedKt) ? 'N/A' : generateWindBarb(data.dir, speedKt);

        output += `<tr class="${rowClass}"><td>${Math.round(displayHeight)}</td><td>${Utils.roundToTens(data.dir)}</td><td>${formattedWind}</td><td>${windBarbSvg}</td><td>${formattedTemp}</td></tr>`;
    });
    output += `</table>`;
    document.getElementById('info').innerHTML = output;
    document.getElementById('selectedTime').innerHTML = `Selected Time: ${time}`;
    updateLandingPattern();
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
    const heights = interpolatedData.map(d => d.height);
    const dirs = interpolatedData.map(d => parseFloat(d.dir) || 0);
    const spds = interpolatedData.map(d => Utils.convertWind(parseFloat(d.spd) || 0, windSpeedUnit, 'km/h')); // Fixed order

    const xKomponente = spds.map((spd, i) => -spd * Math.sin(dirs[i] * Math.PI / 180));
    const yKomponente = spds.map((spd, i) => -spd * Math.cos(dirs[i] * Math.PI / 180));

    const meanWind = Utils.calculateMeanWind(heights, xKomponente, yKomponente, lowerLimit, upperLimit);
    const [dir, spd] = meanWind;

    const roundedDir = Utils.roundToTens(dir);
    const displayLower = Math.round(Utils.convertHeight(lowerLimitInput, heightUnit));
    const displayUpper = Math.round(Utils.convertHeight(upperLimitInput, heightUnit));
    const displaySpd = Utils.convertWind(spd, windSpeedUnit, 'kt');
    const formattedSpd = Number.isFinite(spd) ? (windSpeedUnit === 'bft' ? Math.round(spd) : spd.toFixed(1)) : 'N/A';
    const result = `Mean wind (${displayLower}-${displayUpper} ${heightUnit} ${refLevel}): ${Utils.roundToTens(dir)}° ${formattedSpd} ${windSpeedUnit}`;
    document.getElementById('meanWindResult').innerHTML = result;
    console.log('Calculated Mean Wind:', result, 'u:', meanWind[2], 'v:', meanWind[3]);
}
function interpolateWeatherData(sliderIndex) {
    if (!weatherData || !weatherData.time || sliderIndex >= weatherData.time.length) {
        console.warn('No weather data available for interpolation');
        return [];
    }

    const baseHeight = Math.round(lastAltitude); // Elevation from Open-Meteo in meters
    const interpStep = parseInt(getInterpolationStep()) || 100; // Step size in user's unit (m or ft)
    const heightUnit = getHeightUnit();

    // Define pressure levels from 1000 hPa to 200 hPa
    const pressureLevels = [1000, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200];
    let heightData = pressureLevels.map(hPa => weatherData[`geopotential_height_${hPa}hPa`][sliderIndex]).filter(h => h !== null && h !== undefined);
    let tempData = pressureLevels.map(hPa => weatherData[`temperature_${hPa}hPa`][sliderIndex]);
    let rhData = pressureLevels.map(hPa => weatherData[`relative_humidity_${hPa}hPa`][sliderIndex]);
    let spdData = pressureLevels.map(hPa => weatherData[`wind_speed_${hPa}hPa`][sliderIndex]);
    let dirData = pressureLevels.map(hPa => weatherData[`wind_direction_${hPa}hPa`][sliderIndex]);

    if (heightData.length < 2) {
        console.warn('Insufficient pressure level data for interpolation');
        return [];
    }

    const surfacePressure = weatherData.surface_pressure[sliderIndex];
    if (surfacePressure === null || surfacePressure === undefined) {
        console.warn('Surface pressure missing');
        return [];
    }

    // Calculate initial wind components at pressure levels
    let uComponents = spdData.map((spd, i) => -spd * Math.sin(dirData[i] * Math.PI / 180));
    let vComponents = spdData.map((spd, i) => -spd * Math.cos(dirData[i] * Math.PI / 180));

    // Add surface and intermediate points if surfacePressure > 1000 hPa
    const h1000 = weatherData.geopotential_height_1000hPa[sliderIndex];
    if (surfacePressure > 1000 && Number.isFinite(h1000) && h1000 > baseHeight) {
        const stepsBetween = Math.floor((h1000 - baseHeight) / interpStep);

        // Surface wind components
        const uSurface = -weatherData.wind_speed_10m[sliderIndex] * Math.sin(weatherData.wind_direction_10m[sliderIndex] * Math.PI / 180);
        const vSurface = -weatherData.wind_speed_10m[sliderIndex] * Math.cos(weatherData.wind_direction_10m[sliderIndex] * Math.PI / 180);
        const u1000 = uComponents[0]; // First element corresponds to 1000 hPa
        const v1000 = vComponents[0];

        // Add intermediate points with logarithmic interpolation of u and v
        for (let i = stepsBetween - 1; i >= 1; i--) {
            const h = baseHeight + i * interpStep;
            if (h >= h1000) continue;
            const fraction = (h - baseHeight) / (h1000 - baseHeight);
            const logPSurface = Math.log(surfacePressure);
            const logP1000 = Math.log(1000);
            const logP = logPSurface + fraction * (logP1000 - logPSurface);
            const p = Math.exp(logP);

            // Logarithmic interpolation of wind components
            const logHeight = Math.log(h - baseHeight + 1); // +1 to avoid log(0)
            const logH0 = Math.log(1); // Surface relative height
            const logH1 = Math.log(h1000 - baseHeight);
            const u = Utils.LIP([logH0, logH1], [uSurface, u1000], logHeight);
            const v = Utils.LIP([logH0, logH1], [vSurface, v1000], logHeight);
            const spd = Utils.windSpeed(u, v);
            const dir = Utils.windDirection(u, v);

            heightData.unshift(h);
            pressureLevels.unshift(p);
            tempData.unshift(Utils.LIP([baseHeight, h1000], [weatherData.temperature_2m[sliderIndex], weatherData.temperature_1000hPa[sliderIndex]], h));
            rhData.unshift(Utils.LIP([baseHeight, h1000], [weatherData.relative_humidity_2m[sliderIndex], weatherData.relative_humidity_1000hPa[sliderIndex]], h));
            spdData.unshift(spd);
            dirData.unshift(dir);
            uComponents.unshift(u);
            vComponents.unshift(v);
        }

        // Add surface data
        heightData.unshift(baseHeight);
        pressureLevels.unshift(surfacePressure);
        tempData.unshift(weatherData.temperature_2m[sliderIndex]);
        rhData.unshift(weatherData.relative_humidity_2m[sliderIndex]);
        spdData.unshift(weatherData.wind_speed_10m[sliderIndex]);
        dirData.unshift(weatherData.wind_direction_10m[sliderIndex]);
        uComponents.unshift(uSurface);
        vComponents.unshift(vSurface);
    }

    // Determine the maximum height (200 hPa level, relative to AGL)
    const maxPressureIndex = pressureLevels.indexOf(200);
    const maxHeightASL = heightData[maxPressureIndex]; // Absolute height at 200 hPa in meters
    const maxHeightAGL = maxHeightASL - baseHeight; // Convert to AGL in meters
    if (maxHeightAGL <= 0 || isNaN(maxHeightAGL)) {
        console.warn('Invalid max height at 200 hPa:', { maxHeightASL, baseHeight });
        return [];
    }

    // Convert maxHeightAGL to user's unit for step calculation
    const maxHeightInUnit = heightUnit === 'ft' ? maxHeightAGL * 3.28084 : maxHeightAGL;
    const steps = Math.floor(maxHeightInUnit / interpStep);
    const heightsInUnit = Array.from({ length: steps + 1 }, (_, i) => i * interpStep); // Heights in user's unit

    console.log('Interpolating up to 200 hPa:', { maxHeightAGL, interpStep });

    const interpolatedData = [];
    heightsInUnit.forEach(height => {
        // Convert height from user's unit to meters for interpolation
        const heightAGLInMeters = heightUnit === 'ft' ? height / 3.28084 : height;
        const heightASLInMeters = baseHeight + heightAGLInMeters; // Absolute height (ASL) in meters

        let dataPoint;
        if (heightAGLInMeters === 0) {
            // Surface data at 0 in user's unit
            dataPoint = {
                height: heightASLInMeters,
                pressure: surfacePressure,
                temp: weatherData.temperature_2m[sliderIndex],
                rh: weatherData.relative_humidity_2m[sliderIndex],
                spd: weatherData.wind_speed_10m[sliderIndex],
                dir: weatherData.wind_direction_10m[sliderIndex],
                dew: Utils.calculateDewpoint(weatherData.temperature_2m[sliderIndex], weatherData.relative_humidity_2m[sliderIndex])
            };
        } else {
            // Interpolate at higher altitudes
            const pressure = Utils.interpolatePressure(heightASLInMeters, pressureLevels, heightData);
            const windComponents = Utils.interpolateWindAtAltitude(heightASLInMeters, pressureLevels, heightData, uComponents, vComponents);
            const spd = Utils.windSpeed(windComponents.u, windComponents.v);
            const dir = Utils.windDirection(windComponents.u, windComponents.v);
            const temp = Utils.LIP(heightData, tempData, heightASLInMeters);
            const rh = Utils.LIP(heightData, rhData, heightASLInMeters);
            const dew = Utils.calculateDewpoint(temp, rh);

            dataPoint = {
                height: heightASLInMeters,
                pressure: pressure === 'N/A' ? 'N/A' : Number(pressure.toFixed(1)),
                temp: Number(temp.toFixed(1)),
                rh: Number(rh.toFixed(0)),
                spd: Number(spd.toFixed(1)),
                dir: Number(dir.toFixed(0)),
                dew: Number(dew.toFixed(1))
            };
        }

        dataPoint.displayHeight = height; // Height in user's unit for display
        interpolatedData.push(dataPoint);
    });

    console.log('Interpolated data length:', interpolatedData.length, 'Max height:', interpolatedData[interpolatedData.length - 1].displayHeight);
    return interpolatedData;
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

    // Generate surface data with fetched surface_pressure
    const baseHeight = Math.round(lastAltitude);
    const surfaceHeight = refLevel === 'AGL' ? 0 : baseHeight;
    const surfaceTemp = weatherData.temperature_2m?.[index];
    const surfaceRH = weatherData.relative_humidity_2m?.[index];
    const surfaceSpd = weatherData.wind_speed_10m?.[index];
    const surfaceDir = weatherData.wind_direction_10m?.[index];
    const surfaceDew = Utils.calculateDewpoint(surfaceTemp, surfaceRH);
    const surfacePressure = weatherData.surface_pressure[index]; // Use fetched surface pressure directly

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
            const displayPressure = data.pressure === 'N/A' ? 'N/A' : data.pressure.toFixed(1);
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
                content += `${displayHeight}${separator}${displayPressure}${separator}${formattedTemp}${separator}${formattedDew}${separator}${formattedDir}${separator}${formattedSpd}${separator}${formattedRH}\n`;
            } else if (format === 'Customized') {
                content += `${displayHeight}${separator}${displayPressure}${separator}${formattedTemp}${separator}${formattedDew}${separator}${formattedDir}${separator}${formattedSpd}${separator}${formattedRH}\n`;
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

// == Jump and Free Fall Calculations ==
function getSeparationFromTAS(ias) {
    // Convert exitAltitude from meters to feet (1m = 3.28084ft)
    const exitAltitudeFt = userSettings.exitAltitude * 3.28084;

    // Calculate TAS using Utils.calculateTAS
    const tas = Utils.calculateTAS(ias, exitAltitudeFt);
    if (tas === 'N/A') {
        console.warn('TAS calculation failed, using default separation');
        return defaultSettings.jumperSeparation; // Fallback to default (5s)
    }

    // Round TAS to nearest table key
    const speeds = Object.keys(jumperSeparationTable).map(Number).sort((a, b) => b - a);
    let closestSpeed = speeds[0]; // Default to highest speed
    for (const speed of speeds) {
        if (tas <= speed) closestSpeed = speed;
        else break;
    }

    // Return separation from table, default to 7 seconds if not found
    const separation = jumperSeparationTable[closestSpeed] || 7;
    console.log(`Calculated TAS: ${tas}kt, Closest speed: ${closestSpeed}kt, Separation: ${separation}s`);
    return separation;
}
function calculateFreeFall(weatherData, exitAltitude, openingAltitude, sliderIndex, startLat, startLng, elevation) {
    console.log('Starting calculateFreeFall...', { exitAltitude, openingAltitude, sliderIndex });

    if (!weatherData || !weatherData.time || !weatherData.surface_pressure) {
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
    const aircraftSpeedKt = userSettings.aircraftSpeedKt; // Use user-defined IAS speed
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

    const surfacePressure = weatherData.surface_pressure[sliderIndex] || 1013.25;
    const surfaceTempC = weatherData.temperature_2m[sliderIndex] || 15;
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
            latLng: calculateNewCenter(startLat, startLng, Math.sqrt(point.x * point.x + point.y * point.y), Math.atan2(point.y, point.x) * 180 / Math.PI),
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
function visualizeFreeFallPath(path) {
    if (!map || !userSettings.calculateJump) return;

    const latLngs = path.map(point => point.latLng);
    const freeFallPolyline = L.polyline(latLngs, {
        color: 'purple',
        weight: 3,
        opacity: 0.7,
        dashArray: '10, 10'
    }).addTo(map);

    freeFallPolyline.bindPopup(`Free Fall Path<br>Duration: ${path[path.length - 1].time.toFixed(1)}s<br>Distance: ${Math.sqrt(path[path.length - 1].latLng[0] ** 2 + path[path.length - 1].latLng[1] ** 2).toFixed(1)}m`);
}
function calculateJump() {
    console.log('Starting calculateJump...');
    if (!weatherData || !weatherData.time || !weatherData.surface_pressure) {
        console.warn('Weather data not available');
        return null;
    }
    const sliderIndex = parseInt(document.getElementById('timeSlider')?.value) || 0;
    const exitAltitude = parseInt(document.getElementById('exitAltitude')?.value) || 3000;
    const openingAltitude = parseInt(document.getElementById('openingAltitude')?.value) || 1200;
    const legHeightDownwind = parseInt(document.getElementById('legHeightDownwind')?.value) || 300;
    const descentRate = parseFloat(document.getElementById('descentRate')?.value) || 3.5;
    const canopySpeed = parseFloat(document.getElementById('canopySpeed')?.value) || 20;

    const canopySpeedMps = canopySpeed * 0.514444; // Convert kt to m/s
    const heightDistance = openingAltitude - 200 - legHeightDownwind;
    const flyTime = heightDistance / descentRate;
    const horizontalCanopyDistance = flyTime * canopySpeedMps;
    const heightDistanceFull = openingAltitude - 200;
    const flyTimeFull = heightDistanceFull / descentRate;
    const horizontalCanopyDistanceFull = flyTimeFull * canopySpeedMps;

    console.log('Calculated radii:', { horizontalCanopyDistance, horizontalCanopyDistanceFull });
    console.log('Jump inputs:', { exitAltitude, openingAltitude, legHeightDownwind, descentRate, canopySpeed, sliderIndex, lastLat, lastLng, lastAltitude });

    // Free fall phase
    const freeFallResult = calculateFreeFall(weatherData, exitAltitude, openingAltitude, sliderIndex, lastLat, lastLng, lastAltitude);
    console.log('Freefall calculated');
    if (!freeFallResult) {
        console.warn('Free fall calculation failed');
        return null;
    }

    if (horizontalCanopyDistance <= 0 || horizontalCanopyDistanceFull <= 0) {
        console.warn('Invalid radii:', { horizontalCanopyDistance, horizontalCanopyDistanceFull });
        return null;
    }

    const interpolatedData = interpolateWeatherData(sliderIndex);

    if (!interpolatedData || interpolatedData.length === 0) {
        console.warn('No interpolated weather data available');
        return null;
    }

    const elevation = Math.round(lastAltitude);
    const lowerLimitFull = elevation;
    const upperLimitFull = elevation + openingAltitude - 200;
    const lowerLimit = elevation + legHeightDownwind;
    const upperLimit = elevation + openingAltitude - 200;

    const heights = interpolatedData.map(d => d.height);
    const dirs = interpolatedData.map(d => Number.isFinite(d.dir) ? parseFloat(d.dir) : 0);
    const spdsMps = interpolatedData.map(d => Utils.convertWind(parseFloat(d.spd) || 0, 'm/s', 'km/h')); // km/h to m/s

    const uComponents = spdsMps.map((spd, i) => -spd * Math.sin(dirs[i] * Math.PI / 180));
    const vComponents = spdsMps.map((spd, i) => -spd * Math.cos(dirs[i] * Math.PI / 180));

    const meanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, lowerLimit, upperLimit);
    const meanWindDirection = meanWind[0];
    const meanWindSpeedMps = meanWind[1];
    console.log('Mean wind blue: ', meanWindDirection.toFixed(1), meanWindSpeedMps.toFixed(1), 'm/s');

    const meanWindFull = Utils.calculateMeanWind(heights, uComponents, vComponents, lowerLimitFull, upperLimitFull);
    const meanWindDirectionFull = meanWindFull[0];
    const meanWindSpeedMpsFull = meanWindFull[1];
    console.log('Mean wind red: ', meanWindDirectionFull.toFixed(1), meanWindSpeedMpsFull.toFixed(1), 'm/s');

    const centerDisplacement = meanWindSpeedMps * flyTime;
    const centerDisplacementFull = meanWindSpeedMpsFull * flyTimeFull;
    const displacementDirection = meanWindDirection;
    const displacementDirectionFull = meanWindDirectionFull;

    if (!Number.isFinite(lastLat) || !Number.isFinite(lastLng)) {
        console.error('Invalid lastLat or lastLng:', { lastLat, lastLng });
        return null;
    }

    // Always calculate landing pattern coordinates, but only display if enabled
    console.log('Calculating landing pattern coordinates...');
    const landingPatternCoords = calculateLandingPatternCoords(lastLat, lastLng, interpolatedData, sliderIndex);
    let downwindLat = landingPatternCoords.downwindLat;
    let downwindLng = landingPatternCoords.downwindLng;

    if (userSettings.showLandingPattern) {
        console.log('Displaying landing pattern...');
        updateLandingPattern();
    } else {
        console.log('Landing pattern not displayed; blue circle still uses downwind end');
    }

    // Fallback if downwind coordinates are invalid
    if (!Number.isFinite(downwindLat) || !Number.isFinite(downwindLng)) {
        console.warn('Downwind coordinates invalid, using lastLat, lastLng as fallback');
        downwindLat = lastLat;
        downwindLng = lastLng;
    }

    console.log('calculateJump: Free fall result before updateJumpCircle:', {
        directionDeg: freeFallResult.directionDeg,
        distance: freeFallResult.distance,
        time: freeFallResult.time
    });

    if (typeof freeFallResult.time === 'undefined') {
        console.warn('freeFallResult.time is undefined! Full freeFallResult:', freeFallResult);
    }

    console.log('Calling updateJumpCircle with:', { downwindLat, downwindLng, lastLat, lastLng, horizontalCanopyDistance, horizontalCanopyDistanceFull, centerDisplacement, centerDisplacementFull, displacementDirection, displacementDirectionFull, freeFallDirection: freeFallResult.directionDeg, freeFallDistance: freeFallResult.distance, freeFallTime: freeFallResult.time });
    updateJumpCircle(
        downwindLat,
        downwindLng,
        lastLat,
        lastLng,
        horizontalCanopyDistance,
        horizontalCanopyDistanceFull,
        centerDisplacement,
        centerDisplacementFull,
        displacementDirection,
        displacementDirectionFull,
        freeFallResult.directionDeg, // Pass direction
        freeFallResult.distance, // Pass distance
        freeFallResult.time // Add freeFallTime
    );

    if (currentMarker) {
        currentMarker.setLatLng([lastLat, lastLng]);
        updateMarkerPopup(currentMarker, lastLat, lastLng, lastAltitude);
    }

    updateJumpRunTrack();
    jumpRunTrack();

    console.log('calculateJump completed');
    return {
        radius: horizontalCanopyDistance,
        radiusFull: horizontalCanopyDistanceFull,
        displacement: centerDisplacement,
        displacementFull: centerDisplacementFull,
        direction: meanWindDirection,
        directionFull: meanWindDirectionFull,
        freeFall: freeFallResult,
        freeFallDirection: freeFallResult.directionDeg, // Ensure included
        freeFallDistance: freeFallResult.distance, // Ensure included
        meanWindFull
    };
}
function updateJumpCircle(blueLat, blueLng, redLat, redLng, radius, radiusFull, displacement, displacementFull, direction, directionFull, freeFallDirection, freeFallDistance, freeFallTime) {
    console.log('updateJumpCircle called with:', { blueLat, blueLng, redLat, redLng, radius, radiusFull, displacement, displacementFull, direction, directionFull, freeFallDirection, freeFallDistance, freeFallTime, zoom: map.getZoom() });
    if (!map) {
        console.warn('Map not available to update jump circles');
        return;
    }
    const currentZoom = map.getZoom();
    const isVisible = currentZoom >= minZoom && currentZoom <= maxZoom;
    console.log('Zoom check:', { currentZoom, minZoom, maxZoom, isVisible });

    // Remove existing blue and red circles safely
    const removeLayer = (layer, name) => {
        if (layer && typeof layer === 'object' && '_leaflet_id' in layer && map.hasLayer(layer)) {
            console.log(`Removing existing ${name} circle`);
            map.removeLayer(layer);
        }
    };
    removeLayer(jumpCircle, 'blue jump');
    removeLayer(jumpCircleFull, 'red jump');

    // Only remove green circles if showExitArea is false or calculateJump is true
    if (!userSettings.showExitArea || userSettings.calculateJump) {
        removeLayer(jumpCircleGreen, 'green jump');
        removeLayer(jumpCircleGreenLight, 'light green jump');
        jumpCircleGreen = null;
        jumpCircleGreenLight = null;
    }

    // Reset blue and red circle variables
    jumpCircle = null;
    jumpCircleFull = null;

    if (isVisible && Number.isFinite(blueLat) && Number.isFinite(blueLng) && Number.isFinite(redLat) && Number.isFinite(redLng)) {
        const newCenterBlue = calculateNewCenter(blueLat, blueLng, displacement, direction);
        const newCenterRed = calculateNewCenter(redLat, redLng, displacementFull, directionFull);
        console.log('New centers calculated:', { blue: newCenterBlue, red: newCenterRed });

        if (!Number.isFinite(newCenterBlue[0]) || !Number.isFinite(newCenterBlue[1]) || !Number.isFinite(newCenterRed[0]) || !Number.isFinite(newCenterRed[1])) {
            console.warn('Invalid center coordinates:', { newCenterBlue, newCenterRed });
            return;
        }

        if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(radiusFull) || radiusFull <= 0) {
            console.warn('Invalid radius values:', { radius, radiusFull });
            return;
        }

        console.log('Creating circles with radii:', { blueRadius: radius, redRadius: radiusFull, greenRadius: userSettings.showExitArea ? radiusFull : null, greenLightRadius: userSettings.showExitArea ? radius : null });

        // Blue circle
        jumpCircle = L.circle(newCenterBlue, {
            radius: radius,
            color: 'blue',
            fillColor: 'blue',
            fillOpacity: 0,
            weight: 2,
            opacity: 0.4
        });

        // Red circle
        jumpCircleFull = L.circle(newCenterRed, {
            radius: radiusFull,
            color: 'red',
            fillColor: 'red',
            fillOpacity: 0,
            weight: 2,
            opacity: 0.4
        });

        // Add blue and red circles to map
        jumpCircle.addTo(map);
        jumpCircleFull.addTo(map);

        // Green circles (only if showExitArea is true)
        if (userSettings.showExitArea) {
            // First green circle (same as red circle radius)
            let jumpCircleGreenCenter = newCenterRed;
            if (Number.isFinite(freeFallDirection) && Number.isFinite(freeFallDistance)) {
                const greenShiftDirection = (freeFallDirection + 180) % 360;
                jumpCircleGreenCenter = calculateNewCenter(newCenterRed[0], newCenterRed[1], freeFallDistance, greenShiftDirection);
                console.log('Green circle center calculated:', { center: jumpCircleGreenCenter, shiftDirection: greenShiftDirection, shiftDistance: freeFallDistance });
            } else {
                console.warn('Free fall direction or distance not provided, using red circle center:', { freeFallDirection, freeFallDistance });
            }

            jumpCircleGreen = L.circle(jumpCircleGreenCenter, {
                radius: radiusFull,
                color: 'green',
                fillColor: 'green',
                fillOpacity: 0.2,
                weight: 2
            });

            // Light green circle (same as blue circle radius)
            let jumpCircleGreenLightCenter = newCenterBlue;
            if (Number.isFinite(freeFallDirection) && Number.isFinite(freeFallDistance)) {
                const greenLightShiftDirection = (freeFallDirection + 180) % 360;
                jumpCircleGreenLightCenter = calculateNewCenter(newCenterBlue[0], newCenterBlue[1], freeFallDistance, greenLightShiftDirection);
                console.log('Light green circle center calculated:', { center: jumpCircleGreenLightCenter, shiftDirection: greenLightShiftDirection, shiftDistance: freeFallDistance });
            } else {
                console.warn('Free fall direction or distance not provided, using blue circle center for light green:', { freeFallDirection, freeFallDistance });
            }

            jumpCircleGreenLight = L.circle(jumpCircleGreenLightCenter, {
                radius: radius,
                color: 'lightgreen',
                fillColor: 'lightgreen',
                fillOpacity: 0.2,
                weight: 2
            });

            // Add green circles to map
            jumpCircleGreen.addTo(map);
            jumpCircleGreenLight.addTo(map);

            // Debug tooltip data and validation
            console.log('Tooltip data:', { freeFallDirection, freeFallDistance, freeFallTime });
            console.log('freeFallTime validation:', {
                value: freeFallTime,
                type: typeof freeFallTime,
                isNumber: typeof freeFallTime === 'number',
                isNotNaN: !isNaN(freeFallTime),
                valid: typeof freeFallTime === 'number' && !isNaN(freeFallTime)
            });

            // Tooltip content with freeFallTime
            const tooltipContent = `
               Exit area calculated with:<br>
               Throw/Drift: ${Number.isFinite(freeFallDirection) ? Math.round(freeFallDirection) : 'N/A'}° ${Number.isFinite(freeFallDistance) ? Math.round(freeFallDistance) : 'N/A'} m<br>
               Free Fall Time: ${freeFallTime != null && !isNaN(freeFallTime) ? Math.round(freeFallTime) : 'N/A'} sec
           `;

            // Bind tooltip to jumpCircleGreen
            jumpCircleGreen.bindTooltip(tooltipContent, {
                direction: 'top',
                offset: [0, -10],
                className: 'wind-tooltip'
            });

            // Bind tooltip to jumpCircleGreenLight
            jumpCircleGreenLight.bindTooltip(tooltipContent, {
                direction: 'top',
                offset: [0, -10],
                className: 'wind-tooltip'
            });
        }

        console.log('Jump circles added at zoom:', currentZoom, 'Layers on map:', {
            blue: !!jumpCircle && map.hasLayer(jumpCircle),
            red: !!jumpCircleFull && map.hasLayer(jumpCircleFull),
            green: !!jumpCircleGreen && map.hasLayer(jumpCircleGreen),
            greenLight: !!jumpCircleGreenLight && map.hasLayer(jumpCircleGreenLight)
        });
    } else {
        console.log('Jump circles not displayed - zoom:', currentZoom, 'visible:', isVisible, 'coords valid:', Number.isFinite(blueLat) && Number.isFinite(blueLng) && Number.isFinite(redLat) && Number.isFinite(redLng), 'calculateJump:', userSettings.calculateJump);
        // Preserve green circles if showExitArea is true
        if (!userSettings.showExitArea) {
            jumpCircleGreen = null;
            jumpCircleGreenLight = null;
        }
    }

    if (currentMarker) {
        currentMarker.setLatLng([lastLat, lastLng]);
        updateMarkerPopup(currentMarker, lastLat, lastLng, lastAltitude);
    }
    console.log('updateJumpCircle completed');
}
function resetJumpRunDirection(triggerUpdate = true) {
    customJumpRunDirection = null;
    const directionInput = document.getElementById('jumpRunTrackDirection');
    if (directionInput) {
        directionInput.value = '';
        console.log('Cleared jumpRunTrackDirection input');
    }
    console.log('Reset JRT direction to calculated');
    if (triggerUpdate && userSettings.showJumpRunTrack && weatherData && lastLat && lastLng) {
        console.log('Triggering JRT update after reset');
        updateJumpRunTrack();
    }
}
function jumpRunTrack() {
    console.log('Starting jumpRunTrack...', {
        weatherData: !!weatherData,
        lastLat,
        lastLng,
        lastAltitude,
        customJumpRunDirection
    });
    const exitAltitude = parseInt(document.getElementById('exitAltitude')?.value) || userSettings.exitAltitude || 3000;
    const openingAltitude = parseInt(document.getElementById('openingAltitude')?.value) || userSettings.openingAltitude || 1000;
    const customDirection = parseInt(document.getElementById('jumpRunTrackDirection')?.value, 10);
    const sliderIndex = parseInt(document.getElementById('timeSlider')?.value) || 0;
    const offset = parseInt(document.getElementById('jumpRunTrackOffset')?.value) || userSettings.jumpRunTrackOffset || 0;

    if (!weatherData || !lastLat || !lastLng || lastAltitude === null || lastAltitude === 'N/A') {
        console.warn('Cannot calculate jump run track: missing data', {
            weatherData: !!weatherData,
            lastLat,
            lastLng,
            lastAltitude
        });
        return null;
    }

    const interpolatedData = interpolateWeatherData(sliderIndex);
    if (!interpolatedData || interpolatedData.length === 0) {
        console.warn('No interpolated weather data available for sliderIndex:', sliderIndex);
        return null;
    }

    const elevation = Math.round(lastAltitude);
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
    if (customJumpRunDirection !== null && !isNaN(customJumpRunDirection) && customJumpRunDirection >= 0 && customJumpRunDirection <= 359) {
        jumpRunTrackDirection = customJumpRunDirection;
        console.log(`Using custom jump run direction: ${jumpRunTrackDirection}°`);
    } else {
        jumpRunTrackDirection = Math.round(meanWindDirection);
        customJumpRunDirection = null;
        console.log(`Using calculated jump run direction: ${jumpRunTrackDirection}°`, {
            meanWindDirection: meanWindDirection.toFixed(1),
            inputValue: document.getElementById('jumpRunTrackDirection')?.value
        });
    }

    // Calculate ground speed at exit altitude
    const exitHeightM = elevation + exitAltitude;
    const exitHeightFt = exitHeightM / 0.3048;
    const iasKt = userSettings.aircraftSpeedKt || 90;
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
        const numberOfJumpers = parseInt(userSettings.numberOfJumpers) || 10;
        const jumperSeparation = parseFloat(userSettings.jumperSeparation) || 5;
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

    // Apply offset perpendicular to the track direction
    let centerLat = lastLat;
    let centerLng = lastLng;
    if (offset !== 0) {
        const offsetDistance = Math.abs(offset);
        const offsetBearing = offset >= 0
            ? (jumpRunTrackDirection + 90) % 360
            : (jumpRunTrackDirection - 90 + 360) % 360;
        [centerLat, centerLng] = calculateNewCenter(lastLat, lastLng, offsetDistance, offsetBearing);
    }

    // Calculate approach path
    const approachTime = 120; // Fixed 120 seconds
    if (Number.isFinite(groundSpeedMps)) {
        approachLength = groundSpeedMps * approachTime;
        approachLength = Math.max(100, Math.min(20000, Math.round(approachLength))); // Cap 100–20,000 m
        console.log('Approach path calculation:', {
            groundSpeedMps: groundSpeedMps.toFixed(2),
            approachTime,
            approachLength
        });

        // Approach extends from back end (startPoint) backward
        const startPoint = calculateNewCenter(centerLat, centerLng, trackLength / 2, (jumpRunTrackDirection + 180) % 360);
        const approachEndPoint = calculateNewCenter(startPoint[0], startPoint[1], approachLength, (jumpRunTrackDirection + 180) % 360);
        approachLatLngs = [
            [startPoint[0], startPoint[1]], // Connect to back end
            [approachEndPoint[0], approachEndPoint[1]] // Extend backward
        ];
    } else {
        console.warn('Invalid ground speed for approach path, using default length');
    }


    // Calculate jump run track points
    const startPoint = calculateNewCenter(centerLat, centerLng, halfLength, (jumpRunTrackDirection + 180) % 360);
    const endPoint = calculateNewCenter(centerLat, centerLng, halfLength, jumpRunTrackDirection);

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
        approachLatLngs: approachLatLngs, // Add approach path coordinates
        approachLength: approachLength,
        approachTime: approachTime
    };
}
function updateJumpRunTrack() {
    console.log('updateJumpRunTrack called', {
        showJumpRunTrack: userSettings.showJumpRunTrack,
        weatherData: !!weatherData,
        lastLat,
        lastLng,
        customJumpRunDirection,
        currentZoom: map.getZoom()
    });
    // Check zoom level
    const currentZoom = map.getZoom();
    const isZoomInRange = currentZoom >= minZoom && currentZoom <= maxZoom;

    // Remove existing layers if present
    if (jumpRunTrackLayer) {
        if (jumpRunTrackLayer.airplaneMarker) {
            map.removeLayer(jumpRunTrackLayer.airplaneMarker);
            jumpRunTrackLayer.airplaneMarker = null;
            console.log('Removed airplane marker');
        }
        if (jumpRunTrackLayer.approachLayer) {
            map.removeLayer(jumpRunTrackLayer.approachLayer);
            jumpRunTrackLayer.approachLayer = null;
            console.log('Removed approach path');
        }
        map.removeLayer(jumpRunTrackLayer);
        jumpRunTrackLayer = null;
        console.log('Removed JRT polyline');
    }

    if (!userSettings.showJumpRunTrack || !weatherData || !lastLat || !lastLng || !isZoomInRange) {
        console.log('Jump run track not drawn', {
            showJumpRunTrack: userSettings.showJumpRunTrack,
            weatherData: !!weatherData,
            lastLat,
            lastLng,
            isZoomInRange
        });
        const directionInput = document.getElementById('jumpRunTrackDirection');
        if (directionInput) {
            setInputValueSilently('jumpRunTrackDirection', '');
        }
        return;
    }

    const trackData = jumpRunTrack();
    if (!trackData || !trackData.latlngs || !Array.isArray(trackData.latlngs) || trackData.latlngs.length < 2) {
        console.error('Invalid trackData from jumpRunTrack:', trackData);
        return;
    }

    let { latlngs, direction, trackLength, approachLatLngs, approachLength, approachTime } = trackData;

    // Validate latlngs format
    const isValidLatLngs = latlngs.every(ll => Array.isArray(ll) && ll.length === 2 && !isNaN(ll[0]) && !isNaN(ll[1]));
    if (!isValidLatLngs) {
        console.error('Invalid latlngs format in trackData:', latlngs);
        return;
    }

    console.log('Updating jump run track with:', { latlngs, direction, trackLength, offset: userSettings.jumpRunTrackOffset });
    if (approachLatLngs) {
        console.log('Updating approach path with:', { approachLatLngs, approachLength });
    }

    // Create polyline for the jump run track
    jumpRunTrackLayer = L.polyline(latlngs, {
        color: 'orange',
        weight: 4,
        opacity: 0.9,
        interactive: true
    }).addTo(map);

    // Create polyline for the approach path (dashed)
    if (approachLatLngs && Array.isArray(approachLatLngs) && approachLatLngs.length === 2) {
        const isValidApproachLatLngs = approachLatLngs.every(ll => Array.isArray(ll) && ll.length === 2 && !isNaN(ll[0]) && !isNaN(ll[1]));
        if (isValidApproachLatLngs) {
            jumpRunTrackLayer.approachLayer = L.polyline(approachLatLngs, {
                color: 'orange',
                weight: 3,
                opacity: 0.9,
                dashArray: '10, 10',
                interactive: true
            }).addTo(map);

            jumpRunTrackLayer.approachLayer.bindTooltip(`Approach: ${Math.round(direction)}°, ${Math.round(approachLength)} m, ${Math.round(approachTime / 60)} min`, {
                permanent: false,
                direction: 'top',
                offset: [0, -10]
            });
        } else {
            console.warn('Invalid approachLatLngs format:', approachLatLngs);
        }
    }

    // Add airplane symbol at the front end
    const frontEnd = latlngs[1];
    const airplaneIcon = L.icon({
        iconUrl: 'airplane_orange.png',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -16],
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        shadowSize: [41, 41],
        shadowAnchor: [13, 32]
    });

    jumpRunTrackLayer.airplaneMarker = L.marker(frontEnd, {
        icon: airplaneIcon,
        rotationAngle: direction,
        rotationOrigin: 'center center',
        draggable: false
    }).addTo(map);

    // Update direction input silently
    const directionInput = document.getElementById('jumpRunTrackDirection');
    if (directionInput) {
        setInputValueSilently('jumpRunTrackDirection', Math.round(direction));
    }

    // Dragging functionality
    let isDragging = false;
    let startLatLng = null;
    let originalLatLngs = latlngs.map(ll => [ll[0], ll[1]]);
    let originalApproachLatLngs = approachLatLngs ? approachLatLngs.map(ll => [ll[0], ll[1]]) : null;

    jumpRunTrackLayer.on('mousedown', function (e) {
        if (!userSettings.showJumpRunTrack || !isZoomInRange) return;
        isDragging = true;
        startLatLng = e.latlng;
        map.dragging.disable();
        console.log('Started dragging JRT');
    });

    if (jumpRunTrackLayer.approachLayer) {
        jumpRunTrackLayer.approachLayer.on('mousedown', function (e) {
            if (!userSettings.showJumpRunTrack || !isZoomInRange) return;
            isDragging = true;
            startLatLng = e.latlng;
            map.dragging.disable();
            console.log('Started dragging approach path');
        });
    }

    map.on('mousemove', function (e) {
        if (!isDragging || !startLatLng) return;

        const currentLatLng = e.latlng;
        const latDiff = currentLatLng.lat - startLatLng.lat;
        const lngDiff = currentLatLng.lng - startLatLng.lng;

        const newLatLngs = originalLatLngs.map(([lat, lng]) => [
            lat + latDiff,
            lng + lngDiff
        ]);
        jumpRunTrackLayer.setLatLngs(newLatLngs);

        if (originalApproachLatLngs && jumpRunTrackLayer.approachLayer) {
            const newApproachLatLngs = originalApproachLatLngs.map(([lat, lng]) => [
                lat + latDiff,
                lng + lngDiff
            ]);
            jumpRunTrackLayer.approachLayer.setLatLngs(newApproachLatLngs);
        }

        const newFrontEnd = newLatLngs[1];
        if (jumpRunTrackLayer.airplaneMarker) {
            jumpRunTrackLayer.airplaneMarker.setLatLng(newFrontEnd);
        }
    });

    // Add timeout to ensure dragging is re-enabled
    let dragTimeout = null;
    map.on('mouseup', function () {
        if (!isDragging) return;
        isDragging = false;
        map.dragging.enable();
        clearTimeout(dragTimeout);
        console.log('Dragging ended, map dragging re-enabled');

        originalLatLngs = jumpRunTrackLayer.getLatLngs().map(ll => [ll.lat, ll.lng]);
        if (jumpRunTrackLayer.approachLayer) {
            originalApproachLatLngs = jumpRunTrackLayer.approachLayer.getLatLngs().map(ll => [ll.lat, ll.lng]);
        }

        const [startLat, startLng] = originalLatLngs[0];
        const [endLat, endLng] = originalLatLngs[1];
        const newDirection = calculateBearing(startLat, startLng, endLat, endLng);

        customJumpRunDirection = Math.round(newDirection);
        console.log('JRT dragged, set custom direction:', customJumpRunDirection);

        const centerLat = (startLat + endLat) / 2;
        const centerLng = (startLng + endLng) / 2;
        const dipLatLng = L.latLng(lastLat, lastLng);
        const centerLatLng = L.latLng(centerLat, centerLng);
        const distance = dipLatLng.distanceTo(centerLatLng);
        const bearingToCenter = calculateBearing(lastLat, lastLng, centerLat, centerLng);

        const rightBearing = (newDirection + 90) % 360;
        const leftBearing = (newDirection - 90 + 360) % 360;
        const angleToRight = Math.abs(((bearingToCenter - rightBearing + 540) % 360) - 180);
        const angleToLeft = Math.abs(((bearingToCenter - leftBearing + 540) % 360) - 180);

        const offsetSign = angleToRight < angleToLeft ? 1 : -1;
        let newOffset = Math.round(distance * offsetSign / 100) * 100;
        newOffset = Math.max(-50000, Math.min(50000, newOffset));

        userSettings.jumpRunTrackOffset = newOffset;
        saveSettings();

        const directionInput = document.getElementById('jumpRunTrackDirection');
        if (directionInput && customJumpRunDirection !== null) {
            setInputValueSilently('jumpRunTrackDirection', Math.round(customJumpRunDirection));
        }
        const offsetInput = document.getElementById('jumpRunTrackOffset');
        if (offsetInput) {
            offsetInput.value = userSettings.jumpRunTrackOffset;
        }

        if (jumpRunTrackLayer.airplaneMarker) {
            jumpRunTrackLayer.airplaneMarker.setRotationAngle(newDirection);
        }

        console.log('Jump run track dragged: new direction:', newDirection, 'new offset:', newOffset);
    });

    // Safety timeout to re-enable dragging
    map.on('mousedown', function () {
        if (isDragging) {
            dragTimeout = setTimeout(() => {
                if (isDragging) {
                    isDragging = false;
                    map.dragging.enable();
                    console.warn('Forced re-enable of map dragging due to timeout');
                    displayError('Dragging reset to restore UI interactivity');
                }
            }, 5000);
        }
    });

    jumpRunTrackLayer.bindTooltip(`Jump Run: ${Math.round(direction)}°, ${Math.round(trackLength)} m`, {
        permanent: false,
        direction: 'top',
        offset: [0, -10]
    });
}
function calculateCutAway() {
    if (!weatherData || lastAltitude === 'N/A' || !userSettings.cutAwayAltitude) {
        console.log('Cannot calculate cut-away: missing data', {
            weatherData: !!weatherData,
            lastAltitude,
            cutAwayAltitude: userSettings.cutAwayAltitude
        });
        return;
    }

    // Run calculateJump to get meanWindFull
    const jumpResult = calculateJump();
    if (!jumpResult || !jumpResult.meanWindFull) {
        console.log('Cannot calculate cut-away: calculateJump failed or no meanWindFull');
        return;
    }

    const meanWindDirectionFull = jumpResult.meanWindFull[0]; // degrees
    const meanWindSpeedMpsFull = jumpResult.meanWindFull[1]; // m/s
    const cutAwayAltitude = userSettings.cutAwayAltitude; // meters
    const surfaceAltitude = lastAltitude; // meters
    const verticalSpeedMax = 1.5; // m/s, for Fully Open (max displacement)
    const verticalSpeedMean = 8.5; // m/s, for Partially Collapsed
    const verticalSpeedMin = 33.5; // m/s, for Fully Collapsed (min displacement)
    const radius = 100; // meters

    // Calculate descent times
    const heightDifference = cutAwayAltitude - surfaceAltitude; // meters
    const descentTimeMin = heightDifference / verticalSpeedMin; // seconds
    const descentTimeMean = heightDifference / verticalSpeedMean; // seconds
    const descentTimeMax = heightDifference / verticalSpeedMax; // seconds

    // Calculate displacement distances
    const displacementDistanceMin = meanWindSpeedMpsFull * descentTimeMin; // meters
    const displacementDistanceMean = meanWindSpeedMpsFull * descentTimeMean; // meters
    const displacementDistanceMax = meanWindSpeedMpsFull * descentTimeMax; // meters

    // Calculate landing positions
    const [newLatMin, newLngMin] = calculateNewCenter(lastLat, lastLng, displacementDistanceMin, meanWindDirectionFull);
    const [newLatMean, newLngMean] = calculateNewCenter(lastLat, lastLng, displacementDistanceMean, meanWindDirectionFull);
    const [newLatMax, newLngMax] = calculateNewCenter(lastLat, lastLng, displacementDistanceMax, meanWindDirectionFull);

    // Log all calculations
    console.log('Cut-away canopy calculation:', {
        cutAwayAltitude: `${cutAwayAltitude} m`,
        surfaceAltitude: `${surfaceAltitude} m`,
        meanWindSpeed: `${meanWindSpeedMpsFull.toFixed(2)} m/s`,
        meanWindDirection: `${Math.round(meanWindDirectionFull)}°`,
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
    if (cutAwayCircle) {
        map.removeLayer(cutAwayCircle);
        cutAwayCircle = null;
    }

    // Add circle for the selected cut-away state if showCutAwayFinder is enabled
    if (userSettings.showCutAwayFinder && userSettings.calculateJump) {
        let center, descentTime, displacementDistance, stateLabel, verticalSpeed;
        switch (userSettings.cutAwayState) {
            case 'Collapsed':
                center = [newLatMin, newLngMin];
                descentTime = descentTimeMin;
                displacementDistance = displacementDistanceMin;
                verticalSpeed =verticalSpeedMin;
                stateLabel = 'Fully Collapsed';
                break;
            case 'Partially':
                center = [newLatMean, newLngMean];
                descentTime = descentTimeMean;
                displacementDistance = displacementDistanceMean;
                verticalSpeed =verticalSpeedMean;
                stateLabel = 'Partially Collapsed';
                break;
            case 'Open':
                center = [newLatMax, newLngMax];
                descentTime = descentTimeMax;
                displacementDistance = displacementDistanceMax;
                verticalSpeed =verticalSpeedMax;
                stateLabel = 'Fully Open';
                break;
            default:
                console.warn('Unknown cutAwayState:', userSettings.cutAwayState);
                return;
        }

        // Create tooltip content
        const tooltipContent = `
            <b>Cut-Away (${stateLabel})</b><br>
            Cut-Away Altitude: ${cutAwayAltitude} m<br>
            Displacement: ${meanWindDirectionFull.toFixed(0)}°, ${displacementDistance.toFixed(0)} m<br>
            Descent Time/Speed: ${descentTime.toFixed(0)} s at ${verticalSpeed} m/s<br>
        `;

        // Add circle to map
        cutAwayCircle = L.circle(center, {
            radius: radius,
            color: 'purple',
            fillColor: 'purple',
            fillOpacity: 0.2,
            weight: 2
        }).addTo(map);

        // Bind tooltip
        cutAwayCircle.bindTooltip(tooltipContent, {
            permanent: false,
            direction: 'center',
            className: 'cutaway-tooltip'
        });
    }
}

// == Landing Pattern Calculations ==
function calculateLandingPatternCoords(lat, lng, interpolatedData, sliderIndex) {
    const CANOPY_SPEED_KT = parseInt(document.getElementById('canopySpeed').value) || 20;
    const DESCENT_RATE_MPS = parseFloat(document.getElementById('descentRate').value) || 3.5;
    const LEG_HEIGHT_FINAL = parseInt(document.getElementById('legHeightFinal').value) || 100;
    const LEG_HEIGHT_BASE = parseInt(document.getElementById('legHeightBase').value) || 200;
    const LEG_HEIGHT_DOWNWIND = parseInt(document.getElementById('legHeightDownwind').value) || 300;
    const baseHeight = Math.round(lastAltitude);

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
        effectiveLandingWindDir = Number.isFinite(landingWindDir) ? landingWindDir : dirs[0];
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
function updateLandingPattern() {
    console.log('updateLandingPattern called');
    if (!map || !userSettings.showLandingPattern || !weatherData || !lastLat || !lastLng || lastAltitude === null || lastAltitude === 'N/A') {
        console.log('Landing pattern not updated: missing data or feature disabled');
        // Clear existing layers
        if (landingPatternPolygon) {
            map.removeLayer(landingPatternPolygon);
            landingPatternPolygon = null;
        }
        if (secondlandingPatternPolygon) {
            map.removeLayer(secondlandingPatternPolygon);
            secondlandingPatternPolygon = null;
        }
        if (thirdLandingPatternLine) {
            map.removeLayer(thirdLandingPatternLine);
            thirdLandingPatternLine = null;
        }
        if (finalArrow) {
            map.removeLayer(finalArrow);
            finalArrow = null;
        }
        if (baseArrow) {
            map.removeLayer(baseArrow);
            baseArrow = null;
        }
        if (downwindArrow) {
            map.removeLayer(downwindArrow);
            downwindArrow = null;
        }
        return;
    }

    const currentZoom = map.getZoom();
    const isVisible = currentZoom >= landingPatternMinZoom;
    console.log('Landing pattern zoom check:', { currentZoom, landingPatternMinZoom, isVisible });

    // Clear existing layers to prevent duplicates
    if (landingPatternPolygon) {
        map.removeLayer(landingPatternPolygon);
        landingPatternPolygon = null;
    }
    if (secondlandingPatternPolygon) {
        map.removeLayer(secondlandingPatternPolygon);
        secondlandingPatternPolygon = null;
    }
    if (thirdLandingPatternLine) {
        map.removeLayer(thirdLandingPatternLine);
        thirdLandingPatternLine = null;
    }
    if (finalArrow) {
        map.removeLayer(finalArrow);
        finalArrow = null;
    }
    if (baseArrow) {
        map.removeLayer(baseArrow);
        baseArrow = null;
    }
    if (downwindArrow) {
        map.removeLayer(downwindArrow);
        downwindArrow = null;
    }

    if (!isVisible) {
        console.log('Landing pattern not displayed - zoom too low:', currentZoom);
        return;
    }

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

    // Convert wind speeds from km/h (Open-Meteo) to kt explicitly
    const heights = interpolatedData.map(d => d.height);
    const dirs = interpolatedData.map(d => Number.isFinite(d.dir) ? parseFloat(d.dir) : 0);
    const spdsKt = interpolatedData.map(d => Utils.convertWind(parseFloat(d.spd) || 0, 'kt', 'km/h')); // km/h to kt

    // Calculate U and V components in kt
    const uComponents = spdsKt.map((spd, i) => -spd * Math.sin(dirs[i] * Math.PI / 180));
    const vComponents = spdsKt.map((spd, i) => -spd * Math.cos(dirs[i] * Math.PI / 180));

    // Determine effective landing direction based on selected pattern and input
    let effectiveLandingWindDir;
    if (landingDirection === 'LL' && Number.isFinite(customLandingDirLL) && customLandingDirLL >= 0 && customLandingDirLL <= 359) {
        effectiveLandingWindDir = customLandingDirLL;
    } else if (landingDirection === 'RR' && Number.isFinite(customLandingDirRR) && customLandingDirRR >= 0 && customLandingDirRR <= 359) {
        effectiveLandingWindDir = customLandingDirRR;
    } else {
        effectiveLandingWindDir = Number.isFinite(landingWindDir) ? landingWindDir : dirs[0];
    }

    if (!Number.isFinite(effectiveLandingWindDir)) {
        console.warn('Invalid landing wind direction:', effectiveLandingWindDir);
        return;
    }

    // Helper function to convert wind speed to user-selected unit
    function formatWindSpeed(speedKt) {
        const unit = getWindSpeedUnit();
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

    // Final Leg (0-100m AGL)
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

    finalArrow = L.marker([finalMidLat, finalMidLng], {
        icon: createArrowIcon(finalMidLat, finalMidLng, finalArrowBearing, finalArrowColor)
    }).addTo(map);
    finalArrow.bindTooltip(`${Math.round(finalWindDir)}° ${formatWindSpeed(finalWindSpeedKt)}${getWindSpeedUnit()}`, {
        offset: [10, 0], // Slight offset to avoid overlap
        direction: 'right',
        className: 'wind-tooltip'
    });

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
    const baseGroundSpeedKt = CANOPY_SPEED_KT - baseHeadwind;
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

    baseArrow = L.marker([baseMidLat, baseMidLng], {
        icon: createArrowIcon(baseMidLat, baseMidLng, baseArrowBearing, baseArrowColor)
    }).addTo(map);
    baseArrow.bindTooltip(`${Math.round(baseWindDir)}° ${formatWindSpeed(baseWindSpeedKt)}${getWindSpeedUnit()}`, {
        offset: [10, 0],
        direction: 'right',
        className: 'wind-tooltip'
    });

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
    downwindArrow = L.marker([downwindMidLat, downwindMidLng], {
        icon: createArrowIcon(downwindMidLat, downwindMidLng, downwindArrowBearing, downwindArrowColor)
    }).addTo(map);
    downwindArrow.bindTooltip(`${Math.round(downwindWindDir)}° ${formatWindSpeed(downwindWindSpeedKt)}${getWindSpeedUnit()}`, {
        offset: [10, 0],
        direction: 'right',
        className: 'wind-tooltip'
    });

    console.log(`Landing Pattern Updated:
        Final Leg: Wind: ${finalWindDir.toFixed(1)}° @ ${finalWindSpeedKt.toFixed(1)}kt, Course: ${finalCourse.toFixed(1)}°, WCA: ${finalWca.toFixed(1)}°, GS: ${finalGroundSpeedKt.toFixed(1)}kt, HW: ${finalHeadwind.toFixed(1)}kt, Length: ${finalLength.toFixed(1)}m
        Base Leg: Wind: ${baseWindDir.toFixed(1)}° @ ${baseWindSpeedKt.toFixed(1)}kt, Course: ${baseCourse.toFixed(1)}°, WCA: ${baseWca.toFixed(1)}°, GS: ${baseGroundSpeedKt.toFixed(1)}kt, HW: ${baseHeadwind.toFixed(1)}kt, Length: ${baseLength.toFixed(1)}m
        Downwind Leg: Wind: ${downwindWindDir.toFixed(1)}° @ ${downwindWindSpeedKt.toFixed(1)}kt, Course: ${downwindCourse.toFixed(1)}°, WCA: ${downwindWca.toFixed(1)}°, GS: ${downwindGroundSpeedKt.toFixed(1)}kt, HW: ${downwindHeadwind.toFixed(1)}kt, Length: ${downwindLength.toFixed(1)}m`);

    // Logs für Feldversuch Bobby
    const selectedTime = weatherData.time[sliderIndex]; // Zeit aus den Wetterdaten basierend auf dem Slider-Index
    console.log('+++++++++ Koordinaten Pattern:', selectedTime);
    console.log('Coordinates DIP: ', lat, lng, 'Altitude DIP:', baseHeight);
    console.log('Coordinates final end: ', finalEnd[0], finalEnd[1], 'Leg Height:', baseHeight + LEG_HEIGHT_FINAL);
    console.log('Coordinates base end: ', baseEnd[0], baseEnd[1], 'Leg Height:', baseHeight + LEG_HEIGHT_BASE);
    console.log('Coordinates downwind end: ', downwindEnd[0], downwindEnd[1], 'Leg Height:', baseHeight + LEG_HEIGHT_DOWNWIND);


    //map.fitBounds([[lat, lng], finalEnd, baseEnd, downwindEnd], { padding: [50, 50] });
}
function createArrowIcon(lat, lng, bearing, color) {
    // Normalize bearing to 0-360
    const normalizedBearing = (bearing + 360) % 360;

    // Use the original SVG shape
    const arrowSvg = `
        <svg width="40" height="20" viewBox="0 0 40 20" xmlns="http://www.w3.org/2000/svg">
            <line x1="0" y1="10" x2="30" y2="10" stroke="${color}" stroke-width="4" />
            <polygon points="30,5 40,10 30,15" fill="${color}" />
        </svg>
    `;

    // Wrap SVG in a div with CSS rotation
    return L.divIcon({
        html: `
            <div style="
                transform: rotate(${normalizedBearing}deg);
                transform-origin: center center;
                width: 40px;
                height: 20px;
            ">
                ${arrowSvg}
            </div>
        `,
        className: 'wind-arrow-icon', // Avoid Leaflet default styles
        iconSize: [40, 20], // Match SVG dimensions
        iconAnchor: [20, 10], // Center of the icon (half of width and height)
        popupAnchor: [0, -10] // Adjust if popups are needed
    });
}

// == Coordinates History and Favorites ==
function initCoordStorage() {
    if (!localStorage.getItem('coordHistory')) {
        localStorage.setItem('coordHistory', JSON.stringify([]));
    }
}
function getCoordHistory() {
    return JSON.parse(localStorage.getItem('coordHistory')) || [];
}
function formatCoordLabel(lat, lng, format) {
    if (format === 'DMS') {
        const latDMS = Utils.decimalToDMS(lat, 'lat');
        const lngDMS = Utils.decimalToDMS(lng, 'lng');
        return `${latDMS.deg}°${latDMS.min}'${latDMS.sec}"${latDMS.dir} ${lngDMS.deg}°${lngDMS.min}'${lngDMS.sec}"${lngDMS.dir}`;
    } else if (format === 'MGRS') {
        try {
            return mgrs.forward([lng, lat], 10);
        } catch (e) {
            console.warn('MGRS format failed:', e);
            return `${lat.toFixed(2)}, ${lng.toFixed(2)}`;
        }
    }
    return `${lat.toFixed(2)}, ${lng.toFixed(2)}`;
}
function addCoordToHistory(lat, lng) {
    const history = getCoordHistory();
    const format = userSettings.coordFormat;
    const newEntry = {
        lat: parseFloat(lat.toFixed(4)),
        lng: parseFloat(lng.toFixed(4)),
        label: formatCoordLabel(lat, lng, format),
        isFavorite: false,
        timestamp: Date.now()
    };
    const existing = history.find(
        entry => entry.lat === newEntry.lat && entry.lng === newEntry.lng
    );
    if (existing) {
        newEntry.isFavorite = existing.isFavorite;
        newEntry.label = existing.isFavorite ? existing.label : newEntry.label;
        history.splice(history.indexOf(existing), 1);
    }
    history.unshift(newEntry);
    const favorites = history.filter(entry => entry.isFavorite);
    const nonFavorites = history.filter(entry => !entry.isFavorite).slice(0, 5);
    localStorage.setItem('coordHistory', JSON.stringify([...favorites, ...nonFavorites]));
    updateCoordDropdown();
}
function toggleFavorite(lat, lng) {
    console.log('Toggling favorite for:', { lat, lng });
    const history = getCoordHistory();
    const entry = history.find(
        entry => entry.lat === parseFloat(lat.toFixed(4)) && entry.lng === parseFloat(lng.toFixed(4))
    );
    if (entry) {
        console.log('Found entry:', entry);
        entry.isFavorite = !entry.isFavorite;
        if (entry.isFavorite) {
            entry.label = prompt('Name this favorite location:', entry.label) || entry.label;
        } else {
            entry.label = formatCoordLabel(entry.lat, entry.lng, userSettings.coordFormat);
        }
        localStorage.setItem('coordHistory', JSON.stringify(history));
        updateCoordDropdown();
        console.log('Updated history:', getCoordHistory());
    } else {
        console.log('No matching coordinate, adding as favorite');
        const format = userSettings.coordFormat;
        const newEntry = {
            lat: parseFloat(lat.toFixed(4)),
            lng: parseFloat(lng.toFixed(4)),
            label: prompt('Name this favorite location:', formatCoordLabel(lat, lng, format)) || formatCoordLabel(lat, lng, format),
            isFavorite: true,
            timestamp: Date.now()
        };
        history.unshift(newEntry);
        localStorage.setItem('coordHistory', JSON.stringify(history));
        updateCoordDropdown();
    }
}
function updateCoordDropdown() {
    const select = document.getElementById('coordHistory');
    if (!select) return;
    select.innerHTML = '<option value="">Select a location</option>';
    const history = getCoordHistory();
    history.sort((a, b) => {
        if (a.isFavorite && !b.isFavorite) return -1;
        if (!a.isFavorite && b.isFavorite) return 1;
        return b.timestamp - a.timestamp;
    });
    history.forEach(entry => {
        const option = document.createElement('option');
        option.value = `${entry.lat},${entry.lng}`;
        option.text = `${entry.isFavorite ? '★ ' : ''}${entry.label}`;
        select.appendChild(option);
    });
}
function populateCoordInputs(lat, lng) {
    const format = userSettings.coordFormat;
    if (format === 'Decimal') {
        document.getElementById('latDec').value = lat;
        document.getElementById('lngDec').value = lng;
    } else if (format === 'DMS') {
        const latDMS = Utils.decimalToDMS(lat, 'lat');
        const lngDMS = Utils.decimalToDMS(lng, 'lng');
        document.getElementById('latDeg').value = latDMS.deg;
        document.getElementById('latMin').value = latDMS.min;
        document.getElementById('latSec').value = latDMS.sec;
        document.getElementById('latDir').value = latDMS.dir;
        document.getElementById('lngDeg').value = lngDMS.deg;
        document.getElementById('lngMin').value = lngDMS.min;
        document.getElementById('lngSec').value = lngDMS.sec;
        document.getElementById('lngDir').value = lngDMS.dir;
    } else if (format === 'MGRS') {
        try {
            document.getElementById('mgrsCoord').value = mgrs.forward([lng, lat], 10);
        } catch (e) {
            console.warn('MGRS conversion failed:', e);
        }
    }
}

// == UI and Event Handling ==
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
    setInputValue('aircraftSpeedKt', userSettings.aircraftSpeedKt);
    setInputValue('numberOfJumpers', userSettings.numberOfJumpers); // Added
    setCheckboxValue('showTableCheckbox', userSettings.showTable);
    setCheckboxValue('calculateJumpCheckbox', userSettings.calculateJump);
    setCheckboxValue('showLandingPattern', userSettings.showLandingPattern);
    setCheckboxValue('showJumpRunTrack', userSettings.showJumpRunTrack);
    //setInputValue('jumpRunTrackDirection', userSettings.jumpRunTrackDirection || '');
    setInputValue('jumpRunTrackOffset', userSettings.jumpRunTrackOffset); // Ensure offset input is set
    setCheckboxValue('showExitAreaCheckbox', userSettings.showExitArea); // New checkbox
    userSettings.isCustomJumpRunDirection = userSettings.isCustomJumpRunDirection || false;

    // Ensure UI reflects the stored custom direction without overwriting
    const customLL = document.getElementById('customLandingDirectionLL');
    const customRR = document.getElementById('customLandingDirectionRR');
    if (customLL && userSettings.customLandingDirectionLL !== '' && !isNaN(userSettings.customLandingDirectionLL)) {
        customLL.value = userSettings.customLandingDirectionLL;
    }
    if (customRR && userSettings.customLandingDirectionRR !== '' && !isNaN(userSettings.customLandingDirectionRR)) {
        customRR.value = userSettings.customLandingDirectionRR;
    }
    const separation = getSeparationFromTAS(userSettings.aircraftSpeedKt);
    setInputValue('jumperSeparation', separation);
    userSettings.jumperSeparation = separation;
    saveSettings();
    // Set initial tooltip and style for locked state
    const landingPatternCheckbox = document.getElementById('showLandingPattern');
    const calculateJumpCheckbox = document.getElementById('calculateJumpCheckbox');
    if (landingPatternCheckbox) {
        landingPatternCheckbox.title = isLandingPatternUnlocked ? '' : 'Password required to enable';
        landingPatternCheckbox.style.opacity = isLandingPatternUnlocked ? '1' : '0.5'; // Visual cue
    }
    if (calculateJumpCheckbox) {
        calculateJumpCheckbox.title = isCalculateJumpUnlocked ? '' : 'Password required to enable';
        calculateJumpCheckbox.style.opacity = isCalculateJumpUnlocked ? '1' : '0.5'; // Visual cue
    }
    const directionSpan = document.getElementById('jumpRunTrackDirection');
    if (directionSpan) directionSpan.textContent = '-'; // Initial placeholder
    updateUIState();
}
function updateUIState() {
    const info = document.getElementById('info');
    if (info) info.style.display = userSettings.showTable ? 'block' : 'none';
    const customLL = document.getElementById('customLandingDirectionLL');
    const customRR = document.getElementById('customLandingDirectionRR');
    const showJumpRunTrackCheckbox = document.getElementById('showJumpRunTrack');
    const showExitAreaCheckbox = document.getElementById('showExitAreaCheckbox');
    if (customLL) customLL.disabled = userSettings.landingDirection !== 'LL';
    if (customRR) customRR.disabled = userSettings.landingDirection !== 'RR';
    if (showJumpRunTrackCheckbox) showJumpRunTrackCheckbox.disabled = !userSettings.calculateJump;
    if (showExitAreaCheckbox) showExitAreaCheckbox.disabled = !userSettings.calculateJump; // Disable unless calculateJump is on
    updateHeightUnitLabels();
    updateWindUnitLabels();
}
function restoreUIInteractivity() {
    const menu = document.getElementById('menu');
    const checkboxes = menu.querySelectorAll('input[type="checkbox"]');
    const inputs = menu.querySelectorAll('input[type="number"], input[type="text"]');

    // Check if elements are disabled unexpectedly
    checkboxes.forEach(cb => {
        if (cb.disabled && cb.id !== 'showJumpRunTrack' && cb.id !== 'showExitAreaCheckbox') {
            console.warn(`Checkbox ${cb.id} is disabled unexpectedly, re-enabling`);
            cb.disabled = false;
        }
    });

    inputs.forEach(input => {
        if (input.disabled && input.id !== 'customLandingDirectionLL' && input.id !== 'customLandingDirectionRR') {
            console.warn(`Input ${input.id} is disabled unexpectedly, re-enabling`);
            input.disabled = false;
        }
    });

    // Force a DOM refresh
    menu.style.display = 'none';
    void menu.offsetHeight; // Trigger reflow
    menu.style.display = 'block';

    console.log('UI interactivity check completed');
}
function setupSliderEvents() {
    const slider = document.getElementById('timeSlider');
    if (!slider) return Utils.handleError('Slider element missing.');

    slider.setAttribute('autocomplete', 'off');

    const debouncedUpdate = debounce(async (index) => {
        console.log('Slider event triggered:', { index, weatherData: !!weatherData });
        if (weatherData && index >= 0 && index < weatherData.time.length) {
            resetJumpRunDirection(false);
            await updateWeatherDisplay(index);
            if (lastLat && lastLng && lastAltitude !== 'N/A') {
                calculateMeanWind();
                if (userSettings.showJumpRunTrack) {
                    console.log('Updating JRT for slider change');
                    updateJumpRunTrack();
                }
                if (userSettings.calculateJump) {
                    console.log('Recalculating jump for slider change');
                    calculateJump();
                    calculateCutAway();
                }
                if (currentMarker) {
                    console.log('Updating marker popup for slider change');
                    const wasOpen = currentMarker.getPopup()?.isOpen() || false;
                    await updateMarkerPopup(currentMarker, lastLat, lastLng, lastAltitude, wasOpen);
                } else {
                    console.warn('No currentMarker to update popup');
                }
            }
        } else {
            console.log('Slider reset to 0: invalid index or no weather data');
            slider.value = 0;
            resetJumpRunDirection(false);
            await updateWeatherDisplay(0);
            if (lastLat && lastLng && lastAltitude !== 'N/A') {
                calculateMeanWind();
                if (userSettings.showJumpRunTrack) {
                    console.log('Updating JRT for slider reset');
                    updateJumpRunTrack();
                }
                if (userSettings.calculateJump) {
                    console.log('Recalculating jump for slider reset');
                    calculateJump();
                    calculateCutAway();
                }
                if (currentMarker) {
                    console.log('Updating marker popup for slider reset');
                    const wasOpen = currentMarker.getPopup()?.isOpen() || false;
                    await updateMarkerPopup(currentMarker, lastLat, lastLng, lastAltitude, wasOpen);
                } else {
                    console.warn('No currentMarker to update popup');
                }
            }
        }
    }, 100);

    slider.addEventListener('input', (e) => {
        console.log('Slider input event:', e.target.value);
        debouncedUpdate(parseInt(e.target.value));
    });
    slider.addEventListener('change', (e) => {
        console.log('Slider change event:', e.target.value);
        debouncedUpdate(parseInt(e.target.value));
    });
}
function setupModelSelectEvents() {
    const modelSelect = document.getElementById('modelSelect');
    if (!modelSelect) return;
    modelSelect.addEventListener('change', async () => {
        console.log('Model select changed to:', modelSelect.value);
        if (lastLat && lastLng) {
            const currentIndex = getSliderValue();
            const currentTime = weatherData?.time?.[currentIndex] || null;
            document.getElementById('info').innerHTML = `Fetching weather with ${modelSelect.value}...`;
            resetJumpRunDirection(false);
            await fetchWeather(lastLat, lastLng, currentTime);
            updateModelRunInfo();
            await updateWeatherDisplay(currentIndex);
            updateReferenceLabels();
            if (lastAltitude !== 'N/A') {
                calculateMeanWind();
                if (userSettings.calculateJump) {
                    console.log('Recalculating jump for model change');
                    calculateJump();
                    calculateCutAway(); // Call calculateCutAway after calculateJump
                }
            }
            if (userSettings.showJumpRunTrack) {
                console.log('Updating JRT for model change');
                updateJumpRunTrack();
            }
            if (currentMarker) {
                console.log('Updating marker popup for model change');
                const wasOpen = currentMarker.getPopup()?.isOpen() || false;
                await updateMarkerPopup(currentMarker, lastLat, lastLng, lastAltitude, wasOpen);
            } else {
                console.warn('No currentMarker to update popup');
            }
            userSettings.model = modelSelect.value;
            saveSettings();
        } else {
            Utils.handleError('Please select a position on the map first.');
        }
    });
}
function setupDownloadEvents() {
    const downloadButton = document.getElementById('downloadButton');
    if (downloadButton) {
        downloadButton.addEventListener('click', () => {
            const downloadFormat = getDownloadFormat();
            downloadTableAsAscii(downloadFormat);
        });
    }
}
function setupMenuEvents() {
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const menu = document.getElementById('menu');
    if (hamburgerBtn && menu) {
        // Ensure menu is hidden on load
        menu.classList.add('hidden');
        console.log('Menu initialized as hidden on load');

        // Log initial styles for debugging
        const computedStyle = window.getComputedStyle(menu);
        console.log('Initial menu styles:', {
            display: computedStyle.display,
            visibility: computedStyle.visibility,
            opacity: computedStyle.opacity,
            hasHiddenClass: menu.classList.contains('hidden')
        });

        hamburgerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault(); // Prevent any default behavior
            menu.classList.toggle('hidden');
            const isHidden = menu.classList.contains('hidden');

            // Log styles after toggle for debugging
            const currentStyle = window.getComputedStyle(menu);
            console.log('Main menu toggled:', isHidden ? 'hidden' : 'shown', {
                display: currentStyle.display,
                visibility: currentStyle.visibility,
                opacity: currentStyle.opacity,
                hasHiddenClass: isHidden
            });
        });

        const menuItems = menu.querySelectorAll('li span');
        menuItems.forEach(item => {
            item.addEventListener('click', (e) => {
                const submenu = item.nextElementSibling;
                if (submenu && submenu.classList.contains('submenu')) {
                    console.log('Clicked menu item:', item.textContent);
                    const isSubmenuHidden = submenu.classList.contains('hidden');
                    const parentUl = item.closest('ul');
                    parentUl.querySelectorAll('.submenu').forEach(otherSubmenu => {
                        if (otherSubmenu !== submenu) {
                            otherSubmenu.classList.add('hidden');
                        }
                    });
                    submenu.classList.toggle('hidden', !isSubmenuHidden);
                    console.log('Submenu toggled:', isSubmenuHidden ? 'shown' : 'hidden');
                } else {
                    console.log('No submenu for item:', item.textContent);
                }
                e.stopPropagation();
            });
        });

        menu.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Debug unresponsive clicks
        menu.addEventListener('click', (e) => {
            const target = e.target;
            if ((target.type === 'checkbox' || target.type === 'number' || target.type === 'text') && target.disabled) {
                console.warn('Click ignored on disabled element:', {
                    id: target.id,
                    type: target.type,
                    disabled: target.disabled,
                    menuVisible: !menu.classList.contains('hidden')
                });
                displayError('Cannot interact with disabled menu item');
            }
        });
    } else {
        console.warn('Hamburger button or menu not found');
    }
}
function setupRadioEvents() {
    setupRadioGroup('refLevel', () => {
        updateReferenceLabels();
        updateAllDisplays();
    });
    setupRadioGroup('heightUnit', () => {
        updateHeightUnitLabels();
        updateAllDisplays();
    });
    setupRadioGroup('temperatureUnit', () => {
        updateAllDisplays();
    });
    setupRadioGroup('windUnit', () => {
        updateWindUnitLabels();
        updateAllDisplays();
    });
    setupRadioGroup('timeZone', async () => {
        updateAllDisplays();
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
        console.log('landingDirection changed:', { landingDirection, customLL: customLL?.value, customRR: customRR?.value });
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
        updateUIState(); // Ensure UI reflects disabled state
        updateAllDisplays();
    });
    setupRadioGroup('cutAwayState', () => {
        userSettings.cutAwayState = getSettingValue('cutAwayState', 'radio', 'Collapsed');
        saveSettings();
        console.log('cutAwayState changed:', userSettings.cutAwayState);
        if (userSettings.showCutAwayFinder && userSettings.calculateJump && weatherData && lastLat && lastLng) {
            console.log('Recalculating cut-away for state change');
            calculateJump();
            calculateCutAway();
        }
    });
}
function setupInputEvents() {
    setupInput('lowerLimit', 'change', 300, (value) => {
        if (weatherData && lastLat && lastLng && lastAltitude !== 'N/A') calculateMeanWind();
    });
    setupInput('upperLimit', 'change', 300, (value) => {
        if (weatherData && lastLat && lastLng && lastAltitude !== 'N/A') calculateMeanWind();
    });
    setupInput('openingAltitude', 'change', 300, (value) => {
        if (!isNaN(value) && value >= 500 && value <= 15000) {
            if (userSettings.calculateJump && weatherData && lastLat && lastLng) {
                calculateJump();
                calculateCutAway();
            }
        } else {
            Utils.handleError('Opening altitude must be between 500 and 15000 meters.');
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
            updateAllDisplays();
        } else {
            Utils.handleError('Canopy speed must be between 5 and 50 kt.');
            setInputValue('canopySpeed', 20);
            userSettings.canopySpeed = 20;
            saveSettings();
        }
    });
    setupInput('descentRate', 'change', 300, (value) => {
        if (!isNaN(value) && value >= 1 && value <= 10) {
            updateAllDisplays();
        } else {
            Utils.handleError('Descent rate must be between 1 and 10 m/s.');
            setInputValue('descentRate', 3);
            userSettings.descentRate = 3;
            saveSettings();
        }
    });
    setupInput('interpStepSelect', 'change', 300, (value) => {
        updateAllDisplays();
    });
    setupLegHeightInput('legHeightFinal', 100);
    setupLegHeightInput('legHeightBase', 200);
    setupLegHeightInput('legHeightDownwind', 300);
    setupInput('customLandingDirectionLL', 'input', 100, (value) => {
        const customDir = parseInt(value, 10);
        console.log('customLandingDirectionLL input:', { value, customDir });
        if (!isNaN(customDir) && customDir >= 0 && customDir <= 359) {
            userSettings.customLandingDirectionLL = customDir;
            saveSettings();
            if (userSettings.landingDirection === 'LL' && weatherData && lastLat && lastLng) {
                console.log('Updating landing pattern for LL:', customDir);
                updateLandingPattern();
                recenterMap();
            }
        } else {
            Utils.handleError('Landing direction must be between 0 and 359°.');
            setInputValue('customLandingDirectionLL', userSettings.customLandingDirectionLL || 0);
        }
    });
    setupInput('customLandingDirectionRR', 'input', 100, (value) => {
        const customDir = parseInt(value, 10);
        console.log('customLandingDirectionRR input:', { value, customDir });
        if (!isNaN(customDir) && customDir >= 0 && customDir <= 359) {
            userSettings.customLandingDirectionRR = customDir;
            saveSettings();
            if (userSettings.landingDirection === 'RR' && weatherData && lastLat && lastLng) {
                console.log('Updating landing pattern for RR:', customDir);
                updateLandingPattern();
                recenterMap();
            }
        } else {
            Utils.handleError('Landing direction must be between 0 and 359°.');
            setInputValue('customLandingDirectionRR', userSettings.customLandingDirectionRR || 0);
        }
    });
    setupInput('jumpRunTrackDirection', 'change', 0, (value) => {
        const customDir = parseInt(value, 10);
        console.log('jumpRunTrackDirection change event:', {
            value,
            customDir,
            jumpRunTrackOffset: userSettings.jumpRunTrackOffset
        });
        if (!isNaN(customDir) && customDir >= 0 && customDir <= 359) {
            if (userSettings.jumpRunTrackOffset !== 0) {
                console.log('Error: Attempted to rotate jump run track with non-zero offset');
                displayError('jump run track rotation only works at the original position. Reset offset to 0 or rotate before moving.');
                return;
            }
            customJumpRunDirection = customDir;
            console.log('Set custom direction from input:', customDir);
            if (weatherData && lastLat && lastLng) {
                if (userSettings.showJumpRunTrack) {
                    console.log('Updating JRT for custom direction input');
                    updateJumpRunTrack();
                }
                if (userSettings.calculateJump) {
                    console.log('Recalculating jump for custom JRT direction');
                    calculateJump();
                    calculateCutAway();
                }
            } else {
                console.warn('Cannot update JRT or jump: missing conditions', {
                    weatherData: !!weatherData,
                    lastLat,
                    lastLng
                });
            }
        } else {
            console.log('Invalid direction input, resetting to calculated');
            Utils.handleError('Jump run direction must be between 0 and 359°.');
            customJumpRunDirection = null;
            const directionInput = document.getElementById('jumpRunTrackDirection');
            if (directionInput) {
                setInputValueSilently('jumpRunTrackDirection', '');
            }
            if (weatherData && lastLat && lastLng) {
                if (userSettings.showJumpRunTrack) {
                    console.log('Updating JRT for invalid direction input');
                    updateJumpRunTrack();
                }
                if (userSettings.calculateJump) {
                    console.log('Recalculating jump for reset JRT direction');
                    calculateJump();
                    calculateCutAway();
                }
            }
        }
    });
    setupInput('jumpRunTrackOffset', 'change', 0, (value) => {
        const offset = parseInt(value, 10);
        console.log('jumpRunTrackOffset change event:', { value, offset });
        if (!isNaN(offset) && offset >= -50000 && offset <= 50000 && offset % 100 === 0) {
            userSettings.jumpRunTrackOffset = offset;
            saveSettings();
            if (userSettings.calculateJump && userSettings.showJumpRunTrack && weatherData && lastLat && lastLng) {
                console.log('Updating JRT for offset change');
                updateJumpRunTrack();
            }
        } else {
            Utils.handleError('Offset must be between -50000 and 50000 in steps of 100.');
            const offsetInput = document.getElementById('jumpRunTrackOffset');
            if (offsetInput) {
                offsetInput.value = 0;
            }
            userSettings.jumpRunTrackOffset = 0;
            saveSettings();
            if (userSettings.calculateJump && userSettings.showJumpRunTrack) {
                console.log('Resetting JRT for invalid offset');
                updateJumpRunTrack();
            }
        }
    });
    setupInput('aircraftSpeedKt', 'change', 300, (value) => {
        const speed = parseFloat(value);
        if (!isNaN(speed) && speed >= 10 && speed <= 150) {
            userSettings.aircraftSpeedKt = speed;
            saveSettings();
            // Update jumperSeparation if not manually set
            if (!isJumperSeparationManual) {
                const separation = getSeparationFromTAS(speed);
                setInputValue('jumperSeparation', separation);
                userSettings.jumperSeparation = separation;
                saveSettings();
                console.log(`Auto-updated jumperSeparation to ${separation}s for IAS ${speed}kt`);
            }
            if (userSettings.calculateJump && weatherData && lastLat && lastLng) {
                console.log('Recalculating jump for aircraft speed change');
                calculateJump();
                calculateCutAway();
            }
        } else {
            Utils.handleError('Aircraft speed must be between 10 and 150 kt.');
            setInputValue('aircraftSpeedKt', defaultSettings.aircraftSpeedKt);
            userSettings.aircraftSpeedKt = defaultSettings.aircraftSpeedKt;
            saveSettings();
        }
    });
    setupInput('numberOfJumpers', 'change', 300, (value) => {
        const number = parseFloat(value);
        if (!isNaN(number) && number >= 1 && number <= 50) {
            userSettings.numberOfJumpers = number;
            saveSettings();
            if (userSettings.calculateJump && weatherData && lastLat && lastLng) {
                console.log('Recalculating jump for jumper number change');
                calculateJump();
                calculateCutAway();
            }
        } else {
            Utils.handleError('Jumper number must be between 1 and 50.');
            setInputValue('numberOfJumpers', defaultSettings.numberOfJumpers);
            userSettings.numberOfJumpers = defaultSettings.numberOfJumpers;
            saveSettings();
        }
    });
    setupInput('jumperSeparation', 'change', 300, (value) => {
        const separation = parseFloat(value);
        if (!isNaN(separation) && separation >= 1 && separation <= 50) {
            userSettings.jumperSeparation = separation;
            isJumperSeparationManual = true; // Mark as manually set
            saveSettings();
            console.log(`jumperSeparation manually set to ${separation}s`);
            if (userSettings.calculateJump && weatherData && lastLat && lastLng) {
                console.log('Recalculating jump for jumper separation change');
                calculateJump();
                calculateCutAway();
            }
        } else {
            Utils.handleError('Jumper separation must be between 1 and 50 seconds.');
            setInputValue('jumperSeparation', defaultSettings.jumperSeparation);
            userSettings.jumperSeparation = defaultSettings.jumperSeparation;
            isJumperSeparationManual = false; // Reset to auto on invalid input
            saveSettings();
        }
    });
    setupInput('cutAwayAltitude', 'change', 300, (value) => {
        if (!isNaN(value) && value >= 400 && value <= 15000) {
            userSettings.cutAwayAltitude = value;
            saveSettings();
            if (userSettings.showCutAwayFinder && weatherData && lastLat && lastLng) {
                calculateJump();
                calculateCutAway();
            }
        } else {
            Utils.handleError('Cut away altitude must be between 400 and 15000 meters.');
            setInputValue('cutAwayAltitude', 1000);
            userSettings.cutAwayAltitude = 1000;
            saveSettings();
        }
    });
    setupInput('cutAwayAltitude', 'change', 300, (value) => {
        if (!isNaN(value) && value >= 400 && value <= 15000) {
            userSettings.cutAwayAltitude = value;
            saveSettings();
            if (userSettings.showCutAwayFinder && userSettings.calculateJump && weatherData && lastLat && lastLng) {
                console.log('Recalculating jump for cut-away altitude change');
                calculateJump();
                calculateCutAway();
            }
        } else {
            Utils.handleError('Cut away altitude must be between 400 and 15000 meters.');
            setInputValue('cutAwayAltitude', 1000);
            userSettings.cutAwayAltitude = 1000;
            saveSettings();
        }
    });
}
function setupCheckboxEvents() {
    setupCheckbox('showTableCheckbox', 'showTable', (checkbox) => {
        try {
            console.log('Checkbox changed, checked:', checkbox.checked);
            userSettings.showTable = checkbox.checked;
            console.log('Before saveSettings');
            saveSettings();
            console.log('After saveSettings, userSettings.showTable:', userSettings.showTable);

            const info = document.getElementById('info');
            if (info) {
                console.log('Info found, setting display');
                info.style.display = userSettings.showTable ? 'block' : 'none';
                void info.offsetHeight;
                console.log('Info display set to:', info.style.display);
            } else {
                console.warn('Info element not found');
            }

            if (userSettings.showTable && weatherData && lastLat && lastLng) {
                console.log('Calling updateWeatherDisplay');
                updateWeatherDisplay(getSliderValue());
            }
            recenterMap();
            console.log('Handler completed');
        } catch (error) {
            console.error('Error in checkbox handler:', error);
        }
    });

    setupCheckbox('calculateJumpCheckbox', 'calculateJump', (checkbox) => {
        const enableFeature = () => {
            toggleSubmenu('calculateJumpCheckbox', true);
            console.log('Calculate Jump enabled');
            if (weatherData && lastLat !== null && lastLng !== null) {
                console.log('Calling calculateJump with:', { weatherData, lastLat, lastLng });
                calculateJump();
                calculateCutAway();
            } else {
                console.warn('Cannot calculate jump yet: Missing data', { weatherData: !!weatherData, lastLat, lastLng });
                if (!checkbox.dataset.initialLoad) {
                    Utils.handleError('Please click the map to set a location first.');
                }
            }
        };

        const disableFeature = () => {
            userSettings.calculateJump = false;
            checkbox.checked = false;
            saveSettings();
            toggleSubmenu('calculateJumpCheckbox', false);
            console.log('Clearing jump circles');
            clearJumpCircles();
        };

        if (!checkbox.dataset.initialLoad) {
            checkbox.dataset.initialLoad = 'true';
            checkbox.checked = false;
            userSettings.calculateJump = false;
            saveSettings();
            return;
        }

        if (checkbox.checked) {
            if (isFeatureUnlocked('calculateJump')) {
                userSettings.calculateJump = true;
                saveSettings();
                enableFeature();
            } else {
                showPasswordModal('calculateJump', () => {
                    userSettings.calculateJump = true;
                    saveSettings();
                    enableFeature();
                }, () => {
                    disableFeature();
                });
            }
        } else {
            disableFeature();
        }
    });

    setupCheckbox('showLandingPattern', 'showLandingPattern', (checkbox) => {
        const enableFeature = () => {
            toggleSubmenu('showLandingPattern', true);
            if (weatherData && lastLat && lastLng) {
                updateLandingPattern();
                recenterMap();
            }
        };

        const disableFeature = () => {
            userSettings.showLandingPattern = false;
            checkbox.checked = false;
            saveSettings();
            toggleSubmenu('showLandingPattern', false);
            console.log('Clearing landing pattern');
            if (landingPatternPolygon) {
                map.removeLayer(landingPatternPolygon);
                landingPatternPolygon = null;
            }
            if (secondlandingPatternPolygon) {
                map.removeLayer(secondlandingPatternPolygon);
                secondlandingPatternPolygon = null;
            }
            if (thirdLandingPatternLine) {
                map.removeLayer(thirdLandingPatternLine);
                thirdLandingPatternLine = null;
            }
            if (finalArrow) {
                map.removeLayer(finalArrow);
                finalArrow = null;
            }
            if (baseArrow) {
                map.removeLayer(baseArrow);
                baseArrow = null;
            }
            if (downwindArrow) {
                map.removeLayer(downwindArrow);
                downwindArrow = null;
            }
        };

        if (checkbox.checked) {
            if (isFeatureUnlocked('landingPattern')) {
                userSettings.showLandingPattern = true;
                saveSettings();
                enableFeature();
            } else {
                showPasswordModal('landingPattern', () => {
                    userSettings.showLandingPattern = true;
                    saveSettings();
                    enableFeature();
                }, () => {
                    disableFeature();
                });
            }
        } else {
            disableFeature();
        }
    });

    setupCheckbox('showJumpRunTrack', 'showJumpRunTrack', (checkbox) => {
        userSettings.showJumpRunTrack = checkbox.checked;
        saveSettings();
        console.log('showJumpRunTrack changed:', checkbox.checked);
        if (checkbox.checked && userSettings.calculateJump) {
            console.log('Show Jump Run Track enabled, updating JRT');
            updateJumpRunTrack();
        } else {
            // Remove jump run track, airplane marker, and approach path
            if (jumpRunTrackLayer) {
                if (jumpRunTrackLayer.airplaneMarker) {
                    map.removeLayer(jumpRunTrackLayer.airplaneMarker);
                    jumpRunTrackLayer.airplaneMarker = null;
                    console.log('Removed airplane marker for JRT');
                }
                if (jumpRunTrackLayer.approachLayer) {
                    map.removeLayer(jumpRunTrackLayer.approachLayer);
                    jumpRunTrackLayer.approachLayer = null;
                    console.log('Removed approach path for JRT');
                }
                map.removeLayer(jumpRunTrackLayer);
                jumpRunTrackLayer = null;
                console.log('Removed JRT polyline');
            }
            // Update direction input
            const directionInput = document.getElementById('jumpRunTrackDirection');
            if (directionInput) {
                const trackData = jumpRunTrack();
                if (trackData) {
                    // Update value without triggering change event
                    directionInput.value = trackData.direction;
                    console.log('Updated jumpRunTrackDirection value without event:', trackData.direction);
                } else {
                    directionInput.value = '';
                    console.log('Cleared jumpRunTrackDirection value');
                }
            }
        }
    });

    setupCheckbox('showExitAreaCheckbox', 'showExitArea', (checkbox) => {
        userSettings.showExitArea = checkbox.checked;
        saveSettings();
        console.log('Show Exit Area set to:', userSettings.showExitArea);
        if (userSettings.calculateJump && weatherData && lastLat && lastLng) {
            calculateJump(); // Recalculate to update green circle visibility
            calculateCutAway();
        }
    });

    setupCheckbox('showCutAwayFinder', 'showCutAwayFinder', (checkbox) => {
        userSettings.showCutAwayFinder = checkbox.checked;
        saveSettings();
        console.log('showCutAwayFinder changed:', checkbox.checked);
        // Explicitly find and toggle the submenu
        const checkboxElement = document.getElementById('showCutAwayFinder');
        if (checkboxElement) {
            const parentLi = checkboxElement.closest('li');
            if (parentLi) {
                const submenu = parentLi.querySelector(':scope > ul.submenu');
                if (submenu) {
                    console.log(`Toggling showCutAwayFinder submenu: setting hidden to ${!checkbox.checked}`);
                    submenu.classList.toggle('hidden', !checkbox.checked);
                    console.log('showCutAwayFinder submenu visibility:', !submenu.classList.contains('hidden'));
                } else {
                    console.warn('showCutAwayFinder submenu not found');
                }
            } else {
                console.warn('Parent <li> for showCutAwayFinder not found');
            }
        } else {
            console.warn('showCutAwayFinder checkbox not found');
        }
        if (checkbox.checked && userSettings.calculateJump && weatherData && lastLat && lastLng) {
            console.log('Show Cut Away Finder enabled, running calculateCutAway');
            calculateJump();
            calculateCutAway();
        } else {
            if (cutAwayCircle) {
                map.removeLayer(cutAwayCircle);
                cutAwayCircle = null;
                console.log('Cleared cut-away circle');
            }
        }
    });
}
function setupCoordinateEvents() {
    initCoordStorage();
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
                console.log('Coordinate input, moving marker to:', { lat, lng });
                if (currentMarker) {
                    currentMarker.setLatLng([lat, lng]);
                } else {
                    currentMarker = createCustomMarker(lat, lng).addTo(map);
                    currentMarker.on('click', () => {
                        if (currentMarker.getPopup()?.isOpen()) {
                            currentMarker.closePopup();
                        } else {
                            updateMarkerPopup(currentMarker, lastLat, lastLng, lastAltitude, true);
                        }
                    });
                }
                updateMarkerPopup(currentMarker, lat, lng, lastAltitude, true);
                resetJumpRunDirection(true);
                addCoordToHistory(lat, lng);
                if (userSettings.calculateJump) {
                    console.log('Recalculating jump for coordinate input');
                    calculateJump();
                    calculateCutAway();
                }
                recenterMap();
                await fetchWeatherForLocation(lat, lng);
            } catch (error) {
                Utils.handleError(error.message);
            }
        });
    }

    const coordHistory = document.getElementById('coordHistory');
    if (coordHistory) {
        coordHistory.addEventListener('change', (e) => {
            if (e.target.value) {
                const [lat, lng] = e.target.value.split(',').map(parseFloat);
                populateCoordInputs(lat, lng);
                moveMarkerBtn.click();
            }
        });
    }

    const favoriteBtn = document.getElementById('favoriteBtn');
    if (favoriteBtn) {
        favoriteBtn.addEventListener('click', () => {
            try {
                const [lat, lng] = parseCoordinates();
                toggleFavorite(lat, lng);
            } catch (error) {
                Utils.handleError('Please enter valid coordinates to favorite');
            }
        });
    }
}
function setupCheckbox(id, settingsKey, callback) {
    const checkbox = document.getElementById(id);
    if (!checkbox) {
        console.warn(`Checkbox with ID "${id}" not found`);
        return;
    }
    checkbox.checked = userSettings[settingsKey]; // Set initial state
    callback(checkbox); // Run callback with initial state
    checkbox.addEventListener('change', () => {
        console.log(`${id} changed to:`, checkbox.checked);
        callback(checkbox);
    });
}
function setupResetButton() {
    const resetButton = document.createElement('button');
    resetButton.textContent = 'Reset Settings';
    resetButton.style.margin = '10px';
    document.getElementById('bottom-container').appendChild(resetButton);
    resetButton.addEventListener('click', () => {
        userSettings = { ...defaultSettings };
        isLandingPatternUnlocked = false;
        isCalculateJumpUnlocked = false;
        localStorage.setItem('upperWindsSettings', JSON.stringify(userSettings));
        localStorage.setItem('unlockedFeatures', JSON.stringify({
            landingPattern: false,
            calculateJump: false
        }));
        console.log('Settings and unlock status reset');
        location.reload();
    });
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
function showPasswordModal(feature, onSuccess, onCancel) {
    const modal = document.getElementById('passwordModal');
    const input = document.getElementById('passwordInput');
    const error = document.getElementById('passwordError');
    const submitBtn = document.getElementById('passwordSubmit');
    const cancelBtn = document.getElementById('passwordCancel');
    const header = document.getElementById('modalHeader');
    const message = document.getElementById('modalMessage');

    if (!modal || !input || !submitBtn || !cancelBtn || !header || !message) {
        console.error('Modal elements not found');
        return;
    }

    const featureName = feature === 'landingPattern' ? 'Landing Pattern' : 'Calculate Jump';
    header.textContent = `${featureName} Access`;
    message.textContent = `Please enter the password to enable ${featureName.toLowerCase()}:`;

    input.value = '';
    error.style.display = 'none';
    modal.style.display = 'flex';

    const submitHandler = () => {
        if (input.value === FEATURE_PASSWORD) {
            modal.style.display = 'none';
            if (feature === 'landingPattern') {
                isLandingPatternUnlocked = true;
                const checkbox = document.getElementById('showLandingPattern');
                if (checkbox) {
                    checkbox.style.opacity = '1'; // Visual feedback
                    checkbox.title = ''; // Clear tooltip
                }
            }
            if (feature === 'calculateJump') {
                isCalculateJumpUnlocked = true;
                const checkbox = document.getElementById('calculateJumpCheckbox');
                if (checkbox) {
                    checkbox.style.opacity = '1'; // Visual feedback
                    checkbox.title = ''; // Clear tooltip
                }
            }
            localStorage.setItem('unlockedFeatures', JSON.stringify({
                landingPattern: isLandingPatternUnlocked,
                calculateJump: isCalculateJumpUnlocked
            }));
            console.log('Feature unlocked and saved:', feature);
            onSuccess();
        } else {
            error.style.display = 'block';
        }
    };

    submitBtn.onclick = submitHandler;
    input.onkeypress = (e) => { if (e.key === 'Enter') submitHandler(); };
    cancelBtn.onclick = () => {
        modal.style.display = 'none';
        onCancel();
    };
}
function isFeatureUnlocked(feature) {
    return feature === 'landingPattern' ? isLandingPatternUnlocked : isCalculateJumpUnlocked;
}
// Setup values
function getSliderValue() {
    return parseInt(document.getElementById('timeSlider')?.value) || 0;
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
function setInputValueSilently(id, value) {
    const input = document.getElementById(id);
    if (input) {
        const lastValue = input.value;
        input.value = value;
        console.log(`Set ${id} silently:`, { old: lastValue, new: value });
    }
}
function setCheckboxValue(id, value) {
    const element = document.getElementById(id);
    if (element) element.checked = value;
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
    // Only clear green circles if showExitArea is false
    if (!userSettings.showExitArea) {
        if (jumpCircleGreen) {
            map.removeLayer(jumpCircleGreen);
            jumpCircleGreen = null;
        }
        if (jumpCircleGreenLight) {
            map.removeLayer(jumpCircleGreenLight);
            jumpCircleGreenLight = null;
        }
    }
}
function updateCoordInputs(format) {
    const coordInputs = document.getElementById('coordInputs');
    if (!coordInputs) return;

    coordInputs.innerHTML = '';
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
    coordInputs.innerHTML += `
        <label for="coordHistory">Recent/Favorites:</label>
        <select id="coordHistory" aria-label="Select recent or favorite coordinates">
            <option value="">Select a location</option>
        </select>
        <button id="favoriteBtn" style="margin-left: 10px;">Toggle Favorite</button>
    `;
    console.log(`Coordinate inputs updated to ${format}`);
    updateCoordDropdown();
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
function setupRadioGroup(name, callback) {
    const radios = document.querySelectorAll(`input[name="${name}"]`);
    radios.forEach(radio => {
        radio.addEventListener('change', () => {
            userSettings[name] = document.querySelector(`input[name="${name}"]:checked`).value;
            saveSettings();
            console.log(`${name} changed to:`, userSettings[name]);

            // Only for landingDirection, handle custom inputs
            if (name === 'landingDirection') {
                const customLL = document.getElementById('customLandingDirectionLL');
                const customRR = document.getElementById('customLandingDirectionRR');
                const landingDirection = userSettings.landingDirection;

                if (customLL) customLL.disabled = landingDirection !== 'LL';
                if (customRR) customRR.disabled = landingDirection !== 'RR';

                // Do NOT overwrite custom direction with calculated value here
                // Only set it if the field is empty AND no stored value exists
                if (landingDirection === 'LL' && customLL && !customLL.value && userSettings.customLandingDirectionLL === '') {
                    customLL.value = Math.round(landingWindDir || 0);
                    userSettings.customLandingDirectionLL = parseInt(customLL.value);
                    saveSettings();
                }
                if (landingDirection === 'RR' && customRR && !customRR.value && userSettings.customLandingDirectionRR === '') {
                    customRR.value = Math.round(landingWindDir || 0);
                    userSettings.customLandingDirectionRR = parseInt(customRR.value);
                    saveSettings();
                }
            }
            callback();
        });
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
            updateAllDisplays();
            weatherData && lastLat && lastLng && id === 'legHeightDownwind' && userSettings.calculateJump && calculateJump();
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
async function updateAllDisplays() {
    const sliderIndex = getSliderValue();
    if (weatherData && lastLat && lastLng) {
        await updateWeatherDisplay(sliderIndex);
        if (lastAltitude !== 'N/A') calculateMeanWind();
        if (userSettings.showLandingPattern) updateLandingPattern();
        if (userSettings.calculateJump) {
            calculateJump();
            calculateCutAway();
            if (userSettings.showJumpRunTrack) updateJumpRunTrack();
        }
        recenterMap();
    }
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