import {
  connectAgent,
  type AgentConnection,
  type ConnectAgentOptions,
} from './core.js';

export interface AttachSidecarHandle {
  /**
   * Resolves once the runtime is loaded and the ws connection is open.
   * Rejects if connect fails (e.g. spec load fails or the backend refuses
   * within the initial handshake).
   */
  ready: Promise<AgentConnection>;
  /** Tear down ws + cursor (and runtime if we constructed it). */
  detach(): void;
}

/**
 * Framework-agnostic helper for plain HTML / vanilla TS pages:
 *
 *   import { attachSidecar } from '@web-companion/sidecar/vanilla';
 *   const handle = attachSidecar({ backendUrl: 'wss://...', sessionToken: '...' });
 *   await handle.ready;
 *   // ... later
 *   handle.detach();
 *
 * The returned `ready` Promise resolves to the same AgentConnection that the
 * React / Vue entries expose; you can grab `runtime` / `client` off it if you
 * need to inspect tool state from outside the sidecar.
 */
export function attachSidecar(options: ConnectAgentOptions): AttachSidecarHandle {
  let live: AgentConnection | null = null;
  let detached = false;

  const ready = connectAgent(options).then((conn) => {
    if (detached) {
      conn.disconnect();
      throw new Error('attachSidecar: detached before connection completed');
    }
    live = conn;
    return conn;
  });

  return {
    ready,
    detach(): void {
      detached = true;
      live?.disconnect();
      live = null;
    },
  };
}
