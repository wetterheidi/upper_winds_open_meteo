/**
 * Dieser Adapter lädt Capacitor-Module nur bei Bedarf und nur auf
 * nativen Plattformen. Für den Web-Browser stellt er sichere
 * Platzhalter bereit, um Build- und Laufzeitfehler zu vermeiden.
 */
import { Geolocation } from '@capacitor/geolocation';
import { Filesystem, Directory } from '@capacitor/filesystem';

let capacitorModulesPromise = null;

async function loadModules() {
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        return { Geolocation, Filesystem, Directory, isNative: true };
    } else {
        return { Geolocation: null, Filesystem: null, Directory: null, isNative: false };
    }
}

export function getCapacitor() {
    if (!capacitorModulesPromise) {
        capacitorModulesPromise = loadModules();
    }
    return capacitorModulesPromise;
}