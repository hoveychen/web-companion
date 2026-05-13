/**
 * Mode-1 e2e variant of `playwright.config.ts`.
 *
 * Goal: stand up the local-bridge subprocess + boot vite with VITE_*
 * env vars so coffee-shop renders the headless <Sidecar/> path (mode 2's
 * page-side flow is the same connect-and-listen contract that mode 1
 * exercises against a local bridge instead of a remote backend).
 *
 * Invoke via `pnpm test:e2e:bridge`. The default `pnpm test:e2e` continues
 * to run the mode-0 in-page sidebar suite via `playwright.config.ts`.
 */
import { defineConfig, devices } from '@playwright/test';

const BRIDGE_WS_PORT = '8765';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['mode-1-bridge.spec.ts'],
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npx vite --port 5174 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: false,
    stdout: 'pipe',
    timeout: 30_000,
    env: {
      // Tells App.tsx to mount <Sidecar from '@web-companion/sidecar/react'>
      // instead of the in-page <Companion>. local-bridge doesn't actually
      // validate the token; the dummy value just satisfies the mode-2 gate.
      VITE_BACKEND_URL: `ws://127.0.0.1:${BRIDGE_WS_PORT}/ws`,
      VITE_USER_TOKEN: 'dummy-local-bridge-token',
    },
  },
});
