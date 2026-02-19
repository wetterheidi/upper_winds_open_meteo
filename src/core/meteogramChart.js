/**
 * @file meteogramChart.js
 * @description Erstellt getrennte Meteogramm-Diagramme für Boden- und Höhenwetterdaten.
 */

import { AppState } from './state.js';
import { Settings } from './settings.js';
import { Utils } from './utils.js';
import * as weatherManager from './weatherManager.js';
import { DateTime } from 'luxon';
import { I18n } from './i18n.js'; // Import ergänzt

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
    const tempUnit = Settings.getValue('temperatureUnit', 'C');

    const upperCanvas = document.getElementById('meteogramUpperChart');
    const surfaceCanvas = document.getElementById('meteogramSurfaceChart');

    // Fallback: Suche über die Struktur, falls IDs im HTML fehlen
    const upperTitleElement = document.getElementById('meteogramUpperTitle') || upperCanvas?.previousElementSibling;
    const surfaceTitleElement = document.getElementById('meteogramSurfaceTitle') || surfaceCanvas?.previousElementSibling;

    destroyCharts();

    // Wenn keine Daten da sind, trotzdem Titel setzen und abbrechen
    if (!AppState.weatherData || !AppState.weatherData.time || sliderIndex < 0) {
        if (upperTitleElement) upperTitleElement.textContent = I18n.t('weather.charts.upper_air');
        if (surfaceTitleElement) surfaceTitleElement.textContent = I18n.t('weather.charts.surface');
        displayChartPlaceholder(upperCanvas, I18n.t('weather.no_data'));
        displayChartPlaceholder(surfaceCanvas, I18n.t('weather.no_data'));
        return;
    }

    const upperCtx = upperCanvas.getContext('2d');
    const surfaceCtx = surfaceCanvas.getContext('2d');
    const weatherData = AppState.weatherData;

    const heightUnit = Settings.getValue('heightUnit', 'm');
    const windUnit = Settings.getValue('windUnit', 'kt');
    const timeZone = Settings.getValue('timeZone', 'Z');
    const baseHeight = Math.round(AppState.lastAltitude) || 0;
    const style = getComputedStyle(document.body);
    const gridColor = style.getPropertyValue('--border-color').trim();
    const textColor = style.getPropertyValue('--text-primary').trim();
    const barbColor = textColor;
    const freezingLevelColor = style.getPropertyValue('--color-success').trim();

    const upperChartMaxHeightDisplay = heightUnit === 'ft' ? 15000 : 4500;
    const yAxisStepSize = heightUnit === 'ft' ? 1000 : 500;
    const cloudHeightStep = heightUnit === 'ft' ? 300 : 100;
    const windBarbAltitudes = heightUnit === 'ft' ? [1500, 3000, 5000, 7000, 9000, 11000, 13000, 15000] : [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500];

    const tempColor = style.getPropertyValue('--wind-exceeding').trim();
    const dewPointColor = style.getPropertyValue('--cc-few').trim();
    const surfaceWindColor = style.getPropertyValue('--palette-grey-700').trim();
    const surfaceGustColor = style.getPropertyValue('--color-danger').trim();

    // Timezone & Filtering
    let locationTimezone = 'utc';
    if (timeZone.toLowerCase() === 'loc' && AppState.lastLat != null) {
        const locData = await Utils.getLocationData(AppState.lastLat, AppState.lastLng);
        locationTimezone = locData.timezone || 'utc';
    }

    const sliderTime = DateTime.fromISO(weatherData.time[sliderIndex], { zone: 'utc' }).setZone(locationTimezone);
    const targetDate = sliderTime.startOf('day');
    const displayDateStr = targetDate.toFormat('MMM dd');

    const timeIndicesForDay = [];
    const timeLabels = [];
    for (let i = 0; i < weatherData.time.length; i++) {
        const dt = DateTime.fromISO(weatherData.time[i], { zone: 'utc' }).setZone(locationTimezone);
        if (dt.hasSame(targetDate, 'day')) {
            timeIndicesForDay.push(i);
            timeLabels.push(dt.toFormat(timeZone.toLowerCase() === 'loc' ? 'HH' : 'HH\'Z\''));
        }
    }

    const windBarbDataPoints = [];
    const cloudBarData = [];
    const freezingLevelData = [];
    const surfaceTempData = [];
    const surfaceDewPointData = [];
    const surfaceWindSpeedData = [];
    const surfaceWindGustData = [];

    let pointsProcessed = 0;
    for (const i of timeIndicesForDay) {
        const currentLabel = timeLabels[pointsProcessed];
        pointsProcessed++;

        // Surface Data
        const tempC = weatherData.temperature_2m[i];
        surfaceTempData.push(tempUnit === 'F' ? Utils.convertTemperature(tempC, '°F') : tempC);
        const dpC = Utils.calculateDewpoint(tempC, weatherData.relative_humidity_2m[i]);
        surfaceDewPointData.push(tempUnit === 'F' ? Utils.convertTemperature(dpC, '°F') : dpC);

        surfaceWindSpeedData.push(parseFloat(Utils.convertWind(weatherData.wind_speed_10m[i], windUnit, 'km/h').toFixed(1)));
        surfaceWindGustData.push(parseFloat(Utils.convertWind(weatherData.wind_gusts_10m[i], windUnit, 'km/h').toFixed(1)));

        // Upper Data
        const interpolated = weatherManager.interpolateWeatherData(weatherData, i, 100, baseHeight, 'm');

        // Freezing Level
        let fl_m = null;
        for (let j = 0; j < interpolated.length - 1; j++) {
            if (interpolated[j].temp >= 0 && interpolated[j + 1].temp < 0) {
                fl_m = interpolated[j].height - baseHeight;
                break;
            }
        }
        freezingLevelData.push(fl_m !== null ? Math.round(Utils.convertHeight(fl_m, heightUnit)) : null);

        // Wind Barbs
        if (pointsProcessed % 2 === 1) {
            windBarbAltitudes.forEach(alt => {
                const altM = heightUnit === 'ft' ? Utils.convertFeetToMeters(alt) : alt;
                const closest = interpolated.reduce((prev, curr) => Math.abs(curr.height - (baseHeight + altM)) < Math.abs(prev.height - (baseHeight + altM)) ? curr : prev);
                if (closest) {
                    windBarbDataPoints.push({ x: currentLabel, y: alt, speedKt: parseFloat(Utils.convertWind(closest.spd, 'kt', 'km/h').toFixed(1)), direction: Math.round(closest.dir) });
                }
            });
        }

        // Clouds
        for (let h = 0; h < upperChartMaxHeightDisplay; h += cloudHeightStep) {
            const midM = heightUnit === 'ft' ? Utils.convertFeetToMeters(h + cloudHeightStep / 2) : h + cloudHeightStep / 2;
            const closest = interpolated.reduce((prev, curr) => Math.abs(curr.height - (baseHeight + midM)) < Math.abs(prev.height - (baseHeight + midM)) ? curr : prev);
            cloudBarData.push({ x: currentLabel, y: [h, h + cloudHeightStep], cover: closest ? Number(closest.cc) : 0 });
        }
    }

    upperTitleElement.textContent = `${I18n.t('weather.charts.upper_air')} - ${displayDateStr}`;
    surfaceTitleElement.textContent = `${I18n.t('weather.charts.surface')} - ${displayDateStr}`;

    const barbImages = await Promise.all(windBarbDataPoints.map(p => new Promise(res => {
        const img = new Image(40, 40);
        img.src = `data:image/svg+xml;base64,${btoa(Utils.generateWindBarb(p.direction, p.speedKt, null, barbColor))}`;
        img.rawData = p;
        img.onload = () => res(img);
        img.onerror = () => res(null);
    })));

    const scatterData = barbImages.filter(img => img).map(img => ({ x: img.rawData.x, y: img.rawData.y, image: img }));

    // --- Upper Chart ---
    meteogramUpperInstance = new Chart(upperCtx, {
        type: 'bar', // Basis-Typ bleibt Bar für die Wolken
        data: {
            labels: timeLabels,
            datasets: [
                {
                    label: I18n.t('weather.cloud_cover'),
                    data: cloudBarData,
                    backgroundColor: (ctx) => getCloudColor(ctx.raw?.cover, style),
                    order: 3, // Wolken ganz nach hinten
                    barPercentage: 1.0,
                    categoryPercentage: 1.0
                },
                {
                    label: I18n.t('weather.wind'),
                    data: scatterData,
                    type: 'scatter',
                    pointStyle: scatterData.map(d => d.image),
                    pointRadius: 15,
                    order: 1, // Wind nach vorne
                    xAxisID: 'x', // Explizite Zuweisung
                    yAxisID: 'y'  // Explizite Zuweisung
                },
                {
                    label: I18n.t('weather.freezing_level'),
                    type: 'line',                // Explizit als Linie definieren
                    data: freezingLevelData,
                    borderColor: freezingLevelColor,        // Deine gewünschte Farbe
                    borderWidth: 2,
                    borderDash: [5, 5],          // Gestrichelt
                    pointRadius: 0,
                    fill: false,
                    tension: 0.1,
                    yAxisID: 'y',                // Muss exakt mit der ID in scales übereinstimmen
                    xAxisID: 'x',                // WICHTIG: Muss der X-Achse zugewiesen sein
                    order: 0                     // Sorgt dafür, dass die Linie ÜBER den Wolken liegt
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            // Wichtig: Scatter-Daten dürfen nicht gestapelt werden
            scales: {
                x: {
                    type: 'category', // Explizit für Bar-Basis
                    stacked: false,
                    grid: { color: gridColor },
                    ticks: { color: textColor }
                },
                y: {
                    stacked: false, // ÄNDERUNG: Auf false setzen, da Wolken über Y-Bereich [start, end] definiert sind
                    min: 0,
                    max: upperChartMaxHeightDisplay,
                    title: { display: true, text: `${I18n.t('weather.altitude')} (${heightUnit})`, color: textColor },
                    ticks: { stepSize: yAxisStepSize, color: textColor },
                    grid: { color: gridColor }
                }
            },
            plugins: {
                legend: {
                    labels: {
                        color: textColor,
                        filter: (item) => item.text === I18n.t('weather.freezing_level')
                    }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const raw = ctx.raw.image ? ctx.raw.image.rawData : ctx.raw;
                            if (!raw) return '';
                            // String-Vergleich muss exakt mit dem Label oben übereinstimmen
                            if (ctx.dataset.label === I18n.t('weather.wind')) {
                                return ` ${I18n.t('weather.wind')}: ${raw.direction}° / ${raw.speedKt} ${windUnit}`;
                            }
                            if (ctx.dataset.label === I18n.t('weather.cloud_cover')) {
                                return ` ${I18n.t('weather.cloud_cover')}: ${raw.cover.toFixed(0)}%`;
                            }
                            return ` ${ctx.dataset.label}: ${ctx.raw} ${heightUnit}`;
                        }
                    }
                }
            }
        }
    });

    // --- Surface Chart ---
    meteogramSurfaceInstance = new Chart(surfaceCtx, {
        type: 'line',
        data: {
            labels: timeLabels,
            datasets: [
                { label: I18n.t('weather.temp'), data: surfaceTempData, borderColor: tempColor, backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 3, tension: 0.1, yAxisID: 'yTempSurface' },
                { label: I18n.t('weather.dew_point'), data: surfaceDewPointData, borderColor: dewPointColor, backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 3, tension: 0.1, yAxisID: 'yTempSurface' },
                { label: I18n.t('weather.wind'), data: surfaceWindSpeedData, borderColor: surfaceWindColor, backgroundColor: 'transparent', borderWidth: 3, tension: 0.1, yAxisID: 'yWindSurface' },
                { label: I18n.t('weather.gusts'), data: surfaceWindGustData, type: 'scatter', pointStyle: 'triangle', pointRadius: 5, pointBackgroundColor: surfaceGustColor, pointBorderColor: surfaceGustColor, showLine: false, yAxisID: 'yWindSurface' }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                yTempSurface: { position: 'right', title: { display: true, text: I18n.t('weather.temp'), color: textColor } },
                yWindSurface: { position: 'left', title: { display: true, text: I18n.t('weather.wind_speed'), color: textColor }, min: 0 }
            }
        }
    });
}


/**
 * Zerstört die Chart-Instanzen, falls vorhanden, UND leert die Canvas-Elemente.
 * @private
 */
function destroyCharts() {
    [meteogramUpperInstance, meteogramSurfaceInstance].forEach(inst => inst?.destroy());
    meteogramUpperInstance = null; meteogramSurfaceInstance = null;
}

/**
 * Zeigt eine Platzhalternachricht auf einem Canvas an.
 * @param {HTMLCanvasElement} canvas - Das Canvas-Element.
 * @param {string} text - Der anzuzeigende Text.
 * @private
 */
function displayChartPlaceholder(canvas, text) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center'; ctx.fillText(text, canvas.width / 2, canvas.height / 2);
}