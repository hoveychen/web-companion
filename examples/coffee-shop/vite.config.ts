import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    rollupOptions: {
      input: {
        // Legacy single-page entry — kept so the existing e2e suites
        // (`e2e/companion.spec.ts`, `mode-1-bridge.spec.ts`,
        // `mode-2-backend.spec.ts`) continue to load App.tsx via `/`.
        index: resolve(here, 'index.html'),
        // New cross-page demo entries (cross-page-companion-demo plan).
        shell: resolve(here, 'shell.html'),
        menu: resolve(here, 'menu.html'),
        settings: resolve(here, 'settings.html'),
      },
    },
  },
});
