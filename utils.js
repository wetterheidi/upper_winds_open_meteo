class Utils {
    // Format ISO time string to UTC (e.g., "2025-03-15T00:00Z" -> "2025-03-15 0000Z")
    static formatTime(timeStr) {
        if (!window.luxon) return timeStr; // Fallback
        const { DateTime } = luxon;
        return DateTime.fromISO(timeStr, { zone: 'UTC' }).toFormat('yyyy-MM-dd HHmm') + 'Z';
    }

    // Round a number to the nearest ten
    static roundToTens(value) {
        return Math.round(value / 10) * 10;
    }

    static convertTemperature(value, toUnit) {
        // Check if value is a valid number; if not, return 'N/A'
        const numericValue = parseFloat(value);
        if (isNaN(numericValue)) {
            return 'N/A';
        }
        return toUnit === '°F' ? numericValue * 9 / 5 + 32 : numericValue; // °C to °F or unchanged if °C
    }

    static convertHeight(value, toUnit) {
        const numericValue = parseFloat(value);
        if (isNaN(numericValue)) {
            return 'N/A';
        }
        return toUnit === 'ft' ? value * 3.28084 : value; // m to ft or unchanged if m
    }

    static convertWind(value, toUnit, fromUnit = 'km/h') {
        if (value === undefined || value === null || isNaN(value)) return 'N/A';
        let speedInKmH;
        switch (fromUnit) {
            case 'km/h':
                speedInKmH = value;
                break;
            case 'm/s':
                speedInKmH = value * 3.6;
                break;
            case 'kt':
                speedInKmH = value * 1.852;
                break;
            case 'mph':
                speedInKmH = value * 1.60934;
                break; // Double-check this break is present
            case 'bft':
                speedInKmH = Utils.beaufortToKnots(value) * 1.852;
                break;
            default:
                speedInKmH = value;
                break;
        }
        switch (toUnit) {
            case 'km/h':
                return speedInKmH;
            case 'm/s':
                return speedInKmH / 3.6;
            case 'kt':
                return speedInKmH / 1.852;
            case 'mph':
                return speedInKmH / 1.60934;
            case 'bft':
                return Utils.knotsToBeaufort(speedInKmH / 1.852);
            default:
                return speedInKmH / 1.852;
        }
    }

    // Helper functions (assuming you have or need these)
    static knotsToBeaufort(knots) {
        if (knots < 1) return 0;
        if (knots <= 3) return 1;
        if (knots <= 6) return 2;
        if (knots <= 10) return 3;
        if (knots <= 16) return 4;
        if (knots <= 21) return 5;
        if (knots <= 27) return 6;
        if (knots <= 33) return 7;
        if (knots <= 40) return 8;
        if (knots <= 47) return 9;
        if (knots <= 55) return 10;
        if (knots <= 63) return 11;
        return 12;
    }

    static beaufortToKnots(bft) {
        const thresholds = [0, 1, 3, 6, 10, 16, 21, 27, 33, 40, 47, 55, 63];
        return thresholds[bft] || 63; // Default to max if bft > 12
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

    // Cache for time zones and elevations
    static locationCache = new Map();

    // New function to fetch time zone and elevation from Open-Meteo
    static async getLocationData(lat, lng) {
        const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
        if (Utils.locationCache.has(cacheKey)) {
            return Utils.locationCache.get(cacheKey);
        }

        try {
            const response = await fetch(
                `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&timezone=auto`
            );
            if (!response.ok) throw new Error(`Open-Meteo fetch failed: ${response.status}`);
            const data = await response.json();
            const locationData = {
                timezone: data.timezone || 'UTC', // Fallback to UTC
                timezone_abbreviation: data.timezone_abbreviation || 'UTC', // Fallback to UTC
                elevation: data.elevation !== undefined ? data.elevation : 'N/A'
            };
            Utils.locationCache.set(cacheKey, locationData);
            console.log(`Fetched location data for ${cacheKey}:`, locationData);
            return locationData;
        } catch (error) {
            console.error('Error fetching location data:', error.message);
            return { timezone: 'UTC', elevation: 'N/A' }; // Fallback
        }
    }

    // Updated formatLocalTime using Open-Meteo time zone
    static async formatLocalTime(utcTimeStr, lat, lng) {
        if (!window.luxon) {
            console.warn('Luxon not available, falling back to UTC');
            return Utils.formatTime(utcTimeStr);
        }
        const { DateTime } = luxon;

        const { timezone, timezone_abbreviation } = await Utils.getLocationData(lat, lng);
        const utcDate = DateTime.fromISO(utcTimeStr, { zone: 'UTC' });
        const localDate = utcDate.setZone(timezone);
        return localDate.toFormat('yyyy-MM-dd HHmm') + ` ${timezone_abbreviation}`;
    }

    //Functions for wind calculations
    /**
    * Normalize an angle to 0-360 degrees
     */
    static normalizeAngle(angle) {
        return (angle % 360 + 360) % 360;
    }

    /**
     * Calculate wind angle (wind direction relative to true course)
     */
    static calculateWindAngle(trueCourse, windDirection) {
        let angle = Utils.normalizeAngle(windDirection - trueCourse);
        if (angle > 180) angle -= 360; // -180 to 180
        return angle;
    }

    /**
     * Calculate wind components
     */
    static calculateWindComponents(windSpeed, windAngle) {
        const radians = windAngle * (Math.PI / 180);
        const crosswind = windSpeed * Math.sin(radians); // Positive = right, negative = left
        const headwind = windSpeed * Math.cos(radians);  // Positive = headwind, negative = tailwind
        return { crosswind, headwind };
    }

    /**
     * Calculate wind correction angle (WCA)
     */
    static calculateWCA(crosswind, trueAirspeed) {
        const radians = Math.asin(crosswind / trueAirspeed);
        const wca = radians * (180 / Math.PI);
        return isNaN(wca) ? 0 : wca; // Negative if wind from left, positive if from right
    }

    /**
     * Calculate ground speed
     */
    static calculateGroundSpeed(trueAirspeed, headwind) {
        return trueAirspeed - headwind;
    }

    /**
     * Main function to calculate flight parameters
     */
    static calculateFlightParameters(trueCourse, windDirection, windSpeed, trueAirspeed) {
        const windAngle = Utils.calculateWindAngle(trueCourse, windDirection);
        const { crosswind, headwind } = Utils.calculateWindComponents(windSpeed, windAngle);
        const wca = Utils.calculateWCA(crosswind, trueAirspeed);
        const groundSpeed = Utils.calculateGroundSpeed(trueAirspeed, headwind);

        return {
            crosswind: Number(crosswind.toFixed(2)),
            headwind: Number(headwind.toFixed(2)),
            wca: Number(wca.toFixed(2)),
            groundSpeed: Number(groundSpeed.toFixed(2))
        };
    }

    static handleError(message, log = true) {
        if (log) console.error(message);
        displayError(message);
    }
}

window.Utils = Utils;