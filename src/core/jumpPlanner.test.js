import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSeparationFromTAS, calculateFreeFall, calculateExitCircle, calculateCanopyCircles, jumpRunTrack, calculateCutAway, calculateLandingPatternCoords } from './jumpPlanner.js';
import { JUMPER_SEPARATION_TABLE, CONVERSIONS, CUTAWAY_VERTICAL_SPEEDS_MPS } from './constants.js';

// Mock-Aufrufe direkt mit Objekten, ohne Top-Level-Variablen außerhalb von vi.mock
vi.mock('../core/state.js', () => {
    const mockAppState = {
        lastLat: 52.52,
        lastLng: 13.41,
        lastAltitude: 38, // <-- KORREKTUR: Dies ist die richtige Höhe in Metern
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
    const calculateNewCenter = (lat, lng, dist, bearing) => {
        const R = 6371000;
        const lat1 = lat * Math.PI / 180;
        const lng1 = lng * Math.PI / 180;
        const bearingRad = bearing * Math.PI / 180;
        const delta = dist / R;
        const lat2 = Math.asin(Math.sin(lat1) * Math.cos(delta) + Math.cos(lat1) * Math.sin(delta) * Math.cos(bearingRad));
        const lng2 = lng1 + Math.atan2(Math.sin(bearingRad) * Math.sin(delta) * Math.cos(lat1), Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2));
        const newLat = lat2 * 180 / Math.PI;
        const newLng = lng2 * 180 / Math.PI;
        const normalizedLng = ((newLng + 540) % 360) - 180;
        return [newLat, normalizedLng];
    };

    const mockUtils = {
        calculateTAS: vi.fn(),
        calculateNewCenter: vi.fn(calculateNewCenter),
        calculateBearing: vi.fn(() => 270),
        calculateMeanWind: vi.fn((heights, u, v, minHeight, maxHeight) => {
            if (Math.round(minHeight) === 38 && Math.round(maxHeight) === 138) { return [186.5, 6.0, 0, 0]; }
            if (Math.round(minHeight) === 138 && Math.round(maxHeight) === 238) { return [198.2, 10.1, 0, 0]; }
            if (Math.round(minHeight) === 238 && Math.round(maxHeight) === 338) { return [206.0, 13.8, 0, 0]; }
            return [0, 0, 0, 0];
        }),
        calculateFlightParameters: vi.fn((course, windDir, windSpeedKt, airspeedKt) => {
            if (Math.round(course) === 172) { return { crosswind: 1.7, headwind: 5.8, wca: 4.3, groundSpeed: 14.2 }; }
            if (Math.round(course) === 292) { return { crosswind: -30.4, headwind: -0.7, wca: -30.2, groundSpeed: 18.0 }; } // WCA korrigiert auf -30.2
            if (Math.round(course) === 352) { return { crosswind: -13.1, headwind: -4.3, wca: -22.7, groundSpeed: 29.9 }; } // WCA korrigiert auf -22.7
            return { crosswind: 0, headwind: 0, wca: 0, groundSpeed: 0 };
        }),
        calculateCourseFromHeading: vi.fn((heading, windDir, windSpeedKt, airspeedKt) => {
            if (Math.round(heading) === 172) { return { trueCourse: 172.0, groundSpeed: 14.2 }; }
            if (Math.round(heading) === 262) { return { trueCourse: 292.4, groundSpeed: 18.0 }; }
            if (Math.round(heading) === 352) { return { trueCourse: 352.0, groundSpeed: 29.9 }; }
            return { trueCourse: 0, groundSpeed: 0 };
        }),
        convertWind: vi.fn((val, to, from) => {
            if (from === 'm/s' && to === 'kt') return val * 1.94384;
            if (from === 'kt' && to === 'm/s') return val / 1.94384;
            if (from === 'km/h' && to === 'kt') return val / 1.852;
            if (from === 'kt' && to === 'km/h') return val * 1.852;
            return val;
        }),
        convertFeetToMeters: vi.fn((ft) => ft / 3.28084),
        convertHeight: vi.fn((m, unit) => (unit === 'ft' ? m * 3.28084 : m)),
        isValidLatLng: vi.fn(() => true),
        linearInterpolate: vi.fn(() => 10),
        windSpeed: vi.fn(() => 10),
        windDirection: vi.fn(() => 270),
        handleError: vi.fn(),
        getAltitude: vi.fn(() => 38),
        calculateWindAngle: vi.fn((trueCourse, windDirection) => {
            let angle = mockUtils.normalizeAngle(windDirection - trueCourse);
            if (angle > 180) angle -= 360;
            return angle;
        }),
        normalizeAngle: vi.fn((angle) => ((angle % 360) + 360) % 360),
        calculateWindComponents: vi.fn((windSpeedKt, windAngle) => ({
            crosswind: windSpeedKt * Math.sin(windAngle * Math.PI / 180),
            headwind: windSpeedKt * Math.cos(windAngle * Math.PI / 180),
        })),
        calculateWCA: vi.fn((crosswind, speed) => Math.asin(crosswind / speed) * 180 / Math.PI),
        debounce: vi.fn((fn) => fn),
    };

    return { Utils: mockUtils };
});

vi.mock('../core/weatherManager.js', () => {
    const mockWeatherData = {
        interpolateWeatherData: vi.fn(() => [
            { height: 0, spd: 2.11111, dir: 172, temp: 17.7, rh: 77, displayHeight: -600 },
            { height: 200, spd: 6.33333, dir: 201, temp: 18.3, rh: 69, displayHeight: -400 },
            { height: 400, spd: 9.63889, dir: 216, temp: 18.9, rh: 62, displayHeight: -200 },
            { height: 600, spd: 11.41667, dir: 224, temp: 18.5, rh: 60, displayHeight: 0 },
            { height: 800, spd: 11.22222, dir: 231, temp: 17.0, rh: 63, displayHeight: 200 },
            { height: 1000, spd: 10.52778, dir: 236, temp: 15.7, rh: 67, displayHeight: 400 },
            { height: 1200, spd: 9.72222, dir: 239, temp: 14.3, rh: 70, displayHeight: 600 },
            { height: 1400, spd: 8.94444, dir: 242, temp: 13.0, rh: 73, displayHeight: 800 },
            { height: 1600, spd: 8.86111, dir: 242, temp: 12.1, rh: 72, displayHeight: 1000 },
            { height: 1800, spd: 9.00000, dir: 242, temp: 11.4, rh: 70, displayHeight: 1200 },
            { height: 2000, spd: 9.11111, dir: 241, temp: 10.5, rh: 68, displayHeight: 1400 },
            { height: 2200, spd: 9.22222, dir: 239, temp: 9.4, rh: 68, displayHeight: 1600 },
            { height: 2400, spd: 9.36111, dir: 237, temp: 8.3, rh: 67, displayHeight: 1800 },
            { height: 2600, spd: 9.50000, dir: 236, temp: 7.2, rh: 67, displayHeight: 2000 },
            { height: 2800, spd: 9.63889, dir: 234, temp: 6.1, rh: 66, displayHeight: 2200 },
            { height: 3000, spd: 9.77778, dir: 232, temp: 5.0, rh: 66, displayHeight: 2400 },
            { height: 3200, spd: 10.00000, dir: 231, temp: 3.8, rh: 66, displayHeight: 2600 },
            { height: 3400, spd: 10.25000, dir: 230, temp: 2.4, rh: 66, displayHeight: 2800 },
            { height: 3600, spd: 10.50000, dir: 229, temp: 1.1, rh: 66, displayHeight: 3000 },
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
        vi.resetAllMocks();  // Änderung: Reset Implementierungen und Historie

        // NEU: Setze die Standard-Mock-Implementation für calculateMeanWind vor jedem Test neu,
        // um sicherzustellen, dass Überschreibungen in einzelnen Tests nicht persistieren.
        Utils.calculateMeanWind.mockImplementation((heights, u, v, minHeight, maxHeight) => {
            if (Math.round(minHeight) === 38 && Math.round(maxHeight) === 138) { return [186.5, 6.0, 0, 0]; }
            if (Math.round(minHeight) === 138 && Math.round(maxHeight) === 238) { return [198.2, 10.1, 0, 0]; }
            if (Math.round(minHeight) === 238 && Math.round(maxHeight) === 338) { return [206.0, 13.8, 0, 0]; }
            return [0, 0, 0, 0];
        });

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
        AppState.landingWindDir = 172; // KORREKTUR: Auf den korrekten Bodenwind setzen
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
            expect(result.center[0]).toBeCloseTo(48.00999, 4);
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
            expect(resultPartially.tooltipContent).toContain('Displacement: 222°, 1492 m');
            Settings.state.userSettings.cutAwayState = 'Collapsed';
            const resultCollapsed = calculateCutAway(interpolatedData);
            expect(resultCollapsed.tooltipContent).toContain('Displacement: 222°, 487 m');
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
            expect(result.direction).toBe(225); // Angepasst an neue Windrichtung
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
        it('sollte die Landing Pattern Koordinaten und Werte korrekt berechnen', () => {
            const interpolatedData = interpolateWeatherData();
            const consoleSpy = vi.spyOn(console, 'log');

            const result = calculateLandingPatternCoords(
                52.52,
                13.41,
                interpolatedData
            );

            expect(result).not.toBeNull();
            expect(result.landingPoint).toEqual([52.52, 13.41]);

            const logs = consoleSpy.mock.calls.map(call => call[0]);
            const finalLog = logs.find(log => log.includes('Final Leg:'));
            const baseLog = logs.find(log => log.includes('Base Leg:'));
            const downwindLog = logs.find(log => log.includes('Downwind Leg:'));

            expect(finalLog).toContain('Wind: 186.5° @ 6.0kt');
            expect(finalLog).toContain('Course: 172.0°');
            expect(finalLog).toContain('WCA: 4.3°');
            expect(finalLog).toContain('GS: 14.2kt');
            expect(finalLog).toContain('HW: 5.8kt');
            expect(finalLog).toContain('Length: 208.7m');

            expect(baseLog).toContain('Wind: 198.2° @ 10.1kt');
            expect(baseLog).toContain('Course: 292.4°');
            expect(baseLog).toContain('WCA: 30.2°');
            expect(baseLog).toContain('GS: 18.0kt');
            expect(baseLog).toContain('HW: -0.7kt');
            expect(baseLog).toContain('Length: 264.6m');

            expect(downwindLog).toContain('Wind: 206.0° @ 13.8kt');
            expect(downwindLog).toContain('Course: 352.0°');
            expect(downwindLog).toContain('WCA: 22.7°');
            expect(downwindLog).toContain('GS: 29.9kt');
            expect(downwindLog).toContain('HW: -11.4kt');
            expect(downwindLog).toContain('Length: 439.5m');

            expect(result.finalStart[0]).toBeCloseTo(52.521858773203164, 4);
            expect(result.finalStart[1]).toBeCloseTo(13.409570663316345, 4);
            expect(result.baseStart[0]).toBeCloseTo(52.52095201908039, 4);
            expect(result.baseStart[1]).toBeCloseTo(13.413185980704839, 4);
            expect(result.downwindStart[0]).toBeCloseTo(52.51703811831327, 4);
            expect(result.downwindStart[1]).toBeCloseTo(13.414089907348853, 4);

            consoleSpy.mockRestore();
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
                if (key === 'landingDirection') return 'LL';
                if (key === 'customLandingDirectionLL') return 180;
                return Settings.defaultSettings[key] || def;
            });

            const interpolatedData = interpolateWeatherData();
            const result = calculateLandingPatternCoords(52.52, 13.41, interpolatedData);

            expect(result).not.toBeNull();
            expect(result.downwindStart).toHaveLength(2);
            expect(result.baseStart).toHaveLength(2);
            expect(result.finalStart).toHaveLength(2);
            expect(result.landingPoint).toEqual([52.52, 13.41]);
        });
    });
});