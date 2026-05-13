import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { passesWhere } from '@web-companion/sdk';
import type { SessionRegistry } from './sessions.js';

const RESOURCE_READ_PREFIX = 'read_';

type ListToolsRequest = {
  params?: { _meta?: { scope?: unknown } } | undefined;
};

/**
 * Per-MCP-session entry. Tied to a userId at initialize-time; subsequent
 * requests with the same `Mcp-Session-Id` header must arrive with a JWT
 * carrying that same userId, otherwise we treat it as a cross-tenant hijack
 * attempt and 403.
 */
interface McpSessionEntry {
  transport: StreamableHTTPServerTransport;
  server: Server;
  userId: string;
}

/**
 * Routes a single Streamable HTTP MCP transport per userId↔mcp-session pair
 * over the reference-backend's `/mcp` endpoint. Tools surfaced to the MCP
 * client are namespaced as `<userId>:<toolName>` and resources as
 * `<userId>:read_<resourceName>` — same shape as the local-bridge so an
 * agent that's used to mode 1 can switch to mode 2 without re-learning naming.
 *
 * The backend is **not** the agent. It just relays `tools/call` over to the
 * user's page sdk via SessionRegistry.request().
 */
export class McpHttpRouter {
  private readonly sessions = new Map<string, McpSessionEntry>();
  private readonly userToSessions = new Map<string, Set<string>>();
  private readonly unsubscribeCatalog: () => void;

  constructor(private readonly registry: SessionRegistry) {
    // When the ws side updates a user's tools/resources/page state, push
    // `notifications/tools/list_changed` to every active MCP session
    // belonging to that user. Clients then re-pull `tools/list` and get
    // the freshly filtered catalog.
    this.unsubscribeCatalog = registry.onCatalogChange((userId) => {
      const sessionIds = this.userToSessions.get(userId);
      if (!sessionIds) return;
      for (const sid of sessionIds) {
        const entry = this.sessions.get(sid);
        if (!entry) continue;
        entry.server.sendToolListChanged().catch(() => {
          // Notification path may fail before init; safe to swallow.
        });
      }
    });
  }

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    userId: string,
  ): Promise<void> {
    const mcpSessionId = req.headers['mcp-session-id'];
    const headerValue = Array.isArray(mcpSessionId)
      ? mcpSessionId[0]
      : mcpSessionId;

    if (headerValue) {
      const entry = this.sessions.get(headerValue);
      if (!entry) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'unknown mcp-session-id; re-initialize',
            },
            id: null,
          }),
        );
        return;
      }
      if (entry.userId !== userId) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32001,
              message: 'mcp-session-id belongs to a different user',
            },
            id: null,
          }),
        );
        return;
      }
      await entry.transport.handleRequest(req, res);
      return;
    }

    // No mcp-session-id header — treat as new session (typically `initialize`).
    const entry = await this.createSession(userId);
    await entry.transport.handleRequest(req, res);
  }

  private async createSession(userId: string): Promise<McpSessionEntry> {
    const entryRef: { current: McpSessionEntry | null } = { current: null };
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        if (entryRef.current) {
          this.sessions.set(sid, entryRef.current);
          let perUser = this.userToSessions.get(userId);
          if (!perUser) {
            perUser = new Set<string>();
            this.userToSessions.set(userId, perUser);
          }
          perUser.add(sid);
        }
      },
      onsessionclosed: (sid) => {
        const closed = this.sessions.get(sid);
        if (!closed) return;
        this.sessions.delete(sid);
        const perUser = this.userToSessions.get(closed.userId);
        if (perUser) {
          perUser.delete(sid);
          if (perUser.size === 0) this.userToSessions.delete(closed.userId);
        }
        closed.server.close().catch(() => {
          /* ignore */
        });
      },
      enableJsonResponse: true,
    });
    const server = this.buildServer(userId);
    const entry: McpSessionEntry = { transport, server, userId };
    entryRef.current = entry;
    await server.connect(transport);
    return entry;
  }

  private buildServer(userId: string): Server {
    const server = new Server(
      { name: 'web-companion-reference-backend', version: '0.3.0-pre' },
      { capabilities: { tools: { listChanged: true } } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async (req) => {
      const scope = readScope(req as ListToolsRequest);
      const session = this.registry.get(userId);
      const tools: Array<{
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
      }> = [];
      if (!session) {
        return { tools };
      }
      for (const t of session.tools) {
        if (scope === 'page' && !passesWhere(t.where, session.pageState)) continue;
        tools.push({
          name: `${userId}:${t.name}`,
          description: `[${userId}] ${t.description}`,
          inputSchema:
            (t.params as Record<string, unknown> | undefined) ?? {
              type: 'object',
              properties: {},
            },
        });
      }
      for (const r of session.resources) {
        if (scope === 'page' && !passesWhere(r.where, session.pageState)) continue;
        tools.push({
          name: `${userId}:${RESOURCE_READ_PREFIX}${r.name}`,
          description: `[${userId}] Read resource: ${r.description}`,
          inputSchema: { type: 'object', properties: {} },
        });
      }
      return { tools };
    });

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const { name, arguments: rawArgs } = req.params;
      const args = (rawArgs ?? {}) as Record<string, unknown>;

      const colonIdx = name.indexOf(':');
      if (colonIdx === -1) {
        throw new Error(
          `tool '${name}' is not namespaced. Expected '<userId>:<toolName>'.`,
        );
      }
      const namespace = name.slice(0, colonIdx);
      if (namespace !== userId) {
        throw new Error(
          `tool '${name}' is namespaced for a different user (${namespace}); your token is for ${userId}.`,
        );
      }
      const localName = name.slice(colonIdx + 1);

      if (localName.startsWith(RESOURCE_READ_PREFIX)) {
        const resourceName = localName.slice(RESOURCE_READ_PREFIX.length);
        const data = await this.registry.request(userId, 'resources/read', {
          name: resourceName,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      }

      const result = await this.registry.request(userId, 'tools/call', {
        name: localName,
        input: args,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    });

    return server;
  }

  /** Tear down everything (for graceful shutdown / tests). */
  async close(): Promise<void> {
    this.unsubscribeCatalog();
    for (const entry of this.sessions.values()) {
      await entry.transport.close().catch(() => {
        /* ignore */
      });
      await entry.server.close().catch(() => {
        /* ignore */
      });
    }
    this.sessions.clear();
    this.userToSessions.clear();
  }
}

function readScope(req: ListToolsRequest): 'page' | 'all' {
  const raw = req?.params?._meta?.scope;
  return raw === 'all' ? 'all' : 'page';
}
