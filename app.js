// == Project: Skydiving Weather and Jump Planner ==
// == Constants and Global Variables ==
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
    calculateJump: true,
    openingAltitude: 1200,
    exitAltitude: 3000,
    showJumpRunTrack: false,
    showExitArea: false,
    showCanopyArea: false, // Add this line
    jumpRunTrackOffset: 0, // Keep offset as it’s a user-configurable setting
    jumpRunTrackForwardOffset: 0, // New setting for forward/backward offset
    aircraftSpeedKt: 90, // Added for Jump Parameters
    jumperSeparation: 5,  // Added for Jump Parameters
    numberOfJumpers: 5,
    cutAwayAltitude: 1000, // Added for cut-away input
    cutAwayState: 'Partially', // Added for cut-away radio buttons
    trackPosition: false, // New setting for live tracking
    showJumpMasterLine: false, // New setting
    jumpMasterLineTarget: 'DIP', // New setting for DIP or HARP
    harpLat: null, // New setting for HARP position
    harpLng: null,
    cacheRadiusKm: 5, // New setting: radius in km for caching tiles around DIP
    cacheZoomLevels: [11, 12, 13, 14] // New setting: zoom levels to cache
};
let isInitialized = false;
let userSettings = JSON.parse(localStorage.getItem('upperWindsSettings')) || { ...defaultSettings };
let map;
let lastLat = null;
let lastLng = null;
let lastAltitude = null;
let currentMarker = null;
let isManualPanning = false; // New flag to track manual panning
let liveMarker = null; // New marker for live position
let jumpMasterLine = null; // New global for Jump Master Line
let isPlacingHarp = false; // Flag for HARP placement mode
let harpMarker = null;
let watchId = null;
let gpxLayer = null;
let gpxPoints = [];
let isLoadingGpx = false;
let weatherData = null;
let lastModelRun = null;
let landingPatternPolygon = null;
let secondlandingPatternPolygon = null;
let thirdLandingPatternLine = null;
let finalArrow = null;
let baseArrow = null;
let downwindArrow = null;
let landingWindDir = null;
let jumpRunTrackLayer = null;
let customJumpRunDirection = null; // Temporary storage for custom direction during session
let isJumperSeparationManual = false; // Tracks if jumperSeparation is manually set
let jumpCircle = null;
let jumpCircleFull = null;
let jumpCircleGreen = null;
let jumpCircleGreenLight = null;
let blueCircleLayer = null;
let greenCircleLayer = null;
let redCircleLayer = null;
let cutAwayMarker = null;
let cutAwayLat = null;
let cutAwayLng = null;
let cutAwayCircle = null;
let prevLat = null;
let prevLng = null;
let prevTime = null;
let livePositionControl = null;
// New: Store last position data for instant unit updates
let lastLatitude = null;
let lastLongitude = null;
let lastDeviceAltitude = null;
let lastAltitudeAccuracy = null;
let lastAccuracy = null;
let lastSpeed = 'N/A';
let lastEffectiveWindUnit = 'kt';
let lastDirection = 'N/A';
let lastTerrainAltitude = 'N/A';
let lastSmoothedSpeedMs = 0; // Store last smoothed speed for EMA



const minZoom = 11;
const maxZoom = 14;
const landingPatternMinZoom = 14;
const debouncedCalculateJump = debounce(calculateJump, 300);
const getTemperatureUnit = () => getSettingValue('temperatureUnit', 'radio', 'C');
const getHeightUnit = () => getSettingValue('heightUnit', 'radio', 'm');
const getWindSpeedUnit = () => getSettingValue('windUnit', 'radio', 'kt');
const getCoordinateFormat = () => getSettingValue('coordFormat', 'radio', 'Decimal');
const getInterpolationStep = () => getSettingValue('interpStepSelect', 'select', 200);
const getDownloadFormat = () => getSettingValue('downloadFormat', 'radio', 'csv');
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


// == Password handling ==
let isLandingPatternUnlocked = false;   // Track unlock state during session
let isCalculateJumpUnlocked = false;    // Track unlock state during session
const FEATURE_PASSWORD = "skydiver2025"; // Hardcoded password 
const unlockedFeatures = JSON.parse(localStorage.getItem('unlockedFeatures')) || {};
isLandingPatternUnlocked = unlockedFeatures.landingPattern || false;
isCalculateJumpUnlocked = unlockedFeatures.calculateJump || false;
console.log('Initial unlock status:', { isLandingPatternUnlocked, isCalculateJumpUnlocked });

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
    userSettings.trackPosition = false;
    userSettings.showJumpMasterLine = false;
    userSettings.harpLat = null;
    userSettings.harpLng = null;
    userSettings.jumpRunTrackOffset = 0;
    userSettings.jumpRunTrackForwardOffset = 0; // Initialize new setting
    isJumperSeparationManual = false;
    saveSettings();
    console.log('Initialized settings with Jump Master menu defaults:', {
        trackPosition: userSettings.trackPosition,
        showJumpMasterLine: userSettings.showJumpMasterLine,
        harpLat: userSettings.harpLat,
        harpLng: userSettings.harpLng,
        jumpRunTrackOffset: userSettings.jumpRunTrackOffset,
        jumpRunTrackForwardOffset: userSettings.jumpRunTrackForwardOffset,
        isJumperSeparationManual
    });
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
function configureMarker(lat, lng, altitude, openPopup = false) {
    if (currentMarker) {
        currentMarker.remove();
    }
    currentMarker = createCustomMarker(lat, lng).addTo(map);
    attachMarkerDragend(currentMarker);
    currentMarker.on('click', (e) => {
        L.DomEvent.stopPropagation(e); // Prevent map click events from interfering
        const popup = currentMarker.getPopup();
        console.log('Marker click event, popup state:', { hasPopup: !!popup, isOpen: popup?.isOpen() });
        if (popup?.isOpen()) {
            currentMarker.closePopup();
            console.log('Closed popup on marker click');
        } else {
            updateMarkerPopup(currentMarker, lat, lng, altitude, true);
            console.log('Requested popup open on marker click');
        }
    });
    updateMarkerPopup(currentMarker, lat, lng, altitude, openPopup);
    console.log('Configured marker at:', { lat, lng, openPopup });
    return currentMarker;
}

// == Map Initialization and Interaction ==
function initMap() {
    const defaultCenter = [48.0179, 11.1923];
    const defaultZoom = 11;

    map = L.map('map', {
        center: defaultCenter,
        zoom: defaultZoom,
        zoomControl: false,
        doubleClickZoom: false
    });

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

    const selectedBaseMap = userSettings.baseMaps in baseMaps ? userSettings.baseMaps : "Esri Street";
    const fallbackBaseMap = "OpenStreetMap";
    const layer = baseMaps[selectedBaseMap];
    layer.on('tileerror', () => {
        console.warn(`${selectedBaseMap} tiles failed to load, switching to ${fallbackBaseMap}`);
        if (map.hasLayer(layer)) {
            map.removeLayer(layer);
            baseMaps[fallbackBaseMap].addTo(map);
            userSettings.baseMaps = fallbackBaseMap;
            saveSettings();
        }
    });
    layer.addTo(map);

    L.control.layers(baseMaps, null, { position: 'topright' }).addTo(map);
    map.on('baselayerchange', function (e) {
        userSettings.baseMaps = e.name;
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

    map.createPane('gpxTrackPane');
    map.getPane('gpxTrackPane').style.zIndex = 650;
    map.getPane('tooltipPane').style.zIndex = 700;
    map.getPane('popupPane').style.zIndex = 700;

    livePositionControl = L.control.livePosition({ position: 'bottomright' }).addTo(map);
    if (livePositionControl._container) {
        livePositionControl._container.style.display = 'none';
        console.log('Initialized livePositionControl and hid by default');
    } else {
        console.warn('livePositionControl._container not initialized in initMap');
    }

    async function fetchInitialWeather(lat, lng) {
        const lastFullHourUTC = getLastFullHourUTC();
        let utcIsoString;
        try {
            utcIsoString = lastFullHourUTC.toISOString();
            console.log('initMap: Last full hour UTC:', utcIsoString);
        } catch (error) {
            console.error('Failed to get UTC time:', error);
            // Fallback to current time rounded to the last full hour
            const now = new Date();
            now.setMinutes(0, 0, 0); // Round to the last full hour
            utcIsoString = now.toISOString();
            console.log('initMap: Fallback to current time:', utcIsoString);
        }

        let initialTime;
        if (userSettings.timeZone === 'Z') {
            initialTime = utcIsoString.replace(':00.000Z', 'Z');
        } else {
            try {
                const localTimeStr = await Utils.formatLocalTime(utcIsoString, lat, lng);
                console.log('initMap: Local time string:', localTimeStr);

                // Validate localTimeStr and parse it (expected format: YYYY-MM-DD HHmm GMT+X)
                if (!localTimeStr || typeof localTimeStr !== 'string') {
                    throw new Error(`Invalid local time string: ${localTimeStr}`);
                }

                // Parse the string: e.g., "2025-05-02 2200 GMT+2"
                const match = localTimeStr.match(/^(\d{4}-\d{2}-\d{2}) (\d{2})(\d{2}) GMT([+-]\d+)/);
                if (!match) {
                    throw new Error(`Local time string format mismatch: ${localTimeStr}`);
                }

                const [, datePart, hour, minute, offset] = match;
                // Format offset as +HH:MM (e.g., +2 becomes +02:00)
                const offsetSign = offset.startsWith('+') ? '+' : '-';
                const offsetHours = Math.abs(parseInt(offset, 10)).toString().padStart(2, '0');
                const formattedOffset = `${offsetSign}${offsetHours}:00`;
                const isoFormatted = `${datePart}T${hour}:${minute}:00${formattedOffset}`;
                console.log('initMap: ISO formatted local time:', isoFormatted);

                // Create localDate in UTC by accounting for the offset
                const localDate = new Date(isoFormatted);
                if (isNaN(localDate.getTime())) {
                    throw new Error(`Failed to parse localDate from ${isoFormatted}`);
                }

                // Log the UTC equivalent of the local time
                const localDateUtc = localDate.toISOString();
                console.log('initMap: Local time in UTC:', localDateUtc);

                // Do not subtract 2 hours; use the local time as-is (in UTC)
                initialTime = localDateUtc.replace(':00.000Z', 'Z');
            } catch (error) {
                console.error('Error converting to local time:', error);
                // Fallback to UTC time if local time conversion fails
                initialTime = utcIsoString.replace(':00.000Z', 'Z');
                console.log('initMap: Falling back to UTC time:', initialTime);
            }
        }

        console.log('initMap: initialTime:', initialTime);
        await fetchWeatherForLocation(lat, lng, initialTime, true);
    }

    const initialAltitude = 'N/A';
    configureMarker(defaultCenter[0], defaultCenter[1], initialAltitude, false);
    isManualPanning = false;

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const userCoords = [position.coords.latitude, position.coords.longitude];
                lastLat = position.coords.latitude;
                lastLng = position.coords.longitude;
                lastAltitude = await getAltitude(lastLat, lastLng);

                configureMarker(lastLat, lastLng, lastAltitude, false);
                map.setView(userCoords, defaultZoom);

                if (userSettings.calculateJump) {
                    calculateJump();
                    calculateCutAway();
                }
                recenterMap(true);
                isManualPanning = false;

                await fetchInitialWeather(lastLat, lastLng);

                if (userSettings.trackPosition) {
                    setCheckboxValue('trackPositionCheckbox', true);
                    startPositionTracking();
                }
            },
            async (error) => {
                console.warn(`Geolocation error: ${error.message}`);
                Utils.handleError('Unable to retrieve your location. Using default location.');
                lastLat = defaultCenter[0];
                lastLng = defaultCenter[1];
                lastAltitude = await getAltitude(lastLat, lastLng);
                configureMarker(lastLat, lastLng, lastAltitude, false);
                map.setView(defaultCenter, defaultZoom);
                recenterMap(true);
                isManualPanning = false;

                await fetchInitialWeather(lastLat, lastLng);

                if (userSettings.trackPosition) {
                    Utils.handleError('Tracking disabled due to geolocation failure.');
                    setCheckboxValue('trackPositionCheckbox', false);
                    userSettings.trackPosition = false;
                    saveSettings();
                }
            },
            {
                enableHighAccuracy: true,
                timeout: 20000,
                maximumAge: 0
            }
        );
    } else {
        console.warn('Geolocation not supported.');
        Utils.handleError('Geolocation not supported. Using default location.');
        lastLat = defaultCenter[0];
        lastLng = defaultCenter[1];
        lastAltitude = getAltitude(lastLat, lastLng);
        configureMarker(lastLat, lastLng, initialAltitude, false);
        map.setView(defaultCenter, defaultZoom);
        recenterMap(true);
        isManualPanning = false;

        fetchInitialWeather(lastLat, lastLng);

        if (userSettings.trackPosition) {
            Utils.handleError('Tracking disabled: Geolocation not supported.');
            setCheckboxValue('trackPositionCheckbox', false);
            userSettings.trackPosition = false;
            saveSettings();
        }
    }

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

    const elevationCache = new Map();

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

    let lastMouseLatLng = null;

    map.on('mousemove', function (e) {
        const coordFormat = getCoordinateFormat();
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        lastMouseLatLng = { lat, lng };

        let coordText;
        if (coordFormat === 'MGRS') {
            const mgrs = Utils.decimalToMgrs(lat, lng);
            coordText = `MGRS: ${mgrs}`;
        } else {
            coordText = `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;
        }

        coordsControl.update(`${coordText}<br>Elevation: Fetching...`);

        debouncedGetElevation(lat, lng, { lat, lng }, (elevation, requestLatLng) => {
            if (lastMouseLatLng) {
                const deltaLat = Math.abs(lastMouseLatLng.lat - requestLatLng.lat);
                const deltaLng = Math.abs(lastMouseLatLng.lng - requestLatLng.lng);
                const threshold = 0.05;
                if (deltaLat < threshold && deltaLng < threshold) {
                    const heightUnit = getHeightUnit();
                    let displayElevation = elevation === 'N/A' ? 'N/A' : elevation;
                    if (displayElevation !== 'N/A') {
                        displayElevation = Utils.convertHeight(displayElevation, heightUnit);
                        displayElevation = Math.round(displayElevation);
                    }
                    console.log('Updating elevation display:', { lat: requestLatLng.lat, lng: requestLatLng.lng, elevation, heightUnit, displayElevation });
                    coordsControl.update(`${coordText}<br>Elevation: ${displayElevation} ${displayElevation === 'N/A' ? '' : heightUnit}`);
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

    map.on('movestart', (e) => {
        // Only set isManualPanning if not dragging a marker
        if (!e.target.dragging || !e.target.dragging._marker) {
            isManualPanning = true;
            console.log('Manual panning detected, isManualPanning set to true');
        }
    });

    map.on('mouseout', function () {
        coordsControl.getContainer().innerHTML = 'Move mouse over map';
    });

    map.on('contextmenu', (e) => {
        if (!userSettings.showCutAwayFinder || !userSettings.calculateJump) {
            console.log('Cut-away marker placement ignored: showCutAwayFinder or calculateJump not enabled');
            return;
        }
        const { lat, lng } = e.latlng;
        console.log('Right-click: Placing/moving cut-away marker at:', { lat, lng });

        if (cutAwayMarker) {
            cutAwayMarker.setLatLng([lat, lng]);
        } else {
            cutAwayMarker = createCutAwayMarker(lat, lng).addTo(map);
            attachCutAwayMarkerDragend(cutAwayMarker);
        }

        cutAwayLat = lat;
        cutAwayLng = lng;

        updateCutAwayMarkerPopup(cutAwayMarker, lat, lng);

        if (weatherData && userSettings.calculateJump) {
            console.log('Recalculating cut-away for marker placement');
            calculateCutAway();
        }
    });

    map.on('dblclick', async (e) => {
        const { lat, lng } = e.latlng;
        lastLat = lat;
        lastLng = lng;
        lastAltitude = await getAltitude(lat, lng);
        console.log('Map double-clicked, moving marker to:', { lat, lng });

        configureMarker(lastLat, lastLng, lastAltitude, false);
        resetJumpRunDirection(true);
        if (userSettings.calculateJump) {
            console.log('Recalculating jump for marker click');
            calculateJump();
            calculateCutAway();
        }
        recenterMap(true);
        isManualPanning = false;

        const slider = document.getElementById('timeSlider');
        const currentIndex = parseInt(slider.value) || 0;
        const currentTime = weatherData?.time?.[currentIndex] || null;

        await fetchWeatherForLocation(lat, lng, currentTime);

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
            calculateJump();
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
            updateMarkerPopup(currentMarker, lastLat, lastLng, lastAltitude, currentMarker.getPopup()?.isOpen() || false);
        }

        if (jumpRunTrackLayer && userSettings.showJumpRunTrack) {
            const anchorMarker = jumpRunTrackLayer.getLayers().find(layer => layer.options.icon?.options.className === 'jrt-anchor-marker');
            if (anchorMarker) {
                const baseSize = currentZoom <= 11 ? 10 : currentZoom <= 12 ? 12 : currentZoom <= 13 ? 14 : 16;
                const newIcon = L.divIcon({
                    className: 'jrt-anchor-marker',
                    html: `<div style="background-color: orange; width: ${baseSize}px; height: ${baseSize}px; border-radius: 50%; border: 2px solid white; opacity: 0.8;"></div>`,
                    iconSize: [baseSize, baseSize],
                    iconAnchor: [baseSize / 2, baseSize / 2],
                    tooltipAnchor: [0, -(baseSize / 2 + 5)]
                });
                anchorMarker.setIcon(newIcon);
                console.log('Updated anchor marker size for zoom:', { zoom: currentZoom, size: baseSize });
            }
        }
    });

    let lastTapTime = 0;
    const tapThreshold = 300;
    const mapContainer = map.getContainer();

    mapContainer.addEventListener('touchstart', async (e) => {
        console.log('Map touchstart event, target:', e.target, 'touches:', e.touches.length);
        if (e.touches.length !== 1 || e.target.closest('.leaflet-marker-icon')) {
            console.log('Ignoring map touchstart: multiple touches or marker target');
            return;
        }

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
            configureMarker(lastLat, lastLng, lastAltitude, false);
            resetJumpRunDirection(true);
            if (userSettings.calculateJump) {
                calculateJump();
                calculateCutAway();
            }
            recenterMap(true);
            isManualPanning = false;

            const slider = document.getElementById('timeSlider');
            const currentIndex = parseInt(slider.value) || 0;
            const currentTime = weatherData?.time?.[currentIndex] || null;
            await fetchWeatherForLocation(lastLat, lastLng, currentTime);
        }
        lastTapTime = currentTime;
    }, { passive: false });

    map.on('click', (e) => {
        console.log('Map click event, target:', e.originalEvent.target);
    });

    map.on('mousedown', (e) => {
        console.log('Map mousedown event, target:', e.originalEvent.target);
    });

    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const menu = document.getElementById('menu');
    if (hamburgerBtn && menu) {
        hamburgerBtn.addEventListener('click', () => {
            const isMenuOpen = !menu.classList.contains('hidden');
            document.querySelector('.leaflet-container').style.pointerEvents = isMenuOpen ? 'none' : 'auto';
            console.log('Map pointer events set to:', isMenuOpen ? 'none' : 'auto');
        });
    }

    initializeApp();
}
function handleHarpPlacement(e) {
    if (!isPlacingHarp) return;
    const { lat, lng } = e.latlng;
    if (harpMarker) {
        harpMarker.setLatLng([lat, lng]);
        console.log('Updated HARP marker position:', { lat, lng });
    } else {
        harpMarker = createHarpMarker(lat, lng).addTo(map);
        console.log('Placed new HARP marker:', { lat, lng });
    }
    userSettings.harpLat = lat;
    userSettings.harpLng = lng;
    saveSettings();
    isPlacingHarp = false;
    map.off('click', handleHarpPlacement);
    console.log('HARP placement mode deactivated');
    // Enable HARP radio button
    const harpRadio = document.querySelector('input[name="jumpMasterLineTarget"][value="HARP"]');
    if (harpRadio) {
        harpRadio.disabled = false;
        console.log('Enabled HARP radio button');
    }
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
function createCutAwayMarker(lat, lng) {
    const cutAwayIcon = L.icon({
        iconUrl: 'schere_purple.png', // Use a different icon if available
        iconSize: [25, 25],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32],
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        shadowSize: [41, 41],
        shadowAnchor: [13, 32],
        className: 'cutaway-marker' // For CSS styling (e.g., different color)
    });
    return L.marker([lat, lng], {
        icon: cutAwayIcon,
        draggable: true
    });
}
function createHarpMarker(latitude, longitude) {
    const marker = L.marker([latitude, longitude], {
        icon: L.divIcon({
            className: 'harp-marker',
            html: '<div style="background-color: green; width: 10px; height: 10px; border-radius: 50%;"></div>',
            iconSize: [10, 10],
            iconAnchor: [5, 5]
        }),
        pane: 'markerPane' // Use standard marker pane
    });
    console.log('Created HARP marker at:', { latitude, longitude });
    return marker;
}
function clearHarpMarker() {
    if (harpMarker) {
        map.removeLayer(harpMarker);
        harpMarker = null;
        console.log('Removed HARP marker');
    }
    userSettings.harpLat = null;
    userSettings.harpLng = null;
    saveSettings();
    const harpRadio = document.querySelector('input[name="jumpMasterLineTarget"][value="HARP"]');
    if (harpRadio) {
        harpRadio.disabled = true;
        console.log('Disabled HARP radio button');
    }
    // If Jump Master Line is set to HARP, remove it or switch to DIP
    if (userSettings.jumpMasterLineTarget === 'HARP' && userSettings.showJumpMasterLine) {
        if (jumpMasterLine) {
            map.removeLayer(jumpMasterLine);
            jumpMasterLine = null;
            console.log('Removed Jump Master Line: HARP marker cleared');
        }
        // Switch to DIP
        userSettings.jumpMasterLineTarget = 'DIP';
        const dipRadio = document.querySelector('input[name="jumpMasterLineTarget"][value="DIP"]');
        if (dipRadio) {
            dipRadio.checked = true;
            console.log('Switched Jump Master Line to DIP');
        }
        saveSettings();
        // Update line if live tracking is active
        if (liveMarker && currentMarker && lastLat !== null && lastLng !== null) {
            debouncedPositionUpdate({
                coords: {
                    latitude: lastLatitude,
                    longitude: lastLongitude,
                    accuracy: lastAccuracy,
                    altitude: lastDeviceAltitude,
                    altitudeAccuracy: lastAltitudeAccuracy
                }
            });
        }
    }
    Utils.handleMessage('HARP marker cleared');
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
            debouncedCalculateJump(); // Use debounced version
            calculateCutAway();
        }
        recenterMap(true); // Force recenter after fallback
        isManualPanning = false; // Reset after marker placement
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
function attachCutAwayMarkerDragend(marker) {
    marker.on('dragend', (e) => {
        const position = marker.getLatLng();
        cutAwayLat = position.lat;
        cutAwayLng = position.lng;
        console.log('Cut-away marker dragged to:', { lat: cutAwayLat, lng: cutAwayLng });
        updateCutAwayMarkerPopup(marker, cutAwayLat, cutAwayLng);
        if (userSettings.showCutAwayFinder && userSettings.calculateJump && weatherData) {
            console.log('Recalculating cut-away for marker drag');
            debouncedCalculateJump(); // Use debounced version
            calculateCutAway();
        }
    });
}
async function updateMarkerPopup(marker, lat, lng, altitude, open = false) {
    console.log('Updating marker popup:', { lat, lng, altitude, format: getCoordinateFormat(), open });
    const coordFormat = getCoordinateFormat();
    const coords = Utils.convertCoords(lat, lng, coordFormat);
    const sliderIndex = getSliderValue();

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

    // Unbind existing popup to avoid conflicts
    marker.unbindPopup();
    marker.bindPopup(popupContent);
    console.log('Popup rebound with content:', popupContent);

    if (open) {
        console.log('Attempting to open popup');
        marker.openPopup();
        const isOpen = marker.getPopup()?.isOpen();
        console.log('Popup open status after openPopup():', isOpen);
        if (!isOpen) {
            console.warn('Popup failed to open, retrying');
            marker.openPopup(); // Retry to ensure visibility
        }
    }
}
function updateCutAwayMarkerPopup(marker, lat, lng, open = false) {
    const coordFormat = getCoordinateFormat();
    const coords = Utils.convertCoords(lat, lng, coordFormat);
    let popupContent = `<b>Cut-Away Start</b><br>`;
    if (coordFormat === 'MGRS') {
        popupContent += `MGRS: ${coords.lat}`;
    } else {
        popupContent += `Lat: ${coords.lat}<br>Lng: ${coords.lng}`;
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
function recenterMap(force = false) {
    if (isLoadingGpx) {
        console.log('Skipping recenterMap during GPX loading');
        return;
    }
    if (isManualPanning && !force) {
        console.log('Skipping recenterMap due to manual panning');
        return;
    }
    if (map && currentMarker) {
        map.invalidateSize();
        map.panTo(currentMarker.getLatLng());
        console.log('Map recentered on marker at:', currentMarker.getLatLng());
    } else {
        console.warn('Cannot recenter map: map or marker not defined');
    }
}
function initializeMap() {
    console.log('Initializing map...');
    initMap();
}
function interpolateColor(aglHeight, minHeight = 0, maxHeight = 3000) {
    // Map AGL height (0m to 3000m) to a color gradient: red (high) -> yellow (mid) -> green (low)
    const ratio = Math.min(Math.max((aglHeight - minHeight) / (maxHeight - minHeight), 0), 1);
    if (aglHeight < 0 || isNaN(aglHeight)) return '#808080'; // Gray for invalid/negative heights
    // Linear interpolation between colors
    if (ratio <= 0.5) {
        // Red (#FF0000) to Yellow (#FFFF00)
        const r = 255;
        const g = Math.round(255 * (ratio * 2));
        const b = 0;
        return `rgb(${r}, ${g}, ${b})`;
    } else {
        // Yellow (#FFFF00) to Green (#00FF00)
        const r = Math.round(255 * (1 - (ratio - 0.5) * 2));
        const g = 255;
        const b = 0;
        return `rgb(${r}, ${g}, ${b})`;
    }
}
function getTooltipContent(point, index, points, groundAltitude, windUnit, heightUnit) {
    const coordFormat = getCoordinateFormat();
    const coords = Utils.convertCoords(point.lat, point.lng, coordFormat);
    //let tooltipContent = coordFormat === 'MGRS' ? `MGRS: ${coords.lat}` : `Lat: ${coords.lat}<br>Lng: ${coords.lng}`;
    const elevation = point.ele;
    let aglHeight = (elevation !== null && groundAltitude !== null) ? (elevation - groundAltitude) : null;
    if (aglHeight !== null) {
        // Use userSettings.heightUnit as fallback if heightUnit is undefined
        const effectiveHeightUnit = heightUnit || userSettings.heightUnit || 'm';
        aglHeight = Utils.convertHeight(aglHeight, effectiveHeightUnit);
        aglHeight = Math.round(aglHeight);
        tooltipContent = `Altitude: ${aglHeight} ${effectiveHeightUnit} AGL`;
    } else {
        tooltipContent = `Altitude: N/A`;
    }
    let speed = 'N/A';
    let descentRate = 'N/A';
    if (index > 0 && point.time && points[index - 1].time && point.ele !== null && points[index - 1].ele !== null) {
        const timeDiff = (point.time.toMillis() - points[index - 1].time.toMillis()) / 1000; // seconds
        if (timeDiff > 0) {
            const distance = map.distance([points[index - 1].lat, points[index - 1].lng], [point.lat, point.lng]);
            const speedMs = distance / timeDiff;
            speed = Utils.convertWind(speedMs, windUnit, 'm/s');
            speed = windUnit === 'bft' ? Math.round(speed) : speed.toFixed(1);
            const eleDiff = point.ele - points[index - 1].ele;
            descentRate = (eleDiff / timeDiff).toFixed(1);
        }
    }
    tooltipContent += `<br>Speed: ${speed} ${windUnit}`;
    tooltipContent += `<br>Descent Rate: ${descentRate} m/s`;
    return tooltipContent;
}
function loadGpxTrack(file) {
    if (!file) {
        Utils.handleError('No file selected.');
        return;
    }
    isLoadingGpx = true;
    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const gpxData = e.target.result;
            if (gpxLayer) {
                map.removeLayer(gpxLayer);
                gpxLayer = null;
            }
            gpxPoints = [];
            const parser = new DOMParser();
            const xml = parser.parseFromString(gpxData, 'text/xml');
            const trackpoints = xml.getElementsByTagName('trkpt');
            const points = [];
            for (let i = 0; i < trackpoints.length; i++) {
                const lat = parseFloat(trackpoints[i].getAttribute('lat'));
                const lng = parseFloat(trackpoints[i].getAttribute('lon'));
                if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                    console.warn('Invalid trackpoint coordinates:', { lat, lng, index: i });
                    continue;
                }
                const ele = trackpoints[i].getElementsByTagName('ele')[0]?.textContent;
                const time = trackpoints[i].getElementsByTagName('time')[0]?.textContent;
                points.push({
                    lat: lat,
                    lng: lng,
                    ele: ele ? parseFloat(ele) : null,
                    time: time ? luxon.DateTime.fromISO(time, { zone: 'utc' }) : null
                });
            }
            if (points.length < 2) {
                throw new Error('GPX track has insufficient points.');
            }
            gpxPoints = points;

            // Move marker to final point and update lastAltitude
            if (points.length > 0) {
                const finalPoint = points[points.length - 1];
                lastLat = finalPoint.lat;
                lastLng = finalPoint.lng;
                lastAltitude = await getAltitude(lastLat, lastLng); // Fetch terrain altitude for final point
                console.log('Moved marker to final GPX point:', { lat: lastLat, lng: lastLng, lastAltitude });

                // Update marker position
                configureMarker(lastLat, lastLng, lastAltitude, false);
                isManualPanning = false;

                // Trigger weather fetch and jump calculations
                let timestampToUse = null;
                if (points[0].time && points[0].time.isValid) {
                    const initialTimestamp = points[0].time;
                    console.log('GPX initial timestamp:', initialTimestamp.toISO());
                    const today = luxon.DateTime.utc().startOf('day');
                    const trackDate = initialTimestamp.startOf('day');
                    const isToday = trackDate.hasSame(today, 'day');

                    // Round to nearest hour
                    let roundedTimestamp = initialTimestamp.startOf('hour');
                    if (initialTimestamp.minute >= 30) {
                        roundedTimestamp = roundedTimestamp.plus({ hours: 1 });
                    }
                    console.log('GPX rounded timestamp:', roundedTimestamp.toISO());
                    timestampToUse = roundedTimestamp.toISO();

                    if (!isToday) {
                        // Set historical date for past tracks
                        const historicalDatePicker = document.getElementById('historicalDatePicker');
                        if (historicalDatePicker) {
                            historicalDatePicker.value = trackDate.toFormat('yyyy-MM-dd');
                            console.log('Set historicalDatePicker to:', historicalDatePicker.value);
                        } else {
                            console.warn('historicalDatePicker not found, cannot set historical date');
                            Utils.handleError('Cannot fetch historical weather: date picker not found.');
                        }
                    }
                } else {
                    console.warn('No valid timestamp in GPX track, using current time for weather');
                }

                await fetchWeatherForLocation(lastLat, lastLng, timestampToUse);
                if (userSettings.calculateJump) {
                    debouncedCalculateJump();
                    calculateCutAway();
                }
                if (userSettings.showJumpRunTrack) {
                    updateJumpRunTrack();
                }
                if (userSettings.showLandingPattern) {
                    updateLandingPattern();
                }
            }

            // Create GPX layer with custom pane
            gpxLayer = L.layerGroup({ pane: 'gpxTrackPane' });
            const groundAltitude = lastAltitude !== 'N/A' && !isNaN(lastAltitude) ? parseFloat(lastAltitude) : null;
            const windUnit = getWindSpeedUnit();
            const heightUnit = getHeightUnit();
            for (let i = 0; i < points.length - 1; i++) {
                const p1 = points[i];
                const p2 = points[i + 1];
                const ele1 = p1.ele;
                const ele2 = p2.ele;
                let color = '#808080';
                if (groundAltitude !== null && ele1 !== null && ele2 !== null) {
                    const agl1 = ele1 - groundAltitude;
                    const agl2 = ele2 - groundAltitude;
                    const avgAgl = (agl1 + agl2) / 2;
                    color = interpolateColor(avgAgl);
                }
                const segment = L.polyline([[p1.lat, p1.lng], [p2.lat, p2.lng]], {
                    color: color,
                    weight: 4,
                    opacity: 0.75,
                    pane: 'gpxTrackPane'
                }).bindTooltip('', { sticky: true });
                segment.on('mousemove', function (e) {
                    const latlng = e.latlng;
                    let closestPoint = points[0];
                    let minDist = Infinity;
                    let closestIndex = 0;
                    points.forEach((p, index) => {
                        const dist = Math.sqrt(Math.pow(p.lat - latlng.lat, 2) + Math.pow(p.lng - latlng.lng, 2));
                        if (dist < minDist) {
                            minDist = dist;
                            closestPoint = p;
                            closestIndex = index;
                        }
                    });
                    segment.setTooltipContent(getTooltipContent(closestPoint, closestIndex, points, groundAltitude, getWindSpeedUnit(), getHeightUnit())).openTooltip(latlng);
                });
                gpxLayer.addLayer(segment);
            }
            gpxLayer.addTo(map);
            console.log('GPX layer added:', { gpxLayer });

            // Center map to track bounds
            if (points.length > 0) {
                const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]));
                if (bounds.isValid()) {
                    map.invalidateSize();
                    map.fitBounds(bounds, { padding: [50, 50], maxZoom: maxZoom });
                    console.log('Map fitted to GPX track bounds:', { bounds: bounds.toBBoxString() });
                } else {
                    console.warn('Invalid GPX track bounds:', { points });
                    Utils.handleError('Unable to display GPX track: invalid coordinates.');
                }
            }

            // Display track info
            const distance = (points.reduce((dist, p, i) => {
                if (i === 0) return 0;
                const prev = points[i - 1];
                return dist + map.distance([prev.lat, prev.lng], [p.lat, p.lng]);
            }, 0) / 1000).toFixed(2);
            const elevations = points.map(p => p.ele).filter(e => e !== null);
            const elevationMin = elevations.length ? Math.min(...elevations).toFixed(0) : 'N/A';
            const elevationMax = elevations.length ? Math.max(...elevations).toFixed(0) : 'N/A';
            document.getElementById('info').innerHTML += `<br><strong>GPX Track:</strong> Distance: ${distance} km, Min Elevation: ${elevationMin} m, Max Elevation: ${elevationMax} m`;
        } catch (error) {
            console.error('Error in loadGpxTrack:', error);
            Utils.handleError('Error parsing GPX file: ' + error.message);
        } finally {
            isLoadingGpx = false;
        }
    };
    reader.onerror = function () {
        Utils.handleError('Error reading GPX file.');
        isLoadingGpx = false;
    };
    reader.readAsText(file);
}

// == Live Tracking Handling ==
const debouncedPositionUpdate = debounce(async (position) => {
    const { latitude, longitude, accuracy, altitude: deviceAltitude, altitudeAccuracy } = position.coords;
    const currentTime = new Date().getTime() / 1000;
    console.log('Debounced position update:', { latitude, longitude, accuracy, deviceAltitude, altitudeAccuracy, currentTime });

    // Optional: Filter out low-accuracy updates
    if (accuracy > 30) {
        console.log('Skipping position update due to low accuracy:', { accuracy });
        return;
    }

    let speed = 'N/A';
    let speedMs = 0;
    let effectiveWindUnit = getWindSpeedUnit();
    if (effectiveWindUnit === 'bft') {
        effectiveWindUnit = 'kt';
    }
    let direction = 'N/A';
    if (prevLat !== null && prevLng !== null && prevTime !== null) {
        const distance = map.distance([prevLat, prevLng], [latitude, longitude]);
        const timeDiff = currentTime - prevTime;
        if (timeDiff > 0) {
            speedMs = distance / timeDiff; // Speed in meters/second
            // Apply EMA smoothing with dynamic alpha
            const alpha = speedMs < 25 ? 0.5 : 0.2; // Responsive at low speeds, stable at high speeds
            lastSmoothedSpeedMs = alpha * speedMs + (1 - alpha) * lastSmoothedSpeedMs;
            speed = Utils.convertWind(lastSmoothedSpeedMs, effectiveWindUnit, 'm/s');
            speed = effectiveWindUnit === 'bft' ? Math.round(speed) : speed.toFixed(1);
            direction = calculateBearing(prevLat, prevLng, latitude, longitude).toFixed(0);
            //Direction smoothing (optional)
            /*let lastSmoothedDirection = 0; // Global variable
            direction = alpha * calculateBearing(...) + (1 - alpha) * lastSmoothedDirection;
            lastSmoothedDirection = direction;*/
            console.log('Calculated speed:', { rawSpeedMs: speedMs, smoothedSpeedMs: lastSmoothedSpeedMs, convertedSpeed: speed, unit: effectiveWindUnit, alpha });
        }
    }

    if (!liveMarker) {
        liveMarker = createLiveMarker(latitude, longitude).addTo(map);
        console.log('Created new liveMarker at:', { latitude, longitude });
    } else {
        if (!map.hasLayer(liveMarker)) {
            liveMarker.addTo(map);
            console.log('Re-added liveMarker to map:', { latitude, longitude });
        }
        requestAnimationFrame(() => {
            liveMarker.setLatLng([latitude, longitude]);
            console.log('Updated liveMarker to:', { latitude, longitude });
        });
    }

    if (accuracy && Number.isFinite(accuracy) && accuracy > 0) {
        updateAccuracyCircle(latitude, longitude, accuracy);
    } else {
        console.warn('Skipping accuracy circle update: invalid accuracy', { accuracy });
        if (window.accuracyCircle) {
            map.removeLayer(window.accuracyCircle);
            window.accuracyCircle = null;
            console.log('Removed accuracy circle');
        }
    }

    let jumpMasterLineData = null;
    if (userSettings.showJumpMasterLine && liveMarker) {
        let targetMarker = null;
        let targetLat = null;
        let targetLng = null;
        if (userSettings.jumpMasterLineTarget === 'DIP' && currentMarker && lastLat !== null && lastLng !== null) {
            targetMarker = currentMarker;
            targetLat = lastLat;
            targetLng = lastLng;
        } else if (userSettings.jumpMasterLineTarget === 'HARP' && harpMarker && userSettings.harpLat !== null && userSettings.harpLng !== null) {
            targetMarker = harpMarker;
            targetLat = userSettings.harpLat;
            targetLng = userSettings.harpLng;
        }

        if (targetMarker) {
            try {
                const liveLatLng = liveMarker.getLatLng();
                const targetLatLng = targetMarker.getLatLng();
                const bearing = calculateBearing(liveLatLng.lat, liveLatLng.lng, targetLatLng.lat, targetLatLng.lng).toFixed(0);
                const distanceMeters = map.distance(liveLatLng, targetLatLng);
                const heightUnit = getHeightUnit();
                const convertedDistance = Utils.convertHeight(distanceMeters, heightUnit);
                const roundedDistance = Math.round(convertedDistance);

                let totDisplay = 'N/A';
                if (lastSmoothedSpeedMs > 0) {
                    const totSeconds = distanceMeters / lastSmoothedSpeedMs;
                    totDisplay = Math.round(totSeconds);
                    console.log('Calculated TOT:', { distanceMeters, smoothedSpeedMs: lastSmoothedSpeedMs, totSeconds, totDisplay });
                } else {
                    console.log('TOT set to N/A: invalid or zero speed', { smoothedSpeedMs: lastSmoothedSpeedMs });
                }

                jumpMasterLineData = {
                    target: userSettings.jumpMasterLineTarget,
                    bearing,
                    distance: roundedDistance,
                    tot: totDisplay,
                    heightUnit
                };

                if (jumpMasterLine) {
                    jumpMasterLine.setLatLngs([[liveLatLng.lat, liveLatLng.lng], [targetLatLng.lat, targetLatLng.lng]]);
                    console.log(`Updated Jump Master Line to ${userSettings.jumpMasterLineTarget}:`, { bearing, distance: roundedDistance, unit: heightUnit, tot: totDisplay });
                } else {
                    jumpMasterLine = L.polyline([[liveLatLng.lat, liveLatLng.lng], [targetLatLng.lat, targetLatLng.lng]], {
                        color: 'blue',
                        weight: 3,
                        opacity: 0.8,
                        dashArray: '5, 5'
                    }).addTo(map);
                    console.log(`Created Jump Master Line to ${userSettings.jumpMasterLineTarget}:`, { bearing, distance: roundedDistance, unit: heightUnit, tot: totDisplay });
                }
            } catch (error) {
                console.error('Error updating Jump Master Line:', error);
            }
        } else {
            if (jumpMasterLine) {
                map.removeLayer(jumpMasterLine);
                jumpMasterLine = null;
                console.log(`Removed Jump Master Line: no valid target (${userSettings.jumpMasterLineTarget})`);
            }
        }
    } else {
        if (jumpMasterLine) {
            map.removeLayer(jumpMasterLine);
            jumpMasterLine = null;
            console.log('Removed Jump Master Line: disabled or no liveMarker');
        }
    }

    if (livePositionControl) {
        livePositionControl.update(
            latitude,
            longitude,
            deviceAltitude,
            altitudeAccuracy,
            accuracy,
            speed,
            effectiveWindUnit,
            direction,
            userSettings.showJumpMasterLine,
            jumpMasterLineData
        );
        console.log('Updated livePositionControl content:', {
            latitude,
            longitude,
            deviceAltitude,
            altitudeAccuracy,
            accuracy,
            speed,
            effectiveWindUnit,
            direction,
            showJumpMasterLine: userSettings.showJumpMasterLine,
            jumpMasterLineData
        });
        livePositionControl._container.style.display = 'block';
        livePositionControl._container.style.opacity = '1';
        livePositionControl._container.style.visibility = 'visible';
    } else {
        console.warn('livePositionControl not initialized in debouncedPositionUpdate');
    }

    lastLatitude = latitude;
    lastLongitude = longitude;
    lastDeviceAltitude = deviceAltitude;
    lastAltitudeAccuracy = altitudeAccuracy;
    lastAccuracy = accuracy;
    lastSpeed = speed;
    lastEffectiveWindUnit = effectiveWindUnit;
    lastDirection = direction;
    console.log('Stored last position data:', { lastLatitude, lastLongitude, lastDeviceAltitude, lastAltitudeAccuracy, lastAccuracy, lastSpeed, lastEffectiveWindUnit, lastDirection });

    prevLat = latitude;
    prevLng = longitude;
    prevTime = currentTime;
}, 300);
L.Control.LivePosition = L.Control.extend({
    options: {
        position: 'bottomright'
    },
    onAdd: function (map) {
        const container = L.DomUtil.create('div', 'leaflet-control-live-position');
        container.style.display = 'block';
        container.style.zIndex = '600';
        container.innerHTML = 'Initializing live position...';
        this._container = container;
        console.log('LivePosition control added to map', { styles: container.style });
        return container;
    },
    update: function (lat, lng, deviceAltitude, altitudeAccuracy, accuracy, speed, effectiveWindUnit, direction, showJumpMasterLine, jumpMasterLineData) {
        try {
            const coordFormat = getCoordinateFormat();
            const coords = Utils.convertCoords(lat, lng, coordFormat);
            const heightUnit = getHeightUnit();
            const refLevel = getSettingValue('refLevel', 'radio', 'AGL');
            let content = `<span style="font-weight: bold;">Live Position</span><br>`;
            if (coordFormat === 'MGRS') {
                content += `MGRS: ${coords.lat}<br>`;
            } else {
                content += `Lat: ${coords.lat}<br>Lng: ${coords.lng}<br>`;
            }
            if (deviceAltitude !== null && deviceAltitude !== undefined) {
                let displayAltitude;
                let displayRefLevel = refLevel;
                if (refLevel === 'AGL' && lastAltitude !== null && !isNaN(lastAltitude)) {
                    displayAltitude = deviceAltitude - parseFloat(lastAltitude);
                    displayRefLevel = 'abv DIP';
                } else {
                    displayAltitude = deviceAltitude;
                }
                const convertedAltitude = Utils.convertHeight(displayAltitude, heightUnit);
                const convertedAltitudeAccuracy = altitudeAccuracy && Number.isFinite(altitudeAccuracy) && altitudeAccuracy > 0
                    ? Utils.convertHeight(altitudeAccuracy, heightUnit)
                    : 'N/A';
                content += `Altitude: ${Math.round(convertedAltitude)} ${heightUnit} ${displayRefLevel} (±${convertedAltitudeAccuracy !== 'N/A' ? Math.round(convertedAltitudeAccuracy) : 'N/A'} ${convertedAltitudeAccuracy !== 'N/A' ? heightUnit : ''})<br>`;
            } else {
                content += `Altitude: N/A<br>`;
            }
            const convertedAccuracy = accuracy && Number.isFinite(accuracy) ? Utils.convertHeight(accuracy, heightUnit) : 'N/A';
            content += `Accuracy: ${convertedAccuracy !== 'N/A' ? Math.round(convertedAccuracy) : 'N/A'} ${convertedAccuracy !== 'N/A' ? heightUnit : ''}<br>`;
            content += `Speed: ${speed} ${effectiveWindUnit}<br>`;
            content += `Direction: ${direction}°`;

            if (showJumpMasterLine && jumpMasterLineData) {
                content += `<br><span style="font-weight: bold;">Jump Master Line to ${jumpMasterLineData.target}</span><br>`;
                content += `Bearing: ${jumpMasterLineData.bearing}°<br>`;
                content += `Distance: ${jumpMasterLineData.distance} ${jumpMasterLineData.heightUnit}<br>`;
                content += `TOT: X - ${jumpMasterLineData.tot} s`;
            }

            this._container.innerHTML = content;
            this._container.style.display = 'block';
            this._container.style.opacity = '1';
            this._container.style.visibility = 'visible';
            console.log('Updated livePositionControl content:', { content });
        } catch (error) {
            console.error('Error updating livePositionControl:', error);
            this._container.innerHTML = 'Error updating live position';
            this._container.style.display = 'block';
        }
    },
    onRemove: function (map) {
        console.log('LivePosition control removed from map');
    }
});
L.control.livePosition = function (opts) {
    return new L.Control.LivePosition(opts);
};
function createLiveMarker(lat, lng) {
    const marker = L.marker([lat, lng], {
        icon: L.divIcon({
            className: 'live-marker',
            html: '<div style="background-color: blue; width: 10px; height: 10px; border-radius: 50%;"></div>',
            iconSize: [10, 10],
            iconAnchor: [5, 5]
        }),
        zIndexOffset: 100
    });
    console.log('Created liveMarker:', { lat, lng });
    return marker;
}
function updateLiveMarkerPopup(marker, lat, lng, terrainAltitude, deviceAltitude, altitudeAccuracy, accuracy, speed, direction, open = false) {
    const coordFormat = getCoordinateFormat();
    const coords = Utils.convertCoords(lat, lng, coordFormat);
    const windUnit = getWindSpeedUnit();
    const heightUnit = getHeightUnit();
    let popupContent = `<b>Live Position</b><br>`;
    if (coordFormat === 'MGRS') {
        popupContent += `MGRS: ${coords.lat}<br>`;
    } else {
        popupContent += `Lat: ${coords.lat}<br>Lng: ${coords.lng}<br>`;
    }

    if (deviceAltitude !== null && deviceAltitude !== undefined) {
        const deviceAlt = Utils.convertHeight(deviceAltitude, heightUnit);
        popupContent += `Device Alt: ${Math.round(deviceAlt)} ${heightUnit} MSL (±${Math.round(altitudeAccuracy || 0)} m)<br>`;
        if (terrainAltitude !== 'N/A') {
            const agl = Utils.convertHeight(deviceAltitude - terrainAltitude, heightUnit);
            popupContent += `AGL: ${Math.round(agl)} ${heightUnit}<br>`;
        } else {
            popupContent += `AGL: N/A<br>`;
        }
    } else {
        popupContent += `Device Alt: N/A<br>`;
        popupContent += `AGL: N/A<br>`;
    }

    const terrainAlt = terrainAltitude !== 'N/A' ? Utils.convertHeight(terrainAltitude, heightUnit) : 'N/A';
    popupContent += `Terrain Alt: ${terrainAlt !== 'N/A' ? Math.round(terrainAlt) : 'N/A'} ${heightUnit}<br>`;

    popupContent += `Accuracy: ${Math.round(accuracy)} m<br>`;
    popupContent += `Speed: ${speed} ${windUnit}<br>`;
    popupContent += `Direction: ${direction}°`;

    // Rebind popup to ensure fresh state
    marker.unbindPopup();
    marker.bindPopup(popupContent);
    console.log('Rebound liveMarker popup with content:', { popupContent, open });

    marker._accuracy = accuracy;
    marker._speed = speed;
    marker._direction = direction;
    marker._deviceAltitude = deviceAltitude;
    marker._altitudeAccuracy = altitudeAccuracy;

    if (open) {
        console.log('Attempting to open liveMarker popup');
        marker.openPopup();
        const isOpen = marker.getPopup()?.isOpen();
        console.log('LiveMarker popup open status after openPopup():', isOpen);
        if (!isOpen) {
            console.warn('LiveMarker popup failed to open, retrying');
            marker.openPopup();
        }
    }
}
function updateLivePositionControl() {
    if (!livePositionControl || lastLatitude === null || lastLongitude === null) {
        console.log('Skipping livePositionControl update: no control or position data', { livePositionControl: !!livePositionControl, lastLatitude });
        return;
    }
    try {
        console.log('Updating livePositionControl with last position data');
        // Recalculate speed for current windUnit
        let newSpeed = lastSpeed;
        let newEffectiveWindUnit = getWindSpeedUnit();
        if (newEffectiveWindUnit === 'bft') {
            newEffectiveWindUnit = 'kt';
        }
        if (lastSpeed !== 'N/A' && Number.isFinite(parseFloat(lastSpeed))) {
            const speedMs = Utils.convertWind(parseFloat(lastSpeed), 'm/s', lastEffectiveWindUnit);
            newSpeed = Utils.convertWind(speedMs, newEffectiveWindUnit, 'm/s');
            newSpeed = newEffectiveWindUnit === 'bft' ? Math.round(newSpeed) : newSpeed.toFixed(1);
        }
        livePositionControl.update(
            lastLatitude,
            lastLongitude,
            lastDeviceAltitude,
            lastAltitudeAccuracy,
            lastAccuracy,
            newSpeed,
            newEffectiveWindUnit,
            lastDirection
        );
        lastSpeed = newSpeed;
        lastEffectiveWindUnit = newEffectiveWindUnit;
        console.log('Updated livePositionControl:', { newSpeed, newEffectiveWindUnit });
    } catch (error) {
        console.error('Error updating livePositionControl:', error);
    }
}
function startPositionTracking() {
    console.log('startPositionTracking called');
    if (!navigator.geolocation) {
        Utils.handleError('Geolocation not supported by your browser. Please use a device with location services.');
        setCheckboxValue('trackPositionCheckbox', false);
        userSettings.trackPosition = false;
        saveSettings();
        console.warn('Geolocation not supported');
        return;
    }

    if (!map) {
        Utils.handleError('Map not initialized. Please try again.');
        setCheckboxValue('trackPositionCheckbox', false);
        userSettings.trackPosition = false;
        saveSettings();
        console.warn('Map not initialized');
        return;
    }

    // Clear any existing watch to prevent conflicts
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        console.log('Cleared existing geolocation watch');
    }

    try {
        watchId = navigator.geolocation.watchPosition(
            (position) => {
                console.log('Geolocation position received:', position);
                debouncedPositionUpdate(position);
            },
            (error) => {
                console.error('Geolocation error:', error);
                Utils.handleError(`Geolocation error: ${error.message}`);
                setCheckboxValue('trackPositionCheckbox', false);
                userSettings.trackPosition = false;
                saveSettings();
                stopPositionTracking();
            },
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 10000
            }
        );
        console.log('Started geolocation watch with watchId:', watchId);

        // Ensure livePositionControl is visible
        if (livePositionControl) {
            livePositionControl._container.style.display = 'block';
            livePositionControl._container.style.opacity = '1';
            livePositionControl._container.style.visibility = 'visible';
            console.log('Ensured livePositionControl is visible');
        } else {
            console.warn('livePositionControl not initialized in startPositionTracking');
            livePositionControl = L.control.livePosition({ position: 'bottomright' }).addTo(map);
            console.log('Reinitialized livePositionControl');
        }
    } catch (error) {
        console.error('Error starting position tracking:', error);
        Utils.handleError('Failed to start position tracking.');
        setCheckboxValue('trackPositionCheckbox', false);
        userSettings.trackPosition = false;
        saveSettings();
        stopPositionTracking();
    }
}
function stopPositionTracking() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        console.log('Stopped geolocation watch');
    }
    if (liveMarker) {
        map.removeLayer(liveMarker);
        liveMarker = null;
        console.log('Removed liveMarker');
    }
    if (window.accuracyCircle) {
        map.removeLayer(window.accuracyCircle);
        window.accuracyCircle = null;
        console.log('Removed accuracy circle');
    }
    if (livePositionControl) {
        livePositionControl._container.innerHTML = 'Initializing live position...';
        livePositionControl._container.style.display = 'none';
        console.log('Hid livePositionControl and reset content');
    } else {
        console.warn('livePositionControl not found in stopPositionTracking');
    }
    prevLat = null;
    prevLng = null;
    prevTime = null;
    lastSpeed = 'N/A';
    lastDirection = 'N/A';
    console.log('Cleared tracking data');
}
function updateAccuracyCircle(lat, lng, accuracy) {
    try {
        if (window.accuracyCircle) {
            map.removeLayer(window.accuracyCircle);
            window.accuracyCircle = null;
            console.log('Removed previous accuracy circle');
        }
        window.accuracyCircle = L.circle([lat, lng], {
            radius: accuracy,
            color: 'blue',
            fillOpacity: 0.1,
            weight: 1,
            dashArray: '5, 5',
            zIndexOffset: 200 // Ensure above other layers
        }).addTo(map);
        console.log('Updated accuracy circle:', { lat, lng, radius: accuracy });
    } catch (error) {
        console.error('Error updating accuracy circle:', error);
        if (window.accuracyCircle) {
            map.removeLayer(window.accuracyCircle);
            window.accuracyCircle = null;
        }
    }
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
                debouncedCalculateJump(); // Use debounced version
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
async function fetchWeather(lat, lon, currentTime = null, isInitialLoad = false) {
    try {
        document.getElementById('loading').style.display = 'block';
        const modelSelect = document.getElementById('modelSelect');
        const historicalDatePicker = document.getElementById('historicalDatePicker');
        const selectedDate = historicalDatePicker.value ? luxon.DateTime.fromISO(historicalDatePicker.value, { zone: 'utc' }) : null;
        const today = luxon.DateTime.utc().startOf('day');
        const isHistorical = selectedDate && selectedDate < today;

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

        let startDateStr, endDateStr;
        let baseUrl = 'https://api.open-meteo.com/v1/forecast';
        if (isHistorical) {
            baseUrl = 'https://historical-forecast-api.open-meteo.com/v1/forecast';
            startDateStr = selectedDate.toFormat('yyyy-MM-dd');
            endDateStr = startDateStr; // Single day for historical data
        } else {
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
            startDateStr = `${startYear}-${startMonth}-${startDay}`;

            const endDate = new Date(Date.UTC(
                startDate.getUTCFullYear(),
                startDate.getUTCMonth(),
                startDate.getUTCDate() + (modelSelect.value === 'icon_d2' ? 2 : 7)
            ));
            const endYear = endDate.getUTCFullYear();
            const endMonth = String(endDate.getUTCMonth() + 1).padStart(2, '0');
            const endDay = String(endDate.getUTCDate()).padStart(2, '0');
            endDateStr = `${endYear}-${endMonth}-${endDay}`;
        }

        const url = `${baseUrl}?latitude=${lat}&longitude=${lon}` +
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
            if (typeof currentTime === 'string' && currentTime.includes('GMT')) {
                const match = currentTime.match(/^(\d{4}-\d{2}-\d{2})\s(\d{4})\sGMT([+-]\d{1,2})$/);
                if (match) {
                    const [, dateStr, timeStr, offset] = match;
                    const formattedTime = `${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}`;
                    const offsetNum = parseInt(offset);
                    const formattedOffset = `${offsetNum >= 0 ? '+' : '-'}${Math.abs(offsetNum).toString().padStart(2, '0')}:00`;
                    const isoString = `${dateStr}T${formattedTime}:00${formattedOffset}`;
                    targetDate = luxon.DateTime.fromISO(isoString);
                    console.log('fetchWeather: Parsed ISO string:', isoString);
                } else {
                    console.warn('fetchWeather: Invalid currentTime format:', currentTime);
                }
            } else {
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
        } else if (isHistorical && weatherData.time.length > 0) {
            // For historical data, default to midnight of the selected date
            const targetDate = selectedDate.startOf('day');
            const targetTimestamp = targetDate.toMillis();
            let minDiff = Infinity;
            weatherData.time.forEach((time, index) => {
                const timeTimestamp = luxon.DateTime.fromISO(time, { zone: 'utc' }).toMillis();
                const diff = Math.abs(timeTimestamp - targetTimestamp);
                if (diff < minDiff) {
                    minDiff = diff;
                    initialIndex = index;
                }
            });
            console.log(`fetchWeather: Historical mode, slider set to index ${initialIndex} for time ${weatherData.time[initialIndex]}`);
        } else {
            // Default to closest current or future time for forecast
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

        // Reattach slider event listener
        slider.oninput = function () {
            console.log('Slider oninput triggered, new value:', this.value);
            updateWeatherDisplay(this.value);
        };
    } catch (error) {
        document.getElementById('loading').style.display = 'none';
        Utils.handleError(`Failed to fetch weather data: ${error.message}`);
    }
}
async function updateWeatherDisplayOLD(index, originalTime = null) {
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
    const surfaceHeight = refLevel === 'AMSL' && lastAltitude !== 'N/A' ? Math.round(lastAltitude) : 0;

    if (!userSettings.showTable) {
        document.getElementById('info').innerHTML = '';
        document.getElementById('selectedTime').innerHTML = `Selected Time: ${time}`;
        return;
    }

    let output = `<table id="weatherTable">`;
    output += `<tr><th>Height (${heightUnit} ${refLevel})</th><th>Dir (deg)</th><th>Spd (${windSpeedUnit})</th><th>Wind</th><th>T (${temperatureUnit === 'C' ? '°C' : '°F'})</th></tr>`;
    interpolatedData.forEach((data, idx) => {
        const spd = parseFloat(data.spd);
        let windClass = '';
        if (windSpeedUnit === 'bft') {
            const bft = Math.round(spd);
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

        // Apply conditional background color based on RH
        const humidity = data.rh;
        let humidityClass = '';
        if (humidity !== 'N/A' && Number.isFinite(humidity)) {
            if (humidity < 65) {
                humidityClass = 'humidity-low';
            } else if (humidity >= 65 && humidity <= 85) {
                humidityClass = 'humidity-moderate';
            } else if (humidity > 85 && humidity < 100) {
                humidityClass = 'humidity-high';
            } else if (humidity === 100) {
                humidityClass = 'humidity-saturated';
            }
        }
        //console.log(`Row ${idx}: RH=${humidity}, windClass=${windClass}, humidityClass=${humidityClass}`);

        const displayHeight = refLevel === 'AMSL' ? data.displayHeight + (heightUnit === 'ft' ? Math.round(surfaceHeight * 3.28084) : surfaceHeight) : data.displayHeight;
        const displayTemp = Utils.convertTemperature(data.temp, temperatureUnit === 'C' ? '°C' : '°F');
        const formattedTemp = displayTemp === 'N/A' ? 'N/A' : displayTemp.toFixed(0);

        const convertedSpd = Utils.convertWind(spd, windSpeedUnit, 'km/h');
        let formattedWind;
        const surfaceDisplayHeight = refLevel === 'AMSL' ? (heightUnit === 'ft' ? Math.round(surfaceHeight * 3.28084) : surfaceHeight) : 0;
        if (Math.round(displayHeight) === surfaceDisplayHeight && weatherData.wind_gusts_10m[index] !== undefined && Number.isFinite(weatherData.wind_gusts_10m[index])) {
            const gustSpd = weatherData.wind_gusts_10m[index];
            const convertedGust = Utils.convertWind(gustSpd, windSpeedUnit, 'km/h');
            const spdValue = windSpeedUnit === 'bft' ? Math.round(convertedSpd) : convertedSpd.toFixed(0);
            const gustValue = windSpeedUnit === 'bft' ? Math.round(convertedGust) : convertedGust.toFixed(0);
            formattedWind = `${spdValue} G ${gustValue}`;
        } else {
            formattedWind = convertedSpd === 'N/A' ? 'N/A' : (windSpeedUnit === 'bft' ? Math.round(convertedSpd) : convertedSpd.toFixed(0));
        }

        const speedKt = Math.round(Utils.convertWind(spd, 'kt', 'km/h') / 5) * 5;
        const windBarbSvg = data.dir === 'N/A' || isNaN(speedKt) ? 'N/A' : generateWindBarb(data.dir, speedKt);

        output += `<tr class="${windClass} ${humidityClass}">
            <td>${Math.round(displayHeight)}</td>
            <td>${Utils.roundToTens(data.dir)}</td>
            <td>${formattedWind}</td>
            <td>${windBarbSvg}</td>
            <td>${formattedTemp}</td>
        </tr>`;
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

    const baseHeight = Math.round(lastAltitude);
    const interpStep = parseInt(getInterpolationStep()) || 100;
    const heightUnit = getHeightUnit();

    // Define all possible pressure levels
    const allPressureLevels = [1000, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200];

    // Filter pressure levels with valid geopotential height data
    const validPressureLevels = allPressureLevels.filter(hPa => {
        const height = weatherData[`geopotential_height_${hPa}hPa`]?.[sliderIndex];
        return height !== null && height !== undefined;
    });

    if (validPressureLevels.length < 2) {
        console.warn('Insufficient valid pressure level data for interpolation:', validPressureLevels);
        return [];
    }

    // Collect data for valid pressure levels
    let heightData = validPressureLevels.map(hPa => weatherData[`geopotential_height_${hPa}hPa`][sliderIndex]);
    let tempData = validPressureLevels.map(hPa => weatherData[`temperature_${hPa}hPa`][sliderIndex]);
    let rhData = validPressureLevels.map(hPa => weatherData[`relative_humidity_${hPa}hPa`][sliderIndex]);
    let spdData = validPressureLevels.map(hPa => weatherData[`wind_speed_${hPa}hPa`][sliderIndex]);
    let dirData = validPressureLevels.map(hPa => weatherData[`wind_direction_${hPa}hPa`][sliderIndex]);

    const surfacePressure = weatherData.surface_pressure[sliderIndex];
    if (surfacePressure === null || surfacePressure === undefined) {
        console.warn('Surface pressure missing');
        return [];
    }

    // Calculate wind components at valid pressure levels
    let uComponents = spdData.map((spd, i) => -spd * Math.sin(dirData[i] * Math.PI / 180));
    let vComponents = spdData.map((spd, i) => -spd * Math.cos(dirData[i] * Math.PI / 180));

    // Add surface and intermediate points if surfacePressure > lowest valid pressure level
    const lowestPressureLevel = Math.max(...validPressureLevels);
    const hLowest = weatherData[`geopotential_height_${lowestPressureLevel}hPa`][sliderIndex];
    if (surfacePressure > lowestPressureLevel && Number.isFinite(hLowest) && hLowest > baseHeight) {
        const stepsBetween = Math.floor((hLowest - baseHeight) / interpStep);

        // Surface wind components
        const uSurface = -weatherData.wind_speed_10m[sliderIndex] * Math.sin(weatherData.wind_direction_10m[sliderIndex] * Math.PI / 180);
        const vSurface = -weatherData.wind_speed_10m[sliderIndex] * Math.cos(weatherData.wind_direction_10m[sliderIndex] * Math.PI / 180);
        const uLowest = uComponents[validPressureLevels.indexOf(lowestPressureLevel)];
        const vLowest = vComponents[validPressureLevels.indexOf(lowestPressureLevel)];

        // Add intermediate points with logarithmic interpolation
        for (let i = stepsBetween - 1; i >= 1; i--) {
            const h = baseHeight + i * interpStep;
            if (h >= hLowest) continue;
            const fraction = (h - baseHeight) / (hLowest - baseHeight);
            const logPSurface = Math.log(surfacePressure);
            const logPLowest = Math.log(lowestPressureLevel);
            const logP = logPSurface + fraction * (logPLowest - logPSurface);
            const p = Math.exp(logP);

            const logHeight = Math.log(h - baseHeight + 1);
            const logH0 = Math.log(1);
            const logH1 = Math.log(hLowest - baseHeight);
            const u = Utils.LIP([logH0, logH1], [uSurface, uLowest], logHeight);
            const v = Utils.LIP([logH0, logH1], [vSurface, vLowest], logHeight);
            const spd = Utils.windSpeed(u, v);
            const dir = Utils.windDirection(u, v);

            heightData.unshift(h);
            validPressureLevels.unshift(p);
            tempData.unshift(Utils.LIP([baseHeight, hLowest], [weatherData.temperature_2m[sliderIndex], weatherData[`temperature_${lowestPressureLevel}hPa`][sliderIndex]], h));
            rhData.unshift(Utils.LIP([baseHeight, hLowest], [weatherData.relative_humidity_2m[sliderIndex], weatherData[`relative_humidity_${lowestPressureLevel}hPa`][sliderIndex]], h));
            spdData.unshift(spd);
            dirData.unshift(dir);
            uComponents.unshift(u);
            vComponents.unshift(v);
        }

        // Add surface data
        heightData.unshift(baseHeight);
        validPressureLevels.unshift(surfacePressure);
        tempData.unshift(weatherData.temperature_2m[sliderIndex]);
        rhData.unshift(weatherData.relative_humidity_2m[sliderIndex]);
        spdData.unshift(weatherData.wind_speed_10m[sliderIndex]);
        dirData.unshift(weatherData.wind_direction_10m[sliderIndex]);
        uComponents.unshift(uSurface);
        vComponents.unshift(vSurface);
    }

    // Determine the maximum height using the lowest pressure level (highest altitude)
    const minPressureIndex = validPressureLevels.indexOf(Math.min(...validPressureLevels));
    const maxHeightASL = heightData[minPressureIndex];
    const maxHeightAGL = maxHeightASL - baseHeight;
    if (maxHeightAGL <= 0 || isNaN(maxHeightAGL)) {
        console.warn('Invalid max height at lowest pressure level:', { maxHeightASL, baseHeight, minPressure: validPressureLevels[minPressureIndex] });
        return [];
    }

    // Convert maxHeightAGL to user's unit for step calculation
    const maxHeightInUnit = heightUnit === 'ft' ? maxHeightAGL * 3.28084 : maxHeightAGL;
    const steps = Math.floor(maxHeightInUnit / interpStep);
    const heightsInUnit = Array.from({ length: steps + 1 }, (_, i) => i * interpStep);

    console.log('Interpolating up to lowest pressure level:', { maxHeightAGL, minPressure: validPressureLevels[minPressureIndex], interpStep });

    const interpolatedData = [];
    heightsInUnit.forEach(height => {
        const heightAGLInMeters = heightUnit === 'ft' ? height / 3.28084 : height;
        const heightASLInMeters = baseHeight + heightAGLInMeters;

        let dataPoint;
        if (heightAGLInMeters === 0) {
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
            const pressure = Utils.interpolatePressure(heightASLInMeters, validPressureLevels, heightData);
            const windComponents = Utils.interpolateWindAtAltitude(heightASLInMeters, validPressureLevels, heightData, uComponents, vComponents);
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

        dataPoint.displayHeight = height;
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

// Isolated calculation functions
function calculateExitCircle() {
    if (!userSettings.showExitArea || !userSettings.calculateJump || !weatherData || !lastLat || !lastLng) {
        console.log('Skipping calculateExitCircle: conditions not met');
        return null;
    }
    console.log('Calculating exit circle...', {
        lastLat,
        lastLng,
        lastAltitude,
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

    const elevation = Math.round(lastAltitude);
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

    const landingPatternCoords = calculateLandingPatternCoords(lastLat, lastLng, interpolatedData, sliderIndex);
    let blueLat = landingPatternCoords.downwindLat;
    let blueLng = landingPatternCoords.downwindLng;
    if (!Number.isFinite(blueLat) || !Number.isFinite(blueLng)) {
        console.warn('Downwind coordinates invalid, using lastLat, lastLng as fallback');
        blueLat = lastLat;
        blueLng = lastLng;
    }
    const redLat = lastLat;
    const redLng = lastLng;

    const newCenterBlue = calculateNewCenter(blueLat, blueLng, centerDisplacement, displacementDirection);
    const newCenterRed = calculateNewCenter(redLat, redLng, centerDisplacementFull, displacementDirectionFull);

    const freeFallResult = calculateFreeFall(weatherData, exitAltitude, openingAltitude, sliderIndex, lastLat, lastLng, lastAltitude);
    if (!freeFallResult) {
        console.warn('Free fall calculation failed for exit circle');
        return null;
    }

    const greenShiftDirection = (freeFallResult.directionDeg + 180) % 360;
    const greenCenter = calculateNewCenter(newCenterRed[0], newCenterRed[1], freeFallResult.distance, greenShiftDirection);
    const darkGreenCenter = calculateNewCenter(newCenterBlue[0], newCenterBlue[1], freeFallResult.distance, greenShiftDirection);

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
function calculateCanopyCircles() {
    if (!userSettings.showCanopyArea || !userSettings.calculateJump || !weatherData || !lastLat || !lastLng) {
        console.log('Skipping calculateCanopyCircles: conditions not met');
        return null;
    }
    console.log('Calculating canopy circles...', {
        lastLat,
        lastLng,
        lastAltitude,
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

    const elevation = Math.round(lastAltitude);
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

    const freeFallResult = calculateFreeFall(weatherData, exitAltitude, openingAltitude, sliderIndex, lastLat, lastLng, lastAltitude);
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

    const landingPatternCoords = calculateLandingPatternCoords(lastLat, lastLng, interpolatedData, sliderIndex);
    let blueLat = landingPatternCoords.downwindLat;
    let blueLng = landingPatternCoords.downwindLng;
    if (!Number.isFinite(blueLat) || !Number.isFinite(blueLng)) {
        console.warn('Downwind coordinates invalid, using lastLat, lastLng as fallback');
        blueLat = lastLat;
        blueLng = lastLng;
    }
    const redLat = lastLat;
    const redLng = lastLng;

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
        freeFallDirection: freeFallResult.directionDeg,
        freeFallDistance: freeFallResult.distance,
        freeFallTime: freeFallResult.time
    };
}
function calculateJumpRunTrack() {
    if (!userSettings.showJumpRunTrack || !userSettings.calculateJump || !weatherData || !lastLat || !lastLng) {
        console.log('Skipping calculateJumpRunTrack: conditions not met');
        return null;
    }
    console.log('Calculating jump run track...');
    updateJumpRunTrack();
    const trackData = jumpRunTrack();
    return trackData;
}
function calculateJump() {
    console.log('Starting calculateJump...', {
        showExitArea: userSettings.showExitArea,
        showCanopyArea: userSettings.showCanopyArea,
        showJumpRunTrack: userSettings.showJumpRunTrack
    });

    if (!weatherData || !lastLat || !lastLng) {
        console.warn('Missing required data for calculateJump');
        clearJumpCircles();
        return null;
    }

    clearJumpCircles();

    let result = {};
    if (userSettings.showExitArea) {
        const exitResult = calculateExitCircle();
        if (exitResult) {
            updateJumpCircle(
                exitResult.darkGreenLat, exitResult.darkGreenLng,
                exitResult.greenLat, exitResult.greenLng,
                exitResult.darkGreenRadius, exitResult.greenRadius,
                [], [], [], [],
                0, 0, 0, 0,
                exitResult.freeFallDirection, exitResult.freeFallDistance, exitResult.freeFallTime,
                true, false
            );
            result = { ...result, ...exitResult, exitCircle: true };
        }
    }
    if (userSettings.showCanopyArea) {
        const canopyResult = calculateCanopyCircles();
        if (canopyResult) {
            updateJumpCircle(
                canopyResult.blueLat, canopyResult.blueLng,
                canopyResult.redLat, canopyResult.redLng,
                canopyResult.radius, canopyResult.radiusFull,
                canopyResult.additionalBlueRadii, canopyResult.additionalBlueDisplacements,
                canopyResult.additionalBlueDirections, canopyResult.additionalBlueUpperLimits,
                canopyResult.displacement, canopyResult.displacementFull,
                canopyResult.direction, canopyResult.directionFull,
                canopyResult.freeFallDirection, canopyResult.freeFallDistance, canopyResult.freeFallTime,
                false, true
            );
            result = { ...result, ...canopyResult, canopyCircles: true };
        }
    }
    if (userSettings.showJumpRunTrack) {
        const trackResult = calculateJumpRunTrack();
        if (trackResult) {
            result = { ...result, track: true };
        }
    }

    if (currentMarker && lastLat && lastLng) {
        currentMarker.setLatLng([lastLat, lastLng]);
        updateMarkerPopup(currentMarker, lastLat, lastLng, lastAltitude, currentMarker.getPopup()?.isOpen() || false);
    }

    console.log('calculateJump completed', result);
    return result;
}
function updateJumpCircle(blueLat, blueLng, redLat, redLng, radius, radiusFull, additionalBlueRadii = [], additionalBlueDisplacements = [], additionalBlueDirections = [], additionalBlueUpperLimits = [], displacement = 0, displacementFull = 0, direction = 0, directionFull = 0, freeFallDirection = 0, freeFallDistance = 0, freeFallTime = 0, showExitAreaOnly = false, showCanopyAreaOnly = false) {
    console.log('updateJumpCircle called with:', {
        blueLat, blueLng, redLat, redLng, radius, radiusFull,
        additionalBlueRadii, additionalBlueDisplacements, additionalBlueDirections, additionalBlueUpperLimits,
        displacement, displacementFull, direction, directionFull, freeFallDirection, freeFallDistance, freeFallTime,
        showExitArea: userSettings.showExitArea,
        showCanopyArea: userSettings.showCanopyArea,
        showExitAreaOnly, showCanopyAreaOnly
    });

    if (!map) {
        console.warn('Map not available to update jump circles');
        return false;
    }

    const currentZoom = map.getZoom();
    const minZoom = 11;
    const maxZoom = 14;
    const isVisible = currentZoom >= minZoom && currentZoom <= maxZoom;
    console.log('Zoom check:', { currentZoom, minZoom, maxZoom, isVisible });

    const blueCircleMetadata = [];

    const removeLayer = (layer, name) => {
        if (layer && typeof layer === 'object' && '_leaflet_id' in layer && map.hasLayer(layer)) {
            console.log(`Removing existing ${name}`);
            map.removeLayer(layer);
        }
    };

    console.log('Before cleanup:', {
        blueCircle: !!jumpCircle,
        redCircle: !!jumpCircleFull,
        greenCircle: !!jumpCircleGreen,
        darkGreenCircle: !!jumpCircleGreenLight,
        additionalBlueCircles: window.additionalBlueCircles?.length || 0,
        additionalBlueLabels: window.additionalBlueLabels?.length || 0
    });

    // Cleanup based on mode
    if (showExitAreaOnly) {
        // Only clear exit circles
        removeLayer(jumpCircleGreen, 'green circle');
        removeLayer(jumpCircleGreenLight, 'dark green circle');
    } else if (showCanopyAreaOnly) {
        // Only clear canopy circles
        removeLayer(jumpCircle, 'blue circle');
        removeLayer(jumpCircleFull, 'red circle');
        if (window.additionalBlueCircles) {
            window.additionalBlueCircles.forEach(circle => removeLayer(circle, 'additional blue circle'));
            window.additionalBlueCircles = [];
        }
        if (window.additionalBlueLabels) {
            window.additionalBlueLabels.forEach(label => removeLayer(label, 'additional blue label'));
            window.additionalBlueLabels = [];
        }
    } else {
        // Clear all circles if neither mode is specified
        clearJumpCircles();
    }

    window.additionalBlueCircles = window.additionalBlueCircles || [];
    window.additionalBlueLabels = window.additionalBlueLabels || [];

    function calculateLabelAnchor(center, radius) {
        const centerLatLng = L.latLng(center[0], center[1]);
        const earthRadius = 6378137;
        const deltaLat = (radius / earthRadius) * (180 / Math.PI);
        const topEdgeLatLng = L.latLng(center[0] + deltaLat, center[1]);
        const centerPoint = map.latLngToLayerPoint(centerLatLng);
        const topEdgePoint = map.latLngToLayerPoint(topEdgeLatLng);
        const offsetY = centerPoint.y - topEdgePoint.y + 10;
        console.log('calculateLabelAnchor:', { center, radius, anchor: [25, offsetY] });
        return [25, offsetY];
    }

    function updateBlueCircleLabels() {
        if (!blueCircleMetadata.length) {
            console.log('No blue circle metadata to update labels');
            return;
        }
        const zoom = map.getZoom();
        blueCircleMetadata.forEach(({ circle, label, center, radius, content }) => {
            label.setIcon(L.divIcon({
                className: `isoline-label isoline-label-${zoom <= 11 ? 'small' : 'large'}`,
                html: `<span style="font-size: ${zoom <= 11 ? '8px' : '10px'}">${content}</span>`,
                iconSize: zoom <= 11 ? [50, 12] : [60, 14],
                iconAnchor: calculateLabelAnchor(center, radius)
            }));
        });
        console.log('Updated isoline labels for zoom:', zoom);
    }

    try {
        map.off('zoomend', updateBlueCircleLabels);
    } catch (e) {
        console.warn('Failed to remove zoomend listener:', e.message);
    }

    if (!isVisible || (!userSettings.showExitArea && !userSettings.showCanopyArea)) {
        console.log('No circles to render:', { isVisible, showExitArea: userSettings.showExitArea, showCanopyArea: userSettings.showCanopyArea });
        return false;
    }

    // Render exit circles
    if (showExitAreaOnly && userSettings.showExitArea && Number.isFinite(blueLat) && Number.isFinite(blueLng) && Number.isFinite(radius) && Number.isFinite(radiusFull)) {
        jumpCircleGreen = L.circle([redLat, redLng], {
            radius: radiusFull,
            color: 'green',
            fillColor: 'green',
            fillOpacity: 0.2,
            weight: 2
        }).addTo(map);
        jumpCircleGreenLight = L.circle([blueLat, blueLng], {
            radius: radius,
            color: 'darkgreen',
            fillColor: 'darkgreen',
            fillOpacity: 0.2,
            weight: 2
        }).addTo(map);
        if (jumpCircleGreen.setZIndex) jumpCircleGreen.setZIndex(600);
        if (jumpCircleGreenLight.setZIndex) jumpCircleGreenLight.setZIndex(600);
        console.log('Added green and dark green circles:', {
            greenCenter: [redLat, redLng],
            greenRadius: radiusFull,
            darkGreenCenter: [blueLat, blueLng],
            darkGreenRadius: radius
        });

        const tooltipContent = `
            Exit areas calculated with:<br>
            Throw/Drift: ${Number.isFinite(freeFallDirection) ? Math.round(freeFallDirection) : 'N/A'}° ${Number.isFinite(freeFallDistance) ? Math.round(freeFallDistance) : 'N/A'} m<br>
            Free Fall Time: ${freeFallTime != null && !isNaN(freeFallTime) ? Math.round(freeFallTime) : 'N/A'} sec
        `;
        jumpCircleGreenLight.bindTooltip(tooltipContent, {
            direction: 'top',
            offset: [0, 0],
            className: 'wind-tooltip'
        });
        console.log('Tooltip bound to dark green circle:', { tooltipContent });
    }

    // Render canopy circles
    if (showCanopyAreaOnly && userSettings.showCanopyArea && Number.isFinite(blueLat) && Number.isFinite(blueLng) && Number.isFinite(redLat) && Number.isFinite(redLng) && Number.isFinite(radius) && Number.isFinite(radiusFull)) {
        const newCenterBlue = calculateNewCenter(blueLat, blueLng, displacement, direction);
        const newCenterRed = calculateNewCenter(redLat, redLng, displacementFull, directionFull);

        jumpCircle = L.circle(newCenterBlue, {
            radius: radius,
            color: 'blue',
            fillColor: 'blue',
            fillOpacity: 0,
            weight: 2,
            opacity: 0.1
        }).addTo(map);
        if (jumpCircle.setZIndex) jumpCircle.setZIndex(1000);
        console.log('Added main blue circle at:', { center: newCenterBlue, radius });

        jumpCircleFull = L.circle(newCenterRed, {
            radius: radiusFull,
            color: 'red',
            fillColor: 'red',
            fillOpacity: 0,
            weight: 2,
            opacity: 0.8
        }).addTo(map);
        if (jumpCircleFull.setZIndex) jumpCircleFull.setZIndex(400);
        console.log('Added red circle at:', { center: newCenterRed, radius: radiusFull });

        if (Array.isArray(additionalBlueRadii) && Array.isArray(additionalBlueDisplacements) && Array.isArray(additionalBlueDirections) && Array.isArray(additionalBlueUpperLimits)) {
            window.additionalBlueCircles = [];
            window.additionalBlueLabels = [];
            additionalBlueRadii.forEach((addRadius, i) => {
                if (Number.isFinite(addRadius) && addRadius > 0 &&
                    Number.isFinite(additionalBlueDisplacements[i]) && Number.isFinite(additionalBlueDirections[i]) &&
                    Number.isFinite(additionalBlueUpperLimits[i])) {
                    const addCenter = calculateNewCenter(blueLat, blueLng, additionalBlueDisplacements[i], additionalBlueDirections[i]);
                    const blueContent = `${Math.round(additionalBlueUpperLimits[i])}m`;
                    const circle = L.circle(addCenter, {
                        radius: addRadius,
                        color: 'blue',
                        fillColor: 'blue',
                        fillOpacity: 0.1,
                        weight: 1
                    }).addTo(map);
                    if (circle.setZIndex) circle.setZIndex(1000);

                    const label = L.marker(addCenter, {
                        icon: L.divIcon({
                            className: `isoline-label isoline-label-${currentZoom <= 11 ? 'small' : 'large'}`,
                            html: `<span style="font-size: ${currentZoom <= 11 ? '8px' : '10px'}">${blueContent}</span>`,
                            iconSize: currentZoom <= 11 ? [50, 12] : [60, 14],
                            iconAnchor: calculateLabelAnchor(addCenter, addRadius)
                        }),
                        zIndexOffset: 2100
                    }).addTo(map);

                    window.additionalBlueCircles.push(circle);
                    window.additionalBlueLabels.push(label);
                    blueCircleMetadata.push({ circle, label, center: addCenter, radius: addRadius, content: blueContent });
                    console.log(`Added additional blue circle ${i}:`, { center: addCenter, radius: addRadius, content: blueContent });

                    if (currentZoom <= 11 && i % 2 === 1) {
                        label.remove();
                        console.log(`Hid label for blue circle ${i} at zoom:`, currentZoom);
                    }
                } else {
                    console.warn(`Invalid data for blue circle ${i}:`, {
                        addRadius,
                        displacement: additionalBlueDisplacements[i],
                        direction: additionalBlueDirections[i],
                        upperLimit: additionalBlueUpperLimits[i]
                    });
                }
            });
        } else {
            console.warn('Invalid or empty arrays for additional blue circles:', {
                additionalBlueRadii,
                additionalBlueDisplacements,
                additionalBlueDirections,
                additionalBlueUpperLimits
            });
        }
    }

    // Re-render canopy circles if active and not in showExitAreaOnly mode
    if (!showExitAreaOnly && userSettings.showCanopyArea && !showCanopyAreaOnly) {
        const canopyResult = calculateCanopyCircles();
        if (canopyResult) {
            const newCenterBlue = calculateNewCenter(canopyResult.blueLat, canopyResult.blueLng, canopyResult.displacement, canopyResult.direction);
            const newCenterRed = calculateNewCenter(canopyResult.redLat, canopyResult.redLng, canopyResult.displacementFull, canopyResult.directionFull);

            removeLayer(jumpCircle, 'blue circle');
            removeLayer(jumpCircleFull, 'red circle');
            if (window.additionalBlueCircles) {
                window.additionalBlueCircles.forEach(circle => removeLayer(circle, 'additional blue circle'));
                window.additionalBlueCircles = [];
            }
            if (window.additionalBlueLabels) {
                window.additionalBlueLabels.forEach(label => removeLayer(label, 'additional blue label'));
                window.additionalBlueLabels = [];
            }

            jumpCircle = L.circle(newCenterBlue, {
                radius: canopyResult.radius,
                color: 'blue',
                fillColor: 'blue',
                fillOpacity: 0,
                weight: 2,
                opacity: 0.1
            }).addTo(map);
            if (jumpCircle.setZIndex) jumpCircle.setZIndex(1000);
            console.log('Re-added main blue circle at:', { center: newCenterBlue, radius: canopyResult.radius });

            jumpCircleFull = L.circle(newCenterRed, {
                radius: canopyResult.radiusFull,
                color: 'red',
                fillColor: 'red',
                fillOpacity: 0,
                weight: 2,
                opacity: 0.8
            }).addTo(map);
            if (jumpCircleFull.setZIndex) jumpCircleFull.setZIndex(400);
            console.log('Re-added red circle at:', { center: newCenterRed, radius: canopyResult.radiusFull });

            if (Array.isArray(canopyResult.additionalBlueRadii)) {
                window.additionalBlueCircles = [];
                window.additionalBlueLabels = [];
                canopyResult.additionalBlueRadii.forEach((addRadius, i) => {
                    if (Number.isFinite(addRadius) && addRadius > 0 &&
                        Number.isFinite(canopyResult.additionalBlueDisplacements[i]) &&
                        Number.isFinite(canopyResult.additionalBlueDirections[i]) &&
                        Number.isFinite(canopyResult.additionalBlueUpperLimits[i])) {
                        const addCenter = calculateNewCenter(canopyResult.blueLat, canopyResult.blueLng, canopyResult.additionalBlueDisplacements[i], canopyResult.additionalBlueDirections[i]);
                        const blueContent = `${Math.round(canopyResult.additionalBlueUpperLimits[i])}m`;
                        const circle = L.circle(addCenter, {
                            radius: addRadius,
                            color: 'blue',
                            fillColor: 'blue',
                            fillOpacity: 0.1,
                            weight: 1
                        }).addTo(map);
                        if (circle.setZIndex) circle.setZIndex(1000);

                        const label = L.marker(addCenter, {
                            icon: L.divIcon({
                                className: `isoline-label isoline-label-${currentZoom <= 11 ? 'small' : 'large'}`,
                                html: `<span style="font-size: ${currentZoom <= 11 ? '8px' : '10px'}">${blueContent}</span>`,
                                iconSize: currentZoom <= 11 ? [50, 12] : [60, 14],
                                iconAnchor: calculateLabelAnchor(addCenter, addRadius)
                            }),
                            zIndexOffset: 2100
                        }).addTo(map);

                        window.additionalBlueCircles.push(circle);
                        window.additionalBlueLabels.push(label);
                        blueCircleMetadata.push({ circle, label, center: addCenter, radius: addRadius, content: blueContent });
                        console.log(`Re-added additional blue circle ${i}:`, { center: addCenter, radius: addRadius, content: blueContent });

                        if (currentZoom <= 11 && i % 2 === 1) {
                            label.remove();
                            console.log(`Hid label for blue circle ${i} at zoom:`, currentZoom);
                        }
                    }
                });
            }
        }
    }

    if (blueCircleMetadata.length) {
        updateBlueCircleLabels();
        map.on('zoomend', updateBlueCircleLabels);
    } else {
        console.log('No blue circles created, skipping label update and zoom listener');
    }

    console.log('Jump circles added at zoom:', currentZoom, 'Layers on map:', {
        blue: !!jumpCircle,
        red: !!jumpCircleFull,
        green: !!jumpCircleGreen,
        darkGreen: !!jumpCircleGreenLight,
        additionalBlue: window.additionalBlueCircles?.length || 0,
        additionalBlueLabels: window.additionalBlueLabels?.length || 0
    });

    if (gpxLayer) {
        gpxLayer.bringToFront();
    }

    ['showExitAreaCheckbox', 'showCanopyAreaCheckbox', 'showJumpRunTrack'].forEach(id => {
        const checkbox = document.getElementById(id);
        if (checkbox) {
            console.log(`Checkbox ${id} DOM state after update:`, {
                disabled: checkbox.disabled,
                pointerEvents: getComputedStyle(checkbox).pointerEvents,
                zIndex: getComputedStyle(checkbox).zIndex,
                parentClasses: checkbox.parentElement.className
            });
        }
    });

    console.log('updateJumpCircle completed');
    return true;
}
function clearIsolineMarkers() {
    console.log('clearIsolineMarkers called');
    if (map) {
        let markerCount = 0;
        map.eachLayer(layer => {
            if (layer instanceof L.Marker &&
                layer !== currentMarker &&
                layer !== cutAwayMarker &&
                layer !== liveMarker &&
                layer !== harpMarker && // Skip harpMarker
                layer.options.icon &&
                layer.options.icon.options &&
                typeof layer.options.icon.options.className === 'string' &&
                layer.options.icon.options.className.match(/isoline-label/) &&
                !layer.options.icon.options.className.match(/landing-pattern-arrow|wind-arrow-icon/)) {
                console.log('Removing isoline-label marker:', layer, 'className:', layer.options.icon.options.className);
                layer.remove();
                markerCount++;
            } else if (layer === currentMarker) {
                console.log('Skipping currentMarker:', layer, 'className:', layer.options?.icon?.options?.className || 'none');
            } else if (layer === cutAwayMarker) {
                console.log('Skipping cutAwayMarker:', layer, 'className:', layer.options?.icon?.options?.className || 'none');
            } else if (layer === liveMarker) {
                console.log('Skipping liveMarker:', layer, 'className:', layer.options?.icon?.options?.className || 'none');
            } else if (layer === harpMarker) {
                console.log('Skipping harpMarker:', layer, 'className:', layer.options?.icon?.options?.className || 'none');
            } else if (layer instanceof L.Marker &&
                layer.options.icon &&
                layer.options.icon.options &&
                typeof layer.options.icon.options.className === 'string' &&
                layer.options.icon.options.className.match(/landing-pattern-arrow|wind-arrow-icon/)) {
                console.log('Skipping landing pattern arrow marker:', layer, 'className:', layer.options.icon.options.className);
            }
        });
        console.log('Cleared', markerCount, 'isoline-label markers');
        // Fallback: Remove only markers that are not currentMarker, cutAwayMarker, liveMarker, or harpMarker
        if (markerCount === 0) {
            map.eachLayer(layer => {
                if (layer instanceof L.Marker &&
                    layer !== currentMarker &&
                    layer !== cutAwayMarker &&
                    layer !== liveMarker &&
                    layer !== harpMarker &&
                    (!layer.options.icon ||
                        !layer.options.icon.options ||
                        !layer.options.icon.options.className ||
                        !layer.options.icon.options.className.match(/landing-pattern-arrow|wind-arrow-icon/))) {
                    console.log('Fallback: Removing marker:', layer, 'className:', layer.options?.icon?.options?.className || 'none');
                    layer.remove();
                }
            });
        }
    } else {
        console.warn('Map not available in clearIsolineMarkers');
    }
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
        customJumpRunDirection,
        jumpRunTrackOffset: userSettings.jumpRunTrackOffset,
        jumpRunTrackForwardOffset: userSettings.jumpRunTrackForwardOffset
    });
    const exitAltitude = parseInt(document.getElementById('exitAltitude')?.value) || userSettings.exitAltitude || 3000;
    const openingAltitude = parseInt(document.getElementById('openingAltitude')?.value) || userSettings.openingAltitude || 1000;
    const customDirection = parseInt(document.getElementById('jumpRunTrackDirection')?.value, 10);
    const sliderIndex = parseInt(document.getElementById('timeSlider')?.value) || 0;
    const lateralOffset = parseInt(document.getElementById('jumpRunTrackOffset')?.value) || userSettings.jumpRunTrackOffset || 0;
    const forwardOffset = parseInt(document.getElementById('jumpRunTrackForwardOffset')?.value) || userSettings.jumpRunTrackForwardOffset || 0;

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
    let centerLat = lastLat;
    let centerLng = lastLng;
    if (forwardOffset !== 0) {
        const forwardDistance = Math.abs(forwardOffset);
        const forwardBearing = forwardOffset >= 0 ? jumpRunTrackDirection : (jumpRunTrackDirection + 180) % 360;
        [centerLat, centerLng] = calculateNewCenter(lastLat, lastLng, forwardDistance, forwardBearing);
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
        [centerLat, centerLng] = calculateNewCenter(centerLat, centerLng, offsetDistance, offsetBearing);
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

        const startPoint = calculateNewCenter(centerLat, centerLng, trackLength / 2, (jumpRunTrackDirection + 180) % 360);
        const approachEndPoint = calculateNewCenter(startPoint[0], startPoint[1], approachLength, (jumpRunTrackDirection + 180) % 360);
        approachLatLngs = [
            [startPoint[0], startPoint[1]],
            [approachEndPoint[0], approachEndPoint[1]]
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
        approachLatLngs: approachLatLngs,
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
        currentZoom: map.getZoom(),
        jumpRunTrackOffset: userSettings.jumpRunTrackOffset,
        jumpRunTrackForwardOffset: userSettings.jumpRunTrackForwardOffset
    });

    const currentZoom = map.getZoom();
    const isZoomInRange = currentZoom >= minZoom && currentZoom <= maxZoom;

    // Remove existing jump run track layer
    if (jumpRunTrackLayer) {
        map.removeLayer(jumpRunTrackLayer);
        jumpRunTrackLayer = null;
        console.log('Removed existing JRT layer group');
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

    const isValidLatLngs = latlngs.every(ll => Array.isArray(ll) && ll.length === 2 && !isNaN(ll[0]) && !isNaN(ll[1]));
    if (!isValidLatLngs) {
        console.error('Invalid latlngs format in trackData:', latlngs);
        return;
    }

    console.log('Updating jump run track with:', {
        latlngs,
        direction,
        trackLength,
        lateralOffset: userSettings.jumpRunTrackOffset,
        forwardOffset: userSettings.jumpRunTrackForwardOffset
    });
    if (approachLatLngs) {
        console.log('Updating approach path with:', { approachLatLngs, approachLength });
    }

    // Create a LayerGroup to hold all components
    jumpRunTrackLayer = L.layerGroup().addTo(map);

    // Create polyline for the jump run track (interactive for tooltips)
    const trackPolyline = L.polyline(latlngs, {
        color: 'orange',
        weight: 4,
        opacity: 0.9,
        interactive: true
    }).addTo(jumpRunTrackLayer);

    trackPolyline.bindTooltip(`Jump Run: ${Math.round(direction)}°, ${Math.round(trackLength)} m`, {
        permanent: false,
        direction: 'top',
        offset: [0, -10]
    });

    // Prevent drag events on the polyline
    trackPolyline.on('mousedown touchstart', (e) => {
        L.DomEvent.stopPropagation(e);
    });

    // Create polyline for the approach path (interactive for tooltips)
    let approachPolyline = null;
    if (approachLatLngs && Array.isArray(approachLatLngs) && approachLatLngs.length === 2) {
        const isValidApproachLatLngs = approachLatLngs.every(ll => Array.isArray(ll) && ll.length === 2 && !isNaN(ll[0]) && !isNaN(ll[1]));
        if (isValidApproachLatLngs) {
            approachPolyline = L.polyline(approachLatLngs, {
                color: 'orange',
                weight: 3,
                opacity: 0.9,
                dashArray: '10, 10',
                interactive: true
            }).addTo(jumpRunTrackLayer);

            approachPolyline.bindTooltip(`Approach: ${Math.round(direction)}°, ${Math.round(approachLength)} m, ${Math.round(approachTime / 60)} min`, {
                permanent: false,
                direction: 'top',
                offset: [0, -10]
            });

            // Prevent drag events on the approach polyline
            approachPolyline.on('mousedown touchstart', (e) => {
                L.DomEvent.stopPropagation(e);
            });
        } else {
            console.warn('Invalid approachLatLngs format:', approachLatLngs);
        }
    } else {
        console.warn('approachLatLngs is null or invalid:', approachLatLngs);
    }

    // Add airplane marker at the front end (now draggable)
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

    const airplaneMarker = L.marker(frontEnd, {
        icon: airplaneIcon,
        rotationAngle: direction,
        rotationOrigin: 'center center',
        draggable: true, // Make the airplane marker draggable
        zIndexOffset: 2000 // Ensure it's above other layers
    }).addTo(jumpRunTrackLayer);

    // Add tooltip to indicate draggability
    airplaneMarker.bindTooltip('Drag to move Jump Run Track', {
        permanent: false,
        direction: 'top',
        offset: [0, -20]
    });

    // Store original positions for drag calculations
    let originalTrackLatLngs = latlngs.map(ll => [...ll]);
    let originalApproachLatLngs = approachLatLngs ? approachLatLngs.map(ll => [...ll]) : null;
    let originalAirplaneLatLng = [...frontEnd];
    let originalCenterLat = lastLat;
    let originalCenterLng = lastLng;
    if (userSettings.jumpRunTrackForwardOffset !== 0) {
        const forwardDistance = Math.abs(userSettings.jumpRunTrackForwardOffset);
        const forwardBearing = userSettings.jumpRunTrackForwardOffset >= 0 ? direction : (direction + 180) % 360;
        [originalCenterLat, originalCenterLng] = calculateNewCenter(lastLat, lastLng, forwardDistance, forwardBearing);
    }
    if (userSettings.jumpRunTrackOffset !== 0) {
        const lateralDistance = Math.abs(userSettings.jumpRunTrackOffset);
        const lateralBearing = userSettings.jumpRunTrackOffset >= 0
            ? (direction + 90) % 360
            : (direction - 90 + 360) % 360;
        [originalCenterLat, originalCenterLng] = calculateNewCenter(originalCenterLat, originalCenterLng, lateralDistance, lateralBearing);
    }

    // Update direction input
    const directionInput = document.getElementById('jumpRunTrackDirection');
    if (directionInput) {
        setInputValueSilently('jumpRunTrackDirection', Math.round(direction));
    }

    // Dragging handlers for the airplane marker
    airplaneMarker.on('mousedown', (e) => {
        console.log('Airplane marker mousedown:', e);
        map.dragging.disable();
        L.DomEvent.stopPropagation(e);
    });

    airplaneMarker.on('dragstart', () => {
        console.log('Airplane marker dragstart');
        map.dragging.disable();
    });

    airplaneMarker.on('drag', () => {
        console.log('Airplane marker drag');
        const newLatLng = airplaneMarker.getLatLng();
        // Calculate delta from the original center (lastLat, lastLng) to new center
        const originalCenter = L.latLng(originalCenterLat, originalCenterLng);
        const newCenter = L.latLng(originalTrackLatLngs[1][0], originalTrackLatLngs[1][1]); // Front end of JRT
        const deltaLat = newLatLng.lat - newCenter.lat;
        const deltaLng = newLatLng.lng - newCenter.lng;

        // Update track polyline
        const newTrackLatLngs = originalTrackLatLngs.map(ll => [ll[0] + deltaLat, ll[1] + deltaLng]);
        trackPolyline.setLatLngs(newTrackLatLngs);
        originalTrackLatLngs = newTrackLatLngs;

        // Update approach polyline if it exists
        if (approachPolyline && originalApproachLatLngs) {
            const newApproachLatLngs = originalApproachLatLngs.map(ll => [ll[0] + deltaLat, ll[1] + deltaLng]);
            approachPolyline.setLatLngs(newApproachLatLngs);
            originalApproachLatLngs = newApproachLatLngs;
        }

        // Update airplane marker position (already handled by Leaflet)
        originalAirplaneLatLng = [newLatLng.lat, newLatLng.lng];
        originalCenterLat += deltaLat;
        originalCenterLng += deltaLng;
    });

    airplaneMarker.on('dragend', () => {
        console.log('Airplane marker dragend');
        map.dragging.enable();

        const newLatLng = airplaneMarker.getLatLng();

        // Calculate displacement from original center (lastLat, lastLng)
        const originalCenter = L.latLng(lastLat, lastLng);
        const newCenter = L.latLng(newLatLng.lat - (originalAirplaneLatLng[0] - originalCenterLat), newLatLng.lng - (originalAirplaneLatLng[1] - originalCenterLng));
        const distance = map.distance(originalCenter, newCenter);
        const bearing = calculateBearing(originalCenter.lat, originalCenter.lng, newCenter.lat, newCenter.lng);

        // Calculate lateral and forward components
        const trackDirectionRad = direction * Math.PI / 180;
        const bearingRad = bearing * Math.PI / 180;

        let angle = Math.abs(((bearing - direction + 540) % 360) - 180);
        if (angle > 90) {
            angle = 180 - angle;
        }
        const angleRad = angle * Math.PI / 180;

        const forwardDistance = distance * Math.cos(angleRad);
        const lateralDistance = distance * Math.sin(angleRad);

        let forwardOffsetSign = 1;
        const forwardAngle = Math.abs(((bearing - direction + 540) % 360) - 180);
        const backwardAngle = Math.abs(((bearing - (direction + 180) % 360 + 540) % 360) - 180);
        if (backwardAngle < forwardAngle) {
            forwardOffsetSign = -1;
        }

        let lateralOffsetSign = 1;
        const rightAngle = Math.abs(((bearing - (direction + 90) % 360 + 540) % 360) - 180);
        const leftAngle = Math.abs(((bearing - (direction - 90 + 360) % 360 + 540) % 360) - 180);
        if (leftAngle < rightAngle) {
            lateralOffsetSign = -1;
        }

        const newForwardOffset = Math.round((forwardDistance * forwardOffsetSign) / 100) * 100;
        const newLateralOffset = Math.round((lateralDistance * lateralOffsetSign) / 100) * 100;

        const clampedForwardOffset = Math.max(-50000, Math.min(50000, newForwardOffset));
        const clampedLateralOffset = Math.max(-50000, Math.min(50000, newLateralOffset));

        userSettings.jumpRunTrackOffset = clampedLateralOffset;
        userSettings.jumpRunTrackForwardOffset = clampedForwardOffset;
        saveSettings();
        console.log('JRT dragged, new offsets:', {
            lateralOffset: userSettings.jumpRunTrackOffset,
            forwardOffset: userSettings.jumpRunTrackForwardOffset,
            distance,
            bearing,
            forwardDistance,
            lateralDistance,
            angle
        });

        const lateralOffsetInput = document.getElementById('jumpRunTrackOffset');
        if (lateralOffsetInput) {
            lateralOffsetInput.value = userSettings.jumpRunTrackOffset;
        }
        const forwardOffsetInput = document.getElementById('jumpRunTrackForwardOffset');
        if (forwardOffsetInput) {
            forwardOffsetInput.value = userSettings.jumpRunTrackForwardOffset;
        }
    });

    airplaneMarker.on('touchstart', (e) => {
        console.log('Airplane marker touchstart:', e);
        map.dragging.disable();
        L.DomEvent.stopPropagation(e);
    });

    airplaneMarker.on('click', (e) => {
        console.log('Airplane marker click:', e);
        L.DomEvent.stopPropagation(e);
    });
}
function calculateCutAway() {
    console.log('calculateCutAway called', {
        calculateJump: userSettings.calculateJump,
        showCanopyArea: userSettings.showCanopyArea,
        showCutAwayFinder: userSettings.showCutAwayFinder,
        cutAwayLat,
        cutAwayLng,
        cutAwayMarkerExists: !!cutAwayMarker,
        cutAwayMarkerClassName: cutAwayMarker?.options?.icon?.options?.className || 'none',
        cutAwayCircleExists: !!cutAwayCircle
    });

    // Silently skip if cut-away marker is not placed
    if (cutAwayLat === null || cutAwayLng === null) {
        console.log('Skipping calculateCutAway: cutAwayLat or cutAwayLng is null');
        return;
    }

    // Validate other required data
    if (!weatherData || lastAltitude === 'N/A' || !userSettings.cutAwayAltitude) {
        console.log('Cannot calculate cut-away: missing data', {
            weatherData: !!weatherData,
            lastAltitude,
            cutAwayAltitude: userSettings.cutAwayAltitude
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
    const elevation = Math.round(lastAltitude); // Surface altitude in meters
    const lowerLimit = elevation;
    const upperLimit = elevation + userSettings.cutAwayAltitude; // Surface + cutAwayAltitude
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
    const cutAwayAltitude = userSettings.cutAwayAltitude; // meters
    const surfaceAltitude = lastAltitude; // meters
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
    const [newLatMin, newLngMin] = calculateNewCenter(cutAwayLat, cutAwayLng, displacementDistanceMin, adjustedWindDirection);
    const [newLatMean, newLngMean] = calculateNewCenter(cutAwayLat, cutAwayLng, displacementDistanceMean, adjustedWindDirection);
    const [newLatMax, newLngMax] = calculateNewCenter(cutAwayLat, cutAwayLng, displacementDistanceMax, adjustedWindDirection);

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
    if (cutAwayCircle) {
        map.removeLayer(cutAwayCircle);
        cutAwayCircle = null;
        console.log('Cleared existing cut-away circle');
    }

    // Add circle for the selected cut-away state if showCutAwayFinder is enabled
    if (userSettings.showCutAwayFinder && userSettings.calculateJump) {
        let center, descentTime, displacementDistance, stateLabel, verticalSpeedSelected;
        switch (userSettings.cutAwayState) {
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
                console.warn('Unknown cutAwayState:', userSettings.cutAwayState);
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
        console.log('Added cut-away circle:', { center, radius, stateLabel });
    }
    console.log('calculateCutAway completed', {
        cutAwayMarkerExists: !!cutAwayMarker,
        cutAwayCircleExists: !!cutAwayCircle
    });
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

    const baseCourseObj = Utils.calculateCourseFromHeading(baseHeading, baseWindDir, baseWindSpeedKt, CANOPY_SPEED_KT);
    const baseCourse = baseCourseObj.trueCourse;
    const baseGroundSpeedKt = baseCourseObj.groundSpeed;
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
    let baseBearing = (baseCourse + 180) % 360;

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
    const downwindHeading = Utils.normalizeAngle((downwindCourse - downwindWca + 180) % 360);
    const downwindCourseObj = Utils.calculateCourseFromHeading(downwindHeading, downwindWindDir, downwindWindSpeedKt, CANOPY_SPEED_KT);
    const downwindGroundSpeedKt = downwindCourseObj.groundSpeed;
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
function initializeApp() {
    if (isInitialized) {
        console.log('App already initialized, skipping');
        return;
    }
    isInitialized = true;
    console.log('Initializing app');

    console.log('Initial userSettings:', userSettings);
    userSettings.calculateJump = true;
    saveSettings();

    setupCheckboxEvents();
    setupSliderEvents();
}
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
    if (!slider) {
        console.warn('Time slider not found:', { id: 'timeSlider' });
        return;
    }

    // Use 'input' event for real-time updates
    slider.addEventListener('input', async () => {
        const sliderIndex = parseInt(slider.value) || 0;
        console.log('Time slider moved to index:', sliderIndex);

        if (weatherData && lastLat && lastLng) {
            await updateWeatherDisplay(sliderIndex);
            if (lastAltitude !== 'N/A') calculateMeanWind();
            if (userSettings.showLandingPattern) {
                console.log('Updating landing pattern for slider index:', sliderIndex);
                updateLandingPattern();
            }
            if (userSettings.calculateJump) {
                console.log('Recalculating jump for slider index:', sliderIndex);
                clearJumpCircles();
                calculateJump();
                calculateCutAway();
            }
            if (userSettings.showJumpRunTrack) {
                console.log('Updating jump run track for slider index:', sliderIndex);
                updateJumpRunTrack();
            }
            recenterMap();
            updateLivePositionControl();
        } else {
            console.warn('Cannot update displays: missing data', {
                weatherData: !!weatherData,
                lastLat,
                lastLng
            });
        }
    });

    slider.addEventListener('change', async () => {
        const sliderIndex = parseInt(slider.value) || 0;
        if (weatherData?.time?.[sliderIndex]) {
            const displayTime = await getDisplayTime(weatherData.time[sliderIndex]);
            const timeLabel = document.getElementById('timeLabel');
            if (timeLabel) {
                timeLabel.textContent = `Time: ${displayTime}`;
                console.log('Updated time label:', displayTime);
            }
        }
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
                    debouncedCalculateJump(); // Use debounced version
                    calculateCutAway();
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
            }
            if (cutAwayMarker && cutAwayLat && cutAwayLng) {
                console.log('Updating cut-away marker popup for model change');
                const wasOpen = cutAwayMarker.getPopup()?.isOpen() || false;
                updateCutAwayMarkerPopup(cutAwayMarker, cutAwayLat, cutAwayLng, wasOpen);
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
        menu.classList.add('hidden');
        console.log('Menu initialized as hidden on load');

        const computedStyle = window.getComputedStyle(menu);
        console.log('Initial menu styles:', {
            display: computedStyle.display,
            visibility: computedStyle.visibility,
            opacity: computedStyle.opacity,
            hasHiddenClass: menu.classList.contains('hidden')
        });

        hamburgerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            menu.classList.toggle('hidden');
            const isHidden = menu.classList.contains('hidden');
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
        if (lastMouseLatLng && coordsControl) {
            const coordFormat = getCoordinateFormat();
            const lat = lastMouseLatLng.lat;
            const lng = lastMouseLatLng.lng;
            let coordText;
            if (coordFormat === 'MGRS') {
                const mgrs = Utils.decimalToMgrs(lat, lng);
                coordText = `MGRS: ${mgrs}`;
            } else {
                coordText = `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;
            }
            debouncedGetElevation(lat, lng, { lat, lng }, (elevation, requestLatLng) => {
                if (lastMouseLatLng) {
                    const deltaLat = Math.abs(lastMouseLatLng.lat - requestLatLng.lat);
                    const deltaLng = Math.abs(lastMouseLatLng.lng - requestLatLng.lng);
                    const threshold = 0.05;
                    if (deltaLat < threshold && deltaLng < threshold) {
                        const heightUnit = getHeightUnit();
                        let displayElevation = elevation === 'N/A' ? 'N/A' : elevation;
                        if (displayElevation !== 'N/A') {
                            displayElevation = Utils.convertHeight(displayElevation, heightUnit);
                            displayElevation = Math.round(displayElevation);
                        }
                        console.log('Updating elevation display after heightUnit change:', { lat, lng, elevation, heightUnit, displayElevation });
                        coordsControl.update(`${coordText}<br>Elevation: ${displayElevation} ${displayElevation === 'N/A' ? '' : heightUnit}`);
                    }
                }
            });
        }
        if (gpxLayer && gpxPoints.length > 0) {
            const groundAltitude = lastAltitude !== 'N/A' && !isNaN(lastAltitude) ? parseFloat(lastAltitude) : null;
            const windUnit = getWindSpeedUnit();
            const heightUnit = getHeightUnit();
            gpxLayer.eachLayer(layer => {
                if (layer instanceof L.Polyline) {
                    layer.on('mousemove', function (e) {
                        const latlng = e.latlng;
                        let closestPoint = gpxPoints[0];
                        let minDist = Infinity;
                        let closestIndex = 0;
                        gpxPoints.forEach((p, index) => {
                            const dist = Math.sqrt(Math.pow(p.lat - latlng.lat, 2) + Math.pow(p.lng - latlng.lng, 2));
                            if (dist < minDist) {
                                minDist = dist;
                                closestPoint = p;
                                closestIndex = index;
                            }
                        });
                        layer.setTooltipContent(getTooltipContent(closestPoint, closestIndex, gpxPoints, groundAltitude, windUnit, heightUnit)).openTooltip(latlng);
                    });
                }
            });
        }
    });
    setupRadioGroup('temperatureUnit', () => {
        updateAllDisplays();
    });
    setupRadioGroup('windUnit', () => {
        updateWindUnitLabels();
        updateAllDisplays();
        if (gpxLayer && gpxPoints.length > 0) {
            const groundAltitude = lastAltitude !== 'N/A' && !isNaN(lastAltitude) ? parseFloat(lastAltitude) : null;
            const windUnit = getWindSpeedUnit();
            const heightUnit = getHeightUnit();
            gpxLayer.eachLayer(layer => {
                if (layer instanceof L.Polyline) {
                    layer.on('mousemove', function (e) {
                        const latlng = e.latlng;
                        let closestPoint = gpxPoints[0];
                        let minDist = Infinity;
                        let closestIndex = 0;
                        gpxPoints.forEach((p, index) => {
                            const dist = Math.sqrt(Math.pow(p.lat - latlng.lat, 2) + Math.pow(p.lng - latlng.lng, 2));
                            if (dist < minDist) {
                                minDist = dist;
                                closestPoint = p;
                                closestIndex = index;
                            }
                        });
                        layer.setTooltipContent(getTooltipContent(closestPoint, closestIndex, gpxPoints, groundAltitude, windUnit, heightUnit)).openTooltip(latlng);
                    });
                }
            });
        }
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
        userSettings.cutAwayState = getSettingValue('cutAwayState', 'radio', 'Partially');
        saveSettings();
        console.log('cutAwayState changed:', userSettings.cutAwayState);
        if (userSettings.showCutAwayFinder && userSettings.calculateJump && weatherData && lastLat && lastLng) {
            console.log('Recalculating cut-away for state change');
            debouncedCalculateJump(); // Use debounced version
            calculateCutAway();
        }
    });
    setupRadioGroup('jumpMasterLineTarget', () => {
        userSettings.jumpMasterLineTarget = getSettingValue('jumpMasterLineTarget', 'radio', 'DIP');
        saveSettings();
        console.log('jumpMasterLineTarget changed:', userSettings.jumpMasterLineTarget);
        if (userSettings.showJumpMasterLine && liveMarker) {
            debouncedPositionUpdate({
                coords: {
                    latitude: lastLatitude,
                    longitude: lastLongitude,
                    accuracy: lastAccuracy,
                    altitude: lastDeviceAltitude,
                    altitudeAccuracy: lastAltitudeAccuracy
                }
            });
        }
        // Disable HARP if no marker
        const harpRadio = document.querySelector('input[name="jumpMasterLineTarget"][value="HARP"]');
        if (harpRadio) {
            harpRadio.disabled = !harpMarker || userSettings.harpLat === null || userSettings.harpLng === null;
            console.log('HARP radio button disabled:', harpRadio.disabled);
        }
    });
    // Trigger initial tooltip refresh for heightUnit
    if (gpxLayer && gpxPoints.length > 0) {
        const groundAltitude = lastAltitude !== 'N/A' && !isNaN(lastAltitude) ? parseFloat(lastAltitude) : null;
        const windUnit = getWindSpeedUnit();
        const heightUnit = getHeightUnit();
        gpxLayer.eachLayer(layer => {
            if (layer instanceof L.Polyline) {
                layer.on('mousemove', function (e) {
                    const latlng = e.latlng;
                    let closestPoint = gpxPoints[0];
                    let minDist = Infinity;
                    let closestIndex = 0;
                    gpxPoints.forEach((p, index) => {
                        const dist = Math.sqrt(Math.pow(p.lat - latlng.lat, 2) + Math.pow(p.lng - latlng.lng, 2));
                        if (dist < minDist) {
                            minDist = dist;
                            closestPoint = p;
                            closestIndex = index;
                        }
                    });
                    layer.setTooltipContent(getTooltipContent(closestPoint, closestIndex, gpxPoints, groundAltitude, windUnit, heightUnit)).openTooltip(latlng);
                });
            }
        });
    }
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
                debouncedCalculateJump(); // Use debounced version
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
            if (userSettings.calculateJump && weatherData && lastLat && lastLng) debouncedCalculateJump(); // Use debounced version
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
                    debouncedCalculateJump(); // Use debounced version
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
                    debouncedCalculateJump(); // Use debounced version
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
    setupInput('jumpRunTrackForwardOffset', 'change', 0, (value) => {
        const offset = parseInt(value, 10);
        console.log('jumpRunTrackForwardOffset change event:', { value, offset });
        if (!isNaN(offset) && offset >= -50000 && offset <= 50000 && offset % 100 === 0) {
            userSettings.jumpRunTrackForwardOffset = offset;
            saveSettings();
            if (userSettings.calculateJump && userSettings.showJumpRunTrack && weatherData && lastLat && lastLng) {
                console.log('Updating JRT for forward offset change');
                updateJumpRunTrack();
            }
        } else {
            Utils.handleError('Forward offset must be between -50000 and 50000 in steps of 100.');
            const offsetInput = document.getElementById('jumpRunTrackForwardOffset');
            if (offsetInput) {
                offsetInput.value = 0;
            }
            userSettings.jumpRunTrackForwardOffset = 0;
            saveSettings();
            if (userSettings.calculateJump && userSettings.showJumpRunTrack) {
                console.log('Resetting JRT for invalid forward offset');
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
                debouncedCalculateJump(); // Use debounced version
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
                debouncedCalculateJump(); // Use debounced version
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
                debouncedCalculateJump(); // Use debounced version
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
            if (userSettings.showCutAwayFinder && userSettings.calculateJump && weatherData && cutAwayLat !== null && cutAwayLng !== null) {
                console.log('Recalculating jump for cut-away altitude change');
                debouncedCalculateJump(); // Use debounced version
                calculateCutAway();
            }
        } else {
            Utils.handleError('Cut away altitude must be between 400 and 15000 meters.');
            setInputValue('cutAwayAltitude', 1000);
            userSettings.cutAwayAltitude = 1000;
            saveSettings();
        }
    });
    setupInput('historicalDatePicker', 'change', 300, (value) => {
        console.log('historicalDatePicker changed to:', value);
        if (lastLat && lastLng) {
            fetchWeatherForLocation(lastLat, lastLng, value ? `${value}T00:00:00Z` : null);
        } else {
            Utils.handleError('Please select a position on the map first.');
        }
    });
}
function setupCheckboxEvents() {
    setupCheckbox('showTableCheckbox', 'showTable', (checkbox) => {
        userSettings.showTable = checkbox.checked;
        saveSettings();
        console.log('showTableCheckbox changed:', checkbox.checked);
        const info = document.getElementById('info');
        if (info) {
            info.style.display = checkbox.checked ? 'block' : 'none';
            console.log('Info display set to:', info.style.display);
        }
        if (checkbox.checked && weatherData && lastLat && lastLng) {
            updateWeatherDisplay(getSliderValue());
        }
        recenterMap();
    });

    setupCheckbox('showExitAreaCheckbox', 'showExitArea', (checkbox) => {
        userSettings.showExitArea = checkbox.checked;
        saveSettings();
        checkbox.checked = userSettings.showExitArea;
        console.log('Show Exit Area set to:', userSettings.showExitArea);
        if (checkbox.checked && weatherData && lastLat && lastLng) {
            const exitResult = calculateExitCircle();
            if (exitResult) {
                updateJumpCircle(
                    exitResult.darkGreenLat, exitResult.darkGreenLng,
                    exitResult.greenLat, exitResult.greenLng,
                    exitResult.darkGreenRadius, exitResult.greenRadius,
                    [], [], [], [],
                    0, 0, 0, 0,
                    exitResult.freeFallDirection, exitResult.freeFallDistance, exitResult.freeFallTime,
                    true, false
                );
            }
            calculateCutAway();
        } else {
            clearJumpCircles();
            calculateJump(); // Re-render active circles
            console.log('Cleared exit circles and re-rendered active circles');
        }
    });

    setupCheckbox('showCanopyAreaCheckbox', 'showCanopyArea', (checkbox) => {
        userSettings.showCanopyArea = checkbox.checked;
        saveSettings();
        checkbox.checked = userSettings.showCanopyArea;
        console.log('Show Canopy Area set to:', userSettings.showCanopyArea);
        if (checkbox.checked && weatherData && lastLat && lastLng) {
            const canopyResult = calculateCanopyCircles();
            if (canopyResult) {
                updateJumpCircle(
                    canopyResult.blueLat, canopyResult.blueLng,
                    canopyResult.redLat, canopyResult.redLng,
                    canopyResult.radius, canopyResult.radiusFull,
                    canopyResult.additionalBlueRadii, canopyResult.additionalBlueDisplacements,
                    canopyResult.additionalBlueDirections, canopyResult.additionalBlueUpperLimits,
                    canopyResult.displacement, canopyResult.displacementFull,
                    canopyResult.direction, canopyResult.directionFull,
                    canopyResult.freeFallDirection, canopyResult.freeFallDistance, canopyResult.freeFallTime,
                    false, true
                );
            }
            calculateCutAway();
        } else {
            if (jumpCircle) {
                map.removeLayer(jumpCircle);
                jumpCircle = null;
            }
            if (jumpCircleFull) {
                map.removeLayer(jumpCircleFull);
                jumpCircleFull = null;
            }
            if (window.additionalBlueCircles) {
                window.additionalBlueCircles.forEach(circle => map.removeLayer(circle));
                window.additionalBlueCircles = [];
            }
            if (window.additionalBlueLabels) {
                window.additionalBlueLabels.forEach(label => map.removeLayer(label));
                window.additionalBlueLabels = [];
            }
            console.log('Cleared blue and red circles and labels');
        }
    });

    setupCheckbox('showJumpRunTrack', 'showJumpRunTrack', (checkbox) => {
        userSettings.showJumpRunTrack = checkbox.checked;
        saveSettings();
        checkbox.checked = userSettings.showJumpRunTrack;
        console.log('showJumpRunTrack changed:', checkbox.checked);
        if (checkbox.checked && weatherData && lastLat && lastLng) {
            calculateJumpRunTrack();
        } else {
            if (jumpRunTrackLayer) {
                if (jumpRunTrackLayer.airplaneMarker) {
                    map.removeLayer(jumpRunTrackLayer.airplaneMarker);
                    jumpRunTrackLayer.airplaneMarker = null;
                }
                if (jumpRunTrackLayer.approachLayer) {
                    map.removeLayer(jumpRunTrackLayer.approachLayer);
                    jumpRunTrackLayer.approachLayer = null;
                }
                map.removeLayer(jumpRunTrackLayer);
                jumpRunTrackLayer = null;
                console.log('Removed JRT polyline');
            }
            const directionInput = document.getElementById('jumpRunTrackDirection');
            if (directionInput) {
                const trackData = jumpRunTrack();
                directionInput.value = trackData ? trackData.direction : '';
                console.log('Updated jumpRunTrackDirection value:', trackData?.direction || '');
            }
        }
    });

    setupCheckbox('showCutAwayFinder', 'showCutAwayFinder', (checkbox) => {
        console.log('showCutAwayFinder checkbox changed to:', checkbox.checked);
        userSettings.showCutAwayFinder = checkbox.checked;
        saveSettings();
        toggleSubmenu('showCutAwayFinder', checkbox.checked);
        if (checkbox.checked && weatherData && cutAwayLat !== null && cutAwayLng !== null) {
            console.log('Show Cut Away Finder enabled, running calculateCutAway');
            calculateCutAway();
        } else {
            if (cutAwayCircle) {
                map.removeLayer(cutAwayCircle);
                cutAwayCircle = null;
                console.log('Cleared cut-away circle');
            }
            if (cutAwayMarker) {
                map.removeLayer(cutAwayMarker);
                cutAwayMarker = null;
                console.log('Cleared cut-away marker');
            }
            cutAwayLat = null;
            cutAwayLng = null;
            console.log('Cleared cutAwayLat and cutAwayLng');
        }
    });

    setupCheckbox('showLandingPattern', 'showLandingPattern', (checkbox) => {
        console.log('showLandingPattern checkbox changed to:', checkbox.checked);
        const enableFeature = () => {
            userSettings.showLandingPattern = true;
            saveSettings();
            toggleSubmenu('showLandingPattern', true);
            if (weatherData && lastLat && lastLng) {
                updateLandingPattern();
                recenterMap();
            }
        };

        const disableFeature = () => {
            userSettings.showLandingPattern = false;
            saveSettings();
            checkbox.checked = false;
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
                enableFeature();
            } else {
                showPasswordModal('landingPattern', () => {
                    enableFeature();
                }, () => {
                    disableFeature();
                });
            }
        } else {
            disableFeature();
        }
    });

    setupCheckbox('trackPositionCheckbox', 'trackPosition', (checkbox) => {
        console.log('trackPositionCheckbox changed to:', checkbox.checked);
        userSettings.trackPosition = checkbox.checked;
        saveSettings();
        toggleSubmenu('trackPositionCheckbox', checkbox.checked);
        if (checkbox.checked) {
            startPositionTracking();
        } else {
            stopPositionTracking();
            if (livePositionControl) {
                livePositionControl.update(
                    0,
                    0,
                    null,
                    null,
                    0,
                    'N/A',
                    'kt',
                    'N/A',
                    false,
                    null
                );
                livePositionControl._container.style.display = 'none';
                console.log('Cleared livePositionControl content and hid panel');
            }
        }
    });

    setupCheckbox('showJumpMasterLine', 'showJumpMasterLine', (checkbox) => {
        console.log('showJumpMasterLine checkbox changed to:', checkbox.checked);
        userSettings.showJumpMasterLine = checkbox.checked;
        saveSettings();
        toggleSubmenu('showJumpMasterLine', checkbox.checked);
        if (!checkbox.checked) {
            if (jumpMasterLine) {
                map.removeLayer(jumpMasterLine);
                jumpMasterLine = null;
                console.log('Removed Jump Master Line: unchecked');
            }
            if (livePositionControl) {
                livePositionControl.update(
                    lastLatitude || 0,
                    lastLongitude || 0,
                    lastDeviceAltitude,
                    lastAltitudeAccuracy,
                    lastAccuracy,
                    lastSpeed,
                    lastEffectiveWindUnit,
                    lastDirection,
                    false,
                    null
                );
                console.log('Cleared jump master line data from livePositionControl');
            }
        } else if (liveMarker && livePositionControl) {
            livePositionControl.update(
                lastLatitude || 0,
                lastLongitude || 0,
                lastDeviceAltitude,
                lastAltitudeAccuracy,
                lastAccuracy,
                lastSpeed,
                lastEffectiveWindUnit,
                lastDirection,
                true,
                null
            );
            debouncedPositionUpdate({
                coords: {
                    latitude: lastLatitude || 0,
                    longitude: lastLongitude || 0,
                    accuracy: lastAccuracy || 0,
                    altitude: lastDeviceAltitude,
                    altitudeAccuracy: lastAltitudeAccuracy
                }
            });
        }
    });

    const harpRadio = document.querySelector('input[name="jumpMasterLineTarget"][value="HARP"]');
    if (harpRadio) {
        harpRadio.disabled = !userSettings.harpLat || !userSettings.harpLng;
        console.log('HARP radio button initialized, disabled:', harpRadio.disabled);
    }

    const placeHarpButton = document.getElementById('placeHarpButton');
    if (placeHarpButton) {
        placeHarpButton.addEventListener('click', () => {
            isPlacingHarp = true;
            console.log('HARP placement mode activated');
            map.on('click', handleHarpPlacement);
            Utils.handleMessage('Click the map to place the HARP marker');
        });
    }

    const clearHarpButton = document.getElementById('clearHarpButton');
    if (clearHarpButton) {
        clearHarpButton.addEventListener('click', clearHarpMarker);
    }

    const menu = document.querySelector('.hamburger-menu');
    if (menu) {
        menu.addEventListener('click', (e) => {
            console.log('Menu click:', e.target, 'class:', e.target.className, 'id:', e.target.id);
        });
    }
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
                configureMarker(lat, lng, lastAltitude, false);
                resetJumpRunDirection(true);
                addCoordToHistory(lat, lng);
                if (userSettings.calculateJump) {
                    console.log('Recalculating jump for coordinate input');
                    debouncedCalculateJump();
                    calculateCutAway();
                }
                recenterMap(true);
                isManualPanning = false;

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
function setupGpxTrackEvents() {
    console.log('Setting up GPX track events');
    const gpxFileInput = document.getElementById('gpxFileInput');
    if (gpxFileInput) {
        gpxFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            console.log('GPX file selected:', file?.name);
            loadGpxTrack(file);
        });
    } else {
        console.warn('GPX file input not found:', { id: 'gpxFileInput' });
    }
    const clearGpxButton = document.getElementById('clearGpxTrack'); // Fixed ID
    if (clearGpxButton) {
        clearGpxButton.addEventListener('click', () => {
            console.log('Clear GPX button clicked');
            if (gpxLayer) {
                try {
                    map.removeLayer(gpxLayer);
                    gpxLayer = null;
                    gpxPoints = [];
                    console.log('Cleared GPX track');
                    const infoElement = document.getElementById('info');
                    if (infoElement) {
                        infoElement.innerHTML = 'Click on the map to fetch weather data.';
                    } else {
                        console.warn('Info element not found:', { id: 'info' });
                    }
                    if (gpxFileInput) {
                        gpxFileInput.value = '';
                    } else {
                        console.warn('GPX file input not found for clearing:', { id: 'gpxFileInput' });
                    }
                } catch (error) {
                    console.error('Error clearing GPX track:', error);
                    Utils.handleError('Failed to clear GPX track: ' + error.message);
                }
            } else {
                console.log('No GPX track to clear');
                Utils.handleError('No GPX track to clear.');
            }
        });
    } else {
        console.warn('Clear GPX button not found:', { id: 'clearGpxTrack' });
    }
}
function setupCheckbox(id, setting, callback) {
    console.log(`setupCheckbox called for id: ${id}`);
    const checkbox = document.getElementById(id);
    if (checkbox) {
        if (checkbox._changeHandler) {
            checkbox.removeEventListener('change', checkbox._changeHandler);
            console.log(`Removed previous change listener for ${id}`);
        }
        checkbox._changeHandler = (event) => {
            console.log(`Change event fired for ${id}, checked: ${checkbox.checked}, event:`, event);
            event.stopPropagation();
            callback(checkbox);
        };
        checkbox.addEventListener('change', checkbox._changeHandler);
        checkbox.addEventListener('click', (event) => {
            console.log(`Click event on ${id}, checked: ${checkbox.checked}, target:`, event.target);
        });
        console.log(`Attached change and click listeners to ${id}`);
        checkbox.checked = userSettings[setting];
    } else {
        console.warn(`Checkbox ${id} not found`);
    }
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
function setupResetCutAwayMarkerButton() {
    const resetButton = document.getElementById('resetCutAwayMarker');
    if (resetButton) {
        resetButton.addEventListener('click', () => {
            if (cutAwayMarker) {
                map.removeLayer(cutAwayMarker);
                cutAwayMarker = null;
                cutAwayLat = null;
                cutAwayLng = null;
                console.log('Cut-away marker reset');
                if (cutAwayCircle) {
                    map.removeLayer(cutAwayCircle);
                    cutAwayCircle = null;
                    console.log('Cleared cut-away circle');
                }
                document.getElementById('info').innerHTML = 'Right-click map to place cut-away marker';
            }
        });
    }
}
function setupClearHistoricalDate() {
    const clearButton = document.getElementById('clearHistoricalDate');
    if (clearButton) {
        clearButton.addEventListener('click', () => {
            const datePicker = document.getElementById('historicalDatePicker');
            if (datePicker) {
                datePicker.value = ''; // Clear the date picker
                console.log('Cleared historical date, refetching forecast data');
                if (lastLat && lastLng) {
                    fetchWeatherForLocation(lastLat, lastLng, null); // Refetch forecast data
                } else {
                    Utils.handleError('Please select a position on the map first.');
                }
            }
        });
    }
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
    if (!checkbox) {
        console.warn(`Checkbox ${id} not found`);
        return;
    }
    let submenu = checkbox.parentElement.nextElementSibling;
    if (!submenu || !submenu.classList.contains('submenu')) {
        submenu = checkbox.closest('li')?.querySelector(':scope > ul.submenu');
    }
    if (submenu) {
        submenu.classList.toggle('hidden', !isVisible);
        checkbox.setAttribute('aria-expanded', isVisible);
        console.log(`Submenu for ${id} visibility:`, !submenu.classList.contains('hidden'));
    } else {
        console.warn(`Submenu for ${id} not found`);
    }
}
function clearJumpCircles() {
    console.log('Clearing all jump circles');
    const removeLayer = (layer, name) => {
        if (layer && typeof layer === 'object' && '_leaflet_id' in layer && map.hasLayer(layer)) {
            console.log(`Removing ${name}`);
            map.removeLayer(layer);
        } else if (layer) {
            console.warn(`Layer ${name} not removed: not on map or invalid`, { layer });
        }
    };

    removeLayer(jumpCircle, 'blue circle');
    removeLayer(jumpCircleFull, 'red circle');
    removeLayer(jumpCircleGreen, 'green circle');
    removeLayer(jumpCircleGreenLight, 'dark green circle');

    if (window.additionalBlueCircles) {
        window.additionalBlueCircles.forEach((circle, i) => removeLayer(circle, `additional blue circle ${i}`));
        window.additionalBlueCircles = [];
    }
    if (window.additionalBlueLabels) {
        window.additionalBlueLabels.forEach((label, i) => removeLayer(label, `additional blue label ${i}`));
        window.additionalBlueLabels = [];
    }

    jumpCircle = null;
    jumpCircleFull = null;
    jumpCircleGreen = null;
    jumpCircleGreenLight = null;
    console.log('All jump circles cleared', {
        blue: !!jumpCircle,
        red: !!jumpCircleFull,
        green: !!jumpCircleGreen,
        darkGreen: !!jumpCircleGreenLight,
        additionalBlueCircles: window.additionalBlueCircles?.length || 0,
        additionalBlueLabels: window.additionalBlueLabels?.length || 0
    });
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
            weatherData && lastLat && lastLng && id === 'legHeightDownwind' && userSettings.calculateJump && debouncedCalculateJump(); // Use debounced version
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
    console.log('updateAllDisplays called');
    try {
        const sliderIndex = getSliderValue();
        if (weatherData && lastLat && lastLng) {
            await updateWeatherDisplay(sliderIndex);
            if (lastAltitude !== 'N/A') calculateMeanWind();
            if (userSettings.showLandingPattern) updateLandingPattern();
            if (userSettings.calculateJump) {
                debouncedCalculateJump();
                calculateCutAway();
                if (userSettings.showJumpRunTrack) updateJumpRunTrack();
            }
            recenterMap();
        }
        updateLivePositionControl();
        // Update Jump Master Line distance unit if active
        if (jumpMasterLine && liveMarker && currentMarker && lastLat !== null && lastLng !== null) {
            const liveLatLng = liveMarker.getLatLng();
            const dipLatLng = currentMarker.getLatLng();
            const bearing = calculateBearing(liveLatLng.lat, liveLatLng.lng, dipLatLng.lat, dipLatLng.lng).toFixed(0);
            const distanceMeters = map.distance(liveLatLng, dipLatLng);
            const heightUnit = getHeightUnit();
            const convertedDistance = Utils.convertHeight(distanceMeters, heightUnit);
            const roundedDistance = Math.round(convertedDistance);
            jumpMasterLine.setPopupContent(`<b>Jump Master Line</b><br>Bearing: ${bearing}°<br>Distance: ${roundedDistance} ${heightUnit}`);
            console.log('Updated Jump Master Line popup for heightUnit:', { bearing, distance: roundedDistance, unit: heightUnit });
        }
    } catch (error) {
        console.error('Error in updateAllDisplays:', error);
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
    setupResetCutAwayMarkerButton();
    setupClearHistoricalDate(); // Add this line
    setupGpxTrackEvents(); // Add this line
});