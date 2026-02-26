// Shim für @capacitor-community/background-geolocation.
// Das npm-Paket enthält kein JavaScript-Bundle (nur nativen iOS/Android-Code).
// Capacitors registerPlugin() erzeugt einen Proxy, der das native RETURN_CALLBACK-Muster
// unterstützt — genau wie @capacitor/geolocation es für watchPosition nutzt.
import { registerPlugin } from '@capacitor/core';

export const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');
