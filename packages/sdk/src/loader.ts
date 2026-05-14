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
 * `companion.json`; otherwise it's the dot-joined path of every
 * containing module from root to leaf (e.g. `'cart'` for v0.4-style
 * single-level nesting; `'ecommerce.checkout'` for v0.6 nested
 * modules). `where` is the per-field merge of every ancestor's
 * `where` with the item's own.
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

/**
 * Default cap for `LoaderOptions.maxDepth`. 1 = v0.4 single-level
 * (`flow.tool`), 3 = v0.6 typical multi-tier (`domain.flow.subflow.tool`).
 * Deeper trees are uncommon enough that the cap doubles as an
 * accidental-recursion guard; override only when you really need it.
 */
export const DEFAULT_MAX_DEPTH = 3;

export interface LoaderOptions {
  fetchImpl?: typeof fetch;
  /**
   * Called when a module fails to fetch, parse, or — v0.6 — sits past
   * `maxDepth`. By default, errors are re-thrown (fail-fast). Provide
   * a callback to log/silence and keep the rest of the catalog usable.
   */
  onModuleError?: (info: ModuleErrorInfo) => void;
  /**
   * v0.6: max nesting levels allowed when following `modules[]` refs
   * recursively. The root file is level 0; one level of children is
   * depth 1; etc. Defaults to {@link DEFAULT_MAX_DEPTH}. Setting
   * `maxDepth: 1` recreates the v0.4 single-level behavior. Setting
   * `maxDepth: 0` disables nested modules entirely (only inline
   * tools/resources are loaded).
   */
  maxDepth?: number;
}

interface Frame {
  url: string;
  parentWhere: WhereSpec | undefined;
  /**
   * Dot-joined path from the root index to this frame, e.g. `[]` for
   * the root, `['cart']` for a v0.4-style child, `['ecommerce',
   * 'checkout']` for a v0.6 grand-child. The leaf surface name is
   * `[...parentFlowPath, item.name].join('.')`.
   */
  parentFlowPath: string[];
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
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const rootUrl = toAbsoluteUrl(url);

  const tools: ResolvedTool[] = [];
  const resources: ResolvedResource[] = [];
  const moduleEntries: ResolvedModule[] = [];
  const visited = new Set<string>();

  const queue: Frame[] = [
    {
      url: rootUrl,
      parentWhere: undefined,
      parentFlowPath: [],
      moduleEntry: undefined,
    },
  ];

  while (queue.length > 0) {
    const frame = queue.shift()!;
    const isRoot = frame.parentFlowPath.length === 0;
    // The current frame's flow surface (dot-joined) — undefined at the
    // root, otherwise the full path from root down to and including
    // this frame's module name. Used for ResolvedTool.flow / ResolvedResource.flow.
    const currentFlow = isRoot ? undefined : frame.parentFlowPath.join('.');
    // Leaf module name = the segment this frame contributes. Only used
    // for error reporting; undefined at root.
    const leafModuleName = isRoot
      ? undefined
      : frame.parentFlowPath[frame.parentFlowPath.length - 1];

    if (visited.has(frame.url)) {
      const err = new Error(`spec module cycle: ${frame.url}`);
      if (!isRoot && options.onModuleError) {
        frame.moduleEntry!.loaded = false;
        options.onModuleError({
          moduleName: leafModuleName!,
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
    } catch (err) {
      if (!isRoot && options.onModuleError) {
        frame.moduleEntry!.loaded = false;
        options.onModuleError({
          moduleName: leafModuleName!,
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
        ...(currentFlow !== undefined ? { flow: currentFlow } : {}),
        baseUrl: frame.url,
        tool: merged !== undefined ? { ...tool, where: merged } : tool,
      });
    }
    for (const resource of spec.resources ?? []) {
      const merged = mergeWhere(frame.parentWhere, resource.where);
      resources.push({
        ...(currentFlow !== undefined ? { flow: currentFlow } : {}),
        baseUrl: frame.url,
        resource:
          merged !== undefined ? { ...resource, where: merged } : resource,
      });
    }

    // v0.6: any frame (root or nested) may declare `modules`. Past
    // `maxDepth` we surface a depth-exceeded error via onModuleError
    // and skip — partial catalog preserved, no silent over-recursion.
    if ('modules' in spec) {
      for (const mod of spec.modules ?? []) {
        const absUrl = new URL(mod.url, frame.url).href;
        const childPath = [...frame.parentFlowPath, mod.name];
        const entry: ResolvedModule = {
          name: mod.name,
          url: absUrl,
          loaded: true,
          ...(mod.description !== undefined && { description: mod.description }),
          ...(mod.where !== undefined && { where: mod.where }),
        };
        moduleEntries.push(entry);

        if (childPath.length > maxDepth) {
          entry.loaded = false;
          const err = new Error(
            `module '${childPath.join('.')}' exceeds loader maxDepth=${maxDepth}; raise LoaderOptions.maxDepth to follow deeper trees.`,
          );
          if (options.onModuleError) {
            options.onModuleError({
              moduleName: mod.name,
              url: absUrl,
              error: err,
            });
            continue;
          }
          throw err;
        }

        queue.push({
          url: absUrl,
          parentWhere: mergeWhere(frame.parentWhere, mod.where),
          parentFlowPath: childPath,
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
export function mergeWhere(
  parent: WhereSpec | undefined,
  child: WhereSpec | undefined,
): WhereSpec | undefined {
  if (!parent) return child;
  if (!child) return parent;
  const url = child.url ?? parent.url;
  const marker = child.marker ?? parent.marker;
  const roles = child.roles ?? parent.roles;
  if (url === undefined && marker === undefined && roles === undefined) {
    return undefined;
  }
  return {
    ...(url !== undefined && { url }),
    ...(marker !== undefined && { marker }),
    ...(roles !== undefined && { roles }),
  } as WhereSpec;
}

function toAbsoluteUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  if (typeof location !== 'undefined') {
    return new URL(url, location.href).toString();
  }
  return url;
}
