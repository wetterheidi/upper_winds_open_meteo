import { defineConfig } from 'vite'
import { resolve } from 'path'
import commonjs from '@rollup/plugin-commonjs'

export default defineConfig({
  // Definiere den Root für die Mobile-App
  root: 'src/ui-mobile',
  publicDir: resolve(__dirname, 'public'),

  // Für Capacitor ist die Base URL immer '/'
  base: '/',

  // ================== NEUER ABSCHNITT START ===================
  // Diese Sektion hilft dem Dev-Server, native Module zu ignorieren.
  ssr: {
    external: [
      '@capacitor/geolocation',
      '@capacitor/filesystem',
      '@capacitor-community/background-geolocation'
    ],
  },
  // ================== NEUER ABSCHNITT ENDE ====================

  build: {
    // Ausgabeverzeichnis für die Mobile-App
    outDir: resolve(__dirname, 'dist/mobile'),
    emptyOutDir: true,
    rollupOptions: {
      external: [
        '@capacitor/motion',
        '@capacitor-community/background-geolocation',
        '@capacitor/geolocation', // Zur Sicherheit auch hier hinzufügen
        '@capacitor/filesystem',  // Zur Sicherheit auch hier hinzufügen
      ]
    }
  },

  plugins: [
    commonjs(),
  ],
})