// src/core/native-imports.js

// Diese Datei wird NUR im nativen Build importiert und bündelt alle
// echten Capacitor-Plugins.

import { Geolocation } from '@capacitor/geolocation';
import { Filesystem, Directory } from '@capacitor/filesystem';
// Hier können Sie später auch wieder das BackgroundGeolocation Plugin hinzufügen:
// import { BackgroundGeolocation } from '@capacitor-community/background-geolocation';

// Exportiere alle geladenen Module in einem einzigen Objekt
export const nativeModules = {
    Geolocation,
    Filesystem,
    Directory,
    // BackgroundGeolocation, // <-- bei Bedarf wieder einkommentieren
    isNative: true
};