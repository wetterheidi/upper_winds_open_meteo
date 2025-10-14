/**
 * @file ensembleManager.js
 * @description Verwaltet den Abruf, die Verarbeitung und die Visualisierung von
 * Ensemble-Wettervorhersagedaten. Ermöglicht die Darstellung verschiedener Szenarien
 * (z.B. minimaler, mittlerer, maximaler Wind) auf der Karte.
 */

import { AppState } from './state.js';
import { getInterpolationStep, Settings } from './settings.js';
import { Utils } from './utils.js';
import * as JumpPlanner from './jumpPlanner.js';
import * as weatherManager from './weatherManager.js';
import { DateTime } from 'luxon';
import { ENSEMBLE_VISUALIZATION, API_URLS } from './constants.js';

// ===================================================================
// 1. Öffentliche Hauptfunktionen (API des Moduls)
// ===================================================================

/**
 * Ruft die Wetterdaten für alle vom Benutzer ausgewählten Ensemble-Modelle ab.
 * Bündelt die Modellnamen in einer einzigen API-Anfrage, verarbeitet die Antwort
 * und speichert die getrennten Modelldaten im AppState.
 * @returns {Promise<boolean>} Ein Promise, das `true` bei Erfolg und `false` bei einem Fehler zurückgibt.
 */
export async function fetchEnsembleWeatherData() {
    // Vorbedingung: Eine Position muss ausgewählt sein.
    if (AppState.lastLat == null || AppState.lastLng == null) {
        Utils.handleMessage("Please select a location first.");
        return false;
    }
    // Wenn keine Modelle ausgewählt sind, leeren wir die Daten und melden Erfolg.
    if (!Settings.state.userSettings.selectedEnsembleModels || Settings.state.userSettings.selectedEnsembleModels.length === 0) {
        AppState.ensembleModelsData = null;
        clearEnsembleVisualizations();
        return true; // Es ist kein Fehler, wenn nichts ausgewählt ist.
    }

    const loadingElement = document.getElementById('loading');
    if (loadingElement) loadingElement.style.display = 'block';

    try {
        const lat = AppState.lastLat;
        const lon = AppState.lastLng;
        const modelsToFetch = Settings.state.userSettings.selectedEnsembleModels;
        const modelString = modelsToFetch.join(',');
        // Die Liste der benötigten Wettervariablen.
        const baseVariablesList = [
            "surface_pressure", "temperature_2m", "relative_humidity_2m", "wind_speed_10m", "wind_direction_10m",
            "geopotential_height_1000hPa", "temperature_1000hPa", "relative_humidity_1000hPa", "wind_speed_1000hPa", "wind_direction_1000hPa", "cloud_cover_1000hPa",
            "geopotential_height_950hPa", "temperature_950hPa", "relative_humidity_950hPa", "wind_speed_950hPa", "wind_direction_950hPa", "cloud_cover_950hPa",
            "geopotential_height_925hPa", "temperature_925hPa", "relative_humidity_925hPa", "wind_speed_925hPa", "wind_direction_925hPa", "cloud_cover_925hPa",
            "geopotential_height_900hPa", "temperature_900hPa", "relative_humidity_900hPa", "wind_speed_900hPa", "wind_direction_900hPa", "cloud_cover_900hPa",
            "geopotential_height_850hPa", "temperature_850hPa", "relative_humidity_850hPa", "wind_speed_850hPa", "wind_direction_850hPa", "cloud_cover_850hPa",
            "geopotential_height_800hPa", "temperature_800hPa", "relative_humidity_800hPa", "wind_speed_800hPa", "wind_direction_800hPa", "cloud_cover_800hPa",
            "geopotential_height_700hPa", "temperature_700hPa", "relative_humidity_700hPa", "wind_speed_700hPa", "wind_direction_700hPa", "cloud_cover_700hPa",
            "geopotential_height_600hPa", "temperature_600hPa", "relative_humidity_600hPa", "wind_speed_600hPa", "wind_direction_600hPa", "cloud_cover_600hPa",
            "geopotential_height_500hPa", "temperature_500hPa", "relative_humidity_500hPa", "wind_speed_500hPa", "wind_direction_500hPa", "cloud_cover_500hPa",
            "geopotential_height_400hPa", "temperature_400hPa", "relative_humidity_400hPa", "wind_speed_400hPa", "wind_direction_400hPa", "cloud_cover_400hPa",
            "geopotential_height_300hPa", "temperature_300hPa", "relative_humidity_300hPa", "wind_speed_300hPa", "wind_direction_300hPa", "cloud_cover_300hPa",
            "geopotential_height_250hPa", "temperature_250hPa", "relative_humidity_250hPa", "wind_speed_250hPa", "wind_direction_250hPa", "cloud_cover_250hPa",
            "geopotential_height_200hPa", "temperature_200hPa", "relative_humidity_200hPa", "wind_speed_200hPa", "wind_direction_200hPa", "cloud_cover_200hPa"
        ];
        const hourlyVariablesString = baseVariablesList.join(',');
        // Bestimmen, ob eine historische oder Vorhersage-Anfrage gestellt wird.
        const historicalDatePicker = document.getElementById('historicalDatePicker');
        const selectedDateValue = historicalDatePicker ? historicalDatePicker.value : null;
        const selectedDate = selectedDateValue ? DateTime.fromISO(selectedDateValue, { zone: 'utc' }) : null;
        const today = DateTime.utc().startOf('day');
        const isHistorical = selectedDate && selectedDate < today;
        let startDateStr, endDateStr;
        let baseUrl = API_URLS.FORECAST;
        if (isHistorical) {
            baseUrl = API_URLS.HISTORICAL;
            startDateStr = selectedDate.toFormat('yyyy-MM-dd');
            endDateStr = startDateStr;
        } else {
            const now = DateTime.utc();
            startDateStr = now.toFormat('yyyy-MM-dd');
            endDateStr = now.plus({ days: 7 }).toFormat('yyyy-MM-dd');
        }
        const url = `${baseUrl}?latitude=${lat}&longitude=${lon}&hourly=${hourlyVariablesString}&models=${modelString}&start_date=${startDateStr}&end_date=${endDateStr}`;
        const response = await fetch(url);
        if (!response.ok) {
            if (response.status === 429) {
                throw new Error("API-Limit for ensemble data reached. Please wait a moment and retry again.");
            }
            throw new Error(`API request failed: ${response.status}`);
        }
        const apiResponseData = await response.json();
        AppState.ensembleModelsData = {}; // Initialisieren

        // Die API liefert für jedes Modell einen eigenen Satz von Variablen (z.B. temperature_2m_icon_global).
        // Wir teilen diese auf und erstellen für jedes Modell ein eigenes "hourly"-Objekt.
        const sharedTimeArray = apiResponseData.hourly.time;
        modelsToFetch.forEach(modelName => {
            const modelSpecificHourlyData = { time: [...sharedTimeArray] };
            let foundDataForThisModel = false;
            baseVariablesList.forEach(baseVar => {
                const suffixedVarKey = `${baseVar}_${modelName}`;
                if (apiResponseData.hourly[suffixedVarKey]) {
                    modelSpecificHourlyData[baseVar] = apiResponseData.hourly[suffixedVarKey];
                    foundDataForThisModel = true;
                } else {
                    modelSpecificHourlyData[baseVar] = null;
                }
            });
            if (foundDataForThisModel) {
                AppState.ensembleModelsData[modelName] = modelSpecificHourlyData;
            }
        });


        return true; // Erfolg signalisieren
    } catch (error) {
        console.error("Failed to fetch ensemble weather data:", error);
        Utils.handleError(error.message);
        return false;
    } finally {
        if (loadingElement) loadingElement.style.display = 'none';
    }
}

/**
 * Verarbeitet die geladenen Ensemble-Daten und steuert die Visualisierung
 * basierend auf dem vom Benutzer ausgewählten Szenario.
 * @param {number} sliderIndex - Der Index des Zeitschiebereglers.
 * @param {number} interpStep - Der Interpolationsschritt.
 */
export function processAndVisualizeEnsemble(sliderIndex, interpStep) {
    clearEnsembleVisualizations();

    if (!AppState.ensembleModelsData || Object.keys(AppState.ensembleModelsData).length === 0) {
        return;
    }

    const scenario = Settings.state.userSettings.currentEnsembleScenario;
    console.log(`Processing ensemble scenario: ${scenario} for slider index: ${sliderIndex}`);

    switch (scenario) {
        case 'heatmap':
            generateAndDisplayHeatmap(sliderIndex, interpStep);
            break;

        case 'all_models':
            for (const modelName in AppState.ensembleModelsData) {
                const modelHourlyData = AppState.ensembleModelsData[modelName];
                // HINWEIS: Hier wird die Logik zur Parameterübergabe noch nicht umgesetzt
                const exitResult = calculateExitCircleForEnsemble(modelName, sliderIndex, { hourly: modelHourlyData });
                if (exitResult) {
                    drawEnsembleCircle(exitResult, getDistinctColorForModel(modelName), modelName);
                }
            }
            break;

        case 'min_wind':
        case 'mean_wind':
        case 'max_wind': {
            const scenarioProfile = calculateEnsembleScenarioProfile(scenario, sliderIndex);
            if (scenarioProfile) {
                const exitResult = calculateExitCircleForEnsemble(scenario, sliderIndex, scenarioProfile);
                if (exitResult) {
                    drawEnsembleCircle(exitResult, getDistinctColorForScenario(scenario), scenario.replace('_', ' '));
                }
            }
            break;
        }
    }
}

/**
 * Entfernt alle aktuell auf der Karte sichtbaren Ensemble-Visualisierungen.
 * Dies umfasst Kreise für einzelne Modelle, Szenarien und die Heatmap.
 * Stellt sicher, dass die zugehörige Layer-Gruppe für neue Visualisierungen bereit ist.
 * @returns {void}
 */
export function clearEnsembleVisualizations() {
    if (AppState.ensembleLayerGroup) {
        AppState.map.removeLayer(AppState.ensembleLayerGroup);
    }
    // Die Heatmap und der einzelne Contour-Layer werden nicht mehr benötigt
    if (AppState.heatmapLayer) {
        AppState.map.removeLayer(AppState.heatmapLayer);
        AppState.heatmapLayer = null;
    }
    // Alte Logik für heatmapContourLayer entfernen, da wir jetzt eine Gruppe haben

    AppState.ensembleScenarioCircles = {};
    // Erstelle die Layer-Gruppe neu, was automatisch alle alten Layer (Polygone, Kreise) entfernt
    AppState.ensembleLayerGroup = L.layerGroup().addTo(AppState.map);
}


// ===================================================================
// 2. Interne Berechnungsfunktionen
// ===================================================================

/**
 * Berechnet einen aggregierten "Wetter-Profil" für ein Szenario (min, mean, max).
 * Iteriert durch alle Zeitpunkte aller geladenen Modelle, um ein repräsentatives
 * Szenario-Profil zu erstellen, das wie die Daten eines einzelnen Modells aussieht.
 * @param {string} scenarioType - Das Szenario ('min_wind', 'mean_wind', 'max_wind').
 * @param {number} sliderIndex - Der Index des Zeitpunkts.
 * @returns {object|null} Ein Wetterdatenobjekt im API-Format oder null bei einem Fehler.
 * @private
 */
function calculateEnsembleScenarioProfile(scenarioType, sliderIndex) {
    if (!AppState.ensembleModelsData || Object.keys(AppState.ensembleModelsData).length === 0) {
        console.warn("No ensemble data available for profile calculation.");
        return null;
    }

    const numModels = Object.keys(AppState.ensembleModelsData).length;
    if (numModels === 0) return null;

    console.log(`Calculating full time-series ensemble profile for: ${scenarioType}`);

    const scenarioHourlyData = {}; // Das ist das neue 'hourly'-Objekt für das Szenario
    const firstModelName = Object.keys(AppState.ensembleModelsData)[0];
    const timeArrayFromFirstModel = AppState.ensembleModelsData[firstModelName]?.time; // ?. für Sicherheit

    if (!timeArrayFromFirstModel || timeArrayFromFirstModel.length === 0) {
        console.error("Time data missing or empty in the first ensemble model for profile calculation.");
        return null;
    }
    scenarioHourlyData.time = [...timeArrayFromFirstModel]; // Kopiere das vollständige Zeitarray

    const numTimeSteps = scenarioHourlyData.time.length;

    // Basisvariablen (ohne Modell-Suffix), die aggregiert werden sollen
    const baseVariablesToProcess = [
        "surface_pressure", "temperature_2m", "relative_humidity_2m",
        "geopotential_height_1000hPa", "temperature_1000hPa", "relative_humidity_1000hPa",
        "geopotential_height_950hPa", "temperature_950hPa", "relative_humidity_950hPa",
        "geopotential_height_925hPa", "temperature_925hPa", "relative_humidity_925hPa",
        "geopotential_height_900hPa", "temperature_900hPa", "relative_humidity_900hPa",
        "geopotential_height_850hPa", "temperature_850hPa", "relative_humidity_850hPa",
        "geopotential_height_800hPa", "temperature_800hPa", "relative_humidity_800hPa",
        "geopotential_height_700hPa", "temperature_700hPa", "relative_humidity_700hPa",
        "geopotential_height_600hPa", "temperature_600hPa", "relative_humidity_600hPa",
        "geopotential_height_500hPa", "temperature_500hPa", "relative_humidity_500hPa",
        "geopotential_height_400hPa", "temperature_400hPa", "relative_humidity_400hPa",
        "geopotential_height_300hPa", "temperature_300hPa", "relative_humidity_300hPa",
        "geopotential_height_250hPa", "temperature_250hPa", "relative_humidity_250hPa",
        "geopotential_height_200hPa", "temperature_200hPa", "relative_humidity_200hPa"
    ];

    // Windvariablen-Paare (Basisnamen)
    const windVariablePairs = [
        ["wind_speed_10m", "wind_direction_10m"]
    ];
    const pressureLevels = [1000, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200];
    pressureLevels.forEach(p => {
        windVariablePairs.push([`wind_speed_${p}hPa`, `wind_direction_${p}hPa`]);
    });

    // Initialisiere die Arrays in scenarioHourlyData mit der korrekten Länge
    baseVariablesToProcess.forEach(varName => {
        scenarioHourlyData[varName] = new Array(numTimeSteps).fill(null);
    });
    windVariablePairs.forEach(pair => {
        scenarioHourlyData[pair[0]] = new Array(numTimeSteps).fill(null); // für Geschwindigkeit
        scenarioHourlyData[pair[1]] = new Array(numTimeSteps).fill(null); // für Richtung
    });

    // Iteriere durch jeden Zeitschritt der gesamten Vorhersageperiode
    for (let t = 0; t < numTimeSteps; t++) {
        // Verarbeite nicht-Wind Variablen
        baseVariablesToProcess.forEach(varName => {
            const valuesAtTimeStep = [];
            for (const modelName in AppState.ensembleModelsData) {
                // Stelle sicher, dass das Modell auch Daten für diese Variable hat
                const modelHourly = AppState.ensembleModelsData[modelName];
                if (modelHourly && modelHourly[varName]) {
                    const val = modelHourly[varName][t]; // Zugriff auf den t-ten Wert
                    if (val !== null && val !== undefined && !isNaN(val)) {
                        valuesAtTimeStep.push(val);
                    }
                }
            }
            if (valuesAtTimeStep.length > 0) {
                if (scenarioType === 'min_wind') scenarioHourlyData[varName][t] = Math.min(...valuesAtTimeStep);
                else if (scenarioType === 'max_wind') scenarioHourlyData[varName][t] = Math.max(...valuesAtTimeStep);
                else scenarioHourlyData[varName][t] = valuesAtTimeStep.reduce((a, b) => a + b, 0) / valuesAtTimeStep.length; // Mean
            }
            // Wenn keine Werte vorhanden sind, bleibt der Wert null (durch Initialisierung oben)
        });

        // Verarbeite Windvariablen
        windVariablePairs.forEach(pair => {
            const speedVarName = pair[0];
            const dirVarName = pair[1];
            let u_components_t = [];
            let v_components_t = [];
            let speeds_t = [];
            let dirs_t = [];

            for (const modelName in AppState.ensembleModelsData) {
                const modelHourly = AppState.ensembleModelsData[modelName];
                if (modelHourly && modelHourly[speedVarName] && modelHourly[dirVarName]) {
                    const speed = modelHourly[speedVarName][t];
                    const dir = modelHourly[dirVarName][t];
                    if (speed !== null && speed !== undefined && !isNaN(speed) &&
                        dir !== null && dir !== undefined && !isNaN(dir)) {
                        speeds_t.push(speed);
                        dirs_t.push(dir);
                        u_components_t.push(-speed * Math.sin(dir * Math.PI / 180));
                        v_components_t.push(-speed * Math.cos(dir * Math.PI / 180));
                    }
                }
            }

            if (speeds_t.length > 0) {
                if (scenarioType === 'min_wind') {
                    const minSpeed = Math.min(...speeds_t);
                    const minIndex = speeds_t.indexOf(minSpeed);
                    scenarioHourlyData[speedVarName][t] = minSpeed;
                    scenarioHourlyData[dirVarName][t] = dirs_t[minIndex];
                } else if (scenarioType === 'max_wind') {
                    const maxSpeed = Math.max(...speeds_t);
                    const maxIndex = speeds_t.indexOf(maxSpeed);
                    scenarioHourlyData[speedVarName][t] = maxSpeed;
                    scenarioHourlyData[dirVarName][t] = dirs_t[maxIndex];
                } else { // mean_wind
                    const mean_u = u_components_t.reduce((a, b) => a + b, 0) / u_components_t.length;
                    const mean_v = v_components_t.reduce((a, b) => a + b, 0) / v_components_t.length;
                    scenarioHourlyData[speedVarName][t] = Utils.windSpeed(mean_u, mean_v);
                    scenarioHourlyData[dirVarName][t] = Utils.windDirection(mean_u, mean_v);
                }
            }
            // Wenn keine Werte vorhanden sind, bleiben die Werte null
        });
    }
    // console.log(`Vollständiges Zeitreihenprofil für ${scenarioType}:`, scenarioHourlyData);
    return { hourly: scenarioHourlyData }; // Struktur wie eine einzelne API-Modellantwort
}
/**
 * Berechnet die Canopy-Kreise für ein gegebenes Ensemble-Profil oder ein einzelnes Modell aus dem Ensemble.
 * @param {string} profileIdentifier - Name des Modells oder Szenarios (z.B. "icon_global", "min_wind").
 * @param {object} [specificProfileData=null] - Optionale, spezifische Wetterdaten für das Profil.
 * Wenn null, wird versucht, die Daten aus AppState.ensembleModelsData[profileIdentifier] zu verwenden.
 * @returns {object|null} Das Ergebnis von calculateCanopyCircles oder null bei Fehler.
 */
function calculateCanopyCirclesForEnsemble(profileIdentifier, specificProfileData = null, sliderIndex) {
    console.log(`Calculating canopy circles for ensemble profile/model: ${profileIdentifier}`);

    let weatherDataForProfile;
    if (specificProfileData) {
        weatherDataForProfile = specificProfileData;
    } else if (AppState.ensembleModelsData && AppState.ensembleModelsData[profileIdentifier]) {
        weatherDataForProfile = { hourly: AppState.ensembleModelsData[profileIdentifier] };
    } else {
        console.warn(`Keine Daten für Profil/Modell ${profileIdentifier} in calculateCanopyCirclesForEnsemble gefunden.`);
        return null;
    }

    if (!weatherDataForProfile.hourly || !AppState.lastLat || !AppState.lastLng) {
        console.warn(`Unvollständige Daten für calculateCanopyCirclesForEnsemble: ${profileIdentifier}`);
        return null;
    }

    const originalGlobalWeatherData = AppState.weatherData;
    AppState.weatherData = weatherDataForProfile.hourly;

    // Temporär die Bedingungen für die Berechnung erfüllen
    const originalShowCanopyArea = Settings.state.userSettings.showCanopyArea;
    const originalCalculateJump = Settings.state.userSettings.calculateJump;
    Settings.state.userSettings.showCanopyArea = true;
    Settings.state.userSettings.calculateJump = true;

    let result = null;
    try {
        // KORREKTUR: Auch hier die Interpolation explizit aufrufen
        const interpStep = getInterpolationStep(); // Wert in der UI-Schicht holen
        const interpolatedData = weatherManager.interpolateWeatherData(
            AppState.weatherData, // Das Haupt-Wetterdatenobjekt
            sliderIndex,
            interpStep,
            Math.round(AppState.lastAltitude),
            heightUnit
        ); // Und an die Core-Funktion übergeben

        // Und die interpolierten Daten an die Funktion übergeben
        result = JumpPlanner.calculateCanopyCircles(interpolatedData);

    } catch (error) {
        console.error(`Fehler in calculateCanopyCircles für Profil ${profileIdentifier}:`, error);
        result = null;
    } finally {
        // Wichtige Einstellungen wiederherstellen
        AppState.weatherData = originalGlobalWeatherData;
        Settings.state.userSettings.showCanopyArea = originalShowCanopyArea;
        Settings.state.userSettings.calculateJump = originalCalculateJump;
    }

    if (result) {
        return {
            centerLat: result.redLat,
            centerLng: result.redLng,
            radius: result.radiusFull,
            meanWindDir: result.meanWindForFullCanopyDir,
            meanWindSpeedMps: result.meanWindForFullCanopySpeedMps,
            profileIdentifier: profileIdentifier
        };
    }
    console.warn(`calculateCanopyCircles lieferte null für Profil ${profileIdentifier}`);
    return null;
}
/**
 * Wrapper, der `JumpPlanner.calculateExitCircle` mit den Daten eines spezifischen
 * Ensemble-Modells oder Szenario-Profils aufruft.
 * * HINWEIS FÜR ZUKÜNFTIGES REFACTORING:
 * Diese Funktion manipuliert vorübergehend den globalen `AppState.weatherData`.
 * Eine robustere Lösung wäre, die `jumpPlanner`-Funktionen so zu ändern, dass sie
 * die Wetterdaten als direkten Parameter akzeptieren.
 *
 * @param {string} profileIdentifier - Name des Modells oder Szenarios.
 * @param {number} sliderIndex - Der Index des Zeitpunkts.
 * @param {object} specificProfileData - Das Wetterdatenobjekt für dieses Profil.
 * @returns {object|null} Ein standardisiertes Ergebnisobjekt oder null bei einem Fehler.
 * @private
 */
function calculateExitCircleForEnsemble(profileIdentifier, sliderIndex, specificProfileData = null) {
    console.log(`Calculating exit circle for ensemble profile/model: ${profileIdentifier} at index ${sliderIndex}`);

    // Prüfen, ob sliderIndex gültig ist
    if (sliderIndex === undefined || sliderIndex === null) {
        console.error("sliderIndex is undefined in calculateExitCircleForEnsemble. Aborting.");
        return null;
    }

    let weatherDataForProfile;
    if (specificProfileData) {
        weatherDataForProfile = specificProfileData;
    } else if (AppState.ensembleModelsData && AppState.ensembleModelsData[profileIdentifier]) {
        weatherDataForProfile = { hourly: AppState.ensembleModelsData[profileIdentifier] };
    } else {
        console.warn(`No data for profile/model ${profileIdentifier} in calculateExitCircleForEnsemble found.`);
        return null;
    }

    if (!weatherDataForProfile.hourly || !AppState.lastLat || !AppState.lastLng || AppState.lastAltitude === 'N/A') {
        console.warn(`Incomplete data for calculateExitCircleForEnsemble: ${profileIdentifier}`);
        return null;
    }

    const interpStep = getInterpolationStep();
    const heightUnit = Settings.getValue('heightUnit', 'm'); // Höheinheit aus den Einstellungen
    const originalGlobalWeatherData = AppState.weatherData;
    AppState.weatherData = weatherDataForProfile.hourly;

    let result = null;
    let meanWindResult = { meanWindDir: 'N/A', meanWindSpeedMps: 'N/A' };

    try {
        const originalCalculateJump = Settings.state.userSettings.calculateJump;
        const originalShowExitArea = Settings.state.userSettings.showExitArea;
        Settings.state.userSettings.calculateJump = true;
        Settings.state.userSettings.showExitArea = true;

        // KORREKTUR: Den übergebenen sliderIndex verwenden, anstatt die UI abzufragen
        const interpolatedData = weatherManager.interpolateWeatherData(
            AppState.weatherData, // Das Haupt-Wetterdatenobjekt
            sliderIndex,
            interpStep,
            Math.round(AppState.lastAltitude),
            heightUnit
        );

        if (interpolatedData && interpolatedData.length > 0) {
            result = JumpPlanner.calculateExitCircle(interpolatedData);

            // Mittelwind für das Tooltip berechnen
            const heights = interpolatedData.map(d => d.height);
            const uComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'm/s', 'km/h') * Math.sin(d.dir * Math.PI / 180));
            const vComponents = interpolatedData.map(d => -Utils.convertWind(d.spd, 'm/s', 'km/h') * Math.cos(d.dir * Math.PI / 180));

            const openingAltitudeAGL = parseInt(document.getElementById('openingAltitude')?.value) || 1200;
            const legHeightDownwind = parseInt(document.getElementById('legHeightDownwind')?.value) || 0;
            const elevation = Math.round(AppState.lastAltitude);
            const upperLimit = elevation + openingAltitudeAGL - 200;
            const lowerLimit = elevation + legHeightDownwind;

            const meanWind = Utils.calculateMeanWind(heights, uComponents, vComponents, lowerLimit, upperLimit);
            if (meanWind && Number.isFinite(meanWind[0]) && Number.isFinite(meanWind[1])) {
                meanWindResult = { meanWindDir: meanWind[0], meanWindSpeedMps: meanWind[1] };
            }
        }

        Settings.state.userSettings.calculateJump = originalCalculateJump;
        Settings.state.userSettings.showExitArea = originalShowExitArea;

    } catch (error) {
        console.error(`Error in calculateExitCircle for profile ${profileIdentifier}:`, error);
        result = null;
    } finally {
        // Globalen Zustand wiederherstellen
        AppState.weatherData = originalGlobalWeatherData;
    }

    if (result) {
        return {
            centerLat: result.greenLat,
            centerLng: result.greenLng,
            radius: result.darkGreenRadius,
            meanWindDir: meanWindResult.meanWindDir,
            meanWindSpeedMps: meanWindResult.meanWindSpeedMps,
        };
    }
    console.warn(`calculateExitCircle returned null for profile ${profileIdentifier}`);
    return null;
}

// ===================================================================
// 3. Interne Visualisierungsfunktionen
// ===================================================================

/**
 * Erstellt eine mehrstufige Polygon-Visualisierung ("Heatmap"), die die Übereinstimmung
 * der verschiedenen Ensemble-Modelle darstellt.
 * @param {number} sliderIndex - Der relevante Zeit-Index.
 * @param {number} interpStep - Der Interpolationsschritt.
 * @private
 */
function generateAndDisplayHeatmap(sliderIndex, interpStep) {
    // 1. Vorherige Visualisierungen entfernen (wichtig: auch den neuen Layer)
    clearEnsembleVisualizations();

    // 2. Prüfen, ob Daten vorhanden sind
    if (!AppState.ensembleModelsData || Object.keys(AppState.ensembleModelsData).length === 0) {
        return; // Nichts zu tun, wenn keine Modelle ausgewählt sind
    }

    // 3. Alle einzelnen Modell-Kreise berechnen (unverändert)
    const modelCircles = [];
    for (const modelName in AppState.ensembleModelsData) {
        // ... (diese Schleife bleibt exakt gleich)
        if (Object.hasOwnProperty.call(AppState.ensembleModelsData, modelName)) {
            const modelHourlyData = AppState.ensembleModelsData[modelName];
            const exitResult = calculateExitCircleForEnsemble(modelName, sliderIndex, { hourly: modelHourlyData });
            if (exitResult) {
                modelCircles.push({
                    centerLat: exitResult.centerLat,
                    centerLng: exitResult.centerLng,
                    radius: exitResult.radius
                });
            }
        }
    }

    if (modelCircles.length === 0) {
        console.warn("Could not calculate any circles for the heatmap.");
        return;
    }

    // 4. Raster-Punkte für die verschiedenen Übereinstimmungslevel sammeln
    const numModels = modelCircles.length;
    const halfModels = Math.ceil(numModels / 2);

    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    modelCircles.forEach(circle => {
        const latRadius = circle.radius / 111320;
        const lngRadius = circle.radius / (111320 * Math.cos(circle.centerLat * Math.PI / 180));
        minLat = Math.min(minLat, circle.centerLat - latRadius);
        maxLat = Math.max(maxLat, circle.centerLat + latRadius);
        minLng = Math.min(minLng, circle.centerLng - lngRadius);
        maxLng = Math.max(maxLng, circle.centerLng + lngRadius);
    });

    const gridResolution = 25;
    const latStep = gridResolution / 111320;

    // Arrays für die Punkte jedes Levels
    const pointsAnyOverlap = [];
    const pointsHalfOverlap = [];
    const pointsMaxOverlap = [];

    for (let lat = minLat; lat <= maxLat; lat += latStep) {
        const lngStep = gridResolution / (111320 * Math.cos(lat * Math.PI / 180));
        for (let lng = minLng; lng <= maxLng; lng += lngStep) {
            let overlapCount = 0;
            const gridCellLatLng = L.latLng(lat, lng);
            for (const circle of modelCircles) {
                if (AppState.map.distance(gridCellLatLng, L.latLng(circle.centerLat, circle.centerLng)) <= circle.radius) {
                    overlapCount++;
                }
            }

            // Punkte zu den jeweiligen Listen hinzufügen
            if (overlapCount >= 1) {
                pointsAnyOverlap.push([lat, lng]);
            }
            if (overlapCount >= halfModels) {
                pointsHalfOverlap.push([lat, lng]);
            }
            if (overlapCount === numModels) {
                pointsMaxOverlap.push([lat, lng]);
            }
        }
    }

    // Helferfunktion für die konvexe Hülle (bleibt unverändert)
    const getConvexHull = points => {
        // ... (Implementierung von getConvexHull bleibt hier)
        points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const crossProduct = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
        const lower = [];
        for (const p of points) {
            while (lower.length >= 2 && crossProduct(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
                lower.pop();
            }
            lower.push(p);
        }
        const upper = [];
        for (let i = points.length - 1; i >= 0; i--) {
            const p = points[i];
            while (upper.length >= 2 && crossProduct(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
                upper.pop();
            }
            upper.push(p);
        }
        return lower.slice(0, -1).concat(upper.slice(0, -1));
    };

    // 5. Polygone zeichnen und zur Layer-Gruppe hinzufügen
    AppState.heatmapContourLayers = []; // Array zum Speichern der Layer

    // Funktion zum Zeichnen eines Polygons
    const drawContour = (points, style) => {
        if (points.length > 2) {
            const hull = getConvexHull(points);
            const polygon = L.polygon(hull, style).addTo(AppState.ensembleLayerGroup);
            AppState.heatmapContourLayers.push(polygon);
        }
    };

    // Zeichne die Polygone von außen nach innen, damit sie sich korrekt überlagern
    drawContour(pointsAnyOverlap, { color: 'red', weight: 2, fillOpacity: 0.1, interactive: false });
    drawContour(pointsHalfOverlap, { color: 'yellow', weight: 2, fillOpacity: 0.15, interactive: false });
    drawContour(pointsMaxOverlap, { color: 'green', weight: 3, fillOpacity: 0.2, interactive: false });
}

/**
 * Zeichnet einen einzelnen Kreis für ein Ensemble-Modell oder -Szenario auf die Karte.
 * @param {object} exitResult - Das Ergebnis von `calculateExitCircleForEnsemble`.
 * @param {string} color - Die Farbe des Kreises.
 * @param {string} label - Der Name des Modells/Szenarios für das Tooltip.
 * @private
 */
function drawEnsembleCircle(exitResult, color, label) {
    if (!AppState.map || !exitResult || !AppState.ensembleLayerGroup) return;

    const center = [exitResult.centerLat, exitResult.centerLng];

    const circle = L.circle(center, {
        radius: exitResult.radius,
        color: color,
        fillColor: color,
        fillOpacity: 0.15,
        weight: 2,
        dashArray: '5, 10',
        pmIgnore: true
    }).addTo(AppState.ensembleLayerGroup);

    const userWindUnit = Settings.getValue('windUnit', 'kt');

    // Prüfen, ob meanWindSpeedMps eine gültige Zahl ist
    let formattedMeanWindSpeed = 'N/A';
    if (exitResult.meanWindSpeedMps !== 'N/A' && Number.isFinite(exitResult.meanWindSpeedMps)) {
        const meanWindSpeedConverted = Utils.convertWind(exitResult.meanWindSpeedMps, userWindUnit, 'm/s');

        // Zusätzliche Prüfung, da convertWind 'N/A' zurückgeben kann
        if (meanWindSpeedConverted !== 'N/A' && Number.isFinite(meanWindSpeedConverted)) {
            formattedMeanWindSpeed = userWindUnit === 'bft' ?
                Math.round(meanWindSpeedConverted) :
                meanWindSpeedConverted.toFixed(1);
        }
    }

    const openingAltitudeAGL = parseInt(document.getElementById('openingAltitude')?.value) || Settings.state.userSettings.openingAltitude || 1200;
    const lowerLimitDisplay = parseInt(document.getElementById('legHeightDownwind')?.value) || Settings.state.userSettings.legHeightDownwind || 0;
    const upperLimitDisplay = openingAltitudeAGL - 200;

    const heightUnit = Settings.getValue('heightUnit', 'm');
    const lowerLimitFormatted = Math.round(Utils.convertHeight(lowerLimitDisplay, heightUnit));
    const upperLimitFormatted = Math.round(Utils.convertHeight(upperLimitDisplay, heightUnit));

    const meanWindDirFormatted = (exitResult.meanWindDir !== 'N/A' && Number.isFinite(exitResult.meanWindDir))
        ? Utils.roundToTens(exitResult.meanWindDir)
        : 'N/A';

    const tooltipText = `<strong>${label}</strong><br>` +
        `Mean Wind ${lowerLimitFormatted}-${upperLimitFormatted} ${heightUnit} AGL:<br>` +
        `${meanWindDirFormatted}° ${formattedMeanWindSpeed} ${userWindUnit}`;

    circle.bindTooltip(tooltipText, {
        permanent: false,
        direction: 'top',
        className: 'wind-tooltip',
        opacity: 0.9
    });

    AppState.ensembleScenarioCircles[label] = circle;
    console.log(`Drew ensemble circle for ${label} at [${center.join(', ')}], radius ${exitResult.radius}`);
}

// ===================================================================
// 4. Interne Hilfsfunktionen
// ===================================================================

/**
 * Erzeugt eine deterministische, aber optisch unterscheidbare Farbe aus einem String.
 * @param {string} modelName - Der Name des Modells.
 * @returns {string} Eine HSL-Farbzeichenfolge.
 * @private
 */
function getDistinctColorForModel(modelName) {
    let hash = 0;
    for (let i = 0; i < modelName.length; i++) {
        hash = modelName.charCodeAt(i) + ((hash << 5) - hash);
        hash = hash & hash; // Convert to 32bit integer
    }
    const hue = hash % 360;
    return `hsl(${hue}, 70%, 60%)`; // HSL für bessere Farbverteilung
}

/**
 * Gibt eine vordefinierte Farbe für ein bestimmtes Szenario zurück.
 * @param {string} scenario - Der Name des Szenarios.
 * @returns {string} Eine RGBA-Farbzeichenfolge.
 * @private
 */
function getDistinctColorForScenario(scenario) {
    if (scenario === 'min_wind') return ENSEMBLE_VISUALIZATION.SCENARIO_COLORS.MIN_WIND;    // Blau
    if (scenario === 'mean_wind') return ENSEMBLE_VISUALIZATION.SCENARIO_COLORS.MEAN_WIND;   // Grün
    if (scenario === 'max_wind') return ENSEMBLE_VISUALIZATION.SCENARIO_COLORS.MAX_WIND;    // Rot
    return 'rgba(128, 128, 128, 0.7)'; // Grau für Fallback
}



