import { AppState } from './state.js';
import { Utils } from './utils.js';
import { Settings, getInterpolationStep } from './settings.js';
import { displayError } from './ui.js';
import { fetchEnsembleWeatherData, clearEnsembleVisualizations } from './ensembleManager.js';

// Diese Funktion ist der neue, zentrale Einstiegspunkt von außen.
export async function fetchWeatherForLocation(lat, lng, currentTime = null) {
    console.log('[weatherManager] Starting full weather fetch for location:', { lat, lng });
    await checkAvailableModels(lat, lng);
    const weatherData = await fetchWeather(lat, lng, currentTime);
    return weatherData;
}

// Diese Funktion holt die reinen Wetterdaten.
async function fetchWeather(lat, lon, currentTime = null) {
    const loadingElement = document.getElementById('loading');
    if (loadingElement) loadingElement.style.display = 'block';

    try {
        const selectedModelValue = document.getElementById('modelSelect')?.value || Settings.defaultSettings.model;
        if (!selectedModelValue) throw new Error("No weather model selected.");

        const modelMap = {
            'icon_seamless': 'dwd_icon', 'icon_global': 'dwd_icon', 'icon_eu': 'dwd_icon_eu', 'icon_d2': 'dwd_icon_d2', 'ecmwf_ifs025': 'ecmwf_ifs025', 'ecmwf_aifs025_single': 'ecmwf_aifs025_single', 'gfs_seamless': 'ncep_gfs013', 'gfs_global': 'ncep_gfs025', 'gfs_hrrr': 'ncep_hrrr_conus', 'arome_france': 'meteofrance_arome_france0025', 'gem_hrdps_continental': 'cmc_gem_hrdps', 'gem_regional': 'cmc_gem_rdps'
        };
        const modelApiIdentifierForMeta = modelMap[selectedModelValue] || selectedModelValue;

        let isHistorical = false;
        let startDateStr, endDateStr;
        const today = luxon.DateTime.utc().startOf('day');
        let targetDateForAPI = null;

        if (currentTime) {
            let parsedTime = luxon.DateTime.fromISO(currentTime, { zone: 'utc' });
            if (parsedTime.isValid) {
                targetDateForAPI = parsedTime.startOf('day');
                if (targetDateForAPI < today) isHistorical = true;
            }
        } else {
             const pickerDate = document.getElementById('historicalDatePicker')?.value;
             if(pickerDate){
                let parsedPickerDate = luxon.DateTime.fromISO(pickerDate, { zone: 'utc' }).startOf('day');
                if(parsedPickerDate < today) {
                    isHistorical = true;
                    targetDateForAPI = parsedPickerDate;
                }
             }
        }
        
        let baseUrl = 'https://api.open-meteo.com/v1/forecast';
        if (isHistorical && targetDateForAPI) {
            baseUrl = 'https://historical-forecast-api.open-meteo.com/v1/forecast';
            startDateStr = endDateStr = targetDateForAPI.toFormat('yyyy-MM-dd');
            AppState.lastModelRun = "N/A (Historical Data)";
        } else {
            // Normale Forecast-Logik zur Bestimmung des Zeitfensters
             let runDate;
             try {
                const metaUrl = `https://api.open-meteo.com/data/${modelApiIdentifierForMeta}/static/meta.json`;
                const metaResponse = await fetch(metaUrl);
                const metaData = await metaResponse.json();
                runDate = new Date(metaData.last_run_initialisation_time * 1000);
                AppState.lastModelRun = runDate.toISOString().replace('T', ' ').substring(0, 17) + 'Z';
             } catch(e) {
                runDate = new Date();
                AppState.lastModelRun = "N/A";
             }
            let forecastStart = luxon.DateTime.fromJSDate(runDate).setZone('utc').plus({ hours: 6 });
            if (forecastStart > luxon.DateTime.utc()) forecastStart = luxon.DateTime.utc();
            startDateStr = forecastStart.toFormat('yyyy-MM-dd');
            const forecastDays = selectedModelValue.includes('_d2') ? 2 : 7;
            endDateStr = forecastStart.plus({ days: forecastDays }).toFormat('yyyy-MM-dd');
        }

        const hourlyParams = "surface_pressure,temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_1000hPa,relative_humidity_1000hPa,wind_speed_1000hPa,wind_direction_1000hPa,geopotential_height_1000hPa,temperature_950hPa,relative_humidity_950hPa,wind_speed_950hPa,wind_direction_950hPa,geopotential_height_950hPa,temperature_925hPa,relative_humidity_925hPa,wind_speed_925hPa,wind_direction_925hPa,geopotential_height_925hPa,temperature_900hPa,relative_humidity_900hPa,wind_speed_900hPa,wind_direction_900hPa,geopotential_height_900hPa,temperature_850hPa,relative_humidity_850hPa,wind_speed_850hPa,wind_direction_850hPa,geopotential_height_850hPa,temperature_800hPa,relative_humidity_800hPa,wind_speed_800hPa,wind_direction_800hPa,geopotential_height_800hPa,temperature_700hPa,relative_humidity_700hPa,wind_speed_700hPa,wind_direction_700hPa,geopotential_height_700hPa,temperature_600hPa,relative_humidity_600hPa,wind_speed_600hPa,wind_direction_600hPa,geopotential_height_600hPa,temperature_500hPa,relative_humidity_500hPa,wind_speed_500hPa,wind_direction_500hPa,geopotential_height_500hPa,temperature_400hPa,relative_humidity_400hPa,wind_speed_400hPa,wind_direction_400hPa,geopotential_height_400hPa,temperature_300hPa,relative_humidity_300hPa,wind_speed_300hPa,wind_direction_300hPa,geopotential_height_300hPa,temperature_250hPa,relative_humidity_250hPa,wind_speed_250hPa,wind_direction_250hPa,geopotential_height_250hPa,temperature_200hPa,relative_humidity_200hPa,wind_speed_200hPa,wind_direction_200hPa,geopotential_height_200hPa";
        const url = `${baseUrl}?latitude=${lat}&longitude=${lon}&hourly=${hourlyParams}&models=${selectedModelValue}&start_date=${startDateStr}&end_date=${endDateStr}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const data = await response.json();
        if (!data.hourly || !data.hourly.time || !data.hourly.time.length) throw new Error('No hourly data in API response.');
        return data.hourly;

    } catch (error) {
        console.error("[fetchWeather] Error:", error);
        displayError(`Failed to fetch weather: ${error.message}`);
        return null;
    } finally {
        if (loadingElement) loadingElement.style.display = 'none';
    }
}

async function checkAvailableModels(lat, lon) {
    const modelList = ['icon_seamless', 'icon_global', 'icon_eu', 'icon_d2', 'ecmwf_ifs025', 'ecmwf_aifs025_single', 'gfs_seamless', 'gfs_global', 'gfs_hrrr', 'arome_france', 'gem_hrdps_continental', 'gem_regional'];
    let availableModels = [];
    for (const model of modelList) {
        try {
            const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&models=${model}`);
            if (response.ok) {
                const data = await response.json();
                if (data.hourly && data.hourly.temperature_2m && data.hourly.temperature_2m.some(t => t !== null)) {
                    availableModels.push(model);
                }
            }
        } catch (e) { /* ignore */ }
    }
    updateModelSelectUI(availableModels);
    updateEnsembleModelUI(availableModels);
    cleanupSelectedEnsembleModels(availableModels);
    return availableModels;
}

function updateModelSelectUI(availableModels) {
    const modelSelect = document.getElementById('modelSelect');
    if (!modelSelect) return;
    const currentSelected = modelSelect.value;
    modelSelect.innerHTML = '';
    availableModels.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model.replace(/_/g, ' ').toUpperCase();
        modelSelect.appendChild(option);
    });
    if (availableModels.includes(Settings.state.userSettings.model)) {
        modelSelect.value = Settings.state.userSettings.model;
    } else if (availableModels.includes(currentSelected)) {
        modelSelect.value = currentSelected;
    } else if (availableModels.length > 0) {
        modelSelect.value = availableModels[0];
    }
}

function updateEnsembleModelUI(availableModels) {
    const submenu = document.getElementById('ensembleModelsSubmenu');
    if (!submenu) return;
    submenu.innerHTML = '';
    availableModels.forEach(model => {
        const li = document.createElement('li');
        const label = document.createElement('label');
        label.className = 'radio-label';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.name = 'ensembleModel';
        checkbox.value = model;
        checkbox.checked = Settings.state.userSettings.selectedEnsembleModels.includes(model);
        checkbox.addEventListener('change', () => {
            const selected = Array.from(submenu.querySelectorAll('input:checked')).map(cb => cb.value);
            Settings.state.userSettings.selectedEnsembleModels = selected;
            Settings.save();
            fetchEnsembleWeatherData();
        });
        label.append(checkbox, ` ${model.replace(/_/g, ' ').toUpperCase()}`);
        li.appendChild(label);
        submenu.appendChild(li);
    });
}

function cleanupSelectedEnsembleModels(availableModels) {
    let selected = Settings.state.userSettings.selectedEnsembleModels || [];
    let updated = selected.filter(m => availableModels.includes(m));
    if (selected.length !== updated.length) {
        Settings.state.userSettings.selectedEnsembleModels = updated;
        Settings.save();
    }
}

export function interpolateWeatherData(sliderIndex) {
    if (!AppState.weatherData || !AppState.weatherData.time || sliderIndex >= AppState.weatherData.time.length) {
        console.warn('No weather data available for interpolation');
        return [];
    }

    const baseHeight = Math.round(AppState.lastAltitude);
    const interpStep = parseInt(getInterpolationStep()) || 100;
    const heightUnit = Settings.getValue('heightUnit', 'radio', 'm');

    // Define all possible pressure levels
    const allPressureLevels = [1000, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200];

    // Filter pressure levels with valid geopotential height data
    const validPressureLevels = allPressureLevels.filter(hPa => {
        const height = AppState.weatherData[`geopotential_height_${hPa}hPa`]?.[sliderIndex];
        return height !== null && height !== undefined;
    });

    if (validPressureLevels.length < 2) {
        console.warn('Insufficient valid pressure level data for interpolation:', validPressureLevels);
        return [];
    }

    // Collect data for valid pressure levels
    let heightData = validPressureLevels.map(hPa => AppState.weatherData[`geopotential_height_${hPa}hPa`][sliderIndex]);
    let tempData = validPressureLevels.map(hPa => AppState.weatherData[`temperature_${hPa}hPa`][sliderIndex]);
    let rhData = validPressureLevels.map(hPa => AppState.weatherData[`relative_humidity_${hPa}hPa`][sliderIndex]);
    let spdData = validPressureLevels.map(hPa => AppState.weatherData[`wind_speed_${hPa}hPa`][sliderIndex]);
    let dirData = validPressureLevels.map(hPa => AppState.weatherData[`wind_direction_${hPa}hPa`][sliderIndex]);

    const surfacePressure = AppState.weatherData.surface_pressure[sliderIndex];
    if (surfacePressure === null || surfacePressure === undefined) {
        console.warn('Surface pressure missing');
        return [];
    }

    // Calculate wind components at valid pressure levels
    let uComponents = spdData.map((spd, i) => -spd * Math.sin(dirData[i] * Math.PI / 180));
    let vComponents = spdData.map((spd, i) => -spd * Math.cos(dirData[i] * Math.PI / 180));

    // Add surface and intermediate points if surfacePressure > lowest valid pressure level
    const lowestPressureLevel = Math.max(...validPressureLevels);
    const hLowest = AppState.weatherData[`geopotential_height_${lowestPressureLevel}hPa`][sliderIndex];
    if (surfacePressure > lowestPressureLevel && Number.isFinite(hLowest) && hLowest > baseHeight) {
        const stepsBetween = Math.floor((hLowest - baseHeight) / interpStep);

        // Surface wind components
        const uSurface = -AppState.weatherData.wind_speed_10m[sliderIndex] * Math.sin(AppState.weatherData.wind_direction_10m[sliderIndex] * Math.PI / 180);
        const vSurface = -AppState.weatherData.wind_speed_10m[sliderIndex] * Math.cos(AppState.weatherData.wind_direction_10m[sliderIndex] * Math.PI / 180);
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
            tempData.unshift(Utils.LIP([baseHeight, hLowest], [AppState.weatherData.temperature_2m[sliderIndex], AppState.weatherData[`temperature_${lowestPressureLevel}hPa`][sliderIndex]], h));
            rhData.unshift(Utils.LIP([baseHeight, hLowest], [AppState.weatherData.relative_humidity_2m[sliderIndex], AppState.weatherData[`relative_humidity_${lowestPressureLevel}hPa`][sliderIndex]], h));
            spdData.unshift(spd);
            dirData.unshift(dir);
            uComponents.unshift(u);
            vComponents.unshift(v);
        }

        // Add surface data
        heightData.unshift(baseHeight);
        validPressureLevels.unshift(surfacePressure);
        tempData.unshift(AppState.weatherData.temperature_2m[sliderIndex]);
        rhData.unshift(AppState.weatherData.relative_humidity_2m[sliderIndex]);
        spdData.unshift(AppState.weatherData.wind_speed_10m[sliderIndex]);
        dirData.unshift(AppState.weatherData.wind_direction_10m[sliderIndex]);
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
                temp: AppState.weatherData.temperature_2m[sliderIndex],
                rh: AppState.weatherData.relative_humidity_2m[sliderIndex],
                spd: AppState.weatherData.wind_speed_10m[sliderIndex],
                dir: AppState.weatherData.wind_direction_10m[sliderIndex],
                dew: Utils.calculateDewpoint(AppState.weatherData.temperature_2m[sliderIndex], AppState.weatherData.relative_humidity_2m[sliderIndex])
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

