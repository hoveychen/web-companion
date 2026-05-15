#!/usr/bin/env node
// UI-level e2e for cross-page-companion-demo.
//
// Differs from verify-cross-page.mjs: this one drives the SIDEBAR UI
// itself (clicking buttons, typing into forms) rather than going around
// it via the CLI. Catches sidebar-render / CORS / drawer-marker /
// catalog-refresh / cross-tab regressions.
//
// Run order:
//   1. demo must already be up (pnpm demo:cross-page).
//   2. node scripts/verify-ui-cross-page.mjs
//
// Outputs a screenshot per stage under scripts/ui-shots/ for visual review.

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SHOTS = resolve(ROOT, 'scripts/ui-shots');

const BACKEND = process.env.COMPANION_BACKEND ?? 'http://127.0.0.1:3001';
const SHELL = process.env.COMPANION_SHELL ?? 'http://127.0.0.1:5173/shell.html';

function fail(msg) {
  process.stderr.write(`✗ ${msg}\n`);
  process.exit(1);
}
function ok(msg) {
  process.stderr.write(`✓ ${msg}\n`);
}

// reset screenshot dir
try { rmSync(SHOTS, { recursive: true, force: true }); } catch { /* ignore */ }
mkdirSync(SHOTS, { recursive: true });

// Wait until demo backend is live
async function waitForBackend(timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BACKEND}/health`);
      if (res.ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  fail(`backend ${BACKEND} not reachable within ${timeoutMs}ms`);
}
await waitForBackend();
ok('backend reachable');

// import playwright via its pnpm-isolated path (top-level node_modules
// does not hoist 'playwright' under pnpm)
const playwrightUrl = new URL(
  'file://' + resolve(ROOT, 'node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/index.mjs'),
);
const { chromium } = await import(playwrightUrl.href);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

const consoleErrors = [];
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`);
});
page.on('requestfailed', (req) => {
  consoleErrors.push(`requestfailed: ${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
});
page.on('response', (res) => {
  const u = res.url();
  if (u.includes('/mcp') || u.includes('/cli/exec')) {
    process.stderr.write(`[net] ${res.status()} ${res.request().method()} ${u}\n`);
  }
});

await page.goto(SHELL, { waitUntil: 'load' });
ok('shell.html loaded');

// --- 1. sidebar mounts and connects to MCP -------------------------------
await page.waitForSelector('text=连接 MCP', { timeout: 2000 }).catch(() => undefined);
await page.waitForSelector('button:has-text("MCP")', { timeout: 8000 });
// Wait for the full catalog to populate (sidebar polls every 3s). The
// first tools/list often races the iframe's sidecar registration and
// returns just the 3 meta tools; we want the menu module's tools to
// have arrived before clicking.
const sidebarEarly = page.locator('aside').first();
await page.screenshot({ path: resolve(SHOTS, '00-after-boot.png'), fullPage: true });
// Each tool is one <li><button> in the sidebar. Buttons render the tool
// name as the first child div, so match the button by its leading-text
// containment via locator(`button:has-text("...")`).
async function sidebarToolButton(toolName) {
  return sidebarEarly.locator(`button:has(div:text-is("${toolName}"))`);
}
try {
  await (await sidebarToolButton('cart.add_to_cart')).waitFor({ timeout: 15_000 });
} catch (err) {
  const txt = await sidebarEarly.innerText();
  process.stderr.write(`[verify] sidebar inner text after 15s wait:\n${txt}\n---\n`);
  throw err;
}
const toolCountSel = await page.locator('text=/\\d+ tools/').first();
const initialCountText = await toolCountSel.textContent();
await page.screenshot({ path: resolve(SHOTS, '01-shell-loaded.png'), fullPage: true });
ok(`sidebar mounted + catalog populated, count: ${initialCountText}`);

if (consoleErrors.length > 0) {
  process.stderr.write(`⚠ console errors during boot:\n  ${consoleErrors.join('\n  ')}\n`);
}

// Find the tool list items in the sidebar (they're <button>s inside <li>s)
// — but coffee-shop's iframe also has buttons with similar text, so we
// scope to the sidebar's <aside> element.
const sidebar = page.locator('aside').first();

// --- 2. MCP tab: pick add_to_cart, fill id=latte, click submit ---
async function selectToolInSidebar(toolName) {
  const btn = sidebar.locator(`button:has(div:text-is("${toolName}"))`);
  await btn.first().click();
}

await selectToolInSidebar('cart.add_to_cart');
ok('selected cart.add_to_cart in sidebar');
// The form should show — find the `id` parameter row (enum, rendered as <select>)
const idSelect = sidebar.locator('select').first();
await idSelect.waitFor({ timeout: 5000 });
await idSelect.selectOption('latte');
ok('filled id=latte via sidebar form');

// Click "调用 MCP" submit
await sidebar.getByRole('button', { name: /调用 MCP/ }).click();
await page.waitForTimeout(4000);
await page.screenshot({ path: resolve(SHOTS, '02-after-mcp-add-to-cart.png'), fullPage: true });

// Verify iframe cart shows the item
const iframe = page.frame({ url: /menu\.html/ });
if (!iframe) fail('menu iframe missing after MCP add_to_cart');
const cartCount = await iframe.locator('[data-ai="cart-item"]').count();
if (cartCount < 1) {
  const sidebarText = await sidebar.innerText();
  process.stderr.write(`[diag] sidebar text after add_to_cart click:\n${sidebarText}\n---\n`);
  fail(`expected ≥1 cart item, got ${cartCount}`);
}
ok(`iframe cart has ${cartCount} item via sidebar MCP path`);

// --- 3. CLI tab: switch + invoke search ---
await sidebar.getByRole('button', { name: /^CLI$/ }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: resolve(SHOTS, '03-cli-tab-active.png'), fullPage: true });

await selectToolInSidebar('search.search');
const queryInput = sidebar.locator('input[type="text"]').first();
await queryInput.waitFor({ timeout: 4000 });
await queryInput.fill('拿铁');
ok('selected search.search and filled query=拿铁');

// Click 跑 CLI — this fires /cli/exec which spawns subprocess.
const cliBtn = sidebar.getByRole('button', { name: /跑 CLI/ });
await cliBtn.click();
// /cli/exec may take a couple of seconds (CLI cold start + MCP handshake)
await page.waitForTimeout(4000);
await page.screenshot({ path: resolve(SHOTS, '04-after-cli-search.png'), fullPage: true });

const cliResultPanel = sidebar.locator('text=/CLI result \\(HTTP \\d+\\)/');
if ((await cliResultPanel.count()) === 0) {
  // dump sidebar text for diagnosis
  const txt = await sidebar.innerText();
  fail(`no CLI result panel after running search. Sidebar text:\n${txt}\n`);
}
ok('CLI tab result panel appeared');

// Verify the search results region in iframe
const searchResults = await iframe.locator('[data-ai="search-results"]').count();
if (searchResults < 1) {
  fail('expected search-results region in iframe after CLI search call');
}
ok('iframe search-results region rendered via CLI subprocess path');

// --- 4. Cross-page navigate via shell topbar button ---
await page.getByRole('button', { name: /设置/ }).click();
await page.waitForTimeout(1500);
await page.waitForFunction(
  () => Array.from(document.querySelectorAll('iframe')).some((i) =>
    (i.contentWindow?.location.pathname || '').includes('settings.html'),
  ),
  { timeout: 8000 },
);
// Wait for iframe sidecar to reconnect + tools/list polling to fetch
await page.waitForTimeout(3500);
await page.screenshot({ path: resolve(SHOTS, '05-after-nav-settings.png'), fullPage: true });

const settingsIframe = page.frame({ url: /settings\.html/ });
if (!settingsIframe) fail('settings iframe missing after topbar nav');
ok('iframe switched to settings.html');

// Now the sidebar should list settings.* tools — wait for one to appear
await sidebar.locator('button:has(div:text-is("settings.set_nickname"))').waitFor({ timeout: 8000 });
ok('sidebar catalog refreshed to show settings.set_nickname after cross-page nav');

// --- 5. Drive settings.set_nickname via MCP tab from sidebar UI ---
await sidebar.getByRole('button', { name: /^MCP$/ }).click();
await page.waitForTimeout(200);
await selectToolInSidebar('settings.set_nickname');
const valueInput = sidebar.locator('input[type="text"]').first();
await valueInput.waitFor({ timeout: 4000 });
await valueInput.fill('clicked-from-sidebar');
await sidebar.getByRole('button', { name: /调用 MCP/ }).click();
await page.waitForTimeout(4000);
await page.screenshot({ path: resolve(SHOTS, '06-after-set-nickname.png'), fullPage: true });

const nick = await settingsIframe.locator('[data-ai="set-nickname"]').inputValue();
if (nick !== 'clicked-from-sidebar') {
  fail(`expected nickname=clicked-from-sidebar, got ${JSON.stringify(nick)}`);
}
ok(`settings nickname=${nick} via sidebar MCP path`);

// --- 6. Open drawer via MCP, then verify nested module appears ---
await selectToolInSidebar('settings.open_drawer');
await sidebar.getByRole('button', { name: /调用 MCP/ }).click();
await page.waitForTimeout(4000);
await page.screenshot({ path: resolve(SHOTS, '07-drawer-open.png'), fullPage: true });

const drawerOpen = await settingsIframe.locator('[data-ai-view="drawer"]').getAttribute('data-open');
if (drawerOpen !== 'true') fail(`expected drawer data-open=true, got ${drawerOpen}`);
ok('drawer opened via sidebar MCP path');

// Now drawer's nested module gates should activate — wait for poll
await sidebar.locator('button:has(div:text-is("settings.drawer.toggle_notifications"))').waitFor({ timeout: 8000 });
ok('sidebar catalog now includes settings.drawer.* nested tools');

// --- 7. Use the color picker — pick_accent_color ---
await selectToolInSidebar('settings.pick_accent_color');
const hexInput = sidebar.locator('input[type="text"]').first();
await hexInput.waitFor({ timeout: 4000 });
await hexInput.fill('#22cc88');
await sidebar.getByRole('button', { name: /调用 MCP/ }).click();
await page.waitForTimeout(4000);
const accentTxt = await settingsIframe.locator('[data-ai="accent-color-value"]').textContent();
if (accentTxt?.trim().toLowerCase() !== '#22cc88') {
  fail(`expected accent #22cc88, got ${JSON.stringify(accentTxt)}`);
}
ok(`color picker drove iframe accent → ${accentTxt}`);

// --- 8. Drive the remaining 6 controls (password / radio / textarea /
//        country dropdown / date picker / drawer-only checkbox & apikey) ---
async function callMcp(toolName, fillField, fillValue, opts = {}) {
  await selectToolInSidebar(toolName);
  if (fillField) {
    if (fillField === 'select') {
      const sel = sidebar.locator('select').first();
      await sel.waitFor({ timeout: 4000 });
      await sel.selectOption(fillValue);
    } else if (fillField === 'checkbox') {
      // no-op — toggle has no params
    } else {
      const input = sidebar.locator(fillField).first();
      await input.waitFor({ timeout: 4000 });
      await input.fill(fillValue);
    }
  }
  await sidebar.getByRole('button', { name: /调用 MCP/ }).click();
  await page.waitForTimeout(opts.wait ?? 3000);
}

// 8a. password — text-typed but rendered <input type="password">
await callMcp('settings.set_password', 'input[type="text"]', 'hunter2-XYZ');
const pwLen = await settingsIframe
  .locator('[data-ai="password-length"]').textContent();
if (pwLen?.trim() !== '11') {
  fail(`expected password-length=11, got ${JSON.stringify(pwLen)}`);
}
ok('password input drove via MCP (length echo = 11)');

// 8b. radio — pick theme=dark
await callMcp('settings.pick_theme', 'select', 'dark');
const themeChecked = await settingsIframe
  .locator('[data-ai="pick-theme-dark"]').isChecked();
if (!themeChecked) fail('expected pick-theme-dark to be checked');
ok('radio drove theme=dark via MCP');

// 8c. textarea — set_bio. ToolBrowser's heuristic should render this
//      param (name="text", description mentions "多行") as a real
//      <textarea> in the sidebar, so newlines survive.
const bioText = 'multi\nline\nbio from sidebar';
await callMcp(
  'settings.set_bio',
  'textarea',
  bioText,
);
const bioVal = await settingsIframe
  .locator('[data-ai="set-bio"]').inputValue();
if (!bioVal.includes('multi\nline\nbio')) {
  fail(`expected textarea bio to include multi-line text, got ${JSON.stringify(bioVal)}`);
}
ok('textarea param drove iframe (multi-line preserved end-to-end)');

// 8d. country dropdown — select JP
await callMcp('settings.select_country', 'select', 'JP');
const country = await settingsIframe
  .locator('[data-ai="select-country"]').inputValue();
if (country !== 'JP') fail(`expected country=JP, got ${country}`);
ok('dropdown drove country=JP via MCP');

// 8e. date picker — pick 2026-05-15
await callMcp(
  'settings.pick_reminder_date',
  'input[type="text"]',
  '2026-05-15',
);
const dateVal = await settingsIframe
  .locator('[data-ai="pick-reminder-date"]').inputValue();
if (dateVal !== '2026-05-15') {
  fail(`expected date 2026-05-15, got ${dateVal}`);
}
ok('date picker drove reminder=2026-05-15 via MCP');

// 8f. Re-open drawer, toggle the checkbox + fill apikey
await callMcp('settings.open_drawer', null, null);
await sidebar
  .locator('button:has(div:text-is("settings.drawer.toggle_notifications"))')
  .waitFor({ timeout: 8000 });
const notifBefore = await settingsIframe
  .locator('[data-ai="toggle-notifications"]').isChecked();
await callMcp('settings.drawer.toggle_notifications', null, null);
const notifAfter = await settingsIframe
  .locator('[data-ai="toggle-notifications"]').isChecked();
if (notifBefore === notifAfter) {
  fail(`expected notifications toggle to flip; before=${notifBefore} after=${notifAfter}`);
}
ok(`checkbox drove via MCP (notifications ${notifBefore}→${notifAfter})`);

await callMcp(
  'settings.drawer.set_api_key',
  'input[type="text"]',
  'sk-from-sidebar',
);
const apiKeyVal = await settingsIframe
  .locator('[data-ai="set-api-key"]').inputValue();
if (apiKeyVal !== 'sk-from-sidebar') {
  fail(`expected api-key=sk-from-sidebar, got ${apiKeyVal}`);
}
ok('drawer-only api-key input drove via MCP');

// --- 9. save_profile + read save_log resource via MCP -----------------
await callMcp('settings.save_profile', null, null);
const savedCount = await settingsIframe
  .locator('[data-ai="save-count"]').textContent();
if (savedCount?.trim() !== '1') {
  fail(`expected save-count=1, got ${JSON.stringify(savedCount)}`);
}
ok('save_profile MCP tool ran (save-count=1)');

// resources/read settings.save_log — use the read_settings.save_log entry
await selectToolInSidebar('read_settings.save_log');
await sidebar.getByRole('button', { name: /调用 MCP/ }).click();
await page.waitForTimeout(4000);
await page.screenshot({ path: resolve(SHOTS, '09-save-log-resource.png'), fullPage: true });
const sidebarTxt = await sidebar.innerText();
// Result lands in the event stream as JSON. Look for either form:
//   `"payload":` (raw json key) or `[{` / `"time":`
if (!sidebarTxt.includes('payload') || !sidebarTxt.includes('time')) {
  process.stderr.write(`[diag] sidebar text after resource read:\n${sidebarTxt.slice(0, 2000)}\n…\n`);
  fail('expected save_log resource result to mention time + payload fields');
}
ok('resources/read settings.save_log returned structured data via MCP');

// --- 10. Close drawer + verify nested tools disappear (original 8) ---
await selectToolInSidebar('settings.close_drawer');
await sidebar.getByRole('button', { name: /调用 MCP/ }).click();
await page.waitForTimeout(3500);
const closedDrawer = await settingsIframe
  .locator('[data-ai-view="drawer"]').getAttribute('data-open');
if (closedDrawer !== 'false') fail(`expected drawer data-open=false, got ${closedDrawer}`);
const stillHasNested = await sidebar
  .locator('button:has(div:text-is("settings.drawer.toggle_notifications"))')
  .count();
if (stillHasNested > 0) {
  fail('expected drawer.* nested tools to disappear after close_drawer');
}
ok('nested settings.drawer.* tools removed from catalog after drawer closed');

// --- 11. Round-trip cross-page nav: settings → menu via shell topbar ---
await page.getByRole('button', { name: /回菜单/ }).click();
await page.waitForTimeout(1500);
await page.waitForFunction(
  () => Array.from(document.querySelectorAll('iframe')).some((i) =>
    (i.contentWindow?.location.pathname || '').includes('menu.html'),
  ),
  { timeout: 8000 },
);
await page.waitForTimeout(3500);
const menuIframe = page.frame({ url: /menu\.html/ });
if (!menuIframe) fail('menu iframe missing after round-trip nav');
// settings.* tools should be gone, cart.* should be back
await sidebar
  .locator('button:has(div:text-is("cart.add_to_cart"))')
  .waitFor({ timeout: 8000 });
const stillHasSettings = await sidebar
  .locator('button:has(div:text-is("settings.set_nickname"))').count();
if (stillHasSettings > 0) {
  fail('expected settings.* tools gone after navigating back to menu.html');
}
ok('round-trip nav back to menu refreshed catalog (settings.* gone, cart.* back)');

// --- 12. WRONG_PAGE error path: settings.set_nickname when on menu.html ---
// The tool is no longer in the sidebar's filtered tools/list (since the
// `where` marker doesn't match), so we hit /cli/exec directly with the
// settings.* name and expect a non-zero exit / error.
const wrongPageRes = await fetch(`${BACKEND}/cli/exec`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: `Bearer ${getDemoToken()}` },
  body: JSON.stringify({ tool: 'settings.set_nickname', params: { value: 'x' } }),
});
const wrongPageJson = await wrongPageRes.json();
if (wrongPageJson.ok === true && wrongPageJson.exitCode === 0) {
  fail(`expected wrong-page failure when calling settings.* from menu.html; got ${JSON.stringify(wrongPageJson)}`);
}
ok(`WRONG_PAGE handled (exit=${wrongPageJson.exitCode}, ok=${wrongPageJson.ok})`);

await page.screenshot({ path: resolve(SHOTS, '12-final.png'), fullPage: true });

if (consoleErrors.length > 0) {
  process.stderr.write(
    `\n⚠ ${consoleErrors.length} console error(s) during run:\n  ${consoleErrors.join('\n  ')}\n`,
  );
}

await browser.close();
process.stderr.write(
  `\n✓ all UI-level checks passed (12 phases, 20+ assertions). Screenshots in ${SHOTS}\n`,
);
process.exit(0);

function getDemoToken() {
  const r = spawnSync(
    'pnpm',
    ['-s', '--filter', 'reference-backend', 'exec', 'tsx', 'src/sign-token.ts', 'demo'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, REFERENCE_BACKEND_SECRET: 'demo-cross-page-shared-secret' },
    },
  );
  if (r.status !== 0) throw new Error(`sign-token failed: ${r.stderr}`);
  return r.stdout.trim();
}
