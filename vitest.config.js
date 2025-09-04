// vitest.config.js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Schließt den Ordner ein, in dem Ihre Tests liegen
    include: ['src/**/*.{test,spec}.js'],
  },
});