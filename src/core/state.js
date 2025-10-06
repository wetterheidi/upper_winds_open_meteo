/**
 * @file state.js
 * @description Definiert das zentrale, globale Zustandsobjekt `AppState`.
 * Dieses Objekt enthält alle zur Laufzeit veränderlichen Daten, die von
 * verschiedenen Modulen der Anwendung gemeinsam genutzt werden.
 */

export const AppState = {
    // = an =================================================================
    // Kernzustand & App-Verwaltung
    // ===================================================================
    isInitialized: false,           // @type {boolean} - True, wenn die App ihre Initialisierung abgeschlossen hat.
    ismapInitialized: false,        // @type {boolean} - True, wenn speziell die Karte initialisiert wurde. (von mapManager.js)
    isCachingCancelled: false,      // @type {boolean} - Flag, um laufende Caching-Prozesse abzubrechen. (von tileCache.js)
    hasTileErrorSwitched: false,    // @type {boolean} - Verhindert wiederholte "Fallback-Basemap"-Meldungen. (von mapManager.js)

    // ===================================================================
    // Kartenzustand & UI-Interaktion
    // ===================================================================
    map: null,                      // @type {L.Map|null} - Die Leaflet-Karteninstanz.
    baseMaps: {},                   // @type {Object.<string, L.TileLayer>} - Die verfügbaren Basiskarten-Layer.
    coordsControl: null,            // @type {L.Control|null} - Das Leaflet-Control zur Anzeige von Koordinaten.
    lastMouseLatLng: null,          // @type {{lat: number, lng: number}|null} - Die letzte bekannte Position des Mauszeigers auf der Karte.
    isManualPanning: false,         // @type {boolean} - True, wenn der Benutzer die Karte manuell verschiebt.
    isInteractionLocked: false,     // @type {boolean} - True, wenn alle Marker-Interaktionen gesperrt sind.
    labelZoomListener: null,        // @type {function|null} - Der Event-Listener zur Anpassung der Label-Grössen beim Zoomen.

    // ===================================================================
    // Hauptmarker (DIP - Desired Impact Point)
    // ===================================================================
    currentMarker: null,            // @type {L.Marker|null} - Der Hauptmarker (DIP).
    lastLat: null,                  // @type {number|null} - Die letzte bekannte Breite des DIP.
    lastLng: null,                  // @type {number|null} - Die letzte bekannte Länge des DIP.
    lastAltitude: null,             // @type {number|string|null} - Die Geländehöhe am DIP in Metern oder 'N/A'.

    // ===================================================================
    // Wetter & Zeit
    // ===================================================================
    weatherData: null,              // @type {object|null} - Das 'hourly' Objekt aus der Open-Meteo API-Antwort.
    cloudThresholds: [],            // @type {object[]} - NEU: Speichert die berechneten RH-Schwellenwerte für jede Stunde.
    lastModelRun: null,             // @type {string|null} - Zeitstempel des letzten Wettermodell-Laufs.
    landingWindDir: null,           // @type {number|null} - Windrichtung in 10m Höhe für das Landemuster.
    autoupdateInterval: null,       // @type {number|null} - Die ID des Intervall-Timers für das Auto-Update.

    // ===================================================================
    // Sprungplanung & Visualisierung
    // ===================================================================
    jumpVisualizationLayerGroup: null, // @type {L.LayerGroup|null} - Gruppe für Exit- & Canopy-Kreise.
    landingPatternLayerGroup: null,    // @type {L.LayerGroup|null} - Gruppe für das Landemuster.
    jumpRunTrackLayerGroup: null,      // @type {L.LayerGroup|null} - Gruppe für den Jump Run Track.
    lastTrackData: null,               // @type {object|null} - Speichert die letzten JRT-Daten, um Drag&Drop zu ermöglichen.
    isPlacingHarp: false,              // @type {boolean} - True, wenn der Benutzer gerade einen HARP platziert.
    harpMarker: null,                  // @type {L.Marker|null} - Der HARP-Marker.
    cutAwayMarker: null,               // @type {L.Marker|null} - Der Marker für den Abtrennpunkt.
    cutAwayLat: null,                  // @type {number|null} - Breite des Abtrennpunkts.
    cutAwayLng: null,                  // @type {number|null} - Länge des Abtrennpunkts.
    cutAwayCircle: null,               // @type {L.Circle|null} - Der Unsicherheitskreis für den Cut-Away.
    isJumperSeparationManual: false,   // @type {boolean} - *HINWEIS: Scheint nicht verwendet zu werden, könnte ein Relikt sein.*

    // ===================================================================
    // Live Tracking & Aufzeichnung
    // ===================================================================
    watchId: null,                     // @type {string|number|null} - Die ID des aktiven Geolocation-Watchers.
    liveMarker: null,                  // @type {L.Marker|null} - Der Marker, der die Live-Position anzeigt.
    livePositionControl: null,         // @type {L.Control|null} - Das Control zur Anzeige der Live-Positionsdaten.
    accuracyCircle: null,              // @type {L.Circle|null} - Der Genauigkeitskreis um den Live-Marker.
    jumpMasterLine: null,              // @type {L.Polyline|null} - Die Linie vom Live-Marker zum Ziel (DIP/HARP).
    aircraftMarker: null,              // @type {L.Marker|null} - NEU: Der Marker für das Absetzflugzeug.
    aircraftTrackLayer: null,          // @type {L.Polyline|null} - NEU: Die Linie für den Flugpfad.
    adsbTrackPoints: [],               // @type {Array[]} - NEU: Die gesammelten Koordinaten des Pfades.
    isArmed: false,                    // @type {boolean} - True, wenn die automatische Sprungerkennung "scharf" ist.
    isAutoRecording: false,            // @type {boolean} - True, wenn ein Sprung automatisch aufgezeichnet wird.
    isManualRecording: false,          // @type {boolean} - True, wenn ein Sprung manuell aufgezeichnet wird.
    recordedTrackPoints: [],           // @type {object[]} - Die Punkte des aktuell aufgezeichneten Tracks.
    recordedTrackLayer: null,          // @type {L.Polyline|null} - Der Layer für den live aufgezeichneten Track.
    autoRecordingStartTime: null,      // @type {number|null} - Zeitstempel des Starts der Auto-Aufzeichnung.
    altitudeCorrectionOffset: 0,       // @type {number} - Korrekturwert zur Anpassung der Gerätehöhe an die Geländehöhe.

    // --- Zwischenspeicher für Berechnungen ---
    prevTime: null,                    // @type {number|null} - Zeitstempel der letzten Position.
    prevLat: null,                     // @type {number|null} - Letzte Breite für Geschwindigkeitsberechnung.
    prevLng: null,                     // @type {number|null} - Letzte Länge für Geschwindigkeitsberechnung.
    lastLatitude: null,                // @type {number|null} - *HINWEIS: Wird von `prevLat` abgedeckt, könnte redundant sein.*
    lastLongitude: null,               // @type {number|null} - *HINWEIS: Wird von `prevLng` abgedeckt, könnte redundant sein.*
    lastDeviceAltitude: null,          // @type {number|null} - Letzte Gerätehöhe (unbearbeitet).
    lastAltitudeAccuracy: null,        // @type {number|null} - Genauigkeit der Gerätehöhe.
    lastAccuracy: null,                // @type {number|null} - Horizontale Genauigkeit der Position.
    lastSpeed: 'N/A',                  // @type {number|string} - *HINWEIS: Wird von `lastSmoothedSpeedMs` abgedeckt, könnte redundant sein.*
    lastSmoothedSpeedMs: 0,            // @type {number} - Geglättete Geschwindigkeit in m/s.
    lastDirection: 'N/A',              // @type {number|string} - Geglättete Richtung in Grad.
    lastTerrainAltitude: 'N/A',        // @type {number|string} - *HINWEIS: Wird von `lastAltitude` abgedeckt, könnte redundant sein.*
    lastEffectiveWindUnit: 'kt',       // @type {string} - *HINWEIS: Gehört eher in `Settings`, da es eine Benutzereinstellung ist.*

    // ===================================================================
    // Geladene Tracks & POIs (GPX, KML, CSV)
    // ===================================================================
    gpxLayer: null,                    // @type {L.LayerGroup|null} - Der Layer für einen geladenen GPX/KML/CSV-Track.
    gpxPoints: [],                     // @type {object[]} - Die geparsten Punkte aus der geladenen Datei.
    isLoadingGpx: false,               // @type {boolean} - True, während eine Track-Datei verarbeitet wird.
    isTrackLoaded: false,              // @type {boolean} - True, wenn ein Track erfolgreich geladen und angezeigt wird.
    favoritesLayerGroup: null,         // @type {L.LayerGroup|null} - Gruppe für alle Favoriten-Marker.
    poiLayerGroup: null,               // @type {L.LayerGroup|null} - Gruppe für alle POI-Marker (Dropzones etc.).

    // ===================================================================
    // Ensemble-Vorhersagen
    // ===================================================================
    ensembleModelsData: null,          // @type {object|null} - Speichert die Wetterdaten für jedes ausgewählte Ensemble-Modell.
    selectedEnsembleModels: [],        // @type {string[]} - Array der Namen der ausgewählten Ensemble-Modelle.
    currentEnsembleScenario: 'all_models', // @type {string} - Das aktuell ausgewählte Szenario.
    ensembleLayerGroup: null,          // @type {L.LayerGroup|null} - Gruppe für alle Ensemble-Visualisierungen.
    ensembleScenarioCircles: {},       // @type {Object.<string, L.Circle>} - Speichert die Leaflet-Layer für Szenario-Kreise.
    heatmapLayer: null,                // @type {L.HeatLayer|null} - Der Leaflet.heat-Layer für die Heatmap-Darstellung.
};