import { test, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';

const __filename = fileURLToPath(import.meta.url);
const E2E_DIR = resolve(__filename, '..');
const REPO_ROOT = resolve(E2E_DIR, '..', '..', '..');

const BRIDGE_BIN = resolve(REPO_ROOT, 'packages/local-bridge/dist/cli.js');
const TEST_HOME = resolve(REPO_ROOT, 'examples/coffee-shop/.tmp/bridge-e2e-home');
const COFFEE_ORIGIN = 'http://127.0.0.1:5174';
const BRIDGE_PORT = '8765';

let mcpClient: Client | null = null;

test.describe('Coffee shop · mode 1 (local-bridge) end-to-end', () => {
  test.beforeAll(async () => {
    // Isolate the bridge's origin store under examples/coffee-shop/.tmp so
    // tests never touch the user's real ~/.web-companion/origins.json.
    rmSync(TEST_HOME, { recursive: true, force: true });
    mkdirSync(join(TEST_HOME, '.web-companion'), { recursive: true });
    writeFileSync(
      join(TEST_HOME, '.web-companion', 'origins.json'),
      JSON.stringify({ origins: { [COFFEE_ORIGIN]: 'allow' } }, null, 2),
      { mode: 0o600 },
    );

    // Spawn local-bridge via the MCP SDK's stdio client transport — it
    // forks the bridge subprocess and we get a working `Client` on the
    // other end of stdio.
    const transport = new StdioClientTransport({
      command: 'node',
      args: [BRIDGE_BIN, 'start', '--port', BRIDGE_PORT, '--host', '127.0.0.1'],
      env: { ...process.env, HOME: TEST_HOME },
      stderr: 'pipe',
    });
    mcpClient = new Client(
      { name: 'wc-bridge-e2e', version: '1.0.0' },
      { capabilities: {} },
    );
    await mcpClient.connect(transport);
  });

  test.afterAll(async () => {
    await mcpClient?.close().catch(() => {
      /* ignore */
    });
    mcpClient = null;
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  test('MCP tools/call routes through the bridge → cursor flies → cart updates', async ({
    page,
  }) => {
    if (!mcpClient) throw new Error('mcpClient not initialized');

    // Open the page; the headless <Sidecar/> dials the bridge over ws.
    await page.goto('/');

    // The bridge tags each session with `<originSlug>--<sessionShort>`.
    // Poll companion_list_sessions until our coffee-shop tab shows up
    // (this proves both: bridge accepted the origin, and the sdk's
    // tools/list arrived).
    let namespace: string | null = null;
    for (let i = 0; i < 50 && !namespace; i++) {
      const res = await mcpClient.callTool({
        name: 'companion_list_sessions',
        arguments: {},
      });
      const text =
        (res.content as Array<{ type: string; text?: string }> | undefined)
          ?.find((c) => c.type === 'text')?.text ?? '';
      try {
        const parsed = JSON.parse(text) as Array<{
          namespace: string;
          origin: string;
          toolCount: number;
        }>;
        const match = parsed.find(
          (s) => s.origin === COFFEE_ORIGIN && s.toolCount > 0,
        );
        if (match) namespace = match.namespace;
      } catch {
        /* not yet */
      }
      if (!namespace) await wait(100);
    }
    expect(namespace, 'bridge never saw the coffee-shop session').not.toBeNull();

    // tools/list should now include namespaced entries from this session.
    const listRes = await mcpClient.listTools();
    const addToCartName = `${namespace!}:cart.add_to_cart`;
    expect(listRes.tools.map((t) => t.name)).toContain(addToCartName);

    // Drive the tool through the bridge → ws → sdk → DOM dispatch.
    const callRes = await mcpClient.callTool({
      name: addToCartName,
      arguments: { id: 'mocha' },
    });
    expect(callRes.isError ?? false).toBe(false);

    // Cursor element should be in the page (sdk mounts it on first
    // invokeTool) and the cart should now contain mocha.
    expect(await page.locator('[data-web-companion-cursor]').count()).toBe(1);
    const cartRegion = page.locator('aside').filter({ hasText: '购物车' });
    await expect(cartRegion.getByText('摩卡', { exact: true })).toBeVisible({
      timeout: 5_000,
    });

    // The resource path also roundtrips: read the cart resource and
    // verify the extracted data contains the latte we just added.
    const resourceName = `${namespace!}:read_cart.cart`;
    const cartRes = await mcpClient.callTool({
      name: resourceName,
      arguments: {},
    });
    const cartText =
      (cartRes.content as Array<{ type: string; text?: string }> | undefined)
        ?.find((c) => c.type === 'text')?.text ?? '[]';
    expect(cartText).toContain('mocha');
  });

  test('v0.4 meta tools: companion_pages / _flows / _tools surface flow info', async ({
    page,
  }) => {
    if (!mcpClient) throw new Error('mcpClient not initialized');

    await page.goto('/');
    // Wait for sdk → bridge handshake.
    let ready = false;
    for (let i = 0; i < 30 && !ready; i++) {
      const res = await mcpClient.callTool({
        name: 'companion_list_sessions',
        arguments: {},
      });
      const text =
        (res.content as Array<{ type: string; text?: string }> | undefined)
          ?.find((c) => c.type === 'text')?.text ?? '';
      try {
        const list = JSON.parse(text) as Array<{
          origin: string;
          toolCount: number;
        }>;
        if (list.some((s) => s.origin === COFFEE_ORIGIN && s.toolCount > 0)) {
          ready = true;
        }
      } catch {
        /* not yet */
      }
      if (!ready) await wait(100);
    }
    expect(ready, 'bridge never saw the session').toBe(true);

    // companion_pages — one entry per session, currentFlows reflects the
    // page's mounted markers.
    const pagesRes = await mcpClient.callTool({
      name: 'companion_pages',
      arguments: {},
    });
    const pagesText =
      (pagesRes.content as Array<{ type: string; text?: string }> | undefined)
        ?.find((c) => c.type === 'text')?.text ?? '[]';
    const pages = JSON.parse(pagesText) as Array<{
      origin: string;
      currentFlows: string[];
    }>;
    const pageEntry = pages.find((p) => p.origin === COFFEE_ORIGIN);
    expect(pageEntry, 'page entry present').toBeTruthy();
    expect(pageEntry!.currentFlows).toEqual(
      expect.arrayContaining(['cart', 'search', 'account', 'support']),
    );

    // companion_flows — every flow reported with toolCount + active flag.
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
    expect(cartFlow, 'cart flow present').toBeTruthy();
    expect(cartFlow!.toolCount).toBe(3);
    expect(cartFlow!.active).toBe(true);

    // companion_tools(flow='cart') — drill in, ignores pageState.
    const toolsRes = await mcpClient.callTool({
      name: 'companion_tools',
      arguments: { flow: 'cart' },
    });
    const toolsText =
      (toolsRes.content as Array<{ type: string; text?: string }> | undefined)
        ?.find((c) => c.type === 'text')?.text ?? '[]';
    const cartTools = JSON.parse(toolsText) as Array<{ name: string }>;
    const cartToolNames = cartTools.map((t) => t.name).sort();
    // v0.6: flow='cart' is a prefix-match → returns direct cart tools
    // AND descendants like cart.advanced.* under a v0.6 nested module.
    // Use arrayContaining to stay forward-compatible.
    expect(cartToolNames).toEqual(
      expect.arrayContaining([
        'cart.add_to_cart',
        'cart.checkout',
        'cart.remove_from_cart',
      ]),
    );
  });
});
