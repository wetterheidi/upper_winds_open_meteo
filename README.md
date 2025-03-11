# Upper Winds - OpenMeteo

A web app to visualize upper-level wind and temperature data using Mapbox and OpenMeteo.

## Setup
1. Clone the repo: `git clone https://github.com/wetterheidi/upper_winds_open_meteo.git`
2. Open `index.html` in a browser (requires internet for Mapbox/OpenMeteo).
3. Replace `YOUR_MAPBOX_API_KEY_HERE` in `app.js` with your Mapbox API key.

## Features
- Interactive Map: Zoomable Mapbox map with satellite-streets style.
- Weather Data: Click the map to fetch coordinates, altitude, and hourly weather data for various pressure levels.
- Model Selection: Choose from available forecast models (e.g., ICON GLOBAL, GFS, ECMWF) via a dropdown menu.
Dropdown is always visible with an info button (ℹ️) on the right showing model run details.
- Time Slider: Navigate hourly forecasts up to 7 days (or 2 days for ICON D2).
- Mean Wind Calculation: Compute average wind speed and direction between user-defined altitude layers.
- Data Download: Export weather data (wind, temperature, dewpoint and pressure) as an ASCII text file.
- Error Handling: Displays errors with a solid light red background at the top of the page.

## Dependencies
- Mapbox GL JS: Loaded via CDN (https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.js).
- OpenMeteo API: No API key required.
- Roboto Font: Via Google Fonts CDN.

## Usage
- Map Interaction:
Click anywhere on the map to pin a location and fetch weather data.
A marker with a popup shows latitude, longitude, and altitude.
- Model Selection:
Use the "Forecast Model" dropdown in the top-left slider container to switch models.
Available models are dynamically populated based on OpenMeteo API responses.
Click the ℹ️ button next to the dropdown to view the selected model’s last run time.
- Time Navigation:
After fetching data, use the slider to view weather at different times.
- Weather Display:
Data appears in a table at the bottom, showing height, pressure, temperature, dewpoint, wind direction, wind speed (in knots), and relative humidity.
Interpolated data adjusts based on selected step size and reference level (AGL/AMSL).
- Mean Wind:
Enter lower and upper limits in the bottom container and click "Calculate Mean Wind" to see the result.
- Download:
Click "Download Table" to save the current weather table as a .txt file.

## API-Usage

The app uses the OpenMeteo API to retrieve weather data. 

## Supported Pressure Levels
- 1000 hPa (~100m)
- 950 hPa (~500m)
- 925 hPa (~750m)
- 900 hPa (~1000m)
- 850 hPa (~1500m)
- 800 hPa (~2000m)
- 700 hPa (~3000m)
- 600 hPa (~4200m)
- 500 hPa (~5500m)
- 400 hPa (~7000m)
- 300 hPa (~9000m)
- 250 hPa (~10000m)
- 200 hPa (~12000m)

## Recent Changes
- This is the first release.

## Warning

Although I've tested the output, be careful when using the data. Be aware that the data might be incorrect.