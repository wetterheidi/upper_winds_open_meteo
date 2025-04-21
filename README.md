# Upper Winds - OpenMeteo

A web application for visualizing upper-level wind, temperature, and atmospheric data using interactive Leaflet maps, powered by the OpenMeteo API. Includes advanced skydiving features for landing pattern visualization and jump trajectory calculations.

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
  - Features a scale control (metric/imperial), a measurement tool for distance/bearing, and mouse-over coordinate display in the bottom-left corner.
- **Coordinate Input**: 
  - Enter coordinates via the "Coordinate Input" menu to reposition the marker (Decimal, DMS, MGRS formats).
  - Adaptive input styling: compact DMS fields, wider Decimal fields, full-width MGRS input.
- **Weather Data**: 
  - Hourly upper-level data from OpenMeteo, including wind speed, direction, temperature, humidity, and pressure levels (1000 hPa to 200 hPa).
  - Surface data at 2m and 10m for precise low-altitude analysis.
- **Model Selection**: 
  - Select forecast models (ICON GLOBAL, GFS, ECMWF) via a dropdown; view the latest model run time in the "Forecast Model" label tooltip.
- **Time Slider**: 
  - Browse hourly forecasts (up to 7 days, or 2 days for ICON D2) with a responsive slider.
- **Unit Customization**: 
  - Switch between AGL/AMSL, height units (m/ft), temperature (°C/°F), wind speed (kt/km/h/m/s/mph/bft), time zones (UTC/local), and coordinate formats.
- **Mean Wind Calculation**: 
  - Compute average wind speed and direction for user-specified altitude layers, updating dynamically with unit changes.
- **Landing Pattern Visualization**: 
  - Display customizable skydiving landing patterns (downwind, base, final legs) with configurable canopy speed (5-50 kt), descent rate (1-10 m/s), and leg heights (50-1000m AGL).
  - Supports left (LL) or right (RR) patterns with custom direction inputs (0-359°), defaulting to surface wind direction.
  - Includes wind arrows with tool tips to display the exact direction and speed.
- **Jump Calculation**: 
  - Calculate skydiving jump trajectories, including free-fall and canopy phases, using exit altitude (500-15000m), opening altitude (500-10000m), and weather data.
  - Visualizes jump circles: various blue (canopy glide), red (full descent), green/light green (exit areas), and jump run tracks with customizable direction and offset.
- **Data Table**: 
  - Toggleable wind table showing height, pressure, temperature, dewpoint, wind direction/speed, and humidity.
  - Adjustable interpolation steps (100m to 2000m); wind speeds color-coded: low (blue, ≤3 kt), moderate (green, ≤10 kt), high (yellow, ≤16 kt), very high (red, >16 kt).
  - Includes wind barbs, adjusted for northern/southern hemispheres.
- **Data Download**: 
  - Export weather data as ASCII text in formats like HEIDIS, ATAK, Windwatch, or Customized (e.g., 2025-04-01_1200Z_ICON_GLOBAL_HEIDIS.txt).
- **Error Handling**: 
  - Errors display in a light red banner at the top, auto-hiding after 5 seconds.
- **Responsive Design**: 
  - Adapts to various screen sizes with mobile-friendly layouts and controls.

## Dependencies
- **Leaflet**: Via CDN (`https://unpkg.com/leaflet@1.9.4/dist/leaflet.js`) for maps.
-**Leaflet Plugins**: RotatedMarker, PolylineMeasure, GPX for enhanced functionality.
- **Luxon**: Via CDN (`https://cdnjs.cloudflare.com/ajax/libs/luxon/3.4.4/luxon.min.js`) for date/time handling.
- **MGRS**: Via CDN (`https://unpkg.com/mgrs@1.0.0/dist/mgrs.js`) for MGRS coordinate support.
- **OpenMeteo API**: Free, no key required.
- **Roboto Font**: Via Google Fonts CDN for typography.
- **live-server**: Development dependency (`npm install`).

## Usage
- **Map Interaction**: 
  - Double-click to place a marker, drag to adjust, or click to toggle the popup with coordinates and altitude.
  - Use the top-right measurement tool for distances and bearings.
- **Coordinate Input**: 
  - Open the "Coordinate Input" menu, enter coordinates, and click "Move Marker" to update the location.
  - Save up to five favorite locations.
- **Model Selection**: 
  - Choose a model from the dropdown; hover over "Forecast Model" for the latest run time.
- **Time Navigation**: 
  - Use the time slider to explore forecasts; disabled for single time steps.
  - Display historical weather data.
- **Weather Display**: 
  - Enable the wind table with "Show Wind Table" and customize units/interpolation in the settings menu.
- **Mean Wind**: 
  - Adjust altitude limits in the bottom container to calculate mean wind.
- **Skydiving Features**: 
  - Configure canopy speed, descent rate, leg heights, exit/opening altitudes,number of jumpers and exit separation.
  - isualize patterns, jump circles, jump run tracks, approach.
  - Place a cut away finder at the location of the cut away. A tooltip shows the displacement, descent time and speed.
- **GPX Track visualization**:
  - GPX track visualization with color-coded AGL height (red to green gradient), interactive tooltips showing AGL height, speed, and descent rate.
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
- **v1.3.0 (April 12, 2025)**:
  - Added password protection for landing pattern and jump calculation features.
 - Enhanced jump calculations with free-fall trajectories, canopy glide circles (blue/red), and exit areas (green/light green).
  - Implemented jump run tracks with customizable direction, offset, and plane icon visualization.
  - Improved wind barbs with hemisphere-specific rendering.
  - Upgraded coordinate inputs with dynamic styling for Decimal, DMS, and MGRS.
  - Added a reset button to clear settings and unlock states.
  - Optimized error handling, UI responsiveness, and localStorage persistence.

- **v1.4.0 (April 21, 2025)**:
  - Added tooltips to the exit circles containing throw, drift and free fall time.
  - Jump run track now adjusts dynamically to the number of jumpers and the exit separation. x-2 min Approach is also shown as a dashed line.
  - Added option to load historical weahter data for the chosen location.
  - Added GPX track visualization with color-coded AGL height (red to green gradient), interactive tooltips showing coordinates, AGL height, speed, and descent rate, with dynamic updates for wind and height units.
  - Enhanced weather table with conditional row background colors based on relative humidity: white (<65%), light grey (65%-85%), medium grey (85%-99%), dark grey (100%), preserving wind speed-based border colors (blue, green, yellow, red).
  - Updated mouse-over elevation display to support user-selected height units (m or ft), ensuring consistency with other height displays.


## Warning
Data is sourced from OpenMeteo and may contain inaccuracies. Always verify with official meteorological sources for critical applications, especially skydiving or aviation.
