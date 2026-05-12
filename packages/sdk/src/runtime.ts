import type { ToolSpec, ResourceSpec } from '@web-companion/spec';
import { ActionRegistry } from './registry.js';
import { DEFAULT_SPEC_PATH, loadCompanionSpec } from './loader.js';
import { resolveHandler } from './handler-resolver.js';
import { waitForTarget, type ResolvedTarget } from './target-resolver.js';

export interface CompanionRuntimeOptions {
  specUrl?: string;
  fetchImpl?: typeof fetch;
  /** Called right before a tool's handler runs — gives the visible-cursor layer a chance to fly to the target. */
  onBeforeInvoke?: (event: BeforeInvokeEvent) => void | Promise<void>;
  /** Called after a tool resolves successfully. */
  onAfterInvoke?: (event: AfterInvokeEvent) => void;
  /** Called when a tool throws. */
  onInvokeError?: (event: InvokeErrorEvent) => void;
}

export interface BeforeInvokeEvent {
  tool: ToolSpec;
  params: unknown;
  target: ResolvedTarget | null;
}
export interface AfterInvokeEvent {
  tool: ToolSpec;
  params: unknown;
  result: unknown;
}
export interface InvokeErrorEvent {
  tool: ToolSpec;
  params: unknown;
  error: unknown;
}

export class CompanionRuntime {
  readonly registry = new ActionRegistry();
  private baseUrl: string | null = null;
  private readonly options: CompanionRuntimeOptions;

  constructor(options: CompanionRuntimeOptions = {}) {
    this.options = options;
  }

  async load(): Promise<void> {
    const { spec, url } = await loadCompanionSpec(
      this.options.specUrl ?? DEFAULT_SPEC_PATH,
      this.options.fetchImpl,
    );
    this.baseUrl = url;
    this.registry.register(spec);
  }

  listTools(): ToolSpec[] {
    return this.registry.listTools();
  }

  listResources(): ResourceSpec[] {
    return this.registry.listResources();
  }

  async invokeTool(name: string, params: unknown = {}): Promise<unknown> {
    const tool = this.registry.getTool(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    if (!this.baseUrl) throw new Error('Runtime not loaded — call load() first');

    const target = tool.target ? this.tryResolveTarget(tool.target, params) : null;

    try {
      await this.options.onBeforeInvoke?.({ tool, params, target });
      const handler = await resolveHandler(tool.handler, { baseUrl: this.baseUrl });
      const result = await handler(params);
      this.options.onAfterInvoke?.({ tool, params, result });
      return result;
    } catch (error) {
      this.options.onInvokeError?.({ tool, params, error });
      throw error;
    }
  }

  /** Expose selector interpolation for callers that want to preview where the cursor will fly. */
  interpolateSelector(template: string, params: unknown): string {
    return interpolateSelector(template, params);
  }

  async readResource(name: string): Promise<unknown> {
    const resource = this.registry.getResource(name);
    if (!resource) throw new Error(`Unknown resource: ${name}`);
    if (!this.baseUrl) throw new Error('Runtime not loaded — call load() first');
    const source = await resolveHandler(resource.source, { baseUrl: this.baseUrl });
    return source();
  }

  private tryResolveTarget(selector: string, params: unknown): ResolvedTarget | null {
    try {
      const resolved = interpolateSelector(selector, params);
      const el = document.querySelector(resolved);
      return el ? { element: el, rect: el.getBoundingClientRect() } : null;
    } catch {
      return null;
    }
  }

  async waitForTargetOf(
    toolName: string,
    params: unknown = {},
    timeoutMs?: number,
  ): Promise<ResolvedTarget> {
    const tool = this.registry.getTool(toolName);
    if (!tool?.target) throw new Error(`Tool ${toolName} has no target selector`);
    const resolved = interpolateSelector(tool.target, params);
    return waitForTarget(resolved, timeoutMs !== undefined ? { timeoutMs } : {});
  }
}

/**
 * Substitute `{paramName}` placeholders in a CSS selector with the matching
 * value from `params`. Returns the original placeholder unchanged when the
 * param is missing — letting `querySelector` fail naturally.
 */
function interpolateSelector(template: string, params: unknown): string {
  if (!params || typeof params !== 'object') return template;
  const dict = params as Record<string, unknown>;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = dict[key];
    if (v === undefined || v === null) return `{${key}}`;
    return escapeAttrValue(String(v));
  });
}

function escapeAttrValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
}
