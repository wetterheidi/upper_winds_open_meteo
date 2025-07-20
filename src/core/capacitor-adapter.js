/**
 * Dieser Adapter lädt Capacitor-Module nur bei Bedarf und nur auf
 * nativen Plattformen. Für den Web-Browser stellt er sichere
 * Platzhalter bereit, um Build- und Laufzeitfehler zu vermeiden.
 */
import { Geolocation } from '@capacitor/geolocation'; // Wichtig: Standard-Import
import { Filesystem, Directory } from '@capacitor/filesystem'; // Wichtig: Standard-Import

let capacitorModulesPromise = null;

async function loadModules() {
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        // Auf dem Handy sind Geolocation und Filesystem die echten Plugins.
        return { Geolocation, Filesystem, Directory, isNative: true };
    } else {
        // Im Web sind Geolocation und Filesystem dank unseres Mocks `null`.
        return { Geolocation: null, Filesystem: null, Directory: null, isNative: false };
    }
}

export function getCapacitor() {
    if (!capacitorModulesPromise) {
        capacitorModulesPromise = loadModules();
    }
    return capacitorModulesPromise;
}