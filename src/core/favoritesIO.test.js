import { describe, it, expect, vi, beforeEach } from 'vitest';

// ===================================================================
// MOCKS & TEST-SETUP
// ===================================================================

// localStorage-Mock, bevor locationManager.js geladen wird (gleiches Muster
// wie in locationManager.test.js)
vi.mock('./locationManager.js', async (importOriginal) => {
    const localStorageMock = (() => {
        let store = {};
        return {
            getItem: (key) => store[key] || null,
            setItem: (key, value) => { store[key] = value.toString(); },
            removeItem: (key) => { delete store[key]; },
            clear: () => { store = {}; },
        };
    })();
    vi.stubGlobal('localStorage', localStorageMock);
    const originalModule = await importOriginal();
    return { ...originalModule };
});

vi.mock('mgrs', () => ({ toPoint: () => { throw new Error('not used'); } }));

vi.mock('./utils.js', () => ({
    Utils: {
        handleMessage: vi.fn(),
        handleError: vi.fn(),
    }
}));

vi.mock('./i18n.js', () => ({
    I18n: { t: (key) => key }
}));

vi.mock('./capacitor-adapter.js', () => ({
    getCapacitor: async () => ({ Filesystem: null, Directory: null, isNative: false })
}));

// _dispatchFavoritesUpdate benötigt document/CustomEvent
vi.stubGlobal('document', { dispatchEvent: vi.fn() });
vi.stubGlobal('CustomEvent', class {
    constructor(type, options) { this.type = type; this.detail = options?.detail; }
});

import { Utils } from './utils.js';
import { getCoordHistory, saveCoordHistory } from './locationManager.js';
import { sanitizeFavoritesFileName, importFavoritesFromContent } from './favoritesIO.js';

describe('favoritesIO.js', () => {

    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
    });

    describe('sanitizeFavoritesFileName(..)', () => {
        it('sollte einen einfachen Namen mit .json-Endung versehen', () => {
            expect(sanitizeFavoritesFileName('Fav_USA')).toBe('Fav_USA.json');
        });

        it('sollte eine vorhandene .json-Endung nicht verdoppeln', () => {
            expect(sanitizeFavoritesFileName('Fav_USA.json')).toBe('Fav_USA.json');
        });

        it('sollte unzulässige Pfad-Zeichen ersetzen', () => {
            expect(sanitizeFavoritesFileName('../evil/name')).toBe('_evil_name.json');
        });

        it('sollte bei leerer Eingabe einen Standardnamen verwenden', () => {
            expect(sanitizeFavoritesFileName('   ')).toMatch(/^DZMaster_Favorites_\d{4}-\d{2}-\d{2}\.json$/);
        });
    });

    describe('importFavoritesFromContent(..)', () => {
        it('sollte Favoriten aus dem Exportformat importieren', () => {
            const content = JSON.stringify({
                format: 'dzmaster-favorites',
                version: 1,
                favorites: [
                    { lat: 48.1, lng: 11.5, label: 'DZ Bayern', isHomeDZ: false },
                    { lat: 33.6, lng: -112.1, label: 'DZ Arizona', isHomeDZ: false },
                ]
            });

            expect(importFavoritesFromContent(content)).toBe(true);

            const favorites = getCoordHistory().filter(e => e.isFavorite);
            expect(favorites).toHaveLength(2);
            expect(favorites.map(f => f.label)).toContain('DZ Bayern');
            expect(favorites.map(f => f.label)).toContain('DZ Arizona');
            expect(Utils.handleMessage).toHaveBeenCalled();
        });

        it('sollte auch ein nacktes Array von Favoriten akzeptieren', () => {
            const content = JSON.stringify([{ lat: 48.1, lng: 11.5, label: 'DZ Bayern' }]);
            expect(importFavoritesFromContent(content)).toBe(true);
            expect(getCoordHistory().filter(e => e.isFavorite)).toHaveLength(1);
        });

        it('sollte bestehende Einträge mit gleichen Koordinaten aktualisieren statt duplizieren', () => {
            saveCoordHistory([{ lat: 48.1, lng: 11.5, label: 'Alter Name', isFavorite: false, timestamp: 1 }]);

            const content = JSON.stringify([{ lat: 48.1, lng: 11.5, label: 'Neuer Name' }]);
            expect(importFavoritesFromContent(content)).toBe(true);

            const history = getCoordHistory();
            expect(history).toHaveLength(1);
            expect(history[0].label).toBe('Neuer Name');
            expect(history[0].isFavorite).toBe(true);
        });

        it('sollte einen bestehenden Home DZ nicht überschreiben', () => {
            saveCoordHistory([{ lat: 48.1, lng: 11.5, label: 'Mein DZ', isFavorite: true, isHomeDZ: true, timestamp: 1 }]);

            const content = JSON.stringify([{ lat: 33.6, lng: -112.1, label: 'DZ Arizona', isHomeDZ: true }]);
            expect(importFavoritesFromContent(content)).toBe(true);

            const homeDZs = getCoordHistory().filter(e => e.isHomeDZ);
            expect(homeDZs).toHaveLength(1);
            expect(homeDZs[0].label).toBe('Mein DZ');
        });

        it('sollte den Home DZ übernehmen, wenn noch keiner gesetzt ist', () => {
            const content = JSON.stringify([{ lat: 33.6, lng: -112.1, label: 'DZ Arizona', isHomeDZ: true }]);
            expect(importFavoritesFromContent(content)).toBe(true);

            const homeDZs = getCoordHistory().filter(e => e.isHomeDZ);
            expect(homeDZs).toHaveLength(1);
            expect(homeDZs[0].label).toBe('DZ Arizona');
        });

        it('sollte ungültiges JSON mit Fehlermeldung ablehnen', () => {
            expect(importFavoritesFromContent('kein json')).toBe(false);
            expect(Utils.handleError).toHaveBeenCalled();
            expect(getCoordHistory()).toHaveLength(0);
        });

        it('sollte JSON ohne Favoriten-Array ablehnen', () => {
            expect(importFavoritesFromContent(JSON.stringify({ foo: 'bar' }))).toBe(false);
            expect(Utils.handleError).toHaveBeenCalled();
        });

        it('sollte Einträge mit ungültigen Koordinaten herausfiltern', () => {
            const content = JSON.stringify([
                { lat: 991, lng: 11.5, label: 'Ungültig' },
                { lat: 48.1, lng: 11.5, label: 'Gültig' },
                { lat: 48.2, lng: 11.6 }, // fehlendes Label
            ]);
            expect(importFavoritesFromContent(content)).toBe(true);

            const favorites = getCoordHistory().filter(e => e.isFavorite);
            expect(favorites).toHaveLength(1);
            expect(favorites[0].label).toBe('Gültig');
        });
    });
});
