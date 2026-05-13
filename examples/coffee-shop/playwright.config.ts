import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // mode-1-bridge.spec.ts requires the local-bridge subprocess +
  // VITE_BACKEND_URL env; lives in `playwright.config.bridge.ts` instead.
  testIgnore: ['mode-1-bridge.spec.ts'],
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
  },
});
