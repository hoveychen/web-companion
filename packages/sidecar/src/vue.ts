import { defineComponent, onMounted, onUnmounted, watch } from 'vue';
import {
  connectAgent,
  type AgentConnection,
  type ConnectAgentOptions,
} from './core.js';

/**
 * Headless Vue 3 component (renders null) that mounts the web-companion
 * runtime + visible cursor and dials a remote agent backend over wss://.
 *
 *   <script setup>
 *     import { Sidecar } from '@web-companion/sidecar/vue';
 *   </script>
 *
 *   <template>
 *     <Sidecar
 *       backend-url="wss://agent.example.com/ws"
 *       :session-token="userJwt"
 *       @connected="onConnected"
 *       @error="onError"
 *     />
 *   </template>
 *
 * Reconnects on changes to backendUrl / specUrl / sessionId / sessionToken /
 * token.
 */
export const Sidecar = defineComponent({
  name: 'Sidecar',
  props: {
    backendUrl: { type: String, required: true },
    specUrl: { type: String, default: undefined },
    sessionId: { type: String, default: undefined },
    sessionToken: { type: String, default: undefined },
    token: { type: String, default: undefined },
  },
  emits: {
    connected: (_conn: AgentConnection) => true,
    disconnected: () => true,
    error: (_err: unknown) => true,
  },
  setup(props, { emit }) {
    let connection: AgentConnection | null = null;

    function currentOpts(): ConnectAgentOptions {
      const opts: ConnectAgentOptions = { backendUrl: props.backendUrl };
      if (props.specUrl !== undefined) opts.specUrl = props.specUrl;
      if (props.sessionId !== undefined) opts.sessionId = props.sessionId;
      if (props.sessionToken !== undefined) opts.sessionToken = props.sessionToken;
      if (props.token !== undefined) opts.token = props.token;
      return opts;
    }

    async function dial(): Promise<void> {
      try {
        const conn = await connectAgent(currentOpts());
        connection = conn;
        emit('connected', conn);
      } catch (err) {
        emit('error', err);
      }
    }

    function tearDown(): void {
      if (!connection) return;
      connection.disconnect();
      connection = null;
      emit('disconnected');
    }

    onMounted(() => {
      void dial();
    });
    onUnmounted(() => {
      tearDown();
    });

    watch(
      () => [
        props.backendUrl,
        props.specUrl,
        props.sessionId,
        props.sessionToken,
        props.token,
      ],
      () => {
        tearDown();
        void dial();
      },
    );

    return () => null;
  },
});

export type { AgentConnection, ConnectAgentOptions } from './core.js';
