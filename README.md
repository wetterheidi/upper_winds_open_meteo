# Upper Winds - OpenMeteo

A web application to visualize upper-level wind, temperature, and atmospheric data using Leaflet maps and the OpenMeteo API.

## Setup
1. **Clone the Repository**: 
   ```bash
   git clone https://github.com/wetterheidi/upper_winds_open_meteo.git
   ```
2. **Install Dependencies**: 
   - Ensure you have Node.js installed.
   - Run `npm install` to install `live-server` as a development dependency.
3. **Start the Application**: 
   - Run `npm start` to launch the app using `live-server`.
   - Open your browser to `http://127.0.0.1:8080` (default `live-server` address).
4. **No API Key Required**: The app uses OpenMeteo’s free API and Leaflet with OpenStreetMap/OpenTopoMap tiles, requiring no additional API keys.

## Features
- **Interactive Map**: 
  - Built with Leaflet, offering OpenStreetMap and OpenTopoMap base layers.
  - Click to pin a location and fetch weather data, with a marker showing latitude, longitude, and altitude.
- **Weather Data**: 
  - Fetches hourly upper-level data (wind speed, direction, temperature, humidity) for multiple pressure levels from OpenMeteo.
  - Supports surface data (2m temperature, 10m wind) and pressure levels from 1000 hPa to 200 hPa.
- **Model Selection**: 
  - Choose from forecast models (e.g., ICON GLOBAL, GFS, ECMWF) via a dropdown menu.
  - Displays the last model run time in the hamburger menu under "Model Run".
- **Time Slider**: 
  - Navigate hourly forecasts up to 7 days (or 2 days for ICON D2) with a responsive slider.
- **Unit Customization**: 
  - Toggle between AGL (Above Ground Level) and AMSL (Above Mean Sea Level) reference levels.
  - Select height units (m, ft), temperature units (°C, °F), wind speed units (kt, km/h, m/s, mph, bft), and time zones (UTC or local).
- **Mean Wind Calculation**: 
  - Compute average wind speed and direction between user-defined altitude layers, displayed with selected units.
- **Data Download**: 
  - Export weather data (height, pressure, temperature, dewpoint, wind direction, wind speed, relative humidity) as an ASCII text file (`.txt`).
- **Error Handling**: 
  - Displays errors in a light red banner at the top of the page, auto-hiding after 5 seconds.
- **Responsive Design**: 
  - Adapts to various screen sizes with mobile-friendly adjustments for layout and controls.

## Dependencies
- **Leaflet**: Loaded via CDN (`https://unpkg.com/leaflet@1.9.4/dist/leaflet.js`) for interactive maps.
- **Luxon**: Loaded via CDN (`https://cdnjs.cloudflare.com/ajax/libs/luxon/3.4.4/luxon.min.js`) for date/time handling.
- **OpenMeteo API**: No API key required, fetches weather data directly.
- **Roboto Font**: Via Google Fonts CDN for consistent typography.
- **live-server**: Development dependency for local hosting (`npm install` required).

## Usage
- **Map Interaction**: 
  - Click anywhere on the map to set a marker and fetch weather data for that location.
  - The marker popup displays latitude, longitude, and altitude (fetched from OpenMeteo).
- **Model Selection**: 
  - Use the "Forecast Model" dropdown in the slider container to switch models.
  - Check the "Model Run" submenu for the selected model’s last run time.
- **Time Navigation**: 
  - After fetching data, use the time slider to view weather forecasts at different hours.
  - The slider is disabled if only one time step is available.
- **Weather Display**: 
  - Data appears in a table showing height, wind direction, wind speed, and temperature.
  - Adjust interpolation step size (100m to 2000m) and units via the hamburger menu.
  - Wind speed rows are color-coded by intensity (low: blue, moderate: green, high: yellow, very high: red).
- **Mean Wind**: 
  - Set lower and upper altitude limits in the bottom container to calculate mean wind.
  - Results update dynamically with unit or reference level changes.
- **Download**: 
  - Click "Download Table" to save the current weather table as a `.txt` file, named with the timestamp and model (e.g., `2025-03-18_1200Z_ICON_GLOBAL_HEIDIS.txt`).

## API Usage
The app leverages the [OpenMeteo API](https://open-meteo.com/) to retrieve weather data, including:
- Surface variables (e.g., `temperature_2m`, `wind_speed_10m`).
- Pressure level variables (e.g., `temperature_850hPa`, `wind_speed_500hPa`, `geopotential_height_1000hPa`).
- No authentication is required, but an internet connection is necessary.

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

*Heights are approximate geopotential heights and vary with atmospheric conditions.*

## Recent Changes
- **Initial Release (v1.0.0)**:
  - First stable version with core functionality.
- **Enhancements**:
  - Added support for multiple units (height: m/ft, temperature: °C/°F, wind: kt/km/h/m/s/mph/bft).
  - Implemented AGL/AMSL reference level switching.
  - Improved time zone support (UTC or local) for display and model run info.
  - Enhanced wind speed visualization with color-coded table rows.
  - Added OpenTopoMap as an alternative base layer alongside OpenStreetMap.
  - Optimized responsive design for mobile devices (e.g., adjusted layouts below 768px and 480px).

## Warning
Although thoroughly tested, the data is sourced from weather models via OpenMeteo and may contain inaccuracies. Always cross-check with official meteorological sources for critical applications.