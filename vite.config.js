import { defineConfig } from 'vite'
import commonjs from '@rollup/plugin-commonjs' // Importiere das Plugin

export default defineConfig({
  base: '/upper_winds_open_meteo/',
  //base: './', // Für mobilde Builds
  plugins: [
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