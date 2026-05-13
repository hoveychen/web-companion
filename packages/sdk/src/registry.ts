import type { ResourceSpec, ToolSpec } from '@web-companion/spec';
import type {
  LoadResult,
  ResolvedResource,
  ResolvedTool,
} from './loader.js';

/**
 * Surface key form: `<flow>.<name>` for module-derived items, or bare
 * `<name>` for site-level items declared on the index. The agent (MCP /
 * WebMCP / sidebar) always sees the surface form; the registry rewrites
 * each item's `name` field to match at ingest time so callers iterating
 * `listTools()` see consistent identifiers without having to look up the
 * flow separately.
 */
function surfaceKey(flow: string | undefined, name: string): string {
  return flow ? `${flow}.${name}` : name;
}

export interface ToolEntry {
  flow?: string;
  baseUrl: string;
  /** Surface ToolSpec — `.name` is `<flow>.<rawName>` when scoped. */
  tool: ToolSpec;
}

export interface ResourceEntry {
  flow?: string;
  baseUrl: string;
  resource: ResourceSpec;
}

export class ActionRegistry {
  private toolsByKey = new Map<string, ToolEntry>();
  private resourcesByKey = new Map<string, ResourceEntry>();

  /**
   * Ingest the flat result of a (possibly multi-module) load. Throws on
   * cross-module duplicate surface names — that's the loader's contract
   * with the rest of the runtime. Index-level duplicates are caught
   * earlier by the spec parser; this guard catches the cross-file case.
   */
  ingest(result: LoadResult): void {
    for (const t of result.tools) {
      const key = surfaceKey(t.flow, t.tool.name);
      if (this.toolsByKey.has(key)) {
        throw new Error(`Duplicate tool surface name: ${key}`);
      }
      this.toolsByKey.set(key, toToolEntry(t, key));
    }
    for (const r of result.resources) {
      const key = surfaceKey(r.flow, r.resource.name);
      if (this.resourcesByKey.has(key)) {
        throw new Error(`Duplicate resource surface name: ${key}`);
      }
      this.resourcesByKey.set(key, toResourceEntry(r, key));
    }
  }

  /**
   * Legacy shim — accepts a single parsed `CompanionSpec` (v0.1 shape) and
   * registers it as if it were a single-frame load. Used by older callers
   * that haven't migrated to `ingest()` yet; the in-tree runtime now goes
   * through `ingest` directly.
   */
  register(spec: { tools?: ToolSpec[]; resources?: ResourceSpec[] }): void {
    for (const tool of spec.tools ?? []) {
      const key = tool.name;
      if (this.toolsByKey.has(key)) {
        throw new Error(`Duplicate tool name: ${key}`);
      }
      this.toolsByKey.set(key, { baseUrl: '', tool: { ...tool } });
    }
    for (const resource of spec.resources ?? []) {
      const key = resource.name;
      if (this.resourcesByKey.has(key)) {
        throw new Error(`Duplicate resource name: ${key}`);
      }
      this.resourcesByKey.set(key, { baseUrl: '', resource: { ...resource } });
    }
  }

  getTool(name: string): ToolSpec | undefined {
    return this.toolsByKey.get(name)?.tool;
  }

  getResource(name: string): ResourceSpec | undefined {
    return this.resourcesByKey.get(name)?.resource;
  }

  listTools(): ToolSpec[] {
    return [...this.toolsByKey.values()].map((e) => e.tool);
  }

  listResources(): ResourceSpec[] {
    return [...this.resourcesByKey.values()].map((e) => e.resource);
  }

  /**
   * Same as `listTools()` but keeps the flow + baseUrl provenance. v0.4
   * meta-tool layers (P5) and server-side filter (P4) consume this form.
   */
  listToolEntries(): ToolEntry[] {
    return [...this.toolsByKey.values()];
  }

  listResourceEntries(): ResourceEntry[] {
    return [...this.resourcesByKey.values()];
  }

  clear(): void {
    this.toolsByKey.clear();
    this.resourcesByKey.clear();
  }
}

function toToolEntry(t: ResolvedTool, surfaceName: string): ToolEntry {
  return {
    ...(t.flow !== undefined ? { flow: t.flow } : {}),
    baseUrl: t.baseUrl,
    tool: { ...t.tool, name: surfaceName },
  };
}

function toResourceEntry(
  r: ResolvedResource,
  surfaceName: string,
): ResourceEntry {
  return {
    ...(r.flow !== undefined ? { flow: r.flow } : {}),
    baseUrl: r.baseUrl,
    resource: { ...r.resource, name: surfaceName },
  };
}
