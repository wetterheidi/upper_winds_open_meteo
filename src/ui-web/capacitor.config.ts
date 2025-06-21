import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.wetterheidi.dzmaster',
  appName: 'DZMaster',
  webDir: 'dist/mobile', // Holt sich den Build-Output von deinem Mobile-Vite-Skript
  server: {
    androidScheme: 'https'
  }
};

export default config;