import { test, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { setTimeout as wait } from 'node:timers/promises';

const BACKEND_HTTP = 'http://127.0.0.1:3001/mcp';

let mcpClient: Client | null = null;

test.describe('Coffee shop · mode 2 (reference-backend) end-to-end', () => {
  test.beforeAll(async () => {
    const token = process.env['WC_TEST_USER_TOKEN'];
    if (!token) {
      throw new Error(
        'WC_TEST_USER_TOKEN not set — run via `pnpm test:e2e:backend` which mints one at config load.',
      );
    }

    const transport = new StreamableHTTPClientTransport(new URL(BACKEND_HTTP), {
      requestInit: {
        headers: { authorization: `Bearer ${token}` },
      },
    });
    mcpClient = new Client(
      { name: 'wc-backend-e2e', version: '1.0.0' },
      { capabilities: {} },
    );
    await mcpClient.connect(transport);
  });

  test.afterAll(async () => {
    await mcpClient?.close().catch(() => {
      /* ignore */
    });
    mcpClient = null;
  });

  test('MCP tools/call over HTTP routes through the reference-backend → cursor flies → cart updates', async ({
    page,
  }) => {
    if (!mcpClient) throw new Error('mcpClient not initialized');

    // Load the page; <Sidecar/> dials the reference-backend over ws with
    // the same Alice JWT that the MCP client is using over HTTP. Both
    // need to be in flight before tools/list will return anything.
    await page.goto('/');

    // Wait until the backend's /health endpoint sees the ws session for
    // alice. We re-use the health probe instead of MCP tools/list because
    // tools/list is empty until the page sends `tools/list` over ws —
    // /health reports `tools` count directly off the SessionRegistry.
    let toolsCount = 0;
    for (let i = 0; i < 50 && toolsCount === 0; i++) {
      const res = await fetch('http://127.0.0.1:3001/health');
      const body = (await res.json()) as {
        users: Array<{ userId: string; tools: number; resources: number }>;
      };
      const alice = body.users.find((u) => u.userId === 'alice');
      if (alice && alice.tools > 0) toolsCount = alice.tools;
      else await wait(100);
    }
    expect(
      toolsCount,
      'reference-backend never received alice ws session',
    ).toBeGreaterThan(0);

    // Tools should be namespaced as `alice:<toolName>` and
    // `alice:read_<resourceName>`.
    const listRes = await mcpClient.listTools();
    const names = listRes.tools.map((t) => t.name);
    expect(names).toContain('alice:cart.add_to_cart');
    expect(names).toContain('alice:read_cart.cart');

    // Invoke add_to_cart over MCP HTTP. The reference-backend looks up
    // alice's ws session, sends `tools/call` down, the sdk executes the
    // DSL click against the actual mocha button, real onClick fires.
    const callRes = await mcpClient.callTool({
      name: 'alice:cart.add_to_cart',
      arguments: { id: 'mocha' },
    });
    expect(callRes.isError ?? false).toBe(false);

    // Verify the page actually changed (this is the fidelity proof — the
    // mocha button's React onClick reduced into cartStore, which the
    // existing useSyncExternalStore subscription re-rendered).
    expect(await page.locator('[data-web-companion-cursor]').count()).toBe(1);
    const cartRegion = page.locator('aside').filter({ hasText: '购物车' });
    await expect(cartRegion.getByText('摩卡', { exact: true })).toBeVisible({
      timeout: 5_000,
    });

    // Round-trip the resource over HTTP as well.
    const cartRes = await mcpClient.callTool({
      name: 'alice:read_cart.cart',
      arguments: {},
    });
    const cartText =
      (cartRes.content as Array<{ type: string; text?: string }> | undefined)
        ?.find((c) => c.type === 'text')?.text ?? '[]';
    expect(cartText).toContain('mocha');
  });

  test('v0.4 filter: closing the account stub panel removes its tools from tools/list', async ({
    page,
  }) => {
    if (!mcpClient) throw new Error('mcpClient not initialized');

    await page.goto('/');
    // Give the sdk a beat to send tools/list + initial page/changed.
    await wait(300);

    const beforeNames = (await mcpClient.listTools()).tools.map((t) => t.name);
    expect(beforeNames).toContain('alice:account.login');
    expect(beforeNames).toContain('alice:account.update_profile');

    // Toggle the account stub off — removes [data-ai-view='account'] from
    // the DOM, PageStateTracker pushes page/changed, the backend
    // re-filters and sends tools_list_changed.
    await page
      .locator('button', { hasText: '关闭 account flow' })
      .click();
    await wait(200);

    const afterNames = (await mcpClient.listTools()).tools.map((t) => t.name);
    expect(afterNames).not.toContain('alice:account.login');
    expect(afterNames).not.toContain('alice:account.update_profile');
    // cart / search flows still active (their markers are still mounted).
    expect(afterNames).toContain('alice:cart.add_to_cart');

    // `_meta.scope: 'all'` brings the full catalog back regardless of
    // pageState — agents can still see what's available when navigated
    // away.
    const allRes = await mcpClient.request(
      {
        method: 'tools/list',
        params: { _meta: { scope: 'all' } },
      },
      // The MCP SDK's untyped request path needs the result schema; use
      // a permissive one (just confirms shape via runtime fields).
      ((await import('@modelcontextprotocol/sdk/types.js')) as typeof import('@modelcontextprotocol/sdk/types.js'))
        .ListToolsResultSchema,
    );
    const allNames = (
      allRes as { tools: Array<{ name: string }> }
    ).tools.map((t) => t.name);
    expect(allNames).toContain('alice:account.login');
  });

  test('v0.4 meta tools: companion_pages / _flows / _tools surface per-user flow info', async ({
    page,
  }) => {
    if (!mcpClient) throw new Error('mcpClient not initialized');

    await page.goto('/');
    // Wait for the backend to register the user's tools.
    for (let i = 0; i < 30; i++) {
      const r = await fetch('http://127.0.0.1:3001/health');
      const body = (await r.json()) as {
        users: Array<{ userId: string; tools: number }>;
      };
      const alice = body.users.find((u) => u.userId === 'alice');
      if (alice && alice.tools > 0) break;
      await wait(100);
    }

    // companion_pages — scalar (one session per user on backend).
    const pagesRes = await mcpClient.callTool({
      name: 'companion_pages',
      arguments: {},
    });
    const pagesText =
      (pagesRes.content as Array<{ type: string; text?: string }> | undefined)
        ?.find((c) => c.type === 'text')?.text ?? '{}';
    const pages = JSON.parse(pagesText) as {
      currentFlows: string[];
    };
    expect(pages.currentFlows).toEqual(
      expect.arrayContaining(['cart', 'search', 'account', 'support']),
    );

    // companion_flows — every flow + active flag.
    const flowsRes = await mcpClient.callTool({
      name: 'companion_flows',
      arguments: {},
    });
    const flowsText =
      (flowsRes.content as Array<{ type: string; text?: string }> | undefined)
        ?.find((c) => c.type === 'text')?.text ?? '[]';
    const flows = JSON.parse(flowsText) as Array<{
      name: string;
      toolCount: number;
      active: boolean;
    }>;
    const cartFlow = flows.find((f) => f.name === 'cart');
    expect(cartFlow!.toolCount).toBe(3);
    expect(cartFlow!.active).toBe(true);

    // companion_tools(flow='search') — drill into search flow.
    const toolsRes = await mcpClient.callTool({
      name: 'companion_tools',
      arguments: { flow: 'search' },
    });
    const toolsText =
      (toolsRes.content as Array<{ type: string; text?: string }> | undefined)
        ?.find((c) => c.type === 'text')?.text ?? '[]';
    const searchTools = JSON.parse(toolsText) as Array<{ name: string }>;
    expect(searchTools.map((t) => t.name)).toEqual(['search.search']);
  });

  test('v0.6 nested modules: cart.advanced surfaces with parent + depth, prefix tool query works', async ({
    page,
  }) => {
    if (!mcpClient) throw new Error('mcpClient not initialized');

    await page.goto('/');
    for (let i = 0; i < 30; i++) {
      const r = await fetch('http://127.0.0.1:3001/health');
      const body = (await r.json()) as {
        users: Array<{ userId: string; tools: number }>;
      };
      const alice = body.users.find((u) => u.userId === 'alice');
      if (alice && alice.tools > 0) break;
      await wait(100);
    }

    // tools/list should expose the deeper surface name
    // `alice:cart.advanced.apply_coupon`.
    const listNames = (await mcpClient.listTools()).tools.map((t) => t.name);
    expect(listNames).toContain('alice:cart.advanced.apply_coupon');
    expect(listNames).toContain('alice:cart.advanced.clear_all');

    // companion_flows — cart still surfaces, AND cart.advanced surfaces
    // with parent='cart' + depth=2.
    const flowsRes = await mcpClient.callTool({
      name: 'companion_flows',
      arguments: {},
    });
    const flowsText =
      (flowsRes.content as Array<{ type: string; text?: string }> | undefined)
        ?.find((c) => c.type === 'text')?.text ?? '[]';
    const flows = JSON.parse(flowsText) as Array<{
      name: string;
      parent?: string;
      depth: number;
      toolCount: number;
    }>;
    const cart = flows.find((f) => f.name === 'cart');
    const cartAdvanced = flows.find((f) => f.name === 'cart.advanced');
    expect(cart, 'cart flow present').toBeTruthy();
    expect(cart!.depth).toBe(1);
    expect(cart!.parent).toBeUndefined();
    expect(cartAdvanced, 'cart.advanced flow present').toBeTruthy();
    expect(cartAdvanced!.depth).toBe(2);
    expect(cartAdvanced!.parent).toBe('cart');
    expect(cartAdvanced!.toolCount).toBe(2);

    // companion_tools(flow='cart') — prefix match returns BOTH direct cart
    // tools AND the descendant cart.advanced.* tools (v0.6 prefix-match).
    const toolsRes = await mcpClient.callTool({
      name: 'companion_tools',
      arguments: { flow: 'cart' },
    });
    const toolsText =
      (toolsRes.content as Array<{ type: string; text?: string }> | undefined)
        ?.find((c) => c.type === 'text')?.text ?? '[]';
    const cartTools = (JSON.parse(toolsText) as Array<{ name: string }>)
      .map((t) => t.name)
      .sort();
    expect(cartTools).toEqual(
      expect.arrayContaining([
        'cart.add_to_cart',
        'cart.checkout',
        'cart.remove_from_cart',
        'cart.advanced.apply_coupon',
        'cart.advanced.clear_all',
      ]),
    );

    // companion_tools(flow='cart.advanced') — narrows to the nested flow.
    const advRes = await mcpClient.callTool({
      name: 'companion_tools',
      arguments: { flow: 'cart.advanced' },
    });
    const advText =
      (advRes.content as Array<{ type: string; text?: string }> | undefined)
        ?.find((c) => c.type === 'text')?.text ?? '[]';
    const advTools = (JSON.parse(advText) as Array<{ name: string }>)
      .map((t) => t.name)
      .sort();
    expect(advTools).toEqual([
      'cart.advanced.apply_coupon',
      'cart.advanced.clear_all',
    ]);
  });

  test('v0.5 auth filter: switching role toggles admin.* visibility in tools/list', async ({
    page,
  }) => {
    if (!mcpClient) throw new Error('mcpClient not initialized');

    await page.goto('/');
    await wait(300);

    // Default role is anonymous — admin tools should not appear.
    const anonymousNames = (await mcpClient.listTools()).tools.map(
      (t) => t.name,
    );
    expect(anonymousNames).not.toContain('alice:admin.delete_user');
    expect(anonymousNames).not.toContain('alice:admin.refund_order');
    // Cart flow still here (no role gate).
    expect(anonymousNames).toContain('alice:cart.add_to_cart');

    // Switch to admin role — body data-wc-user-roles changes, page/changed
    // fires, backend re-filters, MCP pushes tools_list_changed.
    await page
      .locator('button[data-ai-tool="set-role-admin"]')
      .click();
    await wait(200);

    const adminNames = (await mcpClient.listTools()).tools.map((t) => t.name);
    expect(adminNames).toContain('alice:admin.delete_user');
    expect(adminNames).toContain('alice:admin.refund_order');
    expect(adminNames).toContain('alice:cart.add_to_cart');

    // Switch to customer — admin tools vanish again, cart stays.
    await page
      .locator('button[data-ai-tool="set-role-customer"]')
      .click();
    await wait(200);

    const customerNames = (await mcpClient.listTools()).tools.map(
      (t) => t.name,
    );
    expect(customerNames).not.toContain('alice:admin.delete_user');
    expect(customerNames).toContain('alice:cart.add_to_cart');

    // _meta.scope='all' bypasses role filter — admin tools visible regardless.
    const allRes = await mcpClient.request(
      {
        method: 'tools/list',
        params: { _meta: { scope: 'all' } },
      },
      ((await import('@modelcontextprotocol/sdk/types.js')) as typeof import('@modelcontextprotocol/sdk/types.js'))
        .ListToolsResultSchema,
    );
    const allNames = (
      allRes as { tools: Array<{ name: string }> }
    ).tools.map((t) => t.name);
    expect(allNames).toContain('alice:admin.delete_user');
  });
});
