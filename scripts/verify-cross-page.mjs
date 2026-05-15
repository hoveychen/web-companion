#!/usr/bin/env node
// E2E verification for cross-page-companion-demo:
//   1. Mints a token for user "demo" (same secret as the running demo).
//   2. Headless-loads shell.html via playwright — iframe registers ws.
//   3. Pulls tools/list via the @web-companion/cli (MCP path).
//   4. Calls add_to_cart via the @web-companion/cli (MCP path).
//   5. Checks cart updated by reading [data-ai='cart-item'] count in iframe.
//   6. Navigates iframe to settings.html; pulls tools/list again — expects
//      it to include settings.* entries.
//   7. Calls set_nickname via reference-backend's /cli/exec (CLI subprocess
//      path) and checks the iframe's nickname input updated.

import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const BACKEND = process.env.COMPANION_BACKEND ?? 'http://127.0.0.1:3001';
const SHELL = process.env.COMPANION_SHELL ?? 'http://127.0.0.1:5173/shell.html';
const SECRET =
  process.env.REFERENCE_BACKEND_SECRET ?? 'demo-cross-page-shared-secret';

function fail(msg) {
  process.stderr.write(`✗ ${msg}\n`);
  process.exit(1);
}
function ok(msg) {
  process.stderr.write(`✓ ${msg}\n`);
}

// --- 1. mint a token -------------------------------------------------------
const mint = spawnSync(
  'pnpm',
  ['-s', '--filter', 'reference-backend', 'exec', 'tsx', 'src/sign-token.ts', 'demo'],
  {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, REFERENCE_BACKEND_SECRET: SECRET },
  },
);
if (mint.status !== 0) fail(`sign-token failed: ${mint.stderr}`);
const TOKEN = mint.stdout.trim();
ok(`minted demo JWT (${TOKEN.length} chars)`);

// --- 2. headless-load shell.html ------------------------------------------
// playwright is not hoisted to top-level node_modules under pnpm; resolve
// from coffee-shop's @playwright/test (which depends on `playwright`).
const playwrightUrl = new URL(
  'file://' + resolve(ROOT, 'node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/index.mjs'),
);
const { chromium } = await import(playwrightUrl.href);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    process.stderr.write(`[browser console error] ${msg.text()}\n`);
  }
});
await page.goto(SHELL, { waitUntil: 'load' });
ok(`loaded ${SHELL}`);

// Wait for the iframe's ws to register to backend — give it a moment.
async function backendSessionExists() {
  const res = await fetch(`${BACKEND}/health`);
  const j = await res.json();
  return j.users && j.users.length > 0;
}
const start = Date.now();
while (Date.now() - start < 10_000) {
  if (await backendSessionExists()) break;
  await new Promise((r) => setTimeout(r, 250));
}
if (!(await backendSessionExists())) {
  fail('backend never saw the iframe ws session register within 10s');
}
ok('backend session registered by iframe ws');

// Wait a beat for sidecar to send tools/list.
await new Promise((r) => setTimeout(r, 500));

// --- 3. tools/list via CLI -------------------------------------------------
function cli(args) {
  const r = spawnSync(
    'node',
    [resolve(ROOT, 'packages/cli/dist/bin/companion.js'), ...args],
    {
      env: {
        ...process.env,
        COMPANION_BACKEND: BACKEND,
        COMPANION_TOKEN: TOKEN,
      },
      encoding: 'utf8',
    },
  );
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const listMenu = cli(['list']);
process.stderr.write(`[verify] cli list status=${listMenu.status} stdout(${listMenu.stdout?.length ?? '-'}b) stderr(${listMenu.stderr?.length ?? '-'}b)\n`);
if (listMenu.status !== 0) fail(`cli list failed status=${listMenu.status} stderr=${listMenu.stderr}`);
if (!listMenu.stdout.includes('cart.add_to_cart')) {
  process.stderr.write(`[verify] full cli list stdout:\n${listMenu.stdout}\n[stderr]\n${listMenu.stderr}\n`);
  fail(`expected cart.add_to_cart in tools list (above)`);
}
ok('cli list shows menu tools (cart.add_to_cart present)');

// --- 4. invoke cart.add_to_cart via CLI (MCP path) ------------------------
const callAdd = cli(['call', 'cart.add_to_cart', '--p', 'id=latte']);
if (callAdd.status !== 0) {
  fail(`cli call cart.add_to_cart failed: ${callAdd.stderr}`);
}
ok('cli call cart.add_to_cart returned ok');

// --- 5. verify cart updated in iframe -------------------------------------
async function cartCount() {
  const frame = page.frames().find((f) => /menu\.html/.test(f.url()));
  if (!frame) return -1;
  return await frame.locator('[data-ai="cart-item"]').count();
}
const before = await cartCount();
// We added one; account for whatever was there. Should be >= 1.
if (before < 1) {
  fail(`expected at least 1 cart item after add_to_cart, found ${before}`);
}
ok(`iframe cart has ${before} item(s) after MCP path`);

// --- 6. navigate iframe to settings.html ----------------------------------
{
  const frame = page.frames().find((f) => /menu\.html/.test(f.url()));
  if (!frame) fail('menu iframe missing');
  // Click the nav link inside the iframe.
  await frame.locator('a[data-ai-tool="goto-settings"]').click();
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('iframe')).some((i) =>
      (i.contentWindow?.location.pathname || '').includes('settings.html'),
    ),
    { timeout: 8000 },
  );
  await new Promise((r) => setTimeout(r, 500));
  ok('iframe navigated to settings.html');
}

// --- 7. tools/list should now include settings.* entries ------------------
const listSettings = cli(['list', '--filter', 'settings.']);
if (listSettings.status !== 0) fail(`cli list --filter settings. failed: ${listSettings.stderr}`);
if (!listSettings.stdout.includes('settings.set_nickname')) {
  fail(`expected settings.set_nickname after iframe navigated; got:\n${listSettings.stdout}`);
}
ok('cli list shows settings tools after iframe navigation');

// --- 8. drive settings.set_nickname via /cli/exec (subprocess path) -------
const cliExecRes = await fetch(`${BACKEND}/cli/exec`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({
    tool: 'settings.set_nickname',
    params: { value: 'verified-by-e2e' },
  }),
});
const cliExecJson = await cliExecRes.json();
if (!cliExecJson.ok) {
  fail(
    `cli/exec settings.set_nickname failed: exit=${cliExecJson.exitCode}\nstderr:${cliExecJson.stderr}\nstdout:${cliExecJson.stdout}`,
  );
}
ok('cli/exec subprocess returned ok');

await new Promise((r) => setTimeout(r, 400));
{
  const frame = page.frames().find((f) => /settings\.html/.test(f.url()));
  if (!frame) fail('settings iframe missing');
  const v = await frame.locator('[data-ai="set-nickname"]').inputValue();
  if (v !== 'verified-by-e2e') {
    fail(`expected nickname=verified-by-e2e, got ${JSON.stringify(v)}`);
  }
  ok(`iframe nickname updated to "${v}" via CLI subprocess path`);
}

await browser.close();
process.stderr.write('\n✓ all 8 checks passed\n');
process.exit(0);
