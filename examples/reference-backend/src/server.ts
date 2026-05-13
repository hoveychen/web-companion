import { createServer, type IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ResourceSpec, ToolSpec } from '@web-companion/spec';
import { verifyToken } from './auth.js';
import { McpHttpRouter } from './mcp-server.js';
import { SessionRegistry, type UserSession } from './sessions.js';

const PORT = Number(process.env['PORT'] ?? 3001);
const HOST = process.env['HOST'] ?? '127.0.0.1';

const registry = new SessionRegistry();
const mcpRouter = new McpHttpRouter(registry);

// ---------------------------------------------------------------------------
// HTTP server — /health (debug), /mcp (Streamable HTTP MCP transport)
// ---------------------------------------------------------------------------
const http = createServer((req, res) => {
  if (req.url?.startsWith('/health')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    const users = registry.list().map((s) => ({
      userId: s.userId,
      origin: s.origin,
      pageUrl: s.pageUrl,
      tools: s.tools.length,
      resources: s.resources.length,
    }));
    res.end(JSON.stringify({ ok: true, users }, null, 2));
    return;
  }

  if (req.url?.startsWith('/mcp')) {
    handleMcpRequest(req, res).catch((err) => {
      process.stderr.write(`[reference-backend] /mcp handler error: ${String(err)}\n`);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'internal error' },
            id: null,
          }),
        );
      } else {
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

async function handleMcpRequest(
  req: IncomingMessage,
  res: import('node:http').ServerResponse,
): Promise<void> {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.writeHead(401, {
      'content-type': 'application/json',
      'www-authenticate': 'Bearer realm="web-companion-reference-backend"',
    });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'missing or malformed Authorization header' },
        id: null,
      }),
    );
    return;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  const verified = verifyToken(token);
  if (!verified) {
    res.writeHead(401, {
      'content-type': 'application/json',
      'www-authenticate': 'Bearer realm="web-companion-reference-backend", error="invalid_token"',
    });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'invalid token' },
        id: null,
      }),
    );
    return;
  }
  await mcpRouter.handle(req, res, verified.userId);
}

// ---------------------------------------------------------------------------
// WebSocket server — accepts sdk connections on /ws?token=<JWT>
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ noServer: true });

http.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/ws')) {
    socket.destroy();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? HOST}`);
  const rawToken = url.searchParams.get('token') ?? url.searchParams.get('sessionToken');
  if (!rawToken) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  const verified = verifyToken(rawToken);
  if (!verified) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    handleSdkConnection(ws, req, verified.userId);
  });
});

function handleSdkConnection(
  ws: WebSocket,
  req: IncomingMessage,
  userId: string,
): void {
  let session: UserSession | null = null;
  const origin = req.headers.origin ?? '';

  ws.on('message', (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const type = msg['type'];
    if (typeof type !== 'string') return;

    if (type === 'session/hello' && !session) {
      session = registry.upsert(userId, ws, {
        origin: typeof msg['origin'] === 'string' ? (msg['origin'] as string) : origin,
        tabTitle: typeof msg['tabTitle'] === 'string' ? (msg['tabTitle'] as string) : '',
        pageUrl: typeof msg['pageUrl'] === 'string' ? (msg['pageUrl'] as string) : '',
      });
      ws.send(
        JSON.stringify({
          type: 'session/welcome',
          userId,
          graceMs: 0,
        }),
      );
      logSessionEvent('hello', session.userId, session.origin, session.pageUrl, session.tools.length);
      return;
    }
    if (!session) return;

    switch (type) {
      case 'tools/list':
        session.tools = (msg['tools'] as ToolSpec[]) ?? [];
        registry.notifyCatalogChanged(userId);
        logSessionEvent('tools-listed', session.userId, session.origin, session.pageUrl, session.tools.length);
        break;
      case 'resources/list':
        session.resources = (msg['resources'] as ResourceSpec[]) ?? [];
        registry.notifyCatalogChanged(userId);
        logSessionEvent('resources-listed', session.userId, session.origin, session.pageUrl, session.resources.length);
        break;
      case 'page/changed': {
        const nextUrl = typeof msg['currentUrl'] === 'string' ? (msg['currentUrl'] as string) : '';
        const rawMarkers = msg['matchedMarkers'];
        const nextMarkers = Array.isArray(rawMarkers)
          ? rawMarkers.filter((m): m is string => typeof m === 'string')
          : [];
        const prev = session.pageState;
        const prevSet = new Set(prev.matchedMarkers);
        const nextSet = new Set(nextMarkers);
        const sameMarkers =
          prev.matchedMarkers.length === nextMarkers.length &&
          [...nextSet].every((m) => prevSet.has(m));
        if (prev.currentUrl !== nextUrl || !sameMarkers) {
          session.pageState = { currentUrl: nextUrl, matchedMarkers: nextMarkers };
          registry.notifyCatalogChanged(userId);
        }
        break;
      }
      case 'tools/call/result':
      case 'resources/read/result': {
        const deliverPayload: { id?: number; result?: unknown; data?: unknown; error?: unknown } = {
          id: msg['id'] as number | undefined,
        };
        if ('result' in msg) deliverPayload.result = msg['result'];
        if ('data' in msg) deliverPayload.data = msg['data'];
        if ('error' in msg) deliverPayload.error = msg['error'];
        registry.deliver(userId, deliverPayload);
        break;
      }
      case 'session/navigating':
        // Forward-compat. Reference backend has no grace period for v0.3;
        // local-bridge handles that pattern for desktop usage.
        break;
    }
  });

  ws.on('close', () => {
    if (!session) return;
    registry.remove(userId);
    logSessionEvent('close', userId, origin, '', 0);
  });
}

function logSessionEvent(
  event: string,
  userId: string,
  origin: string,
  pageUrl: string,
  toolsLen: number,
): void {
  process.stderr.write(
    `[reference-backend] ${event} userId=${userId} origin=${origin} page=${pageUrl} tools=${toolsLen}\n`,
  );
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
http.listen(PORT, HOST, () => {
  process.stderr.write(
    `[reference-backend] listening on http://${HOST}:${PORT}\n` +
      `[reference-backend]   ws://${HOST}:${PORT}/ws?token=<JWT>  (sdk connects here)\n` +
      `[reference-backend]   http://${HOST}:${PORT}/mcp           (MCP Streamable HTTP; Authorization: Bearer JWT)\n` +
      `[reference-backend]   http://${HOST}:${PORT}/health        (debug)\n`,
  );
});

// Surface the registry so a test rig can poke at it.
export { registry };
