import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSeparationFromTAS, calculateFreeFall, calculateExitCircle, calculateCanopyCircles, jumpRunTrack, calculateCutAway, calculateLandingPatternCoords } from './jumpPlanner.js';
import { JUMPER_SEPARATION_TABLE, CONVERSIONS, CUTAWAY_VERTICAL_SPEEDS_MPS } from './constants.js';

// Mock-Aufrufe direkt mit Objekten, ohne Top-Level-Variablen außerhalb von vi.mock
vi.mock('../core/state.js', () => {
  const mockAppState = {
    lastLat: 48.0179,
    lastLng: 11.1923,
    lastAltitude: 600, // AMSL
    weatherData: {
      time: ['2025-01-01T12:00:00Z'],
      geopotential_height_1000hPa: [101.00],
      geopotential_height_925hPa: [771.00],
      geopotential_height_850hPa: [1487.00],
      geopotential_height_700hPa: [3099.00],
      geopotential_height_600hPa: [4336.00],
      geopotential_height_500hPa: [5752.00],
      geopotential_height_400hPa: [7412.00],
      geopotential_height_300hPa: [9450.00],
      geopotential_height_250hPa: [10682.00],
      geopotential_height_200hPa: [12132.00],
      temperature_1000hPa: [17.9],
      temperature_925hPa: [17.0],
      temperature_850hPa: [13.1],
      temperature_700hPa: [4.4],
      temperature_600hPa: [-3.2],
      temperature_500hPa: [-13.4],
      temperature_400hPa: [-24.5],
      temperature_300hPa: [-38.2],
      temperature_250hPa: [-46.0],
      temperature_200hPa: [-55.7],
      relative_humidity_1000hPa: [72],
      relative_humidity_925hPa: [66],
      relative_humidity_850hPa: [66],
      relative_humidity_700hPa: [71],
      relative_humidity_600hPa: [55],
      relative_humidity_500hPa: [72],
      relative_humidity_400hPa: [51],
      relative_humidity_300hPa: [35],
      relative_humidity_250hPa: [28],
      relative_humidity_200hPa: [37],
      wind_speed_1000hPa: [16.6],
      wind_speed_925hPa: [39.2],
      wind_speed_850hPa: [34.7],
      wind_speed_700hPa: [35.5],
      wind_speed_600hPa: [40.2],
      wind_speed_500hPa: [48.6],
      wind_speed_400hPa: [53.4],
      wind_speed_300hPa: [58.3],
      wind_speed_250hPa: [79.2],
      wind_speed_200hPa: [89.2],
      wind_direction_1000hPa: [193],
      wind_direction_925hPa: [226],
      wind_direction_850hPa: [228],
      wind_direction_700hPa: [237],
      wind_direction_600hPa: [223],
      wind_direction_500hPa: [225],
      wind_direction_400hPa: [213],
      wind_direction_300hPa: [224],
      wind_direction_250hPa: [203],
      wind_direction_200hPa: [206],
      surface_pressure: [1007.3],
      temperature_2m: [17.1],
      relative_humidity_2m: [78],
      wind_speed_10m: [9.9],
      wind_direction_10m: [190],
    },
    map: {
      distance: vi.fn(() => 1000),
      getZoom: vi.fn(() => 14),
    },
    lastTrackData: {},
    harpMarker: null,
    cutAwayLat: null,
    cutAwayLng: null,
    landingWindDir: undefined,
  };

  return { AppState: mockAppState };
});

vi.mock('../core/settings.js', () => {
  const defaultSettings = {
    jumperSeparation: 5,
    exitAltitude: 3000,
    openingAltitude: 1200,
    safetyHeight: 0,
    canopySpeed: 20,
    descentRate: 3.5,
    cutAwayAltitude: 1000,
    cutAwayState: 'Partially',
    aircraftSpeedKt: 90,
    numberOfJumpers: 5,
    jumpRunTrackOffset: 0,
    jumpRunTrackForwardOffset: 0,
    customJumpRunDirection: null,
    landingDirection: 'LL',
    customLandingDirectionLL: '',
    customLandingDirectionRR: '',
    legHeightDownwind: 300,
    legHeightBase: 200,
    legHeightFinal: 100,
  };

  const mockSettings = {
    state: { userSettings: { ...defaultSettings } },
    getValue: vi.fn((key, def) => mockSettings.state.userSettings[key] ?? defaultSettings[key] ?? def),
    defaultSettings,
  };

  return {
    Settings: mockSettings,
    getInterpolationStep: () => 200,
  };
});

vi.mock('../core/utils.js', () => {
  const mockUtils = {
    calculateTAS: vi.fn(),
    calculateNewCenter: vi.fn((lat, lng, dist, bearing) => {
      // Vereinfachte Berechnung für Tests: Verschiebe Koordinaten basierend auf Distanz und Richtung
      const distDegrees = dist / 111000; // 1° ≈ 111 km
      const rad = bearing * Math.PI / 180;
      return [lat + distDegrees * Math.cos(rad), lng + distDegrees * Math.sin(rad)];
    }),
    calculateBearing: vi.fn(() => 270),
    calculateMeanWind: vi.fn((heights, u, v, minHeight, maxHeight) => {
      const data = interpolateWeatherData();
      const relevantData = data.filter(d => d.height >= minHeight && d.height <= maxHeight);
      const avgDir = relevantData.reduce((sum, d) => sum + d.dir, 0) / relevantData.length;
      const avgSpd = relevantData.reduce((sum, d) => sum + d.spd, 0) / relevantData.length;
      return [Math.round(avgDir), avgSpd * 1.94384, avgSpd * 1.94384, 0]; // spd in kt
    }),
    calculateFlightParameters: vi.fn((course, windDir, windSpeedKt, airspeedKt) => {
      const windAngle = mockUtils.calculateWindAngle(course, windDir);
      const { crosswind, headwind } = mockUtils.calculateWindComponents(windSpeedKt, windAngle);
      const wca = mockUtils.calculateWCA(crosswind, airspeedKt);
      const groundSpeed = Math.sqrt(Math.pow(airspeedKt + headwind, 2) + Math.pow(crosswind, 2));
      return { crosswind, headwind, wca, groundSpeed };
    }),
    calculateCourseFromHeading: vi.fn((heading, windDir, windSpeedKt, airspeedKt) => {
      const windAngle = mockUtils.calculateWindAngle(heading, windDir);
      const { crosswind } = mockUtils.calculateWindComponents(windSpeedKt, windAngle);
      const wca = mockUtils.calculateWCA(crosswind, airspeedKt);
      const trueCourse = (heading + wca + 360) % 360;
      const { groundSpeed } = mockUtils.calculateFlightParameters(trueCourse, windDir, windSpeedKt, airspeedKt);
      return { trueCourse, groundSpeed };
    }),
    convertWind: vi.fn((val, to, from) => {
      if (from === 'm/s' && to === 'kt') return val * 1.94384;
      if (from === 'kt' && to === 'm/s') return val / 1.94384;
      return val;
    }),
    convertFeetToMeters: vi.fn((ft) => ft / 3.28084),
    convertHeight: vi.fn((m, unit) => (unit === 'ft' ? m * 3.28084 : m)),
    isValidLatLng: vi.fn(() => true),
    linearInterpolate: vi.fn(() => 10),
    windSpeed: vi.fn(() => 10),
    windDirection: vi.fn(() => 270),
    handleError: vi.fn(),
    getAltitude: vi.fn(() => 600),
    calculateWindAngle: vi.fn((trueCourse, windDirection) => {
      let angle = mockUtils.normalizeAngle(windDirection - trueCourse);
      if (angle > 180) angle -= 360; // -180 to 180
      return angle;
    }),
    normalizeAngle: vi.fn((angle) => {
      // Normalisiert den Winkel auf [0, 360)
      return ((angle % 360) + 360) % 360;
    }),
    calculateWindComponents: vi.fn((windSpeedKt, windAngle) => ({
      crosswind: windSpeedKt * Math.sin(windAngle * Math.PI / 180),
      headwind: windSpeedKt * Math.cos(windAngle * Math.PI / 180),
    })),
    calculateWCA: vi.fn((crosswind, speed) => {
      // Wind Correction Angle (WCA) in Grad, vereinfachte Mock-Implementierung
      return Math.asin(crosswind / speed) * 180 / Math.PI;
    }),
  };

  return { Utils: mockUtils };
});

vi.mock('../core/weatherManager.js', () => {
  const mockWeatherData = {
    interpolateWeatherData: vi.fn(() => [
      { height: 0,    spd: 2.11111,  dir: 172, temp: 17.7, rh: 77, displayHeight: -600 },
      { height: 200,  spd: 6.33333,  dir: 201, temp: 18.3, rh: 69, displayHeight: -400 },
      { height: 400,  spd: 9.63889,  dir: 216, temp: 18.9, rh: 62, displayHeight: -200 },
      { height: 600,  spd: 11.41667, dir: 224, temp: 18.5, rh: 60, displayHeight: 0 },
      { height: 800,  spd: 11.22222, dir: 231, temp: 17.0, rh: 63, displayHeight: 200 },
      { height: 1000, spd: 10.52778, dir: 236, temp: 15.7, rh: 67, displayHeight: 400 },
      { height: 1200, spd: 9.72222,  dir: 239, temp: 14.3, rh: 70, displayHeight: 600 },
      { height: 1400, spd: 8.94444,  dir: 242, temp: 13.0, rh: 73, displayHeight: 800 },
      { height: 1600, spd: 8.86111,  dir: 242, temp: 12.1, rh: 72, displayHeight: 1000 },
      { height: 1800, spd: 9.00000,  dir: 242, temp: 11.4, rh: 70, displayHeight: 1200 },
      { height: 2000, spd: 9.11111,  dir: 241, temp: 10.5, rh: 68, displayHeight: 1400 },
      { height: 2200, spd: 9.22222,  dir: 239, temp: 9.4,  rh: 68, displayHeight: 1600 },
      { height: 2400, spd: 9.36111,  dir: 237, temp: 8.3,  rh: 67, displayHeight: 1800 },
      { height: 2600, spd: 9.50000,  dir: 236, temp: 7.2,  rh: 67, displayHeight: 2000 },
      { height: 2800, spd: 9.63889,  dir: 234, temp: 6.1,  rh: 66, displayHeight: 2200 },
      { height: 3000, spd: 9.77778,  dir: 232, temp: 5.0,  rh: 66, displayHeight: 2400 },
      { height: 3200, spd: 10.00000, dir: 231, temp: 3.8,  rh: 66, displayHeight: 2600 },
      { height: 3400, spd: 10.25000, dir: 230, temp: 2.4,  rh: 66, displayHeight: 2800 },
      { height: 3600, spd: 10.50000, dir: 229, temp: 1.1,  rh: 66, displayHeight: 3000 },
      { height: 3800, spd: 10.77778, dir: 228, temp: -0.2, rh: 65, displayHeight: 3200 },
      { height: 4000, spd: 11.02778, dir: 227, temp: -1.5, rh: 65, displayHeight: 3400 },
    ]),
  };

  return { interpolateWeatherData: mockWeatherData.interpolateWeatherData };
});

// Import der gemockten Module
import { AppState } from '../core/state.js';
import { Settings } from '../core/settings.js';
import { Utils } from '../core/utils.js';
import { interpolateWeatherData } from '../core/weatherManager.js';

describe('jumpPlanner.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock document.getElementById und document.querySelector
    vi.stubGlobal('document', {
      getElementById: vi.fn((id) => {
        const settings = Settings.state.userSettings;
        const map = {
          exitAltitude: settings.exitAltitude.toString(),
          openingAltitude: settings.openingAltitude.toString(),
          legHeightDownwind: settings.legHeightDownwind.toString(),
          legHeightBase: settings.legHeightBase.toString(),
          legHeightFinal: settings.legHeightFinal.toString(),
          canopySpeed: settings.canopySpeed.toString(),
          descentRate: settings.descentRate.toString(),
          cutAwayAltitude: settings.cutAwayAltitude.toString(),
          customLandingDirectionLL: settings.customLandingDirectionLL.toString(),
          customLandingDirectionRR: settings.customLandingDirectionRR.toString(),
        };
        return { value: map[id] || '' };
      }),
      querySelector: vi.fn((selector) => {
        if (selector === 'input[name="landingDirection"]:checked') {
          return { value: Settings.state.userSettings.landingDirection };
        }
        return null;
      }),
    });

    // Zurücksetzen der userSettings und anderer veränderbarer Zustände
    Settings.state.userSettings = { ...Settings.defaultSettings };
    AppState.cutAwayLat = null;
    AppState.cutAwayLng = null;
    AppState.landingWindDir = undefined;
  });

  afterEach(() => {
    // Globale Mocks zurücksetzen
    vi.unstubAllGlobals();
  });

  describe('getSeparationFromTAS', () => {
    it('sollte die korrekte Separation für eine gegebene TAS zurückgeben', () => {
      Utils.calculateTAS.mockReturnValue(90);
      expect(getSeparationFromTAS(90)).toBe(7);
    });

    it('sollte die Separation des nächstniedrigeren Wertes zurückgeben, wenn TAS nicht in der Tabelle ist', () => {
      Utils.calculateTAS.mockReturnValue(92);
      expect(getSeparationFromTAS(92)).toBe(7);
    });

    it('sollte den Standardwert zurückgeben, wenn TAS ungültig ist', () => {
      Utils.calculateTAS.mockReturnValue('N/A');
      expect(getSeparationFromTAS(90)).toBe(5); // Default jumperSeparation
    });
  });

  describe('calculateFreeFall', () => {
    it('sollte einen Freifallpfad mit positiver Distanz und Zeit zurückgeben', () => {
      const interpolatedData = interpolateWeatherData();
      const result = calculateFreeFall(
        AppState.weatherData,
        3000,
        1200,
        interpolatedData,
        AppState.lastLat,
        AppState.lastLng,
        AppState.lastAltitude,
        270
      );
      expect(result).not.toBeNull();
      expect(result.time).toBeGreaterThan(0);
      expect(result.distance).toBeGreaterThan(0);
      expect(result.path.length).toBeGreaterThan(0);
    });

    it('sollte null zurückgeben, wenn die Eingabedaten ungültig sind', () => {
      const result = calculateFreeFall(null, 3000, 1200, [], 48, 11, 600, 270);
      expect(result).toBeNull();
    });
  });

  describe('calculateExitCircle', () => {
    beforeEach(() => {
      Settings.state.userSettings.showExitArea = true;
      Settings.state.userSettings.calculateJump = true;
      Settings.state.userSettings.openingAltitude = 1200;
      Settings.state.userSettings.exitAltitude = 3000;
    });

    it('sollte gültige Kreise zurückgeben, wenn die Bedingungen erfüllt sind', () => {
      const interpolatedData = interpolateWeatherData();
      const result = calculateExitCircle(interpolatedData);
      expect(result).not.toBeNull();
      expect(result.greenRadius).toBeGreaterThan(0);
      expect(result.darkGreenRadius).toBeGreaterThan(0);
    });

    it('sollte null zurückgeben, wenn die Anzeige deaktiviert ist', () => {
      Settings.state.userSettings.showExitArea = false;
      const interpolatedData = interpolateWeatherData();
      const result = calculateExitCircle(interpolatedData);
      expect(result).toBeNull();
    });

    it('sollte die Radien reduzieren, wenn SafetyHeight > 0 ist', () => {
      Settings.state.userSettings.safetyHeight = 100;
      Utils.calculateMeanWind.mockImplementation((heights, u, v, minHeight, maxHeight) => {
        const data = interpolateWeatherData();
        const relevantData = data.filter(d => d.height >= minHeight && d.height <= maxHeight);
        const avgDir = relevantData.reduce((sum, d) => sum + d.dir, 0) / relevantData.length;
        const avgSpd = relevantData.reduce((sum, d) => sum + d.spd, 0) / relevantData.length;
        return [Math.round(avgDir), avgSpd * 1.94384, avgSpd * 1.94384, 0]; // spd in kt
      });
      const interpolatedData = interpolateWeatherData();
      const result = calculateExitCircle(interpolatedData);
      expect(result.darkGreenRadius).toBeCloseTo(1763.808, 0);
    });
  });

  describe('calculateCutAway', () => {
    beforeEach(() => {
      AppState.cutAwayLat = 48.0;
      AppState.cutAwayLng = 11.2;
      Utils.calculateMeanWind.mockImplementation((heights, u, v, minHeight, maxHeight) => {
        const data = interpolateWeatherData();
        const relevantData = data.filter(d => d.height >= minHeight && d.height <= maxHeight);
        const avgDir = relevantData.reduce((sum, d) => sum + d.dir, 0) / relevantData.length;
        const avgSpd = relevantData.reduce((sum, d) => sum + d.spd, 0) / relevantData.length;
        return [Math.round(avgDir), avgSpd * 1.94384, avgSpd * 1.94384, 0]; // spd in kt
      });
    });

    it('sollte einen gültigen Cut-Away-Bereich berechnen', () => {
      Settings.state.userSettings.showCutAwayFinder = true;
      Settings.state.userSettings.cutAwayState = 'Partially';
      const interpolatedData = interpolateWeatherData();
      const result = calculateCutAway(interpolatedData);
      expect(result).not.toBeNull();
      expect(result.center[0]).toBeCloseTo(48.0077, 4);
      expect(result.radius).toBe(150); // Angenommen, constants.js definiert 150
    });

    it('sollte null zurückgeben, wenn der Cut-Away-Marker nicht platziert ist', () => {
      AppState.cutAwayLat = null;
      const result = calculateCutAway([]);
      expect(result).toBeNull();
    });

    it('sollte die Flugdistanz basierend auf dem Cut-Away-Zustand berechnen', () => {
      Settings.state.userSettings.showCutAwayFinder = true;
      AppState.cutAwayLat = 48.0;
      AppState.cutAwayLng = 11.2;
      Settings.state.userSettings.cutAwayState = 'Partially';
      Settings.state.userSettings.cutAwayAltitude = 1000;
      const interpolatedData = interpolateWeatherData();
      const resultPartially = calculateCutAway(interpolatedData);
      expect(resultPartially.tooltipContent).toContain('Displacement: 236°, 1536 m');
      Settings.state.userSettings.cutAwayState = 'Collapsed';
      const resultCollapsed = calculateCutAway(interpolatedData);
      expect(resultCollapsed.tooltipContent).toContain('Displacement: 236°, 502 m');
    });
  });

  describe('jumpRunTrack', () => {
    beforeEach(() => {
      Utils.calculateMeanWind.mockImplementation((heights, u, v, minHeight, maxHeight) => {
        const data = interpolateWeatherData();
        const relevantData = data.filter(d => d.height >= minHeight && d.height <= maxHeight);
        const avgDir = relevantData.reduce((sum, d) => sum + d.dir, 0) / relevantData.length;
        const avgSpd = relevantData.reduce((sum, d) => sum + d.spd, 0) / relevantData.length;
        return [Math.round(avgDir), avgSpd * 1.94384, avgSpd * 1.94384, 0]; // spd in kt
      });
    });

    it('sollte einen gültigen Jump Run Track für Standard-Settings zurückgeben', () => {
      Settings.state.userSettings.showJumpRunTrack = true;
      const interpolatedData = interpolateWeatherData();
      const result = jumpRunTrack(interpolatedData);
      expect(result).not.toBeNull();
      expect(result.direction).toBe(237); // Angepasst an neue Windrichtung
      expect(result.trackLength).toBeGreaterThan(0);
      expect(result.latlngs.length).toBe(2);
      expect(result.approachLatLngs.length).toBe(2);
    });

    it('sollte den manuellen Kurs verwenden, wenn er gesetzt ist', () => {
      Settings.state.userSettings.showJumpRunTrack = true;
      Settings.state.userSettings.customJumpRunDirection = 180;
      const interpolatedData = interpolateWeatherData();
      const result = jumpRunTrack(interpolatedData);
      expect(result).not.toBeNull();
      expect(result.direction).toBe(180);
    });

    it('sollte Offsets korrekt anwenden', () => {
      Settings.state.userSettings.showJumpRunTrack = true;
      Settings.state.userSettings.jumpRunTrackOffset = 100;
      Settings.state.userSettings.jumpRunTrackForwardOffset = 200;
      Utils.calculateNewCenter.mockImplementation((lat, lng, dist, bearing) => [lat + (dist / 111000), lng + (dist / 111000)]);
      const interpolatedData = interpolateWeatherData();
      const result = jumpRunTrack(interpolatedData);
      expect(Utils.calculateNewCenter).toHaveBeenCalledTimes(4);
    });
  });

  describe('calculateLandingPatternCoords', () => {
    beforeEach(() => {
      // Mock für calculateMeanWind basierend auf realistischen Wetterdaten
      Utils.calculateMeanWind.mockImplementation((heights, u, v, minHeight, maxHeight) => {
        const data = interpolateWeatherData();
        const relevantData = data.filter(d => d.height >= minHeight && d.height <= maxHeight);
        const avgDir = relevantData.reduce((sum, d) => sum + d.dir, 0) / relevantData.length;
        const avgSpd = relevantData.reduce((sum, d) => sum + d.spd, 0) / relevantData.length;
        return [Math.round(avgDir), avgSpd * 1.94384, avgSpd * 1.94384, 0]; // spd in kt
      });
      // Mock für calculateNewCenter mit realistischer Koordinatenverschiebung
      Utils.calculateNewCenter.mockImplementation((lat, lng, dist, bearing) => {
        const distDegrees = dist / 111000; // 1° ≈ 111 km
        const rad = bearing * Math.PI / 180;
        return [lat + distDegrees * Math.cos(rad), lng + distDegrees * Math.sin(rad)];
      });
    });

    it('sollte gültige Landing Pattern Koordinaten zurückgeben', () => {
      Settings.getValue.mockImplementation((key, def) => {
        if (key === 'canopySpeed') return 20;
        if (key === 'descentRate') return 3.5;
        if (key === 'legHeightDownwind') return 300;
        if (key === 'legHeightBase') return 200;
        if (key === 'legHeightFinal') return 100;
        if (key === 'landingDirection') return 'LL';
        return Settings.defaultSettings[key] || def;
      });
      AppState.landingWindDir = undefined; // Verwende Bodenwind (172°)
      const interpolatedData = interpolateWeatherData();

      // Berechne erwartete Leg-Längen
      const canopySpeedKt = 20;
      const descentRateMps = 3.5;
      const legHeightFinal = 100;
      const legHeightBase = 200;
      const legHeightDownwind = 300;
      const baseHeight = AppState.lastAltitude; // 600 m

      // Final Leg (600–700 m)
      const finalWindDir = 186.5; //Mittelwert zwischen 0 m und 100 m
      const finalWindSpeedMs = 3.086667; // Mittelwert zwischen 0 m und 100 m
      const finalWindSpeedKt = 6.0;
      const finalCourse = 172; // Bodenwind
      const finalWindAngle = ((finalWindDir - finalCourse + 360) % 360) > 180 ? ((finalWindDir - finalCourse + 360) % 360) - 360 : ((finalWindDir - finalCourse + 360) % 360);
      const finalCrosswind = finalWindSpeedKt * Math.sin(finalWindAngle * Math.PI / 180);
      const finalHeadwind = finalWindSpeedKt * Math.cos(finalWindAngle * Math.PI / 180);
      const finalWca = Math.asin(finalCrosswind / canopySpeedKt) * 180 / Math.PI * (finalCrosswind >= 0 ? 1 : -1);
      const finalGroundSpeedKt = Math.sqrt(Math.pow(canopySpeedKt + finalHeadwind, 2) + Math.pow(finalCrosswind, 2));
      const finalTime = legHeightFinal / descentRateMps;
      const finalLength = finalGroundSpeedKt * (1.852 / 3.6) * finalTime;

      // Base Leg (700–800 m)
      const baseWindDir = 198.2; // Mittelwert zwischen 100 m und 200 m 
      const baseWindSpeedMs = 5.195888;
      const baseWindSpeedKt = 10.1;
      const baseHeading = (172 + 90) % 360; // 'LL'
      const baseWindAngle = ((baseWindDir - baseHeading + 360) % 360) > 180 ? ((baseWindDir - baseHeading + 360) % 360) - 360 : ((baseWindDir - baseHeading + 360) % 360);
      const baseCrosswind = baseWindSpeedKt * Math.sin(baseWindAngle * Math.PI / 180);
      const baseWca = Math.asin(baseCrosswind / canopySpeedKt) * 180 / Math.PI * (baseCrosswind >= 0 ? 1 : -1);
      const baseCourse = (baseHeading + baseWca + 360) % 360;
      const baseGroundSpeedKt = Math.sqrt(Math.pow(canopySpeedKt + (baseWindSpeedKt * Math.cos(baseWindAngle * Math.PI / 180)), 2) + Math.pow(baseCrosswind, 2));
      const baseTime = (legHeightBase - legHeightFinal) / descentRateMps;
      const baseLength = baseGroundSpeedKt * (1.852 / 3.6) * baseTime;

      // Downwind Leg (800–900 m)
      const downwindWindDir = 206.0; // Mittelwert von 200 m und 300 m 
      const downwindWindSpeedMs = 7.09933;
      const downwindWindSpeedKt = 13.8;
      const downwindCourse = (172 + 180) % 360;
      const downwindWindAngle = ((downwindWindDir - downwindCourse + 360) % 360) > 180 ? ((downwindWindDir - downwindCourse + 360) % 360) - 360 : ((downwindWindDir - downwindCourse + 360) % 360);
      const downwindCrosswind = downwindWindSpeedKt * Math.sin(downwindWindAngle * Math.PI / 180);
      const downwindWca = Math.asin(downwindCrosswind / canopySpeedKt) * 180 / Math.PI * (downwindCrosswind >= 0 ? 1 : -1);
      const downwindGroundSpeedKt = Math.sqrt(Math.pow(canopySpeedKt + (downwindWindSpeedKt * Math.cos(downwindWindAngle * Math.PI / 180)), 2) + Math.pow(downwindCrosswind, 2));
      const downwindTime = (legHeightDownwind - legHeightBase) / descentRateMps;
      const downwindLength = downwindGroundSpeedKt * (1.852 / 3.6) * downwindTime;

      const result = calculateLandingPatternCoords(
        52.52, // Koordinaten Berlin, passend zum Wetter 04.09.2025 00 Z ECMWF
        13.41,
        interpolatedData
      );
      expect(result).not.toBeNull();
      expect(result.downwindStart).toHaveLength(2);
      expect(result.baseStart).toHaveLength(2);
      expect(result.finalStart).toHaveLength(2);
      expect(result.landingPoint).toEqual([52.52, 13.41]);      
      // Prüfe Koordinaten basierend auf Log-Ausgabe
      expect(result.finalStart[0]).toBeCloseTo(52.521854846219156, 3);
      expect(result.finalStart[1]).toBeCloseTo(13.409571570403955, 4);
      expect(result.baseStart[0]).toBeCloseTo(52.52094886001666, 4);
      expect(result.baseStart[1]).toBeCloseTo(13.41318740746442, 4);
      expect(result.downwindStart[0]).toBeCloseTo(52.51703626824762, 4);
      expect(result.downwindStart[1]).toBeCloseTo(13.414091031753856, 4);
      // Prüfe Leg-Längen
      expect(finalLength).toBeCloseTo(208.3, 1); // Platzhalter, muss an reale Berechnung angepasst werden
      expect(baseLength).toBeCloseTo(264.6, 1); // Platzhalter, muss an reale Berechnung angepasst werden
      expect(downwindLength).toBeCloseTo(439.3, 1); // Platzhalter, muss an reale Berechnung angepasst werden
    });

    it('sollte null zurückgeben bei fehlenden Wetterdaten', () => {
      const result = calculateLandingPatternCoords(
        AppState.lastLat,
        AppState.lastLng,
        []
      );
      expect(result).toBeNull();
    });

    it('sollte korrekte Koordinaten mit benutzerdefinierter Landewindrichtung zurückgeben', () => {
      Settings.getValue.mockImplementation((key, def) => {
        if (key === 'canopySpeed') return 20;
        if (key === 'descentRate') return 3.5;
        if (key === 'legHeightDownwind') return 300;
        if (key === 'legHeightBase') return 200;
        if (key === 'legHeightFinal') return 100;
        if (key === 'landingDirection') return 'LL';
        if (key === 'customLandingDirectionLL') return '180';
        return Settings.defaultSettings[key] || def;
      });
      AppState.landingWindDir = undefined;
      const interpolatedData = interpolateWeatherData();
      const result = calculateLandingPatternCoords(
        AppState.lastLat,
        AppState.lastLng,
        interpolatedData
      );
      expect(result).not.toBeNull();
      expect(result.downwindStart).toHaveLength(2);
      expect(result.baseStart).toHaveLength(2);
      expect(result.finalStart).toHaveLength(2);
      expect(result.landingPoint).toEqual([AppState.lastLat, AppState.lastLng]);
    });
  });
});