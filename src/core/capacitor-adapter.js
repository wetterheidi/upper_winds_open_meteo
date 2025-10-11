/**
 * Dieser Adapter lädt Capacitor-Module nur bei Bedarf und nur auf
 * nativen Plattformen. Für den Web-Browser stellt er sichere
 * Platzhalter bereit, um Build- und Laufzeitfehler zu vermeiden.
 */
import { Geolocation } from '@capacitor/geolocation';
import { Filesystem, Directory } from '@capacitor/filesystem';

let capacitorModulesPromise = null;
let deviceReadyPromise = null;
let isInitialized = false;

/**
 * Wartet auf das deviceready Event
 */
function waitForDeviceReady() {
    if (!deviceReadyPromise) {
        deviceReadyPromise = new Promise((resolve) => {
            if (document.readyState === 'complete' && window.Capacitor) {
                resolve();
            } else {
                document.addEventListener('deviceready', () => {
                    console.log('Device is ready');
                    resolve();
                }, { once: true });
                
                // Fallback falls deviceready nicht kommt
                setTimeout(() => {
                    if (window.Capacitor) {
                        console.log('Fallback: Device seems ready');
                        resolve();
                    }
                }, 2000);
            }
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
                isNative: false,
                isInitialized: false
            };
        });
    }
    return capacitorModulesPromise;
}