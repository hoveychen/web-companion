import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  ListToolsResultSchema,
  CallToolResultSchema,
  type Tool,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';

export interface ConnectOptions {
  /** http base (no trailing /mcp). e.g. http://127.0.0.1:3001 */
  backendBase: string;
  /** JWT to forward as Authorization: Bearer ... */
  token: string;
}

export interface CompanionCliClient {
  listTools(): Promise<Tool[]>;
  callTool(name: string, params: Record<string, unknown>): Promise<CallToolResult>;
  close(): Promise<void>;
}

export async function connect(opts: ConnectOptions): Promise<CompanionCliClient> {
  const url = new URL(`${opts.backendBase.replace(/\/+$/, '')}/mcp`);
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: {
      headers: { Authorization: `Bearer ${opts.token}` },
    },
  });
  const client = new Client(
    { name: '@web-companion/cli', version: '0.1.0' },
    { capabilities: {} },
  );
  await client.connect(transport);

  return {
    async listTools(): Promise<Tool[]> {
      const res = await client.request(
        { method: 'tools/list', params: {} },
        ListToolsResultSchema,
      );
      return res.tools;
    },
    async callTool(name: string, params: Record<string, unknown>): Promise<CallToolResult> {
      const res = await client.request(
        {
          method: 'tools/call',
          params: { name, arguments: params },
        },
        CallToolResultSchema,
      );
      return res;
    },
    async close(): Promise<void> {
      await transport.close();
    },
  };
}
