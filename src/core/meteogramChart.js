/**
 * @file meteogramChart.js
 * @description Erstellt getrennte Meteogramm-Diagramme für Boden- und Höhenwetterdaten.
 */

import { AppState } from './state.js';
import { Settings } from './settings.js';
import { Utils } from './utils.js';
import * as weatherManager from './weatherManager.js';
import { DateTime } from 'luxon';

// Chart.js wird global geladen.

let meteogramUpperInstance = null; // Instanz für Höhenwetter
let meteogramSurfaceInstance = null; // Instanz für Bodenwetter

// Hilfsfunktion: Gibt die passende Farbe für den Bedeckungsgrad zurück
function getCloudColor(cloudCoverPercent, style) {
    if (cloudCoverPercent <= 5) return style.getPropertyValue('--cc-clear').trim();
    if (cloudCoverPercent <= 25) return style.getPropertyValue('--cc-few').trim();
    if (cloudCoverPercent <= 50) return style.getPropertyValue('--cc-sct').trim();
    if (cloudCoverPercent <= 87) return style.getPropertyValue('--cc-bkn').trim();
    return style.getPropertyValue('--cc-ovc').trim();
}

/**
 * Generiert und zeigt die Skydiver-Meteogramme (Boden & Höhe) an.
 */
export async function generateMeteogram(sliderIndex) {
    console.log(`[Meteogram] Starting generateMeteogram for slider index: ${sliderIndex}...`);

    // === KORREKTUR 1: Lese die Temperatureinheit FRÜHER aus ===
    const tempUnit = Settings.getValue('temperatureUnit', 'C');
    console.log(`[Meteogram] Current tempUnit setting: ${tempUnit}`);


    const upperCanvas = document.getElementById('meteogramUpperChart');
    const surfaceCanvas = document.getElementById('meteogramSurfaceChart');
    const upperTitleElement = upperCanvas?.previousElementSibling;
    const surfaceTitleElement = surfaceCanvas?.previousElementSibling;

    destroyCharts(); // Vorhandene Charts zuerst zerstören

    if (!upperCanvas || !surfaceCanvas || !upperTitleElement || !surfaceTitleElement) {
        console.warn("[Meteogram] Canvas oder Titel Elemente nicht gefunden.");
        return;
    }
    if (!AppState.weatherData || !AppState.weatherData.time || AppState.weatherData.time.length === 0 || sliderIndex < 0 || sliderIndex >= AppState.weatherData.time.length) {
        console.warn("[Meteogram] Keine Wetterdaten verfügbar.");
        upperTitleElement.textContent = "Upper Air (Wind & Clouds)";
        surfaceTitleElement.textContent = "Surface Conditions";
        displayChartPlaceholder(upperCanvas, "No weather data loaded.");
        displayChartPlaceholder(surfaceCanvas, "No weather data loaded.");
        return;
    }

    console.log('[Meteogram] Canvas and weather data found. Proceeding...');

    const upperCtx = upperCanvas.getContext('2d');
    const surfaceCtx = surfaceCanvas.getContext('2d');
    const weatherData = AppState.weatherData;

    // --- Gemeinsame Daten und Einstellungen ---
    const heightUnit = Settings.getValue('heightUnit', 'm'); // 'm' oder 'ft'
    const windUnit = Settings.getValue('windUnit', 'kt');
    const timeZone = Settings.getValue('timeZone', 'Z');
    const baseHeight = Math.round(AppState.lastAltitude) || 0;
    const style = getComputedStyle(document.body);
    const gridColor = style.getPropertyValue('--border-color').trim();
    const textColor = style.getPropertyValue('--text-primary').trim();
    const barbColor = textColor;
    const freezingLevelColor = style.getPropertyValue('--color-success').trim();


    // === KORREKTUR 2: Definiere Höhenlimits und Schritte basierend auf der Einheit ===
    const upperChartMaxHeightAGL_Meters = 4500;
    const upperChartMaxHeightAGL_Feet = 15000; // Z.B. 15000 ft als Obergrenze
    const yAxisStepSizeMeters = 500;
    const yAxisStepSizeFt = 1000; // Oder 1500, je nach Präferenz
    const cloudHeightStep_Meters = 100;
    const cloudHeightStep_Feet = 300; // Z.B. 300 ft Schritte für Wolken

    // Wähle die korrekten Werte basierend auf der Einheit
    const upperChartMaxHeightDisplay = heightUnit === 'ft' ? upperChartMaxHeightAGL_Feet : upperChartMaxHeightAGL_Meters;
    const yAxisStepSize = heightUnit === 'ft' ? yAxisStepSizeFt : yAxisStepSizeMeters;
    const cloudHeightStep = heightUnit === 'ft' ? cloudHeightStep_Feet : cloudHeightStep_Meters;

    // Definiere Windfiedern-Höhen für beide Einheiten
    const windBarbAltitudesAGL_Meters = [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500];
    const windBarbAltitudesAGL_Feet = [1500, 3000, 5000, 7000, 9000, 11000, 13000, 15000]; // Runde Schritte in Fuß
    const windBarbAltitudesAGL_CurrentUnit = heightUnit === 'ft' ? windBarbAltitudesAGL_Feet : windBarbAltitudesAGL_Meters;
    // ================== ENDE KORREKTUR 2 ==================

    // Farben
    const tempColor = style.getPropertyValue('--wind-exceeding').trim();
    const dewPointColor = style.getPropertyValue('--cc-few').trim();
    const surfaceWindColor = 'rgb(200, 200, 200)';
    const surfaceGustColor = 'rgb(200, 0, 0)';


    // === START MODIFICATION: Determine target date and filter indices ===
    let locationTimezone = 'utc';
    if (timeZone.toLowerCase() === 'loc' && AppState.lastLat != null && AppState.lastLng != null) {
        const locData = await Utils.getLocationData(AppState.lastLat, AppState.lastLng);
        locationTimezone = locData.timezone || 'utc';
    }

    const sliderTime = DateTime.fromISO(weatherData.time[sliderIndex], { zone: 'utc' }).setZone(locationTimezone);
    const targetDate = sliderTime.startOf('day'); // Der Tag, der angezeigt werden soll
    const displayDateStr = targetDate.toFormat('yyyy-MM-dd'); // Datum für den Titel

    // Finde alle Indizes, die zum targetDate gehören
    const timeIndicesForDay = [];
    const timeLabels = []; // Labels nur für diesen Tag
    for (let i = 0; i < weatherData.time.length; i++) {
        const dt = DateTime.fromISO(weatherData.time[i], { zone: 'utc' }).setZone(locationTimezone);
        if (dt.hasSame(targetDate, 'day')) {
            timeIndicesForDay.push(i);
            // Erstelle das Zeitlabel für die X-Achse
            timeLabels.push(dt.toFormat(timeZone.toLowerCase() === 'loc' ? 'HH' : 'HH\'Z\''));
        }
    }

    if (timeIndicesForDay.length === 0) {
        console.warn(`[Meteogram] No data found for the selected date: ${displayDateStr}`);
        // Zeige Platzhalter an, wenn für den ausgewählten Tag keine Daten vorhanden sind (sollte selten passieren)
        upperTitleElement.textContent = `Upper Air - ${displayDateStr}`;
        surfaceTitleElement.textContent = `Surface - ${displayDateStr}`;
        displayChartPlaceholder(upperCanvas, "No data for selected day.");
        displayChartPlaceholder(surfaceCanvas, "No data for selected day.");
        return;
    }
    console.log(`[Meteogram] Processing data for date: ${displayDateStr}. Indices: ${timeIndicesForDay[0]} to ${timeIndicesForDay[timeIndicesForDay.length - 1]}. Found ${timeIndicesForDay.length} data points.`);
    // === END MODIFICATION ===

    // --- Datenarrays vorbereiten ---
    const windBarbDataPoints = []; // Temporäres Array für Rohdaten der Fiedern
    const cloudBarData = [];
    const freezingLevelData = [];
    const surfaceTempData = [];
    const surfaceDewPointData = [];
    const surfaceWindSpeedData = [];
    const surfaceWindGustData = [];

    // --- Datenverarbeitungsschleife (jetzt über die gefilterten Indizes) ---
    console.log('[Meteogram] Starting data processing loop for selected day...');
    let pointsProcessedThisDay = 0;

    // === START MODIFICATION: Iterate over filtered indices ===
    for (const i of timeIndicesForDay) {
        // Der Rest der Schleife bleibt logisch gleich,
        // verwendet aber nur den Index 'i' aus timeIndicesForDay
        // und das timeLabel aus dem neu erstellten timeLabels-Array
        const currentLabel = timeLabels[pointsProcessedThisDay]; // Korrektes Label für die X-Achse
        pointsProcessedThisDay++;

        // -- Bodendaten sammeln --
        const tempC = weatherData.temperature_2m[i];
        const rh = weatherData.relative_humidity_2m[i];

        // === KORREKTUR 3: Werte werden JETZT umgerechnet, bevor sie gepusht werden ===
        let convertedTemp = null;
        if (tempC !== null && !isNaN(tempC)) {
            // Benutze die globale 'tempUnit'-Variable
            convertedTemp = tempUnit === 'F' ? Utils.convertTemperature(tempC, '°F') : tempC;
            if (typeof convertedTemp !== 'number' || isNaN(convertedTemp)) { convertedTemp = null; }
        }
        surfaceTempData.push(convertedTemp);

        let convertedDewPoint = null;
        const dewPointC = Utils.calculateDewpoint(tempC, rh);
        if (dewPointC !== null && !isNaN(dewPointC)) {
            // Benutze die globale 'tempUnit'-Variable
            convertedDewPoint = tempUnit === 'F' ? Utils.convertTemperature(dewPointC, '°F') : dewPointC;
            if (typeof convertedDewPoint !== 'number' || isNaN(convertedDewPoint)) { convertedDewPoint = null; }
        }
        surfaceDewPointData.push(convertedDewPoint);

        // Logging (optional, kann reduziert werden)
        if (pointsProcessedThisDay <= 5) {
            const displayUnitLabel = tempUnit === 'F' ? '°F' : '°C';
            console.log(`[Meteogram DayLoop i=${i}] TempC: ${tempC}, PushedTemp(${displayUnitLabel}): ${convertedTemp}`);
        }

        const surfGust_kmh = weatherData.wind_gusts_10m[i];
        const surfSpeed_kmh = weatherData.wind_speed_10m[i];
        surfaceWindSpeedData.push(surfSpeed_kmh !== null ? parseFloat(Utils.convertWind(surfSpeed_kmh, windUnit, 'km/h').toFixed(1)) : null);
        surfaceWindGustData.push(surfGust_kmh !== null ? parseFloat(Utils.convertWind(surfGust_kmh, windUnit, 'km/h').toFixed(1)) : null);

        // Höhendaten interpolieren (wie zuvor, aber nur für den aktuellen Index i)
        const interpolatedHourData = weatherManager.interpolateWeatherData(weatherData, i, 100, baseHeight, 'm');
        if (!interpolatedHourData || interpolatedHourData.length === 0) {
            console.warn(`[Meteogram] Interpolation failed for index ${i}. Skipping upper air data for this hour.`);
            freezingLevelData.push(null);
            continue; // Fahre mit dem nächsten Index im timeIndicesForDay fort
        }

        // --- Freezing Level (bleibt gleich, Ergebnis ist Meter AGL) ---
        let zeroDegAltitudeAGL_Meters = null;
        for (let j = 0; j < interpolatedHourData.length - 1; j++) {
            const p1 = interpolatedHourData[j];
            const p2 = interpolatedHourData[j + 1];
            if (p1.temp !== 'N/A' && p2.temp !== 'N/A' && ((p1.temp >= 0 && p2.temp < 0) || (p1.temp < 0 && p2.temp >= 0))) {
                const temp1 = parseFloat(p1.temp); const temp2 = parseFloat(p2.temp);
                const height1 = p1.height - baseHeight; const height2 = p2.height - baseHeight;
                if (Math.abs(temp1 - temp2) > 0.01) {
                    const fraction = (0 - temp1) / (temp2 - temp1);
                    zeroDegAltitudeAGL_Meters = height1 + fraction * (height2 - height1);
                } else { zeroDegAltitudeAGL_Meters = (height1 + height2) / 2; }
                if (zeroDegAltitudeAGL_Meters > upperChartMaxHeightAGL_Meters) { zeroDegAltitudeAGL_Meters = null; }
                else if (zeroDegAltitudeAGL_Meters < 0) { zeroDegAltitudeAGL_Meters = 0; }
                break;
            }
        }
        if (zeroDegAltitudeAGL_Meters === null && interpolatedHourData.length > 0 && interpolatedHourData[0].temp !== 'N/A' && parseFloat(interpolatedHourData[0].temp) <= 0) {
            zeroDegAltitudeAGL_Meters = 0;
        }
        // === KORREKTUR 4: Freezing Level in Anzeigeeinheit umrechnen ===
        freezingLevelData.push(zeroDegAltitudeAGL_Meters !== null ? Math.round(Utils.convertHeight(zeroDegAltitudeAGL_Meters, heightUnit)) : null);
        // ================== ENDE KORREKTUR 4 ==================

        // --- Windfiedern ---
        // (Logik bleibt gleich, aber push verwendet currentLabel)
        // Reduziere Frequenz, wenn mehr als 24h angezeigt werden (optional)
        const windBarbFrequency = timeIndicesForDay.length > 24 ? 4 : 2; // Every 4h if > 24h, else every 2h
        if (pointsProcessedThisDay % windBarbFrequency === 1) { // Check against pointsProcessedThisDay
            windBarbAltitudesAGL_CurrentUnit.forEach(altAGL_Display => {
                // ... (Interpolationslogik wie gehabt) ...
                const altAGL_m = heightUnit === 'ft' ? Utils.convertFeetToMeters(altAGL_Display) : altAGL_Display;
                if (altAGL_m > upperChartMaxHeightAGL_Meters) return;
                const altMSL = baseHeight + altAGL_m;
                let closestPoint = null; let minDiff = Infinity;
                interpolatedHourData.forEach(p => {
                    const diff = Math.abs(p.height - altMSL);
                    if (diff < minDiff) { minDiff = diff; closestPoint = p; }
                });
                if (closestPoint && closestPoint.spd !== 'N/A' && closestPoint.dir !== 'N/A') {
                    const speedKt = parseFloat(Utils.convertWind(closestPoint.spd, 'kt', 'km/h').toFixed(1));
                    // Speichere die Y-Koordinate in der ANZEIGEEINHEIT (altAGL_Display)
                    windBarbDataPoints.push({ x: currentLabel, y: altAGL_Display, speedKt: speedKt, direction: Math.round(closestPoint.dir) });
                }
            });
            // ================== ENDE KORREKTUR 5 ==================
        }

        // --- Wolkenbalken sammeln ---
        // === KORREKTUR 6: Iteriere in Schritten der Anzeigeeinheit ===
        for (let h_display = 0; h_display < upperChartMaxHeightDisplay; h_display += cloudHeightStep) {
            const bandStartAGL_Display = h_display;
            const bandEndAGL_Display = h_display + cloudHeightStep;

            // Konvertiere die Mitte der Anzeige-Bandbreite zurück in Meter MSL für die Interpolation
            const bandMidAGL_Display = h_display + cloudHeightStep / 2;
            const bandMidAGL_m = heightUnit === 'ft' ? Utils.convertFeetToMeters(bandMidAGL_Display) : bandMidAGL_Display;
            const bandMidMSL_m = baseHeight + bandMidAGL_m;

            let closestPoint = null;
            let minDiff = Infinity;
            interpolatedHourData.forEach(p => {
                const diff = Math.abs(p.height - bandMidMSL_m);
                if (diff < minDiff) { minDiff = diff; closestPoint = p; }
            });
            let cover = 0;
            if (closestPoint && closestPoint.cc !== 'N/A' && !isNaN(closestPoint.cc)) {
                cover = Number(closestPoint.cc);
            }

            // Speichere die Y-Koordinaten in der ANZEIGEEINHEIT
            cloudBarData.push({ x: currentLabel, y: [bandStartAGL_Display, bandEndAGL_Display], cover: cover });
        }
        // ================== ENDE KORREKTUR 6 ==================

    } // Ende der for-Schleife
    console.log(`[Meteogram] Data processing loop finished. ${timeLabels.length} time labels generated for date: ${displayDateStr}`);

    if (upperTitleElement && surfaceTitleElement) {
        upperTitleElement.textContent = `Upper Air - ${displayDateStr}`;
        surfaceTitleElement.textContent = `Surface - ${displayDateStr}`;
    }

    // --- Windfiedern Bilder erstellen (bleibt gleich) ---
    console.log(`[Meteogram] Creating ${windBarbDataPoints.length} wind barb images...`);
    const imageLoadPromises = windBarbDataPoints.map(p => new Promise((resolve) => {
        const img = new Image(40, 40);
        try {
            const svgString = Utils.generateWindBarb(p.direction, p.speedKt, null, barbColor);
            if (!svgString || !svgString.startsWith('<svg') || !svgString.endsWith('</svg>')) throw new Error('Invalid SVG');
            img.src = `data:image/svg+xml;base64,${btoa(svgString)}`;
            img.rawData = p;
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
        } catch (err) { resolve(null); }
    }));

    try {
        const loadedWindBarbImages = await Promise.all(imageLoadPromises);
        console.log(`[Meteogram] ${loadedWindBarbImages.filter(img => img).length} wind barb images loaded.`);
        const scatterDataForChart = loadedWindBarbImages.filter(img => img).map(img => ({ x: img.rawData.x, y: img.rawData.y, image: img }));

        // --- Chart.js Konfiguration für Höhenwetter ---
        const upperDatasets = [
            { label: 'Cloud Cover', data: cloudBarData, backgroundColor: (context) => getCloudColor(context.raw.cover, style), borderColor: (context) => getCloudColor(context.raw.cover, style), borderWidth: 1, barPercentage: 1.0, categoryPercentage: 1.0, order: 2 },
            { label: `Wind (${windUnit})`, data: scatterDataForChart, type: 'scatter', pointStyle: scatterDataForChart.map(p => p.image), pointRadius: 15, order: 1 },
            { label: 'Freezing Level (0°C)', data: freezingLevelData, type: 'line', borderColor: freezingLevelColor, borderWidth: 1.5, borderDash: [5, 5], pointRadius: 0, tension: 0.1, yAxisID: 'y', order: 0 }
        ];

        if (meteogramUpperInstance) {
            console.log('[Meteogram] Destroying existing Upper Chart instance before recreation.');
            meteogramUpperInstance.destroy();
            meteogramUpperInstance = null;
            // Optional: Clear canvas just in case, though destroy should handle it
            const ctx = upperCanvas.getContext('2d');
            ctx.clearRect(0, 0, upperCanvas.width, upperCanvas.height);
        }

        meteogramUpperInstance = new Chart(upperCtx, {
            type: 'bar',
            // === START MODIFICATION: Verwende gefilterte timeLabels ===
            data: { labels: timeLabels, datasets: upperDatasets },
            options: {
                responsive: true, maintainAspectRatio: false, indexAxis: 'x', interaction: { mode: 'nearest', axis: 'xy', intersect: false },
                scales: {
                    x: {
                        stacked: true,
                        // === START MODIFICATION: Ticks anzeigen, wenn nur ein Tag ===
                        ticks: { display: true, color: textColor, maxRotation: 0, autoSkipPadding: 20 }, // Ticks anzeigen
                        // === END MODIFICATION ===
                        grid: { color: gridColor }
                    },
                    // === KORREKTUR 7: Y-Achsen-Konfiguration angepasst ===
                    y: {
                        title: { display: true, text: `Altitude AGL (${heightUnit})`, color: textColor },
                        min: 0,
                        max: upperChartMaxHeightDisplay,
                        ticks: { color: textColor, stepSize: yAxisStepSize },
                        grid: { color: gridColor },
                        stacked: true
                    }
                    // ================== ENDE KORREKTUR 7 ==================
                },
                plugins: {
                    legend: { display: true, labels: { color: textColor, filter: (item) => item.text === 'Freezing Level (0°C)' } },
                    tooltip: { // Tooltip Callbacks bleiben weitgehend gleich, passen aber die Einheiten an
                        enabled: true, mode: 'nearest', intersect: false,
                        callbacks: {
                            title: function (tooltipItems) {
                                const item = tooltipItems[0]; if (!item || !item.raw) return item.label || '';
                                const rawData = item.raw.image ? item.raw.image.rawData : item.raw; if (!rawData) return item.label || '';
                                if (item.dataset.label.startsWith('Wind')) { return `Alt: ${rawData.y} ${heightUnit} AGL at ${rawData.x}`; }
                                else if (item.dataset.label === 'Freezing Level') { return `Time: ${item.label}`; }
                                else if (item.dataset.label === 'Cloud Cover') { return `Alt: ${rawData.y[0]}-${rawData.y[1]} ${heightUnit} AGL at ${rawData.x}`; }
                                return item.label || rawData.x;
                            },
                            label: function (context) {
                                if (!context || !context.raw) return '';
                                const rawData = context.raw.image ? context.raw.image.rawData : context.raw; if (!rawData) return '';
                                if (context.dataset.label.startsWith('Wind')) {
                                    const displaySpeed = Utils.convertWind(rawData.speedKt, windUnit, 'kt');
                                    const speedString = windUnit === 'bft' ? Math.round(displaySpeed) : displaySpeed.toFixed(1);
                                    return ` Wind: ${rawData.direction}° / ${speedString} ${windUnit}`;
                                } else if (context.dataset.label === 'Cloud Cover') {
                                    return ` Cover: ${rawData.cover.toFixed(0)}%`;
                                } else if (context.dataset.label === 'Freezing Level') {
                                    const flValue = typeof context.raw === 'number' ? context.raw : null;
                                    const displayFL = flValue !== null ? flValue : 'Above Max';
                                    return ` ${context.dataset.label}: ${displayFL}${flValue !== null ? ' ' + heightUnit + ' AGL' : ''}`;
                                }
                                return '';
                            }
                        }
                    }
                }
            }
        });
        console.log('[Meteogram] Upper Chart instance created successfully.');

    } catch (error) {
        console.error('[Meteogram] Error creating Upper Chart after image loading:', error);
        displayChartPlaceholder(upperCanvas, "Error displaying chart.");
    }

    // --- Chart.js Konfiguration für Bodenwetter ---
    console.log('[Meteogram] Surface Chart Data:', { /* ... */ });
    try {
        const surfaceDatasets = [
            // === KORREKTUR 8: Tooltips für Bodentemperatur anpassen ===
            { label: `Temp (${tempUnit === 'F' ? '°F' : '°C'})`, data: surfaceTempData, borderColor: tempColor, backgroundColor: 'transparent', borderWidth: 1.25, tension: 0.1, yAxisID: 'yTempSurface', order: 1 },
            { label: `Dew Point (${tempUnit === 'F' ? '°F' : '°C'})`, data: surfaceDewPointData, borderColor: dewPointColor, backgroundColor: 'transparent', borderWidth: 1.25, tension: 0.1, yAxisID: 'yTempSurface', order: 1 },
            // ================== ENDE KORREKTUR 8 ==================
            { label: `Wind (${windUnit})`, data: surfaceWindSpeedData, borderColor: surfaceWindColor, borderWidth: 3, borderDash: [], tension: 0.1, yAxisID: 'yWindSurface', order: 0 },
            { label: `Gusts (${windUnit})`, data: surfaceWindGustData.map((gust, i) => (gust !== null && surfaceWindSpeedData[i] !== null && gust > surfaceWindSpeedData[i]) ? gust : null), type: 'scatter', pointStyle: 'triangle', pointRadius: 5, pointBackgroundColor: surfaceGustColor, showLine: false, yAxisID: 'yWindSurface', order: -1 }
        ];

        if (meteogramSurfaceInstance) {
            console.log('[Meteogram] Destroying existing Surface Chart instance before recreation.');
            meteogramSurfaceInstance.destroy();
            meteogramSurfaceInstance = null;
            // Optional: Clear canvas
            const ctx = surfaceCanvas.getContext('2d');
            ctx.clearRect(0, 0, surfaceCanvas.width, surfaceCanvas.height);
        }

        meteogramSurfaceInstance = new Chart(surfaceCtx, {
            type: 'line',
            data: { labels: timeLabels, datasets: surfaceDatasets },
            options: {
                responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                scales: {
                    x: { title: { display: true, text: `Time (${timeZone})`, color: textColor }, ticks: { color: textColor, maxRotation: 0, autoSkipPadding: 20 }, grid: { color: gridColor } },
                    // === KORREKTUR 9: Y-Achsen-Titel für Temperatur dynamisch anpassen ===
                    yTempSurface: { type: 'linear', position: 'right', title: { display: true, text: `Temperature (${tempUnit === 'F' ? '°F' : '°C'})`, color: textColor }, ticks: { color: textColor }, grid: { color: gridColor } },
                    // ================== ENDE KORREKTUR 9 ==================
                    yWindSurface: { type: 'linear', position: 'left', title: { display: true, text: `Wind Speed (${windUnit})`, color: textColor }, ticks: { color: textColor }, grid: { drawOnChartArea: false }, min: 0 }
                },
                plugins: {
                    legend: { labels: { color: textColor } },
                    tooltip: { mode: 'index', intersect: false }
                }
            }
        });
        console.log('[Meteogram] Surface Chart instance created successfully.');
    } catch (error) {
        console.error('[Meteogram] Error creating Surface Chart:', error);
        displayChartPlaceholder(surfaceCanvas, "Error displaying chart.");
    }

    console.log('[Meteogram] Finished generateMeteogram.');
}


/**
 * Zerstört die Chart-Instanzen, falls vorhanden, UND leert die Canvas-Elemente.
 * @private
 */
function destroyCharts() {
    if (meteogramUpperInstance) {
        console.log('[Meteogram] Destroying existing Upper Chart instance.');
        meteogramUpperInstance.destroy();
        meteogramUpperInstance = null;
        const canvas = document.getElementById('meteogramUpperChart');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            console.log('[Meteogram] Cleared Upper Chart canvas.');
        }
    } else {
        console.log('[Meteogram] No existing Upper Chart instance to destroy.');
    }

    if (meteogramSurfaceInstance) {
        console.log('[Meteogram] Destroying existing Surface Chart instance.');
        meteogramSurfaceInstance.destroy();
        meteogramSurfaceInstance = null;
        const canvas = document.getElementById('meteogramSurfaceChart');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            console.log('[Meteogram] Cleared Surface Chart canvas.');
        }
    } else {
        console.log('[Meteogram] No existing Surface Chart instance to destroy.');
    }
}

/**
 * Zeigt eine Platzhalternachricht auf einem Canvas an.
 * @param {HTMLCanvasElement} canvas - Das Canvas-Element.
 * @param {string} text - Der anzuzeigende Text.
 * @private
 */
function displayChartPlaceholder(canvas, text) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const style = getComputedStyle(document.body);
    ctx.fillStyle = style.getPropertyValue('--text-secondary').trim();
    ctx.textAlign = 'center';
    ctx.font = '14px Roboto';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    console.log(`[Meteogram] Displayed placeholder on canvas: "${text}"`);
}