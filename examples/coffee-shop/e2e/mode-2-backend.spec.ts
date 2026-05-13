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
    expect(names).toContain('alice:add_to_cart');
    expect(names).toContain('alice:read_cart');

    // Invoke add_to_cart over MCP HTTP. The reference-backend looks up
    // alice's ws session, sends `tools/call` down, the sdk executes the
    // DSL click against the actual mocha button, real onClick fires.
    const callRes = await mcpClient.callTool({
      name: 'alice:add_to_cart',
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
      name: 'alice:read_cart',
      arguments: {},
    });
    const cartText =
      (cartRes.content as Array<{ type: string; text?: string }> | undefined)
        ?.find((c) => c.type === 'text')?.text ?? '[]';
    expect(cartText).toContain('mocha');
  });
});
