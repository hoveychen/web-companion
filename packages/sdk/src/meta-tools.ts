import type { ResourceSpec, ToolSpec } from '@web-companion/spec';
import { passesWhere, type CapturedPageState } from './where-check.js';

/**
 * Helpers behind the v0.4 `pages` / `flows` / `tools(flow?)` meta tools.
 * Pure functions over a (tools, resources, pageState) triple — the
 * local-bridge and reference-backend mcp-servers each pull their data
 * out of their own session store and hand it to these.
 */

export interface FlowSummary {
  /**
   * Dot-joined path from root. v0.4 single-level: `'cart'`. v0.6 nested:
   * `'ecommerce.checkout'` for a two-level flow. Tools surface as
   * `<name>.<toolName>`.
   */
  name: string;
  /**
   * v0.6: dot-joined path of this flow's parent module, if any. Undefined
   * for top-level flows. Useful for renderers that want to indent or group
   * by parent.
   */
  parent?: string;
  /** v0.6: nesting level. 1 = top-level flow, 2 = one nested level, etc. */
  depth: number;
  /** Aggregated description — first non-empty tool/resource description in the flow. */
  description: string;
  toolCount: number;
  resourceCount: number;
  /** True if at least one tool/resource in the flow passes the current pageState. */
  active: boolean;
}

export interface PagesSummary {
  currentUrl: string;
  matchedMarkers: string[];
  /**
   * v0.5: roles the page declared for the current user (empty when anonymous
   * or when the client's SDK is pre-v0.5). Surfaced so the agent can reason
   * about why a tool is or isn't in scope.
   */
  userRoles: string[];
  /** Flows whose tools/resources include at least one passing `where`. */
  currentFlows: string[];
}

export interface ToolDescriptor {
  name: string;
  description: string;
  params?: ToolSpec['params'];
}

const FLOW_SEPARATOR = '.';

/**
 * Surface name → flow path. v0.4 single-level: `cart.submit` → `'cart'`.
 * v0.6 nested: `ecommerce.checkout.submit` → `'ecommerce.checkout'` (full
 * path from root to the leaf containing module, *without* the trailing
 * tool / resource name). Site-level surface names (no `.`) → `undefined`.
 */
export function deriveFlow(surfaceName: string): string | undefined {
  const idx = surfaceName.lastIndexOf(FLOW_SEPARATOR);
  return idx > 0 ? surfaceName.slice(0, idx) : undefined;
}

/**
 * v0.6 helper: every ancestor flow path of a flow name. For
 * `'ecommerce.checkout'` → `['ecommerce', 'ecommerce.checkout']`. Used to
 * surface intermediate (transitive-only) flows in `summarizeFlows`.
 */
function ancestorFlowPaths(flow: string): string[] {
  const parts = flow.split(FLOW_SEPARATOR);
  const out: string[] = [];
  for (let i = 1; i <= parts.length; i++) {
    out.push(parts.slice(0, i).join(FLOW_SEPARATOR));
  }
  return out;
}

function flowParent(flow: string): string | undefined {
  const idx = flow.lastIndexOf(FLOW_SEPARATOR);
  return idx > 0 ? flow.slice(0, idx) : undefined;
}

function flowDepth(flow: string): number {
  return flow.split(FLOW_SEPARATOR).length;
}

export function summarizePages(
  tools: ToolSpec[],
  resources: ResourceSpec[],
  pageState: CapturedPageState,
): PagesSummary {
  const flows = new Set<string>();
  for (const t of tools) {
    if (!passesWhere(t.where, pageState)) continue;
    const f = deriveFlow(t.name);
    if (f) flows.add(f);
  }
  for (const r of resources) {
    if (!passesWhere(r.where, pageState)) continue;
    const f = deriveFlow(r.name);
    if (f) flows.add(f);
  }
  return {
    currentUrl: pageState.currentUrl,
    matchedMarkers: [...pageState.matchedMarkers].sort(),
    userRoles: [...(pageState.userRoles ?? [])].sort(),
    currentFlows: [...flows].sort(),
  };
}

export function summarizeFlows(
  tools: ToolSpec[],
  resources: ResourceSpec[],
  pageState: CapturedPageState,
): FlowSummary[] {
  // v0.6: a tool surfacing as 'ecommerce.checkout.submit' counts toward
  // both the 'ecommerce.checkout' flow (direct parent) AND surfaces
  // 'ecommerce' as an intermediate ancestor so renderers can build a
  // tree. `directTools` / `directResources` only count items declared
  // directly inside a given flow; ancestor entries get a 0 count but
  // still appear so depth+parent are queryable.
  const direct = new Map<
    string,
    { toolCount: number; resourceCount: number; description: string; active: boolean }
  >();
  const ancestors = new Set<string>();

  for (const t of tools) {
    const f = deriveFlow(t.name);
    if (!f) continue;
    for (const a of ancestorFlowPaths(f)) ancestors.add(a);
    const entry =
      direct.get(f) ?? {
        toolCount: 0,
        resourceCount: 0,
        description: '',
        active: false,
      };
    entry.toolCount += 1;
    if (!entry.description && t.description) entry.description = t.description;
    if (passesWhere(t.where, pageState)) entry.active = true;
    direct.set(f, entry);
  }
  for (const r of resources) {
    const f = deriveFlow(r.name);
    if (!f) continue;
    for (const a of ancestorFlowPaths(f)) ancestors.add(a);
    const entry =
      direct.get(f) ?? {
        toolCount: 0,
        resourceCount: 0,
        description: '',
        active: false,
      };
    entry.resourceCount += 1;
    if (!entry.description && r.description) entry.description = r.description;
    if (passesWhere(r.where, pageState)) entry.active = true;
    direct.set(f, entry);
  }

  // Emit every ancestor (which is a superset of `direct`'s keys); flows
  // with no direct tools/resources get toolCount=0 / resourceCount=0
  // but still surface so agents can render the hierarchy.
  return [...ancestors]
    .map((name) => {
      const info = direct.get(name);
      const parent = flowParent(name);
      return {
        name,
        ...(parent !== undefined ? { parent } : {}),
        depth: flowDepth(name),
        description: info?.description ?? '',
        toolCount: info?.toolCount ?? 0,
        resourceCount: info?.resourceCount ?? 0,
        active: info?.active ?? false,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * If `flow` is provided, returns every tool whose surface flow path
 * starts with that prefix — v0.4 exact-match (`'cart'` returns tools
 * with `deriveFlow === 'cart'`) AND v0.6 transitive descendants
 * (`'ecommerce'` returns tools at `ecommerce.checkout.submit`,
 * `ecommerce.cart.add`, etc.). pageState is ignored — the agent is
 * exploring.
 *
 * If `flow` is undefined, returns tools active under the current
 * pageState (whatever the `tools/list` default scope would surface).
 */
export function summarizeTools(
  tools: ToolSpec[],
  pageState: CapturedPageState,
  flow?: string | undefined,
): ToolDescriptor[] {
  const out: ToolDescriptor[] = [];
  for (const t of tools) {
    if (flow !== undefined) {
      const toolFlow = deriveFlow(t.name);
      if (toolFlow === undefined) continue;
      if (toolFlow !== flow && !toolFlow.startsWith(flow + FLOW_SEPARATOR)) {
        continue;
      }
    } else {
      if (!passesWhere(t.where, pageState)) continue;
    }
    out.push({
      name: t.name,
      description: t.description,
      ...(t.params ? { params: t.params } : {}),
    });
  }
  return out;
}
