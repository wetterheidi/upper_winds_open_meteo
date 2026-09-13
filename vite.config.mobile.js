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
  root: 'src/ui-mobile',
  envDir: __dirname,
  publicDir: resolve(__dirname, 'public'),
  base: '/',
  // meteokit ist ein Quellpaket, kein vorgebautes Bundle: Vite würde es
  // sonst mit esbuild vorbündeln, das Vite-eigene Import-Suffixe wie
  // `?inline` (gramet-panel.js lädt so sein CSS) nicht kennt.
  optimizeDeps: { exclude: ['meteokit'] },
  server: {
    // Die Bibliothek liegt außerhalb des Projekt-Roots -- ohne diese
    // Freigabe verweigert der Dev-Server das Ausliefern ihrer Module.
    fs: { allow: [__dirname, meteokit] },
  },
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
      external: []
    }
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