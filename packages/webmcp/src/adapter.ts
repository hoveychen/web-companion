import type { CompanionRuntime } from '@web-companion/sdk';
import type { ResourceSpec, ToolSpec } from '@web-companion/spec';

export interface WebMcpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: object;
  execute: (input: unknown) => Promise<unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
  };
}

export interface WebMcpHost {
  registerTool: (tool: WebMcpTool) => void;
  unregisterTool?: (name: string) => void;
  clearContext?: () => void;
}

declare global {
  interface Navigator {
    modelContext?: WebMcpHost;
    modelContextTesting?: WebMcpHost;
  }
}

export interface RegisterCompanionWithWebMCPOptions {
  host?: WebMcpHost;
  resourceToolPrefix?: string;
  onUnsupported?: (info: { reason: string }) => void;
}

export interface RegisterCompanionWithWebMCPResult {
  registered: boolean;
  toolNames: string[];
  unregister: () => void;
}

function detectHost(nav: Navigator): WebMcpHost | null {
  if (nav.modelContext && typeof nav.modelContext.registerTool === 'function') {
    return nav.modelContext;
  }
  // Chrome 146 Canary ships the testing-only mirror that the official
  // Model Context Tool Inspector extension listens on.
  if (
    nav.modelContextTesting &&
    typeof nav.modelContextTesting.registerTool === 'function'
  ) {
    return nav.modelContextTesting;
  }
  return null;
}

export function registerCompanionWithWebMCP(
  runtime: CompanionRuntime,
  options: RegisterCompanionWithWebMCPOptions = {},
): RegisterCompanionWithWebMCPResult {
  const host =
    options.host ??
    (typeof navigator !== 'undefined' ? detectHost(navigator) : null);

  if (!host) {
    options.onUnsupported?.({
      reason: 'navigator.modelContext / modelContextTesting not present',
    });
    return { registered: false, toolNames: [], unregister: () => {} };
  }

  const prefix = options.resourceToolPrefix ?? 'read_';
  const registeredNames: string[] = [];

  for (const tool of runtime.listTools()) {
    const webMcpTool = toolToWebMcp(tool, runtime);
    host.registerTool(webMcpTool);
    registeredNames.push(webMcpTool.name);
  }

  for (const resource of runtime.listResources()) {
    const webMcpTool = resourceToWebMcp(resource, prefix, runtime);
    host.registerTool(webMcpTool);
    registeredNames.push(webMcpTool.name);
  }

  return {
    registered: true,
    toolNames: registeredNames,
    unregister: () => {
      if (typeof host.unregisterTool === 'function') {
        for (const name of registeredNames) host.unregisterTool(name);
      } else if (typeof host.clearContext === 'function') {
        host.clearContext();
      }
    },
  };
}

function toolToWebMcp(tool: ToolSpec, runtime: CompanionRuntime): WebMcpTool {
  const webMcpTool: WebMcpTool = {
    name: tool.name,
    description: tool.description,
    execute: async (input: unknown) => {
      const params = (input ?? {}) as Record<string, unknown>;
      return runtime.invokeTool(tool.name, params);
    },
  };
  if (tool.params) webMcpTool.inputSchema = tool.params as object;
  return webMcpTool;
}

function resourceToWebMcp(
  resource: ResourceSpec,
  prefix: string,
  runtime: CompanionRuntime,
): WebMcpTool {
  return {
    name: `${prefix}${resource.name}`,
    description: resource.description,
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => runtime.readResource(resource.name),
  };
}
