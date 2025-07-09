/**
 * Dieser Adapter lädt Capacitor-Module nur bei Bedarf und nur auf
 * nativen Plattformen. Für den Web-Browser stellt er sichere
 * Platzhalter bereit, um Build- und Laufzeitfehler zu vermeiden.
 */

// Eine Variable, um das geladene Modul-Objekt zu speichern (Singleton-Muster).
let capacitorModules = null;

async function loadModules() {
    // Nur in einer echten Capacitor-Umgebung versuchen, die Module zu laden.
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        try {
            console.log("Capacitor-Plattform erkannt. Lade native Module...");
            // Lade die Module explizit.
            const geolocationModule = await import('@capacitor/geolocation');
            const filesystemModule = await import('@capacitor/filesystem');
            
            console.log("Native Module erfolgreich geladen.");
            // Gib ein Objekt zurück, das die echten, funktionalen Module enthält.
            return {
                Geolocation: geolocationModule.Geolocation,
                Filesystem: filesystemModule.Filesystem,
                Directory: filesystemModule.Directory,
                isNative: true
            };
        } catch (error) {
            console.error("Kritischer Fehler: Capacitor-Module konnten auf nativer Plattform nicht geladen werden.", error);
            // Fallback, um einen App-Absturz zu verhindern.
            return { Geolocation: null, Filesystem: null, Directory: null, isNative: true };
        }
    } else {
        // Dies ist eine Web-Umgebung.
        console.log("Web-Umgebung erkannt. Native Module werden nicht geladen.");
        return {
            Geolocation: null, // Explizit null, damit der Code darauf prüfen kann.
            Filesystem: null,
            Directory: null,
            isNative: false
        };
    }
}

/**
 * Holt die benötigten Capacitor-Module. Die Funktion lädt die Module
 * nur beim ersten Aufruf und gibt danach den zwischengespeicherten Wert zurück.
 * @returns {Promise<{Geolocation: object|null, Filesystem: object|null, Directory: object|null, isNative: boolean}>}
 */
export function getCapacitor() {
    if (!capacitorModules) {
        capacitorModules = loadModules();
    }
    return capacitorModules;
}