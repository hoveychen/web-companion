import type { ResourceSpec, ToolSpec } from '@web-companion/spec';
import type { WebSocket } from 'ws';

/**
 * One ws-connected page tab belonging to a verified user.
 *
 * `userId` is the JWT-extracted identity that BOTH the page sdk (via
 * `?token=...` on the ws URL) AND the desktop MCP client (via Authorization
 * header) must present to be routed together — this map is keyed on it,
 * so the MCP-side handler can look up "what tools does alice have right now"
 * without needing to share state with the sdk side.
 *
 * v0.3 reference-backend keeps it one-connection-per-user. Multi-tab per
 * user is parked for later (sessionId-on-top-of-userId, similar to how
 * @web-companion/local-bridge handles it).
 */
export interface UserSession {
  userId: string;
  sdkWs: WebSocket;
  origin: string;
  tabTitle: string;
  pageUrl: string;
  tools: ToolSpec[];
  resources: ResourceSpec[];
  /** Resolves of in-flight requests issued by the MCP side, keyed by ws message id. */
  pending: Map<number, PendingRequest>;
  nextRequestId: number;
}

export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 30_000;

export class SessionRegistry {
  private readonly byUser = new Map<string, UserSession>();

  upsert(userId: string, ws: WebSocket, info: {
    origin: string;
    tabTitle: string;
    pageUrl: string;
  }): UserSession {
    const existing = this.byUser.get(userId);
    if (existing) {
      // Replace ws on reconnect / new tab — drop the old one to keep at most one.
      try {
        existing.sdkWs.close();
      } catch {
        /* ignore */
      }
      existing.sdkWs = ws;
      existing.origin = info.origin;
      existing.tabTitle = info.tabTitle;
      existing.pageUrl = info.pageUrl;
      return existing;
    }
    const fresh: UserSession = {
      userId,
      sdkWs: ws,
      origin: info.origin,
      tabTitle: info.tabTitle,
      pageUrl: info.pageUrl,
      tools: [],
      resources: [],
      pending: new Map(),
      nextRequestId: 1,
    };
    this.byUser.set(userId, fresh);
    return fresh;
  }

  remove(userId: string): void {
    const session = this.byUser.get(userId);
    if (!session) return;
    for (const p of session.pending.values()) {
      clearTimeout(p.timeoutHandle);
      p.reject(new Error('user session closed'));
    }
    this.byUser.delete(userId);
  }

  get(userId: string): UserSession | undefined {
    return this.byUser.get(userId);
  }

  list(): UserSession[] {
    return [...this.byUser.values()];
  }

  async request(
    userId: string,
    type: 'tools/call' | 'resources/read',
    payload: object,
  ): Promise<unknown> {
    const session = this.byUser.get(userId);
    if (!session) {
      throw new Error(`no active page session for user ${userId}`);
    }
    const id = session.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        session.pending.delete(id);
        reject(new Error(`${type} timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);
      session.pending.set(id, { resolve, reject, timeoutHandle });
      session.sdkWs.send(JSON.stringify({ type, id, ...payload }));
    });
  }

  /** Called by the ws layer when the sdk sends back tools/call/result. */
  deliver(userId: string, msg: { id?: number; result?: unknown; data?: unknown; error?: unknown }): void {
    const session = this.byUser.get(userId);
    if (!session) return;
    if (typeof msg.id !== 'number') return;
    const p = session.pending.get(msg.id);
    if (!p) return;
    session.pending.delete(msg.id);
    clearTimeout(p.timeoutHandle);
    if (msg.error !== undefined && msg.error !== null) {
      p.reject(msg.error);
    } else if ('result' in msg) {
      p.resolve(msg.result);
    } else if ('data' in msg) {
      p.resolve(msg.data);
    } else {
      p.resolve(undefined);
    }
  }
}
