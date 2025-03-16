class Utils {
    // Format ISO time string to UTC (e.g., "2025-03-15T00:00Z" -> "2025-03-15 0000Z")
    static formatTime(timeStr) {
        console.log('Formatting time:', timeStr);
        const date = new Date(Date.UTC(
            parseInt(timeStr.slice(0, 4)), // Year
            parseInt(timeStr.slice(5, 7)) - 1, // Month (0-based)
            parseInt(timeStr.slice(8, 10)), // Day
            parseInt(timeStr.slice(11, 13)), // Hour
            parseInt(timeStr.slice(14, 16)) // Minute
        ));
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        const hour = String(date.getUTCHours()).padStart(2, '0');
        const minute = String(date.getUTCMinutes()).padStart(2, '0');
        return `${year}-${month}-${day} ${hour}${minute}Z`;
    }

    // Round a number to the nearest ten
    static roundToTens(value) {
        return Math.round(value / 10) * 10;
    }


    static convertHeight(value, toUnit) {
        return toUnit === 'ft' ? value * 3.28084 : value; // m to ft or unchanged if m
    }

    // Calculate dewpoint from temperature (°C) and relative humidity (%)
    static calculateDewpoint(temp, rh) {
        const aLiquid = 17.27;
        const bLiquid = 237.7;
        const aIce = 21.87;
        const bIce = 265.5;

        let alpha, dewpoint;
        if (temp >= 0) {
            alpha = (aLiquid * temp) / (bLiquid + temp) + Math.log(rh / 100);
            dewpoint = (bLiquid * alpha) / (aLiquid - alpha);
        } else {
            alpha = (aIce * temp) / (bIce + temp) + Math.log(rh / 100);
            dewpoint = (bIce * alpha) / (aIce - alpha);
        }
        return isNaN(dewpoint) ? null : dewpoint; // Return number or null if invalid
    }

    // Gaussian-weighted interpolation between two points
    static gaussianInterpolation(y1, y2, h1, h2, hp) {
        let w1 = 1 / Math.abs(h1 - hp);
        let w2 = 1 / Math.abs(h2 - hp);
        const yp = (w1 * y1 + w2 * y2) / (w1 + w2);
        return yp;
    }

    // Interpolate pressure based on height and pressure levels
    static interpolatePressure(height, pressureLevels, heights) {
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

    // Linear interpolation (LIP)
    static LIP(xVector, yVector, xValue) {
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

    // Calculate wind speed from u/v components
    static windSpeed(x, y) {
        return Math.sqrt(x * x + y * y);
    }

    // Calculate wind direction from u/v components (meteorological convention)
    static windDirection(u, v) {
        let dir = Math.atan2(-u, -v) * 180 / Math.PI;
        return (dir + 360) % 360;
    }

    // Calculate mean wind over a height layer (renamed from Mittelwind for clarity)
    static calculateMeanWind(heights, xComponents, yComponents, lowerLimit, upperLimit) {
        const dddff = new Array(4);
        let hLayer = [upperLimit];
        let xLayer = [Number(Utils.LIP(heights, xComponents, upperLimit))];
        let yLayer = [Number(Utils.LIP(heights, yComponents, upperLimit))];

        const xLower = Number(Utils.LIP(heights, xComponents, lowerLimit));
        const yLower = Number(Utils.LIP(heights, yComponents, lowerLimit));

        for (let i = 0; i < heights.length; i++) {
            if (heights[i] < upperLimit && heights[i] > lowerLimit) {
                hLayer.push(heights[i]);
                xLayer.push(xComponents[i]);
                yLayer.push(yComponents[i]);
            }
        }

        hLayer.push(lowerLimit);
        xLayer.push(xLower);
        yLayer.push(yLower);

        // Sort arrays in descending order of height
        const indices = hLayer.map((_, idx) => idx);
        indices.sort((a, b) => hLayer[b] - hLayer[a]);
        hLayer = indices.map(i => hLayer[i]);
        xLayer = indices.map(i => xLayer[i]);
        yLayer = indices.map(i => yLayer[i]);

        let xTrapez = 0;
        let yTrapez = 0;
        for (let i = 0; i < hLayer.length - 1; i++) {
            xTrapez += 0.5 * (xLayer[i] + xLayer[i + 1]) * (hLayer[i] - hLayer[i + 1]);
            yTrapez += 0.5 * (yLayer[i] + yLayer[i + 1]) * (hLayer[i] - hLayer[i + 1]);
        }

        const xMean = xTrapez / (hLayer[0] - hLayer[hLayer.length - 1]);
        const yMean = yTrapez / (hLayer[0] - hLayer[hLayer.length - 1]);

        dddff[2] = xMean; // u component
        dddff[3] = yMean; // v component
        dddff[1] = Utils.windSpeed(xMean, yMean); // Speed
        dddff[0] = Utils.windDirection(xMean, yMean); // Direction

        return dddff;
    }
}

window.Utils = Utils;