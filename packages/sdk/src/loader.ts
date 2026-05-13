import {
  parseCompanionSpec,
  type CompanionSpec,
  type ResourceSpec,
  type ToolSpec,
  type WhereSpec,
} from '@web-companion/spec';

export const DEFAULT_SPEC_PATH = '/.well-known/companion.json';

/**
 * One tool/resource that has been pulled out of its source file. The
 * `flow` field is undefined for items declared directly in the index
 * `companion.json`; it's the module's `name` for items pulled in via
 * `modules[]` (v0.2 only). `where` on the inner spec is the per-field
 * merge of the source file's per-item where and the module's
 * per-module where.
 */
export interface ResolvedTool {
  flow?: string;
  baseUrl: string;
  tool: ToolSpec;
}

export interface ResolvedResource {
  flow?: string;
  baseUrl: string;
  resource: ResourceSpec;
}

/**
 * Trace of every module ref the loader walked. `loaded === false` for
 * modules whose fetch/parse failed AND whose error was swallowed by
 * `onModuleError`; the rest of the catalog is still populated, so
 * partial catalogs survive transient module breakage.
 */
export interface ResolvedModule {
  name: string;
  url: string;
  description?: string;
  where?: WhereSpec;
  loaded: boolean;
}

export interface LoadResult {
  rootUrl: string;
  tools: ResolvedTool[];
  resources: ResolvedResource[];
  modules: ResolvedModule[];
}

export interface ModuleErrorInfo {
  moduleName: string;
  url: string;
  error: unknown;
}

export interface LoaderOptions {
  fetchImpl?: typeof fetch;
  /**
   * Called when a module fails to fetch or parse. By default, errors
   * are re-thrown (fail-fast). Provide a callback to log/silence and
   * keep the rest of the catalog usable.
   */
  onModuleError?: (info: ModuleErrorInfo) => void;
}

interface Frame {
  url: string;
  parentWhere: WhereSpec | undefined;
  /** Set for module-derived frames; undefined for the root index. */
  flowName: string | undefined;
  /** Back-pointer for module frames so we can mark them failed. */
  moduleEntry: ResolvedModule | undefined;
}

/**
 * Recursively loads a companion spec, following `modules[]` refs in v0.2
 * documents. Detects cycles via the visited URL set and per-field merges
 * per-module `where` into each contained capability. Module-level
 * fetch/parse failures are surfaced via `onModuleError` (default = throw).
 */
export async function loadCompanionSpec(
  url: string = DEFAULT_SPEC_PATH,
  options: LoaderOptions = {},
): Promise<LoadResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const rootUrl = toAbsoluteUrl(url);

  const tools: ResolvedTool[] = [];
  const resources: ResolvedResource[] = [];
  const moduleEntries: ResolvedModule[] = [];
  const visited = new Set<string>();

  const queue: Frame[] = [
    { url: rootUrl, parentWhere: undefined, flowName: undefined, moduleEntry: undefined },
  ];

  while (queue.length > 0) {
    const frame = queue.shift()!;
    const isRoot = frame.flowName === undefined;

    if (visited.has(frame.url)) {
      const err = new Error(`spec module cycle: ${frame.url}`);
      if (!isRoot && options.onModuleError) {
        frame.moduleEntry!.loaded = false;
        options.onModuleError({
          moduleName: frame.flowName!,
          url: frame.url,
          error: err,
        });
        continue;
      }
      throw err;
    }
    visited.add(frame.url);

    let spec: CompanionSpec;
    try {
      const res = await fetchImpl(frame.url);
      if (!res.ok) {
        throw new Error(
          `Failed to load companion spec from ${frame.url}: HTTP ${res.status}`,
        );
      }
      const json: unknown = await res.json();
      spec = parseCompanionSpec(json);
      if (!isRoot && 'modules' in spec && (spec.modules?.length ?? 0) > 0) {
        throw new Error(
          `module '${frame.flowName}' declares nested modules; v0.2 forbids modules inside modules (one level deep).`,
        );
      }
    } catch (err) {
      if (!isRoot && options.onModuleError) {
        frame.moduleEntry!.loaded = false;
        options.onModuleError({
          moduleName: frame.flowName!,
          url: frame.url,
          error: err,
        });
        continue;
      }
      throw err;
    }

    for (const tool of spec.tools ?? []) {
      const merged = mergeWhere(frame.parentWhere, tool.where);
      tools.push({
        ...(frame.flowName !== undefined ? { flow: frame.flowName } : {}),
        baseUrl: frame.url,
        tool: merged !== undefined ? { ...tool, where: merged } : tool,
      });
    }
    for (const resource of spec.resources ?? []) {
      const merged = mergeWhere(frame.parentWhere, resource.where);
      resources.push({
        ...(frame.flowName !== undefined ? { flow: frame.flowName } : {}),
        baseUrl: frame.url,
        resource:
          merged !== undefined ? { ...resource, where: merged } : resource,
      });
    }

    // Only the index (v0.2) carries modules. Nested-module rejection happened above.
    if ('modules' in spec) {
      for (const mod of spec.modules ?? []) {
        const absUrl = new URL(mod.url, frame.url).href;
        const entry: ResolvedModule = {
          name: mod.name,
          url: absUrl,
          loaded: true,
          ...(mod.description !== undefined && { description: mod.description }),
          ...(mod.where !== undefined && { where: mod.where }),
        };
        moduleEntries.push(entry);
        queue.push({
          url: absUrl,
          parentWhere: mergeWhere(frame.parentWhere, mod.where),
          flowName: mod.name,
          moduleEntry: entry,
        });
      }
    }
  }

  return { rootUrl, tools, resources, modules: moduleEntries };
}

/**
 * Per-field merge of two WhereSpecs. Child values win when both define the
 * same field; missing fields fall back to the parent. Per design doc:
 * each WhereSpec field is independently evaluated as AND in the filter, so
 * a parent providing `url` and a child providing `marker` produces a more
 * specific child capability that must satisfy both.
 */
function mergeWhere(
  parent: WhereSpec | undefined,
  child: WhereSpec | undefined,
): WhereSpec | undefined {
  if (!parent) return child;
  if (!child) return parent;
  const url = child.url ?? parent.url;
  const marker = child.marker ?? parent.marker;
  if (url === undefined && marker === undefined) return undefined;
  return {
    ...(url !== undefined && { url }),
    ...(marker !== undefined && { marker }),
  } as WhereSpec;
}

function toAbsoluteUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  if (typeof location !== 'undefined') {
    return new URL(url, location.href).toString();
  }
  return url;
}
