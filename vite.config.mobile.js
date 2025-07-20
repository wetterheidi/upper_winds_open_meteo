import { defineConfig } from 'vite'
import { resolve } from 'path'
import commonjs from '@rollup/plugin-commonjs'

export default defineConfig({
  root: 'src/ui-mobile',
  publicDir: resolve(__dirname, 'public'),
  base: '/',
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