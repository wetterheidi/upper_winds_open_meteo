import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppState } from './state.js';
import { Settings } from './settings.js';
import { parseJumpPlanWaypoints, applyImportedJumpPlan } from './trackManager.js';

// ===================================================================
// MOCKS & TEST-SETUP
// Prüft Erkennung und Übernahme geplanter Sprünge aus HEIDIS-GPX-Dateien.
// ===================================================================

vi.stubGlobal('window', {});

const inputs = {};
vi.stubGlobal('document', {
    getElementById: (id) => (inputs[id] ??= { value: '', checked: false }),
    querySelector: () => null,
});

vi.mock('./capacitor-adapter.js', () => ({
    getCapacitor: vi.fn().mockResolvedValue({ isNative: false }),
}));

vi.mock('./settings.js', () => ({
    Settings: {
        getValue: vi.fn((key, type, def) => (key === 'heightUnit' ? 'm' : (def ?? type))),
        save: vi.fn(),
        state: { userSettings: {} },
    },
}));

vi.mock('./i18n.js', () => ({
    I18n: { t: vi.fn((key) => key) },
}));

// Wegpunkte aus einer HEIDIS-Datei (Symbol, Position, Höhe MSL); alle Punkte liegen auf 298°.
const HEIDIS_WAYPOINTS = [
    { sym: 'X-3M', lat: 29.633843227023693, lng: 35.313431533391466, ele: 4267 },
    { sym: 'X-1M', lat: 29.67515971848653, lng: 35.224015186364774, ele: 4267 },
    { sym: 'X-15S', lat: 29.690653402785095, lng: 35.19047458259061, ele: 4267 },
    { sym: 'HARP', lat: 29.695817964217948, lng: 35.17929323211353, ele: 4267 },
    { sym: 'GD', lat: 29.69891670107766, lng: 35.172584145931964, ele: 4267 },
    { sym: 'RD', lat: 29.702015437937373, lng: 35.16587485279921, ele: 4267 },
    { sym: 'TRP', lat: 29.709163211384798, lng: 35.17839451315595, ele: 3651 },
    { sym: 'EFF', lat: 29.70054653123555, lng: 35.17042373804559, ele: 4151 },
    { sym: 'DIP', lat: 29.781486091721874, lng: 35.22283626645645, ele: 1073 },
];

describe('parseJumpPlanWaypoints', () => {
    it('erkennt eine HEIDIS-Planung und leitet HARP, Richtung, Länge und Höhen ab', () => {
        const plan = parseJumpPlanWaypoints(HEIDIS_WAYPOINTS);

        expect(plan.harp).toEqual({ lat: 29.695817964217948, lng: 35.17929323211353 });
        expect(plan.direction).toBeCloseTo(298, 0);
        expect(plan.trackLength).toBeCloseTo(1468, -1); // HARP → RD
        expect(plan.exitAltitudeMSL).toBe(4267);
        expect(plan.openingAltitudeMSL).toBe(4151);
    });

    it('nimmt für die Richtung den nächsten vorhandenen Anflugpunkt, wenn x-3 fehlt', () => {
        const plan = parseJumpPlanWaypoints(HEIDIS_WAYPOINTS.filter(w => w.sym !== 'X-3M'));
        expect(plan.direction).toBeCloseTo(298, 0);
    });

    it('liefert null für normale Tracks ohne Planungspunkte', () => {
        expect(parseJumpPlanWaypoints([])).toBeNull();
        expect(parseJumpPlanWaypoints([{ sym: 'FLAG, BLUE', lat: 47, lng: 11, ele: 600 }])).toBeNull();
        expect(parseJumpPlanWaypoints(HEIDIS_WAYPOINTS.filter(w => w.sym !== 'RD'))).toBeNull();
    });
});

describe('applyImportedJumpPlan', () => {
    beforeEach(() => {
        Settings.state.userSettings = { jumpRunTrackOffset: 250, jumpRunTrackForwardOffset: -400, showJumpRunTrack: false };
        AppState.importedJumpRun = null;
        AppState.lastLat = 29.7815;
        AppState.lastLng = 35.2228;
        AppState.lastAltitude = 1073;
    });

    it('übernimmt Richtung, Absetzstrecke ab HARP und Höhen (AGL)', () => {
        applyImportedJumpPlan(parseJumpPlanWaypoints(HEIDIS_WAYPOINTS));
        const s = Settings.state.userSettings;

        expect(s.customJumpRunDirection).toBe(298);
        expect(s.jumpRunTrackOffset).toBe(0);
        expect(s.jumpRunTrackForwardOffset).toBe(0);
        expect(s.showJumpRunTrack).toBe(true);
        expect(s.exitAltitude).toBe(3194);
        expect(s.openingAltitude).toBe(3078);
        expect(inputs.exitAltitude.value).toBe(3194);
        expect(inputs.jumpRunTrackDirection.value).toBe(298);
        expect(AppState.importedJumpRun.trackLength).toBeCloseTo(1468, -1);
    });

    it('lässt die Höhen unverändert, wenn die Geländehöhe unbekannt ist', () => {
        AppState.lastAltitude = 'N/A';
        Settings.state.userSettings.exitAltitude = 3000;
        applyImportedJumpPlan(parseJumpPlanWaypoints(HEIDIS_WAYPOINTS));
        expect(Settings.state.userSettings.exitAltitude).toBe(3000);
        expect(Settings.state.userSettings.customJumpRunDirection).toBe(298);
    });
});
