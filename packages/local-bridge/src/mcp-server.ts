import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  summarizeFlows,
  summarizePages,
  summarizeTools,
} from '@web-companion/sdk';
import type { BridgeWsServer, SessionInfo } from './ws-server.js';

type ListToolsRequest = {
  params?: { _meta?: { scope?: unknown } } | undefined;
};

const META_LIST_SESSIONS_NAME = 'companion_list_sessions';
const META_PAGES_NAME = 'companion_pages';
const META_FLOWS_NAME = 'companion_flows';
const META_TOOLS_NAME = 'companion_tools';
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
    { capabilities: { tools: { listChanged: true } } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async (req) => {
    const scope = readScope(req as ListToolsRequest);
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
      {
        name: META_PAGES_NAME,
        description:
          'Per-session current page state — current URL, matched view markers, and which flows are active right now. Use to orient yourself before calling a tool you might not be on the right page for.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: META_FLOWS_NAME,
        description:
          'All flows declared across every connected session. Each entry has a `namespace` (so you know which tab it lives in), a flow `name`, tool/resource counts, and an `active` flag indicating whether the current pageState satisfies the flow\'s where: predicate.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: META_TOOLS_NAME,
        description:
          'Drill into a specific flow (across all sessions) and return its tools — name, description, params. If `flow` is omitted, returns the active tools across every session (same set tools/list would surface by default).',
        inputSchema: {
          type: 'object',
          properties: {
            flow: {
              type: 'string',
              description:
                'Optional flow name to filter by. Omit for the page-scoped active set.',
            },
            namespace: {
              type: 'string',
              description:
                'Optional namespace (from companion_list_sessions) to restrict to a single tab.',
            },
          },
        },
      },
    ];

    for (const entry of bridge.listAllTools(scope)) {
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

    for (const entry of bridge.listAllResources(scope)) {
      tools.push({
        name: `${entry.namespace}:${RESOURCE_READ_PREFIX}${entry.resource.name}`,
        description: `[${entry.namespace}] Read resource: ${entry.resource.description}`,
        inputSchema: { type: 'object', properties: {} },
      });
    }

    return { tools };
  });

  bridge.onCatalogChange(() => {
    server.sendToolListChanged().catch(() => {
      // Notification path may fail before the MCP client initializes;
      // safe to swallow because the client will pull tools/list on
      // initialize anyway.
    });
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
    if (name === META_PAGES_NAME) {
      const out = bridge.snapshotSessions().map((s) => ({
        namespace: s.info.namespace,
        sessionId: s.info.sessionId,
        origin: s.info.origin,
        ...summarizePages(s.tools, s.resources, s.info.pageState),
      }));
      return {
        content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
      };
    }
    if (name === META_FLOWS_NAME) {
      const out: Array<Record<string, unknown>> = [];
      for (const s of bridge.snapshotSessions()) {
        for (const flow of summarizeFlows(s.tools, s.resources, s.info.pageState)) {
          out.push({ namespace: s.info.namespace, ...flow });
        }
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
      };
    }
    if (name === META_TOOLS_NAME) {
      const flow = typeof args['flow'] === 'string' ? (args['flow'] as string) : undefined;
      const ns = typeof args['namespace'] === 'string' ? (args['namespace'] as string) : undefined;
      const out: Array<Record<string, unknown>> = [];
      for (const s of bridge.snapshotSessions()) {
        if (ns !== undefined && s.info.namespace !== ns) continue;
        for (const t of summarizeTools(s.tools, s.info.pageState, flow)) {
          out.push({ namespace: s.info.namespace, ...t });
        }
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
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

function readScope(req: ListToolsRequest): 'page' | 'all' {
  const raw = req?.params?._meta?.scope;
  return raw === 'all' ? 'all' : 'page';
}
