import {
  CompanionRuntime,
  attachCursor,
  attachWebSocket,
  type CursorOptions,
  type WebCompanionWsClient,
} from '@web-companion/sdk';

export interface ConnectAgentOptions {
  /** wss:// (or ws://) URL of the remote agent backend. */
  backendUrl: string;

  /** companion.json URL. Defaults to `/.well-known/companion.json`. */
  specUrl?: string;

  /** Override the auto-generated sessionId. Otherwise persisted in sessionStorage. */
  sessionId?: string;

  /**
   * Multi-user routing token. Forwarded as `?sessionToken=...` on the ws URL.
   * The backend uses this to associate the ws connection with a specific user
   * / conversation context.
   */
  sessionToken?: string;

  /** Optional ws-level auth token (e.g. a short-lived JWT). */
  token?: string;

  /** Visible cursor styling (passed through to attachCursor). */
  cursorOptions?: CursorOptions;

  /**
   * Reuse an existing CompanionRuntime instead of constructing one. When
   * provided, `specUrl` / `cursorOptions` are ignored — the runtime is
   * expected to already be `load()`-ed and have a cursor attached if desired.
   */
  runtime?: CompanionRuntime;
}

export interface AgentConnection {
  runtime: CompanionRuntime;
  client: WebCompanionWsClient;
  disconnect(): void;
}

/**
 * Boots a web-companion runtime, mounts the visible cursor, and dials the
 * remote agent backend. Returns the underlying handles plus a `disconnect`
 * that tears down ws + cursor in one shot.
 *
 * Use this when the website wants `claude code` / `claw` / its own backend
 * agent to drive the page from a remote process. For purely local /
 * sidebar-style integration, see `@web-companion/react`'s `<Companion>`
 * (demo-only in v0.3).
 */
export async function connectAgent(
  options: ConnectAgentOptions,
): Promise<AgentConnection> {
  let runtime: CompanionRuntime;
  let unmountCursor: (() => void) | null = null;

  if (options.runtime) {
    runtime = options.runtime;
  } else {
    const base: { specUrl?: string } = {};
    if (options.specUrl !== undefined) base.specUrl = options.specUrl;
    const withCursor = attachCursor(base, options.cursorOptions ?? {});
    unmountCursor = () => withCursor.cursor.unmount();
    runtime = new CompanionRuntime(withCursor);
    await runtime.load();
  }

  const attachOpts: Parameters<typeof attachWebSocket>[1] = {
    url: options.backendUrl,
  };
  if (options.sessionId !== undefined) attachOpts.sessionId = options.sessionId;
  if (options.sessionToken !== undefined) attachOpts.sessionToken = options.sessionToken;
  if (options.token !== undefined) attachOpts.token = options.token;

  const client = attachWebSocket(runtime, attachOpts);

  return {
    runtime,
    client,
    disconnect(): void {
      client.disconnect();
      unmountCursor?.();
    },
  };
}
