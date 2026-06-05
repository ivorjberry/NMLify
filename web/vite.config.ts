/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

// Base path is relative so the built site works under any subpath
// (e.g. GitHub Pages: https://<user>.github.io/<repo>/).
export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
