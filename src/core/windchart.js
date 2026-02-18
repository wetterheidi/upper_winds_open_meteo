import { AppState } from './state.js';
import { Utils } from './utils.js';
import { Settings } from './settings.js';
import { I18n } from './i18n.js';

let windspinneChart = null; // To hold the chart instance

/**
 * Generates the wind spider chart using interpolated weather data.
 * @param {object[]} interpolatedData - The array of interpolated weather data (contains MSL heights).
 * @param {number} userMaxHoehe - The maximum altitude AGL to display on the chart (value is already in the selected unit!).
 */
export function generateWindspinne(interpolatedData, userMaxHoehe) {
    const canvas = document.getElementById('windspinne-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const style = getComputedStyle(document.body);

    // 1. Aktuelle Einheit abrufen
    const heightUnit = Settings.getValue('heightUnit', 'm');
    const isFeet = heightUnit === 'ft';

    // 2. Datenvektoren extrahieren (Die Basisdaten sind immer in SI/Meter MSL)
    const hoehenVektor = interpolatedData.map(d => d.height);
    const ddd_vec = interpolatedData.map(d => d.dir);
    const ff_vec_mps = interpolatedData.map(d => Utils.convertWind(d.spd, 'm/s', 'km/h')); // speed in m/s

    const maxDatenHoeheMsl = Math.max(...hoehenVektor);

    // userMaxHoehe kommt aus dem Input-Feld und ist bereits in der richtigen Einheit (ft oder m)
    const maxRadius = userMaxHoehe;

    // Hilfsfunktion: Berechnet aus dem AGL-Wert der Chart-Achse (in ft oder m) die MSL-Höhe in Metern für die Interpolation
    const getMslMeters = (r_agl_in_unit) => {
        const agl_meters = isFeet ? Utils.convertFeetToMeters(r_agl_in_unit) : r_agl_in_unit;
        return AppState.lastAltitude + agl_meters;
    };

    const getWindColor = (speedKt) => {
        if (speedKt <= 5) return style.getPropertyValue('--wind-low').trim();
        if (speedKt <= 10) return style.getPropertyValue('--wind-moderate').trim();
        if (speedKt <= 15) return style.getPropertyValue('--wind-high').trim();
        if (speedKt <= 20) return style.getPropertyValue('--wind-very-high').trim();
        return style.getPropertyValue('--wind-extreme').trim();
    };

    // 3. Linie generieren (hohe Auflösung)
    // Schrittweite anpassen: ~50m oder ~150ft
    const lineStep = isFeet ? 150 : 50;
    const linePolarData = [];

    for (let r = 0; r <= maxRadius; r += lineStep) {
        const queryHeightMsl = getMslMeters(r);

        // Stoppen, wenn wir höher sind als die Wetterdaten reichen
        if (queryHeightMsl > maxDatenHoeheMsl) break;

        linePolarData.push({
            r: r, // Radius in Anzeigeeinheit
            t: Utils.linearInterpolateAngle(hoehenVektor, ddd_vec, queryHeightMsl),
            speed: Utils.linearInterpolate(hoehenVektor, ff_vec_mps, queryHeightMsl) * 1.94384 // Convert m/s to kt
        });
    }

    // 4. Punkte generieren (niedrigere Auflösung für Marker)
    // Schrittweiten anpassen, damit es im Grid gut aussieht
    let pointStep;
    if (isFeet) {
        // Bei Feet z.B. 500ft oder 1000ft Schritte
        pointStep = maxRadius <= 12000 ? 500 : 1000;
    } else {
        // Bei Metern wie gehabt
        pointStep = maxRadius <= 4000 ? 200 : 500;
    }

    const pointsPolarData = [];
    for (let r = 0; r <= maxRadius; r += pointStep) {
        const queryHeightMsl = getMslMeters(r);
        if (queryHeightMsl > maxDatenHoeheMsl) break;

        pointsPolarData.push({
            r: r,
            t: Utils.linearInterpolateAngle(hoehenVektor, ddd_vec, queryHeightMsl),
            speed: Utils.linearInterpolate(hoehenVektor, ff_vec_mps, queryHeightMsl) * 1.94384
        });
    }

    const convertToCartesian = (data) => data.map(p => ({
        x: p.r * Math.cos((90 - p.t) * Math.PI / 180),
        y: p.r * Math.sin((90 - p.t) * Math.PI / 180),
        original: p
    }));

    if (windspinneChart) windspinneChart.destroy();

    windspinneChart = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [
                {
                    data: convertToCartesian(linePolarData),
                    showLine: true,
                    pointRadius: 0,
                    segment: {
                        borderColor: ctx => getWindColor((ctx.p0.raw.original.speed + ctx.p1.raw.original.speed) / 2),
                        borderWidth: 2.5
                    }
                },
                {
                    data: convertToCartesian(pointsPolarData),
                    showLine: false,
                    pointRadius: 3,
                    pointBackgroundColor: ctx => getWindColor(ctx.raw.original.speed)
                }
            ]
        },
        options: {
            maintainAspectRatio: false,
            layout: { padding: { bottom: 25, left: 25, right: 25 } },
            // Achsen sind nun in der Anzeigeeinheit
            scales: { x: { display: false, min: -maxRadius, max: maxRadius }, y: { display: false, min: -maxRadius, max: maxRadius } },
            plugins: {
                title: {
                    display: true,
                    text: I18n.t('weather.charts.wind_chart_title'),
                    font: { size: 16 },
                    padding: { top: 5, bottom: 35 },
                    color: style.getPropertyValue('--text-primary').trim()
                },
                legend: { display: false },
                tooltip: {
                    filter: item => item.datasetIndex === 1,
                    // Einheit im Tooltip anzeigen
                    callbacks: { label: ctx => `${ctx.raw.original.r} ${heightUnit}: ${Math.round(ctx.raw.original.t)}° / ${Math.round(ctx.raw.original.speed)} kt` }
                }
            }
        },
        plugins: [{
            id: 'polarGrid',
            beforeDraw: chart => {
                const { ctx, scales: { x, y } } = chart;
                if (!chart.chartArea) return;

                const centerX = x.getPixelForValue(0);
                const centerY = y.getPixelForValue(0);

                ctx.save();
                ctx.font = '10px Roboto';

                // Grid-Kreise passend zu den Punkten zeichnen
                const circleStep = pointStep;

                // Labels alle 1000m oder ~2000ft/3000ft, damit es nicht zu voll wird
                let labelStep;
                if (isFeet) {
                    labelStep = maxRadius <= 6000 ? 1000 : 2000;
                } else {
                    labelStep = 1000;
                }

                const gridColor = style.getPropertyValue('--border-color').trim();
                const textColor = style.getPropertyValue('--text-secondary').trim();

                // Thin helper lines
                ctx.strokeStyle = gridColor;
                ctx.lineWidth = 0.5;
                for (let alt = circleStep; alt <= maxRadius; alt += circleStep) {
                    if (alt % labelStep !== 0) {
                        const radiusX = Math.abs(x.getPixelForValue(alt) - centerX);
                        const radiusY = Math.abs(y.getPixelForValue(alt) - centerY);
                        ctx.beginPath();
                        ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
                        ctx.stroke();
                    }
                }

                // Thick main altitude lines (Labels)
                ctx.strokeStyle = gridColor;
                ctx.lineWidth = 1.5;
                for (let alt = labelStep; alt <= maxRadius; alt += labelStep) {
                    const radiusX = Math.abs(x.getPixelForValue(alt) - centerX);
                    const radiusY = Math.abs(y.getPixelForValue(alt) - centerY);
                    ctx.beginPath();
                    ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
                    ctx.stroke();
                    ctx.fillStyle = textColor;
                    // Einheit im Grid-Label anzeigen
                    ctx.fillText(`${alt} ${heightUnit}`, centerX + 5, centerY - radiusY - 5);
                }

                // Radial lines (bleiben gleich)
                const maxPixelRadiusX = (chart.chartArea.right - chart.chartArea.left) / 2;
                const maxPixelRadiusY = (chart.chartArea.bottom - chart.chartArea.top) / 2;
                ctx.strokeStyle = gridColor;
                ctx.lineWidth = 1;
                for (let angle = 0; angle < 360; angle += 30) {
                    const angleRad = (angle - 90) * (Math.PI / 180);
                    ctx.beginPath();
                    ctx.moveTo(centerX, centerY);
                    ctx.lineTo(centerX + maxPixelRadiusX * Math.cos(angleRad), centerY + maxPixelRadiusY * Math.sin(angleRad));
                    ctx.stroke();
                    ctx.save();
                    ctx.translate(centerX + (maxPixelRadiusX + 15) * Math.cos(angleRad), centerY + (maxPixelRadiusY + 15) * Math.sin(angleRad));
                    ctx.rotate(angleRad + Math.PI / 2);
                    ctx.textAlign = 'center';
                    ctx.fillText(`${angle}°`, 0, 0);
                    ctx.restore();
                }
                ctx.restore();
            }
        }]
    });

    // Update legend (bleibt unverändert)
    const legendContainer = document.getElementById('windspinne-legend');
    legendContainer.innerHTML = '';
    const legendData = [
        { speed: '0-5 kt', color: style.getPropertyValue('--wind-low').trim() },
        { speed: '6-10 kt', color: style.getPropertyValue('--wind-moderate').trim() },
        { speed: '11-15 kt', color: style.getPropertyValue('--wind-high').trim() },
        { speed: '16-20 kt', color: style.getPropertyValue('--wind-very-high').trim() },
        { speed: '> 20 kt', color: style.getPropertyValue('--wind-extreme').trim() }
    ];

    legendData.forEach(item => {
        const legendItem = document.createElement('div');
        legendItem.className = 'legend-item';
        legendItem.innerHTML = `<div class="legend-color-box" style="background-color: ${item.color};"></div><span>${item.speed}</span>`;
        legendContainer.appendChild(legendItem);
    });
}
