# DZMaster - OpenMeteo & Skydive Planner

A web and mobile application for visualizing upper-level winds and atmospheric data on interactive maps, powered by the Open-Meteo API. The application includes advanced features for skydive planning, including landing pattern visualization, jump trajectory calculation, and live tracking.

## Features

### Interactive Map & UI
- **Map Engine:** Built with Leaflet.js, featuring various selectable map layers (OpenStreetMap, OpenTopoMap, OpenFlightMap, Esri maps).
- **Location Selection:** Easily select a location by double-clicking/long-pressing the map or dragging the marker. Coordinates are displayed in multiple formats (Decimal Degrees, DMS, MGRS).
- **Location Search & Favorites:** A search bar allows finding locations by name or coordinates. Any location can be saved as a favorite with a custom name.
- **Map Tools:** Includes controls for zoom, a scale bar, and a full measurement suite (leaflet-geoman) for distances, radii, and bearings.
- **Offline Capability:** Map tiles can be cached for offline use. Cache settings (radius, zoom levels) are customizable.
- **Responsive Design:** The application is available in two variants – an optimized web app and a mobile-dedicated version that leverages native device capabilities.

### Weather Data & Models
- **Comprehensive Data:** Hourly upper-level data from Open-Meteo, including wind, temperature, humidity, cloud cover, and geopotential height from the surface up to 200 hPa.
- **Model Selection:** Choose between global and regional weather models (e.g., ICON, GFS, ECMWF). The latest model run time is displayed.
- **Timeline Slider:** A slider allows browsing through the hourly forecast (up to 7 days).
- **Historical Data:** A date picker allows fetching weather data from the past.
- **Autoupdate:** An optional feature automatically updates the forecast to the current hour.
- **Unit Customization:** Full control over displayed units (AGL/AMSL, m/ft, °C/°F, kt/km/h/m/s/mph/bft, UTC/Local).
- **Mean Wind Calculation:** Calculates the average wind for a user-defined altitude layer.

### Skydiving & Flight Planning
- **Landing Pattern Visualization:** Displays a configurable landing pattern (downwind, base, final). Parameters like canopy speed, descent rate, and leg altitudes are adjustable.
- **Jump Trajectory Calculation:** Visualizes the entire jump from exit to landing.
  - **Exit Area (Green Circles):** The probable area where the skydiver can reach the DIP or entry of the landing pattern.
  - **Canopy Area (Blue Circles):** The reachable area under the open canopy.
  - **Freefall Trajectory:** Accounts for wind drift and aircraft throw.
- **Jump Run Track (JRT):** Visualizes the aircraft's approach path, including a 2-minute approach and dynamic jumper separation based on True Airspeed (TAS).
- **Cut-Away Finder:** A tool to visualize the potential landing spot after a main canopy cut-away at a specific altitude.
- **Track Upload:** Import and visualize GPX, KML, and FlySight CSV files. The track is color-coded based on the altitude above ground level (AGL).
- **Live Tracking & Jump Master Line:**
  - Starts live tracking of your own position.
  - Displays a "Jump Master Line" from the current location to the designated landing point (DIP) or a manually placed High Altitude Release Point (HARP).

### Ensemble Forecasts
- **Multi-Model Analysis:** Allows for the simultaneous query and display of multiple weather models.
- **Scenarios:** Visualizes different landing point scenarios based on the ensemble data:
  - **All Models:** Shows the landing circle for each selected model individually.
  - **Min/Mean/Max Wind:** Displays the landing circle for the scenario with the weakest, average, or strongest winds.
  - **Heatmap:** Creates a probability map of potential landing areas.

### Code Architecture

The project has been refactored into a modular architecture for web and mobile to ensure high maintainability and a clear separation of concerns. The main responsibilities are distributed as follows:

**src/core - Core Logic & Data Model (Model)**
* **`state.js`**: Defines the global AppState object as the single source of truth for the application's runtime state.
* **`settings.js`**: Manages all user settings, their persistence, and feature unlocking logic.
* **`constants.js`**: Contains all global, static constants, such as physical conversion factors, API URLs, and default configuration values.

**View & UI Management**
* **`mapManager.js`**: Manages the Leaflet map instance, including the creation of base layers, controls, and primitive drawing functions for markers, circles, and polylines.
* **`displayManager.js`**: A dedicated **View Logic** module responsible for updating the UI based on the current application state. It renders the weather table, updates marker popups, and draws complex visualizations like the landing pattern.
* **`ui.js`**: Provides generic UI functions for user feedback, such as displaying messages, errors, and progress indicators.
* **`coordinates.js`**: A self-contained component that manages the location search input, fetches geocoding data, and handles the favorites/history list UI.
* **`eventManager.js`**: Centralizes the setup of all DOM event listeners for UI elements like buttons, checkboxes, and sliders.

**Data Services & Logic (Model)**
* **`weatherManager.js`**: Exclusively handles fetching and preparing weather data from the Open-Meteo API for a given location and time.
* **`jumpPlanner.js`**: Contains the pure calculation logic ("business logic") for all skydiving-related aspects, such as freefall trajectory, canopy drift, and exit point calculation.
* **`locationManager.js`**: Encapsulates the logic for location search (geocoding) and the management of favorites and history.
* **`ensembleManager.js`**: Manages fetching, processing, and preparing data for ensemble forecast visualizations.
* **`trackManager.js`**: Handles the loading and parsing of GPX and CSV track files.
* **`liveTrackingManager.js`**: Encapsulates the logic for watching the user's live GPS position.
* **`autoupdateManager.js`**: Manages the timer and logic for the forecast autoupdate feature.
* **`tileCache.js`**: Contains all logic for interacting with IndexedDB to cache and retrieve map tiles for offline use.
* **`capacitor-adapter.js`**: Dynamically loads native Capacitor modules, ensuring compatibility between web and mobile builds.

**Utilities**
* **`utils.js`**: A collection of pure, stateless helper functions for mathematical calculations, unit conversions, coordinate transformations, etc.

**src/ui-web & src/ui-mobile - View & Controller**
* **`main-*.js`**: The central Controller and entry point for each respective platform. It initializes all modules and orchestrates the application logic.
* **`mapManager.js`**: Manages the Leaflet map instance, including the creation of layers, controls, and primitive drawing functions.
* **`displayManager.js`**: A dedicated View Logic module responsible for updating the UI based on the AppState.
* **`ui.js`**: Provides generic UI functions for user feedback (messages, loaders, etc.).
* **`coordinates.js`**: A self-contained component that manages the location search UI and favorites list.
* **`eventManager.js`**: Centralizes the setup of all DOM event listeners for UI elements like buttons and sliders.

## Setup & Dependencies

1.  **Clone the Repository**
2.  **Install Dependencies:** `npm install` (installs `live-server`)
3.  **Start the Application:** `npm start`
4.  **No API Key Required**: Uses OpenMeteo’s free API and Leaflet with various base map tiles, no additional keys needed.

## Warning
Data is sourced from OpenMeteo and may contain inaccuracies. Always verify with official meteorological sources for critical applications, especially skydiving or aviation.

## Technologies Used
The application uses libraries like Leaflet.js, Luxon, and MGRS.js, which are loaded via CDN. No authentication is needed for the weather data.