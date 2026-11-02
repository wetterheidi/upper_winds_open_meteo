import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppState } from './state.js';
import { Utils } from './utils.js';
import { loadGpxTrack } from './trackManager.js';

// ===================================================================
// MOCKS & TEST-SETUP
// Prüft die Wahl der Bodenreferenz (DIP vs. Landepunkt) beim Laden eines GPX-Tracks.
// ===================================================================

vi.stubGlobal('window', {});

vi.stubGlobal('FileReader', class {
    readAsText(blob) {
        blob.text().then(text => this.onload?.({ target: { result: text } }));
    }
});

vi.stubGlobal('L', {
    layerGroup: () => ({ addLayer: vi.fn(), addTo: vi.fn() }),
    polyline: () => ({ bindTooltip: vi.fn().mockReturnThis(), on: vi.fn() }),
    latLngBounds: vi.fn(() => ({ isValid: () => true })),
});

// Minimaler XML-Parser für <wpt> und <trkpt> mit Attributen und Kind-Elementen.
vi.stubGlobal('DOMParser', class {
    parseFromString(str) {
        const parseElements = (tag) => [...str.matchAll(new RegExp(`<${tag} ([^>]*)>([\\s\\S]*?)</${tag}>`, 'g'))].map(([, attrs, body]) => ({
            getAttribute: (name) => attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null,
            getElementsByTagName: (child) => {
                const m = body.match(new RegExp(`<${child}>([^<]*)</${child}>`));
                return m ? [{ textContent: m[1] }] : [];
            }
        }));
        return { getElementsByTagName: parseElements };
    }
});

// Minimales DOM, das den Dialog erfasst.
let openDialogs = [];
const createElement = () => ({
    style: {}, children: [], textContent: '', className: '',
    append(...c) { this.children.push(...c); },
    appendChild(c) { this.children.push(c); },
    remove() { openDialogs = openDialogs.filter(d => d !== this); },
});
vi.stubGlobal('document', {
    createElement,
    getElementById: () => null,
    body: { appendChild: (el) => openDialogs.push(el) },
});

/** Klickt im offenen Dialog den Button, dessen Beschriftung den Schlüssel enthält. */
async function clickDialogButton(keyPart) {
    await vi.waitFor(() => expect(openDialogs.length).toBe(1));
    const buttons = openDialogs[0].children[0].children.find(c => c.className === 'modal-buttons').children;
    buttons.find(b => b.textContent.includes(keyPart)).onclick();
}

vi.mock('./capacitor-adapter.js', () => ({
    getCapacitor: vi.fn().mockResolvedValue({ isNative: false }),
}));

vi.mock('./settings.js', () => ({
    Settings: { getValue: vi.fn((key, def) => def), state: { userSettings: {} } },
}));

vi.mock('./i18n.js', () => ({
    I18n: { t: vi.fn((key) => key) },
}));

vi.mock('./state.js', () => ({
    AppState: {
        map: {
            hasLayer: vi.fn(), removeLayer: vi.fn(), fitBounds: vi.fn(),
            distance: vi.fn(),
            getContainer: vi.fn(() => ({ dispatchEvent: vi.fn() })),
            getMaxZoom: vi.fn(() => 18),
        },
        gpxLayer: null, gpxPoints: [], isLoadingGpx: false,
    }
}));

vi.mock('./utils.js', () => ({
    Utils: {
        handleError: vi.fn(),
        getAltitude: vi.fn(),
        getTooltipContent: vi.fn(() => ''),
        interpolateColor: vi.fn(() => '#ff0000'),
        formatDistance: vi.fn((m) => `${m} m`),
        convertHeight: vi.fn((v) => v),
        calculateBearing: vi.fn(() => 298),
        calculateDistance: vi.fn(() => 1468),
    }
}));

const DIP = { lat: 47.6254, lng: 14.1803 };
const LANDING = { lat: 47.5325, lng: 14.1416 };

const buildGpx = ({ withDip = true, withLanding = true } = {}) => `<gpx>
${withDip ? `<wpt lat="${DIP.lat}" lon="${DIP.lng}"><name>DIP</name><ele>2095.00</ele></wpt>` : ''}
${withLanding ? `<wpt lat="${LANDING.lat}" lon="${LANDING.lng}"><name>LANDING</name><ele>640.00</ele></wpt>` : ''}
<trk><trkseg>
<trkpt lat="47.61" lon="14.09"><ele>4125.29</ele><time>2026-09-23T09:17:44.335Z</time></trkpt>
<trkpt lat="${LANDING.lat}" lon="${LANDING.lng}"><ele>643.32</ele><time>2026-09-23T09:35:02.335Z</time></trkpt>
</trkseg></trk></gpx>`;

const gpxFile = (opts) => new File([new Blob([buildGpx(opts)])], 'track.gpx');

describe('Bodenreferenz beim Laden aufgezeichneter Tracks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        openDialogs = [];
        AppState.lastLat = null; AppState.lastLng = null; AppState.lastAltitude = 'N/A';
        // Geländehöhe: DIP-Position liegt am Berg, alles andere im Tal.
        Utils.getAltitude.mockImplementation(async (lat) => (lat === DIP.lat ? 2095 : 640));
    });

    it('übernimmt den DIP ohne Nachfrage, wenn er zum Landepunkt passt', async () => {
        AppState.map.distance.mockReturnValue(800);
        Utils.getAltitude.mockResolvedValue(645);

        await loadGpxTrack(gpxFile());

        expect(openDialogs.length).toBe(0);
        expect(AppState.lastLat).toBe(DIP.lat);
        expect(AppState.lastAltitude).toBe(645);
    });

    it('fragt bei zu großer Abweichung nach und übernimmt den Landepunkt', async () => {
        AppState.map.distance.mockReturnValue(10700);

        const loading = loadGpxTrack(gpxFile());
        await clickDialogButton('reference_use_landing');
        await loading;

        expect(AppState.lastLat).toBe(LANDING.lat);
        expect(AppState.lastLng).toBe(LANDING.lng);
        expect(AppState.lastAltitude).toBe(640);
    });

    it('behält auf Wunsch den DIP trotz Abweichung', async () => {
        AppState.map.distance.mockReturnValue(10700);

        const loading = loadGpxTrack(gpxFile());
        await clickDialogButton('reference_use_dip');
        await loading;

        expect(AppState.lastLat).toBe(DIP.lat);
        expect(AppState.lastAltitude).toBe(2095);
    });

    it('fragt auch bei kurzer Distanz nach, wenn die Höhendifferenz zu groß ist', async () => {
        AppState.map.distance.mockReturnValue(1500);

        const loading = loadGpxTrack(gpxFile());
        await clickDialogButton('reference_use_landing');
        await loading;

        expect(AppState.lastAltitude).toBe(640);
    });

    it('prüft ältere Dateien ohne LANDING-Wegpunkt gegen den letzten Trackpunkt', async () => {
        AppState.map.distance.mockReturnValue(10700);

        const loading = loadGpxTrack(gpxFile({ withLanding: false }));
        await clickDialogButton('reference_use_landing');
        await loading;

        expect(AppState.lastLat).toBe(LANDING.lat);
        expect(AppState.lastAltitude).toBe(640);
    });

    it('nutzt ohne DIP-Wegpunkt direkt den Landepunkt', async () => {
        await loadGpxTrack(gpxFile({ withDip: false }));

        expect(openDialogs.length).toBe(0);
        expect(AppState.lastLat).toBe(LANDING.lat);
        expect(AppState.lastAltitude).toBe(640);
    });
});

describe('Geplante Sprünge (HEIDIS) beim Laden', () => {
    const HEIDIS_GPX = `<gpx creator="HEIDIS V3.0.0.0">
<wpt lat="29.6338" lon="35.3134"><ele>4267</ele><name>x-3 min</name><sym>X-3M</sym></wpt>
<wpt lat="29.6958" lon="35.1793"><ele>4267</ele><name>HARP</name><sym>HARP</sym></wpt>
<wpt lat="29.7020" lon="35.1659"><ele>4267</ele><name>Ende Absetzen</name><sym>RD</sym></wpt>
<wpt lat="29.7815" lon="35.2228"><ele>1073</ele><name>Landeplatz</name><sym>DIP</sym></wpt>
<trk><trkseg>
<trkpt lat="29.6989" lon="35.1726"><ele>4267</ele><time>2026-10-09T18:00:00Z</time></trkpt>
<trkpt lat="29.7815" lon="35.2228"><ele>1073</ele><time>2026-10-09T18:09:23Z</time></trkpt>
</trkseg></trk></gpx>`;
    const heidisFile = () => new File([new Blob([HEIDIS_GPX])], 'heidis.gpx');

    let dispatched;
    beforeEach(() => {
        vi.clearAllMocks();
        openDialogs = [];
        dispatched = [];
        AppState.map.getContainer.mockReturnValue({ dispatchEvent: (e) => dispatched.push(e) });
        vi.stubGlobal('CustomEvent', class { constructor(type, init) { this.type = type; this.detail = init?.detail; } });
        // Offline: Geländeabfrage liefert nichts.
        Utils.getAltitude.mockResolvedValue('N/A');
    });

    it('fragt nach Wetterdaten und gibt "behalten" samt Bodenhöhe aus der Datei weiter', async () => {
        const loading = loadGpxTrack(heidisFile());
        await clickDialogButton('jump_plan_weather_keep');
        await loading;

        const detail = dispatched.find(e => e.type === 'track:loaded').detail;
        expect(detail.jumpPlan.loadWeather).toBe(false);
        expect(detail.altitude).toBe(1073);
        expect(AppState.lastAltitude).toBe(1073);
    });

    it('gibt "Wetterdaten laden" weiter', async () => {
        const loading = loadGpxTrack(heidisFile());
        await clickDialogButton('jump_plan_weather_load');
        await loading;

        expect(dispatched.find(e => e.type === 'track:loaded').detail.jumpPlan.loadWeather).toBe(true);
    });
});
