# Upper Winds - OpenMeteo

A web app to visualize upper-level wind, temperature, dewpoint, and pressure data using Mapbox and OpenMeteo.

## Setup
1. Clone the repo: `git clone https://github.com/wetterheidi/upper_winds_open_meteo.git`
2. Open `index.html` in a browser (requires internet for Mapbox/OpenMeteo).
3. Replace `YOUR_MAPBOX_API_KEY_HERE` in `app.js` with your Mapbox API key.

## Features
- Zoomable Mapbox map
- Click to get coordinates, altitude, and weather data
- Time slider for hourly forecasts (7 days)

## Dependencies
- Mapbox GL JS (via CDN)
- OpenMeteo API (no key required)