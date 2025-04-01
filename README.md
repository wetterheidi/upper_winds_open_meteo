# Upper Winds - OpenMeteo

A web application to visualize upper-level wind, temperature, and atmospheric data using Leaflet maps and the OpenMeteo API.

## Setup
1. **Clone the Repository**: 
   ```bash
   git clone https://github.com/wetterheidi/upper_winds_open_meteo.git
   ```
2. **Install Dependencies**: 
   - Ensure Node.js is installed.
   - Run `npm install` to install `live-server` as a development dependency.
3. **Start the Application**: 
   - Run `npm start` to launch the app with `live-server`.
   - Open your browser to `http://127.0.0.1:8080` (default `live-server` address).
4. **No API Key Required**: Uses OpenMeteo’s free API and Leaflet with various base map tiles, no additional keys needed.

## Features
- **Interactive Map**: 
  - Built with Leaflet, featuring base layers: OpenStreetMap, OpenTopoMap, Esri Satellite, Esri Street, and Esri Topo.
  - Double-click or drag a marker to pin a location and fetch weather data, displaying coordinates (Decimal Degrees, DMS, MGRS) and altitude.
  - Includes scale control (metric/imperial) in the bottom-left corner and a mouse-over coordinate display.
- **Coordinate Input**: 
  - Enter coordinates via a menu to reposition the marker (supports Decimal, DMS, MGRS formats).
  - Styled inputs adapt to format: compact DMS fields, wider Decimal fields, and full-width MGRS input.
- **Weather Data**: 
  - Hourly upper-level data (wind speed, direction, temperature, humidity) from OpenMeteo for surface (2m, 10m) and pressure levels (1000 hPa to 200 hPa).
- **Model Selection**: 
  - Choose forecast models (e.g., ICON GLOBAL, GFS, ECMWF) via dropdown; last run time shown in "Model Run" submenu.
- **Time Slider**: 
  - Navigate hourly forecasts (up to 7 days, or 2 days for ICON D2) with a responsive slider.
- **Unit Customization**: 
  - Toggle AGL/AMSL reference levels, height units (m/ft), temperature (°C/°F), wind speed (kt/km/h/m/s/mph/bft), time zones (UTC/local), and coordinate formats.
- **Mean Wind Calculation**: 
  - Compute average wind speed and direction between user-defined altitude layers, updated with unit changes.
- **Landing Pattern Visualization**: 
  - Overlay a customizable landing pattern (downwind, base, final legs) with canopy speed (5-50 kt), descent rate (1-10 m/s), and leg heights (50-1000m AGL).
  - Supports left (LL) or right (RR) patterns with custom direction (0-359°), defaulting to surface wind.
- **Data Table**: 
  - Toggleable table (via "Show Wind Table") showing height, pressure, temperature, dewpoint, wind direction/speed, and humidity.
  - Adjustable interpolation steps (100m to 2000m); wind speed rows color-coded: low (blue, ≤3 kt), moderate (green, ≤10 kt), high (yellow, ≤16 kt), very high (red, >16 kt).
- **Data Download**: 
  - Export weather data as ASCII `.txt` (e.g., `2025-04-01_1200Z_ICON_GLOBAL_HEIDIS.txt`).
- **Error Handling**: 
  - Errors display in a light red banner at the top, auto-hiding after 5 seconds.
- **Responsive Design**: 
  - Adapts to various screen sizes with mobile-friendly layouts and controls.

## Dependencies
- **Leaflet**: Via CDN (`https://unpkg.com/leaflet@1.9.4/dist/leaflet.js`) for maps.
- **Luxon**: Via CDN (`https://cdnjs.cloudflare.com/ajax/libs/luxon/3.4.4/luxon.min.js`) for date/time handling.
- **MGRS**: Via CDN (`https://unpkg.com/mgrs@1.0.0/dist/mgrs.js`) for MGRS coordinate support.
- **OpenMeteo API**: Free, no key required.
- **Roboto Font**: Via Google Fonts CDN for typography.
- **live-server**: Development dependency (`npm install`).

## Usage
- **Map Interaction**: 
  - Double-click to set a marker, drag to adjust, and fetch weather data; popup shows coordinates and altitude.
  - Measure distances and directions with the measurement tool on the top right corner of the map
- **Coordinate Input**: 
  - Use the "Coordinate Input" menu to enter coordinates (Decimal, DMS, MGRS) and move the marker with the "Move Marker" button.
- **Model Selection**: 
  - Switch models via "Forecast Model" dropdown; check "Model Run" for run time.
- **Time Navigation**: 
  - Use the slider to browse hourly forecasts; disabled if only one time step exists.
- **Weather Display**: 
  - View data in a table; adjust units and interpolation in the menu.
- **Mean Wind**: 
  - Set altitude limits in the bottom container for mean wind calculation.
- **Landing Pattern**: 
  - Enable via menu, tweak parameters, and visualize on the map.
- **Download**: 
  - Click "Download Table" to save the current table as a text file.

## API Usage
Leverages [OpenMeteo API](https://open-meteo.com/) for:
- Surface variables (e.g., `temperature_2m`, `wind_speed_10m`).
- Pressure level data (e.g., `temperature_850hPa`, `wind_speed_500hPa`, `geopotential_height_1000hPa`).
- No authentication needed; requires internet access.

## Supported Pressure Levels
- 1000 hPa (~100m), 950 hPa (~500m), 925 hPa (~750m), 900 hPa (~1000m), 850 hPa (~1500m), 800 hPa (~2000m), 700 hPa (~3000m), 600 hPa (~4200m), 500 hPa (~5500m), 400 hPa (~7000m), 300 hPa (~9000m), 250 hPa (~10000m), 200 hPa (~12000m).  
*Heights are approximate and vary with conditions.*

## Recent Changes
- **Initial Release (v1.0.0)**: Core functionality established.
- **v1.1.0**: Added skydiving features (landing pattern).
- **v1.2.0**: Added various map features and download options.
- **Enhancements (as of April 1, 2025)**:
  - Added Esri base layers (Satellite, Street, Topo).
  - Introduced coordinate format options (Decimal, DMS, MGRS) with styled inputs in the "Coordinate Input" menu.
  - Enhanced landing pattern with customizable parameters and wind arrows.
  - Improved wind table with toggle and color-coding.
  - Added scale control and mouse-over coordinate display.
  - Optimized time zone handling and UI responsiveness.
  - Refined coordinate input styling: compact DMS fields, wider Decimal fields, full-width MGRS input.

## Warning
Data is sourced from OpenMeteo weather models and may contain inaccuracies. Cross-check with official sources for critical use.