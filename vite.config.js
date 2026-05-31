import { defineConfig } from 'vite'
import { resolve } from 'path'
import commonjs from '@rollup/plugin-commonjs'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))

export default defineConfig(({ command }) => ({
  root: 'src/ui-web',
  publicDir: resolve(__dirname, 'public'),
  base: '/upper_winds_open_meteo/',

  server: {
    open: '/',
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