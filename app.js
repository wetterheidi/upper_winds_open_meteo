const MAPBOX_API_KEY = 'pk.eyJ1Ijoid2V0dGVyaGVpZGkiLCJhIjoiY203dXNrZWRyMDN4bzJwb2pkbmI5ZXh4diJ9.tZkGHqinrfyNFC-8afYMzA';
mapboxgl.accessToken = MAPBOX_API_KEY;

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v11',
    center: [13.4050, 52.5200],
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
    
    document.getElementById('info').innerHTML = `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}, Alt: ${altitude}m<br>Fetching weather...`;
    await fetchWeather(lat, lng);
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
        
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        const data = await response.json();
        
        console.log("Weather data fetched successfully:", data);
        console.log("--------------------------------");
        console.log("Standort:", `Lat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(4)}`);
        console.log("Zeitraum:", data.hourly.time[0], "bis", data.hourly.time[data.hourly.time.length - 1]);
        console.log("Verfügbare Druckniveaus:", Object.keys(data.hourly)
            .filter(key => key.includes('wind_speed_') || key.includes('wind_direction_'))
            .map(key => key.replace('wind_speed_', '').replace('wind_direction_', '').replace('hPa', ''))
            .filter((v, i, a) => a.indexOf(v) === i)
            .sort((a, b) => b - a)
            .map(level => `${level}hPa`));
        
        console.log("--------------------------------");
        console.log("Aktuelle Daten (erster Zeitpunkt):");
        console.log("Oberfläche:", {
            "Temperatur": `${data.hourly.temperature_2m[0]}${data.hourly_units.temperature_2m}`,
            "Luftfeuchtigkeit": `${data.hourly.relative_humidity_2m[0]}${data.hourly_units.relative_humidity_2m}`,
            "Taupunkt": `${calculateDewpoint(data.hourly.temperature_2m[0], data.hourly.relative_humidity_2m[0])}${data.hourly_units.temperature_2m}`,
            "Wind": `${data.hourly.wind_speed_10m[0]}${data.hourly_units.wind_speed_10m} aus ${data.hourly.wind_direction_10m[0]}${data.hourly_units.wind_direction_10m}`
        });
        
        const levels = [1000, 950, 925, 900, 850, 800, 700, 500, 300, 200];
        levels.forEach(level => {
            const speedKey = `wind_speed_${level}hPa`;
            const directionKey = `wind_direction_${level}hPa`;
            const heightKey = `geopotential_height_${level}hPa`;
            if (data.hourly[speedKey] && data.hourly[directionKey]) {
                console.log(`${level}hPa:`, {
                    "Wind": `${data.hourly[speedKey][0]}${data.hourly_units[speedKey]} aus ${data.hourly[directionKey][0]}${data.hourly_units[directionKey]}`,
                    "Geopotential Height": data.hourly[heightKey] ? `${data.hourly[heightKey][0]}${data.hourly_units[heightKey]}` : 'N/A'
                });
            }
        });
        console.log("--------------------------------");
        
        weatherData = data.hourly;
        
        const slider = document.getElementById('timeSlider');
        slider.disabled = false;
        console.log('Slider enabled:', !slider.disabled);
        updateWeatherDisplay(0);

        return data;
    } catch (error) {
        console.error("Weather fetch error:", error);
        displayError("Konnte keine Wetterdaten laden. Bitte versuchen Sie es später erneut.");
        throw error;
    }
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
        document.getElementById('info').innerHTML = lastLat && lastLng && lastAltitude ?
            `Lat: ${lastLat.toFixed(4)}, Lng: ${lastLng.toFixed(4)}, Alt: ${lastAltitude}m<br>No weather data available` :
            'No weather data available';
        return;
    }
    
    const time = formatTime(weatherData.time[index]);
    const levels = ['200hPa', '300hPa', '500hPa', '700hPa', '800hPa', '850hPa', '900hPa', '925hPa', '950hPa', '1000hPa'];
    
    let output = `Lat: ${lastLat.toFixed(4)}, Lng: ${lastLng.toFixed(4)}, Alt: ${lastAltitude}m<br>`;
    output += `Time: ${time}<br><br>`;
    
    output += `<table border="1" style="border-collapse: collapse; width: 100%;">`;
    output += `<tr><th>Level</th><th>T</th><th>RH</th><th>Dew</th><th>Dir</th><th>Spd</th><th>GH</th></tr>`;
    
    levels.forEach(level => {
        output += `<tr>`;
        output += `<td>${level}</td>`;
        
        let temp = weatherData[`temperature_${level}`]?.[index];
        output += `<td>${temp !== undefined ? `${temp}°C` : '-'}</td>`;
        
        let rh = weatherData[`relative_humidity_${level}`]?.[index];
        output += `<td>${rh !== undefined ? `${rh}%` : '-'}</td>`;
        
        let dewpoint = (temp !== undefined && rh !== undefined) ? calculateDewpoint(temp, rh) : '-';
        output += `<td>${dewpoint !== '-' ? `${dewpoint}°C` : '-'}</td>`;
        
        let windDir = weatherData[`wind_direction_${level}`]?.[index];
        let windSpeed = weatherData[`wind_speed_${level}`]?.[index];
        output += `<td>${windDir !== undefined ? `${windDir}°` : '-'}</td>`;
        output += `<td>${windSpeed !== undefined ? `${windSpeed}km/h` : '-'}</td>`;
        
        let gh = weatherData[`geopotential_height_${level}`]?.[index];
        output += `<td>${gh !== undefined ? `${Math.round(gh)}m` : '-'}</td>`;
        
        output += `</tr>`;
    });
    
    output += `<tr>`;
    output += `<td>Surface</td>`;
    
    let temp2m = weatherData.temperature_2m?.[index];
    output += `<td>${temp2m !== undefined ? `${temp2m}°C` : '-'}</td>`;
    
    let rh2m = weatherData.relative_humidity_2m?.[index];
    output += `<td>${rh2m !== undefined ? `${rh2m}%` : '-'}</td>`;
    
    let dewpoint2m = (temp2m !== undefined && rh2m !== undefined) ? calculateDewpoint(temp2m, rh2m) : '-';
    output += `<td>${dewpoint2m !== '-' ? `${dewpoint2m}°C` : '-'}</td>`;
    
    let windDir10m = weatherData.wind_direction_10m?.[index];
    let windSpeed10m = weatherData.wind_speed_10m?.[index];
    output += `<td>${windDir10m !== undefined ? `${windDir10m}°` : '-'}</td>`;
    output += `<td>${windSpeed10m !== undefined ? `${windSpeed10m}km/h` : '-'}</td>`;
    
    output += `<td>${(lastAltitude !== 'N/A' && lastAltitude !== null) ? `${Math.round(lastAltitude)}m` : '-'}</td>`;
    
    output += `</tr>`;
    
    output += `</table>`;
    
    document.getElementById('info').innerHTML = output;
}

function formatTime(isoString) {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
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
    setTimeout(() => {
        errorElement.style.display = 'none';
    }, 5000);
}

document.addEventListener('DOMContentLoaded', () => {
    const slider = document.getElementById('timeSlider');
    if (slider) {
        slider.addEventListener('input', (e) => {
            updateWeatherDisplay(e.target.value);
        });
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
                displayError('Bitte erst eine Position auf der Karte auswählen.');
            }
        });
    } else {
        console.error('Model select element not found');
    }
});