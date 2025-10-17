/**
 * Dieser Adapter lädt Capacitor-Module nur bei Bedarf und nur auf
 * nativen Plattformen. Für den Web-Browser stellt er sichere
 * Platzhalter bereit, um Build- und Laufzeitfehler zu vermeiden.
 */
import { Geolocation } from '@capacitor/geolocation';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Browser } from '@capacitor/browser';

let capacitorModulesPromise = null;
let deviceReadyPromise = null;
let isInitialized = false;

/**
 * Wartet auf das deviceready Event
 */
function waitForDeviceReady() {
    if (!deviceReadyPromise) {
        deviceReadyPromise = new Promise((resolve) => {
            // **NEU:** Prüfe, ob wir uns überhaupt in einer nativen Umgebung befinden.
            // Wenn nicht (d.h. im Web), müssen wir nicht auf 'deviceready' warten.
            if (!window.Capacitor || !window.Capacitor.isNativePlatform()) {
                console.log('Web environment detected, resolving deviceReady immediately.');
                resolve();
                return; // Wichtig: Die Funktion hier beenden.
            }

            // Die ursprüngliche Logik, die nur noch für native Plattformen ausgeführt wird.
            document.addEventListener('deviceready', () => {
                console.log('Native device is ready');
                resolve();
            }, { once: true });

            // Ein Fallback, falls 'deviceready' aus irgendeinem Grund nicht feuert
            setTimeout(() => {
                console.log('Fallback: Assuming native device is ready after 2s.');
                resolve();
            }, 2000);
        });
    }
    return deviceReadyPromise;
}

async function initialize() {
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        document.addEventListener('deviceready', () => {
            isInitialized = true;
        }, { once: true });
    } else {
        isInitialized = true;
    }
}

async function loadModules() {
    try {
        await waitForDeviceReady();
        
        if (window.Capacitor?.isNativePlatform()) {
            console.log('Loading native Capacitor modules');
            const modules = {
                Geolocation,
                Filesystem,
                Directory,
                Browser,
                isNative: true,
                isInitialized: true
            };
            isInitialized = true;
            return modules;
        }
    } catch (error) {
        console.error('Error loading Capacitor modules:', error);
    }
    
    return {
        Geolocation: null,
        Filesystem: null,
        Directory: null,
        Browser: null,
        isNative: false,
        isInitialized: false
    };
}

export async function getCapacitor() {
    if (!capacitorModulesPromise) {
        capacitorModulesPromise = loadModules().catch(error => {
            console.error('Critical: Failed to load Capacitor:', error);
            return {
                Geolocation: null,
                Filesystem: null,
                Directory: null,
                Browser: null,
                isNative: false,
                isInitialized: false
            };
        });
    }
    return capacitorModulesPromise;
}