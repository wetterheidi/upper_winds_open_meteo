/**
 * Dieser Adapter lädt Capacitor-Module nur bei Bedarf und nur auf
 * nativen Plattformen. Für den Web-Browser stellt er sichere
 * Platzhalter bereit, um Build- und Laufzeitfehler zu vermeiden.
 */

let capacitorModulesPromise = null;

async function loadModules() {
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        try {
            console.log("Capacitor-Plattform erkannt. Lade native Module...");
            // Importiere die separate Datei, die alle nativen Module enthält
            const { nativeModules } = await import('./native-imports.js');
            console.log("Native Module erfolgreich geladen.");
            return nativeModules;
        } catch (error) {
            console.error("Kritischer Fehler: Native Module konnten nicht geladen werden.", error);
            // Fallback
            return { Geolocation: null, Filesystem: null, Directory: null, BackgroundGeolocation: null, isNative: true };
        }
    } else {
        // Dies ist eine Web-Umgebung. Es wird nichts importiert.
        console.log("Web-Umgebung erkannt. Native Module werden nicht geladen.");
        return Promise.resolve({
            Geolocation: null,
            Filesystem: null,
            Directory: null,
            BackgroundGeolocation: null,
            isNative: false
        });
    }
}

/**
 * Holt die benötigten Capacitor-Module.
 */
export function getCapacitor() {
    if (!capacitorModulesPromise) {
        capacitorModulesPromise = loadModules();
    }
    return capacitorModulesPromise;
}