// Replace with your Mapbox API key
const MAPBOX_API_KEY = 'pk.eyJ1Ijoid2V0dGVyaGVpZGkiLCJhIjoiY203dXNrZWRyMDN4bzJwb2pkbmI5ZXh4diJ9.tZkGHqinrfyNFC-8afYMzA';
mapboxgl.accessToken = MAPBOX_API_KEY;

// Initialize Mapbox map
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v11',
    center: [11.1915, 48.0177], // Herrsching as default [lng, lat]
    zoom: 10
});

// Global weather data storage
let weatherData = null;

// Map click event
map.on('click', async (e) => {
    const { lng, lat } = e.lngLat;
    const altitude = await getAltitude(lng, lat);
    document.getElementById('info').innerText = `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}, Alt: ${altitude}m\nFetching weather...`;
    await fetchWeather(lat, lng);
});

// Fetch altitude using Mapbox Terrain API
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

// Fetch weather data from OpenMeteo
async function fetchWeather(lat, lng) {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature,dewpoint,pressure,wind_speed,wind_direction&pressure_levels=1000,925,850,700,500,300,200`;
        const response = await fetch(url);
        weatherData = (await response.json()).hourly;
        document.getElementById('timeSlider').disabled = false;
        updateWeatherDisplay(0); // Show initial data
    } catch (error) {
        console.error('Weather fetch error:', error);
        document.getElementById('info').innerText += '\nError fetching weather data';
    }
}

// Update display based on slider position
function updateWeatherDisplay(index) {
    if (!weatherData) return;
    const time = weatherData.time[index];
    const levels = ['1000', '925', '850', '700', '500', '300', '200'];
    let output = `Time: ${time}\n`;
    levels.forEach(level => {
        output += `${level}hPa: `
            + `T=${weatherData[`temperature_${level}`][index]}°C, `
            + `Dew=${weatherData[`dewpoint_${level}`][index]}°C, `
            + `P=${weatherData[`pressure_${level}`][index]}hPa, `
            + `Wind=${weatherData[`wind_speed_${level}`][index]}km/h @ `
            + `${weatherData[`wind_direction_${level}`][index]}°\n`;
    });
    document.getElementById('info').innerText = output;
}

// Slider event listener
document.getElementById('timeSlider').addEventListener('input', (e) => {
    updateWeatherDisplay(e.target.value);
});