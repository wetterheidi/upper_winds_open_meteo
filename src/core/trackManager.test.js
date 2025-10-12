import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppState } from './state.js';
import { Utils } from './utils.js';
import { loadGpxTrack, loadKmlTrack, loadCsvTrackUTC } from './trackManager.js';

// ===================================================================
// MOCKS & TEST-SETUP
// ===================================================================

vi.stubGlobal('window', {});

// **KORRIGIERTER MOCK: FileReader mit funktionierender readAsText-Methode**
vi.stubGlobal('FileReader', class {
    constructor() {
        this.onload = null;
    }
    readAsText(blob) {
        // Simuliert das asynchrone Lesen, indem der Inhalt des Blobs extrahiert wird
        blob.text().then(text => {
            if (this.onload) {
                // Das 'onload'-Event wird mit dem Ergebnis aufgerufen
                this.onload({ target: { result: text } });
            }
        });
    }
});

vi.stubGlobal('L', {
    geoJSON: (data, options) => {
        if (options && options.onEachFeature) {
            data.features.forEach(feature => options.onEachFeature(feature, {}));
        }
    },
    layerGroup: () => ({ addLayer: vi.fn(), addTo: vi.fn() }),
    polyline: () => ({ bindTooltip: vi.fn().mockReturnThis(), on: vi.fn() }),
    latLngBounds: vi.fn(() => ({ isValid: () => true })),
});

vi.stubGlobal('DOMParser', class {
    parseFromString(str) {
        if (str.includes('<trkpt')) {
            return {
                getElementsByTagName: (tag) => tag === 'trkpt' ? [
                    { getAttribute: (attr) => (attr === 'lat' ? '48.1' : '11.1'), getElementsByTagName: () => [{ textContent: '2023-10-27T10:00:00Z' }] },
                    { getAttribute: (attr) => (attr === 'lat' ? '48.2' : '11.2'), getElementsByTagName: () => [{ textContent: '2023-10-27T10:00:30Z' }] },
                ] : [],
            };
        }
        if (str.includes('<kml')) { return {}; }
        return { getElementsByTagName: () => [] };
    }
});

vi.stubGlobal('toGeoJSON', {
    kml: () => ({
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[11.3, 48.3, 600], [11.4, 48.4, 650]] },
            properties: { coordTimes: ['2023-10-27T11:00:00Z', '2023-10-27T11:00:30Z'] }
        }]
    })
});

vi.stubGlobal('Papa', {
    parse: (csv, config) => {
        if (csv && csv.includes('$GNSS')) {
            config.step({ data: ['$GNSS', '2023-10-27T12:00:00.000Z', '48.5', '11.5', '700'] });
            config.step({ data: ['$GNSS', '2023-10-27T12:00:30.000Z', '48.6', '11.6', '750'] });
        }
        config.complete();
    }
});

vi.mock('./state.js', () => ({
    AppState: {
        map: {
            hasLayer: vi.fn(), removeLayer: vi.fn(), fitBounds: vi.fn(),
            distance: vi.fn(() => 1000),
            getContainer: vi.fn(() => ({ dispatchEvent: vi.fn() })),
            getMaxZoom: vi.fn(() => 18),
        },
        gpxLayer: null, gpxPoints: [], isLoadingGpx: false,
    }
}));

vi.mock('./utils.js', () => ({
    Utils: {
        handleError: vi.fn(),
        getAltitude: vi.fn().mockResolvedValue(500),
        debounce: vi.fn((fn) => fn),
        getTooltipContent: vi.fn(() => 'Mock Tooltip'),
        interpolateColor: vi.fn(() => '#ff0000'),
    }
}));


const MOCK_GPX_CONTENT = `<gpx><trk><trkseg><trkpt lat="48.1" lon="11.1"><ele>500</ele><time>2023-10-27T10:00:00Z</time></trkpt><trkpt lat="48.2" lon="11.2"><ele>550</ele><time>2023-10-27T10:00:30Z</time></trkpt></trkseg></trk></gpx>`;
const MOCK_KML_CONTENT = `<kml><Placemark><LineString><coordinates>11.3,48.3,600 11.4,48.4,650</coordinates></LineString></Placemark></kml>`;
const MOCK_CSV_CONTENT = `$GNSS,2023-10-27T12:00:00.000Z,48.5,11.5,700\n$GNSS,2023-10-27T12:00:30.000Z,48.6,11.6,750`;


describe('trackManager.js', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        AppState.gpxLayer = null; AppState.gpxPoints = []; AppState.isLoadingGpx = false;
    });

    const createFile = (content, name) => new File([new Blob([content])], name);

    describe('loadGpxTrack', () => {
        it('sollte eine gültige GPX-Datei erfolgreich laden und verarbeiten', async () => {
            const file = createFile(MOCK_GPX_CONTENT, 'track.gpx');
            const result = await loadGpxTrack(file);
            expect(Utils.handleError).not.toHaveBeenCalled();
            expect(result).not.toBeNull();
            expect(result.finalPointData.lat).toBeCloseTo(48.2);
        });

        it('sollte bei einer fehlerhaften GPX-Datei einen Fehler behandeln', async () => {
            const file = createFile('<gpx><invalid></gpx>', 'invalid.gpx');
            const result = await loadGpxTrack(file);
            expect(result).toBeNull();
            expect(Utils.handleError).toHaveBeenCalledWith(expect.stringContaining('GPX track has insufficient points.'));
        });
    });

    describe('loadKmlTrack', () => {
        it('sollte eine gültige KML-Datei erfolgreich laden und verarbeiten', async () => {
            const file = createFile(MOCK_KML_CONTENT, 'track.kml');
            const result = await loadKmlTrack(file);
            expect(Utils.handleError).not.toHaveBeenCalled();
            expect(result).not.toBeNull();
            expect(result.finalPointData.lat).toBeCloseTo(48.4);
        });
    });

    describe('loadCsvTrackUTC', () => {
        it('sollte eine gültige CSV-Datei erfolgreich laden und verarbeiten', async () => {
            const file = createFile(MOCK_CSV_CONTENT, 'track.csv');
            const result = await loadCsvTrackUTC(file);
            expect(Utils.handleError).not.toHaveBeenCalled();
            expect(result).not.toBeNull();
            expect(result.finalPointData.lat).toBeCloseTo(48.6);
        });
        
        // **KORRIGIERTER TESTFALL**
        it('sollte bei einer leeren CSV-Datei einen Fehler werfen', async () => {
            const file = createFile('', 'empty.csv');
            // Erwarte, dass das Promise rejected wird, da die Funktion intern einen Fehler wirft
            await expect(loadCsvTrackUTC(file)).rejects.toThrow('CSV track has insufficient points.');
        });
    });
});