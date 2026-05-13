import type { ResourceSpec, ToolSpec } from '@web-companion/spec';
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
    return [...this.sessions.values()].map((s) => ({
      sessionId: s.sessionId,
      origin: s.origin,
      tabTitle: s.tabTitle,
      pageUrl: s.pageUrl,
      toolCount: s.tools.length,
      resourceCount: s.resources.length,
      namespace: s.namespace,
    }));
  }

  listAllTools(): Array<{ namespace: string; sessionId: string; tool: ToolSpec }> {
    const out: Array<{ namespace: string; sessionId: string; tool: ToolSpec }> = [];
    for (const s of this.sessions.values()) {
      for (const tool of s.tools) {
        out.push({ namespace: s.namespace, sessionId: s.sessionId, tool });
      }
    }
    return out;
  }

  listAllResources(): Array<{ namespace: string; sessionId: string; resource: ResourceSpec }> {
    const out: Array<{ namespace: string; sessionId: string; resource: ResourceSpec }> = [];
    for (const s of this.sessions.values()) {
      for (const r of s.resources) {
        out.push({ namespace: s.namespace, sessionId: s.sessionId, resource: r });
      }
    }
    return out;
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
        });
        return;
      }
      if (!bound) return; // ignore until hello has resolved

      switch (type) {
        case 'tools/list':
          bound.tools = (msg['tools'] as ToolSpec[]) ?? [];
          break;
        case 'resources/list':
          bound.resources = (msg['resources'] as ResourceSpec[]) ?? [];
          break;
        case 'tools/call/result':
        case 'resources/read/result':
          this.deliverResponse(msg);
          break;
        case 'session/navigating':
          // Hint to grace logic: a navigation is imminent, hold the session.
          // Implementation already covered by close-handler grace period;
          // marker kept for forward-compat.
          break;
      }
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
