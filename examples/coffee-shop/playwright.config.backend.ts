/**
 * Mode-2 e2e variant of `playwright.config.ts`.
 *
 * Boots two long-lived processes via Playwright's `webServer` array:
 *   1. `examples/reference-backend` (ws + JWT + Streamable HTTP MCP) on :3001
 *   2. vite dev for coffee-shop on :5174, with VITE_BACKEND_URL/VITE_USER_TOKEN
 *      pointing at the reference-backend so App.tsx renders the mode-2 Sidecar.
 *
 * A fresh HS256 JWT for user 'alice' is minted at config-load time via the
 * reference-backend's sign-token script (it uses the same placeholder
 * `REFERENCE_BACKEND_SECRET` that the backend boots with).
 *
 * Invoke via `pnpm test:e2e:backend`.
 */
import { defineConfig, devices } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const COFFEE_DIR = resolve(__filename, '..');
const REF_BACKEND_DIR = resolve(COFFEE_DIR, '..', 'reference-backend');

function mintToken(userId: string): string {
  const r = spawnSync(
    'pnpm',
    ['-s', 'exec', 'tsx', 'src/sign-token.ts', userId],
    { cwd: REF_BACKEND_DIR, encoding: 'utf8' },
  );
  if (r.status !== 0) {
    throw new Error(
      `sign-token for ${userId} failed (status=${r.status}): ${r.stderr}`,
    );
  }
  return r.stdout.trim();
}

const TOKEN = mintToken('alice');
// Hand the token to the test process via env. Playwright test workers
// inherit env from this config.
process.env['WC_TEST_USER_TOKEN'] = TOKEN;

export default defineConfig({
  testDir: './e2e',
  testMatch: ['mode-2-backend.spec.ts'],
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
  // Both servers must be up before the test runs. Playwright accepts an
  // array of webServer configs — they boot in parallel and Playwright
  // probes each `url` to know when it's ready.
  webServer: [
    {
      command: 'pnpm dev',
      cwd: REF_BACKEND_DIR,
      url: 'http://127.0.0.1:3001/health',
      reuseExistingServer: false,
      stdout: 'pipe',
      timeout: 30_000,
      env: {
        PORT: '3001',
        HOST: '127.0.0.1',
      },
    },
    {
      command: 'npx vite --port 5174 --strictPort --host 127.0.0.1',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      stdout: 'pipe',
      timeout: 30_000,
      env: {
        VITE_BACKEND_URL: 'ws://127.0.0.1:3001/ws',
        VITE_USER_TOKEN: TOKEN,
      },
    },
  ],
});
