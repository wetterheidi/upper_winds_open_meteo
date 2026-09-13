import { defineConfig } from 'vite'
import { resolve } from 'path'
import commonjs from '@rollup/plugin-commonjs'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))

// Komponentenbibliothek meteokit: eigenes Repo, als `file:`-Abhängigkeit
// eingebunden (s. package.json). npm legt dafür einen Symlink in
// node_modules an, das Ziel liegt also außerhalb des Projekt-Roots (daher
// `server.fs.allow` unten). Voraussetzung: beide Repos nebeneinander
// ausgecheckt.
const meteokit = resolve(__dirname, '../meteokit')

export default defineConfig(({ command }) => ({
  root: 'src/ui-web',
  envDir: __dirname,
  publicDir: resolve(__dirname, 'public'),
  base: '/upper_winds_open_meteo/',

  // meteokit ist ein Quellpaket, kein vorgebautes Bundle: Vite würde es
  // sonst mit esbuild vorbündeln, das Vite-eigene Import-Suffixe wie
  // `?inline` (gramet-panel.js lädt so sein CSS) nicht kennt.
  optimizeDeps: { exclude: ['meteokit'] },

  server: {
    open: '/',
    // Die Bibliothek liegt außerhalb des Projekt-Roots -- ohne diese
    // Freigabe verweigert der Dev-Server das Ausliefern ihrer Module.
    fs: { allow: [__dirname, meteokit] },
  },

  resolve: {
    alias: {
      '@capacitor/geolocation': resolve(__dirname, 'src/core/capacitor-mocks.js'),
      '@capacitor/filesystem': resolve(__dirname, 'src/core/capacitor-mocks.js'),
      '@capacitor-community/background-geolocation': resolve(__dirname, 'src/core/capacitor-mocks.js'),
    },
  },

  build: {
    outDir: resolve(__dirname, 'dist/web'),
    emptyOutDir: true,
  },

  esbuild: {
    drop: command === 'build' ? ['console', 'debugger'] : [],
  },

  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },

  plugins: [
    commonjs(),
  ],
}))