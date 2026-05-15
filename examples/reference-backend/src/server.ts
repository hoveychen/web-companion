import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ResourceSpec, ToolSpec } from '@web-companion/spec';
import { verifyToken } from './auth.js';
import { McpHttpRouter } from './mcp-server.js';
import { SessionRegistry, type UserSession } from './sessions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to the CLI binary used by /cli/exec. Resolved relative to this
// file (examples/reference-backend/src/server.ts) — three hops up to
// the workspace root, then into packages/cli/dist/bin/companion.js.
// `pnpm --filter @web-companion/cli build` must have run for this to exist.
const CLI_BIN = resolve(
  __dirname,
  '..', // -> examples/reference-backend
  '..', // -> examples
  '..', // -> repo root
  'packages',
  'cli',
  'dist',
  'bin',
  'companion.js',
);
const CLI_EXEC_TIMEOUT_MS = 30_000;

const PORT = Number(process.env['PORT'] ?? 3001);
const HOST = process.env['HOST'] ?? '127.0.0.1';

const registry = new SessionRegistry();
const mcpRouter = new McpHttpRouter(registry);

// ---------------------------------------------------------------------------
// HTTP server — /health (debug), /mcp (Streamable HTTP MCP transport)
// ---------------------------------------------------------------------------
const http = createServer((req, res) => {
  // CORS — the shell.html demo is served by vite on a different port than
  // this backend, so any /mcp + /cli/exec call from the sidebar is a
  // cross-origin POST. Allow all origins for demo simplicity; production
  // setups should narrow this.
  applyCors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

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

  if (req.url?.startsWith('/cli/exec')) {
    handleCliExec(req, res).catch((err) => {
      process.stderr.write(`[reference-backend] /cli/exec error: ${String(err)}\n`);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({ ok: false, error: 'internal error' }),
        );
      } else {
        try { res.end(); } catch { /* ignore */ }
      }
    });
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

function applyCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, Mcp-Session-Id, mcp-protocol-version',
  );
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
}

// ---------------------------------------------------------------------------
// /cli/exec — spawn the companion CLI subprocess and stream its
// result back to the caller. Demo only: the sidebar uses this so the
// "CLI tab" actually runs a real `companion` process end-to-end.
// ---------------------------------------------------------------------------
async function handleCliExec(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'POST required' }));
    return;
  }
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'missing bearer token' }));
    return;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  const verified = verifyToken(token);
  if (!verified) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'invalid token' }));
    return;
  }

  let body = '';
  for await (const chunk of req) body += String(chunk);
  let parsed: { tool?: unknown; params?: unknown };
  try {
    parsed = body ? (JSON.parse(body) as { tool?: unknown; params?: unknown }) : {};
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'body is not valid JSON' }));
    return;
  }
  const toolName = parsed.tool;
  if (typeof toolName !== 'string' || !toolName) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'body.tool (string) required' }));
    return;
  }
  const params = parsed.params ?? {};

  process.stderr.write(
    `[reference-backend] /cli/exec user=${verified.userId} tool=${toolName}\n`,
  );

  const args = ['call', toolName, '--json', JSON.stringify(params)];
  const child = spawn(process.execPath, [CLI_BIN, ...args], {
    env: {
      ...process.env,
      COMPANION_TOKEN: token,
      COMPANION_BACKEND: `http://${HOST}:${PORT}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let timedOut = false;

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (c) => { stdout += c; });
  child.stderr.on('data', (c) => { stderr += c; });

  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
  }, CLI_EXEC_TIMEOUT_MS);

  const exitCode = await new Promise<number>((resolveExit) => {
    child.on('close', (code) => {
      clearTimeout(timeoutHandle);
      resolveExit(code ?? -1);
    });
    child.on('error', (err) => {
      clearTimeout(timeoutHandle);
      stderr += `[spawn error] ${String(err)}\n`;
      resolveExit(-1);
    });
  });

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify(
      {
        ok: exitCode === 0,
        tool: toolName,
        cmd: `companion ${args.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')}`,
        exitCode,
        timedOut,
        stdout,
        stderr,
      },
      null,
      2,
    ),
  );
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
        const rawRoles = msg['userRoles'];
        const nextRoles = Array.isArray(rawRoles)
          ? rawRoles.filter((r): r is string => typeof r === 'string')
          : [];
        const prev = session.pageState;
        const prevMarkerSet = new Set(prev.matchedMarkers);
        const nextMarkerSet = new Set(nextMarkers);
        const sameMarkers =
          prev.matchedMarkers.length === nextMarkers.length &&
          [...nextMarkerSet].every((m) => prevMarkerSet.has(m));
        const prevRoles = prev.userRoles ?? [];
        const prevRoleSet = new Set(prevRoles);
        const nextRoleSet = new Set(nextRoles);
        const sameRoles =
          prevRoles.length === nextRoles.length &&
          [...nextRoleSet].every((r) => prevRoleSet.has(r));
        if (prev.currentUrl !== nextUrl || !sameMarkers || !sameRoles) {
          session.pageState = {
            currentUrl: nextUrl,
            matchedMarkers: nextMarkers,
            userRoles: nextRoles,
          };
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
      `[reference-backend]   http://${HOST}:${PORT}/cli/exec      (spawn companion CLI subprocess; Authorization: Bearer JWT)\n` +
      `[reference-backend]   http://${HOST}:${PORT}/health        (debug)\n` +
      `[reference-backend]   cli bin: ${CLI_BIN}\n`,
  );
});

// Surface the registry so a test rig can poke at it.
export { registry };
