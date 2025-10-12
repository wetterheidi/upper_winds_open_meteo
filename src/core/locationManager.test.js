import { describe, it, expect, vi, beforeEach } from 'vitest';

// Wir erstellen einen Mock für das Modul, das den Fehler verursacht.
vi.mock('./locationManager.js', async (importOriginal) => {
    // Zuerst erstellen wir den localStorage-Mock, da er global benötigt wird.
    const localStorageMock = (() => {
        let store = {};
        return {
            getItem: (key) => store[key] || null,
            setItem: (key, value) => { store[key] = value.toString(); },
            removeItem: (key) => { delete store[key]; },
            clear: () => { store = {}; },
        };
    })();

    // Wir weisen den Mock dem globalen Geltungsbereich zu, BEVOR das eigentliche Modul importiert wird.
    vi.stubGlobal('localStorage', localStorageMock);

    // Jetzt, da die Umgebung vorbereitet ist, laden wir das originale Modul.
    const originalModule = await importOriginal();
    
    // Wir geben alle originalen Exporte des Moduls zurück, damit die Tests wie gewohnt funktionieren.
    return {
        ...originalModule,
    };
});

// Die Imports müssen NACH dem Mock erfolgen.
import { parseQueryAsCoordinates, getCoordHistory, saveCoordHistory } from './locationManager.js';

// Mocken der 'mgrs' Bibliothek
vi.mock('mgrs', () => ({
    toPoint: (mgrsString) => {
        if (mgrsString === '32UPU6347420615') {
            return [11.1923, 48.0179]; // [lng, lat]
        }
        throw new Error('Invalid MGRS');
    }
}));


describe('locationManager.js', () => {
    
    beforeEach(() => {
        // Bereinigt den Store vor jedem Test für saubere Testbedingungen
        localStorage.clear();
    });

    describe('parseQueryAsCoordinates(..)', () => {

        // --- Testfälle für gültige Dezimalgrad-Formate ---
        it('sollte Dezimalgrade mit Komma korrekt parsen', () => {
            const result = parseQueryAsCoordinates('48.12345, 11.56789');
            expect(result).not.toBeNull();
            expect(result.lat).toBeCloseTo(48.12345);
            expect(result.lng).toBeCloseTo(11.56789);
        });

        it('sollte Dezimalgrade mit Leerzeichen korrekt parsen', () => {
            const result = parseQueryAsCoordinates('48.12345 11.56789');
            expect(result).not.toBeNull();
            expect(result.lat).toBeCloseTo(48.12345);
            expect(result.lng).toBeCloseTo(11.56789);
        });

        it('sollte negative Dezimalgrade korrekt parsen', () => {
            const result = parseQueryAsCoordinates('-34.987, -56.123');
            expect(result).not.toBeNull();
            expect(result.lat).toBeCloseTo(-34.987);
            expect(result.lng).toBeCloseTo(-56.123);
        });

        it('sollte Eingaben mit zusätzlichen Leerzeichen tolerieren', () => {
            const result = parseQueryAsCoordinates('  48.123  ,  11.567  ');
            expect(result).not.toBeNull();
            expect(result.lat).toBeCloseTo(48.123);
            expect(result.lng).toBeCloseTo(11.567);
        });

        // --- Testfälle für MGRS ---
        it('sollte einen gültigen MGRS-String korrekt parsen', () => {
            const result = parseQueryAsCoordinates('32UPU6347420615');
            expect(result).not.toBeNull();
            expect(result.lat).toBeCloseTo(48.0179);
            expect(result.lng).toBeCloseTo(11.1923);
        });
        
        it('sollte einen MGRS-String mit Leerzeichen korrekt parsen', () => {
            const result = parseQueryAsCoordinates('32U PU 63474 20615');
            expect(result).not.toBeNull();
            expect(result.lat).toBeCloseTo(48.0179);
            expect(result.lng).toBeCloseTo(11.1923);
        });

        // --- Testfälle für ungültige Eingaben ---
        it('sollte für einen reinen Text-String null zurückgeben', () => {
            const result = parseQueryAsCoordinates('München');
            expect(result).toBeNull();
        });

        it('sollte für eine unvollständige Koordinate null zurückgeben', () => {
            const result = parseQueryAsCoordinates('48.123');
            expect(result).toBeNull();
        });

        it('sollte für einen ungültigen MGRS-String null zurückgeben', () => {
            const result = parseQueryAsCoordinates('INVALIDMGRS');
            expect(result).toBeNull();
        });

        it('sollte für eine leere Eingabe null zurückgeben', () => {
            const result = parseQueryAsCoordinates('   ');
            expect(result).toBeNull();
        });
    });
});