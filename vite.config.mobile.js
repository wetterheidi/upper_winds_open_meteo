import { defineConfig } from 'vite'
import { resolve } from 'path'
import commonjs from '@rollup/plugin-commonjs'

export default defineConfig({
  // Definiere den Root für die Mobile-App
  root: 'src/ui-mobile',
  publicDir: resolve(__dirname, 'public'),

  // Für Capacitor ist die Base URL immer '/'
  base: '/',

  build: {
    // Ausgabeverzeichnis für die Mobile-App
    outDir: resolve(__dirname, 'dist/mobile'),
    emptyOutDir: true,
  },

  plugins: [
    commonjs(),
  ],
})