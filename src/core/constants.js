/**
 * @file constants.js
 * @description Diese Datei enthält alle anwendungsweiten Konstanten.
 * Sie ist die zentrale Quelle für "magische Zahlen", Konfigurationen und Standardwerte,
 * um die Wartbarkeit und Konsistenz des Codes zu gewährleisten.
 */

// Die Imports für die Bilder sind eine gute Lösung, da sie vom Build-Tool verarbeitet werden.
import defaultMarkerUrl from '/icon-48.png';
import cutawayMarkerUrl from '/schere_purple.png';
import airplaneMarkerUrl from '/airplane_orange.png';

// ===================================================================
// Skydive & Flug-Parameter
// ===================================================================

/**
 * Definiert die empfohlene zeitliche Separation (in Sekunden) zwischen Springern
 * basierend auf der True Airspeed (TAS) des Flugzeugs in Knoten.
 * @type {Object.<number, number>}
 * @property {number} key - Die wahre Fluggeschwindigkeit (TAS) in Knoten.
 * @property {number} value - Die Separation in Sekunden.
 */
export const JUMPER_SEPARATION_TABLE = {
    135: 5, 130: 5, 125: 5, 120: 5, 115: 5, 110: 5, 105: 5,
    100: 6, 95: 7, 90: 7, 85: 7, 80: 8, 75: 8, 70: 9,
    65: 10, 60: 10, 55: 11, 50: 12, 45: 14, 40: 15,
    35: 17, 30: 20, 25: 24, 20: 30, 15: 40, 10: 60, 5: 119
};

/**
 * Standardwerte und physikalische Annahmen für die Freifall-Simulation.
 */
export const FREEFALL_PHYSICS = {
    TERMINAL_VELOCITY_VERTICAL_MPS: 50,   // m/s, typische vertikale Endgeschwindigkeit Mini: Belly 50-55 m/s, Headdown 69-77 m/s
    GRAVITY_ACCELERATION: 9.81,           // m/s², Erdbeschleunigung
    HORIZONTAL_DRAG_TAU_SECONDS: 5,       // Sekunden, Zeitkonstante für den Abbau der horiz. Geschwindigkeit
    DEFAULT_AREA_VERTICAL: 0.5,           // m², angenommene Fläche für vertikalen Luftwiderstand
    DEFAULT_AREA_HORIZONTAL: 0.5,         // m², angenommene Fläche für horizontalen Luftwiderstand
    DEFAULT_MASS_KG: 80,                  // kg, angenommenes Gewicht des Springers
    DEFAULT_DRAG_COEFFICIENT: 1,          // cw-Wert, dimensionslos
};

/**
 * Puffer in Metern, der von der Öffnungshöhe abgezogen wird, um den Punkt zu simulieren,
 * an dem der Schirm vollständig geöffnet ist und trägt.
 */
export const CANOPY_OPENING_BUFFER_METERS = 200;

/**
 * Vertikale Sinkgeschwindigkeiten (in m/s) für verschiedene Zustände eines nicht mehr tragenden Hauptschirms.
 */
export const CUTAWAY_VERTICAL_SPEEDS_MPS = {
    OPEN: 4.1,       // Vollständig geöffnet, aber unsteuerbar
    PARTIALLY: 12.8, // Teilweise kollabiert
    COLLAPSED: 39.2  // Vollständig kollabiert ("Streamer")
};

/**
 * Radius des Unsicherheitskreises (in Metern) für die Cutaway-Visualisierung.
 */
export const CUTAWAY_VISUALIZATION_RADIUS_METERS = 150;

/**
 * Standardwerte für die Berechnung des Jump Run Tracks.
 */
export const JUMP_RUN_DEFAULTS = {
    MIN_TRACK_LENGTH_M: 100,
    MAX_TRACK_LENGTH_M: 10000,
    MIN_APPROACH_LENGTH_M: 100,
    MAX_APPROACH_LENGTH_M: 20000,
    APPROACH_TIME_SECONDS: 120 // 2 Minuten für den Anflug
};


// ===================================================================
// API & Externe Dienste
// ===================================================================

/**
 * Konfiguration der Wettermodelle für die Open-Meteo API.
 * @property {string[]} LIST - Eine Liste aller potenziell abzufragenden Modelle.
 * @property {Object.<string, string>} API_MAP - Mappt den internen Modellnamen auf den Identifier,
 * den die `meta.json` der API verwendet, um den letzten Model-Run zu finden.
 */
export const WEATHER_MODELS = {
    LIST: [
        'icon_seamless',
        'icon_global',
        'icon_eu',
        'icon_d2',
        'ecmwf_ifs025',
        'ecmwf_aifs025_single',
        'gfs_seamless',
        'gfs_global',
        'gfs_hrrr',
        'arome_france',
        'gem_hrdps_continental',
        'gem_regional'
    ],
    API_MAP: {
        'icon_seamless': 'dwd_icon',
        'icon_global': 'dwd_icon',
        'icon_eu': 'dwd_icon_eu',
        'icon_d2': 'dwd_icon_d2',
        'ecmwf_ifs025': 'ecmwf_ifs025',
        'ecmwf_aifs025_single': 'ecmwf_aifs025_single',
        'gfs_seamless': 'ncep_gfs013',
        'gfs_global': 'ncep_gfs025',
        'gfs_hrrr': 'ncep_hrrr_conus',
        'arome_france': 'meteofrance_arome_france0025',
        'gem_hrdps_continental': 'cmc_gem_hrdps',
        'gem_regional': 'cmc_gem_rdps'
    }
};

/**
 * URLs für die Open-Meteo APIs.
 */
export const API_URLS = {
    FORECAST: 'https://api.open-meteo.com/v1/forecast',
    HISTORICAL: 'https://historical-forecast-api.open-meteo.com/v1/forecast',
};

// ===================================================================
// Physikalische & Mathematische Konstanten
// ===================================================================

/** Umrechnungsfaktoren für verschiedene Einheiten. */
export const CONVERSIONS = {
    METERS_TO_FEET: 3.28084,
    FEET_TO_METERS: 0.3048,
    KNOTS_TO_MPS: 0.514444,
    KNOTS_TO_KMH: 1.852,
    MPH_TO_KMH: 1.60934,
    CELSIUS_TO_KELVIN: 273.15,
    MOLAR_MASS_AIR: 0.0289644, // kg/mol
};

/** Physikalische Konstanten. */
export const PHYSICAL_CONSTANTS = {
    MOLAR_MASS_AIR: 0.0289644, // kg/mol
    UNIVERSAL_GAS_CONSTANT: 8.31446261815324, // J/(mol·K)
}

/** Konstanten der Internationalen Standardatmosphäre (ISA). */
export const ISA_CONSTANTS = { // International Standard Atmosphere
    SEA_LEVEL_DENSITY: 1.225,      // kg/m³
    LAPSE_RATE: 0.0065,            // K/m, Temperaturabnahme mit der Höhe
    SEA_LEVEL_TEMP_KELVIN: 288.15, // K, Temperatur auf Meereshöhe
    GRAVITY: 9.80665,              // m/s², Erdbeschleunigung
    GAS_CONSTANT_AIR: 287.05,      // J/(kg·K), spezifische Gaskonstante für trockene Luft
};

/** Koeffizienten für die Magnus-Formel zur Taupunktberechnung. */
export const DEWPOINT_COEFFICIENTS = {
    A_LIQUID: 17.27,
    B_LIQUID: 237.7,
    A_ICE: 21.87,
    B_ICE: 265.5,
};

/** Mittlerer Erdradius in Metern. */
export const EARTH_RADIUS_METERS = 6371000;

/** Schwellenwerte für die Beaufort-Skala in Knoten. */
export const BEAUFORT = {
    KNOT_THRESHOLDS: [1, 4, 7, 11, 17, 22, 28, 34, 41, 48, 56, 64],
    BEAUFORT_THRESHOLDS: [0, 1, 3, 6, 10, 16, 21, 27, 33, 40, 47, 55, 63],
};

/** Standard-Drucklevel, die von der Wetter-API abgefragt werden. */
export const STANDARD_PRESSURE_LEVELS = [1000, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200];


// ===================================================================
// UI, Visualisierung & App-Verhalten
// ===================================================================

/** Standardwerte für die Benutzeroberfläche und das allgemeine App-Verhalten. */
export const UI_DEFAULTS = {
    MESSAGE_TIMEOUT_MS: 3000,
    MOBILE_BREAKPOINT_PX: 768,
    DEFAULT_MAP_CENTER: [48.0179, 11.1923], // Standard-Mittelpunkt der Karte
    DEFAULT_MAP_ZOOM: 11,
    GEOLOCATION_TIMEOUT_MS: 20000,
    GEOLOCATION_ACCURACY_THRESHOLD_M: 500,
    MIN_ZOOM: 11,                          // Minimaler Zoom für die Anzeige von Overlays
    MAX_ZOOM: 14,                          // Maximaler Zoom für die Anzeige von Overlays
    LANDING_PATTERN_MIN_ZOOM: 14           // Minimaler Zoom für die Anzeige des Landemusters
};

/** Einstellungen für die Glättung von Live-Tracking-Daten. */
export const SMOOTHING_DEFAULTS = {
    MIN_TIME_DIFF_FOR_SPEED_CALC_S: 0.5,
    SPEED_SMOOTHING_LOW: 0.5, // Glättungsfaktor für niedrige Geschwindigkeiten
    SPEED_SMOOTHING_HIGH: 0.2, // Glättungsfaktor für hohe Geschwindigkeiten
    SPEED_SMOOTHING_TRESHOLD: 25, // m/s, Schwelle, ab der die stärkere Glättung greift
};

/** Konfiguration für das Caching von Kartenkacheln. */
export const CACHE_DEFAULTS = {
    TILE_MAX_AGE_DAYS: 7,
    FETCH_TIMEOUT_MS: 15000,
    SIZE_LIMIT_MB_WARNING: 500,
};

/** Konfiguration für die Ensemble-Visualisierungen. */
export const ENSEMBLE_VISUALIZATION = {
    SCENARIO_COLORS: {
        MIN_WIND: 'rgba(0, 0, 255, 0.7)',
        MEAN_WIND: 'rgba(0, 255, 0, 0.7)',
        MAX_WIND: 'rgba(255, 0, 0, 0.7)'
    },
    HEATMAP_MIN_RADIUS_PX: 5,
    HEATMAP_MAX_RADIUS_PX: 50,
    HEATMAP_SCALING_BASE: 1.42,
    HEATMAP_BASE_RADIUS: 20,
    HEATMAP_REFERENCE_ZOOM: 13
};

/** URLs zu den Icon-Bilddateien. */
export const ICON_URLS = {
    DEFAULT_MARKER: defaultMarkerUrl,
    CUTAWAY_MARKER: cutawayMarkerUrl,
    AIRPLANE_MARKER: airplaneMarkerUrl
};