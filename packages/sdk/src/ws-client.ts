import type { ResourceSpec, ToolSpec } from '@web-companion/spec';
import { PageStateTracker, type PageState } from './page-state.js';
import { WrongPageError } from './where-check.js';

/**
 * Minimal runtime shape `attachWebSocket` needs — the production
 * `CompanionRuntime` satisfies it, but smoke tests can pass a fake.
 */
export interface RuntimeLike {
  listTools(): ToolSpec[];
  listResources(): ResourceSpec[];
  invokeTool(name: string, params: Record<string, unknown>): Promise<unknown>;
  readResource(name: string): unknown;
}

export interface AttachWebSocketOptions {
  /** Full ws/wss URL. Query params for sessionToken / token are appended automatically. */
  url: string;
  /** Override or auto-resume from sessionStorage. */
  sessionId?: string;
  /** Multi-user routing token (mode 2). Forwarded as `?sessionToken=...`. */
  sessionToken?: string;
  /** Optional ws-level auth token. Forwarded as `?token=...`. */
  token?: string;
  /** Initial reconnect backoff in ms. Doubles each retry up to `maxReconnectMs`. Default 500. */
  reconnectBackoffMs?: number;
  /** Cap on reconnect backoff. Default 30_000. */
  maxReconnectMs?: number;
}

export type WsState = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface WebCompanionWsClient {
  disconnect(): void;
  readonly state: WsState;
  readonly sessionId: string;
}

const SESSION_STORAGE_KEY = '__web-companion-session-id';
const DEFAULT_BACKOFF_MS = 500;
const DEFAULT_MAX_RECONNECT_MS = 30_000;

export function attachWebSocket(
  runtime: RuntimeLike,
  options: AttachWebSocketOptions,
): WebCompanionWsClient {
  const sessionId = options.sessionId ?? getOrCreateSessionId();
  const initialBackoff = options.reconnectBackoffMs ?? DEFAULT_BACKOFF_MS;
  const maxReconnect = options.maxReconnectMs ?? DEFAULT_MAX_RECONNECT_MS;

  let ws: WebSocket | null = null;
  let state: WsState = 'connecting';
  let backoff = initialBackoff;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let intentionallyClosed = false;

  // Page-state tracker: drives the v0.4 `page/changed` push so the
  // bridge/backend can pre-filter `tools/list` by `where`. The set of
  // known markers is derived from the catalog the runtime is serving
  // (any marker that no capability references is irrelevant to the
  // filter and would just waste a `querySelector` per mutation).
  const knownMarkers = collectKnownMarkers(runtime);
  const pageTracker = new PageStateTracker({
    knownMarkers,
    onChange: (next) => emitPageChanged(next),
  });

  function buildUrl(): string {
    const url = new URL(options.url);
    if (options.sessionToken !== undefined) {
      url.searchParams.set('sessionToken', options.sessionToken);
    }
    if (options.token !== undefined) {
      url.searchParams.set('token', options.token);
    }
    return url.toString();
  }

  function send(msg: object): void {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function connect(): void {
    if (intentionallyClosed) return;
    state = 'connecting';
    ws = new WebSocket(buildUrl());

    ws.addEventListener('open', () => {
      state = 'open';
      backoff = initialBackoff;
      send({
        type: 'session/hello',
        sessionId,
        origin: typeof location !== 'undefined' ? location.origin : '',
        pageUrl:
          typeof location !== 'undefined'
            ? location.pathname + location.search + location.hash
            : '',
        tabTitle: typeof document !== 'undefined' ? document.title : '',
      });
      // Initial page state lands BEFORE tools/list so the server side has
      // it on hand by the time the first MCP tools/list arrives. Subsequent
      // changes flow through `pageTracker.onChange → emitPageChanged`.
      send({ type: 'page/changed', ...pageTracker.current });
      send({ type: 'tools/list', tools: runtime.listTools() });
      send({ type: 'resources/list', resources: runtime.listResources() });
      pageTracker.start();
    });

    ws.addEventListener('message', (event) => {
      void handleMessage(event);
    });

    ws.addEventListener('close', () => {
      pageTracker.stop();
      if (intentionallyClosed) {
        state = 'closed';
        return;
      }
      scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      // 'close' will follow; reconnect happens there.
    });
  }

  async function handleMessage(event: MessageEvent): Promise<void> {
    let msg: { type?: string; id?: number; name?: string; input?: Record<string, unknown> };
    try {
      const raw = typeof event.data === 'string' ? event.data : '';
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'tools/call':
        await handleToolCall(msg);
        break;
      case 'resources/read':
        await handleResourceRead(msg);
        break;
      default:
        // Forward-compat: ignore unknown types.
        break;
    }
  }

  async function handleToolCall(msg: {
    id?: number;
    name?: string;
    input?: Record<string, unknown>;
  }): Promise<void> {
    if (typeof msg.id !== 'number' || typeof msg.name !== 'string') return;
    try {
      const result = await runtime.invokeTool(msg.name, msg.input ?? {});
      send({ type: 'tools/call/result', id: msg.id, result });
    } catch (err) {
      send({ type: 'tools/call/result', id: msg.id, error: toWireError(err) });
    }
  }

  async function handleResourceRead(msg: {
    id?: number;
    name?: string;
  }): Promise<void> {
    if (typeof msg.id !== 'number' || typeof msg.name !== 'string') return;
    try {
      const data = runtime.readResource(msg.name);
      send({ type: 'resources/read/result', id: msg.id, data });
    } catch (err) {
      send({ type: 'resources/read/result', id: msg.id, error: toWireError(err) });
    }
  }

  function scheduleReconnect(): void {
    state = 'reconnecting';
    reconnectTimer = setTimeout(() => {
      backoff = Math.min(backoff * 2, maxReconnect);
      connect();
    }, backoff);
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      send({ type: 'session/navigating' });
    });
  }

  connect();

  function emitPageChanged(next: PageState): void {
    send({ type: 'page/changed', ...next });
  }

  return {
    disconnect(): void {
      intentionallyClosed = true;
      pageTracker.stop();
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      ws?.close();
      state = 'closed';
    },
    get state(): WsState {
      return state;
    },
    get sessionId(): string {
      return sessionId;
    },
  };
}

function collectKnownMarkers(runtime: RuntimeLike): string[] {
  const out = new Set<string>();
  for (const t of runtime.listTools()) {
    if (t.where?.marker) out.add(t.where.marker);
  }
  for (const r of runtime.listResources()) {
    if (r.where?.marker) out.add(r.where.marker);
  }
  return [...out];
}

function toWireError(err: unknown): object {
  if (err instanceof WrongPageError) {
    return {
      code: err.code,
      message: err.message,
      currentUrl: err.currentUrl,
      currentMarkers: err.currentMarkers,
      expectedWhere: err.expectedWhere,
    };
  }
  if (err instanceof Error) {
    return { code: 'ERROR', message: err.message };
  }
  return { code: 'ERROR', message: String(err) };
}

function getOrCreateSessionId(): string {
  if (typeof sessionStorage === 'undefined') {
    return generateUuid();
  }
  try {
    const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const fresh = generateUuid();
    sessionStorage.setItem(SESSION_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // sessionStorage may throw in private-browsing mode etc.
    return generateUuid();
  }
}

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'wc-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
