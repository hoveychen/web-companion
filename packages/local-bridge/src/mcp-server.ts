import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { BridgeWsServer } from './ws-server.js';

const META_LIST_SESSIONS_NAME = 'companion_list_sessions';
const RESOURCE_READ_PREFIX = 'read_';

/**
 * Wraps a BridgeWsServer in a stdio MCP server so external clients
 * (claude code / claw / any stdio-MCP host) can list and call the page's
 * tools without needing to speak WebSocket themselves.
 *
 * Tool naming surfaced to the MCP client:
 *   - `companion_list_sessions` — meta tool, returns the active tabs/sessions
 *   - `<originSlug>--<sessionShort>:<toolName>` — tools registered by a page
 *   - `<originSlug>--<sessionShort>:read_<resourceName>` — resources, modeled
 *     as side-effect-free tools so MCP clients without resources/* support
 *     still see them
 */
export function createMcpServer(bridge: BridgeWsServer): {
  server: Server;
  connect(): Promise<void>;
} {
  const server = new Server(
    { name: 'web-companion-local-bridge', version: '0.3.0-pre' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools: Array<{
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    }> = [
      {
        name: META_LIST_SESSIONS_NAME,
        description:
          'List the web-companion sessions currently connected to this bridge — one entry per open tab. Use this first to learn the namespace prefix you need to call other tools.',
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    for (const entry of bridge.listAllTools()) {
      tools.push({
        name: `${entry.namespace}:${entry.tool.name}`,
        description: `[${entry.namespace}] ${entry.tool.description}`,
        inputSchema:
          (entry.tool.params as Record<string, unknown> | undefined) ?? {
            type: 'object',
            properties: {},
          },
      });
    }

    for (const entry of bridge.listAllResources()) {
      tools.push({
        name: `${entry.namespace}:${RESOURCE_READ_PREFIX}${entry.resource.name}`,
        description: `[${entry.namespace}] Read resource: ${entry.resource.description}`,
        inputSchema: { type: 'object', properties: {} },
      });
    }

    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: rawArgs } = req.params;
    const args = (rawArgs ?? {}) as Record<string, unknown>;

    if (name === META_LIST_SESSIONS_NAME) {
      return {
        content: [
          { type: 'text', text: JSON.stringify(bridge.listSessions(), null, 2) },
        ],
      };
    }

    const colonIdx = name.indexOf(':');
    if (colonIdx === -1) {
      throw new Error(
        `tool '${name}' is not namespaced. Call '${META_LIST_SESSIONS_NAME}' first to discover available sessions.`,
      );
    }
    const namespace = name.slice(0, colonIdx);
    const localName = name.slice(colonIdx + 1);
    const sessionId = bridge.resolveNamespace(namespace);
    if (!sessionId) {
      throw new Error(
        `no active session for namespace '${namespace}'. Call '${META_LIST_SESSIONS_NAME}' for the current list.`,
      );
    }

    if (localName.startsWith(RESOURCE_READ_PREFIX)) {
      const resourceName = localName.slice(RESOURCE_READ_PREFIX.length);
      const data = await bridge.readResource(sessionId, resourceName);
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      };
    }

    const result = await bridge.callTool(sessionId, localName, args);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  });

  return {
    server,
    async connect(): Promise<void> {
      const transport = new StdioServerTransport();
      await server.connect(transport);
    },
  };
}
