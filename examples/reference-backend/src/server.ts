import { createServer, type IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ResourceSpec, ToolSpec } from '@web-companion/spec';
import { verifyToken } from './auth.js';
import { SessionRegistry, type UserSession } from './sessions.js';

const PORT = Number(process.env['PORT'] ?? 3001);
const HOST = process.env['HOST'] ?? '127.0.0.1';

const registry = new SessionRegistry();

// ---------------------------------------------------------------------------
// HTTP server (Streamable HTTP MCP transport will mount here in the next turn)
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

  // /mcp endpoint will be wired to StreamableHTTPServerTransport next turn.
  if (req.url?.startsWith('/mcp')) {
    res.writeHead(501, { 'content-type': 'text/plain' });
    res.end('MCP Streamable HTTP transport not wired yet (next turn).');
    return;
  }

  res.writeHead(404);
  res.end();
});

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
        logSessionEvent('tools-listed', session.userId, session.origin, session.pageUrl, session.tools.length);
        break;
      case 'resources/list':
        session.resources = (msg['resources'] as ResourceSpec[]) ?? [];
        logSessionEvent('resources-listed', session.userId, session.origin, session.pageUrl, session.resources.length);
        break;
      case 'tools/call/result':
      case 'resources/read/result':
        registry.deliver(userId, {
          id: msg['id'] as number | undefined,
          result: msg['result'],
          data: msg['data'],
          error: msg['error'],
        });
        break;
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
      `[reference-backend]   http://${HOST}:${PORT}/mcp           (MCP transport, wired next turn)\n` +
      `[reference-backend]   http://${HOST}:${PORT}/health        (debug)\n`,
  );
});

// Surface the registry so a test rig can poke at it.
export { registry };
