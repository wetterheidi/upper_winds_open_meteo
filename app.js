const MAPBOX_API_KEY = 'pk.eyJ1Ijoid2V0dGVyaGVpZGkiLCJhIjoiY203dXNrZWRyMDN4bzJwb2pkbmI5ZXh4diJ9.tZkGHqinrfyNFC-8afYMzA';
mapboxgl.accessToken = MAPBOX_API_KEY;

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v11',
    center: [11.1923, 48.0179],
    zoom: 10
});

let weatherData = null;
let lastLat = null;
let lastLng = null;
let lastAltitude = null;
let currentMarker = null;

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
    
    document.getElementById('info').innerHTML = `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}, Alt: ${altitude}m<br>Fetching weather and models...`;
    
    const availableModels = await checkAvailableModels(lat, lng);
    if (availableModels.length > 0) {
        await fetchWeather(lat, lng);
    } else {
        document.getElementById('info').innerHTML = `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}, Alt: ${altitude}m<br>No models available.`;
    }
});

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

async function fetchWeather(lat, lon) {
    try {
        const model = document.getElementById('modelSelect').value;
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
            `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,` +
            `temperature_1000hPa,relative_humidity_1000hPa,wind_speed_1000hPa,wind_direction_1000hPa,geopotential_height_1000hPa,` +
            `temperature_950hPa,relative_humidity_950hPa,wind_speed_950hPa,wind_direction_950hPa,geopotential_height_950hPa,` +
            `temperature_925hPa,relative_humidity_925hPa,wind_speed_925hPa,wind_direction_925hPa,geopotential_height_925hPa,` +
            `temperature_900hPa,relative_humidity_900hPa,wind_speed_900hPa,wind_direction_900hPa,geopotential_height_900hPa,` +
            `temperature_850hPa,relative_humidity_850hPa,wind_speed_850hPa,wind_direction_850hPa,geopotential_height_850hPa,` +
            `temperature_800hPa,relative_humidity_800hPa,wind_speed_800hPa,wind_direction_800hPa,geopotential_height_800hPa,` +
            `temperature_700hPa,relative_humidity_700hPa,wind_speed_700hPa,wind_direction_700hPa,geopotential_height_700hPa,` +
            `temperature_500hPa,relative_humidity_500hPa,wind_speed_500hPa,wind_direction_500hPa,geopotential_height_500hPa,` +
            `temperature_300hPa,relative_humidity_300hPa,wind_speed_300hPa,wind_direction_300hPa,geopotential_height_300hPa,` +
            `temperature_200hPa,relative_humidity_200hPa,wind_speed_200hPa,wind_direction_200hPa,geopotential_height_200hPa` +
            `&models=${model}`);
        
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        
        const data = await response.json();
        weatherData = data.hourly;
        
        const slider = document.getElementById('timeSlider');
        slider.disabled = false;
        updateWeatherDisplay(0);
        return data;
    } catch (error) {
        console.error("Weather fetch error:", error);
        displayError("Could not load weather data.");
        throw error;
    }
}

async function checkAvailableModels(lat, lon) {
    const modelList = [
        'gfs_seamless', 'gfs_global', 'icon_global', 'ecmwf_ifs025', 'ecmwf_aifs025',
        'meteofrance_seamless', 'meteofrance_arpege_world', 'jma_seamless', 'jma_global',
        'gem_global', 'ncep_hrrr', 'icon_eu', 'icon_d2', 'meteofrance_arome_france',
        'meteofrance_arome_france_hd', 'jma_msm', 'gfs025', 'ecmwf_ifs04', 'icon_seamless'
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
    const a = 17.27;
    const b = 237.7;
    const alpha = (a * temp) / (b + temp) + Math.log(rh / 100);
    const dewpoint = (b * alpha) / (a - alpha);
    return dewpoint.toFixed(1);
}

function updateWeatherDisplay(index) {
    if (!weatherData || !weatherData.time || !weatherData.time[index]) {
        document.getElementById('info').innerHTML = 'No weather data available';
        return;
    }
    
    const time = formatTime(weatherData.time[index]);
    const levels = ['200 hPa', '300 hPa', '500 hPa', '700 hPa', '800 hPa', '850 hPa', '900 hPa', '925 hPa', '950 hPa', '1000 hPa'];
    
    let output = `Time: ${time}<br><br>`;
    
    output += `<table border="1" style="border-collapse: collapse; width: 100%;">`;
    output += `<tr>`;
    output += `<th style="width: 15%;">Level</th>`;
    output += `<th style="width: 15%;">T (°C)</th>`;
    output += `<th style="width: 10%;">RH (%)</th>`;
    output += `<th style="width: 15%;">Dew (°C)</th>`;
    output += `<th style="width: 10%;">Dir (°)</th>`;
    output += `<th style="width: 15%;">Spd (kt)</th>`;
    output += `<th style="width: 20%;">GH (m)</th>`;
    output += `</tr>`;
    
    levels.forEach(level => {
        const levelKey = level.replace(' ', '');
        const temp = weatherData[`temperature_${levelKey}`]?.[index];
        const rh = weatherData[`relative_humidity_${levelKey}`]?.[index];
        const windDir = weatherData[`wind_direction_${levelKey}`]?.[index];
        const windSpeed = weatherData[`wind_speed_${levelKey}`]?.[index];
        const gh = weatherData[`geopotential_height_${levelKey}`]?.[index];
        
        if ([temp, rh, windDir, windSpeed, gh].every(val => val === null || val === undefined || isNaN(val))) {
            return;
        }
        
        output += `<tr>`;
        output += `<td>${level}</td>`;
        
        output += `<td>${temp !== undefined && temp !== null && !isNaN(temp) ? `${temp}` : '-'}</td>`;
        output += `<td>${rh !== undefined && rh !== null && !isNaN(rh) ? `${rh}` : '-'}</td>`;
        
        let dewpoint = (temp !== undefined && temp !== null && !isNaN(temp) && rh !== undefined && rh !== null && !isNaN(rh)) 
            ? calculateDewpoint(temp, rh) : '-';
        output += `<td>${dewpoint !== '-' ? `${dewpoint}` : '-'}</td>`;
        
        output += `<td>${windDir !== undefined && windDir !== null && !isNaN(windDir) ? `${windDir}` : '-'}</td>`;
        output += `<td>${windSpeed !== undefined && windSpeed !== null && !isNaN(windSpeed) ? `${(windSpeed * 0.539957).toFixed(1)}` : '-'}</td>`;
        output += `<td>${gh !== undefined && gh !== null && !isNaN(gh) ? `${Math.round(gh)}` : '-'}</td>`;
        
        output += `</tr>`;
    });
    
    const temp2m = weatherData.temperature_2m?.[index];
    const rh2m = weatherData.relative_humidity_2m?.[index];
    const windDir10m = weatherData.wind_direction_10m?.[index];
    const windSpeed10m = weatherData.wind_speed_10m?.[index];
    
    if (![temp2m, rh2m, windDir10m, windSpeed10m].every(val => val === null || val === undefined || isNaN(val))) {
        output += `<tr>`;
        output += `<td>Surface</td>`;
        
        output += `<td>${temp2m !== undefined && temp2m !== null && !isNaN(temp2m) ? `${temp2m}` : '-'}</td>`;
        output += `<td>${rh2m !== undefined && rh2m !== null && !isNaN(rh2m) ? `${rh2m}` : '-'}</td>`;
        
        let dewpoint2m = (temp2m !== undefined && temp2m !== null && !isNaN(temp2m) && rh2m !== undefined && rh2m !== null && !isNaN(rh2m)) 
            ? calculateDewpoint(temp2m, rh2m) : '-';
        output += `<td>${dewpoint2m !== '-' ? `${dewpoint2m}` : '-'}</td>`;
        
        output += `<td>${windDir10m !== undefined && windDir10m !== null && !isNaN(windDir10m) ? `${windDir10m}` : '-'}</td>`;
        output += `<td>${windSpeed10m !== undefined && windSpeed10m !== null && !isNaN(windSpeed10m) ? `${(windSpeed10m * 0.539957).toFixed(1)}` : '-'}</td>`;
        output += `<td>${(lastAltitude !== 'N/A' && lastAltitude !== null) ? `${Math.round(lastAltitude)}` : '-'}</td>`;
        
        output += `</tr>`;
    }
    
    output += `</table>`;
    
    document.getElementById('info').innerHTML = output;
}

function formatTime(isoString) {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

function displayError(message) {
    let errorElement = document.getElementById('error-message');
    if (!errorElement) {
        errorElement = document.createElement('div');
        errorElement.id = 'error-message';
        errorElement.style.color = 'red';
        errorElement.style.padding = '10px';
        errorElement.style.backgroundColor = 'rgba(255, 200, 200, 0.5)';
        errorElement.style.borderRadius = '5px';
        errorElement.style.margin = '10px';
        document.body.insertBefore(errorElement, document.body.firstChild);
    }
    
    errorElement.textContent = message;
    errorElement.style.display = 'block';
    setTimeout(() => errorElement.style.display = 'none', 5000);
}

document.addEventListener('DOMContentLoaded', () => {
    const slider = document.getElementById('timeSlider');
    if (slider) {
        slider.addEventListener('input', (e) => updateWeatherDisplay(e.target.value));
    } else {
        console.error('Slider element not found');
    }

    const modelSelect = document.getElementById('modelSelect');
    if (modelSelect) {
        modelSelect.addEventListener('change', () => {
            if (lastLat && lastLng) {
                document.getElementById('info').innerHTML = `Lat: ${lastLat.toFixed(4)}, Lng: ${lastLng.toFixed(4)}<br>Fetching weather with ${modelSelect.value}...`;
                fetchWeather(lastLat, lastLng);
            } else {
                displayError('Please select a position on the map first.');
            }
        });
    } else {
        console.error('Model select element not found');
    }
});