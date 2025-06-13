export const FEATURE_PASSWORD = "skydiver2025"; // Hardcoded password 

export const Constants = {
    minZoom: 11,
    maxZoom: 14,
    landingPatternMinZoom: 14,
    jumperSeparationTable: {
        135: 5, 130: 5, 125: 5, 120: 5, 115: 5, 110: 5, 105: 5,
        100: 6, 95: 7, 90: 7, 85: 7, 80: 8, 75: 8, 70: 9,
        65: 10, 60: 10, 55: 11, 50: 12, 45: 14, 40: 15,
        35: 17, 30: 20, 25: 24, 20: 30, 15: 40, 10: 60, 5: 119
    }
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