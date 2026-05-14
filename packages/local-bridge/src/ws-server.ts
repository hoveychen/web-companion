import type { ResourceSpec, ToolSpec } from '@web-companion/spec';
import { passesWhere, type CapturedPageState } from '@web-companion/sdk';
import { WebSocket, WebSocketServer } from 'ws';
import { OriginStore, type OriginVerdict } from './origin-store.js';

export interface SessionInfo {
  sessionId: string;
  origin: string;
  tabTitle: string;
  pageUrl: string;
  toolCount: number;
  resourceCount: number;
  /** Disambiguation namespace used by the stdio MCP layer when surfacing tools. */
  namespace: string;
  /** Most recent v0.4 page state pushed by the sdk. Empty until the first `page/changed` ws msg. */
  pageState: CapturedPageState;
}

/**
 * Caller policy when an origin has no entry in OriginStore.
 *
 * - 'deny'   : reject the connection and log a stderr warning (MCP-mode default;
 *              stdin is occupied by the MCP transport so we can't prompt).
 * - 'prompt' : invoke `onPrompt(origin, pageUrl)` and wait for verdict
 *              (--no-mcp mode default; the CLI hooks this up to stdin readline).
 */
export type UnknownOriginPolicy =
  | { type: 'deny' }
  | {
      type: 'prompt';
      onPrompt: (info: PromptContext) => Promise<PromptOutcome>;
    };

export interface PromptContext {
  origin: string;
  pageUrl: string;
  tabTitle: string;
}

export type PromptOutcome =
  | { verdict: 'allow'; persist: boolean }
  | { verdict: 'deny'; persist: boolean };

export interface BridgeWsServerOptions {
  port: number;
  host?: string;
  originStore?: OriginStore;
  unknownOriginPolicy?: UnknownOriginPolicy;
  /** Grace period (ms) before dropping a session after ws close. Default 5000. */
  navigationGraceMs?: number;
}

interface InternalSession {
  sessionId: string;
  ws: WebSocket;
  origin: string;
  tabTitle: string;
  pageUrl: string;
  tools: ToolSpec[];
  resources: ResourceSpec[];
  namespace: string;
  pageState: CapturedPageState;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 30_000;

export class BridgeWsServer {
  private readonly wss: WebSocketServer;
  private readonly sessions = new Map<string, InternalSession>();
  private readonly namespaceToSession = new Map<string, string>();
  private readonly pending = new Map<number, PendingRequest>();
  private readonly graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly catalogListeners = new Set<() => void>();
  private nextRequestId = 1;
  private ready: Promise<void>;
  private readonly originStore: OriginStore;
  private readonly unknownOriginPolicy: UnknownOriginPolicy;
  private readonly navigationGraceMs: number;

  constructor(opts: BridgeWsServerOptions = { port: 8765 }) {
    this.originStore = opts.originStore ?? new OriginStore();
    this.unknownOriginPolicy = opts.unknownOriginPolicy ?? { type: 'deny' };
    this.navigationGraceMs = opts.navigationGraceMs ?? 5000;
    this.wss = new WebSocketServer({
      port: opts.port,
      host: opts.host ?? '127.0.0.1',
    });
    this.wss.on('connection', (ws) => this.handleConnection(ws));
    this.ready = new Promise<void>((resolve) => {
      this.wss.once('listening', () => resolve());
    });
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  address(): { host: string; port: number } | null {
    const addr = this.wss.address();
    if (typeof addr === 'string' || addr === null) return null;
    return { host: addr.address, port: addr.port };
  }

  listSessions(): SessionInfo[] {
    return this.activeSessions().map((s) => ({
      sessionId: s.sessionId,
      origin: s.origin,
      tabTitle: s.tabTitle,
      pageUrl: s.pageUrl,
      toolCount: s.tools.length,
      resourceCount: s.resources.length,
      namespace: s.namespace,
      pageState: {
        currentUrl: s.pageState.currentUrl,
        matchedMarkers: [...s.pageState.matchedMarkers],
        userRoles: [...(s.pageState.userRoles ?? [])],
      },
    }));
  }

  /**
   * @param scope 'page' (default) returns tools whose `where` matches each
   * session's current page state. 'all' returns the unfiltered catalog —
   * agents pass `_meta.scope='all'` to bypass the filter.
   */
  listAllTools(
    scope: 'page' | 'all' = 'page',
  ): Array<{ namespace: string; sessionId: string; tool: ToolSpec }> {
    const out: Array<{ namespace: string; sessionId: string; tool: ToolSpec }> = [];
    for (const s of this.activeSessions()) {
      for (const tool of s.tools) {
        if (scope === 'page' && !passesWhere(tool.where, s.pageState)) continue;
        out.push({ namespace: s.namespace, sessionId: s.sessionId, tool });
      }
    }
    return out;
  }

  listAllResources(
    scope: 'page' | 'all' = 'page',
  ): Array<{ namespace: string; sessionId: string; resource: ResourceSpec }> {
    const out: Array<{ namespace: string; sessionId: string; resource: ResourceSpec }> = [];
    for (const s of this.activeSessions()) {
      for (const r of s.resources) {
        if (scope === 'page' && !passesWhere(r.where, s.pageState)) continue;
        out.push({ namespace: s.namespace, sessionId: s.sessionId, resource: r });
      }
    }
    return out;
  }

  /**
   * Sessions whose underlying ws is in the OPEN state — filters out
   * grace-pending entries that still occupy `this.sessions` while waiting
   * for a reconnect (their ws is CLOSED, readyState=3) AND brand-new
   * sessions whose ws is mid-handshake (CONNECTING=0). Without this
   * filter, list/snapshot APIs double-count tools across rapid
   * reconnect windows (cross-test bleed in Playwright runs).
   */
  private activeSessions(): InternalSession[] {
    const out: InternalSession[] = [];
    for (const s of this.sessions.values()) {
      if (s.ws.readyState === s.ws.OPEN) out.push(s);
    }
    return out;
  }

  /**
   * Snapshot of every active session including its tools, resources, and
   * latest page state. Consumed by the v0.4 meta tools (`pages` / `flows`
   * / `tools`) which need to summarize per-session — the lightweight
   * `listSessions()` doesn't carry the tool catalog.
   */
  snapshotSessions(): Array<{
    info: SessionInfo;
    tools: ToolSpec[];
    resources: ResourceSpec[];
  }> {
    return this.activeSessions().map((s) => ({
      info: {
        sessionId: s.sessionId,
        origin: s.origin,
        tabTitle: s.tabTitle,
        pageUrl: s.pageUrl,
        toolCount: s.tools.length,
        resourceCount: s.resources.length,
        namespace: s.namespace,
        pageState: {
          currentUrl: s.pageState.currentUrl,
          matchedMarkers: [...s.pageState.matchedMarkers],
          userRoles: [...(s.pageState.userRoles ?? [])],
        },
      },
      tools: [...s.tools],
      resources: [...s.resources],
    }));
  }

  /**
   * Subscribe to "tool catalog might have changed" events — fires after
   * any sdk-initiated update that could change what `listAllTools()` /
   * `listAllResources()` returns: a fresh tools/list, a fresh
   * resources/list, a page/changed that flipped a `where` match. The
   * stdio MCP server uses this to push `notifications/tools/list_changed`.
   *
   * Returns an unsubscribe function.
   */
  onCatalogChange(cb: () => void): () => void {
    this.catalogListeners.add(cb);
    return () => this.catalogListeners.delete(cb);
  }

  private notifyCatalogChanged(): void {
    for (const cb of this.catalogListeners) {
      try {
        cb();
      } catch {
        // Listeners must not break the ws loop.
      }
    }
  }

  resolveNamespace(namespace: string): string | undefined {
    return this.namespaceToSession.get(namespace);
  }

  async callTool(
    sessionId: string,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request(sessionId, 'tools/call', { name: toolName, input });
  }

  async readResource(sessionId: string, resourceName: string): Promise<unknown> {
    return this.request(sessionId, 'resources/read', { name: resourceName });
  }

  close(): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timeoutHandle);
      p.reject(new Error('bridge closing'));
    }
    this.pending.clear();
    for (const t of this.graceTimers.values()) {
      clearTimeout(t);
    }
    this.graceTimers.clear();
    this.wss.close();
  }

  private async request(
    sessionId: string,
    type: 'tools/call' | 'resources/read',
    payload: object,
  ): Promise<unknown> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`no session ${sessionId}`);
    }
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${type} timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timeoutHandle });
      session.ws.send(JSON.stringify({ type, id, ...payload }));
    });
  }

  private handleConnection(ws: WebSocket): void {
    let bound: InternalSession | null = null;
    let pendingHello = true;
    // Messages that arrive in the same tcp chunk as session/hello can be
    // emitted synchronously while bindSession is still resolving; buffer
    // them and replay once the session is bound (or drop them if the
    // bind was rejected).
    const pendingQueue: Array<Record<string, unknown>> = [];

    const apply = (msg: Record<string, unknown>): void => {
      if (!bound) return;
      const type = msg['type'];
      if (typeof type !== 'string') return;
      switch (type) {
        case 'tools/list':
          bound.tools = (msg['tools'] as ToolSpec[]) ?? [];
          this.notifyCatalogChanged();
          break;
        case 'resources/list':
          bound.resources = (msg['resources'] as ResourceSpec[]) ?? [];
          this.notifyCatalogChanged();
          break;
        case 'page/changed': {
          const next: CapturedPageState = {
            currentUrl: stringOr(msg['currentUrl'], ''),
            matchedMarkers: Array.isArray(msg['matchedMarkers'])
              ? (msg['matchedMarkers'] as unknown[]).filter(
                  (m): m is string => typeof m === 'string',
                )
              : [],
            userRoles: Array.isArray(msg['userRoles'])
              ? (msg['userRoles'] as unknown[]).filter(
                  (r): r is string => typeof r === 'string',
                )
              : [],
          };
          if (!sameState(bound.pageState, next)) {
            bound.pageState = next;
            this.notifyCatalogChanged();
          }
          break;
        }
        case 'tools/call/result':
        case 'resources/read/result':
          this.deliverResponse(msg);
          break;
        case 'session/navigating':
          break;
      }
    };

    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const type = msg['type'];
      if (typeof type !== 'string') return;

      if (type === 'session/hello' && pendingHello) {
        pendingHello = false;
        void this.bindSession(ws, msg).then((session) => {
          bound = session;
          if (session) {
            for (const queued of pendingQueue) apply(queued);
          }
          pendingQueue.length = 0;
        });
        return;
      }
      if (!bound) {
        pendingQueue.push(msg);
        return;
      }
      apply(msg);
    });

    ws.on('close', () => {
      if (!bound) return;
      this.scheduleSessionDrop(bound);
    });
  }

  private async bindSession(
    ws: WebSocket,
    helloMsg: Record<string, unknown>,
  ): Promise<InternalSession | null> {
    const sessionId =
      typeof helloMsg['sessionId'] === 'string'
        ? (helloMsg['sessionId'] as string)
        : `unknown-${Math.random().toString(36).slice(2)}`;
    const origin =
      typeof helloMsg['origin'] === 'string' ? (helloMsg['origin'] as string) : '';
    const tabTitle = stringOr(helloMsg['tabTitle'], '');
    const pageUrl = stringOr(helloMsg['pageUrl'], '');

    const decision = await this.decideOriginVerdict({
      origin,
      tabTitle,
      pageUrl,
    });
    if (decision === 'deny') {
      try {
        ws.send(
          JSON.stringify({
            type: 'session/denied',
            origin,
            reason:
              'origin is not in this bridge\'s allowlist. Run `web-companion-bridge allow <origin>` to authorize.',
          }),
        );
        ws.close();
      } catch {
        // ignore
      }
      process.stderr.write(
        `[web-companion] denied connection from origin '${origin || '<unknown>'}'\n`,
      );
      return null;
    }

    const namespace = buildNamespace(origin, sessionId);
    const session: InternalSession = {
      sessionId,
      ws,
      origin,
      tabTitle,
      pageUrl,
      tools: [],
      resources: [],
      namespace,
      pageState: { currentUrl: '', matchedMarkers: [], userRoles: [] },
    };

    // Grace-period reconnect: existing session under same id keeps its slot,
    // but its old ws gets replaced. Clear any pending drop timer.
    const existing = this.sessions.get(sessionId);
    if (existing) {
      this.namespaceToSession.delete(existing.namespace);
      try {
        existing.ws.close();
      } catch {
        // ignore
      }
    }
    const pendingDrop = this.graceTimers.get(sessionId);
    if (pendingDrop !== undefined) {
      clearTimeout(pendingDrop);
      this.graceTimers.delete(sessionId);
    }

    this.sessions.set(sessionId, session);
    this.namespaceToSession.set(namespace, sessionId);
    return session;
  }

  private async decideOriginVerdict(ctx: PromptContext): Promise<OriginVerdict> {
    const stored = this.originStore.lookup(ctx.origin);
    if (stored !== undefined) return stored;

    if (this.unknownOriginPolicy.type === 'deny') {
      process.stderr.write(
        `[web-companion] origin '${ctx.origin || '<unknown>'}' is not authorized. Run \`web-companion-bridge allow <origin>\` and reconnect.\n`,
      );
      return 'deny';
    }
    try {
      const outcome = await this.unknownOriginPolicy.onPrompt(ctx);
      if (outcome.persist) {
        this.originStore.set(ctx.origin, outcome.verdict);
      }
      return outcome.verdict;
    } catch (err) {
      process.stderr.write(
        `[web-companion] prompt handler errored: ${err instanceof Error ? err.message : String(err)} — denying\n`,
      );
      return 'deny';
    }
  }

  private scheduleSessionDrop(session: InternalSession): void {
    // If the session has already been replaced by a fresh hello, don't drop.
    const current = this.sessions.get(session.sessionId);
    if (current !== session) return;

    const timer = setTimeout(() => {
      this.graceTimers.delete(session.sessionId);
      // Only drop if still the same instance (no reconnect happened).
      if (this.sessions.get(session.sessionId) === session) {
        this.sessions.delete(session.sessionId);
        this.namespaceToSession.delete(session.namespace);
        this.notifyCatalogChanged();
      }
    }, this.navigationGraceMs);
    this.graceTimers.set(session.sessionId, timer);
  }

  private deliverResponse(msg: Record<string, unknown>): void {
    const id = msg['id'];
    if (typeof id !== 'number') return;
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timeoutHandle);
    if (msg['error'] !== undefined && msg['error'] !== null) {
      p.reject(msg['error']);
    } else if ('result' in msg) {
      p.resolve(msg['result']);
    } else if ('data' in msg) {
      p.resolve(msg['data']);
    } else {
      p.resolve(undefined);
    }
  }
}

function buildNamespace(origin: string, sessionId: string): string {
  const slug = originSlug(origin);
  const short = sessionId.slice(0, 8);
  return `${slug}--${short}`;
}

function originSlug(origin: string): string {
  if (!origin) return 'unknown';
  try {
    const url = new URL(origin);
    return url.hostname.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'unknown';
  } catch {
    return origin.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'unknown';
  }
}

function stringOr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function sameState(a: CapturedPageState, b: CapturedPageState): boolean {
  if (a.currentUrl !== b.currentUrl) return false;
  if (a.matchedMarkers.length !== b.matchedMarkers.length) return false;
  const aSet = new Set(a.matchedMarkers);
  for (const m of b.matchedMarkers) if (!aSet.has(m)) return false;
  const aRoles = a.userRoles ?? [];
  const bRoles = b.userRoles ?? [];
  if (aRoles.length !== bRoles.length) return false;
  const aRoleSet = new Set(aRoles);
  for (const r of bRoles) if (!aRoleSet.has(r)) return false;
  return true;
}
