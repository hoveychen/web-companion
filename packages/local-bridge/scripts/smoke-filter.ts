/**
 * v0.4 P4 smoke for the local-bridge server-side filter wiring.
 *
 * Boots BridgeWsServer with a synthetic OriginStore that pre-allows the
 * test origin, opens a fake ws client mimicking the sdk's wire protocol,
 * pushes tools/list + page/changed, and asserts:
 *
 *   - `listAllTools('page')` honors each tool's `where:` against the
 *     last `page/changed` (default scope)
 *   - `listAllTools('all')` returns the unfiltered catalog
 *   - `onCatalogChange` fires for fresh tools/list AND for page/changed
 *     that flipped a match
 *
 * Run with `pnpm --filter @web-companion/local-bridge smoke-filter`.
 */
import { WebSocket } from 'ws';
import { setTimeout as wait } from 'node:timers/promises';
import { BridgeWsServer } from '../src/ws-server.js';
import { OriginStore } from '../src/origin-store.js';

const PORT = 9876;
const ORIGIN = 'http://test.local';
const SESSION_ID = 'sess-1';

// Synthetic OriginStore: in-memory only, allow the test origin.
const tmpFile = `/tmp/web-companion-bridge-smoke-${process.pid}.json`;
const store = new OriginStore(tmpFile);
store.set(ORIGIN, 'allow');

const bridge = new BridgeWsServer({
  port: PORT,
  host: '127.0.0.1',
  originStore: store,
  unknownOriginPolicy: { type: 'deny' },
});
await bridge.whenReady();

const catalogEvents: number[] = [];
const offCatalog = bridge.onCatalogChange(() => {
  catalogEvents.push(Date.now());
});

const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, {
  headers: { origin: ORIGIN },
});
await new Promise<void>((resolve, reject) => {
  ws.once('open', resolve);
  ws.once('error', reject);
});

function send(obj: unknown): void {
  ws.send(JSON.stringify(obj));
}

send({
  type: 'session/hello',
  sessionId: SESSION_ID,
  origin: ORIGIN,
  pageUrl: '/',
  tabTitle: 'Test',
});

// bindSession is async (origin verdict lookup); give it a moment so the
// `bound` reference is set before later messages arrive — the production
// sdk's ws stack is slow enough that this race never bites it.
await wait(80);

send({
  type: 'tools/list',
  tools: [
    {
      name: 'checkout.submit',
      description: 'cart-scoped',
      where: { url: '**/cart' },
      steps: [{ type: 'click', target: '[data-ai="x"]' }],
    },
    {
      name: 'search.run',
      description: 'search-scoped',
      where: { marker: "[data-view='search']" },
      steps: [{ type: 'click', target: '[data-ai="y"]' }],
    },
    {
      name: 'global.ping',
      description: 'always available',
      steps: [{ type: 'click', target: '[data-ai="z"]' }],
    },
    {
      name: 'admin.delete_user',
      description: 'role-gated admin action',
      where: { roles: ['admin'] },
      steps: [{ type: 'click', target: '[data-ai="w"]' }],
    },
  ],
});

// give bind a beat
await wait(120);

let failed = 0;
function expect(cond: unknown, label: string): void {
  if (cond) console.log(`  OK    ${label}`);
  else {
    console.log(`  FAIL  ${label}`);
    failed++;
  }
}

console.log('# Phase 1: no page/changed yet — only `where`-less tools pass');
{
  const pageScope = bridge.listAllTools('page').map((e) => e.tool.name).sort();
  expect(
    pageScope.join(',') === 'global.ping',
    `page scope = ['global.ping'] (got: ${pageScope.join(',')})`,
  );
  const allScope = bridge.listAllTools('all').map((e) => e.tool.name).sort();
  expect(
    allScope.length === 4,
    `all scope returns 4 tools (got: ${allScope.length})`,
  );
}

console.log('# Phase 2: page/changed to /cart — checkout.submit passes too');
send({
  type: 'page/changed',
  currentUrl: '/cart',
  matchedMarkers: [],
});
await wait(80);
{
  const pageScope = bridge.listAllTools('page').map((e) => e.tool.name).sort();
  expect(
    pageScope.join(',') === 'checkout.submit,global.ping',
    `cart page scope (got: ${pageScope.join(',')})`,
  );
}

console.log('# Phase 3: page/changed with marker — search.run also passes');
send({
  type: 'page/changed',
  currentUrl: '/cart',
  matchedMarkers: ["[data-view='search']"],
});
await wait(80);
{
  const pageScope = bridge.listAllTools('page').map((e) => e.tool.name).sort();
  expect(
    pageScope.join(',') === 'checkout.submit,global.ping,search.run',
    `cart + search marker scope (got: ${pageScope.join(',')})`,
  );
}

console.log('# Phase 4: page/changed with identical state — no extra notification');
const beforeNoOp = catalogEvents.length;
send({
  type: 'page/changed',
  currentUrl: '/cart',
  matchedMarkers: ["[data-view='search']"],
});
await wait(80);
expect(
  catalogEvents.length === beforeNoOp,
  `no notify on no-op page/changed (before=${beforeNoOp}, after=${catalogEvents.length})`,
);

console.log(
  `# Phase 5: catalogEvents fired at least 3 times (tools/list + 2 real page changes)`,
);
expect(catalogEvents.length >= 3, `catalogEvents count (${catalogEvents.length})`);

console.log(
  '# Phase 6: userRoles=[admin] — admin.delete_user appears in page scope',
);
send({
  type: 'page/changed',
  currentUrl: '/cart',
  matchedMarkers: ["[data-view='search']"],
  userRoles: ['admin'],
});
await wait(80);
{
  const pageScope = bridge.listAllTools('page').map((e) => e.tool.name).sort();
  expect(
    pageScope.join(',') ===
      'admin.delete_user,checkout.submit,global.ping,search.run',
    `admin role unlocks admin.delete_user (got: ${pageScope.join(',')})`,
  );
}

console.log(
  '# Phase 7: userRoles=[customer] — admin.delete_user filtered out again',
);
send({
  type: 'page/changed',
  currentUrl: '/cart',
  matchedMarkers: ["[data-view='search']"],
  userRoles: ['customer'],
});
await wait(80);
{
  const pageScope = bridge.listAllTools('page').map((e) => e.tool.name).sort();
  expect(
    pageScope.join(',') === 'checkout.submit,global.ping,search.run',
    `customer role hides admin.delete_user (got: ${pageScope.join(',')})`,
  );
  const allScope = bridge.listAllTools('all').map((e) => e.tool.name).sort();
  expect(
    allScope.length === 4,
    `scope=all still returns all 4 tools regardless of role (got: ${allScope.length})`,
  );
}

offCatalog();
ws.close();
await wait(60);
bridge.close();
try {
  await import('node:fs/promises').then(({ unlink }) => unlink(tmpFile)).catch(() => {});
} catch {
  /* ignore */
}

if (failed > 0) {
  process.stderr.write(`\n${failed} smoke cases failed\n`);
  process.exit(1);
}
process.stdout.write(`\nall smoke phases passed\n`);
