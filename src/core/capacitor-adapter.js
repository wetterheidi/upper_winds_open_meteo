/**
 * Dieser Adapter exportiert eine Funktion, die alle benötigten Capacitor-Module
 * bei Bedarf asynchron lädt. Dies vermeidet Top-Level-Await-Fehler beim Build.
 */

let capacitorModules = null;

async function loadCapacitorModules() {
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        // Lade alle benötigten Module parallel
        const [filesystem, geolocation] = await Promise.all([
            import('@capacitor/filesystem'),
            import('@capacitor/geolocation')
        ]);
        return {
            Filesystem: filesystem.Filesystem,
            Directory: filesystem.Directory,
            Geolocation: geolocation.Geolocation
        };
    }
    // Für den Web-Browser geben wir Dummy-Objekte zurück.
    return {
        Filesystem: {},
        Directory: {},
        Geolocation: {}
    };
}

/**
 * Exportierte Funktion. Lädt die Module nur einmal und gibt sie dann
 * aus dem Cache zurück.
 */
export async function getCapacitorModules() {
    if (!capacitorModules) {
        capacitorModules = await loadCapacitorModules();
    }
    return capacitorModules;
}