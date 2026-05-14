/**
 * v0.4 P2 smoke — exercises the recursive loader + namespaced registry.
 *
 * Run with `pnpm --filter @web-companion/sdk smoke-loader`. Pure Node, no
 * DOM — the DSL executor / DOM extractor stay covered by Playwright e2e.
 *
 * Each case sets up a URL→json map, hands it to the loader as a mock
 * fetch, and asserts on the resolved catalog or the registry surface.
 */
import {
  ActionRegistry,
  loadCompanionSpec,
  type LoadResult,
  type ModuleErrorInfo,
} from '../src/index.js';

interface Case {
  label: string;
  run: () => Promise<void>;
}

function makeFetch(
  responses: Record<string, { ok: boolean; status?: number; body?: unknown }>,
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const entry = responses[url];
    if (!entry) {
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
      } as unknown as Response;
    }
    return {
      ok: entry.ok,
      status: entry.status ?? (entry.ok ? 200 : 500),
      json: async () => entry.body ?? {},
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}
function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`,
    );
  }
}

const cases: Case[] = [
  {
    label: 'v0.1 flat spec — no modules, no flow',
    run: async () => {
      const fetcher = makeFetch({
        'https://example.com/.well-known/companion.json': {
          ok: true,
          body: {
            version: '0.1',
            tools: [
              {
                name: 'checkout',
                description: 'Place the order.',
                steps: [{ type: 'click', target: '[data-ai-tool="checkout"]' }],
              },
            ],
          },
        },
      });
      const result = await loadCompanionSpec(
        'https://example.com/.well-known/companion.json',
        { fetchImpl: fetcher },
      );
      assertEq(result.tools.length, 1, 'tool count');
      assertEq(result.tools[0]!.flow, undefined, 'site-level flow undefined');
      assertEq(result.modules.length, 0, 'modules empty');

      const reg = new ActionRegistry();
      reg.ingest(result);
      assert(reg.getTool('checkout'), 'getTool(checkout)');
      assertEq(reg.listTools()[0]!.name, 'checkout', 'surface name unchanged');
    },
  },

  {
    label: 'v0.2 index + 2 modules — 4 tools total, all flow-tagged',
    run: async () => {
      const fetcher = makeFetch({
        'https://example.com/.well-known/companion.json': {
          ok: true,
          body: {
            version: '0.2',
            modules: [
              {
                name: 'checkout',
                url: './companion/checkout.json',
                where: { url: '**/cart' },
              },
              { name: 'search', url: './companion/search.json' },
            ],
          },
        },
        'https://example.com/.well-known/companion/checkout.json': {
          ok: true,
          body: {
            version: '0.2',
            tools: [
              {
                name: 'submit',
                description: 'Submit checkout.',
                steps: [{ type: 'click', target: '[data-ai="cart-submit"]' }],
              },
              {
                name: 'cancel',
                description: 'Cancel.',
                steps: [{ type: 'click', target: '[data-ai="cart-cancel"]' }],
              },
            ],
          },
        },
        'https://example.com/.well-known/companion/search.json': {
          ok: true,
          body: {
            version: '0.2',
            tools: [
              {
                name: 'submit',
                description: 'Run a search.',
                steps: [{ type: 'click', target: '[data-ai="search-submit"]' }],
              },
              {
                name: 'clear',
                description: 'Clear.',
                steps: [{ type: 'click', target: '[data-ai="search-clear"]' }],
              },
            ],
          },
        },
      });
      const result = await loadCompanionSpec(
        'https://example.com/.well-known/companion.json',
        { fetchImpl: fetcher },
      );
      assertEq(result.tools.length, 4, 'tool count');
      const flows = result.tools.map((t) => t.flow ?? '(none)').sort();
      assertEq(
        flows.join(','),
        'checkout,checkout,search,search',
        'every tool has a flow',
      );
      // Parent's `where: {url: '**/cart'}` should be inherited by the
      // checkout module's tools.
      const checkoutSubmit = result.tools.find(
        (t) => t.flow === 'checkout' && t.tool.name === 'submit',
      )!;
      assertEq(checkoutSubmit.tool.where?.url, '**/cart', 'where inherited');
      assertEq(
        result.tools.find(
          (t) => t.flow === 'search' && t.tool.name === 'submit',
        )!.tool.where,
        undefined,
        'sibling module without where stays free',
      );
    },
  },

  {
    label:
      'cross-module same tool name → surface as `checkout.submit` / `search.submit`, no collision',
    run: async () => {
      const fetcher = makeFetch({
        'https://example.com/.well-known/companion.json': {
          ok: true,
          body: {
            version: '0.2',
            modules: [
              { name: 'checkout', url: './companion/checkout.json' },
              { name: 'search', url: './companion/search.json' },
            ],
          },
        },
        'https://example.com/.well-known/companion/checkout.json': {
          ok: true,
          body: {
            version: '0.2',
            tools: [
              {
                name: 'submit',
                description: 'checkout submit',
                steps: [{ type: 'click', target: '[data-ai="a"]' }],
              },
            ],
          },
        },
        'https://example.com/.well-known/companion/search.json': {
          ok: true,
          body: {
            version: '0.2',
            tools: [
              {
                name: 'submit',
                description: 'search submit',
                steps: [{ type: 'click', target: '[data-ai="b"]' }],
              },
            ],
          },
        },
      });
      const result = await loadCompanionSpec(
        'https://example.com/.well-known/companion.json',
        { fetchImpl: fetcher },
      );
      const reg = new ActionRegistry();
      reg.ingest(result);
      assert(reg.getTool('checkout.submit'), 'checkout.submit registered');
      assert(reg.getTool('search.submit'), 'search.submit registered');
      assertEq(reg.getTool('submit'), undefined, 'bare submit not registered');
      assertEq(reg.listTools().length, 2, 'two tools surface');
      assertEq(
        reg.getTool('checkout.submit')!.description,
        'checkout submit',
        'description preserved',
      );
    },
  },

  {
    label:
      'module 404 → onModuleError fires, other module remains, modules[].loaded=false',
    run: async () => {
      const fetcher = makeFetch({
        'https://example.com/.well-known/companion.json': {
          ok: true,
          body: {
            version: '0.2',
            modules: [
              { name: 'checkout', url: './companion/checkout.json' },
              { name: 'broken', url: './companion/missing.json' },
            ],
          },
        },
        'https://example.com/.well-known/companion/checkout.json': {
          ok: true,
          body: {
            version: '0.2',
            tools: [
              {
                name: 'submit',
                description: 'ok',
                steps: [{ type: 'click', target: '[data-ai="a"]' }],
              },
            ],
          },
        },
        // 'missing.json' deliberately absent → 404
      });
      const errors: ModuleErrorInfo[] = [];
      const result = await loadCompanionSpec(
        'https://example.com/.well-known/companion.json',
        {
          fetchImpl: fetcher,
          onModuleError: (info) => errors.push(info),
        },
      );
      assertEq(errors.length, 1, 'one module error');
      assertEq(errors[0]!.moduleName, 'broken', 'error names the broken flow');
      assertEq(result.tools.length, 1, 'survivor module tools present');
      const brokenEntry = result.modules.find((m) => m.name === 'broken')!;
      assertEq(brokenEntry.loaded, false, 'broken module marked unloaded');
      const okEntry = result.modules.find((m) => m.name === 'checkout')!;
      assertEq(okEntry.loaded, true, 'checkout module marked loaded');
    },
  },

  {
    label: 'module 404 without onModuleError → throws (fail-fast default)',
    run: async () => {
      const fetcher = makeFetch({
        'https://example.com/.well-known/companion.json': {
          ok: true,
          body: {
            version: '0.2',
            modules: [{ name: 'broken', url: './companion/missing.json' }],
          },
        },
      });
      let thrown: unknown = null;
      try {
        await loadCompanionSpec(
          'https://example.com/.well-known/companion.json',
          { fetchImpl: fetcher },
        );
      } catch (err) {
        thrown = err;
      }
      assert(thrown instanceof Error, 'should throw');
      assert(
        (thrown as Error).message.includes('HTTP 404'),
        'message names HTTP 404',
      );
    },
  },

  {
    label:
      'same URL listed twice in modules — second hits the duplicate-visit guard',
    run: async () => {
      // v0.2 forbids nested modules, so a real graph cycle (A → B → A) is
      // unreachable through well-formed specs. The visited-URL check still
      // matters for the degenerate case where an index references the same
      // module URL under two different flow names — only the first one
      // loads; the second is flagged as a cycle via onModuleError.
      const fetcher = makeFetch({
        'https://example.com/companion.json': {
          ok: true,
          body: {
            version: '0.2',
            modules: [
              { name: 'first', url: './shared.json' },
              { name: 'second', url: './shared.json' },
            ],
          },
        },
        'https://example.com/shared.json': {
          ok: true,
          body: {
            version: '0.2',
            tools: [
              {
                name: 'submit',
                description: 'shared',
                steps: [{ type: 'click', target: '[data-ai="x"]' }],
              },
            ],
          },
        },
      });
      const errors: ModuleErrorInfo[] = [];
      const result = await loadCompanionSpec(
        'https://example.com/companion.json',
        {
          fetchImpl: fetcher,
          onModuleError: (info) => errors.push(info),
        },
      );
      assertEq(errors.length, 1, 'second visit logged');
      assert(
        (errors[0]!.error as Error).message.includes('cycle'),
        'cycle message',
      );
      assertEq(errors[0]!.moduleName, 'second', 'second module flagged');
      // First module did load.
      assertEq(result.tools.length, 1, 'first module survived');
      assertEq(result.tools[0]!.flow, 'first', 'first module owns the tool');
    },
  },

  {
    label:
      'v0.6: 2-level nesting — `outer.inner.tool` surface name, both ancestors visit',
    run: async () => {
      const fetcher = makeFetch({
        'https://example.com/companion.json': {
          ok: true,
          body: {
            version: '0.2',
            modules: [{ name: 'outer', url: './outer.json' }],
          },
        },
        'https://example.com/outer.json': {
          ok: true,
          body: {
            version: '0.2',
            modules: [{ name: 'inner', url: './inner.json' }],
          },
        },
        'https://example.com/inner.json': {
          ok: true,
          body: {
            version: '0.2',
            tools: [
              {
                name: 'submit',
                description: 'nested tool',
                steps: [{ type: 'click', target: '[data-ai="x"]' }],
              },
            ],
          },
        },
      });
      const result = await loadCompanionSpec(
        'https://example.com/companion.json',
        { fetchImpl: fetcher },
      );
      assertEq(result.tools.length, 1, 'one tool surfaces');
      assertEq(result.tools[0]!.flow, 'outer.inner', 'flow is dot-joined path');
      const reg = new ActionRegistry();
      reg.ingest(result);
      assert(
        reg.getTool('outer.inner.submit'),
        'registry surfaces as outer.inner.submit',
      );
      assertEq(
        reg.getTool('outer.submit'),
        undefined,
        'partial path not registered',
      );
      const inner = result.modules.find((m) => m.name === 'inner')!;
      assertEq(inner.loaded, true, 'inner module loaded');
    },
  },

  {
    label:
      'v0.6: 3-level nesting within default maxDepth=3 — `a.b.c.tool` works',
    run: async () => {
      const fetcher = makeFetch({
        'https://example.com/companion.json': {
          ok: true,
          body: {
            version: '0.2',
            modules: [{ name: 'a', url: './a.json' }],
          },
        },
        'https://example.com/a.json': {
          ok: true,
          body: {
            version: '0.2',
            modules: [{ name: 'b', url: './b.json' }],
          },
        },
        'https://example.com/b.json': {
          ok: true,
          body: {
            version: '0.2',
            modules: [{ name: 'c', url: './c.json' }],
          },
        },
        'https://example.com/c.json': {
          ok: true,
          body: {
            version: '0.2',
            tools: [
              {
                name: 'tool',
                description: 'leaf',
                steps: [{ type: 'click', target: '[data-ai="x"]' }],
              },
            ],
          },
        },
      });
      const result = await loadCompanionSpec(
        'https://example.com/companion.json',
        { fetchImpl: fetcher },
      );
      assertEq(result.tools.length, 1, 'one tool');
      assertEq(result.tools[0]!.flow, 'a.b.c', '3-level path');
    },
  },

  {
    label:
      'v0.6: 4-level over default maxDepth=3 — onModuleError(depth-exceeded), partial catalog',
    run: async () => {
      const fetcher = makeFetch({
        'https://example.com/companion.json': {
          ok: true,
          body: {
            version: '0.2',
            modules: [{ name: 'a', url: './a.json' }],
          },
        },
        'https://example.com/a.json': {
          ok: true,
          body: {
            version: '0.2',
            tools: [
              {
                name: 'shallow',
                description: 'depth-1 tool',
                steps: [{ type: 'click', target: '[data-ai="a"]' }],
              },
            ],
            modules: [{ name: 'b', url: './b.json' }],
          },
        },
        'https://example.com/b.json': {
          ok: true,
          body: {
            version: '0.2',
            modules: [{ name: 'c', url: './c.json' }],
          },
        },
        'https://example.com/c.json': {
          ok: true,
          body: {
            version: '0.2',
            modules: [{ name: 'd', url: './d.json' }],
          },
        },
        'https://example.com/d.json': {
          ok: true,
          body: {
            version: '0.2',
            tools: [
              {
                name: 'leaf',
                description: 'deep leaf',
                steps: [{ type: 'click', target: '[data-ai="z"]' }],
              },
            ],
          },
        },
      });
      const errors: ModuleErrorInfo[] = [];
      const result = await loadCompanionSpec(
        'https://example.com/companion.json',
        {
          fetchImpl: fetcher,
          onModuleError: (info) => errors.push(info),
        },
      );
      // depth 1-3 (a, a.b, a.b.c) load; d (depth 4) is refused.
      assertEq(errors.length, 1, 'one depth error');
      assertEq(errors[0]!.moduleName, 'd', 'deepest module flagged');
      assert(
        (errors[0]!.error as Error).message.includes('maxDepth'),
        'error mentions maxDepth',
      );
      // 'shallow' from a.json should still load.
      assertEq(result.tools.length, 1, 'partial catalog survives');
      assertEq(result.tools[0]!.tool.name, 'shallow', 'shallow tool present');
      const dEntry = result.modules.find((m) => m.name === 'd')!;
      assertEq(dEntry.loaded, false, 'd marked unloaded');
    },
  },

  {
    label: 'v0.6: maxDepth=4 override allows previously-blocked 4-level tree',
    run: async () => {
      const fetcher = makeFetch({
        'https://example.com/companion.json': {
          ok: true,
          body: {
            version: '0.2',
            modules: [{ name: 'a', url: './a.json' }],
          },
        },
        'https://example.com/a.json': {
          ok: true,
          body: {
            version: '0.2',
            modules: [{ name: 'b', url: './b.json' }],
          },
        },
        'https://example.com/b.json': {
          ok: true,
          body: {
            version: '0.2',
            modules: [{ name: 'c', url: './c.json' }],
          },
        },
        'https://example.com/c.json': {
          ok: true,
          body: {
            version: '0.2',
            modules: [{ name: 'd', url: './d.json' }],
          },
        },
        'https://example.com/d.json': {
          ok: true,
          body: {
            version: '0.2',
            tools: [
              {
                name: 'leaf',
                description: 'now reachable',
                steps: [{ type: 'click', target: '[data-ai="z"]' }],
              },
            ],
          },
        },
      });
      const result = await loadCompanionSpec(
        'https://example.com/companion.json',
        { fetchImpl: fetcher, maxDepth: 4 },
      );
      assertEq(result.tools.length, 1, 'tool now loads');
      assertEq(result.tools[0]!.flow, 'a.b.c.d', '4-level path');
    },
  },

  {
    label: 'mergeWhere — parent marker + child url → child carries both',
    run: async () => {
      const fetcher = makeFetch({
        'https://example.com/companion.json': {
          ok: true,
          body: {
            version: '0.2',
            modules: [
              {
                name: 'foo',
                url: './foo.json',
                where: { marker: '[data-view=foo]' },
              },
            ],
          },
        },
        'https://example.com/foo.json': {
          ok: true,
          body: {
            version: '0.2',
            tools: [
              {
                name: 'go',
                description: 'go',
                where: { url: '**/sub' },
                steps: [{ type: 'click', target: '[data-ai="go"]' }],
              },
            ],
          },
        },
      });
      const result: LoadResult = await loadCompanionSpec(
        'https://example.com/companion.json',
        { fetchImpl: fetcher },
      );
      const tool = result.tools[0]!;
      assertEq(tool.tool.where?.marker, '[data-view=foo]', 'marker from parent');
      assertEq(tool.tool.where?.url, '**/sub', 'url from child');
    },
  },
];

let failed = 0;
for (const c of cases) {
  try {
    await c.run();
    process.stdout.write(`  OK    ${c.label}\n`);
  } catch (err) {
    failed++;
    process.stdout.write(
      `  FAIL  ${c.label}\n        → ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

if (failed > 0) {
  process.stderr.write(`\n${failed}/${cases.length} smoke cases failed\n`);
  process.exit(1);
}
process.stdout.write(`\n${cases.length}/${cases.length} smoke cases passed\n`);
