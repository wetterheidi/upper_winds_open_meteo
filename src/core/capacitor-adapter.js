/**
 * Dieser Adapter lädt Capacitor-Module nur bei Bedarf und nur auf
 * nativen Plattformen. Für den Web-Browser stellt er sichere
 * Platzhalter bereit, um Build- und Laufzeitfehler zu vermeiden.
 */
import { Geolocation } from '@capacitor/geolocation';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { StatusBar } from '@capacitor/status-bar';
import { BackgroundGeolocation } from '@capacitor-community/background-geolocation';

const DEVICE_READY_FALLBACK_MS = 2000;

let capacitorModulesPromise = null;
let deviceReadyPromise = null;

/**
 * Wartet auf das deviceready Event
 */
function waitForDeviceReady() {
    if (!deviceReadyPromise) {
        deviceReadyPromise = new Promise((resolve) => {
            if (!window.Capacitor || !window.Capacitor.isNativePlatform()) {
                console.log('Web environment detected, resolving deviceReady immediately.');
                resolve();
                return;
            }

            document.addEventListener('deviceready', () => {
                console.log('Native device is ready');
                resolve();
            }, { once: true });

            // Ein Fallback, falls 'deviceready' aus irgendeinem Grund nicht feuert
            setTimeout(() => {
                console.log('Fallback: Assuming native device is ready after 2s.');
                resolve();
            }, DEVICE_READY_FALLBACK_MS);
        });
    }
    return deviceReadyPromise;
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
                Capacitor,
                App,
                StatusBar,
                BackgroundGeolocation,
                isNative: true,
                isInitialized: true
            };
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
        Capacitor: null,
        App: null,
        StatusBar: null,
        BackgroundGeolocation: null,
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
                Capacitor: null,
                App: null,
                StatusBar: null,
                BackgroundGeolocation: null,
                isNative: false,
                isInitialized: false
            };
        });
    }
    return capacitorModulesPromise;
}