import { defineConfig } from 'vite'
import commonjs from '@rollup/plugin-commonjs' // Importiere das Plugin

export default defineConfig({
  base: '/upper_winds_open_meteo/',
  plugins: [
    // Füge das Plugin hier hinzu, um es zu aktivieren
    commonjs(), 
  ],
  // Wir können den alten 'build'-Block entfernen, da das Plugin diese Aufgabe besser erledigt.
})