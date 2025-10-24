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
    if (cloudCoverPercent <= 5) return 'transparent';
    if (cloudCoverPercent <= 25) return style.getPropertyValue('--cc-few').trim() + '99';
    if (cloudCoverPercent <= 50) return style.getPropertyValue('--cc-sct').trim() + '99';
    if (cloudCoverPercent <= 87) return style.getPropertyValue('--cc-bkn').trim() + '99';
    return style.getPropertyValue('--cc-ovc').trim() + '99';
}

/**
 * Generiert und zeigt die Skydiver-Meteogramme (Boden & Höhe) an.
 */
export async function generateMeteogram() {
    console.log('[Meteogram] Starting generateMeteogram...');

    const upperCanvas = document.getElementById('meteogramUpperChart');
    const surfaceCanvas = document.getElementById('meteogramSurfaceChart');

    if (!upperCanvas || !surfaceCanvas) {
        console.warn("[Meteogram] Canvas Elemente nicht gefunden.");
        destroyCharts();
        return;
    }
    if (!AppState.weatherData || !AppState.weatherData.time || AppState.weatherData.time.length === 0) {
        console.warn("[Meteogram] Keine Wetterdaten verfügbar.");
        destroyCharts();
        displayChartPlaceholder(upperCanvas, "No weather data loaded.");
        displayChartPlaceholder(surfaceCanvas, "No weather data loaded.");
        return;
    }

    console.log('[Meteogram] Canvas and weather data found. Proceeding...');

    const upperCtx = upperCanvas.getContext('2d');
    const surfaceCtx = surfaceCanvas.getContext('2d');
    const weatherData = AppState.weatherData;

    // --- Gemeinsame Daten und Einstellungen ---
    const timeLabels = [];
    const heightUnit = Settings.getValue('heightUnit', 'm');
    const windUnit = Settings.getValue('windUnit', 'kt');
    const tempUnit = Settings.getValue('temperatureUnit', 'C');
    const timeZone = Settings.getValue('timeZone', 'Z');
    const baseHeight = Math.round(AppState.lastAltitude) || 0;
    const style = getComputedStyle(document.body);
    const gridColor = style.getPropertyValue('--border-color').trim();
    const textColor = style.getPropertyValue('--text-primary').trim();
    const barbColor = textColor;

    const upperChartMaxHeightAGL = 4500;
    const windBarbAltitudesAGL = [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500];
    const cloudHeightStep = 250;

    // Farben
    const tempColor = 'rgb(255, 99, 132)';
    const dewPointColor = 'rgb(100, 180, 255)';
    const surfaceWindColor = 'rgb(200, 200, 200)';
    const surfaceGustColor = 'rgb(200, 0, 0)';

    // --- Datenarrays vorbereiten ---
    const windBarbDataPoints = []; // Temporäres Array für Rohdaten der Fiedern
    const cloudBarData = [];
    const surfaceTempData = [];
    const surfaceDewPointData = [];
    const surfaceWindSpeedData = [];
    const surfaceWindGustData = [];

    // --- Datenverarbeitungsschleife ---
    console.log('[Meteogram] Starting data processing loop...');
    let firstDay = null;
    let dataPointsProcessed = 0;

    for (let i = 0; i < weatherData.time.length; i++) {
        // ... (Zeit-Label Logik, Tages-Check, Bodendaten sammeln - bleibt gleich) ...
        const timeStr = weatherData.time[i];
        const dt = DateTime.fromISO(timeStr, { zone: 'utc' });
        let currentDay;
        let labelTime;

        if (timeZone.toLowerCase() === 'loc' && AppState.lastLat != null && AppState.lastLng != null) {
            const locData = await Utils.getLocationData(AppState.lastLat, AppState.lastLng);
            const localDt = dt.setZone(locData.timezone || 'utc');
            currentDay = localDt.day;
            labelTime = localDt.toFormat('HH');
        } else {
            currentDay = dt.day;
            labelTime = dt.toFormat('HH\'Z\'');
        }

        if (firstDay === null) firstDay = currentDay;
        if (currentDay !== firstDay && i > 0) {
            console.log(`[Meteogram] End of first day reached at index ${i}. Processed ${dataPointsProcessed} points.`);
            break;
        }

        timeLabels.push(labelTime);
        dataPointsProcessed++;

        // Bodendaten
        const tempC = weatherData.temperature_2m[i];
        const rh = weatherData.relative_humidity_2m[i];
        surfaceTempData.push(tempC !== null ? parseFloat(Utils.convertTemperature(tempC, tempUnit).toFixed(1)) : null);
        const dewPointC = Utils.calculateDewpoint(tempC, rh);
        surfaceDewPointData.push(dewPointC !== null ? parseFloat(Utils.convertTemperature(dewPointC, tempUnit).toFixed(1)) : null);
        const surfSpeed_kmh = weatherData.wind_speed_10m[i];
        const surfGust_kmh = weatherData.wind_gusts_10m[i];
        surfaceWindSpeedData.push(surfSpeed_kmh !== null ? parseFloat(Utils.convertWind(surfSpeed_kmh, windUnit, 'km/h').toFixed(1)) : null);
        surfaceWindGustData.push(surfGust_kmh !== null ? parseFloat(Utils.convertWind(surfGust_kmh, windUnit, 'km/h').toFixed(1)) : null);

        // Höhendaten
        const interpolatedHourData = weatherManager.interpolateWeatherData(weatherData, i, 100, baseHeight, 'm');
        if (!interpolatedHourData || interpolatedHourData.length === 0) {
            console.warn(`[Meteogram] Interpolation failed for index ${i}. Skipping upper air data for this hour.`);
            continue;
        }

        // Windfiedern-Rohdaten sammeln
        windBarbAltitudesAGL.forEach(altAGL => {
            if (altAGL > upperChartMaxHeightAGL) return;
            const altMSL = baseHeight + altAGL;
            let closestPoint = null;
            let minDiff = Infinity;
            interpolatedHourData.forEach(p => {
                const diff = Math.abs(p.height - altMSL);
                if (diff < minDiff) { minDiff = diff; closestPoint = p; }
            });

            if (closestPoint && closestPoint.spd !== 'N/A' && closestPoint.dir !== 'N/A') {
                const speedKt = parseFloat(Utils.convertWind(closestPoint.spd, 'kt', 'km/h').toFixed(1));
                windBarbDataPoints.push({ // In temporäres Array pushen
                    x: labelTime, y: altAGL,
                    speedKt: speedKt,
                    direction: Math.round(closestPoint.dir)
                });
            }
        });

        // Wolkenbalken sammeln (bleibt gleich)
        for (let h = 0; h < upperChartMaxHeightAGL; h += cloudHeightStep) {
            // ... (Cloud bar logic remains the same) ...
            const bandStartAGL = h;
            const bandEndAGL = h + cloudHeightStep;
            const bandMidMSL = baseHeight + h + cloudHeightStep / 2;
            let closestPoint = null;
            let minDiff = Infinity;
            interpolatedHourData.forEach(p => {
                const diff = Math.abs(p.height - bandMidMSL);
                if (diff < minDiff) { minDiff = diff; closestPoint = p; }
            });
            if (closestPoint && closestPoint.cc !== 'N/A' && !isNaN(closestPoint.cc)) {
                const cover = Number(closestPoint.cc);
                if (cover > 5) {
                    cloudBarData.push({ x: labelTime, y: [bandStartAGL, bandEndAGL], cover: cover });
                }
            }
        }
    } // Ende der for-Schleife
    console.log(`[Meteogram] Data processing loop finished. ${timeLabels.length} time labels generated.`);

    // --- Alte Charts zerstören ---
    destroyCharts();

    // --- NEU: Erstelle Image-Objekte für Wind Barbs und warte, bis sie geladen sind ---
    console.log(`[Meteogram] Creating ${windBarbDataPoints.length} wind barb images...`);
    const imageLoadPromises = windBarbDataPoints.map(p => {
        return new Promise((resolve, reject) => {
            const img = new Image(40, 40);
            const svgString = Utils.generateWindBarb(p.direction, p.speedKt, null, barbColor);
            img.src = `data:image/svg+xml;base64,${btoa(svgString)}`;
            img.rawData = p; // Speichere Rohdaten für Tooltip

            // Warte auf 'load' oder 'error'
            img.onload = () => resolve(img);
            img.onerror = (err) => {
                console.error(`[Meteogram] Failed to load wind barb image for point:`, p, err);
                // Optional: resolve mit einem Platzhalterbild oder null
                resolve(null); // Oder reject(err), wenn der Chart nicht angezeigt werden soll
            };
        });
    });

    try {
        // Warte, bis ALLE Bilder geladen (oder fehlgeschlagen) sind
        const loadedWindBarbImages = await Promise.all(imageLoadPromises);
        console.log(`[Meteogram] ${loadedWindBarbImages.filter(img => img).length} wind barb images loaded successfully.`);

        // Erstelle das Datenarray für den Scatter-Chart MIT den geladenen Bildern
        // Filtert ggf. fehlgeschlagene Bilder heraus
        const scatterDataForChart = loadedWindBarbImages
            .filter(img => img) // Nur erfolgreich geladene Bilder
            .map(img => ({
                x: img.rawData.x,
                y: img.rawData.y,
                image: img // Das geladene Image-Objekt
            }));

        // --- Chart.js Konfiguration für Höhenwetter (Jetzt sicher) ---
        console.log('[Meteogram] Upper Chart Data:', { labels: timeLabels, datasets: [{ /* cloud */ data: cloudBarData }, { /* wind */ data: scatterDataForChart }] });
        const upperDatasets = [
            { label: 'Cloud Cover', data: cloudBarData, backgroundColor: (context) => getCloudColor(context.raw.cover, style), borderColor: (context) => getCloudColor(context.raw.cover, style), borderWidth: 1, barPercentage: 1.0, categoryPercentage: 1.0, order: 2 },
            { label: `Wind (${windUnit})`, data: scatterDataForChart, type: 'scatter', pointStyle: scatterDataForChart.map(p => p.image), pointRadius: 15, order: 1 } // Verwende p.image direkt
        ];

        meteogramUpperInstance = new Chart(upperCtx, {
            type: 'bar',
            data: { labels: timeLabels, datasets: upperDatasets },
            options: { // Optionen bleiben gleich wie zuvor
                responsive: true, maintainAspectRatio: false, indexAxis: 'x', interaction: { mode: 'nearest', axis: 'xy', intersect: false },
                scales: {
                    x: { stacked: true, ticks: { display: false }, grid: { color: gridColor } },
                    y: { title: { display: true, text: `Altitude AGL (${heightUnit})`, color: textColor }, min: 0, max: upperChartMaxHeightAGL, ticks: { color: textColor, stepSize: 500 }, grid: { color: gridColor }, stacked: true }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        enabled: true, mode: 'nearest', intersect: false,
                        callbacks: {
                            title: function (tooltipItems) {
                                const item = tooltipItems[0];
                                if (!item || !item.raw) return item.label || '';
                                const rawData = item.raw.image ? item.raw.image.rawData : item.raw;
                                if (!rawData) return item.label || '';
                                if (item.dataset.label.startsWith('Wind')) { return `Alt: ${rawData.y} m AGL at ${rawData.x}`; }
                                else if (item.dataset.label === 'Cloud Cover') { return `Alt: ${rawData.y[0]}-${rawData.y[1]} m AGL at ${rawData.x}`; }
                                return item.label || rawData.x;
                            },
                            label: function (context) {
                                if (!context || !context.raw) return '';
                                const rawData = context.raw.image ? context.raw.image.rawData : context.raw;
                                if (!rawData) return '';
                                if (context.dataset.label.startsWith('Wind')) {
                                    const displaySpeed = Utils.convertWind(rawData.speedKt, windUnit, 'kt');
                                    const speedString = windUnit === 'bft' ? Math.round(displaySpeed) : displaySpeed.toFixed(1);
                                    return ` Wind: ${rawData.direction}° / ${speedString} ${windUnit}`;
                                } else if (context.dataset.label === 'Cloud Cover') {
                                    return ` Cover: ${rawData.cover.toFixed(0)}%`;
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

    // --- Chart.js Konfiguration für Bodenwetter (bleibt unverändert) ---
    console.log('[Meteogram] Surface Chart Data:', { labels: timeLabels, datasets: [ /* ... */] });
    try {
        const surfaceDatasets = [
            { label: `Temp (${tempUnit})`, data: surfaceTempData, borderColor: tempColor, backgroundColor: tempColor + '33', tension: 0.1, yAxisID: 'yTempSurface', order: 1 },
            { label: `Dew Point (${tempUnit})`, data: surfaceDewPointData, borderColor: dewPointColor, backgroundColor: dewPointColor + '33', tension: 0.1, yAxisID: 'yTempSurface', order: 1 },
            { label: `Wind (${windUnit})`, data: surfaceWindSpeedData, borderColor: surfaceWindColor, borderDash: [5, 5], tension: 0.1, yAxisID: 'yWindSurface', order: 0 },
            { label: `Gusts (${windUnit})`, data: surfaceWindGustData.map((gust, i) => (gust !== null && surfaceWindSpeedData[i] !== null && gust > surfaceWindSpeedData[i]) ? gust : null), type: 'scatter', pointStyle: 'triangle', pointRadius: 5, pointBackgroundColor: surfaceGustColor, showLine: false, yAxisID: 'yWindSurface', order: -1 }
        ];

        meteogramSurfaceInstance = new Chart(surfaceCtx, {
            type: 'line',
            data: { labels: timeLabels, datasets: surfaceDatasets },
            options: { /* ... Optionen bleiben gleich ... */
                responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
                scales: {
                    x: { title: { display: true, text: `Time (${timeZone})`, color: textColor }, ticks: { color: textColor, maxRotation: 0, autoSkipPadding: 20 }, grid: { color: gridColor } },
                    yTempSurface: { type: 'linear', position: 'left', title: { display: true, text: `Temperature (${tempUnit})`, color: textColor }, ticks: { color: textColor }, grid: { color: gridColor } },
                    yWindSurface: { type: 'linear', position: 'right', title: { display: true, text: `Wind Speed (${windUnit})`, color: textColor }, ticks: { color: textColor }, grid: { drawOnChartArea: false }, min: 0 }
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

// --- Hilfsfunktionen (destroyCharts, displayChartPlaceholder) bleiben unverändert ---
/**
 * Zerstört die Chart-Instanzen, falls vorhanden.
 * @private
 */
function destroyCharts() {
    if (meteogramUpperInstance) {
        console.log('[Meteogram] Destroying existing Upper Chart instance.');
        meteogramUpperInstance.destroy();
        meteogramUpperInstance = null;
    }
    if (meteogramSurfaceInstance) {
        console.log('[Meteogram] Destroying existing Surface Chart instance.');
        meteogramSurfaceInstance.destroy();
        meteogramSurfaceInstance = null;
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