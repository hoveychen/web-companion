/**
 * v0.4 P5 smoke — exercises the `summarizePages` / `summarizeFlows` /
 * `summarizeTools` helpers used by the `companion_pages` / `companion_flows`
 * / `companion_tools` meta tools.
 *
 * Run with `pnpm --filter @web-companion/sdk smoke-meta-tools`.
 */
import {
  summarizeFlows,
  summarizePages,
  summarizeTools,
  type CapturedPageState,
} from '../src/index.js';
import type { ResourceSpec, ToolSpec } from '@web-companion/spec';

const tools: ToolSpec[] = [
  {
    name: 'checkout.submit',
    description: 'Place the order.',
    where: { url: '**/cart' },
    steps: [{ type: 'click', target: '[data-ai="submit"]' }],
  },
  {
    name: 'checkout.cancel',
    description: 'Cancel.',
    where: { url: '**/cart' },
    steps: [{ type: 'click', target: '[data-ai="cancel"]' }],
  },
  {
    name: 'search.run',
    description: 'Run a search.',
    where: { marker: "[data-view='search']" },
    steps: [{ type: 'click', target: '[data-ai="search"]' }],
  },
  {
    name: 'nav.home',
    description: 'Navigate home.',
    steps: [{ type: 'click', target: '[data-ai="home"]' }],
  },
];

const resources: ResourceSpec[] = [
  {
    name: 'checkout.summary',
    description: 'Cart summary.',
    where: { url: '**/cart' },
    schema: { type: 'object', properties: {} },
    extract: {
      type: 'single',
      selector: '[data-ai="cart"]',
      fields: { total: { from: 'text', selector: '[data-ai="total"]' } },
    },
  },
];

let failed = 0;
function expect(cond: unknown, label: string): void {
  if (cond) console.log(`  OK    ${label}`);
  else {
    console.log(`  FAIL  ${label}`);
    failed++;
  }
}

const onHomepage: CapturedPageState = { currentUrl: '/', matchedMarkers: [] };
const onCart: CapturedPageState = { currentUrl: '/cart', matchedMarkers: [] };
const onCartWithSearch: CapturedPageState = {
  currentUrl: '/cart',
  matchedMarkers: ["[data-view='search']"],
};

console.log('# summarizePages');
{
  const p = summarizePages(tools, resources, onHomepage);
  expect(p.currentUrl === '/', 'currentUrl forwarded');
  expect(
    p.currentFlows.join(',') === 'nav',
    `homepage flows=nav (nav.home has no where, so always active) (got: ${p.currentFlows.join(',')})`,
  );

  const p2 = summarizePages(tools, resources, onCart);
  expect(
    p2.currentFlows.join(',') === 'checkout,nav',
    `cart page flows=checkout,nav (got: ${p2.currentFlows.join(',')})`,
  );

  const p3 = summarizePages(tools, resources, onCartWithSearch);
  expect(
    p3.currentFlows.join(',') === 'checkout,nav,search',
    `cart+search flows (got: ${p3.currentFlows.join(',')})`,
  );
}

console.log('# summarizeFlows');
{
  const fs = summarizeFlows(tools, resources, onCart);
  const m = new Map(fs.map((f) => [f.name, f]));
  expect(m.size === 3, 'three flows reported: checkout, nav, search (got: ' + m.size + ')');
  const co = m.get('checkout')!;
  expect(co.toolCount === 2, 'checkout has 2 tools');
  expect(co.resourceCount === 1, 'checkout has 1 resource');
  expect(co.active === true, 'checkout active on /cart');
  const se = m.get('search')!;
  expect(se.active === false, 'search inactive when no marker');
  const nv = m.get('nav')!;
  expect(nv.active === true, 'nav always-active (no where)');
}

console.log('# summarizeTools(undefined) — active-only');
{
  const ts = summarizeTools(tools, onCart);
  const names = ts.map((t) => t.name).sort();
  expect(
    names.join(',') === 'checkout.cancel,checkout.submit,nav.home',
    `cart-active tools (got: ${names.join(',')})`,
  );
}

console.log('# summarizeTools(flow) — all tools in that flow regardless of pageState');
{
  const ts = summarizeTools(tools, onHomepage, 'checkout');
  const names = ts.map((t) => t.name).sort();
  expect(
    names.join(',') === 'checkout.cancel,checkout.submit',
    `flow=checkout returns its tools even when not on /cart (got: ${names.join(',')})`,
  );
}

if (failed > 0) {
  process.stderr.write(`\n${failed} smoke cases failed\n`);
  process.exit(1);
}
process.stdout.write('\nall meta-tool smoke phases passed\n');
