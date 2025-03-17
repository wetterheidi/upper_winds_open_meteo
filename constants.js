export const PRESSURE_LEVELS = [200, 250, 300, 400, 500, 600, 700, 800, 850, 900, 925, 950, 1000];
export const PRESSURE_LEVELS_HPA = ['1000hPa', '950hPa', '925hPa', '900hPa', '850hPa', '800hPa', '700hPa', '600hPa', '500hPa', '400hPa', '300hPa', '250hPa', '200hPa'];
export const BASE_API_URL = 'https://api.open-meteo.com/v1/forecast';
export const HEIGHT_CONVERSION = 3.28084; // m to ft
export const TEMPERATURE_CONVERSION = { C_TO_F: 9 / 5, F_OFFSET: 32 };
export const WIND_CONVERSIONS = {
    'km/h_to_m/s': 1 / 3.6,
    'km/h_to_kt': 1 / 1.852,
    'km/h_to_mph': 1 / 1.60934
};

/* Import to app.js and utils.js:
import { PRESSURE_LEVELS, BASE_API_URL, HEIGHT_CONVERSION, TEMPERATURE_CONVERSION, WIND_CONVERSIONS } from './constants';
*/