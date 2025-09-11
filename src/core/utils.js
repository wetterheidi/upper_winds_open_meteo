/**
 * @file utils.js
 * @description Enthält eine Sammlung von Hilfsfunktionen (Utilities), die in der gesamten
 * Anwendung für Berechnungen, Konvertierungen und andere wiederkehrende Aufgaben verwendet werden.
 */

import { DateTime } from 'luxon';
import * as mgrs from 'mgrs';
import { AppState } from './state.js';
import { CONVERSIONS, ISA_CONSTANTS, DEWPOINT_COEFFICIENTS, EARTH_RADIUS_METERS, PHYSICAL_CONSTANTS, BEAUFORT, ENSEMBLE_VISUALIZATION } from './constants.js';
import { Settings } from "./settings.js";

// Private Variablen für das Handler-System
let customErrorHandler = console.error;
let customMessageHandler = console.log;

export class Utils {

    // ===================================================================
    // 1. Setup für Fehler- & Nachrichtenbehandlung
    // ===================================================================

    /**
     * Registriert eine globale Funktion zur Behandlung von Fehlermeldungen.
     * @param {function(string): void} handler - Die Funktion, die eine Fehlermeldung anzeigt.
     */
    static setErrorHandler(handler) {
        customErrorHandler = handler;
    }

    /**
     * Registriert eine globale Funktion zur Anzeige von allgemeinen Nachrichten.
     * @param {function(string): void} handler - Die Funktion, die eine Nachricht anzeigt.
     */
    static setMessageHandler(handler) {
        customMessageHandler = handler;
    }

    /**
     * Leitet eine Fehlermeldung an den registrierten Handler weiter.
     * @param {string} message - Die Fehlermeldung.
     * @param {boolean} [log=true] - Ob die Meldung zusätzlich in der Konsole ausgegeben werden soll.
     */
    static handleError(message, log = true) {
        if (log) console.error(message);
        // Ruft den registrierten Handler auf
        if (typeof customErrorHandler === 'function') {
            customErrorHandler(message);
        }
    }

    /**
     * Leitet eine allgemeine Nachricht an den registrierten Handler weiter.
     * @param {string} message - Die anzuzeigende Nachricht.
     */
    static handleMessage(message) {
        // Ruft den registrierten Handler auf
        if (typeof customMessageHandler === 'function') {
            customMessageHandler(message);
        } else {
            console.log(message);
        }
    }

    /*    static handleError(message, log = true) {
            if (log) console.error(message);
            if (typeof displayError === 'function') {
                displayError(message);
            } else {
                // Dieser Fall sollte nun seltener eintreten
                console.warn('Utils.js: displayError function is not available, logging to console only.');
                console.error('Error message:', message);
            }
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
        } */

    // ===================================================================
    // 2. Einheitenumrechnungen
    // ===================================================================

    /**
     * Rechnet eine Höhe um (Meter <-> Fuss).
     * @param {number|string} value - Der Höhenwert in Metern.
     * @param {'m'|'ft'} toUnit - Die Zieleinheit.
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
     * Rechnet Meter in Fuss um.
     * @param {number|null|undefined} feet - Der Wert in Fuss.
     * @returns {number} Der umgerechnete Wert in Metern, oder 0 bei ungültiger Eingabe.
     */
    static convertFeetToMeters(feet) {
        if (feet === null || feet === undefined || isNaN(feet)) {
            return 0;
        }
        return feet / 3.28084;
    }

    /**
     * Rechnet eine Temperatur um (Celsius <-> Fahrenheit).
     * @param {number|string} value - Der Temperaturwert in Celsius.
     * @param {'°C'|'°F'} toUnit - Die Zieleinheit.
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
     * Rechnet Windgeschwindigkeiten zwischen verschiedenen Einheiten um.
     * @param {number|string} value - Der Geschwindigkeitswert.
     * @param {'km/h'|'m/s'|'kt'|'mph'|'bft'} toUnit - Die Zieleinheit.
     * @param {'km/h'|'m/s'|'kt'|'mph'|'bft'} [fromUnit='km/h'] - Die Ausgangseinheit.
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

    /** Wandelt Knoten in Beaufort um. @private */
    static knotsToBeaufort(knots) {
        // Finde den ersten Schwellenwert, der größer ist als die Knotengeschwindigkeit
        const beaufortLevel = BEAUFORT.KNOT_THRESHOLDS.findIndex(threshold => knots < threshold);
        // Wenn kein Wert gefunden wird (stärker als 63 Knoten), ist es Stufe 12. Sonst ist es der gefundene Index.
        return beaufortLevel === -1 ? 12 : beaufortLevel;
    }

    /** Wandelt Beaufort in Knoten um. @private */
    static beaufortToKnots(bft) {
        return BEAUFORT.BEAUFORT_THRESHOLDS[bft] || 63; // Default to max if bft > 12
    }

    /**
     * Normalisiert einen Winkel auf den Bereich 0-360 Grad.
     * @param {number} angle - Der zu normalisierende Winkel.
     * @returns {number} Der normalisierte Winkel.
    */
    static normalizeAngle(angle) {
        return (angle % 360 + 360) % 360;
    }

    // ===================================================================
    // 3. Meteorologische Berechnungen
    // ===================================================================

    /**
     * Berechnet den Taupunkt anhand von Temperatur und relativer Luftfeuchtigkeit.
     * @param {number} temp - Die Temperatur in Grad Celsius.
     * @param {number} rh - Die relative Luftfeuchtigkeit in Prozent (z.B. 75).
     * @returns {number|null} Der berechnete Taupunkt in Grad Celsius.
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

    /**
     * Berechnet den QFE-Druck (Druck auf einer bestimmten Höhe) mithilfe der barometrischen Höhenformel.
     * @param {number} surfacePressure - Der Referenzdruck in hPa (z.B. QNH).
     * @param {number} elevation - Die Zielhöhe in Metern.
     * @param {number} referenceElevation - Die Höhe in Metern, auf die sich `surfacePressure` bezieht.
     * @param {number} [temperature=15] - Die Temperatur in Grad Celsius.
     * @returns {number|string} Der berechnete QFE-Druck in hPa oder 'N/A'.
     */
    static calculateQFE(surfacePressure, elevation, referenceElevation, temperature = 15) {
        if (!surfacePressure || elevation === 'N/A' || referenceElevation === 'N/A' || isNaN(surfacePressure) || isNaN(elevation) || isNaN(referenceElevation)) {
            return 'N/A';
        }
        //console.log('QFE reference elevation: ', referenceElevation);
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

        //console.log(surfacePressure, elevation, referenceElevation);
        // Convert back to hPa and round to nearest integer
        const qfe = Math.round(qfePa / 100);
        return isNaN(qfe) ? 'N/A' : qfe;
    }

    /**
     * Führt eine lineare Interpolation für einen gegebenen Wert durch.
     * @param {number[]} xVector - Der Vektor der Stützstellen (z.B. Höhen). Muss sortiert sein.
     * @param {number[]} yVector - Der Vektor der zu interpolierenden Werte (z.B. Temperaturen).
     * @param {number} xValue - Der Wert, für den ein y-Wert gefunden werden soll.
     * @returns {number|string} Der interpolierte y-Wert oder eine Fehlermeldung.
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

    /**
     * Führt eine gewichtete Interpolation zwischen zwei Punkten durch.
     * @param {number} y1 - Wert am Punkt 1.
     * @param {number} y2 - Wert am Punkt 2.
     * @param {number} h1 - Position von Punkt 1 (z.B. Höhe).
     * @param {number} h2 - Position von Punkt 2.
     * @param {number} hp - Position des zu interpolierenden Punktes.
     * @returns {number} Der interpolierte Wert.
     */
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

    /**
     * Interpoliert den Luftdruck für eine gegebene Höhe basierend auf bekannten Druckleveln.
     * @param {number} height - Die Zielhöhe in Metern.
     * @param {number[]} pressureLevels - Array der bekannten Druckstufen in hPa.
     * @param {number[]} heights - Array der zugehörigen Höhen in Metern.
     * @returns {number|string} Der interpolierte Druck in hPa oder 'N/A'.
     */
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
     * Berechnet die Windgeschwindigkeit aus U- und V-Komponenten.
     * @param {number} x - Die U-Komponente (West/Ost).
     * @param {number} y - Die V-Komponente (Süd/Nord).
     * @returns {number} Die resultierende Windgeschwindigkeit.
     */
    static windSpeed(x, y) {
        return Math.sqrt(x * x + y * y);
    }

    /**
     * Berechnet die Windrichtung aus U- und V-Komponenten (meteorologische Konvention).
     * @param {number} u - Die U-Komponente.
     * @param {number} v - Die V-Komponente.
     * @returns {number} Die Windrichtung in Grad (0-360).
     */
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

    // ===================================================================
    // 4. Flugphysik & Wind-Dreieck
    // ===================================================================

    /**
     * Berechnet die wahre Fluggeschwindigkeit (True Airspeed, TAS) aus der angezeigten
     * Fluggeschwindigkeit (Indicated Airspeed, IAS) und der Höhe.
     * @param {number} ias - Die angezeigte Fluggeschwindigkeit (z.B. in Knoten).
     * @param {number} heightFt - Die Höhe über dem Meeresspiegel in Fuss.
     * @returns {number|string} Die berechnete TAS in der gleichen Einheit wie IAS, oder 'N/A'.
     */
    static calculateTAS(ias, heightFt) {
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

    /**
 * Schätzt die TAS basierend auf der Groundspeed und den Windverhältnissen.
 * @param {number} groundSpeed - Geschwindigkeit über Grund in m/s.
 * @param {number} windSpeed - Windgeschwindigkeit in m/s.
 * @param {number} windDirection - Windrichtung in Grad.
 * @param {number} trueCourse - Wahrer Kurs in Grad.
 * @param {number} heightFt - Höhe in Fuss.
 * @returns {number|string} Die geschätzte TAS oder 'N/A'.
 */
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

    /**
     * Berechnet wesentliche Flugparameter wie Seitenwind, Gegenwind und Windkorrekturwinkel (WCA).
     * @param {number} trueCourse - Der wahre Kurs des Flugzeugs in Grad.
     * @param {number} windDirection - Die Richtung, aus der der Wind kommt, in Grad.
     * @param {number} windSpeed - Die Windgeschwindigkeit (gleiche Einheit wie trueAirspeed).
     * @param {number} trueAirspeed - Die wahre Eigengeschwindigkeit des Flugzeugs.
     * @returns {{crosswind: number, headwind: number, wca: number, groundSpeed: number}}
     */
    static calculateFlightParameters(trueCourse, windDirection, windSpeed, trueAirspeed) {
        const windAngle = Utils.calculateWindAngle(trueCourse, windDirection);
        const { crosswind, headwind } = Utils.calculateWindComponents(windSpeed, windAngle);
        const wca = Utils.calculateWCA(crosswind, trueAirspeed);
        const groundSpeed = trueAirspeed > Math.abs(crosswind)
            ? Math.sqrt(Math.pow(trueAirspeed, 2) - Math.pow(crosswind, 2)) - headwind
            : -headwind; // Wenn der Seitenwind zu stark ist, bewegt man sich nur mit dem Gegenwind rückwärts.

        return {
            crosswind: Number(crosswind.toFixed(2)),
            headwind: Number(headwind.toFixed(2)),
            wca: Number(wca.toFixed(2)),
            groundSpeed: Number(groundSpeed.toFixed(2))
        };
    }

    /**
     * Berechnet den Winkel zwischen Flugkurs und Windrichtung.
     * @param {number} trueCourse - Der wahre Kurs in Grad.
     * @param {number} windDirection - Die Windrichtung in Grad.
     * @returns {number} Der Windwinkel (-180 bis 180 Grad).
     */
    static calculateWindAngle(trueCourse, windDirection) {
        let angle = Utils.normalizeAngle(windDirection - trueCourse);
        if (angle > 180) angle -= 360; // -180 to 180
        return angle;
    }

    /**
     * Zerlegt den Wind in Seiten- und Gegenwindkomponenten.
     * @param {number} windSpeed - Die gesamte Windgeschwindigkeit.
     * @param {number} windAngle - Der Windwinkel relativ zum Kurs.
     * @returns {{crosswind: number, headwind: number}}
     */
    static calculateWindComponents(windSpeed, windAngle) {
        const radians = windAngle * (Math.PI / 180);
        const crosswind = windSpeed * Math.sin(radians); // Positive = right, negative = left
        const headwind = windSpeed * Math.cos(radians);  // Positive = headwind, negative = tailwind
        return { crosswind, headwind };
    }

    /**
     * Berechnet den Wind Correction Angle (WCA).
     * @param {number} crosswind - Die Seitenwindkomponente.
     * @param {number} trueAirspeed - Die wahre Eigengeschwindigkeit.
     * @returns {number} Der WCA in Grad.
     */
    static calculateWCA(crosswind, trueAirspeed) {
        const radians = Math.abs(Math.asin(crosswind / trueAirspeed));
        const wca = radians * (180 / Math.PI);
        return isNaN(wca) ? 0 : wca; // Negative if wind from left, positive if from right
    }

    /**
 * Berechnet den wahren Kurs und die Groundspeed aus dem Steuerkurs und den Winddaten.
 * @param {number} trueHeading - Der Steuerkurs (Heading) in Grad.
 * @param {number} windDirection - Windrichtung in Grad.
 * @param {number} windSpeed - Windgeschwindigkeit.
 * @param {number} trueAirspeed - Wahre Eigengeschwindigkeit.
 * @returns {object} Ein Objekt mit `trueCourse`, `groundSpeed`, `wca` etc.
 */
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
 * Überprüft, ob die eingegebenen Höhen für das Landemuster logisch sind.
 * @param {HTMLInputElement} final - Das Input-Element für die Final-Höhe.
 * @param {HTMLInputElement} base - Das Input-Element für die Base-Höhe.
 * @param {HTMLInputElement} downwind - Das Input-Element für die Downwind-Höhe.
 * @returns {boolean} True, wenn die Höhen gültig sind.
 */
    static validateLegHeights(final, base, downwind) {
        const finalVal = parseInt(final.value) || 100;
        const baseVal = parseInt(base.value) || 200;
        const downwindVal = parseInt(downwind.value) || 300;

        if (baseVal <= finalVal) {
            Utils.handleError('Base leg must start higher than final leg.');
            return false;
        }
        if (downwindVal <= baseVal) {
            Utils.handleError('Downwind leg must start higher than base leg.');
            return false;
        }
        return true;
    }

    // ===================================================================
    // 5. Koordinaten- & Geospatial-Funktionen
    // ===================================================================

    /**
     * Konvertiert Koordinaten zwischen Dezimalgrad, DMS (Grad, Minuten, Sekunden) und MGRS.
     * @param {number} lat - Breite.
     * @param {number} lng - Länge.
     * @param {'Decimal'|'DMS'|'MGRS'} [format='Decimal'] - Das Zielformat.
     * @returns {object|string} Die konvertierten Koordinaten.
     */
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

    /** Konvertiert Dezimalgrad in DMS. @private */
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

    /** Konvertiert DMS in Dezimalgrad. @private */
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

    /** Konvertiert Dezimalgrad in MGRS. @private */
    static decimalToMgrs(lat, lng) {
        try {
            return mgrs.forward([lng, lat]); // Note: mgrs.forward takes [lon, lat]
        } catch (e) {
            console.error('Error converting to MGRS:', e);
            return 'Invalid MGRS';
        }
    }

    /** Konvertiert MGRS in Dezimalgrad. @private */
    static mgrsToDecimal(mgrsStr) {
        try {
            const [lng, lat] = mgrs.toPoint(mgrsStr);
            return { lat, lng };
        } catch (e) {
            console.error('Error converting MGRS to decimal:', e);
            return null;
        }
    }

    /**
     * Berechnet einen neuen Koordinatenpunkt basierend auf einem Startpunkt, einer Distanz und einer Richtung.
     * @param {number} lat - Start-Breite.
     * @param {number} lng - Start-Länge.
     * @param {number} distance - Distanz in Metern.
     * @param {number} bearing - Richtung in Grad.
     * @returns {[number, number]} Ein Array mit [newLat, newLng].
     */
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

    static locationCache = new Map();

    /**
     * Berechnet die Peilung (Bearing) von Punkt 1 zu Punkt 2.
     * @param {number} lat1 - Breite von Punkt 1.
     * @param {number} lng1 - Länge von Punkt 1.
     * @param {number} lat2 - Breite von Punkt 2.
     * @param {number} lng2 - Länge von Punkt 2.
     * @returns {number} Die Peilung in Grad.
     */
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
            if (!response.ok) {
                if (response.status === 429) {
                    // Hier reicht eine Konsolennachricht, da es keine kritische Funktion ist
                    console.warn('API rate limit hit while fetching location data.');
                }
                throw new Error(`Open-Meteo fetch failed: ${response.status}`);
            }
            const data = await response.json();
            const locationData = {
                timezone: data.timezone || 'GMT', // Fallback to UTC
                timezone_abbreviation: data.timezone_abbreviation || 'GMT', // Fallback to UTC
                elevation: data.elevation !== undefined ? data.elevation : 'N/A'
            };
            Utils.locationCache.set(cacheKey, locationData);
            //console.log(`Fetched location data for ${cacheKey}:`, locationData);
            return locationData;
        } catch (error) {
            console.error('Error fetching location data:', error.message);
            return { timezone: 'UTC', elevation: 'N/A' }; // Fallback
        }
    }

    /**
     * Prüft, ob die übergebenen Werte gültige geographische Koordinaten sind.
     * @param {number} lat - Die geographische Breite.
     * @param {number} lng - Die geographische Länge.
     * @returns {boolean} True, wenn die Koordinaten gültig sind.
     */
    static isValidLatLng(lat, lng) {
        return (
            typeof lat === 'number' &&
            typeof lng === 'number' &&
            !isNaN(lat) && !isNaN(lng) &&
            lat >= -90 && lat <= 90 &&
            lng >= -180 && lng <= 180 &&
            !(lat === 0 && lng === 0) // Verhindert ungültige Null-Koordinaten
        );
    }

    /**
     * Ruft die Geländehöhe für Koordinaten ab (Wrapper für getLocationData).
     * @param {number} lat - Breite.
     * @param {number} lng - Länge.
     * @returns {Promise<number|string>} Die Höhe in Metern oder 'N/A'.
     */
    static async getAltitude(lat, lng) {
        const { elevation } = await Utils.getLocationData(lat, lng);
        //console.log('Fetched elevation from Open-Meteo:', elevation);
        return elevation !== 'N/A' ? elevation : 'N/A';
    }

    // ===================================================================
    // 6. Allgemeine Hilfs- & UI-Funktionen
    // ===================================================================

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
     * Formatiert einen UTC-Zeitstempel in die lokale Zeit des angegebenen Ortes.
     * @param {string} utcTimeStr - Der UTC-Zeitstempel.
     * @param {number} lat - Breite des Ortes.
     * @param {number} lng - Länge des Ortes.
     * @returns {Promise<string>} Der formatierte lokale Zeit-String.
     */
    static async formatLocalTime(utcTimeStr, lat, lng) {
        // Die Prüfung und die Deklaration sind nicht mehr nötig.
        const { timezone, timezone_abbreviation } = await Utils.getLocationData(lat, lng);
        const utcDate = DateTime.fromISO(utcTimeStr, { zone: 'UTC' });
        const localDate = utcDate.setZone(timezone);
        return localDate.toFormat('yyyy-MM-dd HHmm') + ` ${timezone_abbreviation}`;
    }

    /**
     * Gibt die letzte volle Stunde in UTC als Date-Objekt zurück.
     * @returns {Date}
     */
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

    /**
     * Wählt die korrekte Zeitformatierungsfunktion (UTC oder lokal) basierend auf den Einstellungen.
     * @param {string} utcTimeStr - Der UTC-Zeitstempel.
     * @param {number} lat - Breite.
     * @param {number} lng - Länge.
     * @param {'Z'|'loc'} [timeZone='Z'] - Die ausgewählte Zeitzone.
     * @returns {Promise<string>} Der formatierte Zeit-String.
     */
    static async getDisplayTime(utcTimeStr, lat, lng, timeZone = 'Z') {
        // KORREKTUR: Die Funktion greift nicht mehr selbst auf das Dokument zu.
        // Sie verlässt sich auf den übergebenen 'timeZone'-Parameter.
        if (timeZone.toLowerCase() === 'loc' && lat && lng) {
            return await Utils.formatLocalTime(utcTimeStr, lat, lng);
        } else {
            return Utils.formatTime(utcTimeStr); // Standardmäßig UTC ('Z')
        }
    }

    /**
     * Rundet eine gegebene Zahl auf die nächste Zehnerstelle.
     * @param {number} value - Die zu rundende Zahl.
     * @returns {number} Der auf die nächste Zehnerstelle gerundete Wert.
     */
    static roundToTens(value) {
        const rounded = Math.round(value / 10) * 10;

        // Wenn das Ergebnis 0 ist (z.B. für Richtungen von 355° bis 4°),
        // gib stattdessen 360 zurück.
        if (rounded === 0 || rounded === 360) {
            // Prüfen, ob der ursprüngliche Wert näher an 360 als an 0 war,
            // um zu vermeiden, dass z.B. 4° auch zu 360° wird.
            if (value >= 355 || value <= 4) {
                return 360;
            }
        }
        return rounded;
    }

    /**
     * Erstellt eine "debounced" Version einer Funktion, die erst nach einer
     * bestimmten Zeit der Inaktivität ausgeführt wird.
     * @param {function} func - Die auszuführende Funktion.
     * @param {number} wait - Die Wartezeit in Millisekunden.
     * @returns {function} Die neue, debounced Funktion.
     */
    static debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    /**
     * Holt die Höhe und den QFE-Wert für eine gegebene Koordinate mit Debouncing.
     * @param {number} lat - Die geographische Breite.
     * @param {number} lng - Die geographische Länge.
     * @param {function} callback - Die Funktion, die mit dem Ergebnis aufgerufen wird.
     */
    static debouncedGetElevationAndQFE = Utils.debounce(async (lat, lng, callback) => {
        const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
        // Hinweis: Da diese Funktion jetzt in utils.js ist, hat sie keinen direkten Zugriff mehr auf den Slider.
        // Die QFE-Berechnung muss daher in dem Modul erfolgen, das die Funktion aufruft.
        // Diese Funktion konzentriert sich nur auf das Holen der Höhe.

        try {
            const elevation = await Utils.getAltitude(lat, lng);
            if (callback) {
                callback({ elevation });
            }
        } catch (error) {
            console.warn('Failed to fetch elevation in debouncedGetElevationAndQFE:', error);
            if (callback) {
                callback({ elevation: 'N/A' });
            }
        }
    }, 500);

    /**
     * Ordnet einer Höhe über Grund eine Farbe in einem Farbverlauf zu.
     * @param {number} aglHeight - Die Höhe über Grund in Metern.
     * @param {number} [minHeight=0] - Die untere Grenze des Farbverlaufs.
     * @param {number} [maxHeight=3000] - Die obere Grenze des Farbverlaufs.
     * @returns {string} Ein RGB-Farbwert.
     */
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

    /**
     * Erzeugt ein SVG-Icon für eine Windfahne (Wind Barb).
     * @param {number} direction - Die Windrichtung in Grad.
     * @param {number} speedKt - Die Windgeschwindigkeit in Knoten.
     * @param {number|null} [latitude=null] - Die geographische Breite zur Bestimmung der Hemisphäre.
     * @returns {string} Der SVG-Code als String.
     */
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

    /**
     * Berechnet einen dynamischen Radius für die Heatmap basierend auf dem Zoom-Level.
     * @param {number} [baseRadius] - Der Basisradius beim Referenz-Zoom.
     * @param {number} [referenceZoom] - Der Referenz-Zoom-Level.
     * @returns {number} Der angepasste Radius in Pixeln.
     */
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

    /**
     * Erstellt den HTML-Inhalt für den Tooltip eines Track-Punktes.
     * HINWEIS (ToDo): Diese Funktion ist stark vom globalen `AppState` und `Settings` abhängig.
     * Sie könnte in Zukunft in den `displayManager` verschoben werden, um die
     * Verantwortlichkeiten sauberer zu trennen.
     * @param {object} point - Der Track-Punkt.
     * @param {number} index - Der Index des Punktes im Track.
     * @param {object[]} points - Das gesamte Array der Track-Punkte.
     * @param {number|null} groundAltitude - Die Geländehöhe.
     * @returns {string} Der HTML-Inhalt für den Tooltip.
     */
    static getTooltipContent(point, index, points, groundAltitude) {
        if (!AppState.map) {
            console.warn('Map not initialized for getTooltipContent');
            return 'Map not initialized';
        }

        const currentCoordFormat = Settings.getValue('coordFormat', 'Decimal');
        const windUnit = Settings.getValue('windUnit', 'kt');
        const heightUnit = Settings.getValue('heightUnit', 'm');

        const coords = Utils.convertCoords(point.lat, point.lng, currentCoordFormat);
        let tooltipContent = currentCoordFormat === 'MGRS' ? `MGRS: ${coords.lat}` : `Lat: ${coords.lat}<br>Lng: ${coords.lng}`;

        const elevation = point.ele;
        let aglHeight = (elevation !== null && groundAltitude !== null) ? (elevation - groundAltitude) : null;

        if (aglHeight !== null) {
            const effectiveHeightUnit = heightUnit || 'm';
            aglHeight = Utils.convertHeight(aglHeight, effectiveHeightUnit);
            aglHeight = Math.round(aglHeight);
            tooltipContent += `<br>Altitude: ${aglHeight} ${effectiveHeightUnit} AGL`;
        } else {
            tooltipContent += `<br>Altitude: N/A`;
        }

        let speed = 'N/A';
        let descentRate = 'N/A';
        if (index > 0 && point.time && points[index - 1].time && point.ele !== null && points[index - 1].ele !== null) {
            const timeDiff = (point.time.toMillis() - points[index - 1].time.toMillis()) / 1000;
            if (timeDiff > 0) {
                const distance = AppState.map.distance([points[index - 1].lat, points[index - 1].lng], [point.lat, point.lng]);
                const speedMs = distance / timeDiff;
                speed = Utils.convertWind(speedMs, windUnit, 'm/s');
                speed = windUnit === 'bft' ? Math.round(speed) : speed.toFixed(1);
                const eleDiff = point.ele - points[index - 1].ele;
                descentRate = (eleDiff / timeDiff).toFixed(1);
            }
        }
        tooltipContent += `<br>Speed: ${speed} ${windUnit}`;
        tooltipContent += `<br>Descent Rate: ${descentRate} m/s`;
        return tooltipContent;
    }
}

//window.Utils = Utils;