export const FEATURE_PASSWORD = "skydiver2025"; // Hardcoded password 

export const JUMPER_SEPARATION_TABLE = {
    135: 5, 130: 5, 125: 5, 120: 5, 115: 5, 110: 5, 105: 5,
    100: 6, 95: 7, 90: 7, 85: 7, 80: 8, 75: 8, 70: 9,
    65: 10, 60: 10, 55: 11, 50: 12, 45: 14, 40: 15,
    35: 17, 30: 20, 25: 24, 20: 30, 15: 40, 10: 60, 5: 119
};

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

// -- NEU HINZUFÜGEN --

// === Physical & Mathematical Constants ===
export const CONVERSIONS = {
    METERS_TO_FEET: 3.28084,
    FEET_TO_METERS: 0.3048,
    KNOTS_TO_MPS: 0.514444,
    KNOTS_TO_KMH: 1.852,
    MPH_TO_KMH: 1.60934,
    CELSIUS_TO_KELVIN: 273.15,
    MOLAR_MASS_AIR: 0.0289644, // kg/mol
};

export const PHYSICAL_CONSTANTS = {
    MOLAR_MASS_AIR: 0.0289644, // kg/mol
    UNIVERSAL_GAS_CONSTANT: 8.31446261815324, // J/(mol·K)
}

export const ISA_CONSTANTS = { // International Standard Atmosphere
    SEA_LEVEL_DENSITY: 1.225,
    LAPSE_RATE: 0.0065,
    SEA_LEVEL_TEMP_KELVIN: 288.15,
    GRAVITY: 9.80665,
    GAS_CONSTANT_AIR: 287.05,
};

export const DEWPOINT_COEFFICIENTS = {
    A_LIQUID: 17.27,
    B_LIQUID: 237.7,
    A_ICE: 21.87,
    B_ICE: 265.5,
};

export const EARTH_RADIUS_METERS = 6371000;

export const BEAUFORT = {
    KNOT_THRESHOLDS: [1, 4, 7, 11, 17, 22, 28, 34, 41, 48, 56, 64],
    BEAUFORT_THRESHOLDS: [0, 1, 3, 6, 10, 16, 21, 27, 33, 40, 47, 55, 63],
}

// === API & Configuration ===
export const API_URLS = {
    FORECAST: 'https://api.open-meteo.com/v1/forecast',
    HISTORICAL: 'https://historical-forecast-api.open-meteo.com/v1/forecast',
};

export const STANDARD_PRESSURE_LEVELS = [1000, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200];


// === Skydive Specific Parameters ===
export const CANOPY_OPENING_BUFFER_METERS = 200;

export const CUTAWAY_VERTICAL_SPEEDS_MPS = {
    OPEN: 4.1,
    PARTIALLY: 12.8,
    COLLAPSED: 39.2
};

export const CUTAWAY_VISUALIZATION_RADIUS_METERS = 150;

export const FREEFALL_PHYSICS = {
    DEFAULT_AREA_VERTICAL: 0.5,
    DEFAULT_AREA_HORIZONTAL: 0.5,
    DEFAULT_MASS_KG: 80,
    DEFAULT_DRAG_COEFFICIENT: 1,
};


// === UI & App Behavior ===
export const UI_DEFAULTS = {
    MESSAGE_TIMEOUT_MS: 3000,
    MOBILE_BREAKPOINT_PX: 768,
    DEFAULT_MAP_CENTER: [48.0179, 11.1923],
    DEFAULT_MAP_ZOOM: 11,
    GEOLOCATION_TIMEOUT_MS: 20000,
    GEOLOCATION_ACCURACY_THRESHOLD_M: 100,
    MIN_ZOOM: 11,
    MAX_ZOOM: 14,
    LANDING_PATTERN_MIN_ZOOM: 14
};

export const SMOOTHING_DEFAULTS = {
    SPEED_SMOOTHING_LOW: 0.5, // Glättungsfaktor für Geschwindigkeit
    SPEED_SMOOTHING_HIGH: 0.2, // Glättungsfaktor für hohe Geschwindigkeiten
    SPEED_SMOOTHING_TRESHOLD: 25, // Radius für Positionsglättung
};

export const CACHE_DEFAULTS = {
    TILE_MAX_AGE_DAYS: 7,
    FETCH_TIMEOUT_MS: 15000,
    SIZE_LIMIT_MB_WARNING: 500,
};

export const ICON_URLS = {
    DEFAULT_MARKER: 'favicon.ico',
    CUTAWAY_MARKER: 'schere_purple.png',
    AIRPLANE_MARKER: 'airplane_orange.png'
};

