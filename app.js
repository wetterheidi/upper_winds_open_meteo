const MAPBOX_API_KEY = 'pk.eyJ1Ijoid2V0dGVyaGVpZGkiLCJhIjoiY203dXNrZWRyMDN4bzJwb2pkbmI5ZXh4diJ9.tZkGHqinrfyNFC-8afYMzA';
mapboxgl.accessToken = MAPBOX_API_KEY;

let map;
let weatherData = null;
let lastLat = null;
let lastLng = null;
let lastAltitude = null;
let currentMarker = null;
let lastModelRun = null;

// Initialize the map and center it on the user's location if available
function initMap() {
    // Default coordinates (near Herrsching am Ammersee, Germany)
    const defaultCenter = [11.1923, 48.0179];
    const defaultZoom = 10;

    // Initialize the map with default settings
    map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/satellite-streets-v12',
        center: defaultCenter,
        zoom: defaultZoom
    });

    // Attempt to get the user's current position
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const userCoords = [position.coords.longitude, position.coords.latitude];
                // Center the map on the user's location
                map.setCenter(userCoords);
                map.setZoom(defaultZoom); // Keep the same zoom level

                // Add a marker at the user's location
                if (currentMarker) {
                    currentMarker.remove();
                }
                lastLat = position.coords.latitude;
                lastLng = position.coords.longitude;
                const altitude = await getAltitude(lastLng, lastLat);
                lastAltitude = altitude;

                const popup = new mapboxgl.Popup({ offset: 25 })
                    .setHTML(`Lat: ${lastLat.toFixed(4)}<br>Lng: ${lastLng.toFixed(4)}<br>Alt: ${altitude}m`);

                currentMarker = new mapboxgl.Marker({ color: '#FF0000' }) // Red marker for user location
                    .setLngLat(userCoords)
                    .setPopup(popup)
                    .addTo(map);

                currentMarker.togglePopup();

                // Fetch weather data for the user's location
                document.getElementById('info').innerHTML = `Fetching weather and models...`;
                const availableModels = await checkAvailableModels(lastLat, lastLng);
                if (availableModels.length > 0) {
                    await fetchWeather(lastLat, lastLng);
                    // After weather data is fetched and displayed, calculate mean wind
                    if (weatherData && lastLat && lastLng && lastAltitude !== 'N/A') {
                        calculateMeanWind();
                    }
                } else {
                    document.getElementById('info').innerHTML = `No models available.`;
                }
            },
            (error) => {
                // Handle geolocation errors
                console.warn(`Geolocation error: ${error.message}`);
                displayError('Unable to retrieve your location. Using default location (Herrsching am Ammersee).');
                // Fetch weather for default location and calculate mean wind
                lastLat = defaultCenter[1];
                lastLng = defaultCenter[0];
                getAltitude(lastLng, lastLat).then(async (altitude) => {
                    lastAltitude = altitude;
                    document.getElementById('info').innerHTML = `Fetching weather and models...`;
                    const availableModels = await checkAvailableModels(lastLat, lastLng);
                    if (availableModels.length > 0) {
                        await fetchWeather(lastLat, lastLng);
                        // After weather data is fetched and displayed, calculate mean wind
                        if (weatherData && lastLat && lastLng && lastAltitude !== 'N/A') {
                            calculateMeanWind();
                        }
                    } else {
                        document.getElementById('info').innerHTML = `No models available.`;
                    }
                });
            },
            {
                enableHighAccuracy: true,
                timeout: 10000, // 10 seconds timeout
                maximumAge: 0
            }
        );
    } else {
        // Geolocation not supported by the browser
        console.warn('Geolocation is not supported by this browser.');
        displayError('Geolocation not supported. Using default location (Herrsching am Ammersee).');
        lastLat = defaultCenter[1];
        lastLng = defaultCenter[0];
        getAltitude(lastLng, lastLat).then(async (altitude) => {
            lastAltitude = altitude;
            document.getElementById('info').innerHTML = `Fetching weather and models...`;
            const availableModels = await checkAvailableModels(lastLat, lastLng);
            if (availableModels.length > 0) {
                await fetchWeather(lastLat, lastLng);
                // After weather data is fetched and displayed, calculate mean wind
                if (weatherData && lastLat && lastLng && lastAltitude !== 'N/A') {
                    calculateMeanWind();
                }
            } else {
                document.getElementById('info').innerHTML = `No models available.`;
            }
        });
    }

    // Add click event listener for manual map interaction
    map.on('click', async (e) => {
        const { lng, lat } = e.lngLat;
        lastLat = lat;
        lastLng = lng;
        const altitude = await getAltitude(lng, lat);
        lastAltitude = altitude;

        if (currentMarker) {
            currentMarker.remove();
        }

        const popup = new mapboxgl.Popup({ offset: 25 })
            .setHTML(`Lat: ${lat.toFixed(4)}<br>Lng: ${lng.toFixed(4)}<br>Alt: ${altitude}m`);

        currentMarker = new mapboxgl.Marker()
            .setLngLat([lng, lat])
            .setPopup(popup)
            .addTo(map);

        currentMarker.togglePopup();

        document.getElementById('info').innerHTML = `Fetching weather and models...`;

        const availableModels = await checkAvailableModels(lat, lng);
        if (availableModels.length > 0) {
            await fetchWeather(lat, lng);
            // After weather data is fetched and displayed, calculate mean wind
            if (weatherData && lastLat && lastLng && lastAltitude !== 'N/A') {
                calculateMeanWind();
            }
        } else {
            document.getElementById('info').innerHTML = `No models available.`;
        }
    });
}

async function getAltitude(lng, lat) {
    try {
        const query = await fetch(
            `https://api.mapbox.com/v4/mapbox.mapbox-terrain-v2/tilequery/${lng},${lat}.json?layers=contour&access_token=${MAPBOX_API_KEY}`
        );
        const data = await query.json();
        return data.features[0]?.properties.ele || 'N/A';
    } catch (error) {
        console.error('Altitude fetch error:', error);
        return 'N/A';
    }
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
            console.warn(`Forecast start ${formatTime(startDate.toISOString())} is in the future; using current UTC date instead.`);
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
            'temperature_850hPa', 'wind_speed_850hPa', 'wind_direction_850hPa', // Representative pressure level
            'geopotential_height_850hPa' // Ensure height data for interpolation
        ];
        let lastValidIndex = data.hourly.time.length - 1;
        for (let i = lastValidIndex; i >= 0; i--) {
            const allValid = keyVariables.every(variable => {
                const value = data.hourly[variable]?.[i];
                return value !== null && value !== undefined && !isNaN(value);
            });
            if (!allValid) {
                lastValidIndex = i;
            } else {
                break; // Stop at the first fully valid index from the end
            }
        }
        lastValidIndex = Math.max(0, lastValidIndex); // Ensure we don't go below 0
        console.log('Last valid index after truncation:', lastValidIndex, 'Original length:', data.hourly.time.length);

        // Slice the data starting from targetIndex up to the last valid index
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
        const pressureLevels = ['1000hPa', '950hPa', '925hPa', '900hPa', '850hPa', '800hPa', '700hPa', '600hPa', '500hPa', '400hPa', '300hPa', '250hPa', '200hPa'];
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
        updateWeatherDisplay(slider.value, currentTime); // Pass currentTime for range check
        console.log('UI updated with index:', slider.value, 'time:', weatherData.time[slider.value]);

        // Single validation after delay
        setTimeout(() => {
            const slider = document.getElementById('timeSlider');
            console.log('SetTimeout triggered - Slider state: min:', slider.min, 'max:', slider.max, 'value:', slider.value,
                        'weatherData.time.length:', weatherData?.time?.length);
            const displayedTime = document.getElementById('selectedTime').innerHTML.replace('Selected Time: ', '');
            const expectedTime = formatTime(weatherData.time[slider.value]);
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

function updateWeatherDisplay(index, originalTime = null) {
    if (!weatherData || !weatherData.time || index < 0 || index >= weatherData.time.length) {
        console.error('No weather data available or index out of bounds:', index, 'Length:', weatherData?.time?.length);
        document.getElementById('info').innerHTML = 'No weather data available';
        document.getElementById('selectedTime').innerHTML = 'Selected Time: ';
        const slider = document.getElementById('timeSlider');
        if (slider) slider.value = 0; // Reset to a valid index
        return;
    }

    // Validate that the original requested time is within the forecast range
    const lastValidIndex = weatherData.time.length - 1;
    const lastAvailableTime = new Date(weatherData.time[lastValidIndex]);
    if (originalTime && new Date(originalTime) > lastAvailableTime) {
        const formattedLastTime = formatTime(weatherData.time[lastValidIndex]);
        displayError(`Forecast only available until ${formattedLastTime}. Please select an earlier time.`);
        const slider = document.getElementById('timeSlider');
        slider.value = lastValidIndex; // Reset to the last valid time
        updateWeatherDisplay(lastValidIndex); // Update UI with the last valid time
        return;
    }

    console.log('updateWeatherDisplay called with index:', index, 'time from weatherData (UTC):', weatherData.time[index]);
    const time = formatTime(weatherData.time[index]); // Already UTC
    console.log('Formatted time for display (UTC):', time);

    const interpolatedData = interpolateWeatherData(index);
    let output = `<table border="1" style="border-collapse: collapse; width: 100%;">`;
    output += `<tr><th style="width: 20%;">Height (m)</th><th style="width: 20%;">Dir (°)</th><th style="width: 20%;">Spd (kt)</th><th style="width: 20%;">T (°C)</th></tr>`;

    interpolatedData.forEach(data => {
        output += `<tr><td>${data.displayHeight}</td><td>${roundToTens(data.dir)}</td><td>${data.spd}</td><td>${data.temp}</td></tr>`;
    });

    output += `</table>`;
    document.getElementById('info').innerHTML = output;
    document.getElementById('selectedTime').innerHTML = `Selected Time: ${time}`; // UTC
}

async function checkAvailableModels(lat, lon) {
    const modelList = [
        'icon_global', 'icon_eu', 'icon_d2', 'ecmwf_ifs025', 'ecmwf_aifs025', 'gfs_seamless', 'gfs_global', 'gfs_hrrr', 'arome_france', 'gem_hrdps_continental', 'gem_regional'
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

function calculateDewpoint(temp, rh) {
    const aLiquid = 17.27;  // Coefficient for liquid water
    const bLiquid = 237.7;  // Constant for liquid water (°C)
    const aIce = 21.87;     // Coefficient for ice
    const bIce = 265.5;     // Constant for ice (°C)

    let alpha, dewpoint;

    if (temp >= 0) {
        // Magnus formula for liquid water (T ≥ 0°C)
        alpha = (aLiquid * temp) / (bLiquid + temp) + Math.log(rh / 100);
        dewpoint = (bLiquid * alpha) / (aLiquid - alpha);
    } else {
        // Magnus formula for ice (T < 0°C)
        alpha = (aIce * temp) / (bIce + temp) + Math.log(rh / 100);
        dewpoint = (bIce * alpha) / (aIce - alpha);
    }

    return dewpoint.toFixed(0);
}

function gaussianInterpolation(y1, y2, h1, h2, hp) {
    let w1 = 1 / Math.abs(h1 - hp);
    let w2 = 1 / Math.abs(h2 - hp);
    const yp = (w1 * y1 + w2 * y2) / (w1 + w2);
    return yp;
}

function interpolatePressure(height, pressureLevels, heights) {
    for (let i = 0; i < heights.length - 1; i++) {
        if (height <= heights[i] && height >= heights[i + 1]) {
            const p1 = pressureLevels[i];
            const p2 = pressureLevels[i + 1];
            const h1 = heights[i];
            const h2 = heights[i + 1];
            return p1 + (p2 - p1) * (height - h1) / (h2 - h1);
        }
    }
    if (height > heights[0]) {
        const p1 = pressureLevels[0];
        const p2 = pressureLevels[1];
        const h1 = heights[0];
        const h2 = heights[1];
        return p1 + (p2 - p1) * (height - h1) / (h2 - h1);
    }
    if (height < heights[heights.length - 1]) {
        const p1 = pressureLevels[pressureLevels.length - 2];
        const p2 = pressureLevels[pressureLevels.length - 1];
        const h1 = heights[heights.length - 2];
        const h2 = heights[heights.length - 1];
        return p2 + (p1 - p2) * (height - h2) / (h1 - h2);
    }
    return '-';
}

function interpolateWeatherData(index) {
    if (!weatherData || !weatherData.time || lastAltitude === 'N/A') return [];

    const step = parseInt(document.getElementById('interpStepSelect').value) || 200;
    const refLevel = document.getElementById('refLevelSelect').value || 'AGL';
    const baseHeight = Math.round(lastAltitude);
    const levels = ['200 hPa', '250hPa', '300 hPa', '400hPa', '500 hPa', '600hPa', '700 hPa', '800 hPa', '850 hPa', '900 hPa', '925 hPa', '950 hPa', '1000 hPa'];

    const surfaceHeight = refLevel === 'AGL' ? 0 : baseHeight;
    const dataPoints = [
        {
            level: `${surfaceHeight} m`,
            height: baseHeight,
            temp: weatherData.temperature_2m?.[index],
            rh: weatherData.relative_humidity_2m?.[index],
            dir: weatherData.wind_direction_10m?.[index],
            spd: weatherData.wind_speed_10m?.[index] * 0.539957
        }
    ];

    levels.forEach(level => {
        const levelKey = level.replace(' ', '');
        const gh = weatherData[`geopotential_height_${levelKey}`]?.[index];
        if (gh !== undefined && gh !== null && !isNaN(gh)) {
            dataPoints.push({
                level: level,
                height: Math.round(gh),
                temp: weatherData[`temperature_${levelKey}`]?.[index],
                rh: weatherData[`relative_humidity_${levelKey}`]?.[index],
                dir: weatherData[`wind_direction_${levelKey}`]?.[index],
                spd: weatherData[`wind_speed_${levelKey}`]?.[index] * 0.539957
            });
        }
    });

    if (dataPoints.length < 2 || dataPoints.every(dp => dp.temp === undefined || dp.dir === undefined || dp.spd === undefined)) {
        console.warn('Insufficient or invalid data at index:', index);
        return [{ displayHeight: 0, dir: NaN, spd: 0, temp: '-' }]; // Return minimal data to trigger table
    }

    dataPoints.sort((a, b) => a.height - b.height);
    const maxHeight = dataPoints[dataPoints.length - 1].height;
    const interpolated = [];

    const pressureLevels = [200, 250, 300, 400, 500, 600, 700, 800, 850, 900, 925, 950, 1000];
    const pressureHeights = levels.map(level => {
        const levelKey = level.replace(' ', '');
        return weatherData[`geopotential_height_${levelKey}`]?.[index] || null;
    }).filter(h => h !== null && !isNaN(h)).map(h => Math.round(h));
    pressureHeights.sort((a, b) => b - a);

    for (let hp = surfaceHeight + step; hp <= (refLevel === 'AGL' ? maxHeight - baseHeight : maxHeight); hp += step) {
        const actualHp = refLevel === 'AGL' ? hp + baseHeight : hp;
        const lower = dataPoints.filter(p => p.height <= actualHp).pop();
        const upper = dataPoints.find(p => p.height > actualHp);
        if (!lower || !upper) continue;

        const temp = gaussianInterpolation(lower.temp, upper.temp, lower.height, upper.height, actualHp);
        const rh = Math.max(0, Math.min(100, gaussianInterpolation(lower.rh, upper.rh, lower.height, upper.height, actualHp)));
        const dir = gaussianInterpolation(lower.dir, upper.dir, lower.height, upper.height, actualHp);
        const spd = gaussianInterpolation(lower.spd, upper.spd, lower.height, upper.height, actualHp);
        const dew = calculateDewpoint(temp, rh);
        const pressure = interpolatePressure(actualHp, pressureLevels, pressureHeights);

        interpolated.push({
            height: actualHp,
            displayHeight: hp,
            temp: temp.toFixed(0),
            rh: rh.toFixed(0),
            dew: dew,
            dir: dir.toFixed(0),
            spd: spd.toFixed(0),
            pressure: pressure === '-' ? '-' : pressure.toFixed(0)
        });
    }

    const surfaceData = dataPoints.find(d => d.level === `${surfaceHeight} m`);
    if (surfaceData) {
        const dew = (surfaceData.temp !== undefined && surfaceData.rh !== undefined) ? calculateDewpoint(surfaceData.temp, surfaceData.rh) : '-';
        const pressure = interpolatePressure(surfaceData.height, pressureLevels, pressureHeights);
        interpolated.push({
            height: surfaceData.height,
            displayHeight: surfaceHeight,
            temp: surfaceData.temp?.toFixed(0) ?? '-',
            rh: surfaceData.rh?.toFixed(0) ?? '-',
            dew: dew,
            dir: surfaceData.dir?.toFixed(0) ?? '-',
            spd: surfaceData.spd?.toFixed(0) ?? '-',
            pressure: pressure === '-' ? '-' : pressure.toFixed(0)
        });
    }

    interpolated.sort((a, b) => a.height - b.height);
    return interpolated;
}

function LIP(xVector, yVector, xValue) {
    let reversed = false;
    if (xVector[1] > xVector[0]) {
        yVector = [...yVector].reverse();
        xVector = [...xVector].reverse();
        reversed = true;
    }

    const Dimension = xVector.length - 1;
    try {
        if (xValue > xVector[0] || xValue < xVector[Dimension]) {
            let m, n;
            if (xValue > xVector[0]) {
                m = (yVector[1] - yVector[0]) / (xVector[1] - xVector[0]);
                n = yVector[1] - m * xVector[1];
            } else {
                m = (yVector[Dimension] - yVector[Dimension - 1]) / (xVector[Dimension] - xVector[Dimension - 1]);
                n = yVector[Dimension] - m * xVector[Dimension];
            }
            return m * xValue + n;
        } else {
            let i;
            for (i = 1; i <= Dimension; i++) {
                if (xValue >= xVector[i]) break;
            }
            const m = (yVector[i] - yVector[i - 1]) / (xVector[i] - xVector[i - 1]);
            const n = yVector[i] - m * xVector[i];
            return m * xValue + n;
        }
    } catch (error) {
        return "interpolation error";
    } finally {
        if (reversed) {
            yVector.reverse();
            xVector.reverse();
        }
    }
}

function windSpeed(x, y) {
    return Math.sqrt(x * x + y * y);
}

function windDirection(u, v) {
    let dir = Math.atan2(-u, -v) * 180 / Math.PI; // Correct meteorological direction
    return (dir + 360) % 360; // Ensure 0–360°
}

function Mittelwind(Höhe, xKomponente, yKomponente, Untergrenze, Obergrenze) {
    const dddff = new Array(4);
    let hSchicht = [Obergrenze];
    let xSchicht = [Number(LIP(Höhe, xKomponente, Obergrenze))];
    let ySchicht = [Number(LIP(Höhe, yKomponente, Obergrenze))];

    const xUntergrenze = Number(LIP(Höhe, xKomponente, Untergrenze));
    const yUntergrenze = Number(LIP(Höhe, yKomponente, Untergrenze));

    for (let i = 0; i < Höhe.length; i++) {
        if (Höhe[i] < Obergrenze && Höhe[i] > Untergrenze) {
            hSchicht.push(Höhe[i]);
            xSchicht.push(xKomponente[i]);
            ySchicht.push(yKomponente[i]);
        }
    }

    hSchicht.push(Untergrenze);
    xSchicht.push(xUntergrenze);
    ySchicht.push(yUntergrenze);

    // Sort arrays in descending order of height
    const indices = hSchicht.map((_, idx) => idx);
    indices.sort((a, b) => hSchicht[b] - hSchicht[a]); // Descending order
    hSchicht = indices.map(i => hSchicht[i]);
    xSchicht = indices.map(i => xSchicht[i]);
    ySchicht = indices.map(i => ySchicht[i]);

    let xTrapez = 0;
    let yTrapez = 0;
    for (let i = 0; i < hSchicht.length - 1; i++) {
        xTrapez += 0.5 * (xSchicht[i] + xSchicht[i + 1]) * (hSchicht[i] - hSchicht[i + 1]);
        yTrapez += 0.5 * (ySchicht[i] + ySchicht[i + 1]) * (hSchicht[i] - hSchicht[i + 1]);
    }

    const xMittel = xTrapez / (hSchicht[0] - hSchicht[hSchicht.length - 1]);
    const yMittel = yTrapez / (hSchicht[0] - hSchicht[hSchicht.length - 1]);

    dddff[2] = xMittel; // u component
    dddff[3] = yMittel; // v component
    dddff[1] = windSpeed(xMittel, yMittel); // Speed
    dddff[0] = windDirection(xMittel, yMittel); // Direction

    return dddff;
}

function roundToTens(value) {
    return Math.round(value / 10) * 10;
}

function calculateMeanWind() {
    const index = document.getElementById('timeSlider').value || 0;
    const interpolatedData = interpolateWeatherData(index);
    let lowerLimitInput = parseFloat(document.getElementById('lowerLimit').value) || 0;
    let upperLimitInput = parseFloat(document.getElementById('upperLimit').value) || 3000;
    const refLevel = document.getElementById('refLevelSelect').value || 'AGL';
    const baseHeight = Math.round(lastAltitude);

    console.log('refLevel in calculateMeanWind:', refLevel); // Debug log

    if (lastAltitude === 'N/A') {
        displayError('Terrain altitude unavailable. Cannot calculate mean wind.');
        return;
    }

    if (isNaN(lowerLimitInput) || isNaN(upperLimitInput) || lowerLimitInput >= upperLimitInput) {
        displayError('Invalid layer limits. Ensure Lower < Upper and both are numbers.');
        return;
    }

    // Enforce minimum lower limit in ASL/AMSL mode
    if ((refLevel === 'ASL' || refLevel === 'AMSL') && lowerLimitInput < baseHeight) {
        displayError(`Lower limit adjusted to terrain altitude (${baseHeight} m ${refLevel}) as it cannot be below ground level in ${refLevel} mode.`);
        lowerLimitInput = baseHeight;
        document.getElementById('lowerLimit').value = lowerLimitInput; // Update input field
    }

    // Adjust limits based on reference level
    const lowerLimit = refLevel === 'AGL' ? lowerLimitInput + baseHeight : lowerLimitInput;
    const upperLimit = refLevel === 'AGL' ? upperLimitInput + baseHeight : upperLimitInput;

    const heights = interpolatedData.map(d => refLevel === 'AGL' ? d.displayHeight + baseHeight : d.displayHeight);
    const dirs = interpolatedData.map(d => parseFloat(d.dir) || 0);
    const spds = interpolatedData.map(d => parseFloat(d.spd) || 0);

    const xKomponente = spds.map((spd, i) => -spd * Math.sin(dirs[i] * Math.PI / 180));
    const yKomponente = spds.map((spd, i) => -spd * Math.cos(dirs[i] * Math.PI / 180));

    const meanWind = Mittelwind(heights, xKomponente, yKomponente, lowerLimit, upperLimit);
    const [dir, spd] = meanWind;

    const roundedDir = roundToTens(dir);
    const result = `Mean wind (${lowerLimitInput}-${upperLimitInput} m ${refLevel}): ${roundedDir}° ${spd.toFixed(0)} kt`;
    const meanWindResult = document.getElementById('meanWindResult');
    if (meanWindResult) {
        meanWindResult.innerHTML = result;
        console.log('Calculated Mean Wind:', result, 'u:', meanWind[2], 'v:', meanWind[3], 'Adjusted Limits:', { lowerLimit, upperLimit });
    } else {
        console.error('Mean wind result element not found');
    }
}

function formatTime(timeStr) {
    console.log('Formatting time:', timeStr); // Debug log
    // Parse as UTC explicitly
    const date = new Date(Date.UTC(
        parseInt(timeStr.slice(0, 4)), // Year
        parseInt(timeStr.slice(5, 7)) - 1, // Month (0-based)
        parseInt(timeStr.slice(8, 10)), // Day
        parseInt(timeStr.slice(11, 13)), // Hour
        parseInt(timeStr.slice(14, 16)) // Minute
    ));
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hour = String(date.getUTCHours()).padStart(2, '0');
    const minute = String(date.getUTCMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}${minute}Z`; // Explicit UTC marker
}

function downloadTableAsAscii() {
    if (!weatherData || !weatherData.time) {
        displayError('No weather data available to download.');
        return;
    }

    const index = document.getElementById('timeSlider').value || 0;
    const model = document.getElementById('modelSelect').value.toUpperCase();
    const time = formatTime(weatherData.time[index]).replace(' ', '_'); // UTC
    const filename = `${time}_${model}_HEIDIS.txt`;

    const interpolatedData = interpolateWeatherData(index);
    let content = 'h(m) p(hPa) T(°C) Dew(°C) Dir(°) Spd(kt) RH(%)\n';

    interpolatedData.forEach(data => {
        content += `${data.displayHeight} ${data.pressure} ${data.temp} ${data.dew} ${data.dir} ${data.spd} ${data.rh}\n`;
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
    const infoButton = document.getElementById('modelInfoButton');
    const infoPopup = document.getElementById('modelInfoPopup');
    const downloadButton = document.getElementById('downloadButton');
    const interpStepSelect = document.getElementById('interpStepSelect');
    const refLevelSelect = document.getElementById('refLevelSelect');
    const lowerLimitInput = document.getElementById('lowerLimit');
    const upperLimitInput = document.getElementById('upperLimit');

    console.log('Elements found:', {
        slider, modelSelect, infoButton, infoPopup, downloadButton,
        interpStepSelect, refLevelSelect, lowerLimitInput, upperLimitInput
    });

    if (!slider) {
        console.error('Slider element not found in DOM');
        displayError('Slider element missing. Check HTML.');
        return;
    }

    slider.value = 0; // Initialize to 0 (12:00Z)
    slider.setAttribute('autocomplete', 'off'); // Prevent browser autofill
    console.log('Initial slider state - min:', slider.min, 'max:', slider.max, 'value:', slider.value,
                'weatherData.time:', weatherData?.time);

    // Debounce function
    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    // Debounced input event handler
    const debouncedUpdate = debounce((e) => {
        const slider = document.getElementById('timeSlider');
        const index = parseInt(e.target.value);
        console.log('Slider input event fired - min:', slider.min, 'max:', slider.max, 'value:', index,
                    'weatherData.time[index]:', weatherData?.time[index], 'length:', weatherData?.time?.length);
        if (index >= 0 && index <= (weatherData?.time?.length - 1 || 0)) {
            updateWeatherDisplay(index);
            if (weatherData && lastLat && lastLng && lastAltitude !== 'N/A') {
                calculateMeanWind();
            }
        } else {
            console.warn('Slider value out of bounds, resetting to 0. Index:', index, 'Max:', weatherData?.time?.length - 1);
            slider.value = 0;
            updateWeatherDisplay(0);
            if (weatherData && lastLat && lastLng && lastAltitude !== 'N/A') {
                calculateMeanWind();
            }
        }
    }, 100);

    slider.addEventListener('input', debouncedUpdate);
    console.log('Input event listener attached to slider');

    slider.addEventListener('change', (e) => {
        const slider = document.getElementById('timeSlider');
        const index = parseInt(e.target.value);
        console.log('Slider change event fired - min:', slider.min, 'max:', slider.max, 'value:', index,
                    'weatherData.time[index]:', weatherData?.time[index], 'length:', weatherData?.time?.length);
        if (index >= 0 && index <= (weatherData?.time?.length - 1 || 0)) {
            updateWeatherDisplay(index);
            if (weatherData && lastLat && lastLng && lastAltitude !== 'N/A') {
                calculateMeanWind();
            }
        } else {
            console.warn('Slider value out of bounds, resetting to 0. Index:', index, 'Max:', weatherData?.time?.length - 1);
            slider.value = 0;
            updateWeatherDisplay(0);
            if (weatherData && lastLat && lastLng && lastAltitude !== 'N/A') {
                calculateMeanWind();
            }
        }
    });
    console.log('Change event listener attached to slider');

    if (modelSelect) {
        modelSelect.addEventListener('change', () => {
            if (lastLat && lastLng) {
                // Capture the current selected time before fetching new data
                const slider = document.getElementById('timeSlider');
                const currentIndex = parseInt(slider.value) || 0;
                const currentTime = weatherData && weatherData.time ? weatherData.time[currentIndex] : null;
                console.log('Current selected time before model change:', currentTime);
    
                document.getElementById('info').innerHTML = `Fetching weather with ${modelSelect.value}...`;
                fetchWeather(lastLat, lastLng, currentTime); // Pass the current time to fetchWeather
            } else {
                displayError('Please select a position on the map first.');
            }
        });
    }

    if (infoButton && infoPopup) {
        infoButton.addEventListener('click', () => {
            if (!lastModelRun) {
                displayError('No model run data available yet.');
                return;
            }
            const model = document.getElementById('modelSelect').value;
            const runText = `Model: ${model.replace('_', ' ').toUpperCase()}<br>Run: ${lastModelRun}`;
            infoPopup.style.top = `${infoButton.getBoundingClientRect().bottom + 5}px`;
            infoPopup.innerHTML = runText;
            infoPopup.style.display = 'block';
            setTimeout(() => infoPopup.style.display = 'none', 5000);
        });
    } else {
        console.error('Model info button or popup element not found');
    }

    if (downloadButton) {
        downloadButton.addEventListener('click', downloadTableAsAscii);
    } else {
        console.error('Download button element not found');
    }

    if (interpStepSelect) {
        interpStepSelect.addEventListener('change', () => {
            if (weatherData && lastLat && lastLng) {
                updateWeatherDisplay(document.getElementById('timeSlider').value || 0);
                if (weatherData && lastLat && lastLng && lastAltitude !== 'N/A') {
                    calculateMeanWind(); // Update mean wind when step changes
                }
            } else {
                displayError('Please select a position and fetch weather data first.');
            }
        });
    } else {
        console.error('Interpolation step select element not found');
    }

    if (refLevelSelect) {
        refLevelSelect.addEventListener('change', () => {
            if (weatherData && lastLat && lastLng) {
                updateWeatherDisplay(document.getElementById('timeSlider').value || 0);
                if (weatherData && lastLat && lastLng && lastAltitude !== 'N/A') {
                    calculateMeanWind(); // Update mean wind when reference level changes
                }
            } else {
                displayError('Please select a position and fetch weather data first.');
            }
        });
    } else {
        console.error('Reference level select element not found');
    }

    if (lowerLimitInput) {
        lowerLimitInput.addEventListener('input', () => {
            if (weatherData && lastLat && lastLng) {
                calculateMeanWind();
            } else {
                displayError('Please select a position and fetch weather data first.');
            }
        });
    } else {
        console.error('Lower limit input element not found');
    }

    if (upperLimitInput) {
        upperLimitInput.addEventListener('input', () => {
            if (weatherData && lastLat && lastLng) {
                calculateMeanWind();
            } else {
                displayError('Please select a position and fetch weather data first.');
            }
        });
    } else {
        console.error('Upper limit input element not found');
    }
});