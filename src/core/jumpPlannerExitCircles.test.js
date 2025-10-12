import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as jumpPlanner from './jumpPlanner.js';
import { AppState } from '../core/state.js';
import { Settings } from './settings.js';
import * as weatherManager from './weatherManager.js';

// Mocks for dependencies
vi.mock('../core/state.js', () => ({
    AppState: {
        lastLat: 52.52,
        lastLng: 13.41,
        lastAltitude: 38,
        weatherData: {
            time: ['2025-09-04T00:00:00Z'],
            surface_pressure: [1007.2],
            wind_direction_10m: [177],
        },
        map: {
            distance: vi.fn(() => 1000),
            getZoom: vi.fn(() => 14),
        },
    },
}));

vi.mock('../core/settings.js', () => ({
    Settings: {
        state: {
            userSettings: {
                showExitArea: true,
                calculateJump: true,
                exitAltitude: 3000,
                openingAltitude: 1200,
                legHeightDownwind: 300,
                legHeightBase: 200,
                legHeightFinal: 100,
                descentRate: 3.5,
                canopySpeed: 20,
                safetyHeight: 0,
                customJumpRunDirection: null,
                landingDirection: 'LL',
                aircraftSpeedKt: 90,
            },
        },
        getValue: vi.fn((key) => Settings.state.userSettings[key]),
    },
    getInterpolationStep: () => 100,
}));

// --- UPDATED MOCK with REALISTIC DATA ---
vi.mock('../core/weatherManager.js', () => ({
    interpolateWeatherData: vi.fn(() => [
        // This is the full, detailed data from your initial problem description
        { "height": 38, "temp": 17.7, "dir": 177, "spd": 7.6, "rh": 76 },
        { "height": 138, "temp": 18.9, "dir": 228, "spd": 40.3, "rh": 59 },
        { "height": 238, "temp": 17.4, "dir": 231, "spd": 38.3, "rh": 68 },
        { "height": 338, "temp": 16.0, "dir": 235, "spd": 36.4, "rh": 68 },
        { "height": 1038, "temp": 13.2, "dir": 243, "spd": 33.2, "rh": 76 },
        { "height": 3038, "temp": 4.6, "dir": 233, "spd": 35.0, "rh": 66 },
    ]),
}));

vi.mock('../core/utils.js', async (importOriginal) => {
    const originalUtilsModule = await importOriginal();
    return {
        ...originalUtilsModule,
        Utils: class extends originalUtilsModule.Utils {
            static calculateTAS = vi.fn(() => 104.47);
            // --- UPDATED MOCK with ACCURATE VALUES ---
            static calculateMeanWind = vi.fn((heights, u, v, minHeight, maxHeight) => {
                // Values from your "golden" console log
                if (Math.round(minHeight) === 338 && Math.round(maxHeight) === 1038) {
                    return [229.3, 10.07, 0, 0];
                }
                if (Math.round(minHeight) === 38 && Math.round(maxHeight) === 1038) {
                    return [225.37, 8.42, 0, 0];
                }
                // Fallback values for calculateLandingPatternCoords
                if (Math.round(minHeight) === 38 && Math.round(maxHeight) === 138) return [188.1, 6.6, 0, 0];
                if (Math.round(minHeight) === 138 && Math.round(maxHeight) === 238) return [201.4, 10.5, 0, 0];
                if (Math.round(minHeight) === 238 && Math.round(maxHeight) === 338) return [213.6, 13.3, 0, 0];
                return [225, 10, 0, 0];
            });
            static calculateFlightParameters = vi.fn((course, windDir, windSpeedKt, airspeedKt) => {
                // Values from your "golden" console log for calculateLandingPatternCoords
                if (Math.round(course) === 177) return { groundSpeed: 13.5 };
                if (Math.round(course) === 357) return { groundSpeed: 30.7 };
                return { groundSpeed: 18.4 };
            });
            static calculateCourseFromHeading = vi.fn(() => ({ trueCourse: 298.3, groundSpeed: 18.4 }));
        },
    };
});

describe('jumpPlanner.js', () => {
    describe('calculateExitCircle', () => {
        beforeEach(() => {
            vi.restoreAllMocks();
            vi.stubGlobal('document', {
                getElementById: vi.fn((id) => ({ value: Settings.state.userSettings[id]?.toString() })),
                querySelector: vi.fn(() => ({ value: Settings.state.userSettings.landingDirection })),
            });
        });

        it('should calculate the exit circle coordinates with high precision', () => {
            const interpolatedData = weatherManager.interpolateWeatherData();
            const result = jumpPlanner.calculateExitCircle(interpolatedData);

            expect(result).not.toBeNull();

            // --- FINAL ASSERTIONS ---
            // Assert against the "golden" values from your application's log
            expect(result.freeFallDistance).toBeCloseTo(165, 0);
            expect(result.greenLatFull).toBeCloseTo(52.50375, 3);
            expect(result.greenLngFull).toBeCloseTo(13.38344639950435, 3);
            expect(result.greenLat).toBeCloseTo(52.503541916446494, 3);
            expect(result.greenLng).toBeCloseTo(13.389687485353647, 3);
        });

        it('sollte die Radien reduzieren, wenn safetyHeight > 0 ist', () => {
            Settings.state.userSettings.safetyHeight = 300;
            const interpolatedData = weatherManager.interpolateWeatherData();
            const result = jumpPlanner.calculateExitCircle(interpolatedData);
            expect(result.greenRadius).toBeCloseTo(2057.78, 1); // horizontalCanopyDistanceFull - reduction = 2939.68 - 881.9 = 2057.78
            expect(result.darkGreenRadius).toBeCloseTo(1175.87, 1); // horizontalCanopyDistance - reduction = 2057.78 - 881.9 = 1175.87
        });
    });
});