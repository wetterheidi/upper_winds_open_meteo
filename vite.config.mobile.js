import { defineConfig } from 'vite'
import { resolve } from 'path'
import commonjs from '@rollup/plugin-commonjs'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))

export default defineConfig(({ command }) => ({
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