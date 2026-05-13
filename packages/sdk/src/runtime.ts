import type { ResourceSpec, ToolSpec } from '@web-companion/spec';
import { ActionRegistry } from './registry.js';
import {
  DEFAULT_SPEC_PATH,
  loadCompanionSpec,
  type LoadResult,
  type ModuleErrorInfo,
} from './loader.js';
import { executeSteps, type StepContext } from './dsl-executor.js';
import { extractData } from './dom-extractor.js';
import { checkWhere, WrongPageError } from './where-check.js';

export interface CompanionRuntimeOptions {
  specUrl?: string;
  fetchImpl?: typeof fetch;
  /**
   * Called when a v0.2 module ref fails to fetch / parse. Default behavior
   * (when omitted) is to throw and fail the whole `load()`. Provide a
   * callback (e.g. console.warn) to swallow per-module failures while
   * keeping the rest of the catalog usable.
   */
  onModuleError?: (info: ModuleErrorInfo) => void;
  /** Fired once per tool invocation, before any step executes. */
  onBeforeInvoke?: (event: BeforeInvokeEvent) => void | Promise<void>;
  /** Fired before each step — visible cursor hooks in here. */
  onBeforeStep?: (event: StepContext) => void | Promise<void>;
  /** Fired after each step. */
  onAfterStep?: (event: StepContext) => void;
  /** Fired once per tool invocation, after all steps succeed. */
  onAfterInvoke?: (event: AfterInvokeEvent) => void;
  /** Fired if any step throws. */
  onInvokeError?: (event: InvokeErrorEvent) => void;
}

export interface BeforeInvokeEvent {
  tool: ToolSpec;
  params: Record<string, unknown>;
}
export interface AfterInvokeEvent {
  tool: ToolSpec;
  params: Record<string, unknown>;
  stepCount: number;
}
export interface InvokeErrorEvent {
  tool: ToolSpec;
  params: Record<string, unknown>;
  error: unknown;
}

export interface ToolResult {
  ok: true;
  stepCount: number;
}

export class CompanionRuntime {
  readonly registry = new ActionRegistry();
  private baseUrl: string | null = null;
  private loadResult: LoadResult | null = null;
  private readonly options: CompanionRuntimeOptions;

  constructor(options: CompanionRuntimeOptions = {}) {
    this.options = options;
  }

  async load(): Promise<void> {
    const result = await loadCompanionSpec(
      this.options.specUrl ?? DEFAULT_SPEC_PATH,
      {
        ...(this.options.fetchImpl && { fetchImpl: this.options.fetchImpl }),
        ...(this.options.onModuleError && {
          onModuleError: this.options.onModuleError,
        }),
      },
    );
    this.baseUrl = result.rootUrl;
    this.loadResult = result;
    this.registry.ingest(result);
  }

  listTools(): ToolSpec[] {
    return this.registry.listTools();
  }

  listResources(): ResourceSpec[] {
    return this.registry.listResources();
  }

  async invokeTool(
    name: string,
    params: Record<string, unknown> = {},
  ): Promise<ToolResult> {
    const tool = this.registry.getTool(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);

    const whereCheck = checkWhere(tool.where);
    if (!whereCheck.ok) {
      const err = new WrongPageError(name, whereCheck);
      this.options.onInvokeError?.({ tool, params, error: err });
      throw err;
    }

    try {
      await this.options.onBeforeInvoke?.({ tool, params });
      await executeSteps(tool.steps, params, {
        ...(this.options.onBeforeStep && { onBeforeStep: this.options.onBeforeStep }),
        ...(this.options.onAfterStep && { onAfterStep: this.options.onAfterStep }),
      });
      const result: ToolResult = { ok: true, stepCount: tool.steps.length };
      this.options.onAfterInvoke?.({
        tool,
        params,
        stepCount: tool.steps.length,
      });
      return result;
    } catch (error) {
      this.options.onInvokeError?.({ tool, params, error });
      throw error;
    }
  }

  readResource(name: string): unknown {
    const resource = this.registry.getResource(name);
    if (!resource) throw new Error(`Unknown resource: ${name}`);
    const whereCheck = checkWhere(resource.where);
    if (!whereCheck.ok) {
      throw new WrongPageError(name, whereCheck);
    }
    return extractData(resource.extract);
  }

  /** Exposed so the base URL can be inspected (e.g. for diagnostics). */
  get loadedFrom(): string | null {
    return this.baseUrl;
  }

  /** Last load's flat resolution result (modules, partial failures). */
  get lastLoadResult(): LoadResult | null {
    return this.loadResult;
  }
}
