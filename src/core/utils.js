import { DateTime } from 'luxon';
import * as mgrs from 'mgrs';
import { AppState } from './state.js';
import { CONVERSIONS, ISA_CONSTANTS, DEWPOINT_COEFFICIENTS, EARTH_RADIUS_METERS, PHYSICAL_CONSTANTS, BEAUFORT, ENSEMBLE_VISUALIZATION } from './constants.js';

let customErrorHandler = console.error; // Fallback auf console.error
let customMessageHandler = console.log; // Fallback für Nachrichten

export class Utils {

    /**
     * Formatiert einen ISO 8601 Zeit-String in ein spezifisches, lesbares UTC-Format.
     * Beispiel: "2025-03-15T00:00:00.000Z" -> "2025-03-15 0000Z"
     * @param {string} timeStr - Der Zeitstempel im ISO 8601 Format.
     * @returns {string} Der formatierte Zeit-String.
     */
    static formatTime(timeStr) {
        return DateTime.fromISO(timeStr, { zone: 'UTC' }).toFormat('yyyy-MM-dd HHmm') + 'Z';
    }

    /**
     * Rundet eine gegebene Zahl auf die nächste Zehnerstelle.
     * @param {number} value - Die zu rundende Zahl.
     * @returns {number} Der auf die nächste Zehnerstelle gerundete Wert.
     */
    static roundToTens(value) {
        return Math.round(value / 10) * 10;
    }

    /**
 * Rechnet eine Temperatur von Celsius in Fahrenheit um.
 * Gibt 'N/A' zurück, wenn der Eingabewert keine gültige Zahl ist.
 * @param {number|string} value - Der Temperaturwert in Celsius.
 * @param {string} toUnit - Die Zieleinheit ('°F' oder '°C').
 * @returns {number|string} Die umgerechnete Temperatur oder 'N/A'.
 */
    static convertTemperature(value, toUnit) {
        // Check if value is a valid number; if not, return 'N/A'
        const numericValue = parseFloat(value);
        if (isNaN(numericValue)) {
            return 'N/A';
        }
        return toUnit === '°F' ? numericValue * 9 / 5 + 32 : numericValue; // °C to °F or unchanged if °C
    }

    /**
 * Rechnet eine Höhe von Metern in Fuß um.
 * Gibt 'N/A' zurück, wenn der Eingabewert keine gültige Zahl ist.
 * @param {number|string} value - Der Höhenwert in Metern.
 * @param {string} toUnit - Die Zieleinheit ('ft' oder 'm').
 * @returns {number|string} Die umgerechnete Höhe oder 'N/A'.
 */
    static convertHeight(value, toUnit) {
        const numericValue = parseFloat(value);
        if (isNaN(numericValue)) {
            return 'N/A';
        }
        return toUnit === 'ft' ? parseFloat((value * CONVERSIONS.METERS_TO_FEET).toFixed(0)) : value; // m to ft or unchanged if m
    }

    /**
  * Rechnet Windgeschwindigkeiten zwischen verschiedenen Einheiten um.
  * Unterstützte Einheiten: 'km/h', 'm/s', 'kt', 'mph', 'bft'.
  * @param {number|string} value - Der Geschwindigkeitswert.
  * @param {string} toUnit - Die Zieleinheit.
  * @param {string} [fromUnit='km/h'] - Die Ausgangseinheit (optional, Standard ist 'km/h').
  * @returns {number|string} Die umgerechnete Geschwindigkeit oder 'N/A'.
  */
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
                speedInKmH = value * CONVERSIONS.KNOTS_TO_KMH;
                break;
            case 'mph':
                speedInKmH = value * 1.60934;
                break; // Double-check this break is present
            case 'bft':
                speedInKmH = Utils.beaufortToKnots(value) * CONVERSIONS.KNOTS_TO_KMH;
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
                return speedInKmH / CONVERSIONS.KNOTS_TO_KMH;
            case 'mph':
                return speedInKmH / 1.60934;
            case 'bft':
                return Utils.knotsToBeaufort(speedInKmH / CONVERSIONS.KNOTS_TO_KMH);
            default:
                return speedInKmH / CONVERSIONS.KNOTS_TO_KMH;
        }
    }

    // Helper functions (assuming you have or need these)
    static knotsToBeaufort(knots) {
        // Finde den ersten Schwellenwert, der größer ist als die Knotengeschwindigkeit
        const beaufortLevel = BEAUFORT.KNOT_THRESHOLDS.findIndex(threshold => knots < threshold);
        // Wenn kein Wert gefunden wird (stärker als 63 Knoten), ist es Stufe 12. Sonst ist es der gefundene Index.
        return beaufortLevel === -1 ? 12 : beaufortLevel;
    }

    static beaufortToKnots(bft) {
        return BEAUFORT.BEAUFORT_THRESHOLDS[bft] || 63; // Default to max if bft > 12
    }

    /**
     * Berechnet den Taupunkt anhand von Temperatur und relativer Luftfeuchtigkeit.
     * Verwendet unterschiedliche Formeln für Temperaturen über und unter dem Gefrierpunkt.
     * @param {number} temp - Die Temperatur in Grad Celsius.
     * @param {number} rh - Die relative Luftfeuchtigkeit in Prozent (z.B. 75).
     * @returns {number|null} Den berechneten Taupunkt in Grad Celsius oder null bei ungültiger Eingabe.
     */
    static calculateDewpoint(temp, rh) {
        const aLiquid = DEWPOINT_COEFFICIENTS.A_LIQUID;
        const bLiquid = DEWPOINT_COEFFICIENTS.B_LIQUID;
        const aIce = DEWPOINT_COEFFICIENTS.A_ICE;
        const bIce = DEWPOINT_COEFFICIENTS.B_ICE;

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
        // Handle edge cases where hp equals h1 or h2
        if (h1 === hp) return y1;
        if (h2 === hp) return y2;
        let w1 = 1 / Math.abs(h1 - hp);
        let w2 = 1 / Math.abs(h2 - hp);
        const yp = (w1 * y1 + w2 * y2) / (w1 + w2);
        return yp;
    }

    /**
 * Interpoliert die U- und V-Windkomponenten für eine bestimmte Höhe über dem Meeresspiegel.
 * Die Methode verwendet eine zweistufige logarithmische Interpolation:
 * 1. Der Druck auf der Zielhöhe wird durch Interpolation von log(Druck) über der Höhe ermittelt.
 * 2. Die Windkomponenten werden für den ermittelten Druck durch Interpolation über log(Druck) ermittelt.
 * @param {number} z - Die Zielhöhe in Metern über dem Meeresspiegel (AMSL).
 * @param {number[]} pressureLevels - Array der Druckstufen in hPa.
 * @param {number[]} heights - Array der geopotentiellen Höhen in Metern, korrespondierend zu den Druckstufen.
 * @param {number[]} uComponents - Array der U-Windkomponenten (West/Ost).
 * @param {number[]} vComponents - Array der V-Windkomponenten (Süd/Nord).
 * @returns {{u: number, v: number}|{u: string, v: string}} Ein Objekt mit den interpolierten u- und v-Komponenten oder ein Fehlerobjekt.
 */
    static interpolateWindAtAltitude(z, pressureLevels, heights, uComponents, vComponents) {
        if (pressureLevels.length != heights.length || pressureLevels.length != uComponents.length || pressureLevels.length != vComponents.length) {
            return { u: 'Invalid input', v: 'Invalid input' };
        }

        // Step 1: Find p(z) using log interpolation of p with respect to h
        const log_pressureLevels = pressureLevels.map(p => Math.log(p));
        const log_p_z = Utils.linearInterpolate(heights, log_pressureLevels, z);
        if (typeof log_p_z === 'string' && log_p_z.includes('error')) {
            return { u: 'Interpolation error', v: 'Interpolation error' };
        }
        const p_z = Math.exp(log_p_z);

        // Step 2: Interpolate u and v at p(z) using log(p) interpolation
        const u_z = Utils.linearInterpolate(log_pressureLevels, uComponents, Math.log(p_z));
        const v_z = Utils.linearInterpolate(log_pressureLevels, vComponents, Math.log(p_z));
        if (typeof u_z === 'string' && u_z.includes('error') || typeof v_z === 'string' && v_z.includes('error')) {
            return { u: 'Interpolation error', v: 'Interpolation error' };
        }

        return { u: u_z, v: v_z };
    }

    // Interpolate pressure based on height and pressure levels
    static interpolatePressure(height, pressureLevels, heights) {
        if (!pressureLevels || !heights || pressureLevels.length !== heights.length || pressureLevels.length < 2) {
            return 'N/A';
        }

        // Assume pressures and heights are already paired correctly (heights ascending, pressures ascending)
        if (height < heights[0] || height > heights[heights.length - 1]) {
            return 'N/A'; // No extrapolation
        }

        for (let i = 0; i < heights.length - 1; i++) {
            if (height >= heights[i] && height <= heights[i + 1]) {
                const h0 = heights[i], h1 = heights[i + 1];
                const p0 = pressureLevels[i], p1 = pressureLevels[i + 1];
                return p0 + (p1 - p0) * (height - h0) / (h1 - h0);
            }
        }
        return 'N/A';
    };

    /**
     * Führt eine lineare Interpolation für einen gegebenen Wert durch.
     * Findet den korrekten Abschnitt in den Vektordaten und interpoliert linear.
     * Extrapoliert, falls der Wert außerhalb des definierten Bereichs liegt.
     * @param {number[]} xVector - Der Vektor der Stützstellen (z.B. Höhen). Muss sortiert sein (auf- oder absteigend).
     * @param {number[]} yVector - Der Vektor der zu interpolierenden Werte (z.B. Temperaturen).
     * @param {number} xValue - Der Wert, für den ein y-Wert gefunden werden soll.
     * @returns {number|string} Der interpolierte y-Wert oder eine Fehlermeldung als String.
     */
    static linearInterpolate(xVector, yVector, xValue) {
        if (!xVector?.length || !yVector?.length || xVector.length !== yVector.length) {
            return "invalid input for linearInterpolate";
        }
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

    /**
     * Berechnet den mittleren Windvektor über eine definierte Höhenschicht.
     * Nutzt die Trapez-Methode zur Integration der Windkomponenten über die Höhe,
     * um einen präzisen, höhengewichteten Mittelwert zu erhalten.
     * @param {number[]} heights - Array der Höhen-Stützstellen in Metern.
     * @param {number[]} xComponents - Array der U-Windkomponenten.
     * @param {number[]} yComponents - Array der V-Windkomponenten.
     * @param {number} lowerLimit - Die untere Grenze der Schicht in Metern.
     * @param {number} upperLimit - Die obere Grenze der Schicht in Metern.
     * @returns {number[]|null} Ein Array `[Richtung, Geschwindigkeit, u-Komponente, v-Komponente]` oder null bei einem Fehler.
     */
    static calculateMeanWind(heights, xComponents, yComponents, lowerLimit, upperLimit) {
        try {
            if (!heights || !xComponents || !yComponents || heights.length < 2) {
                throw new Error('Invalid input data for calculateMeanWind');
            }
            const dddff = new Array(4);
            let hLayer = [upperLimit];
            let xLayer = [Number(Utils.linearInterpolate(heights, xComponents, upperLimit))];
            let yLayer = [Number(Utils.linearInterpolate(heights, yComponents, upperLimit))];

            const xLower = Number(Utils.linearInterpolate(heights, xComponents, lowerLimit));
            const yLower = Number(Utils.linearInterpolate(heights, yComponents, lowerLimit));

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
        } catch (error) {
            console.error('Error in calculateMeanWind:', error, { heights, xComponents, yComponents, lowerLimit, upperLimit });
            Utils.handleError('Failed to calculate mean wind: ' + error.message);
            return null;
        }
    }

    static locationCache = new Map();
    /**
     * Ruft Zeitzone und Geländehöhe für einen gegebenen Koordinatenpunkt von der Open-Meteo API ab.
     * Die Ergebnisse werden zwischengespeichert (in-memory), um wiederholte API-Anfragen für denselben Ort zu vermeiden.
     * @param {number} lat - Die geographische Breite.
     * @param {number} lng - Die geographische Länge.
     * @returns {Promise<{timezone: string, timezone_abbreviation: string, elevation: number|string}>} Ein Objekt mit den Standortdaten.
     */
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
                timezone: data.timezone || 'GMT', // Fallback to UTC
                timezone_abbreviation: data.timezone_abbreviation || 'GMT', // Fallback to UTC
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
        // Die Prüfung und die Deklaration sind nicht mehr nötig.
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
        const radians = Math.abs(Math.asin(crosswind / trueAirspeed));
        const wca = radians * (180 / Math.PI);
        return isNaN(wca) ? 0 : wca; // Negative if wind from left, positive if from right
    }

    /**
     * Calculate ground speed
     */
    static calculateGroundSpeed(trueAirspeed, headwind) {
        return trueAirspeed - headwind;
    }

    static calculateCourseFromHeading(trueHeading, windDirection, windSpeed, trueAirspeed) {
        // Wind angle relative to heading
        const windAngle = Utils.calculateWindAngle(trueHeading, windDirection);
        const { crosswind, headwind } = Utils.calculateWindComponents(windSpeed, windAngle);

        // TAS vector
        const tasU = trueAirspeed * Math.sin(trueHeading * Math.PI / 180);
        const tasV = trueAirspeed * Math.cos(trueHeading * Math.PI / 180);

        // Wind vector (direction wind is going *to*)
        const windTo = (windDirection + 180) % 360;
        const windU = windSpeed * Math.sin(windTo * Math.PI / 180);
        const windV = windSpeed * Math.cos(windTo * Math.PI / 180);

        // Ground speed vector
        const gsU = tasU + windU;
        const gsV = tasV + windV;

        // True Course
        const trueCourse = Math.atan2(gsU, gsV) * (180 / Math.PI);
        const normalizedCourse = Utils.normalizeAngle(trueCourse);

        // Ground Speed
        const groundSpeed = Math.sqrt(gsU * gsU + gsV * gsV);

        // WCA (for reference)
        const wca = Utils.calculateWCA(crosswind, trueAirspeed) * (crosswind < 0 ? -1 : 1);

        return {
            trueCourse: Number(normalizedCourse.toFixed(2)),
            groundSpeed: Number(groundSpeed.toFixed(2)),
            wca: Number(wca.toFixed(2)),
            crosswind: Number(crosswind.toFixed(2)),
            headwind: Number(headwind.toFixed(2))
        };
    }

    /**
     * Berechnet wesentliche Flugparameter wie Seitenwind, Gegenwind und den Windkorrekturwinkel (WCA).
     * Diese Funktion ist ein Wrapper, der die Berechnungen für Windwinkel und -komponenten zusammenfasst.
     * @param {number} trueCourse - Der wahre Kurs des Flugzeugs in Grad.
     * @param {number} windDirection - Die Richtung, aus der der Wind kommt, in Grad.
     * @param {number} windSpeed - Die Windgeschwindigkeit. Die Einheit muss mit der von `trueAirspeed` übereinstimmen.
     * @param {number} trueAirspeed - Die wahre Eigengeschwindigkeit des Flugzeugs.
     * @returns {{crosswind: number, headwind: number, wca: number, groundSpeed: number}} Ein Objekt mit den berechneten Flugparametern.
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
        if (typeof displayError === 'function') {
            displayError(message);
        } else {
            // Dieser Fall sollte nun seltener eintreten
            console.warn('Utils.js: displayError function is not available, logging to console only.');
            console.error('Error message:', message);
        }
    }

    static dmsToDecimal(deg, min, sec, dir) {
        if (isNaN(deg) || isNaN(min) || isNaN(sec) || !dir) {
            console.warn('Invalid DMS inputs:', { deg, min, sec, dir });
            throw new Error('Invalid DMS values');
        }
        let decimal = deg + (min / 60) + (sec / 3600);
        if (dir === 'S' || dir === 'W') {
            decimal = -decimal;
        }
        if (isNaN(decimal)) {
            console.warn('DMS to decimal conversion failed:', { deg, min, sec, dir });
            throw new Error('Failed to convert DMS to decimal');
        }
        return decimal;
    }

    static decimalToDms(decimal, isLat) {
        if (isNaN(decimal) || decimal === null || decimal === undefined) {
            console.warn('Invalid decimal value for DMS conversion:', decimal);
            throw new Error('Invalid coordinate for DMS conversion');
        }
        const absolute = Math.abs(decimal);
        const deg = Math.floor(absolute);
        const min = Math.floor((absolute - deg) * 60);
        const sec = ((absolute - deg) * 3600) - (min * 60);
        const dir = isLat ? (decimal >= 0 ? 'N' : 'S') : (decimal >= 0 ? 'E' : 'W');

        if (isNaN(deg) || isNaN(min) || isNaN(sec)) {
            console.warn('DMS calculation resulted in invalid values:', { deg, min, sec });
            throw new Error('Failed to convert to DMS');
        }

        return {
            deg,
            min,
            sec,
            dir
        };
    }

    static decimalToMgrs(lat, lng) {
        try {
            return mgrs.forward([lng, lat]); // Note: mgrs.forward takes [lon, lat]
        } catch (e) {
            console.error('Error converting to MGRS:', e);
            return 'Invalid MGRS';
        }
    }

    static mgrsToDecimal(mgrsStr) {
        try {
            const [lng, lat] = mgrs.toPoint(mgrsStr);
            return { lat, lng };
        } catch (e) {
            console.error('Error converting MGRS to decimal:', e);
            return null;
        }
    }

    static convertCoords(lat, lng, format = 'Decimal') {
        if (lat === null || lng === null || lat === undefined || lng === undefined) {
            return { lat: 'N/A', lng: 'N/A' };
        }

        const result = {
            Decimal: { lat: lat.toFixed(6), lng: lng.toFixed(6) },
            DMS: {
                lat: Utils.decimalToDms(lat, true),
                lng: Utils.decimalToDms(lng, false)
            },
            MGRS: Utils.decimalToMgrs(lat, lng)
        };

        // Return based on the requested format
        switch (format) {
            case 'DMS':
                return result.DMS;
            case 'MGRS':
                return { lat: result.MGRS, lng: result.MGRS }; // MGRS is a single string, duplicated for consistency
            case 'Decimal':
            default:
                return result.Decimal;
        }
    }

/**
 * Berechnet die wahre Fluggeschwindigkeit (True Airspeed, TAS) aus der angezeigten
 * Fluggeschwindigkeit (Indicated Airspeed, IAS) und der Höhe.
 * Verwendet ein vereinfachtes Modell der internationalen Standardatmosphäre (ISA).
 * @param {number} ias - Die angezeigte Fluggeschwindigkeit (z.B. in Knoten).
 * @param {number} heightFt - Die Höhe über dem Meeresspiegel in Fuß.
 * @returns {number|string} Die berechnete TAS in der gleichen Einheit wie IAS, oder 'N/A' bei ungültigen Eingaben.
 */    static calculateTAS(ias, heightFt) {
        if (isNaN(ias) || isNaN(heightFt) || ias < 0 || heightFt < 0) {
            console.warn('Invalid inputs for calculateTAS:', { ias, heightFt });
            return 'N/A';
        }

        const seaLevelDensity = ISA_CONSTANTS.SEA_LEVEL_DENSITY;
        const lapseRate = ISA_CONSTANTS.LAPSE_RATE;
        const seaLevelTemp = ISA_CONSTANTS.SEA_LEVEL_TEMP_KELVIN;
        const gravity = ISA_CONSTANTS.GRAVITY;
        const gasConstant = ISA_CONSTANTS.GAS_CONSTANT_AIR;
        const metersPerFoot = CONVERSIONS.FEET_TO_METERS;

        const heightM = heightFt * metersPerFoot;
        const tempAtAltitude = seaLevelTemp - lapseRate * heightM;
        const tempRatio = tempAtAltitude / seaLevelTemp;

        // Simplified density ratio: (1 - L*h/T0)^(g/(L*R) - 1)
        const base = 1 - (lapseRate * heightM) / seaLevelTemp;
        const exponent = (gravity / (lapseRate * gasConstant)) - 1;
        const densityRatio = Math.pow(base, exponent);
        const tas = ias / Math.sqrt(densityRatio);

        console.log('calculateTAS debug:', {
            ias,
            heightFt,
            heightM,
            tempAtAltitude,
            tempRatio,
            base,
            exponent,
            densityRatio,
            tas,
            tasRounded: Number(tas.toFixed(2))
        });

        return Number(tas.toFixed(2));
    }

    static calculateTASFromGroundSpeed(groundSpeed, windSpeed, windDirection, trueCourse, heightFt) {
        if (isNaN(groundSpeed) || isNaN(windSpeed) || isNaN(windDirection) || isNaN(trueCourse)) {
            return 'N/A';
        }
        const groundSpeedKts = Utils.convertWind(groundSpeed, 'kt', 'm/s');
        const windSpeedKts = Utils.convertWind(windSpeed, 'kt', 'm/s');
        const windAngle = Utils.calculateWindAngle(trueCourse, windDirection);
        const { crosswind, headwind } = Utils.calculateWindComponents(windSpeedKts, windAngle);
        const tasKts = groundSpeedKts + headwind;
        const tasAdjusted = Utils.calculateTAS(tasKts, heightFt);
        return Number(tasAdjusted.toFixed(1));
    }

    static handleMessage(message) {
        const infoDiv = document.getElementById('info');
        if (infoDiv) {
            infoDiv.textContent = message;
            infoDiv.style.display = 'block';
            setTimeout(() => {
                infoDiv.style.display = 'none';
            }, 3000); // Hide after 3 seconds
            console.log('Displayed message:', message);
        } else {
            console.warn('Info div not found for handleMessage, using alert');
            alert(message);
        }
    }

    /**
     * Berechnet den QFE-Druck (Druck auf einer bestimmten Höhe) mithilfe der barometrischen Höhenformel.
     * @param {number} surfacePressure - Der Referenzdruck in hPa (z.B. QNH).
     * @param {number} elevation - Die Zielhöhe in Metern, für die der Druck berechnet werden soll.
     * @param {number} referenceElevation - Die Höhe in Metern, auf die sich der `surfacePressure` bezieht.
     * @param {number} [temperature=15] - Die Temperatur in Grad Celsius (optional, Standard ist 15°C).
     * @returns {number|string} Der berechnete QFE-Druck in hPa oder 'N/A'.
     */
    static calculateQFE(surfacePressure, elevation, referenceElevation, temperature = 15) {
        if (!surfacePressure || elevation === 'N/A' || referenceElevation === 'N/A' || isNaN(surfacePressure) || isNaN(elevation) || isNaN(referenceElevation)) {
            return 'N/A';
        }
        console.log('QFE reference elevation: ', referenceElevation);
        // Constants for barometric formula
        const g = ISA_CONSTANTS.GRAVITY; // Gravitational acceleration (m/s²)
        const M = PHYSICAL_CONSTANTS.MOLAR_MASS_AIR; // Molar mass of air (kg/mol)
        const R = PHYSICAL_CONSTANTS.UNIVERSAL_GAS_CONSTANT; // Universal gas constant (J/(mol·K))
        const T = temperature + CONVERSIONS.CELSIUS_TO_KELVIN; // Temperature in Kelvin
        const L = ISA_CONSTANTS.LAPSE_RATE; // Standard temperature lapse rate (K/m)

        // Calculate pressure at target elevation relative to reference elevation
        const P0 = surfacePressure * 100; // Convert hPa to Pa
        const h = elevation - referenceElevation; // Elevation difference in meters
        const exponent = (g * M) / (R * L);
        const qfePa = P0 * Math.pow(1 - (L * h) / T, exponent);

        console.log(surfacePressure, elevation, referenceElevation);
        // Convert back to hPa and round to nearest integer
        const qfe = Math.round(qfePa / 100);
        return isNaN(qfe) ? 'N/A' : qfe;
    }

    static calculateNewCenter(lat, lng, distance, bearing) {
        const R = EARTH_RADIUS_METERS; // Earth's radius in meters
        const lat1 = lat * Math.PI / 180; // Convert to radians
        const lng1 = lng * Math.PI / 180;
        const bearingRad = bearing * Math.PI / 180; // Wind FROM direction

        const delta = distance / R; // Angular distance

        const lat2 = Math.asin(Math.sin(lat1) * Math.cos(delta) +
            Math.cos(lat1) * Math.sin(delta) * Math.cos(bearingRad));
        const lng2 = lng1 + Math.atan2(Math.sin(bearingRad) * Math.sin(delta) * Math.cos(lat1),
            Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2));

        // Convert back to degrees
        const newLat = lat2 * 180 / Math.PI;
        const newLng = lng2 * 180 / Math.PI;

        // Normalize longitude to [-180, 180]
        const normalizedLng = ((newLng + 540) % 360) - 180;

        return [newLat, normalizedLng];
    }

    static debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    static calculateBearing(lat1, lng1, lat2, lng2) {
        const toRad = deg => deg * Math.PI / 180;
        const toDeg = rad => rad * 180 / Math.PI;

        const dLon = toRad(lng2 - lng1);
        const y = Math.sin(dLon) * Math.cos(toRad(lat2));
        const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
        let bearing = toDeg(Math.atan2(y, x));
        bearing = (bearing + 360) % 360; // Normalize to 0-360
        return bearing;
    }

    static async getAltitude(lat, lng) {
        const { elevation } = await Utils.getLocationData(lat, lng);
        console.log('Fetched elevation from Open-Meteo:', elevation);
        return elevation !== 'N/A' ? elevation : 'N/A';
    }

    static getLastFullHourUTC() {
        const now = new Date();
        const utcYear = now.getUTCFullYear();
        const utcMonth = now.getUTCMonth();
        const utcDate = now.getUTCDate();
        const utcHour = now.getUTCHours();
        const lastFullHour = new Date(Date.UTC(utcYear, utcMonth, utcDate, utcHour, 0, 0));
        console.log('Last full hour UTC:', lastFullHour.toISOString());
        return lastFullHour; // Return Date object instead of string
    }

    static async getDisplayTime(utcTimeStr, lat, lng) {
        const timeZone = document.querySelector('input[name="timeZone"]:checked')?.value || 'Z';
        if (timeZone === 'Z' || !lat || !lng) {
            return Utils.formatTime(utcTimeStr); // Synchronous
        } else {
            return await Utils.formatLocalTime(utcTimeStr, lat, lng); // Async
        }
    }

    static calculateDynamicRadius(baseRadius = ENSEMBLE_VISUALIZATION.HEATMAP_SCALING_BASE, referenceZoom = ENSEMBLE_VISUALIZATION.HEATMAP_REFERENCE_ZOOM) {
        const currentZoom = AppState.map.getZoom();
        // NEU: Anstatt der festen "2" verwenden wir eine anpassbare Basis.
        // Ein Wert um 1.6 ist oft ein guter Kompromiss.
        // - Näher an 1: Sanftere Skalierung
        // - Näher an 2: Aggressivere Skalierung
        const scalingBase = ENSEMBLE_VISUALIZATION.HEATMAP_SCALING_BASE || 1.6; // Fallback auf 1.6, wenn nicht definiert

        const scaleFactor = Math.pow(scalingBase, currentZoom - referenceZoom);
        const dynamicRadius = baseRadius * scaleFactor;
        // Clamp radius to reasonable bounds to avoid extreme values
        const minRadius = ENSEMBLE_VISUALIZATION.HEATMAP_MIN_RADIUS_PX;  // Minimum radius to avoid disappearing at high zooms
        const maxRadius = ENSEMBLE_VISUALIZATION.HEATMAP_MAX_RADIUS_PX; // Maximum radius to avoid excessive spread at low zooms
        const adjustedRadius = Math.max(minRadius, Math.min(maxRadius, dynamicRadius));
        console.log('[calculateDynamicRadius] Calculated dynamic radius:', { currentZoom, baseRadius, scaleFactor, dynamicRadius, adjustedRadius });
        return adjustedRadius;
    }

    // Maps an AGL height to a color gradient (red -> yellow -> green)
    static interpolateColor(aglHeight, minHeight = 0, maxHeight = 3000) {
        const ratio = Math.min(Math.max((aglHeight - minHeight) / (maxHeight - minHeight), 0), 1);
        if (aglHeight < 0 || isNaN(aglHeight)) return '#808080'; // Gray for invalid/negative heights
        if (ratio <= 0.5) {
            // Red (#FF0000) to Yellow (#FFFF00)
            const r = 255;
            const g = Math.round(255 * (ratio * 2));
            const b = 0;
            return `rgb(${r}, ${g}, ${b})`;
        } else {
            // Yellow (#FFFF00) to Green (#00FF00)
            const r = Math.round(255 * (1 - (ratio - 0.5) * 2));
            const g = 255;
            const b = 0;
            return `rgb(${r}, ${g}, ${b})`;
        }
    }

    // Generates a wind barb icon for weather table
    static generateWindBarb(direction, speedKt, latitude = null) {
        // Convert speed to knots if not already (assuming speedKt is in knots)
        const speed = Math.round(speedKt);

        // SVG dimensions
        const width = 40;
        const height = 40;
        const centerX = width / 2;
        const centerY = height / 2;
        const staffLength = 20;

        // Determine hemisphere based on latitude (default to Northern if undefined)
        const isNorthernHemisphere = typeof latitude === 'number' && !isNaN(latitude) ? latitude >= 0 : true;
        const barbSide = isNorthernHemisphere ? -1 : 1; // -1 for left (Northern), 1 for right (Southern)

        // Calculate barb components
        let flags = Math.floor(speed / 50); // 50 kt flags
        let remaining = speed % 50;
        let fullBarbs = Math.floor(remaining / 10); // 10 kt full barbs
        let halfBarbs = Math.floor((remaining % 10) / 5); // 5 kt half barbs

        // Adjust for small speeds
        if (speed < 5) {
            fullBarbs = 0;
            halfBarbs = 0;
        } else if (speed < 10 && halfBarbs > 0) {
            halfBarbs = 1; // Ensure at least one half barb for 5-9 kt
        }

        // Start SVG
        let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;

        // Rotate based on wind direction (wind *from* direction)
        const rotation = direction + 180; // Staff points toward wind source (tip at origin)
        svg += `<g transform="translate(${centerX}, ${centerY}) rotate(${rotation})">`;

        // Draw the staff (vertical line, base at bottom, tip at top toward the source)
        svg += `<line x1="0" y1="${staffLength / 2}" x2="0" y2="${-staffLength / 2}" stroke="black" stroke-width="1"/>`;

        // Draw barbs on the appropriate side, at the base of the staff
        let yPos = staffLength / 2; // Start at the base (wind blowing toward this end)
        const barbSpacing = 4;

        // Flags (50 kt) - Triangle with side attached to staff, pointing to the correct side
        for (let i = 0; i < flags; i++) {
            svg += `<polygon points="0,${yPos - 5} 0,${yPos + 5} ${10 * barbSide},${yPos}" fill="black"/>`;
            yPos -= barbSpacing + 5; // Move up the staff (toward the tip)
        }

        // Full barbs (10 kt) - Straight to the correct side (perpendicular)
        for (let i = 0; i < fullBarbs; i++) {
            svg += `<line x1="0" y1="${yPos}" x2="${10 * barbSide}" y2="${yPos}" stroke="black" stroke-width="1"/>`;
            yPos -= barbSpacing;
        }

        // Half barbs (5 kt) - Straight to the correct side (perpendicular)
        if (halfBarbs > 0) {
            svg += `<line x1="0" y1="${yPos}" x2="${5 * barbSide}" y2="${yPos}" stroke="black" stroke-width="1"/>`;
        }

        // Circle for calm winds (< 5 kt)
        if (speed < 5) {
            svg += `<circle cx="0" cy="0" r="3" fill="none" stroke="black" stroke-width="1"/>`;
        }

        svg += `</g></svg>`;
        return svg;
    }

    // Neue Setup-Funktionen
    static setErrorHandler(handler) {
        customErrorHandler = handler;
    }

    static setMessageHandler(handler) {
        customMessageHandler = handler;
    }

    static handleError(message, log = true) {
        if (log) console.error(message);
        // Ruft den registrierten Handler auf
        if (typeof customErrorHandler === 'function') {
            customErrorHandler(message);
        }
    }

    static handleMessage(message) {
        // Ruft den registrierten Handler auf
        if (typeof customMessageHandler === 'function') {
            customMessageHandler(message);
        } else {
            console.log(message);
        }
    }
}

window.Utils = Utils;