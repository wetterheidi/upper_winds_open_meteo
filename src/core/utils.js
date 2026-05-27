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
import { I18n } from './i18n.js';

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

    // ===================================================================
    // 2. Einheitenumrechnungen
    // ===================================================================

    /**
     * Rechnet eine Höhe um (Meter <-> Fuss).
     * @param {number|string} value - Der Höhenwert in Metern.
     * @param {'m'|'ft'} toUnit - Die Zieleinheit.
     * @returns {number|string} Die umgerechnete Höhe oder 'N/A'.
     */
    /**
     * Formatiert eine Distanz in Metern als lesbaren Text mit nm-Zusatzinfo.
     * @param {number} meters - Die Distanz in Metern.
     * @returns {string} Formatierter Text, z.B. "460 m (≈ 1/4 nm)" oder "2.50 km (≈ 1.3 nm)".
     */
    static formatDistance(meters) {
        const base = meters < 1000 ? `${meters.toFixed(0)} m` : `${(meters / 1000).toFixed(2)} km`;
        const nm = meters * CONVERSIONS.METERS_TO_NM;
        if (nm < 0.1) return base;

        // Gängige Bruchteile für Piloten
        const fractions = [
            { value: 0.25, label: '1/4' },
            { value: 0.5, label: '1/2' },
            { value: 0.75, label: '3/4' },
            { value: 1, label: '1' },
            { value: 1.5, label: '1.5' },
            { value: 2, label: '2' },
            { value: 3, label: '3' },
            { value: 5, label: '5' },
        ];

        const closest = fractions.reduce((best, f) =>
            Math.abs(nm - f.value) < Math.abs(nm - best.value) ? f : best
        );

        const tolerance = closest.value * 0.15;
        if (Math.abs(nm - closest.value) <= tolerance) {
            return `${base} (≈ ${closest.label} nm)`;
        }
        return `${base} (≈ ${nm.toFixed(1)} nm)`;
    }

    static convertHeight(value, toUnit) {
        const numericValue = parseFloat(value);
        if (isNaN(numericValue)) {
            return 'N/A';
        }
        return toUnit === 'ft' ? parseFloat((value * CONVERSIONS.METERS_TO_FEET).toFixed(0)) : value; // m to ft or unchanged if m
    }

    /**
     * Rechnet Fuss in Meter um.
     * @param {number|null|undefined} feet - Der Wert in Fuss.
     * @returns {number} Der umgerechnete Wert in Metern, oder 0 bei ungültiger Eingabe.
     */
    static convertFeetToMeters(feet) {
        if (feet === null || feet === undefined || isNaN(feet)) {
            return 0;
        }
        return feet * CONVERSIONS.FEET_TO_METERS;
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
                break;
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
        return BEAUFORT.BEAUFORT_THRESHOLDS[bft] ?? 63; // Default to max if bft > 12
    }

    /**
     * Formatiert einen Meterwert als nautische Meilen für die Piloten-Kommunikation.
     * Zeigt gängige Bruchteile (¼, ½, ¾) wenn der Wert nahe genug liegt.
     * @param {number} meters - Der Wert in Metern.
     * @returns {string} Formatierter String wie "≈ ½ nm" oder "≈ 1.3 nm", oder '' wenn zu klein.
     */
    static formatAsNm(meters) {
        const nm = Math.abs(meters) * CONVERSIONS.METERS_TO_NM;
        if (nm < 0.05) return '';

        // Gängige Bruchteile prüfen (Toleranz ±0.03 nm)
        const fractions = [
            { value: 0.25, label: '¼' },
            { value: 0.5, label: '½' },
            { value: 0.75, label: '¾' },
        ];
        for (const f of fractions) {
            if (Math.abs(nm - f.value) < 0.03) return `≈ ${f.label} nm`;
        }

        // Ganze Zahlen oder eine Dezimalstelle
        if (Math.abs(nm - Math.round(nm)) < 0.03) {
            return `≈ ${Math.round(nm)} nm`;
        }
        return `≈ ${nm.toFixed(1)} nm`;
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
     * Führt eine lineare Interpolation für Winkel durch und wählt dabei den kürzesten Weg. (Für Windspinne)
     * @param {number[]} xVector - Der Vektor der Stützstellen (z.B. Höhen).
     * @param {number[]} yVector - Der Vektor der Winkelwerte in Grad.
     * @param {number} xValue - Der Wert, für den ein Winkel gefunden werden soll.
     * @returns {number} Der interpolierte Winkel in Grad (0-360).
     */
    static linearInterpolateAngle(xVector, yVector, xValue) {
        if (!xVector?.length || !yVector?.length || xVector.length !== yVector.length || xVector.length < 2) {
            return NaN; // Not enough data to interpolate
        }

        const len = xVector.length;
        const isAscending = xVector[0] < xVector[len - 1];

        // Finde das korrekte Segment für die Interpolation
        let i = 1;
        if (isAscending) {
            while (i < len && xValue > xVector[i]) {
                i++;
            }
        } else { // Descending
            while (i < len && xValue < xVector[i]) {
                i++;
            }
        }

        // Extrapolations-Logik an den Rändern
        if (isAscending) {
            if (xValue >= xVector[len - 1]) i = len - 1;
            if (xValue < xVector[0]) i = 1;
        } else {
            if (xValue <= xVector[len - 1]) i = len - 1;
            if (xValue > xVector[0]) i = 1;
        }

        const x0 = xVector[i - 1];
        const x1 = xVector[i];
        const y0 = yVector[i - 1];
        const y1 = yVector[i];

        if (x1 === x0) return y0;

        // Kernlogik der Winkelinterpolation: den kürzesten Weg finden
        let diff = y1 - y0;
        if (diff > 180) diff -= 360;
        else if (diff < -180) diff += 360;

        // Standard- lineare Interpolation mit dem angepassten "diff"
        const factor = (xValue - x0) / (x1 - x0);
        const result = y0 + (factor * diff);

        // Das Ergebnis zurück in den Bereich 0-360 normalisieren
        return (result + 360) % 360;
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
        if (pressureLevels.length !== heights.length || pressureLevels.length !== uComponents.length || pressureLevels.length !== vComponents.length) {
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
        if ((typeof u_z === 'string' && u_z.includes('error')) || (typeof v_z === 'string' && v_z.includes('error'))) {
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
     * @param {number[]} heights - Array der Höhen-Stützstellen in Metern (AMSL).
     * @param {number[]} xComponents - Array der U-Windkomponenten.
     * @param {number[]} yComponents - Array der V-Windkomponenten.
     * @param {number} lowerLimit - Die untere Grenze der Schicht in Metern (AMSL).
     * @param {number} upperLimit - Die obere Grenze der Schicht in Metern (AMSL).
     * @returns {number[]|null} Ein Array `[Richtung, Geschwindigkeit, u-Komponente, v-Komponente]` oder null bei einem Fehler.
     */
    static calculateMeanWind(heights, xComponents, yComponents, lowerLimit, upperLimit) {
        try {
            if (!heights || !xComponents || !yComponents || heights.length < 2 || lowerLimit >= upperLimit) {
                throw new Error('Invalid input data or limits for calculateMeanWind');
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

            // Sort arrays in descending order of height to ensure correct integration direction
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

            const heightDifference = hLayer[0] - hLayer[hLayer.length - 1];
            if (heightDifference === 0) {
                // If there's no height difference, return the wind at that specific level
                dddff[2] = xLower;
                dddff[3] = yLower;
                dddff[1] = Utils.windSpeed(xLower, yLower);
                dddff[0] = Utils.windDirection(xLower, yLower);
                return dddff;
            }

            const xMean = xTrapez / heightDifference;
            const yMean = yTrapez / heightDifference;

            dddff[2] = xMean; // u component
            dddff[3] = yMean; // v component
            dddff[1] = Utils.windSpeed(xMean, yMean); // Speed
            dddff[0] = Utils.windDirection(xMean, yMean); // Direction

            return dddff;
        } catch (error) {
            console.error('Error in calculateMeanWind:', error, { heights, xComponents, yComponents, lowerLimit, upperLimit });
            Utils.handleError(I18n.t('utils.mean_wind_error_details', { error: error.message }));
            return null;
        }
    }

    /**
     * Translates a WMO 4677 weather code into a TAF/METAR significant weather string.
     * @param {number|string} code - The numeric WMO weather code.
     * @returns {string} The corresponding TAF/METAR code or a descriptive string.
     */
    static translateWmoCodeToTaf(code) {
        const wmoToTafMap = {
            0: 'NSW', 1: 'NSW', 2: 'NSW', 3: 'NSW',
            45: 'FG', 48: 'FZFG',
            51: '-DZ', 53: 'DZ', 55: '+DZ', 56: '-FZDZ', 57: 'FZDZ',
            61: '-RA', 63: 'RA', 65: '+RA', 66: '-FZRA', 67: 'FZRA',
            71: '-SN', 73: 'SN', 75: '+SN', 77: 'SG',
            80: '-SHRA', 81: 'SHRA', 82: '+SHRA', 83: '-SHRASN', 85: '-SHSN', 86: 'SHSN',
            95: 'TSRA', 96: 'TSGR', 99: '+TSGR'
        };
        const codeNum = parseInt(code, 10);
        if (isNaN(codeNum)) {
            return 'N/A';
        }
        return wmoToTafMap[codeNum] || 'N/A';
    }

    /**
     * Findet signifikante Wolkenschichten und gibt sie als strukturiertes Array zurück.
         * @param {object[]} interpolatedData - Die interpolierten Wetterdaten.
         * @returns {Array<{cover: string, base: number}>} Ein Array von Wolkenschicht-Objekten.
         * @private
         */
    static findCloudLayers(interpolatedData) {
        if (!interpolatedData || interpolatedData.length === 0) {
            return [];
        }

        const reportedLayers = [];
        let lastReportedCategory = null;
        const categoryOrder = { 'FEW': 1, 'SCT': 2, 'BKN': 3, 'OVC': 4 };

        const getMetarCategory = (cc) => {
            if (cc <= 5) return null;
            if (cc <= 25) return 'FEW';
            if (cc <= 50) return 'SCT';
            if (cc <= 87) return 'BKN';
            return 'OVC';
        };

        for (const point of interpolatedData) {
            const currentCategory = getMetarCategory(point.cc);
            if (!currentCategory || reportedLayers.length >= 3) {
                continue;
            }

            const isNewLayer = !lastReportedCategory || categoryOrder[currentCategory] > categoryOrder[lastReportedCategory];
            if (isNewLayer) {
                reportedLayers.push({
                    cover: currentCategory,
                    base: point.displayHeight // Höhe AGL in Metern
                });
                lastReportedCategory = currentCategory;
            }
        }
        return reportedLayers;
    }

    /**
     * Nutzt findCloudLayers und formatiert das Ergebnis als METAR-String.
     */
    static getCloudLayersForMetar(interpolatedData, heightUnit) {
        const layers = Utils.findCloudLayers(interpolatedData);

        if (layers.length === 0) {
            return 'SKC'; // Sky Clear
        }

        return layers.map(layer => {
            const heightInMeters = layer.base;
            let formattedHeight;
            let displayUnit;

            if (heightUnit === 'ft') {
                formattedHeight = Math.round(Utils.convertHeight(heightInMeters, 'ft') / 100) * 100;
                displayUnit = 'ft';
            } else {
                formattedHeight = Math.round(heightInMeters / 50) * 50;
                displayUnit = 'm';
            }
            return `${layer.cover} ${formattedHeight}${displayUnit}`;
        }).join(', ');
    }

    /**
     * Formats visibility in meters according to specific meteorological rounding rules.
     * @param {number|null|undefined} visibilityInMeters - The visibility value in meters.
     * @returns {string} The formatted visibility string (e.g., ">10000", "8000", "4500").
     */
    static formatVisibility(visibilityInMeters) {
        const vis = parseFloat(visibilityInMeters);

        if (isNaN(vis)) {
            return 'N/A';
        }

        if (vis >= 10000) {
            return '>10000';
        } else if (vis >= 5000) {
            return (Math.round(vis / 1000) * 1000).toString();
        } else {
            // Runden auf die nächsten 100m für Werte unter 5km
            return (Math.round(vis / 100) * 100).toString();
        }
    }

    /**
     * Formats a wind direction for meteorological reports (rounds to 10, uses 360 for north, pads with zero).
     * @param {number|string} direction - The wind direction in degrees.
     * @returns {string} The formatted 3-digit wind direction string (e.g., "090", "270", "360").
     */
    static formatWindDirection(direction) {
        const dirNum = parseFloat(direction);

        if (isNaN(dirNum)) {
            return 'N/A';
        }

        let roundedDir = Math.round(dirNum / 10) * 10;

        if (roundedDir === 0 || roundedDir >= 360) {
            roundedDir = 360;
        }

        // Pad with a leading zero to ensure three digits
        return roundedDir.toString().padStart(3, '0');
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
            Utils.handleError(I18n.t('utils.base_leg_error'));
            return false;
        }
        if (downwindVal <= baseVal) {
            Utils.handleError(I18n.t('utils.downwind_leg_error'));
            return false;
        }
        return true;
    }

    // ===================================================================
    // 5. Koordinaten- & Geospatial-Funktionen
    // ===================================================================

    /**
     * Konvertiert Koordinaten zwischen verschiedenen Formaten.
     * @param {number} lat - Breite.
     * @param {number} lng - Länge.
     * @param {'Decimal'|'DDM'|'DMS'|'MGRS'} [format='Decimal'] - Das Zielformat.
     * @returns {object|string} Die konvertierten Koordinaten.
     */
    static convertCoords(lat, lng, format = 'Decimal') {
        if (lat === null || lng === null || lat === undefined || lng === undefined) {
            return { lat: 'N/A', lng: 'N/A' };
        }

        // Return based on the requested format
        switch (format) {
            case 'DDM':
                return {
                    lat: Utils.decimalToDecimalMinutes(lat, true),
                    lng: Utils.decimalToDecimalMinutes(lng, false)
                };
            case 'DMS':
                return {
                    lat: Utils.decimalToDms(lat, true),
                    lng: Utils.decimalToDms(lng, false)
                };
            case 'MGRS': {
                const mgrsVal = Utils.decimalToMgrs(lat, lng);
                return { lat: mgrsVal, lng: mgrsVal }; // MGRS is a single string
            }
            case 'Decimal':
            default:
                return { lat: lat.toFixed(6), lng: lng.toFixed(6) };
        }
    }

    /** Konvertiert Dezimalgrad in Grad Dezimalminuten. @private */
    static decimalToDecimalMinutes(decimal, isLat) {
        if (isNaN(decimal) || decimal === null || decimal === undefined) {
            throw new Error('Invalid coordinate for DDM conversion');
        }
        const absolute = Math.abs(decimal);
        const deg = Math.floor(absolute);
        const min = (absolute - deg) * 60;
        const dir = isLat ? (decimal >= 0 ? 'N' : 'S') : (decimal >= 0 ? 'E' : 'W');

        return { deg, min, dir };
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

        const maxRetries = 3;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await fetch(
                    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&timezone=auto`
                );
                if (response.status === 429) {
                    const waitTime = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
                    console.warn(`Location API rate limit (429). Retry ${attempt + 1}/${maxRetries} in ${waitTime / 1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }
                if (!response.ok) {
                    throw new Error(`Open-Meteo fetch failed: ${response.status}`);
                }
                const data = await response.json();
                const locationData = {
                    timezone: data.timezone || 'GMT',
                    timezone_abbreviation: data.timezone_abbreviation || 'GMT',
                    elevation: data.elevation !== undefined ? data.elevation : 'N/A'
                };
                Utils.locationCache.set(cacheKey, locationData);
                return locationData;
            } catch (error) {
                if (attempt < maxRetries - 1) continue;
                console.error('Error fetching location data:', error.message);
                return { timezone: 'UTC', elevation: 'N/A' };
            }
        }
        return { timezone: 'UTC', elevation: 'N/A' };
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

    /**
    * Ruft die Geländehöhen für eine Liste von Koordinatenpunkten in Batches ab.
    * @param {L.LatLng[]} points - Ein Array von Leaflet LatLng-Objekten.
    * @returns {Promise<number[]>} Ein Array mit den Höhen in Metern.
    */
    static async getMultipleAltitudes(points) {
        if (!points || points.length === 0) {
            return [];
        }

        const latitudes = points.map(p => p.lat.toFixed(4)).join(',');
        const longitudes = points.map(p => p.lng.toFixed(4)).join(',');

        const maxRetries = 3;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${latitudes}&longitude=${longitudes}`);
                if (response.status === 429) {
                    const waitTime = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
                    console.warn(`Elevation API rate limit (429). Retry ${attempt + 1}/${maxRetries} in ${waitTime / 1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }
                if (!response.ok) {
                    throw new Error(`Elevation API Error: ${response.status}`);
                }
                const data = await response.json();
                return data.elevation || [];
            } catch (error) {
                if (attempt < maxRetries - 1 && error.message?.includes('429')) continue;
                console.error("Error fetching multiple altitudes:", error);
                return points.map(() => 'N/A');
            }
        }
        // Alle Retries erschöpft
        console.error("Elevation API: Rate limit exceeded after all retries.");
        return points.map(() => 'N/A');
    }

    /**
     * Berechnet die aktuelle magnetische Missweisung (Deklination) für eine Koordinate.
     * Nutzt das World Magnetic Model (WMM) via geomagnetism Bibliothek.
     * @param {number} lat - Breitengrad
     * @param {number} lng - Längengrad
     * @returns {number} Die Missweisung in Grad.
     */
    static getMagneticDeclination(lat, lng) {
        // Prüfen, ob die geomag Library geladen ist
        if (typeof geomag !== 'undefined') {
            try {
                const field = geomag.field(lat, lng);
                const decl = field.declination;
                console.log(`[MagDecl] Position: ${lat.toFixed(4)}, ${lng.toFixed(4)} → Deklination: ${decl >= 0 ? '+' : ''}${decl.toFixed(2)}° (${decl >= 0 ? 'E' : 'W'})`);
                return decl;
            } catch (error) {
                console.error("Fehler bei der Berechnung der Deklination:", error);
                return 0;
            }
        }
        console.warn("geomag library nicht gefunden, Deklination = 0");
        return 0;
    }

    /**
     * Wandelt eine geografische Richtung (True North) in eine magnetische Richtung um.
     * @param {number} trueDirection - Geografische Richtung
     * @param {number} lat - Aktueller Breitengrad
     * @param {number} lng - Aktueller Längengrad
     */
    static applyNorthReference(trueDirection, lat, lng) {
        if (isNaN(trueDirection) || lat == null || lng == null) return trueDirection;

        const reference = Settings.getValue('northReference', 'true');
        if (reference === 'magnetic') {
            // Deklination automatisch für die aktuelle Position berechnen
            const declination = Utils.getMagneticDeclination(lat, lng);
            let magDir = trueDirection - declination;
            return Utils.normalizeAngle(magDir);
        }
        
        return trueDirection;
    }

    /**
     * Formatiert eine geografische Richtung für das UI und wendet, falls gewünscht,
     * die magnetische Missweisung an. Hängt automatisch °T oder °M an.
     * @param {number} trueDirection - Die geografische Richtung.
     * @param {number} lat - Breitengrad (für die Berechnung der Missweisung).
     * @param {number} lng - Längengrad.
     * @param {boolean} [padToThree=true] - Ob die Zahl mit Nullen aufgefüllt werden soll (z.B. 090).
     * @returns {string} Der formatierte String, z.B. "090°M" oder "270°T".
     */
    static formatDirectionOutput(trueDirection, lat, lng, padToThree = true) {
        if (isNaN(trueDirection) || trueDirection === null) return 'N/A';

        const reference = Settings.getValue('northReference', 'true');
        let displayDir = trueDirection;
        let suffix = '°T';

        if (reference === 'magnetic' && lat != null && lng != null) {
            const declination = Utils.getMagneticDeclination(lat, lng);
            displayDir = Utils.normalizeAngle(trueDirection - declination);
            suffix = '°M';
        }

        let roundedDir = Math.round(displayDir);
        if (roundedDir === 0 || roundedDir >= 360) roundedDir = 360;

        if (padToThree) {
            return `${roundedDir.toString().padStart(3, '0')}${suffix}`;
        } else {
            return `${roundedDir}${suffix}`;
        }
    }
    
    /**
     * Wandelt eine Richtung im Display-Format (ggf. magnetisch) zurück in True North.
     * Umkehrfunktion zu applyNorthReference.
     * @param {number} displayDirection - Die angezeigte Richtung (True oder Magnetic).
     * @param {number} lat - Breitengrad.
     * @param {number} lng - Längengrad.
     * @returns {number} Die Richtung in True North.
     */
    static reverseNorthReference(displayDirection, lat, lng) {
        if (isNaN(displayDirection) || lat == null || lng == null) return displayDirection;
        const reference = Settings.getValue('northReference', 'true');
        if (reference === 'magnetic') {
            const declination = Utils.getMagneticDeclination(lat, lng);
            return Utils.normalizeAngle(displayDirection + declination);
        }
        return displayDirection;
    }

    /**
     * Gibt das aktuelle Suffix für Richtungsangaben zurück (°T oder °M).
     * @returns {string} "°M" bei magnetischer Referenz, sonst "°T".
     */
    static getNorthReferenceSuffix() {
        const ref = Settings.getValue('northReference', 'true');
        return ref === 'magnetic' ? '°M' : '°T';
    }

    /**
     * Aktualisiert alle °-Suffix-Spans in der UI (degSuffixLL, degSuffixRR, degSuffixJRT).
     */
    static updateNorthReferenceSuffixes() {
        const suffix = Utils.getNorthReferenceSuffix();
        ['degSuffixLL', 'degSuffixRR', 'degSuffixJRT'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = suffix;
        });
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
     * Erzeugt ein SVG-Icon für eine Windfahne (Wind Barb) - KORRIGIERTE VERSION MIT ORIGINAL-LOGIK.
     * @param {number} direction - Die Windrichtung in Grad.
     * @param {number} speedKt - Die Windgeschwindigkeit in Knoten.
     * @param {number|null} [latitude=null] - Die geographische Breite zur Bestimmung der Hemisphäre.
     * @param {string} [color='black'] - Die Farbe für die Fieder.
     * @returns {string} Der SVG-Code als String.
     */
    static generateWindBarb(direction, speedKt, latitude = null, color = 'black') {
        const speed = Math.max(0, Math.round(speedKt)); // Ensure speed is not negative

        // SVG dimensions
        const width = 40;
        const height = 40;
        const centerX = width / 2;
        const centerY = height / 2;
        const staffLength = 20; // Original staff length

        // Determine hemisphere based on latitude (default to Northern if undefined)
        const isNorthernHemisphere = typeof latitude === 'number' && !isNaN(latitude) ? latitude >= 0 : true;
        const barbSide = isNorthernHemisphere ? -1 : 1; // -1 for left (Northern), 1 for right (Southern)

        // Calculate barb components (original logic)
        let flags = Math.floor(speed / 50);
        let remaining = speed % 50;
        let fullBarbs = Math.floor(remaining / 10);
        let halfBarbs = Math.floor((remaining % 10) / 5);

        // Adjust for small speeds (original logic)
        if (speed < 3) { // Use original threshold
             halfBarbs = 0;
             fullBarbs = 0;
             flags = 0;
        } else if (speed >= 3 && speed < 8) { // Original range for just half barb
            halfBarbs = 1;
            fullBarbs = 0;
            flags = 0;
        }
        // No else needed, default calculation handles >= 8 kt

        // Start SVG - Added xmlns attribute
        let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;

        // Rotation group
        const rotation = direction + 180; // Wind from direction
        svg += `<g transform="translate(${centerX}, ${centerY}) rotate(${rotation})">`;

        // Draw the staff (Tip points towards wind source, upwards after rotation)
        const staffY1 = -staffLength / 2; // Tip
        const staffY2 = staffLength / 2; // Base
        svg += `<line x1="0" y1="${staffY1}" x2="0" y2="${staffY2}" stroke="${color}" stroke-width="1.5"/>`; // Slightly thicker line

        // Draw barbs starting near the base (staffY2) and going inwards/upwards
        let yPos = staffY2; // Start at the base
        const barbLength = 10; // Original barb length
        const halfBarbLength = 5;
        const barbSpacing = 4; // Original spacing

        // Flags (50 kt) - Drawn nearest the base, pointing inwards
        for (let i = 0; i < flags; i++) {
             // Original polygon logic: triangle at the base, pointing inwards along staff
             svg += `<polygon points="0,${yPos} 0,${yPos - barbSpacing * 1.5} ${barbLength * barbSide},${yPos}" fill="${color}"/>`; // Flag points inwards
             yPos -= barbSpacing * 2; // Move inwards along staff for next element
        }

        // Full barbs (10 kt) - Drawn inwards from the base
        for (let i = 0; i < fullBarbs; i++) {
            // Original line logic: straight line perpendicular to staff
             svg += `<line x1="0" y1="${yPos}" x2="${barbLength * barbSide}" y2="${yPos}" stroke="${color}" stroke-width="1.5"/>`;
             yPos -= barbSpacing; // Move inwards along staff
         }

        // Half barbs (5 kt) - Drawn inwards
        if (halfBarbs > 0) {
             // Place half barb slightly further inwards if needed
             if (flags > 0 || fullBarbs > 0) yPos -= barbSpacing * 0.5;
             svg += `<line x1="0" y1="${yPos}" x2="${halfBarbLength * barbSide}" y2="${yPos}" stroke="${color}" stroke-width="1.5"/>`;
         }

        // Circle for calm winds (0-2 kt)
        if (speed < 3) { // Use original threshold
            svg += `<circle cx="0" cy="0" r="3" fill="none" stroke="${color}" stroke-width="1.5"/>`;
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
    static calculateDynamicRadius(baseRadius = ENSEMBLE_VISUALIZATION.HEATMAP_BASE_RADIUS, referenceZoom = ENSEMBLE_VISUALIZATION.HEATMAP_REFERENCE_ZOOM) {
        const currentZoom = AppState.map.getZoom();
        const scalingBase = ENSEMBLE_VISUALIZATION.HEATMAP_SCALING_BASE;

        const scaleFactor = Math.pow(scalingBase, currentZoom - referenceZoom);
        const dynamicRadius = baseRadius * scaleFactor;
        // Clamp radius to reasonable bounds to avoid extreme values
        const minRadius = ENSEMBLE_VISUALIZATION.HEATMAP_MIN_RADIUS_PX;  // Minimum radius to avoid disappearing at high zooms
        const maxRadius = ENSEMBLE_VISUALIZATION.HEATMAP_MAX_RADIUS_PX; // Maximum radius to avoid excessive spread at low zooms
        const adjustedRadius = Math.max(minRadius, Math.min(maxRadius, dynamicRadius));
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
        let tooltipContent;

        const formatDDM = (ddm) => `${ddm.deg}° ${ddm.min.toFixed(3)}' ${ddm.dir}`;
        const formatDMS = (dms) => `${dms.deg}°${dms.min}'${dms.sec.toFixed(0)}" ${dms.dir}`;

        if (currentCoordFormat === 'MGRS') {
            tooltipContent = `MGRS: ${coords.lat}`;
        } else if (currentCoordFormat === 'DMS') {
            tooltipContent = `Lat: ${formatDMS(Utils.decimalToDms(point.lat, true))}<br>Lng: ${formatDMS(Utils.decimalToDms(point.lng, false))}`;
        } else if (currentCoordFormat === 'DDM') {
            tooltipContent = `Lat: ${formatDDM(Utils.decimalToDecimalMinutes(point.lat, true))}<br>Lng: ${formatDDM(Utils.decimalToDecimalMinutes(point.lng, false))}`;
        } else {
            tooltipContent = `Lat: ${point.lat.toFixed(5)}<br>Lng: ${point.lng.toFixed(5)}`;
        }


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

    /**
 * Berechnet die konvexe Hülle einer Punktemenge (Graham Scan Algorithmus).
 * @param {Array<[number, number]>} points - Ein Array von Punkten, z.B. [[lat1, lng1], [lat2, lng2], ...].
 * @returns {Array<[number, number]>} Die Punkte, die die konvexe Hülle bilden.
 */
    static getConvexHull(points) {
        points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const crossProduct = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
        const lower = [];
        for (const p of points) {
            while (lower.length >= 2 && crossProduct(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
                lower.pop();
            }
            lower.push(p);
        }
        const upper = [];
        for (let i = points.length - 1; i >= 0; i--) {
            const p = points[i];
            while (upper.length >= 2 && crossProduct(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
                upper.pop();
            }
            upper.push(p);
        }
        return lower.slice(0, -1).concat(upper.slice(0, -1));
    }
}

//window.Utils = Utils;