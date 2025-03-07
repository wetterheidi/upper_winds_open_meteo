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

map.on('click', async (e) => {
    const { lng, lat } = e.lngLat;
    lastLat = lat;
    lastLng = lng;
    const altitude = await getAltitude(lng, lat);
    lastAltitude = altitude;
    document.getElementById('info').innerText = `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}, Alt: ${altitude}m\nFetching weather...`;
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
        document.getElementById('info').innerText = 'No weather data available';
        return;
    }
    
    const time = formatTime(weatherData.time[index]);
    const levels = ['200hPa', '300hPa', '500hPa', '700hPa', '800hPa', '850hPa', '900hPa', '925hPa', '950hPa', '1000hPa'];
    
    let output = `Time: ${time}\n`;
    
    levels.forEach(level => {
        output += `${level}: `;
        let hasData = false;
        
        if (weatherData[`temperature_${level}`] && weatherData[`temperature_${level}`][index] !== undefined) {
            output += `T=${weatherData[`temperature_${level}`][index]}°C`;
            hasData = true;
        }
        
        if (weatherData[`relative_humidity_${level}`] && weatherData[`relative_humidity_${level}`][index] !== undefined) {
            const rh = weatherData[`relative_humidity_${level}`][index];
            if (hasData) output += ', ';
            output += `RH=${rh}%`;
            if (weatherData[`temperature_${level}`] && weatherData[`temperature_${level}`][index] !== undefined) {
                const temp = weatherData[`temperature_${level}`][index];
                const dewpoint = calculateDewpoint(temp, rh);
                output += `, Dew=${dewpoint}°C`;
            }
            hasData = true;
        }
        
        if (weatherData[`wind_speed_${level}`] && weatherData[`wind_direction_${level}`] &&
            weatherData[`wind_speed_${level}`][index] !== undefined && 
            weatherData[`wind_direction_${level}`][index] !== undefined) {
            if (hasData) output += ', ';
            output += `Wind=${weatherData[`wind_direction_${level}`][index]}° ${weatherData[`wind_speed_${level}`][index]}km/h`;
            hasData = true;
        }
        
        if (weatherData[`geopotential_height_${level}`] && weatherData[`geopotential_height_${level}`][index] !== undefined) {
            if (hasData) output += ', ';
            output += `GH=${Math.round(weatherData[`geopotential_height_${level}`][index])}m`;
            hasData = true;
        }
        
        if (!hasData) {
            output += 'Keine Daten verfügbar';
        }
        
        output += '\n';
    });
    
    if (weatherData.temperature_2m && weatherData.temperature_2m[index] !== undefined) {
        output += `Surface: T=${weatherData.temperature_2m[index]}°C`;
        if (weatherData.relative_humidity_2m && weatherData.relative_humidity_2m[index] !== undefined) {
            const rh = weatherData.relative_humidity_2m[index];
            output += `, RH=${rh}%`;
            const dewpoint = calculateDewpoint(weatherData.temperature_2m[index], rh);
            output += `, Dew=${dewpoint}°C`;
        }
        if (weatherData.wind_speed_10m && weatherData.wind_direction_10m) {
            output += `, Wind=${weatherData.wind_direction_10m[index]}° ${weatherData.wind_speed_10m[index]}km/h`;
        }
        if (lastAltitude !== 'N/A' && lastAltitude !== null) {
            output += `, GH=${Math.round(lastAltitude)}m`;
        }
        output += '\n';
    }
    
    document.getElementById('info').innerText = output;
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
                document.getElementById('info').innerText = `Lat: ${lastLat.toFixed(4)}, Lng: ${lastLng.toFixed(4)}\nFetching weather with ${modelSelect.value}...`;
                fetchWeather(lastLat, lastLng);
            } else {
                displayError('Bitte erst eine Position auf der Karte auswählen.');
            }
        });
    } else {
        console.error('Model select element not found');
    }
});