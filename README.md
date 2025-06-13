# Upper Winds - OpenMeteo & Skydive Planner

A web application for visualizing upper-level winds and atmospheric data on interactive maps, powered by the Open-Meteo API. The application includes advanced features for skydive planning, including landing pattern visualization, jump trajectory calculation, and live tracking.

## Features

### Interactive Map & UI
- **Map Engine:** Built with [Leaflet.js](https://leafletjs.com/), featuring various selectable map layers (OpenStreetMap, OpenTopoMap, Esri maps).
- **Location Selection:** Easily select a location by double-clicking the map or dragging the marker. Coordinates are displayed in multiple formats (Decimal Degrees, DMS, MGRS).
- **Location Search & Favorites:** A search bar allows finding locations by name. Any location can be saved as a favorite with a custom name.
- **Map Tools:** Includes controls for zoom, a scale bar, and a measurement tool for distance and bearing.
- **Offline Capability:** Map tiles can be cached for offline use. Cache settings (radius, zoom levels) are customizable.
- **Responsive Design:** Adapts to various screen sizes and offers a mobile-friendly user experience.

### Weather Data & Models
- **Comprehensive Data:** Hourly upper-level data from Open-Meteo, including wind, temperature, humidity, and geopotential from the surface up to 200 hPa.
- **Model Selection:** Choose between global and regional weather models (e.g., ICON, GFS, ECMWF). The latest model run time is displayed.
- **Timeline Slider:** A slider allows Browse through the hourly forecast (up to 7 days).
- **Historical Data:** A date picker allows fetching weather data from the past.
- **Autoupdate:** An optional feature automatically updates the forecast to the current hour.
- **Unit Customization:** Full control over displayed units (AGL/AMSL, m/ft, °C/°F, kt/km/h/m/s/mph/bft, UTC/Local).
- **Mean Wind Calculation:** Calculates the average wind for a user-defined altitude layer.

### Skydiving & Flight Planning
- **Landing Pattern Visualization:** Displays a configurable landing pattern (downwind, base, final). Parameters like canopy speed, descent rate, and leg altitudes are adjustable.
- **Jump Trajectory Calculation:** Visualizes the entire jump from exit to landing.
  - **Exit Area (Green Circles):** The probable area where the skydiver will be after freefall.
  - **Canopy Area (Blue Circles):** The reachable area under the open canopy.
  - **Freefall Trajectory:** Accounts for wind drift and aircraft throw.
- **Jump Run Track (JRT):** Visualizes the aircraft's approach path, including a 2-minute approach and dynamic jumper separation based on True Airspeed.
- **Cut-Away Finder:** A tool to visualize the potential landing spot after a main canopy cut-away at a specific altitude.
- **Track Upload:** Import and visualize GPX and FlySight CSV files. The track is color-coded based on the altitude above ground level (AGL).
- **Live Tracking & Jump Master Line:**
  - Starts live tracking of your own position.
  - Displays a "Jump Master Line" from the current location to the designated landing point (DIP) or a manually placed High Altitude Release Point (HARP).

### Ensemble Forecasts
- **Multi-Model Analysis:** Allows for the simultaneous query and display of multiple weather models.
- **Scenarios:** Visualizes different landing point scenarios based on the ensemble data:
  - **All Models:** Shows the landing circle for each selected model individually.
  - **Min/Mean/Max Wind:** Displays the landing circle for the scenario with the weakest, average, or strongest winds.
  - **Heatmap:** Creates a probability map of potential landing areas.

## Code Architecture

The project has been consistently modularized to ensure high maintainability and extensibility. The main responsibilities are distributed as follows:

- **`app.js`**: The central orchestrator that controls the main logic and coordinates the other modules.
- **`state.js`**: Defines the global `AppState` object for central state management.
- **`settings.js`**: Manages all user settings, their persistence, and feature unlocking.
- **`constants.js`**: Contains application-wide constants (e.g., model lists, passwords).
- **`mapManager.js`**: Responsible for creating and manipulating the Leaflet map and all its layers (markers, circles, lines).
- **`weatherManager.js`**: Exclusively handles fetching and preparing weather data from the Open-Meteo API.
- **`ui.js`**: Responsible for manipulating UI elements outside the map (e.g., displaying messages, updating menus).
- **`eventManager.js`**: Bundles the setup of all event listeners for the UI elements.
- **`utils.js`**: A collection of helper functions for calculations (wind, coordinates, interpolation, etc.).
- **`jumpPlanner.js`, `trackManager.js`, `ensembleManager.js`, `autoupdateManager.js`**: Specialized modules that encapsulate the logic for their respective features.

## Setup & Dependencies

1.  **Clone the Repository**
2.  **Install Dependencies:** `npm install` (installs `live-server`)
3.  **Start the Application:** `npm start`
4.  **No API Key Required**: Uses OpenMeteo’s free API and Leaflet with various base map tiles, no additional keys needed.

## Warning
Data is sourced from OpenMeteo and may contain inaccuracies. Always verify with official meteorological sources for critical applications, especially skydiving or aviation.

## Technologies Used
The application uses libraries like Leaflet.js, Luxon, and MGRS.js, which are loaded via CDN. No authentication is needed for the weather data.