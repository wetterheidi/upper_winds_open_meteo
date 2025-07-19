import { defineConfig } from 'vite'
import { resolve } from 'path'
import commonjs from '@rollup/plugin-commonjs'

export default defineConfig(({ command }) => {
  return {
    // Der 'root' bleibt immer das Projekt-Hauptverzeichnis.
    
    publicDir: 'public',

    // 'base' ist der einzige Wert, der sich ändern muss.
    base: command === 'serve' ? '/' : '/upper_winds_open_meteo/',

    server: {
      // Sag dem Dev-Server, welche Seite er beim Start öffnen soll.
      // Der Pfad ist absolut vom Projekt-Root.
      open: '/src/ui-web/index.html',
    },

    build: {
      outDir: 'dist',
      rollupOptions: {
        input: {
          web: resolve(__dirname, 'src/ui-web/index.html'),
          mobile: resolve(__dirname, 'src/ui-mobile/index.html'),
        },
        // ================== NEUER ABSCHNITT START ===================
        // Weist den Builder an, Capacitor-Module nicht zu bündeln.
        external: [
            /^@capacitor\//,
            '@capacitor-community/background-geolocation'
        ]
        // ================== NEUER ABSCHNITT ENDE ====================
      },
    },

    plugins: [
      commonjs(),
    ],
  }
})