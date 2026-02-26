import { defineConfig } from 'vite'
import { resolve } from 'path'
import commonjs from '@rollup/plugin-commonjs'

export default defineConfig({
  root: 'src/ui-mobile',
  publicDir: resolve(__dirname, 'public'),
  base: '/',
  resolve: {
    alias: {
      // Das npm-Paket hat kein JS-Bundle — Shim über registerPlugin() nutzen.
      '@capacitor-community/background-geolocation': resolve(__dirname, 'src/core/background-geo-shim.js'),
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist/mobile'),
    emptyOutDir: true,
    rollupOptions: {
      // Entfernen Sie alle 'external' Einträge für @capacitor/* hier
      external: []
    }
  },
  plugins: [
    commonjs(),
  ],
})