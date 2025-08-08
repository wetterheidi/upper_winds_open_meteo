export const AppState = {
    isInitialized: false,
    coordsControl: null,
    lastMouseLatLng: null,
    landingWindDir: null,
    cutAwayMarker: null,
    cutAwayLat: null,
    cutAwayLng: null,
    cutAwayCircle: null,
    isJumperSeparationManual: false,
    weatherData: null,
    lastModelRun: null,
    gpxLayer: null,
    gpxPoints: [],
    isLoadingGpx: false,
    isTrackLoaded: false, // New flag
    liveMarker: null,
    jumpMasterLine: null,
    isPlacingHarp: false,
    harpMarker: null,
    watchId: null,
    prevLat: null,
    prevLng: null,
    prevTime: null,
    livePositionControl: null,
    lastLatitude: null,
    lastLongitude: null,
    lastDeviceAltitude: null,
    lastAltitudeAccuracy: null,
    lastAccuracy: null,
    lastSpeed: 'N/A',
    lastEffectiveWindUnit: 'kt',
    lastDirection: 'N/A',
    lastTerrainAltitude: 'N/A',
    lastSmoothedSpeedMs: 0,
    map: null,
    baseMaps: {},
    lastLat: null,
    lastLng: null,
    lastAltitude: null,
    currentMarker: null,
    isManualPanning: false,
    autoupdateInterval: null,
    accuracyCircle: null,
    ensembleModelsData: null, // Objekt zur Speicherung der Wetterdaten für jedes ausgewählte Ensemble-Modell, z.B. { icon_global: weatherDataICON, gfs_global: weatherDataGFS }
    selectedEnsembleModels: [], // Array der Namen der ausgewählten Ensemble-Modelle
    currentEnsembleScenario: 'all_models', // Aktuell ausgewähltes Szenario
    ensembleLayerGroup: null, // Eigene LayerGroup für Ensemble-Visualisierungen
    ensembleScenarioCircles: {}, // Speichert die Leaflet-Layer für die Szenario-Kreise, z.B. { min_wind: circleLayer, mean_wind: circleLayer }
    heatmapLayer: null, // Für die Referenz auf den Heatmap-Layer
    favoritesLayerGroup: null, 
    poiLayerGroup: null,
    isArmed: false,
    isAutoRecording: false,
    isManualRecording: false, 
    recordedTrackPoints: [],
    autoRecordingStartTime: null, 
    altitudeCorrectionOffset: 0, 
    isInteractionLocked: false,

    ismapInitialized: false,              // von mapManager.js
    hasTileErrorSwitched: false,        // von mapManager.js
    isCachingCancelled: false,          // von tileCache.js
    
    // Layer-Gruppen und Listener
    jumpVisualizationLayerGroup: null,  // von mapManager.js
    landingPatternLayerGroup: null,     // von mapManager.js
    jumpRunTrackLayerGroup: null,       // von mapManager.js
    labelZoomListener: null,            // von mapManager.js
};