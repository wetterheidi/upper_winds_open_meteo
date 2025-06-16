// ensembleManager.js
import { AppState } from './state.js';
import { Settings } from './settings.js';
import { Utils } from './utils.js';
import * as JumpPlanner from './jumpPlanner.js';
import { getSliderValue } from './ui.js';
import { interpolateWeatherData } from './weatherManager.js';
import { DateTime } from 'luxon';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css'; // Nicht vergessen!
import 'leaflet.heat';
import { ENSEMBLE_VISUALIZATION, API_URLS } from './constants.js';
window.L = L; // <-- DIESE ZEILE MUSS BLEIBEN

/**
 * Ruft die Wetterdaten für alle vom Benutzer ausgewählten Ensemble-Modelle ab.
 * Bündelt die Modellnamen in einer einzigen API-Anfrage an Open-Meteo
 * und verarbeitet die Antwort, um die Daten den jeweiligen Modellen zuzuordnen.
 * @returns {Promise<void>}
 */
export async function fetchEnsembleWeatherData() {
    if (!AppState.lastLat || !AppState.lastLng) {
        Utils.handleMessage("Please select a location first.");
        return;
    }
    if (!Settings.state.userSettings.selectedEnsembleModels || Settings.state.userSettings.selectedEnsembleModels.length === 0) {
        AppState.ensembleModelsData = null;
        clearEnsembleVisualizations();
        console.log("No ensemble models selected. Cleared ensemble data and visualizations.");
        return;
    }

    const lat = AppState.lastLat;
    const lon = AppState.lastLng;
    const modelsToFetch = Settings.state.userSettings.selectedEnsembleModels;

    console.log(`Fetching ensemble weather data for models: ${modelsToFetch.join(', ')} at ${lat}, ${lon}`);
    const loadingElement = document.getElementById('loading');
    if (loadingElement) loadingElement.style.display = 'block';


    const modelString = modelsToFetch.join(',');

    // Basisvariablen, die wir von der API erwarten (ohne Modell-Suffix)
    const baseVariablesList = [
        "surface_pressure", "temperature_2m", "relative_humidity_2m", "wind_speed_10m", "wind_direction_10m",
        "geopotential_height_1000hPa", "temperature_1000hPa", "relative_humidity_1000hPa", "wind_speed_1000hPa", "wind_direction_1000hPa",
        "geopotential_height_950hPa", "temperature_950hPa", "relative_humidity_950hPa", "wind_speed_950hPa", "wind_direction_950hPa",
        "geopotential_height_925hPa", "temperature_925hPa", "relative_humidity_925hPa", "wind_speed_925hPa", "wind_direction_925hPa",
        "geopotential_height_900hPa", "temperature_900hPa", "relative_humidity_900hPa", "wind_speed_900hPa", "wind_direction_900hPa",
        "geopotential_height_850hPa", "temperature_850hPa", "relative_humidity_850hPa", "wind_speed_850hPa", "wind_direction_850hPa",
        "geopotential_height_800hPa", "temperature_800hPa", "relative_humidity_800hPa", "wind_speed_800hPa", "wind_direction_800hPa",
        "geopotential_height_700hPa", "temperature_700hPa", "relative_humidity_700hPa", "wind_speed_700hPa", "wind_direction_700hPa",
        "geopotential_height_600hPa", "temperature_600hPa", "relative_humidity_600hPa", "wind_speed_600hPa", "wind_direction_600hPa",
        "geopotential_height_500hPa", "temperature_500hPa", "relative_humidity_500hPa", "wind_speed_500hPa", "wind_direction_500hPa",
        "geopotential_height_400hPa", "temperature_400hPa", "relative_humidity_400hPa", "wind_speed_400hPa", "wind_direction_400hPa",
        "geopotential_height_300hPa", "temperature_300hPa", "relative_humidity_300hPa", "wind_speed_300hPa", "wind_direction_300hPa",
        "geopotential_height_250hPa", "temperature_250hPa", "relative_humidity_250hPa", "wind_speed_250hPa", "wind_direction_250hPa",
        "geopotential_height_200hPa", "temperature_200hPa", "relative_humidity_200hPa", "wind_speed_200hPa", "wind_direction_200hPa"
    ];
    const hourlyVariablesString = baseVariablesList.join(',');

    const historicalDatePicker = document.getElementById('historicalDatePicker');
    const selectedDateValue = historicalDatePicker ? historicalDatePicker.value : null;
    const selectedDate = selectedDateValue ? DateTime.fromISO(selectedDateValue, { zone: 'utc' }) : null;
    const today = DateTime.utc().startOf('day');
    const isHistorical = selectedDate && selectedDate < today;

    let startDateStr, endDateStr;
    let baseUrl = API_URLS.FORECAST; // Standard-URL für Vorhersage

    if (isHistorical) {
        baseUrl = API_URLS.HISTORICAL; // URL für historische Daten
        startDateStr = selectedDate.toFormat('yyyy-MM-dd');
        endDateStr = startDateStr;
    } else {
        const now = DateTime.utc();
        startDateStr = now.toFormat('yyyy-MM-dd');
        endDateStr = now.plus({ days: 7 }).toFormat('yyyy-MM-dd'); // Standard-Vorhersagezeitraum
    }

    const url = `${baseUrl}?latitude=${lat}&longitude=${lon}&hourly=${hourlyVariablesString}&models=${modelString}&start_date=${startDateStr}&end_date=${endDateStr}`;
    console.log("Constructed ensemble URL:", url);

    try {
        const response = await fetch(url);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API request failed: ${response.status} - ${errorText}`);
        }
        const apiResponseData = await response.json(); // Nennen wir es apiResponseData, um Verwechslung zu vermeiden
        console.log("Raw data from OpenMeteo for ensemble request:", JSON.stringify(apiResponseData, null, 2));
        console.log("Models requested:", modelsToFetch);

        AppState.ensembleModelsData = {}; // Wichtig: Hier initialisieren

        if (apiResponseData.error && apiResponseData.reason) {
            throw new Error(`API Error: ${apiResponseData.reason}`);
        }

        if (!apiResponseData.hourly) {
            let errorMsg = 'Unexpected data format: "hourly" field missing in API response.';
            if (apiResponseData && typeof apiResponseData.latitude !== 'undefined') {
                errorMsg = "Received metadata but no 'hourly' data for any requested ensemble model.";
            }
            console.error(errorMsg, apiResponseData);
            throw new Error(errorMsg);
        }

        // Die 'time'-Achse ist für alle Modelle gleich und nicht suffigiert
        const sharedTimeArray = apiResponseData.hourly.time;
        if (!sharedTimeArray) {
            throw new Error("Shared 'time' array missing in hourly data.");
        }

        modelsToFetch.forEach(modelName => {
            const modelSpecificHourlyData = { time: [...sharedTimeArray] }; // Kopiere das Zeitarray
            let foundDataForThisModel = false;

            // Iteriere durch die Basisvariablen und suche die suffigierten Pendants
            baseVariablesList.forEach(baseVar => {
                const suffixedVarKey = `${baseVar}_${modelName}`; // z.B. temperature_2m_icon_global

                if (apiResponseData.hourly[suffixedVarKey]) {
                    modelSpecificHourlyData[baseVar] = apiResponseData.hourly[suffixedVarKey];
                    foundDataForThisModel = true;
                } else if (modelsToFetch.length === 1 && apiResponseData.hourly[baseVar]) {
                    // Fallback für Einzelmodellanfragen, wo Suffixe fehlen könnten
                    modelSpecificHourlyData[baseVar] = apiResponseData.hourly[baseVar];
                    foundDataForThisModel = true;
                } else {
                    modelSpecificHourlyData[baseVar] = null; // Oder new Array(sharedTimeArray.length).fill(null);
                }
            });

            if (foundDataForThisModel) {
                AppState.ensembleModelsData[modelName] = modelSpecificHourlyData;
                console.log(`Successfully processed and stored data for model: ${modelName}`);
            } else {
                console.warn(`No data found for model ${modelName} with suffixed keys in the 'hourly' object. Available keys for this model might be missing or the model is unavailable for this specific request. Hourly keys in response:`, Object.keys(apiResponseData.hourly));
                // Utils.handleMessage(`Warning: No data retrieved for model ${modelName}.`); // Optional: Nutzer informieren
            }
        });


        if (Object.keys(AppState.ensembleModelsData).length === 0 && modelsToFetch.length > 0) {
            const msg = "Could not retrieve and process data for any of the selected ensemble models. They might be unavailable or the API response structure was not as expected for these models.";
            console.warn(msg, "Original API response:", apiResponseData);
            Utils.handleMessage(msg);
        } else {
            console.log("Ensemble weather data processed and stored in AppState.ensembleModelsData:", AppState.ensembleModelsData);
        }

        processAndVisualizeEnsemble();

    } catch (error) {
        console.error('Error in fetchEnsembleWeatherData:', error);
        Utils.handleError(`Failed to fetch ensemble weather data: ${error.message}`);
        AppState.ensembleModelsData = null;
        clearEnsembleVisualizations();
    } finally {
        if (loadingElement) {
            loadingElement.style.display = 'none';
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
    // 1. Zuerst prüfen, ob die Layer-Gruppe überhaupt existiert.
    if (AppState.ensembleLayerGroup) {
        // 2. Anstatt auf hasLayer() zu vertrauen, versuchen wir einfach, sie zu entfernen.
        //    Leaflet ist robust genug, um damit umzugehen, wenn der Layer nicht mehr da ist.
        AppState.map.removeLayer(AppState.ensembleLayerGroup);
    }

    // 3. Dasselbe für den Heatmap-Layer.
    if (AppState.heatmapLayer) {
        AppState.map.removeLayer(AppState.heatmapLayer);
    }

    // 4. Referenzen sicher zurücksetzen.
    AppState.heatmapLayer = null;
    AppState.ensembleScenarioCircles = {};

    // 5. Eine brandneue, garantiert saubere Layer-Gruppe erstellen und zur Karte hinzufügen.
    AppState.ensembleLayerGroup = L.layerGroup().addTo(AppState.map);

    console.log("Ensemble visualizations cleared and a new, clean layer group was created.");
}

/**
 * Verarbeitet die geladenen Ensemble-Daten und steuert die Visualisierung
 * basierend auf dem vom Benutzer ausgewählten Szenario (z.B. 'all_models', 'heatmap', 'mean_wind').
 * Ruft die entsprechenden Funktionen zur Berechnung und zum Zeichnen der Visualisierungen auf.
 * @returns {void}
 */
export function processAndVisualizeEnsemble() {
    clearEnsembleVisualizations();

    if (!AppState.ensembleModelsData || Object.keys(AppState.ensembleModelsData).length === 0) {
        console.log("No ensemble data to process.");
        if (Settings.state.userSettings.selectedEnsembleModels.length > 0 && Settings.state.userSettings.currentEnsembleScenario !== 'all_models') {
            Utils.handleMessage("Data for selected ensemble models not yet available. Fetching...");
            fetchEnsembleWeatherData();
        }
        return;
    }

    const scenario = Settings.state.userSettings.currentEnsembleScenario;
    const sliderIndex = getSliderValue();

    console.log(`Processing ensemble scenario: ${scenario} for slider index: ${sliderIndex}`);

    if (scenario === 'heatmap') {
        generateAndDisplayHeatmap();
    } else if (scenario === 'all_models') {
        for (const modelName in AppState.ensembleModelsData) {
            if (Object.hasOwnProperty.call(AppState.ensembleModelsData, modelName)) {
                const modelHourlyData = AppState.ensembleModelsData[modelName];
                const tempWeatherData = { hourly: modelHourlyData };
                const exitResult = calculateExitCircleForEnsemble(modelName, tempWeatherData); // KORREKTUR HIER
                if (exitResult) {
                    const color = getDistinctColorForModel(modelName);
                    drawEnsembleCircle(exitResult, color, modelName); // KORREKTUR HIER
                }
            }
        }
    } else { // Min, Mean, Max scenarios
        const scenarioProfile = calculateEnsembleScenarioProfile(scenario); // sliderIndex wird intern geholt
        if (scenarioProfile) {
            const exitResult = calculateExitCircleForEnsemble(scenario, scenarioProfile); // KORREKTUR HIER
            if (exitResult) {
                const color = getDistinctColorForScenario(scenario);
                drawEnsembleCircle(exitResult, color, scenario.replace('_', ' ')); // KORREKTUR HIER
            }
        } else {
            console.warn(`Could not calculate profile for scenario: ${scenario}`);
            Utils.handleMessage(`Could not generate '${scenario.replace('_', ' ')}' profile. Not enough data?`);
        }
    }
}
function getDistinctColorForModel(modelName) {
    let hash = 0;
    for (let i = 0; i < modelName.length; i++) {
        hash = modelName.charCodeAt(i) + ((hash << 5) - hash);
        hash = hash & hash; // Convert to 32bit integer
    }
    const hue = hash % 360;
    return `hsl(${hue}, 70%, 60%)`; // HSL für bessere Farbverteilung
}
function getDistinctColorForScenario(scenario) {
    if (scenario === 'min_wind') return ENSEMBLE_VISUALIZATION.SCENARIO_COLORS.MIN_WIND;    // Blau
    if (scenario === 'mean_wind') return ENSEMBLE_VISUALIZATION.SCENARIO_COLORS.MEAN_WIND;   // Grün
    if (scenario === 'max_wind') return ENSEMBLE_VISUALIZATION.SCENARIO_COLORS.MAX_WIND;    // Rot
    return 'rgba(128, 128, 128, 0.7)'; // Grau für Fallback
}
function drawEnsembleCircle(exitResult, color, label) {
    if (!AppState.map || !exitResult || !AppState.ensembleLayerGroup) return;

    const center = [exitResult.centerLat, exitResult.centerLng];

    const circle = L.circle(center, {
        radius: exitResult.radius,
        color: color,
        fillColor: color,
        fillOpacity: 0.15,
        weight: 2,
        dashArray: '5, 10'
    }).addTo(AppState.ensembleLayerGroup);

    const userWindUnit = Settings.getValue('windUnit', 'radio', 'kt');

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

    const heightUnit = Settings.getValue('heightUnit', 'radio', 'm');
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

/**
 * Berechnet ein aggregiertes Wetterprofil für ein gegebenes Szenario (min, mean, max).
 * Iteriert durch alle Zeitpunkte und aggregiert die Werte aller geladenen Modelle,
 * um ein einziges, repräsentatives "Szenario-Wetterprofil" zu erstellen.
 * @param {string} scenarioType - Der Typ des zu berechnenden Szenarios ('min_wind', 'mean_wind', 'max_wind').
 * @returns {object|null} Ein Wetterdatenobjekt, das dem API-Format entspricht, oder null bei einem Fehler.
 * @private
 */
function calculateEnsembleScenarioProfile(scenarioType /* sliderIndex hier nicht mehr als direkter Parameter nötig, wird in der Schleife verwendet */) {
    if (!AppState.ensembleModelsData || Object.keys(AppState.ensembleModelsData).length === 0) {
        console.warn("No ensemble data available for profile calculation.");
        return null;
    }

    const numModels = Object.keys(AppState.ensembleModelsData).length;
    if (numModels === 0) return null;

    console.log(`Calculating full time-series ensemble profile for: ${scenarioType}`);

    const scenarioHourlyData = {}; // Das wird das neue 'hourly'-Objekt für das Szenario

    // Annahme: Alle Modelle haben die gleiche Zeitachsenstruktur. Nehmen Sie sie vom ersten Modell.
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
function calculateCanopyCirclesForEnsemble(profileIdentifier, specificProfileData = null) {
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
        const sliderIndex = getSliderValue();
        const interpolatedData = interpolateWeatherData(sliderIndex);

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
 * Berechnet die Exit-Kreise für ein gegebenes Ensemble-Profil oder ein einzelnes Modell.
 * @param {string} profileIdentifier - Name des Modells oder Szenarios (z.B. "icon_global", "min_wind").
 * @param {object} [specificProfileData=null] - Optionale, spezifische Wetterdaten für das Profil.
 * @returns {object|null} Das Ergebnis von calculateExitCircle oder null bei Fehler.
 */
function calculateExitCircleForEnsemble(profileIdentifier, specificProfileData = null) {
    console.log(`Calculating exit circle for ensemble profile/model: ${profileIdentifier}`);

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

    const originalGlobalWeatherData = AppState.weatherData;
    AppState.weatherData = weatherDataForProfile.hourly;

    let result = null;
    let meanWindResult = { meanWindDir: 'N/A', meanWindSpeedMps: 'N/A' };

    try {
        const originalCalculateJump = Settings.state.userSettings.calculateJump;
        const originalShowExitArea = Settings.state.userSettings.showExitArea;
        Settings.state.userSettings.calculateJump = true;
        Settings.state.userSettings.showExitArea = true;

        // KORREKTUR: Hier die Interpolation explizit aufrufen
        const sliderIndex = getSliderValue();
        const interpolatedData = interpolateWeatherData(sliderIndex);

        // Und die interpolierten Daten an die Funktion übergeben
        result = JumpPlanner.calculateExitCircle(interpolatedData);

        // ... (Rest der Funktion bleibt gleich)
        if (interpolatedData && interpolatedData.length > 0) {
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
                meanWindResult = {
                    meanWindDir: meanWind[0],
                    meanWindSpeedMps: meanWind[1]
                };
            }
        }

        Settings.state.userSettings.calculateJump = originalCalculateJump;
        Settings.state.userSettings.showExitArea = originalShowExitArea;

    } catch (error) {
        console.error(`Error in calculateExitCircle for profile ${profileIdentifier}:`, error);
        result = null;
    } finally {
        AppState.weatherData = originalGlobalWeatherData;
    }

    if (result) {
        return {
            centerLat: result.darkGreenLat,
            centerLng: result.darkGreenLng,
            radius: result.darkGreenRadius,
            freeFallDirection: result.freeFallDirection,
            freeFallDistance: result.freeFallDistance,
            freeFallTime: result.freeFallTime,
            meanWindDir: meanWindResult.meanWindDir,
            meanWindSpeedMps: meanWindResult.meanWindSpeedMps,
            profileIdentifier: profileIdentifier
        };
    }
    console.warn(`calculateExitCircle returned null for profile ${profileIdentifier}`);
    return null;
}

/**
 * Erstellt und zeigt eine Heatmap der wahrscheinlichsten Landezonen an.
 * Berechnet für jedes Ensemble-Modell den Exit-Bereich, legt ein Raster über alle Bereiche
 * und berechnet für jede Rasterzelle die Anzahl der Überlappungen.
 * Das Ergebnis wird als Heatmap-Layer auf der Karte visualisiert.
 * @returns {void}
 * @private
 */
function generateAndDisplayHeatmap() {

    // 1. Clear previous visualizations
    clearEnsembleVisualizations();
    if (AppState.heatmapLayer) {
        AppState.map.removeLayer(AppState.heatmapLayer);
        AppState.heatmapLayer = null;
    }

    // 2. Check if there is data
    if (!AppState.ensembleModelsData || Object.keys(AppState.ensembleModelsData).length < 2) {
        Utils.handleMessage("Please select at least two ensemble models to generate a heatmap.");
        return;
    }

    // 3. Calculate all individual model circles
    const modelCircles = [];
    for (const modelName in AppState.ensembleModelsData) {
        if (Object.hasOwnProperty.call(AppState.ensembleModelsData, modelName)) {
            const modelHourlyData = AppState.ensembleModelsData[modelName];
            const exitResult = calculateExitCircleForEnsemble(modelName, { hourly: modelHourlyData });

            if (exitResult) {
                // KORREKTUR: Das Zentrum ist bereits korrekt in exitResult.centerLat/centerLng.
                // Die zusätzliche Berechnung mit calculateNewCenter wird entfernt.
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
    console.log(`[Heatmap] Calculated ${modelCircles.length} model circles.`);

    // 4. Bounding-Box und Raster-Berechnung (bleibt unverändert)
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    const metersPerDegree = 111320;
    modelCircles.forEach(circle => {
        const latRadius = circle.radius / metersPerDegree;
        const lngRadius = circle.radius / (metersPerDegree * Math.cos(circle.centerLat * Math.PI / 180));
        minLat = Math.min(minLat, circle.centerLat - latRadius);
        maxLat = Math.max(maxLat, circle.centerLat + latRadius);
        minLng = Math.min(minLng, circle.centerLng - lngRadius);
        maxLng = Math.max(maxLng, circle.centerLng + lngRadius);
    });

    const gridResolution = 40;
    const latStep = gridResolution / metersPerDegree;
    const heatmapPoints = [];

    console.log("[Heatmap] Starting grid calculation...");
    for (let lat = minLat; lat <= maxLat; lat += latStep) {
        const lngStep = gridResolution / (metersPerDegree * Math.cos(lat * Math.PI / 180));
        for (let lng = minLng; lng <= maxLng; lng += lngStep) {
            let overlapCount = 0;
            const gridCellLatLng = L.latLng(lat, lng);
            modelCircles.forEach(circle => {
                const circleCenterLatLng = L.latLng(circle.centerLat, circle.centerLng);
                const distance = AppState.map.distance(gridCellLatLng, circleCenterLatLng);
                if (distance <= circle.radius) {
                    overlapCount++;
                }
            });
            if (overlapCount > 0) {
                heatmapPoints.push([lat, lng, overlapCount]);
            }
        }
    }
    console.log(`[Heatmap] Finished grid calculation. Generated ${heatmapPoints.length} heatmap points.`);

    // 5. Heatmap-Layer erstellen und anzeigen (bleibt unverändert)
    if (heatmapPoints.length > 0) {
        const maxOverlap = modelCircles.length;
        const gradient = {};

        if (maxOverlap === 1) {
            gradient[1.0] = 'lime';
        } else {
            for (let i = 1; i <= maxOverlap; i++) {
                const ratio = i / maxOverlap;
                if (i === 1) {
                    gradient[ratio] = 'red';
                } else if (i < maxOverlap) {
                    gradient[ratio] = 'yellow';
                } else {
                    gradient[ratio] = 'lime';
                }
            }
        }

        console.log("[Heatmap] Using gradient:", gradient);

        if (AppState.heatmapLayer) {
            AppState.map.removeLayer(AppState.heatmapLayer);
        }

        const dynamicRadius = Utils.calculateDynamicRadius(ENSEMBLE_VISUALIZATION.HEATMAP_BASE_RADIUS, ENSEMBLE_VISUALIZATION.HEATMAP_REFERENCE_ZOOM);

        AppState.heatmapLayer = L.heatLayer(heatmapPoints, {
            radius: dynamicRadius,
            blur: 10,
            max: maxOverlap,
            minOpacity: 0.01,
            gradient: gradient
        }).addTo(AppState.map);
    } else {
        Utils.handleMessage("No overlapping landing areas found for the selected models.");
    }
}
