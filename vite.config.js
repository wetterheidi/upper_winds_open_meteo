import { defineConfig } from 'vite'
import commonjs from '@rollup/plugin-commonjs' // Importiere das Plugin

export default defineConfig({
  base: '/upper_winds_open_meteo/',
  plugins: [
    // Füge das Plugin hier hinzu, um es zu aktivieren
    commonjs(),
  ],
  build: {
    rollupOptions: {
      external: ['leaflet', 'papaparse'],
      output: {
        globals: {
          leaflet: 'L',
          papaparse: 'Papa'
        }
      }
    }
  }
})