import { defineConfig } from 'vite'
import { resolve } from 'path'
import commonjs from '@rollup/plugin-commonjs'

export default defineConfig({
  // NEU: Definiere den Root für die Web-App, genau wie bei der mobilen Konfiguration
  root: 'src/ui-web',

  // Korrekter Pfad zum 'public' Verzeichnis vom Projekt-Root aus
  publicDir: resolve(__dirname, 'public'),

  // Base-URL für den Build-Prozess (für GitHub Pages)
  base: '/upper_winds_open_meteo/',

  server: {
    // Da der 'root' jetzt 'src/ui-web' ist,
    // öffnet '/' automatisch die index.html in diesem Verzeichnis.
    open: '/',
  },

  resolve: {
    alias: {
      // Die Aliase für die Mocks bleiben, die Pfade sind dank resolve() korrekt
      '@capacitor/geolocation': resolve(__dirname, 'src/core/capacitor-mocks.js'),
      '@capacitor/filesystem': resolve(__dirname, 'src/core/capacitor-mocks.js'),
      '@capacitor-community/background-geolocation': resolve(__dirname, 'src/core/capacitor-mocks.js'),
    },
  },

  build: {
    // Ein sauberes, separates Ausgabeverzeichnis für die Web-App
    outDir: resolve(__dirname, 'dist/web'),
    emptyOutDir: true,
    rollupOptions: {
      // Vite findet die index.html automatisch im oben definierten 'root'
    },
  },

  plugins: [
    commonjs(),
  ],
})