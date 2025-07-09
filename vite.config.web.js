import { defineConfig } from 'vite'
import { resolve } from 'path'
import commonjs from '@rollup/plugin-commonjs'

// Diese Konfiguration ist NUR für die Web-App
export default defineConfig(({ command }) => {
  return {
    // Der "root" der Web-App ist 'src/ui-web'
    root: 'src/ui-web',
    publicDir: resolve(__dirname, 'public'),

    // WICHTIG: Die Base URL ist für den Dev-Server immer '/', 
    // nur für den 'build' Befehl wird sie auf den Repository-Namen gesetzt.
    base: command === 'serve' ? '/' : '/upper_winds_open_meteo/',

    build: {
      outDir: resolve(__dirname, 'dist/web'),
      emptyOutDir: true,
      rollupOptions: {
        // Schließt alle @capacitor/* Pakete vom Web-Build aus.
        external: [
          /^@capacitor\//
        ]
      }
    },
    plugins: [
      commonjs(),
    ],
  }
})