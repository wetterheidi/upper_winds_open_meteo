import { AppState } from './state.js';
import { Utils } from './utils.js';

let windspinneChart = null; // To hold the chart instance

/**
 * Generates the wind spider chart using interpolated weather data.
 * @param {object[]} interpolatedData - The array of interpolated weather data.
 * @param {number} userMaxHoehe - The maximum altitude (in meters) to display on the chart.
 */
export function generateWindspinne(interpolatedData, userMaxHoehe) {
    const canvas = document.getElementById('windspinne-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Data vectors from the interpolated data
    const hoehenVektor = interpolatedData.map(d => d.height);
    const ddd_vec = interpolatedData.map(d => d.dir);
    const ff_vec_mps = interpolatedData.map(d => Utils.convertWind(d.spd, 'm/s', 'km/h')); // speed in m/s

    const maxDatenHoehe = Math.max(...hoehenVektor);
    const loopMaxHoehe = Math.min(maxDatenHoehe, userMaxHoehe + AppState.lastAltitude);
    const maxRadius = userMaxHoehe;

    const getWindColor = (speedKt) => {
        if (speedKt <= 5) return 'blue';
        if (speedKt <= 10) return 'green';
        if (speedKt <= 15) return 'orange';
        if (speedKt <= 20) return 'red';
        return 'purple';
    };

    const linePolarData = [];
    for (let h = AppState.lastAltitude; h <= loopMaxHoehe; h += 50) {
        const aglHeight = h - AppState.lastAltitude;
        if (aglHeight >= 0) {
            linePolarData.push({
                r: aglHeight,
                // KORREKTUR: linearInterpolateAngle verwenden
                t: Utils.linearInterpolateAngle(hoehenVektor, ddd_vec, h),
                speed: Utils.linearInterpolate(hoehenVektor, ff_vec_mps, h) * 1.94384
            });
        }
    }

    const pointsPolarData = [];
    const pointStep = maxRadius <= 4000 ? 200 : 500;
    for (let h = AppState.lastAltitude; h <= loopMaxHoehe; h += pointStep) {
        const aglHeight = h - AppState.lastAltitude;
        if (aglHeight >= 0) {
            pointsPolarData.push({
                r: aglHeight,
                // KORREKTUR: linearInterpolateAngle verwenden
                t: Utils.linearInterpolateAngle(hoehenVektor, ddd_vec, h),
                speed: Utils.linearInterpolate(hoehenVektor, ff_vec_mps, h) * 1.94384
            });
        }
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
                { data: convertToCartesian(linePolarData), showLine: true, pointRadius: 0, segment: { borderColor: ctx => getWindColor((ctx.p0.raw.original.speed + ctx.p1.raw.original.speed) / 2), borderWidth: 2.5 } },
                { data: convertToCartesian(pointsPolarData), showLine: false, pointRadius: 3, pointBackgroundColor: ctx => getWindColor(ctx.raw.original.speed) }
            ]
        },
        options: {
            maintainAspectRatio: false,
            layout: { padding: { bottom: 25, left: 25, right: 25 } },
            scales: { x: { display: false, min: -maxRadius, max: maxRadius }, y: { display: false, min: -maxRadius, max: maxRadius } },
            plugins: {
                title: { display: true, text: `Wind chart for current location`, font: { size: 16 }, padding: { top: 5, bottom: 35 } },
                legend: { display: false },
                tooltip: {
                    filter: item => item.datasetIndex === 1,
                    callbacks: { label: ctx => `${ctx.raw.original.r}m: ${Math.round(ctx.raw.original.t)}° / ${Math.round(ctx.raw.original.speed)} kt` }
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

                const circleStep = maxRadius <= 4000 ? 200 : 500;
                const labelStep = 1000;

                // Thin helper lines
                ctx.strokeStyle = '#eee';
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

                // Thick main altitude lines
                ctx.strokeStyle = '#ccc';
                ctx.lineWidth = 1.5;
                for (let alt = labelStep; alt <= maxRadius; alt += labelStep) {
                    const radiusX = Math.abs(x.getPixelForValue(alt) - centerX);
                    const radiusY = Math.abs(y.getPixelForValue(alt) - centerY);
                    ctx.beginPath();
                    ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
                    ctx.stroke();
                    ctx.fillStyle = '#666';
                    ctx.fillText(`${alt}m`, centerX + 5, centerY - radiusY - 5);
                }

                // Radial lines
                const maxPixelRadiusX = (chart.chartArea.right - chart.chartArea.left) / 2;
                const maxPixelRadiusY = (chart.chartArea.bottom - chart.chartArea.top) / 2;
                ctx.strokeStyle = '#ccc';
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

    // Update legend
    const legendContainer = document.getElementById('windspinne-legend');
    legendContainer.innerHTML = '';
    const legendData = [
        { speed: '0-5 kt', color: 'blue' }, { speed: '6-10 kt', color: 'green' }, { speed: '11-15 kt', color: 'orange' },
        { speed: '16-20 kt', color: 'red' }, { speed: '> 20 kt', color: 'purple' }
    ];
    legendData.forEach(item => {
        const legendItem = document.createElement('div');
        legendItem.className = 'legend-item';
        legendItem.innerHTML = `<div class="legend-color-box" style="background-color: ${item.color};"></div><span>${item.speed}</span>`;
        legendContainer.appendChild(legendItem);
    });
}
