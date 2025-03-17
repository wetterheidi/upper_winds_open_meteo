let map;
let weatherData = null;
let lastLat = null;
let lastLng = null;
let lastAltitude = null;
let currentMarker = null;
let lastModelRun = null;

// Update model run info in menu
function updateModelRunInfo() {
    const modelRunInfo = document.getElementById('modelRunInfo');
    const modelSelect = document.getElementById('modelSelect');
    if (modelRunInfo && lastModelRun) {
        const model = modelSelect.value;
        modelRunInfo.innerHTML = `Model: ${model.replace('_', ' ').toUpperCase()}<br> Run: ${lastModelRun}`;
    }
    // Activate this to switch to local time for model run info and modify function to async function
    /*if (modelRunInfo && lastModelRun) {
        const model = modelSelect.value;
        const timeZone = document.querySelector('input[name="timeZone"]:checked')?.value || 'Z';
        const displayTime = timeZone === 'Z' || !lastLat || !lastLng
            ? lastModelRun
            : await Utils.formatLocalTime(lastModelRun.replace(' ', 'T') + ':00Z', lastLat, lastLng);
        modelRunInfo.innerHTML = `Model: ${model.replace('_', ' ').toUpperCase()}<br> Run: ${displayTime}`;
    }*/
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

function getTemperatureUnit() {
    return document.querySelector('input[name="temperatureUnit"]:checked')?.value || 'C';
}

function getHeightUnit() {
    return document.querySelector('input[name="heightUnit"]:checked')?.value || 'm';
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
    const windSpeedUnit = getWindSpeedUnit(); // Get the currently selected wind speed unit
    const meanWindResult = document.getElementById('meanWindResult');

    if (meanWindResult && meanWindResult.innerHTML) {
        const currentText = meanWindResult.innerHTML;
        // Regular expression to match the wind speed portion (e.g., "10 kt", "18.5 km/h")
        const regex = /(\d+(?:\.\d+)?)\s*([a-zA-Z]+)/;
        if (regex.test(currentText)) {
            const [_, speedValue, currentUnit] = currentText.match(regex);
            const numericSpeed = parseFloat(speedValue);
            if (!isNaN(numericSpeed)) {
                // Convert the wind speed to the new unit
                const newSpeed = Utils.convertWind(numericSpeed, windSpeedUnit);
                const formattedSpeed = newSpeed === 'N/A' ? 'N/A' : (windSpeedUnit === 'bft' ? Math.round(newSpeed) : newSpeed.toFixed(1));
                // Replace the old speed and unit with the new ones
                const newText = currentText.replace(regex, `${formattedSpeed} ${windSpeedUnit}`);
                meanWindResult.innerHTML = newText;
            } else {
                console.warn('Invalid speed value in meanWindResult:', speedValue);
            }
        }
    }
}

async function getDisplayTime(utcTimeStr) {
    const timeZone = document.querySelector('input[name="timeZone"]:checked')?.value || 'Z';
    if (timeZone === 'Z' || !lastLat || !lastLng) {
        return Utils.formatTime(utcTimeStr); // Synchronous
    } else {
        return await Utils.formatLocalTime(utcTimeStr, lastLat, lastLng); // Async
    }
}

// Initialize the map and center it on the user's location if available
function initMap() {
    const defaultCenter = [48.0179, 11.1923];
    const defaultZoom = 10;

    map = L.map('map');
    map.setView(defaultCenter, defaultZoom);

    // Define base layers
    const baseMaps = {
        "OpenStreetMap": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }),
        "OpenTopoMap": L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            maxZoom: 17,
            attribution: 'Map data: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'
        })
    };

    // Add default layer (e.g., OpenTopoMap)
    baseMaps["OpenTopoMap"].addTo(map);

    // Add layer control
    L.control.layers(baseMaps).addTo(map);

    // Rest of your code remains unchanged
    const customIcon = L.icon({
        iconUrl: 'favicon.ico',
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32],
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        shadowSize: [41, 41],
        shadowAnchor: [13, 32]
    });

    const initialAltitude = 'N/A';
    const initialPopup = L.popup({ offset: [0, 10] })
        .setLatLng(defaultCenter)
        .setContent(`Lat: ${defaultCenter[0].toFixed(4)}<br>Lng: ${defaultCenter[1].toFixed(4)}<br>Alt: ${initialAltitude}`);
    currentMarker = L.marker(defaultCenter, { icon: customIcon })
        .bindPopup(initialPopup)
        .addTo(map)
        .openPopup();

    recenterMap();

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const userCoords = [position.coords.latitude, position.coords.longitude];
                map.setView(userCoords, defaultZoom);

                if (currentMarker) currentMarker.remove();
                lastLat = position.coords.latitude;
                lastLng = position.coords.longitude;
                lastAltitude = await getAltitude(lastLat, lastLng); // Await the async call

                const popup = L.popup({ offset: [0, 10] })
                    .setLatLng(userCoords)
                    .setContent(`Lat: ${lastLat.toFixed(4)}<br>Lng: ${lastLng.toFixed(4)}<br>Alt: ${lastAltitude}m`);
                currentMarker = L.marker(userCoords, { icon: customIcon })
                    .bindPopup(popup)
                    .addTo(map)
                    .openPopup();

                recenterMap();

                document.getElementById('info').innerHTML = `Fetching weather and models...`;
                const availableModels = await checkAvailableModels(lastLat, lastLng);
                if (availableModels.length > 0) {
                    await fetchWeather(lastLat, lastLng);
                    updateModelRunInfo();
                    if (weatherData && lastAltitude !== 'N/A') calculateMeanWind();
                } else {
                    document.getElementById('info').innerHTML = `No models available.`;
                }
            },
            async (error) => {
                console.warn(`Geolocation error: ${error.message}`);
                displayError('Unable to retrieve your location. Using default location.');
                lastLat = defaultCenter[0];
                lastLng = defaultCenter[1];
                lastAltitude = await getAltitude(lastLat, lastLng); // Await here too
                const popup = L.popup({ offset: [0, 10] })
                    .setLatLng(defaultCenter)
                    .setContent(`Lat: ${lastLat.toFixed(4)}<br>Lng: ${lastLng.toFixed(4)}<br>Alt: ${lastAltitude}m`);
                if (currentMarker) {
                    currentMarker.setPopupContent(popup.getContent()).openPopup();
                }
                recenterMap();

                document.getElementById('info').innerHTML = `Fetching weather and models...`;
                const availableModels = await checkAvailableModels(lastLat, lastLng);
                if (availableModels.length > 0) {
                    await fetchWeather(lastLat, lastLng);
                    updateModelRunInfo();
                    await updateWeatherDisplay(0);
                    if (lastAltitude !== 'N/A') calculateMeanWind();
                } else {
                    document.getElementById('info').innerHTML = `No models available.`;
                }
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    } else {
        console.warn('Geolocation not supported.');
        displayError('Geolocation not supported. Using default location.');
        lastLat = defaultCenter[0];
        lastLng = defaultCenter[1];
        lastAltitude = getAltitude(lastLat, lastLng);
        const popup = L.popup({ offset: [0, 10] })
            .setLatLng(defaultCenter)
            .setContent(`Lat: ${lastLat.toFixed(4)}<br>Lng: ${lastLng.toFixed(4)}<br>Alt: ${lastAltitude}m`);
        if (currentMarker) {
            currentMarker.setPopupContent(popup.getContent()).openPopup();
        }
        recenterMap();

        document.getElementById('info').innerHTML = `Fetching weather and models...`;
        const availableModels = checkAvailableModels(lastLat, lastLng);
        if (availableModels.length > 0) {
            fetchWeather(lastLat, lastLng);
            if (lastAltitude !== 'N/A') calculateMeanWind();
        } else {
            document.getElementById('info').innerHTML = `No models available.`;
        }
    }

    map.on('click', async (e) => {
        const { lat, lng } = e.latlng;
        lastLat = lat;
        lastLng = lng;
        lastAltitude = await getAltitude(lat, lng);

        if (currentMarker) currentMarker.remove();

        const popup = L.popup({ offset: [0, 10] })
            .setLatLng([lat, lng])
            .setContent(`Lat: ${lat.toFixed(4)}<br>Lng: ${lng.toFixed(4)}<br>Alt: ${lastAltitude}m`);
        currentMarker = L.marker([lat, lng], { icon: customIcon })
            .bindPopup(popup)
            .addTo(map)
            .openPopup();

        recenterMap();

        document.getElementById('info').innerHTML = `Fetching weather and models...`;
        const availableModels = await checkAvailableModels(lat, lng);
        if (availableModels.length > 0) {
            await fetchWeather(lat, lng);
            if (lastAltitude !== 'N/A') calculateMeanWind();
        } else {
            document.getElementById('info').innerHTML = `No models available.`;
        }
    });
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
        const metaResponse = await fetch(`https://api.open-meteo.com/data/${model}/static/meta.json`);
        if (!metaResponse.ok) throw new Error(`Meta fetch failed: ${metaResponse.status}`);
        const metaData = await metaResponse.json();

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
        console.log('Forecast Start Date (UTC):', startDateStr);

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
            `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,` +
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
            throw new Error(`HTTP error! Status: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        console.log('Raw API Response:', data);
        const targetIndex = 0;
        const firstTime = data.hourly.time[targetIndex];
        console.log(`Using first available time (UTC): ${firstTime} at index: ${targetIndex}`);

        // Identify the last valid index where key data are non-null
        const keyVariables = [
            'temperature_2m', 'relative_humidity_2m', 'wind_speed_10m', 'wind_direction_10m', // Surface data
            'temperature_1000hPa', 'relative_humidity_1000hPa', 'wind_speed_1000hPa', 'wind_direction_1000hPa', 'geopotential_height_1000hPa',
            'temperature_950hPa', 'relative_humidity_950hPa', 'wind_speed_950hPa', 'wind_direction_950hPa', 'geopotential_height_950hPa',
            'temperature_925hPa', 'relative_humidity_925hPa', 'wind_speed_925hPa', 'wind_direction_925hPa', 'geopotential_height_925hPa',
            'temperature_900hPa', 'relative_humidity_900hPa', 'wind_speed_900hPa', 'wind_direction_900hPa', 'geopotential_height_900hPa',
            'temperature_850hPa', 'relative_humidity_850hPa', 'wind_speed_850hPa', 'wind_direction_850hPa', 'geopotential_height_850hPa',
            'temperature_800hPa', 'relative_humidity_800hPa', 'wind_speed_800hPa', 'wind_direction_800hPa', 'geopotential_height_800hPa',
            'temperature_700hPa', 'relative_humidity_700hPa', 'wind_speed_700hPa', 'wind_direction_700hPa', 'geopotential_height_700hPa',
            'temperature_600hPa', 'relative_humidity_600hPa', 'wind_speed_600hPa', 'wind_direction_600hPa', 'geopotential_height_600hPa',
            'temperature_500hPa', 'relative_humidity_500hPa', 'wind_speed_500hPa', 'wind_direction_500hPa', 'geopotential_height_500hPa',
            'temperature_400hPa', 'relative_humidity_400hPa', 'wind_speed_400hPa', 'wind_direction_400hPa', 'geopotential_height_400hPa',
            'temperature_300hPa', 'relative_humidity_300hPa', 'wind_speed_300hPa', 'wind_direction_300hPa', 'geopotential_height_300hPa',
            'temperature_250hPa', 'relative_humidity_250hPa', 'wind_speed_250hPa', 'wind_direction_250hPa', 'geopotential_height_250hPa',
            'temperature_200hPa', 'relative_humidity_200hPa', 'wind_speed_200hPa', 'wind_direction_200hPa', 'geopotential_height_200hPa'
        ];

        // New truncation logic: Keep all time steps unless surface data is missing
        const criticalSurfaceVars = ['temperature_2m', 'wind_speed_10m', 'wind_direction_10m'];
        let lastValidIndex = data.hourly.time.length - 1;

        for (let i = data.hourly.time.length - 1; i >= 0; i--) {
            const surfaceValid = criticalSurfaceVars.every(variable => {
                const value = data.hourly[variable]?.[i];
                return value !== null && value !== undefined && !isNaN(value);
            });
            if (!surfaceValid) {
                lastValidIndex = i - 1; // Trim only if surface data is invalid
                console.warn(`Trimming at index ${i} due to missing surface data`);
            } else {
                break; // Stop when we find the last valid surface data
            }
        }

        if (lastValidIndex < 0) {
            console.warn('No valid surface data found; defaulting to first index.');
            lastValidIndex = 0;
        }


        console.log('Last valid index after truncation:', lastValidIndex, 'Original length:', data.hourly.time.length);

        // Slice the data starting from targetIndex up to the last valid index (inclusive)
        weatherData = {
            time: data.hourly.time.slice(targetIndex, lastValidIndex + 1),
            temperature_2m: data.hourly.temperature_2m?.slice(targetIndex, lastValidIndex + 1) || [],
            relative_humidity_2m: data.hourly.relative_humidity_2m?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_speed_10m: data.hourly.wind_speed_10m?.slice(targetIndex, lastValidIndex + 1) || [],
            wind_direction_10m: data.hourly.wind_direction_10m?.slice(targetIndex, lastValidIndex + 1) || [],
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
        if (weatherData.time && weatherData.time.length > 0 && !weatherData.time[0].endsWith('Z')) {
            console.warn('Weather data time not in UTC format:', weatherData.time[0]);
        }
        console.log('WeatherData times (UTC):', weatherData.time.slice(0, 5));

        // Log the filtered weatherData
        console.group('Filtered weatherData (After Truncation)');
        console.log('Time (filtered):', weatherData.time);
        console.log('Surface Data (filtered):');
        console.table({
            temperature_2m: weatherData.temperature_2m,
            relative_humidity_2m: weatherData.relative_humidity_2m,
            wind_speed_10m: weatherData.wind_speed_10m,
            wind_direction_10m: weatherData.wind_direction_10m
        });
        console.group('Pressure Level Data (filtered)');
        const pressureLevels = ['1000hPa', '950hPa', '925hPa', '900hPa', '850hPa', '800hPa', '700hPa', '600hPa', '500hPa', '400hPa', '300hPa', '250hPa', '200hPa']

        pressureLevels.forEach(level => {
            console.group(level);
            console.table({
                temperature: weatherData[`temperature_${level}`],
                relative_humidity: weatherData[`relative_humidity_${level}`],
                wind_speed: weatherData[`wind_speed_${level}`],
                wind_direction: weatherData[`wind_direction_${level}`],
                geopotential_height: weatherData[`geopotential_height_${level}`]
            });
            console.groupEnd();
        });
        console.groupEnd();
        console.groupEnd();

        const slider = document.getElementById('timeSlider');
        slider.min = 0;
        slider.max = weatherData.time.length - 1; // Updated to reflect truncated length

        // Handle case where there's only one data point
        if (weatherData.time.length <= 1) {
            console.warn('Only one time step available, disabling slider interactivity');
            slider.disabled = true;
            slider.style.opacity = '0.5'; // Visual feedback
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

        // Update UI with the selected time and original requested time
        await updateWeatherDisplay(slider.value, currentTime); // Pass currentTime for range check
        console.log('UI updated with index:', slider.value, 'time:', weatherData.time[slider.value]);

        // Single validation after delay
        setTimeout(() => {
            const slider = document.getElementById('timeSlider');
            console.log('SetTimeout triggered - Slider state: min:', slider.min, 'max:', slider.max, 'value:', slider.value,
                'weatherData.time.length:', weatherData?.time?.length);
            const displayedTime = document.getElementById('selectedTime').innerHTML.replace('Selected Time: ', '');
            const expectedTime = Utils.formatTime(weatherData.time[slider.value]);
            if (displayedTime !== expectedTime || !weatherData.time[slider.value]) {
                console.error(`UI mismatch or invalid time: Displayed ${displayedTime} but expected ${expectedTime}, forcing correction`);
                const validIndex = Math.min(slider.value, weatherData.time.length - 1);
                slider.value = validIndex >= 0 ? validIndex : 0; // Fallback to 0 if negative
                updateWeatherDisplay(slider.value, currentTime);
                document.getElementById('selectedTime').innerHTML = `Selected Time: ${weatherData.time[slider.value].replace('T', ' ').slice(0, -3)}Z`;
                document.getElementById('info').innerHTML = '';
                updateWeatherDisplay(slider.value, currentTime);
            }
            if (weatherData.time.length > 1) {
                if (slider.disabled || slider.style.pointerEvents === 'none') {
                    console.warn('Slider was disabled or blocked, fixing now');
                    slider.disabled = false;
                    slider.style.pointerEvents = 'auto'; // Ensure clickable
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
        displayError(`Could not load weather data: ${error.message}`);
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
    const refLevel = document.querySelector('input[name="refLevel"]:checked')?.value || 'AGL';
    const heightUnit = getHeightUnit();
    const windSpeedUnit = getWindSpeedUnit();
    const temperatureUnit = getTemperatureUnit();
    const time = await getDisplayTime(weatherData.time[index]); // Await is fine here because function is async
    const interpolatedData = interpolateWeatherData(index);

    let output = `<table>`;
    output += `<tr><th>Height (${heightUnit} ${refLevel})</th><th>Dir (deg)</th><th>Spd (${windSpeedUnit})</th><th>T (${temperatureUnit === 'C' ? '°C' : '°F'})</th></tr>`;
    interpolatedData.forEach(data => {
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
        const formattedTemp = displayTemp === 'N/A' ? 'N/A' : displayTemp.toFixed(1);
        const formattedWind = data.spd === 'N/A' ? 'N/A' : (windSpeedUnit === 'bft' ? Math.round(data.spd) : data.spd.toFixed(1));
        output += `<tr class="${rowClass}"><td>${Math.round(displayHeight)}</td><td>${Utils.roundToTens(data.dir)}</td><td>${formattedWind}</td><td>${formattedTemp}</td></tr>`;
    });
    output += `</table>`;
    document.getElementById('info').innerHTML = output;
    document.getElementById('selectedTime').innerHTML = `Selected Time: ${time}`;
}

async function checkAvailableModels(lat, lon) {
    const modelList = [
        'icon_global', 'icon_eu', 'icon_d2', 'ecmwf_ifs025', 'ecmwf_aifs025_single', 'gfs_seamless', 'gfs_global', 'gfs_hrrr', 'arome_france', 'gem_hrdps_continental', 'gem_regional'
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

    const surfaceData = {
        level: `${surfaceHeight} m`,
        height: baseHeight,
        temp: weatherData.temperature_2m?.[index],
        rh: weatherData.relative_humidity_2m?.[index],
        dir: weatherData.wind_direction_10m?.[index],
        spd: Utils.convertWind(weatherData.wind_speed_10m?.[index], windSpeedUnit, 'km/h'),
        spdKt: Utils.convertWind(weatherData.wind_speed_10m?.[index], 'kt', 'km/h') // Add knots
    };

    const dataPoints = [];
    const levels = ['200hPa', '250hPa', '300hPa', '400hPa', '500hPa', '600hPa', '700hPa', '800hPa', '850hPa', '900hPa', '925hPa', '950hPa', '1000hPa'];
    levels.forEach(level => {
        const levelKey = level.replace(' ', '');
        const gh = weatherData[`geopotential_height_${levelKey}`]?.[index];
        if (gh !== undefined && gh !== null && !isNaN(gh)) {
            const spdKt = Utils.convertWind(weatherData[`wind_speed_${levelKey}`]?.[index], 'kt', 'km/h');
            dataPoints.push({
                level: level,
                height: Math.round(gh),
                temp: weatherData[`temperature_${levelKey}`]?.[index],
                rh: weatherData[`relative_humidity_${levelKey}`]?.[index],
                dir: weatherData[`wind_direction_${levelKey}`]?.[index],
                spd: Utils.convertWind(weatherData[`wind_speed_${levelKey}`]?.[index], windSpeedUnit, 'km/h'),
                spdKt: spdKt // Store knots for interpolation
            });
        }
    });

    if (dataPoints.length === 0) {
        return [{
            displayHeight: surfaceHeight,
            pressure: 'N/A',
            temp: surfaceData.temp ?? 'N/A',
            dew: Utils.calculateDewpoint(surfaceData.temp, surfaceData.rh) ?? 'N/A',
            dir: surfaceData.dir ?? 'N/A',
            spd: surfaceData.spd ?? 'N/A',
            rh: surfaceData.rh ?? 'N/A'
        }];
    }

    dataPoints.sort((a, b) => a.height - b.height);
    const maxHeight = dataPoints[dataPoints.length - 1].height;
    const interpolated = [];

    const dewSurface = Utils.calculateDewpoint(surfaceData.temp, surfaceData.rh);
    const pressureLevels = [200, 250, 300, 400, 500, 600, 700, 800, 850, 900, 925, 950, 1000];
    const pressureHeights = levels.map(level => weatherData[`geopotential_height_${level}`]?.[index]).filter(h => h !== null && !isNaN(h)).map(h => Math.round(h));
    const pressureSurface = Utils.interpolatePressure(surfaceData.height, pressureLevels, pressureHeights);

    interpolated.push({
        height: surfaceData.height,
        displayHeight: surfaceHeight,
        pressure: pressureSurface === '-' ? 'N/A' : pressureSurface,
        temp: surfaceData.temp ?? 'N/A',
        dew: dewSurface ?? 'N/A',
        dir: surfaceData.dir ?? 'N/A',
        spd: surfaceData.spd ?? 'N/A',
        rh: surfaceData.rh ?? 'N/A'
    });

    for (let hp = surfaceHeight + step; hp <= (refLevel === 'AGL' ? maxHeight - baseHeight : maxHeight); hp += step) {
        const actualHp = refLevel === 'AGL' ? hp + baseHeight : hp;
        const lower = dataPoints.filter(p => p.height <= actualHp).pop();
        const upper = dataPoints.find(p => p.height > actualHp);
        if (!lower || !upper) continue;

        const temp = Utils.gaussianInterpolation(lower.temp, upper.temp, lower.height, upper.height, actualHp);
        const rh = Math.max(0, Math.min(100, Utils.gaussianInterpolation(lower.rh, upper.rh, lower.height, upper.height, actualHp)));
        const u = Utils.gaussianInterpolation(
            -lower.spdKt * Math.sin(lower.dir * Math.PI / 180),
            -upper.spdKt * Math.sin(upper.dir * Math.PI / 180),
            lower.height, upper.height, actualHp
        );
        const v = Utils.gaussianInterpolation(
            -lower.spdKt * Math.cos(lower.dir * Math.PI / 180),
            -upper.spdKt * Math.cos(upper.dir * Math.PI / 180),
            lower.height, upper.height, actualHp
        );
        const spdKt = Utils.windSpeed(u, v); // Speed in knots
        const spd = Utils.convertWind(spdKt, windSpeedUnit, 'kt'); // Convert to display unit
        const dir = Utils.windDirection(u, v);
        const dew = Utils.calculateDewpoint(temp, rh);
        const pressure = Utils.interpolatePressure(actualHp, pressureLevels, pressureHeights);

        interpolated.push({
            height: actualHp,
            displayHeight: refLevel === 'AGL' ? hp : actualHp,
            pressure: pressure === '-' ? 'N/A' : pressure,
            temp: temp ?? 'N/A',
            dew: dew ?? 'N/A',
            dir: dir ?? 'N/A',
            spd: spd ?? 'N/A',
            rh: rh ?? 'N/A'
        });
    }

    return interpolated;
}

function calculateMeanWind() {
    const index = document.getElementById('timeSlider').value || 0;
    const interpolatedData = interpolateWeatherData(index);
    let lowerLimitInput = parseFloat(document.getElementById('lowerLimit').value) || 0;
    let upperLimitInput = parseFloat(document.getElementById('upperLimit').value) || 3000;
    const refLevel = document.querySelector('input[name="refLevel"]:checked')?.value || 'AGL';
    const heightUnit = getHeightUnit();
    const windSpeedUnit = getWindSpeedUnit(); // Add wind speed unit
    const baseHeight = Math.round(lastAltitude);

    if (lastAltitude === 'N/A') {
        displayError('Terrain altitude unavailable. Cannot calculate mean wind.');
        return;
    }

    // Convert inputs to meters for internal calculation
    lowerLimitInput = heightUnit === 'ft' ? lowerLimitInput / 3.28084 : lowerLimitInput;
    upperLimitInput = heightUnit === 'ft' ? upperLimitInput / 3.28084 : upperLimitInput;

    if (isNaN(lowerLimitInput) || isNaN(upperLimitInput) || lowerLimitInput >= upperLimitInput) {
        displayError('Invalid layer limits. Ensure Lower < Upper and both are numbers.');
        return;
    }

    if ((refLevel === 'AMSL') && lowerLimitInput < baseHeight) {
        displayError(`Lower limit adjusted to terrain altitude (${baseHeight} m ${refLevel}) as it cannot be below ground level in ${refLevel} mode.`);
        lowerLimitInput = baseHeight;
        document.getElementById('lowerLimit').value = Utils.convertHeight(lowerLimitInput, heightUnit);
    }

    const lowerLimit = refLevel === 'AGL' ? lowerLimitInput + baseHeight : lowerLimitInput;
    const upperLimit = refLevel === 'AGL' ? upperLimitInput + baseHeight : upperLimitInput;

    // Check if interpolatedData is valid
    if (!interpolatedData || interpolatedData.length === 0) {
        displayError('No valid weather data available to calculate mean wind.');
        return;
    }

    const heights = interpolatedData.map(d => refLevel === 'AGL' ? d.displayHeight + baseHeight : d.displayHeight);
    const dirs = interpolatedData.map(d => (typeof d.dir === 'number' && !isNaN(d.dir)) ? parseFloat(d.dir) : 0);
    const spds = interpolatedData.map(d => (typeof d.spd === 'number' && !isNaN(d.spd)) ? parseFloat(d.spd) : 0);

    const xKomponente = spds.map((spd, i) => -spd * Math.sin(dirs[i] * Math.PI / 180));
    const yKomponente = spds.map((spd, i) => -spd * Math.cos(dirs[i] * Math.PI / 180));

    const meanWind = Utils.calculateMeanWind(heights, xKomponente, yKomponente, lowerLimit, upperLimit);
    const [dir, spd] = meanWind;

    const roundedDir = Utils.roundToTens(dir);
    const displayLower = Math.round(Utils.convertHeight(lowerLimitInput, heightUnit));
    const displayUpper = Math.round(Utils.convertHeight(upperLimitInput, heightUnit));
    const displaySpd = Utils.convertWind(spd, windSpeedUnit);
    const formattedSpd = displaySpd === 'N/A' ? 'N/A' : (windSpeedUnit === 'bft' ? Math.round(displaySpd) : displaySpd.toFixed(1));
    const result = `Mean wind (${displayLower}-${displayUpper} ${heightUnit} ${refLevel}): ${roundedDir}° ${formattedSpd} ${windSpeedUnit}`;
    const meanWindResult = document.getElementById('meanWindResult');
    if (meanWindResult) {
        meanWindResult.innerHTML = result;
        console.log('Calculated Mean Wind:', result, 'u:', meanWind[2], 'v:', meanWind[3], 'Adjusted Limits:', { lowerLimit, upperLimit });
        updateWindUnitLabels(); // Ensure consistent formatting with unit changes
    } else {
        console.error('Mean wind result element not found');
    }
}

function downloadTableAsAscii() {
    if (!weatherData || !weatherData.time) {
        displayError('No weather data available to download.');
        return;
    }

    const index = document.getElementById('timeSlider').value || 0;
    const model = document.getElementById('modelSelect').value.toUpperCase();
    const time = Utils.formatTime(weatherData.time[index]).replace(' ', '_');
    //Activate next line to use local time for the file name!!!
    //const time = getDisplayTime(weatherData.time[index]).replace(' ', '_').replace(/[^\w-]/g, ''); // Clean for filename
    const filename = `${time}_${model}_HEIDIS.txt`;
    const heightUnit = getHeightUnit();
    const temperatureUnit = getTemperatureUnit();
    const windSpeedUnit = getWindSpeedUnit();
    const refLevel = document.querySelector('input[name="refLevel"]:checked')?.value || 'AGL';
    const heightHeader = refLevel === 'AGL' ? `h(${heightUnit}AGL)` : `h(${heightUnit}AMSL)`;
    const temperatureHeader = temperatureUnit === 'C' ? '°C' : '°F';
    const windSpeedHeader = windSpeedUnit;
    let content = `${heightHeader} p(hPa) T(${temperatureHeader}) Dew(${temperatureHeader}) Dir(°) Spd(${windSpeedHeader}) RH(%)\n`;

    const baseHeight = Math.round(lastAltitude);
    const surfaceHeight = refLevel === 'AGL' ? 0 : baseHeight;
    const surfaceTemp = weatherData.temperature_2m?.[index];
    const surfaceRH = weatherData.relative_humidity_2m?.[index];
    const surfaceSpd = weatherData.wind_speed_10m?.[index]; // Raw km/h
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
    const displaySurfaceSpd = Utils.convertWind(surfaceSpd, windSpeedUnit, 'km/h'); // Convert from km/h
    const formattedSurfaceTemp = displaySurfaceTemp === 'N/A' ? 'N/A' : displaySurfaceTemp.toFixed(1);
    const formattedSurfaceDew = displaySurfaceDew === 'N/A' ? 'N/A' : displaySurfaceDew.toFixed(1);
    const formattedSurfaceSpd = displaySurfaceSpd === 'N/A' ? 'N/A' : (windSpeedUnit === 'bft' ? Math.round(displaySurfaceSpd) : displaySurfaceSpd.toFixed(1));
    const formattedSurfaceDir = surfaceDir === 'N/A' || surfaceDir === undefined ? 'N/A' : Math.round(surfaceDir);
    const formattedSurfaceRH = surfaceRH === 'N/A' || surfaceRH === undefined ? 'N/A' : Math.round(surfaceRH);
    content += `${displaySurfaceHeight} ${surfacePressure === 'N/A' ? 'N/A' : surfacePressure.toFixed(1)} ${formattedSurfaceTemp} ${formattedSurfaceDew} ${formattedSurfaceDir} ${formattedSurfaceSpd} ${formattedSurfaceRH}\n`;

    const interpolatedData = interpolateWeatherData(index);
    if (!interpolatedData || interpolatedData.length === 0) {
        displayError('No interpolated data available to download.');
        return;
    }

    interpolatedData.forEach(data => {
        if (data.displayHeight !== surfaceHeight) {
            const displayHeight = Math.round(Utils.convertHeight(data.displayHeight, heightUnit));
            const displayTemperature = Utils.convertTemperature(data.temp, temperatureUnit);
            const displayDew = Utils.convertTemperature(data.dew, temperatureUnit);
            const displaySpd = data.spd; // Already in selected unit from interpolateWeatherData
            const formattedTemp = displayTemperature === 'N/A' ? 'N/A' : displayTemperature.toFixed(1);
            const formattedDew = displayDew === 'N/A' ? 'N/A' : displayDew.toFixed(1);
            const formattedSpd = displaySpd === 'N/A' ? 'N/A' : (windSpeedUnit === 'bft' ? Math.round(displaySpd) : displaySpd.toFixed(1));
            const formattedDir = data.dir === 'N/A' ? 'N/A' : Math.round(data.dir);
            const formattedRH = data.rh === 'N/A' ? 'N/A' : Math.round(data.rh);
            content += `${displayHeight} ${data.pressure} ${formattedTemp} ${formattedDew} ${formattedDir} ${formattedSpd} ${formattedRH}\n`;
        }
    });

    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

function displayError(message) {
    let errorElement = document.getElementById('error-message');
    if (!errorElement) {
        errorElement = document.createElement('div');
        errorElement.id = 'error-message';
        document.body.appendChild(errorElement);
    }
    errorElement.textContent = message;
    errorElement.style.display = 'block';
    setTimeout(() => errorElement.style.display = 'none', 5000);
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded, initializing map...');
    initMap();

    const slider = document.getElementById('timeSlider');
    const modelSelect = document.getElementById('modelSelect');
    const downloadButton = document.getElementById('downloadButton');
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const menu = document.getElementById('menu');
    const interpStepSelect = document.getElementById('interpStepSelect');
    const refLevelRadios = document.querySelectorAll('input[name="refLevel"]');
    const heightUnitRadios = document.querySelectorAll('input[name="heightUnit"]');
    const temperatureUnitRadios = document.querySelectorAll('input[name="temperatureUnit"]');
    const windSpeedUnitRadios = document.querySelectorAll('input[name="windUnit"]'); // Fix to match HTML
    const lowerLimitInput = document.getElementById('lowerLimit');
    const upperLimitInput = document.getElementById('upperLimit');

    console.log('Elements:', { slider, modelSelect, downloadButton, hamburgerBtn, menu, interpStepSelect, refLevelRadios, lowerLimitInput, upperLimitInput, windSpeedUnitRadios });

    if (!slider) {
        console.error('Slider missing');
        displayError('Slider element missing. Check HTML.');
        return;
    }

    slider.value = 0;
    slider.setAttribute('autocomplete', 'off');

    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    // Existing slider event listener (unchanged)
    if (slider) {
        const debouncedUpdate = debounce(async (e) => {
            const index = parseInt(e.target.value);
            console.log('Slider input triggered - index:', index);
            if (weatherData && index >= 0 && index < weatherData.time.length) {
                await updateWeatherDisplay(index); // Await here
                if (lastLat && lastLng && lastAltitude !== 'N/A') calculateMeanWind();
            } else {
                slider.value = 0;
                await updateWeatherDisplay(0); // Await here
            }
        }, 100);

        slider.addEventListener('input', debouncedUpdate);
        slider.addEventListener('change', async (e) => {
            const index = parseInt(e.target.value);
            console.log('Slider change triggered - index:', index);
            if (weatherData && index >= 0 && index < weatherData.time.length) {
                await updateWeatherDisplay(index); // Await here
                if (lastLat && lastLng && lastAltitude !== 'N/A') calculateMeanWind();
            } else {
                slider.value = 0;
                await updateWeatherDisplay(0); // Await here
            }
        });
    }

    // Existing modelSelect event listener (unchanged)
    if (modelSelect) {
        modelSelect.addEventListener('change', () => {
            if (lastLat && lastLng) {
                const slider = document.getElementById('timeSlider');
                const currentIndex = parseInt(slider.value) || 0;
                const currentTime = weatherData?.time?.[currentIndex] || null;
                console.log('Model change triggered - new model:', modelSelect.value, 'currentTime:', currentTime);
                document.getElementById('info').innerHTML = `Fetching weather with ${modelSelect.value}...`;
                fetchWeather(lastLat, lastLng, currentTime);
                console.log('Model fetch completed - new weatherData:', weatherData);
                updateModelRunInfo();
                updateWeatherDisplay(slider.value);
                updateReferenceLabels();
                if (lastLat && lastLng && lastAltitude !== 'N/A') calculateMeanWind();
            } else {
                displayError('Please select a position on the map first.');
            }
        });
    }

    // Existing downloadButton event listener (unchanged)
    if (downloadButton) {
        downloadButton.addEventListener('click', () => {
            console.log('Download button clicked!');
            downloadTableAsAscii();
        });
    }

    // Existing hamburger menu event listeners (unchanged)
    if (hamburgerBtn && menu) {
        hamburgerBtn.addEventListener('click', () => menu.classList.toggle('hidden'));
        const menuItems = menu.querySelectorAll('li > span');
        menuItems.forEach(item => {
            item.addEventListener('click', (e) => {
                const submenu = item.nextElementSibling;
                if (submenu && submenu.classList.contains('submenu')) {
                    submenu.classList.toggle('hidden');
                    menu.querySelectorAll('.submenu').forEach(other => {
                        if (other !== submenu && !other.classList.contains('hidden')) other.classList.add('hidden');
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

    // Existing refLevelRadios event listener (unchanged)
    if (refLevelRadios.length > 0) {
        refLevelRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                const selectedValue = document.querySelector('input[name="refLevel"]:checked').value;
                console.log('Ref level changed:', selectedValue);
                updateReferenceLabels();
                if (weatherData && lastLat && lastLng) {
                    updateWeatherDisplay(slider.value || 0);
                    if (lastAltitude !== 'N/A') calculateMeanWind();
                }
            });
        });
        const initialValue = document.querySelector('input[name="refLevel"]:checked').value;
        console.log('Initial refLevel:', initialValue);
        updateReferenceLabels(); // Initial label setup
        if (weatherData && lastLat && lastLng) {
            updateWeatherDisplay(0); // Initial table display
        }
    }

    // Existing heightUnitRadios event listener (unchanged)
    if (heightUnitRadios.length > 0) {
        heightUnitRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                console.log('Height unit changed:', getHeightUnit());
                updateHeightUnitLabels();
                if (weatherData && lastLat && lastLng) {
                    updateWeatherDisplay(slider.value || 0);
                    if (lastAltitude !== 'N/A') calculateMeanWind();
                }
            });
        });
        updateHeightUnitLabels(); // Initial setup
    }

    // Existing temperatureUnitRadios event listener (unchanged)
    if (temperatureUnitRadios.length > 0) {
        temperatureUnitRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                console.log('Temperature unit changed:', getTemperatureUnit());
                if (weatherData && lastLat && lastLng) {
                    updateWeatherDisplay(slider.value || 0);
                    if (lastAltitude !== 'N/A') calculateMeanWind();
                }
            });
        });
    }

    // Add windSpeedUnitRadios event listener
    if (windSpeedUnitRadios.length > 0) {
        windSpeedUnitRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                console.log('Wind speed unit changed:', getWindSpeedUnit());
                if (weatherData && lastLat && lastLng) {
                    updateWeatherDisplay(slider.value || 0);
                    if (lastAltitude !== 'N/A') calculateMeanWind();
                    updateWindUnitLabels();
                }
            });
        });
        updateWindUnitLabels(); // Initial setup
    }

    //Add time zone listener
    const timeZoneRadios = document.querySelectorAll('input[name="timeZone"]');
    if (timeZoneRadios.length > 0) {
        timeZoneRadios.forEach(radio => {
            radio.addEventListener('change', async () => { // Make this async
                console.log('Time zone changed:', radio.value);
                if (weatherData && lastLat && lastLng) {
                    await updateWeatherDisplay(slider.value || 0); // Await here
                    updateModelRunInfo(); // Already async
                }
            });
        });
    }
    // Existing interpStepSelect event listener (unchanged)
    if (interpStepSelect) {
        interpStepSelect.addEventListener('change', () => {
            console.log('Interpolation step changed:', interpStepSelect.value);
            if (weatherData && lastLat && lastLng) {
                updateWeatherDisplay(slider.value || 0);
                if (lastAltitude !== 'N/A') calculateMeanWind();
            } else {
                displayError('Please select a position and fetch weather data first.');
            }
        });
    }

    // Existing lowerLimitInput event listener (unchanged)
    if (lowerLimitInput) {
        lowerLimitInput.addEventListener('input', debounce(() => {
            console.log('Lower limit changed:', lowerLimitInput.value);
            if (weatherData && lastLat && lastLng && lastAltitude !== 'N/A') {
                calculateMeanWind();
            } else {
                displayError('Please select a position and fetch weather data first.');
            }
        }, 300));
    }

    // Existing upperLimitInput event listener (unchanged)
    if (upperLimitInput) {
        upperLimitInput.addEventListener('input', debounce(() => {
            console.log('Upper limit changed:', upperLimitInput.value);
            if (weatherData && lastLat && lastLng && lastAltitude !== 'N/A') {
                calculateMeanWind();
            } else {
                displayError('Please select a position and fetch weather data first.');
            }
        }, 300));
    }

    // Existing MutationObserver for recentering map (unchanged)
    const infoElement = document.getElementById('info');
    if (infoElement) {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList' || mutation.type === 'characterData') {
                    setTimeout(recenterMap, 100);
                }
            });
        });
        observer.observe(infoElement, { childList: true, subtree: true, characterData: true });
    }
});