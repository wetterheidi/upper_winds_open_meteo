// Replace with your Mapbox API key
const MAPBOX_API_KEY = 'pk.eyJ1Ijoid2V0dGVyaGVpZGkiLCJhIjoiY203dXNrZWRyMDN4bzJwb2pkbmI5ZXh4diJ9.tZkGHqinrfyNFC-8afYMzA';
mapboxgl.accessToken = MAPBOX_API_KEY;

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v11',
    center: [13.4050, 52.5200], // Berlin
    zoom: 10
});

let weatherData = null;

map.on('click', async (e) => {
    const { lng, lat } = e.lngLat;
    const altitude = await getAltitude(lng, lat);
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

async function fetchWeather(lat, lng) {
    try {
        const roundedLat = lat.toFixed(4);
        const roundedLng = lng.toFixed(4);
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${roundedLat}&longitude=${roundedLng}&hourly=temperature,relative_humidity,wind_speed,wind_direction&pressure_levels=1000,925,850,700,500,300,200`;
        console.log('Fetching from:', url); // Debug
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const data = await response.json();
        console.log('Response data:', data); // Debug
        if (!data.hourly) {
            throw new Error('No hourly data in response');
        }
        weatherData = data.hourly;
        document.getElementById('timeSlider').disabled = false;
        updateWeatherDisplay(0);
    } catch (error) {
        console.error('Weather fetch error:', error);
        document.getElementById('info').innerText += `\nError fetching weather: ${error.message}`;
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
    if (!weatherData) {
        document.getElementById('info').innerText += '\nNo weather data available';
        return;
    }
    const time = weatherData.time[index];
    const levels = ['1000', '925', '850', '700', '500', '300', '200'];
    let output = `Time: ${time}\n`;
    levels.forEach(level => {
        const temp = weatherData[`temperature_${level}`][index];
        const rh = weatherData[`relative_humidity_${level}`][index];
        const dewpoint = calculateDewpoint(temp, rh);
        output += `${level}hPa: `
            + `T=${temp}°C, `
            + `RH=${rh}%, `
            + `Dew=${dewpoint}°C, `
            + `Wind=${weatherData[`wind_speed_${level}`][index]}km/h @ `
            + `${weatherData[`wind_direction_${level}`][index]}°\n`;
    });
    document.getElementById('info').innerText = output;
}

document.getElementById('timeSlider').addEventListener('input', (e) => {
    updateWeatherDisplay(e.target.value);
});