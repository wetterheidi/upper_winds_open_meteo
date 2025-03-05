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

## API-Verwendung

Die Anwendung verwendet die Open-Meteo API, um Wetterdaten abzurufen. Die API-Anfrage für Windgeschwindigkeit und -richtung auf verschiedenen Druckniveaus erfordert ein spezielles Format:

```
https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&hourly=temperature_2m,wind_speed_10m,wind_direction_10m&wind_speed_{level}hPa=true&wind_direction_{level}hPa=true&models=gfs_seamless
```

Dabei müssen die gewünschten Druckniveaus einzeln mit `wind_speed_{level}hPa=true` und `wind_direction_{level}hPa=true` angefordert werden, wobei `{level}` durch das gewünschte Druckniveau (z.B. 850, 700, 500) ersetzt wird.

### Unterstützte Druckniveaus
- 1000 hPa (etwa 100m)
- 925 hPa (etwa 750m)
- 850 hPa (etwa 1500m)
- 700 hPa (etwa 3000m)
- 500 hPa (etwa 5500m)
- 300 hPa (etwa 9000m)
- 200 hPa (etwa 12000m)