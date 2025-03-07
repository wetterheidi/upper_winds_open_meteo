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
let lastModelRun = null;

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
    } else {
        document.getElementById('info').innerHTML = `No models available.`;
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
        const modelSelect = document.getElementById('modelSelect').value;
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
            `&models=${modelSelect}`);

        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);

        const data = await response.json();
        weatherData = data.hourly;

        const modelMap = {
            'icon_global': 'dwd_icon',
            'gfs_seamless': 'ncep_gfs013',
            'gfs_global': 'ncep_gfs025',
            'icon_eu': 'dwd_icon_eu',
            'icon_d2': 'dwd_icon_d2',
            'ecmwf_ifs025': 'ecmwf_ifs025',
            'ecmwf_aifs025': 'ecmwf_aifs025_single',
            'ncep_hrrr': 'ncep_hrrr_conus'
        };
        const model = modelMap[modelSelect] || modelSelect;

        const metaResponse = await fetch(`https://api.open-meteo.com/data/${model}/static/meta.json`);
        if (!metaResponse.ok) throw new Error(`Meta fetch failed: ${metaResponse.status}`);
        const metaData = await metaResponse.json();

        const runDate = new Date(metaData.last_run_initialisation_time * 1000);
        const year = runDate.getUTCFullYear();
        const month = String(runDate.getUTCMonth() + 1).padStart(2, '0');
        const day = String(runDate.getUTCDate()).padStart(2, '0');
        const hour = String(runDate.getUTCHours()).padStart(2, '0');
        const minute = String(runDate.getUTCMinutes()).padStart(2, '0');
        lastModelRun = `${year}-${month}-${day} ${hour}${minute}`;

        const slider = document.getElementById('timeSlider');
        slider.max = data.hourly.time.length - 1;
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
        'icon_global', 'gfs_seamless', 'gfs_global', 'ecmwf_ifs025', 'ecmwf_aifs025',
        'gem_global', 'ncep_hrrr', 'icon_eu', 'icon_d2', 'gfs025', 'icon_seamless'
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
    const levels = ['200 hPa', '300 hPa', '500 hPa', '700 hPa', '800 hPa', '850 hPa', '900 hPa', '925 hPa', '950 hPa', '1000 hPa'];
    
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

    dataPoints.sort((a, b) => a.height - b.height);
    const maxHeight = dataPoints[dataPoints.length - 1].height;
    const interpolated = [];

    const pressureLevels = [200, 300, 500, 700, 800, 850, 900, 925, 950, 1000];
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
            temp: temp.toFixed(1),
            rh: rh.toFixed(1),
            dew: dew,
            dir: dir.toFixed(0),
            spd: spd.toFixed(1),
            pressure: pressure === '-' ? '-' : pressure.toFixed(1)
        });
    }

    const surfaceData = dataPoints.find(d => d.level === `${surfaceHeight} m`);
    if (surfaceData) {
        const dew = (surfaceData.temp !== undefined && surfaceData.rh !== undefined) ? calculateDewpoint(surfaceData.temp, surfaceData.rh) : '-';
        const pressure = interpolatePressure(surfaceData.height, pressureLevels, pressureHeights);
        interpolated.push({
            height: surfaceData.height,
            displayHeight: surfaceHeight,
            temp: surfaceData.temp?.toFixed(1) ?? '-',
            rh: surfaceData.rh?.toFixed(1) ?? '-',
            dew: dew,
            dir: surfaceData.dir?.toFixed(0) ?? '-',
            spd: surfaceData.spd?.toFixed(1) ?? '-',
            pressure: pressure === '-' ? '-' : pressure.toFixed(1)
        });
    }

    interpolated.sort((a, b) => b.height - a.height);
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

function windDirection(x, y) {
    let dir = Math.atan2(x, y) * 180 / Math.PI;
    dir = (270 - dir) % 360;
    return dir < 0 ? dir + 360 : dir;
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

    let xTrapez = 0;
    let yTrapez = 0;
    for (let i = 0; i < hSchicht.length - 1; i++) {
        xTrapez += 0.5 * (xSchicht[i] + xSchicht[i + 1]) * (hSchicht[i] - hSchicht[i + 1]);
        yTrapez += 0.5 * (ySchicht[i] + ySchicht[i + 1]) * (hSchicht[i] - hSchicht[i + 1]);
    }

    const xMittel = xTrapez / (hSchicht[0] - hSchicht[hSchicht.length - 1]);
    const yMittel = yTrapez / (hSchicht[0] - hSchicht[hSchicht.length - 1]);

    dddff[2] = xMittel;
    dddff[3] = yMittel;
    dddff[1] = windSpeed(xMittel, yMittel);
    dddff[0] = windDirection(xMittel, yMittel);

    return dddff;
}

function updateWeatherDisplay(index) {
    if (!weatherData || !weatherData.time || !weatherData.time[index]) {
        document.getElementById('info').innerHTML = 'No weather data available';
        return;
    }

    const time = formatTime(weatherData.time[index]);
    const interpolatedData = interpolateWeatherData(index);

    let output = `Time: ${time}<br><br>`;

    output += `<table border="1" style="border-collapse: collapse; width: 100%;">`;
    output += `<tr>`;
    output += `<th style="width: 15%;">Height (m)</th>`;
    output += `<th style="width: 15%;">T (°C)</th>`;
    output += `<th style="width: 15%;">RH (%)</th>`;
    output += `<th style="width: 15%;">Dew (°C)</th>`;
    output += `<th style="width: 15%;">Dir (°)</th>`;
    output += `<th style="width: 15%;">Spd (kt)</th>`;
    output += `<th style="width: 15%;">Pressure (hPa)</th>`;
    output += `</tr>`;

    interpolatedData.forEach(data => {
        output += `<tr>`;
        output += `<td>${data.displayHeight}</td>`;
        output += `<td>${data.temp}</td>`;
        output += `<td>${data.rh}</td>`;
        output += `<td>${data.dew}</td>`;
        output += `<td>${data.dir}</td>`;
        output += `<td>${data.spd}</td>`;
        output += `<td>${data.pressure}</td>`;
        output += `</tr>`;
    });

    output += `</table>`;
    output += `<div id="meanWindResult"></div>`;

    document.getElementById('info').innerHTML = output;
}

function calculateMeanWind() {
    const index = document.getElementById('timeSlider').value || 0;
    const interpolatedData = interpolateWeatherData(index);
    const lowerLimit = parseFloat(document.getElementById('lowerLimit').value);
    const upperLimit = parseFloat(document.getElementById('upperLimit').value);
    const refLevel = document.getElementById('refLevelSelect').value || 'AGL';

    if (isNaN(lowerLimit) || isNaN(upperLimit) || lowerLimit >= upperLimit) {
        displayError('Invalid layer limits. Ensure Lower < Upper and both are numbers.');
        return;
    }

    const baseHeight = Math.round(lastAltitude);
    const heights = interpolatedData.map(d => refLevel === 'AGL' ? d.displayHeight + baseHeight : d.displayHeight);
    const dirs = interpolatedData.map(d => parseFloat(d.dir));
    const spds = interpolatedData.map(d => parseFloat(d.spd));

    const xKomponente = spds.map((spd, i) => spd * Math.sin((dirs[i] - 180) * Math.PI / 180));
    const yKomponente = spds.map((spd, i) => spd * Math.cos((dirs[i] - 180) * Math.PI / 180));

    const meanWind = Mittelwind(heights, xKomponente, yKomponente, lowerLimit, upperLimit);
    const [dir, spd] = meanWind;

    const result = `Mean Wind (${lowerLimit}-${upperLimit} m ${refLevel}): ${dir.toFixed(0)}° / ${spd.toFixed(1)} kt`;
    document.getElementById('meanWindResult').innerHTML = `<br>${result}`;
}

function formatTime(isoString) {
    const date = new Date(isoString);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hour = String(date.getUTCHours()).padStart(2, '0');
    const minute = String(date.getUTCMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}${minute}`;
}

function downloadTableAsAscii() {
    if (!weatherData || !weatherData.time) {
        displayError('No weather data available to download.');
        return;
    }

    const index = document.getElementById('timeSlider').value || 0;
    const model = document.getElementById('modelSelect').value.toUpperCase();
    const time = formatTime(weatherData.time[index]).replace(' ', '_');
    const filename = `${time}_${model}_HEIDIS.txt`;

    const interpolatedData = interpolateWeatherData(index);
    let content = 'Height T RH Dew Dir Spd Pressure\n';

    interpolatedData.forEach(data => {
        content += `${data.displayHeight} ${data.temp} ${data.rh} ${data.dew} ${data.dir} ${data.spd} ${data.pressure}\n`;
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
    const infoButton = document.getElementById('modelInfoButton');
    const infoPopup = document.getElementById('modelInfoPopup');
    const downloadButton = document.getElementById('downloadButton');
    const interpStepSelect = document.getElementById('interpStepSelect');
    const refLevelSelect = document.getElementById('refLevelSelect');
    const calcMeanWindButton = document.getElementById('calcMeanWindButton');

    if (modelSelect) {
        modelSelect.addEventListener('change', () => {
            if (lastLat && lastLng) {
                document.getElementById('info').innerHTML = `Fetching weather with ${modelSelect.value}...`;
                fetchWeather(lastLat, lastLng);
            } else {
                displayError('Please select a position on the map first.');
            }
        });
    } else {
        console.error('Model select element not found');
    }

    if (infoButton && infoPopup) {
        infoButton.addEventListener('click', () => {
            if (!lastModelRun) {
                displayError('No model run data available yet.');
                return;
            }

            const model = document.getElementById('modelSelect').value;
            const runText = `Model: ${model.replace('_', ' ').toUpperCase()}<br>Run: ${lastModelRun}`;

            const buttonRect = infoButton.getBoundingClientRect();
            infoPopup.style.left = `${buttonRect.left}px`;
            infoPopup.style.top = `${buttonRect.bottom + 5}px`;
            infoPopup.innerHTML = runText;
            infoPopup.style.display = 'block';

            setTimeout(() => {
                infoPopup.style.display = 'none';
            }, 5000);
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
            } else {
                displayError('Please select a position and fetch weather data first.');
            }
        });
    } else {
        console.error('Reference level select element not found');
    }

    if (calcMeanWindButton) {
        calcMeanWindButton.addEventListener('click', calculateMeanWind);
    } else {
        console.error('Calculate mean wind button not found');
    }
});