// src/core/utils.test.js

import { describe, it, expect, vi } from 'vitest';
import { Utils } from './utils.js';
import { AppState } from './state.js'; // Import für AppState Mocking

// Mocken des AppState, um Abhängigkeiten zu entfernen
vi.mock('./state.js', () => ({
  AppState: {
    map: {
      // Mocken Sie nur die Methoden, die tatsächlich aufgerufen werden
      getZoom: () => 12, 
    },
  },
}));


describe('Utils', () => {

  // --- Bestehende Tests ---
  describe('Wind Conversion', () => {
    it('sollte Windgeschwindigkeiten korrekt umrechnen', () => {
      expect(Utils.convertWind(18.52, 'kt', 'km/h')).toBeCloseTo(10);
      expect(Utils.convertWind(10, 'km/h', 'm/s')).toBe(36);
      expect(Utils.convertWind(25, 'bft', 'kt')).toBe(6);
      expect(Utils.convertWind('abc', 'kt', 'km/h')).toBe('N/A');
    });
  });

  describe('Rounding', () => {
    it('sollte auf die nächste Zehnerstelle runden', () => {
      expect(Utils.roundToTens(278)).toBe(280);
      expect(Utils.roundToTens(358)).toBe(360);
      expect(Utils.roundToTens(3)).toBe(360);
    });
  });

  // --- NEUE TESTS ---

  describe('Unit Conversions', () => {
    it('sollte Temperaturen korrekt umrechnen', () => {
      expect(Utils.convertTemperature(0, '°F')).toBe(32);
      expect(Utils.convertTemperature(100, '°F')).toBe(212);
      expect(Utils.convertTemperature(32, '°C')).toBe(32); // von °C zu °C sollte unverändert bleiben
      expect(Utils.convertTemperature('invalid', '°F')).toBe('N/A');
    });

    it('sollte Höhen korrekt umrechnen', () => {
      expect(Utils.convertHeight(1000, 'ft')).toBeCloseTo(3281);
      expect(Utils.convertHeight(3281, 'm')).toBe(3281); // von m zu m sollte unverändert bleiben
      expect(Utils.convertHeight(null, 'ft')).toBe('N/A');
    });
  });

  describe('Meteorological Calculations', () => {
    it('sollte den Taupunkt korrekt berechnen', () => {
      // Standardfall
      expect(Utils.calculateDewpoint(20, 50)).toBeCloseTo(9.25);
      // Bei Sättigung
      expect(Utils.calculateDewpoint(15, 100)).toBeCloseTo(15);
      // Bei Minusgraden
      expect(Utils.calculateDewpoint(-5, 80)).toBeCloseTo(-7.58);
    });

    it('sollte Windgeschwindigkeit und -richtung aus Komponenten berechnen', () => {
      // Westwind (kommt aus 270°) von 10 m/s -> u = 10, v = 0
      const u = 10;
      const v = 0;
      expect(Utils.windSpeed(u, v)).toBeCloseTo(10);
      expect(Utils.windDirection(u, v)).toBeCloseTo(270);
    });
    
    it('sollte True Airspeed (TAS) korrekt berechnen', () => {
        // Bei Seehöhe sollte TAS ~ IAS sein
        expect(Utils.calculateTAS(100, 0)).toBeCloseTo(100);
        // In der Höhe ist TAS höher als IAS
        expect(Utils.calculateTAS(100, 10000)).toBeGreaterThan(115);
        expect(Utils.calculateTAS('invalid', 10000)).toBe('N/A');
    });
  });

  describe('Gaussian Interpolation', () => {
    const y1 = 10; // Wert am Punkt 1
    const y2 = 20; // Wert am Punkt 2
    const h1 = 1000; // Höhe am Punkt 1
    const h2 = 2000; // Höhe am Punkt 2

    it('sollte den exakten Wert zurückgeben, wenn der Punkt auf einer Stützstelle liegt', () => {
      // Testet die Grenzfall-Prüfungen am Anfang der Funktion
      expect(Utils.gaussianInterpolation(y1, y2, h1, h2, 1000)).toBe(y1);
      expect(Utils.gaussianInterpolation(y1, y2, h1, h2, 2000)).toBe(y2);
    });

    it('sollte den Durchschnittswert zurückgeben, wenn der Punkt genau in der Mitte liegt', () => {
      // Wenn hp genau in der Mitte ist, sind die Gewichte gleich, das Ergebnis ist der Durchschnitt.
      const hp = 1500;
      expect(Utils.gaussianInterpolation(y1, y2, h1, h2, hp)).toBeCloseTo(15);
    });

    it('sollte einen gewichteten Wert zurückgeben, der näher am näheren Punkt liegt', () => {
      // hp (1200) ist viel näher an h1 (1000) als an h2 (2000).
      // Das Ergebnis sollte also viel näher an y1 (10) als an y2 (20) sein.
      const hp = 1200;
      const result = Utils.gaussianInterpolation(y1, y2, h1, h2, hp);
      // Die exakte Berechnung ist ( (1/200)*10 + (1/800)*20 ) / (1/200 + 1/800) = 12
      expect(result).toBeCloseTo(12);
    });
  });

  // Diesen Block zu Ihrer utils.test.js hinzufügen

  describe('Wind Interpolation at Altitude', () => {
    // Einfaches, lineares Test-Szenario
    const heights =      [0,    1000, 2000]; // Höhe in m
    const pressureLevels = [1000, 900,  800];  // Druck in hPa
    // Westwind (u > 0, v = 0), der mit der Höhe zunimmt
    const uComponents =  [5,    10,   15];   // u-Komponente in m/s
    const vComponents =  [0,    0,    0];    // v-Komponente in m/s

    it('sollte Windkomponenten für eine Höhe korrekt interpolieren', () => {
      // Wir testen genau in der Mitte zwischen 1000m und 2000m
      const targetAltitude = 1500;
      
      const { u, v } = Utils.interpolateWindAtAltitude(
        targetAltitude, 
        pressureLevels, 
        heights, 
        uComponents, 
        vComponents
      );

      // Bei einer linearen Zunahme erwarten wir den Mittelwert von u=10 und u=15
      expect(u).toBeCloseTo(12.5);
      // v sollte 0 bleiben
      expect(v).toBeCloseTo(0);
    });

    it('sollte einen Fehler bei ungültiger Eingabe zurückgeben', () => {
      // Die Längen der Arrays stimmen nicht überein
      const invalidHeights = [0, 1000];
      const result = Utils.interpolateWindAtAltitude(
        1500, 
        pressureLevels, 
        invalidHeights, 
        uComponents, 
        vComponents
      );

      expect(result).toEqual({ u: 'Invalid input', v: 'Invalid input' });
    });
  });

  describe('Coordinate Conversions', () => {
    const lat = 48.12345;
    const lng = 11.56789;

    it('sollte Dezimalgrad in DMS umrechnen', () => {
      const dms = Utils.decimalToDms(lat, true);
      expect(dms.deg).toBe(48);
      expect(dms.min).toBe(7);
      expect(dms.sec).toBeCloseTo(24.42);
      expect(dms.dir).toBe('N');
    });

    it('sollte DMS in Dezimalgrad umrechnen', () => {
      const decimal = Utils.dmsToDecimal(48, 7, 24.42, 'N');
      expect(decimal).toBeCloseTo(lat);
    });
    
    it('sollte Dezimalgrad in MGRS umrechnen', () => {
        expect(Utils.decimalToMgrs(48.0179, 11.1923)).toBe('32UPU6347420615');
    });
    
    it('sollte MGRS in Dezimalgrad umrechnen', () => {
        const coords = Utils.mgrsToDecimal('32UPU6347420615');
        expect(coords.lat).toBeCloseTo(48.0179, 3);
        expect(coords.lng).toBeCloseTo(11.1923, 3);
    });
  });
  
describe('Geospatial Calculations', () => {
    it('sollte das Azimut (Bearing) zwischen zwei Punkten korrekt berechnen', () => {
        const lat1 = 48.0, lng1 = 11.0, lat2 = 48.0, lng2 = 12.0;
        expect(Utils.calculateBearing(lat1, lng1, lat2, lng2)).toBeCloseTo(89.6, 1);
    });
    
    it('sollte einen neuen Punkt basierend auf Distanz und Azimut korrekt berechnen', () => {
        const startLat = 52.52, startLng = 13.405;
        const [newLat, newLng] = Utils.calculateNewCenter(startLat, startLng, 100000, 90);
        
        // KORREKTUR: Wir prüfen gegen die tatsächlichen, präzisen Ergebnisse.
        expect(newLat).toBeCloseTo(52.511, 3);
        expect(newLng).toBeCloseTo(14.883, 3);
    });
  });

describe('Interpolation', () => {
    const xVec = [3000, 2000, 1000, 0]; // Höhen (absteigend)
    const yVec = [10, 8, 5, 2];          // Werte (z.B. Temperatur)

    it('sollte einen Wert innerhalb des Bereichs korrekt interpolieren', () => {
      // Genau in der Mitte zwischen 2000m (8°) und 1000m (5°)
      expect(Utils.linearInterpolate(xVec, yVec, 1500)).toBeCloseTo(6.5);
    });

    it('sollte einen Wert an einer exakten Stützstelle zurückgeben', () => {
      expect(Utils.linearInterpolate(xVec, yVec, 2000)).toBe(8);
    });

    it('sollte einen Wert korrekt extrapolieren (über dem Maximum)', () => {
      // Die Steigung zwischen den ersten beiden Punkten ist (8-10)/(2000-3000) = 0.002
      // Erwartung für 4000m: 10 + 0.002 * (4000-3000) = 12
      expect(Utils.linearInterpolate(xVec, yVec, 4000)).toBeCloseTo(12);
    });

    it('sollte einen Wert korrekt extrapolieren (unter dem Minimum)', () => {
        // Die Steigung zwischen den letzten beiden Punkten ist (2-5)/(0-1000) = 0.003
        // Erwartung für -500m: 2 + 0.003 * (-500 - 0) = 0.5
        expect(Utils.linearInterpolate(xVec, yVec, -500)).toBeCloseTo(0.5);
    });
  });

  describe('Flight Parameter Calculations', () => {
    it('sollte Flugparameter bei direktem Gegenwind korrekt berechnen', () => {
      const params = Utils.calculateFlightParameters(270, 90, 20, 100); // Kurs West, Wind aus Ost
      expect(params.headwind).toBeCloseTo(-20);
      expect(params.crosswind).toBeCloseTo(0);
      expect(params.groundSpeed).toBeCloseTo(120); // 100 + 20
      expect(params.wca).toBeCloseTo(0);
    });

    it('sollte Flugparameter bei direktem Seitenwind korrekt berechnen', () => {
        const params = Utils.calculateFlightParameters(360, 90, 20, 100); // Kurs Nord, Wind aus Ost
        expect(params.headwind).toBeCloseTo(0);
        expect(params.crosswind).toBeCloseTo(20);
        expect(params.wca).toBeCloseTo(11.54);
        expect(params.groundSpeed).toBeCloseTo(97.98); // sqrt(100^2 - 20^2)
    });
  });
  
  describe('Pressure Calculations', () => {
    it('sollte den QFE-Druck korrekt berechnen', () => {
      // Standardatmosphäre: Druck sinkt um ca. 1 hPa pro 8 Meter
      const surfacePressure = 1013; // hPa
      const referenceElevation = 100; // m
      const targetElevation = 500; // m
      const temperature = 15; // °C
      
      const qfe = Utils.calculateQFE(surfacePressure, targetElevation, referenceElevation, temperature);
      
      // Erwarteter Wert ist ungefähr 1013 - (400/8) = 963 hPa. Die exakte Formel ist genauer.
      expect(qfe).toBeCloseTo(966, 0); // Ergebnis auf ganze Zahl gerundet
    });

    
  });

  describe('Validation', () => {
    it('sollte gültige Koordinaten erkennen', () => {
        expect(Utils.isValidLatLng(48.0, 11.0)).toBe(true);
        expect(Utils.isValidLatLng(0, 0)).toBe(false); // Laut Implementierung wird (0,0) ausgeschlossen
        expect(Utils.isValidLatLng(91, 11.0)).toBe(false); // Ungültiger Breitengrad
        expect(Utils.isValidLatLng(48.0, 181)).toBe(false); // Ungültiger Längengrad
        expect(Utils.isValidLatLng(null, 11.0)).toBe(false);
    });
  });

  describe('Mean Wind Calculation', () => {
    it('sollte den mittleren Wind korrekt berechnen', () => {
        const heights = [2000, 1000, 0];
        // Reiner Westwind (270°) mit 10 m/s -> u = 10, v = 0
        const xComponents = [10, 10, 10];
        const yComponents = [0, 0, 0];
        const lowerLimit = 0;
        const upperLimit = 2000;

        const meanWind = Utils.calculateMeanWind(heights, xComponents, yComponents, lowerLimit, upperLimit);
        
        expect(meanWind).not.toBeNull();
        const [direction, speed] = meanWind;
        expect(direction).toBeCloseTo(270);
        expect(speed).toBeCloseTo(10);
    });
  });

  describe('Wind Barb Generation', () => {
    it('sollte ein SVG für eine Windfahne mit 25 Knoten generieren', () => {
        const svg = Utils.generateWindBarb(270, 25);
        // Wir prüfen auf charakteristische Teile des erwarteten SVG-Strings
        expect(svg).toContain('<svg');
        expect(svg).toContain('rotate(450)'); // 270° + 180°
        expect(svg).toContain('<line x1="0" y1="10" x2="-10" y2="10"'); // Zwei 10kt-Striche
        expect(svg).toContain('<line x1="0" y1="2" x2="-5" y2="2"'); // Ein 5kt-Strich
        expect(svg).toContain('</svg>');
    });
  });

  describe('Advanced Interpolation', () => {
    it('sollte den Druck für eine gegebene Höhe interpolieren', () => {
      const heights = [0, 1000, 2000];
      const pressures = [1013, 900, 800];
      // Genau in der Mitte zwischen 1000m (900hPa) und 2000m (800hPa)
      expect(Utils.interpolatePressure(1500, pressures, heights)).toBeCloseTo(850);
      // Außerhalb des Bereichs
      expect(Utils.interpolatePressure(3000, pressures, heights)).toBe('N/A');
    });
  });

  describe('Validation', () => {
    it('sollte gültige Koordinaten erkennen', () => {
        expect(Utils.isValidLatLng(48.0, 11.0)).toBe(true);
        expect(Utils.isValidLatLng(0, 0)).toBe(false); // Laut Implementierung wird (0,0) ausgeschlossen
        expect(Utils.isValidLatLng(91, 11.0)).toBe(false); // Ungültiger Breitengrad
        expect(Utils.isValidLatLng(48.0, 181)).toBe(false); // Ungültiger Längengrad
        expect(Utils.isValidLatLng(null, 11.0)).toBe(false);
    });
  });

  describe('Flight Parameter Helper Functions', () => {
    it('sollte den Windwinkel korrekt berechnen', () => {
      // Gegenwind
      expect(Utils.calculateWindAngle(360, 180)).toBe(180);
      // Rückenwind
      expect(Utils.calculateWindAngle(360, 360)).toBe(0);
      // Seitenwind von rechts
      expect(Utils.calculateWindAngle(360, 90)).toBe(90);
      // Seitenwind von links
      expect(Utils.calculateWindAngle(360, 270)).toBe(-90);
    });

    it('sollte Windkomponenten korrekt berechnen', () => {
      // 90° Seitenwind -> nur Crosswind
      const components1 = Utils.calculateWindComponents(20, 90);
      expect(components1.crosswind).toBeCloseTo(20);
      expect(components1.headwind).toBeCloseTo(0);

      // 45° Wind -> Crosswind und Headwind sind gleich
      const components2 = Utils.calculateWindComponents(20, 45);
      expect(components2.crosswind).toBeCloseTo(14.14);
      expect(components2.headwind).toBeCloseTo(14.14);
    });
    
    it('sollte den Wind Correction Angle (WCA) korrekt berechnen', () => {
        // 20kt Seitenwind bei 100kt TAS
        const wca = Utils.calculateWCA(20, 100);
        expect(wca).toBeCloseTo(11.54);
    });

    it('sollte Kurs und Groundspeed aus dem Steuerkurs korrekt berechnen', () => {
      const trueHeading = 340; // Fliegt fast nach Norden
      const windDirection = 260; // Wind kommt fast aus Westen
      const windSpeed = 30;
      const trueAirspeed = 120;
      
      const result = Utils.calculateCourseFromHeading(trueHeading, windDirection, windSpeed, trueAirspeed);
      
      // Erwartung: Der Wind drückt das Flugzeug nach Osten, der Kurs muss also > 350 sein.
      expect(result.trueCourse).toBeGreaterThan(350);
      expect(result.trueCourse).toBeCloseTo(354.43);

      // Erwartung: Der Wind hat eine leichte Gegenwindkomponente, GS sollte < TAS sein.
      expect(result.groundSpeed).toBeLessThan(120);
      expect(result.groundSpeed).toBeCloseTo(118.53);
    });
  });

describe('calculateTASFromGroundSpeed', () => {

    it('sollte TAS bei reinem Gegenwind korrekt berechnen', () => {
      // Szenario: Ground Speed = 80 kt, Gegenwind = 20 kt.
      // Die unkorrigierte TAS muss 100 kt sein (80 + 20).
      const groundSpeedMs = 41.15; // 80 kt in m/s
      const windSpeedMs = 10.29;   // 20 kt in m/s
      const trueCourse = 360;      // Kurs Nord
      const windDirection = 360;   // Wind VON Norden (Gegenwind)
      const heightFt = 0;          // Seehöhe, keine Höhenanpassung

      const tas = Utils.calculateTASFromGroundSpeed(groundSpeedMs, windSpeedMs, windDirection, trueCourse, heightFt);
      
      // Erwartung: 80 + 20 = 100 kt
      expect(tas).toBeCloseTo(100.0);
    });

    it('sollte TAS bei reinem Rückenwind und in der Höhe korrekt berechnen', () => {
      // Szenario: Ground Speed = 120 kt, Rückenwind = 20 kt.
      // Die unkorrigierte TAS muss 100 kt sein (120 - 20).
      const groundSpeedMs = 61.73; // 120 kt in m/s
      const windSpeedMs = 10.29;   // 20 kt in m/s
      const trueCourse = 360;      // Kurs Nord
      const windDirection = 180;   // Wind VON Süden (Rückenwind)
      const heightFt = 10000;      // In der Höhe -> TAS > IAS
      
      const tas = Utils.calculateTASFromGroundSpeed(groundSpeedMs, windSpeedMs, windDirection, trueCourse, heightFt);
      
      // Erwartung: (120 - 20) = 100 kt, dann für 10.000 ft angepasst -> ca. 116.4 kt
      expect(tas).toBeCloseTo(116.4);
    });

    it('sollte "N/A" bei ungültiger Eingabe zurückgeben', () => {
        expect(Utils.calculateTASFromGroundSpeed('invalid', 20, 180, 360, 10000)).toBe('N/A');
    });
  });
});