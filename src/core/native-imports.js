// Diese Datei wird NUR im nativen Build importiert.

// Standard-Module
import { Geolocation } from '@capacitor/geolocation';
import { Filesystem, Directory } from '@capacitor/filesystem';

// Das problematische Plugin
import { BackgroundGeolocation } from '@capacitor-community/background-geolocation';

// Exportiere alle geladenen Module in einem Objekt
export const nativeModules = {
    Geolocation,
    Filesystem,
    Directory,
    BackgroundGeolocation,
    isNative: true
};