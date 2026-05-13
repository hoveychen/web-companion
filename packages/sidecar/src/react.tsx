import { useEffect } from 'react';
import {
  connectAgent,
  type AgentConnection,
  type ConnectAgentOptions,
} from './core.js';

export interface SidecarProps extends ConnectAgentOptions {
  /** Called once the ws connection and runtime are ready. */
  onConnected?: (connection: AgentConnection) => void;
  /** Called after disconnect (component unmount or backendUrl change). */
  onDisconnected?: () => void;
  /** Called if `connectAgent` rejects (e.g. spec load fails). */
  onError?: (err: unknown) => void;
}

/**
 * Headless React component (renders null) that mounts the web-companion
 * runtime + visible cursor and dials the remote agent backend. Drop it
 * inside your app root; effects fire on mount/unmount.
 *
 *   <Sidecar
 *     backendUrl="wss://agent.example.com/ws"
 *     sessionToken={userJwt}
 *   />
 *
 * Lifecycle is keyed on `backendUrl + sessionToken + token + specUrl`; if any
 * of those change React reconnects.
 */
export function Sidecar(props: SidecarProps): null {
  const { backendUrl, specUrl, sessionToken, token, sessionId } = props;
  const onConnected = props.onConnected;
  const onDisconnected = props.onDisconnected;
  const onError = props.onError;
  const cursorOptions = props.cursorOptions;
  const runtimeProp = props.runtime;

  useEffect(() => {
    let cancelled = false;
    let live: AgentConnection | null = null;

    const opts: ConnectAgentOptions = { backendUrl };
    if (specUrl !== undefined) opts.specUrl = specUrl;
    if (sessionId !== undefined) opts.sessionId = sessionId;
    if (sessionToken !== undefined) opts.sessionToken = sessionToken;
    if (token !== undefined) opts.token = token;
    if (cursorOptions !== undefined) opts.cursorOptions = cursorOptions;
    if (runtimeProp !== undefined) opts.runtime = runtimeProp;

    connectAgent(opts)
      .then((connection) => {
        if (cancelled) {
          connection.disconnect();
          return;
        }
        live = connection;
        onConnected?.(connection);
      })
      .catch((err) => {
        if (cancelled) return;
        onError?.(err);
      });

    return () => {
      cancelled = true;
      if (live) {
        live.disconnect();
        onDisconnected?.();
      }
    };
    // We deliberately don't depend on the callback props to avoid reconnect
    // churn when parent re-renders with fresh callback refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendUrl, specUrl, sessionId, sessionToken, token]);

  return null;
}
