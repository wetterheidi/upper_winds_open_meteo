# DZMaster - OpenMeteo & Skydive Planner

A web and mobile application for visualizing upper-level winds and atmospheric data on interactive maps, powered by the Open-Meteo API. The application includes advanced features for skydive planning, including landing pattern visualization, jump trajectory calculation, live tracking, weather alerts, and more.

## Features

### Interactive Map & UI
- **Map Engine:** Built with Leaflet.js, featuring various selectable map layers (OpenStreetMap, OpenTopoMap, OpenFlightMap, Esri maps, CARTO Dark Matter).
- **Location Selection:** Easily select a location by right-clicking/long-pressing the map or dragging the marker. Coordinates are displayed in multiple formats (Decimal Degrees, DDM, DMS, MGRS).
- **Location Search & Favorites:** Search locations by name (Open-Meteo Geocoding) or coordinates. Save locations as favorites with custom names, and set a "Home DZ".
- **POI Search:** Search for nearby dropzones and parachuting-related points of interest using the Overpass API.
- **Map Tools:** Includes controls for zoom, a scale bar, and a full measurement suite (leaflet-geoman) for distances, radii, and bearings.
- **Offline Capability:** Map tiles are cached using IndexedDB for offline use. Cache settings (radius, zoom levels) are customizable. Improved offline indicators and messages.
- **Responsive Design:** Available as an optimized web app and a mobile-dedicated version leveraging native capabilities via Capacitor.
- **Dark Mode:** Includes a theme toggle for switching between light and dark modes, automatically adjusting base maps.

### Weather Data & Visualization
- **Comprehensive Data:** Hourly upper-level data from Open-Meteo, including wind, temperature, humidity, cloud cover, visibility, weather codes, and geopotential height up to 200 hPa.
- **Model Selection:** Choose between various global and regional weather models (e.g., ICON, GFS, ECMWF). The latest model run time is displayed.
- **Timeline Slider:** Browse through the hourly forecast (up to 7 days, configurable). Slider background highlights hours with active weather alerts. Date labels adjust to selected timezone.
- **Historical Data:** Fetch past weather data using a date picker.
- **Autoupdate:** Optional feature to automatically update the forecast to the current hour.
- **Unit Customization:** Full control over displayed units (AGL/AMSL, m/ft, °C/°F, kt/km/h/m/s/mph/bft, UTC/Local).
- **Mean Wind Calculation:** Calculates the average wind for a user-defined altitude layer.
- **Windspinne Chart:** Visualizes wind speed and direction across different altitudes in a polar chart.
- **Meteogram Charts:** Displays separate time-series charts for surface conditions (temp, dew point, wind, gusts) and upper air (wind barbs, cloud cover, freezing level) generated using Chart.js.
- **Weather Alerts:** Configurable alerts for high winds, gusts, thunderstorms, and low cloud bases. Active alerts are indicated on the map and slider.

### Skydiving & Flight Planning
- **Landing Pattern Visualization:** Displays a configurable landing pattern (downwind, base, final) with wind details for each leg. Parameters like canopy speed, descent rate, and leg altitudes are adjustable.
- **Jump Trajectory Calculation:** Visualizes the entire jump from exit to landing.
  - **Exit Area (Green Circles):** Probable area to reach the DIP or landing pattern entry after freefall. Tooltip shows calculated drift and freefall time.
  - **Canopy Area (Blue Circles):** Reachable area under canopy, including isolines for different altitudes.
  - **Freefall Trajectory:** Accounts for wind drift and aircraft throw based on calculated TAS and ground speed.
- **Jump Run Track (JRT):** Visualizes the aircraft's approach path (2-min approach) and the Jump Run Track. Jumper separation is dynamically calculated based on TAS. The track can be dragged or manually offset relative to DIP or HARP.
- **HARP (High Altitude Release Point):** Manually place a HARP marker on the map or via coordinates to anchor the JRT.
- **Cut-Away Finder:** Visualizes the potential landing spot after a main canopy cut-away, considering different malfunction scenarios (open, partial, collapsed).
- **Terrain Analysis:** Analyzes potential ground clearance within the canopy flight area based on user-defined minimum clearance.
- **Track Upload & Management:** Import and visualize GPX, KML, and FlySight CSV files. Tracks are color-coded by AGL altitude. Files can be opened directly from the OS in the mobile app.
- **GPX Export:** Export calculated Jump Run Tracks and Landing Patterns as GPX files.
- **Data Download & Reports:** Download weather data tables in various formats (HEIDIS, ATAK, Windwatch, Custom ASCII) or generate a comprehensive HTML weather briefing.

### Live Tracking & Native Features (Mobile App)
- **Live GPS Tracking:** Real-time tracking of the device's position using Capacitor Geolocation.
- **Jump Master Line:** Displays a line from the current live position to the DIP or HARP, showing bearing, distance, and time-to-target.
- **Automatic Jump Recording:** Uses device accelerometer (via SensorManager) to detect freefall (based on jerk and acceleration) and landing (based on sustained low descent rate) to automatically record the jump track.
- **Manual Recording:** Option to manually start and stop track recording.
- **Track Saving:** Automatically saves recorded jump tracks locally as GPX files using the Capacitor Filesystem API.
- **ADSB Aircraft Tracking:** Find nearby aircraft via ADSBexchange API and track the selected jump ship's position, altitude, speed, and track live on the map.

### Code Architecture

The project utilizes a modular architecture optimized for web and mobile platforms, separating core logic from platform-specific UI management.

**src/core - Core Logic & Data Model (Model)**
* **`state.js`**: Defines the global `AppState` object.
* **`settings.js`**: Manages user settings, persistence (localStorage), and feature access. *(Note: Password protection is currently disabled via config)*.
* **`constants.js`**: Contains global static constants (physics, conversions, API URLs, UI defaults).
* **`weatherManager.js`**: Handles fetching and interpolation of weather data from Open-Meteo. Includes cloud layer analysis.
* **`jumpPlanner.js`**: Contains pure calculation logic for skydiving aspects (freefall, canopy, JRT, landing pattern, cutaway, terrain analysis).
* **`locationManager.js`**: Logic for location search (Open-Meteo Geocoding, Overpass API for POIs) and management of favorites/history.
* **`ensembleManager.js`**: Manages fetching, processing, and preparing data for ensemble forecasts.
* **`trackManager.js`**: Handles loading, parsing, saving, and exporting GPX, KML, and CSV tracks.
* **`liveTrackingManager.js`**: Manages watching the live GPS position using Capacitor/Web Geolocation.
* **`autoupdateManager.js`**: Manages the forecast autoupdate timer.
* **`tileCache.js`**: Logic for IndexedDB map tile caching.
* **`adsbManager.js`**: Handles fetching and managing ADSB aircraft data.
* **`sensorManager.js`** (Mobile Only): Manages device sensors (accelerometer) for automatic jump detection.
* **`windchart.js`**: Logic for generating the Windspinne chart.
* **`meteogramChart.js`**: Logic for generating Meteogram charts using Chart.js.
* **`capacitor-adapter.js`**: Dynamically loads native Capacitor modules or mocks for web builds.
* **`native-imports.js` / `capacitor-mocks.js`**: Platform-specific imports for Capacitor.
* **`utils.js`**: Stateless helper functions (math, conversions, coordinates, etc.).
* **`config.js`**: Configuration like feature flags.

**src/ui-web & src/ui-mobile - View & Controller**
* **`main-*.js`**: Central Controller/entry point for each platform, initializes modules, orchestrates logic.
* **`mapManager.js`**: Manages the Leaflet map instance, layers, controls, and primitive drawing functions.
* **`displayManager.js`**: View Logic module, updates UI components (weather table, popups, complex visualizations) based on AppState.
* **`ui.js`**: Generic UI feedback functions (messages, loaders, device detection).
* **`coordinates.js`**: Manages the location search UI and favorites/history list.
* **`eventManager.js`**: Centralizes DOM event listener setup.
* **`index.html` / `styles.css`**: Platform-specific structure and styling.

## Setup & Dependencies

1.  **Clone the Repository**
2.  **Install Dependencies:** `npm install` (installs `live-server` for development)
3.  **Start the Application:** `npm start` (runs the web version using `live-server`)
4.  **No API Key Required**: Uses OpenMeteo’s free API, OpenStreetMap Nominatim/Overpass, ADSBexchange API, and Leaflet with various base map tiles. No keys needed.

## Warning
Weather data is sourced from OpenMeteo and may contain inaccuracies. ADS-B data is from ADSBexchange and might be delayed or incomplete. **Always verify with official meteorological and aviation sources for critical applications like skydiving or flight planning.** This tool is for informational purposes only.

## Technologies Used
-   **Core:** Vanilla JavaScript (ES Modules)
-   **Mapping:** Leaflet.js, Leaflet.heat, Leaflet-rotatedMarker, @geoman-io/leaflet-geoman-free
-   **Charting:** Chart.js
-   **Data Parsing:** PapaParse (CSV), @tmcw/togeojson (KML)
-   **Date/Time:** Luxon
-   **Coordinates:** MGRS.js
-   **Mobile:** Capacitor (Geolocation, Filesystem, App, Browser)
-   **Development Server:** live-server