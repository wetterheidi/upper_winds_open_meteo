// Replace with your Mapbox API key
const MAPBOX_API_KEY = 'pk.eyJ1Ijoid2V0dGVyaGVpZGkiLCJhIjoiY203dXNrZWRyMDN4bzJwb2pkbmI5ZXh4diJ9.tZkGHqinrfyNFC-8afYMzA';
mapboxgl.accessToken = MAPBOX_API_KEY;

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v11',
    center: [13.4050, 52.5200],
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

async function fetchWeather(lat, lon) {
    try {
        // Korrigierte URL mit den richtigen Parametern für Druckniveau-Daten
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` + 
            `&hourly=temperature_2m,wind_speed_10m,wind_direction_10m` + 
            `&wind_speed_1000hPa=true&wind_direction_1000hPa=true` + 
            `&wind_speed_925hPa=true&wind_direction_925hPa=true` + 
            `&wind_speed_850hPa=true&wind_direction_850hPa=true` + 
            `&wind_speed_700hPa=true&wind_direction_700hPa=true` + 
            `&wind_speed_500hPa=true&wind_direction_500hPa=true` + 
            `&wind_speed_300hPa=true&wind_direction_300hPa=true` + 
            `&wind_speed_200hPa=true&wind_direction_200hPa=true` + 
            `&models=gfs_seamless`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Ausführlichere Logs für die geladenen Wetterdaten
        console.log("Weather data fetched successfully:", data);
        console.log("--------------------------------");
        console.log("Standort:", `Lat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(4)}`);
        console.log("Zeitraum:", data.hourly.time[0], "bis", data.hourly.time[data.hourly.time.length - 1]);
        console.log("Verfügbare Druckniveaus:", Object.keys(data.hourly)
            .filter(key => key.includes('wind_speed_') || key.includes('wind_direction_'))
            .map(key => key.replace('wind_speed_', '').replace('wind_direction_', '').replace('hPa', ''))
            .filter((v, i, a) => a.indexOf(v) === i)
            .sort()
            .map(level => `${level}hPa`));
        
        // Beispieldaten für den aktuellen Zeitpunkt (Index 0)
        console.log("--------------------------------");
        console.log("Aktuelle Daten (erster Zeitpunkt):");
        
        // Oberflächendaten
        console.log("Oberfläche:", {
            "Temperatur": `${data.hourly.temperature_2m[0]}${data.hourly_units.temperature_2m}`,
            "Wind": `${data.hourly.wind_speed_10m[0]}${data.hourly_units.wind_speed_10m} aus ${data.hourly.wind_direction_10m[0]}${data.hourly_units.wind_direction_10m}`
        });
        
        // Daten für Druckniveaus
        const levels = [1000, 925, 850, 700, 500, 300, 200];
        levels.forEach(level => {
            const speedKey = `wind_speed_${level}hPa`;
            const directionKey = `wind_direction_${level}hPa`;
            
            if (data.hourly[speedKey] && data.hourly[directionKey]) {
                console.log(`${level}hPa:`, {
                    "Wind": `${data.hourly[speedKey][0]}${data.hourly_units[speedKey]} aus ${data.hourly[directionKey][0]}${data.hourly_units[directionKey]}`
                });
            }
        });
        console.log("--------------------------------");
        
        // Speichern der Daten in der globalen Variable
        weatherData = data.hourly;
        
        return data;
    } catch (error) {
        console.error("Weather fetch error:", error);
        // Optional: Benutzerfreundliche Fehleranzeige hinzufügen
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
    if (!weatherData) {
        document.getElementById('info').innerText += '\nNo weather data available';
        return;
    }
    const time = weatherData.time[index];
    const levels = ['1000', '925', '850', '700', '500', '300', '200'];
    let output = `Time: ${time}\n`;
    output += `Surface: T=${weatherData[`temperature_2m`][index]}°C\n`;
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

// Hilfsfunktion zum Anzeigen von Fehlern (füge diese am Ende der Datei hinzu)
function displayError(message) {
    // Erstelle oder finde ein Element zur Fehleranzeige
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
    
    // Fehler nach 5 Sekunden ausblenden
    setTimeout(() => {
        errorElement.style.display = 'none';
    }, 5000);
}