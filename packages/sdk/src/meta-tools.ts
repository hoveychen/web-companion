import type { ResourceSpec, ToolSpec } from '@web-companion/spec';
import { passesWhere, type CapturedPageState } from './where-check.js';

/**
 * Helpers behind the v0.4 `pages` / `flows` / `tools(flow?)` meta tools.
 * Pure functions over a (tools, resources, pageState) triple — the
 * local-bridge and reference-backend mcp-servers each pull their data
 * out of their own session store and hand it to these.
 */

export interface FlowSummary {
  name: string;
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
 * Surface name → flow name. `checkout.submit` → `checkout`. Site-level
 * (no `.`) → undefined.
 */
export function deriveFlow(surfaceName: string): string | undefined {
  const idx = surfaceName.indexOf(FLOW_SEPARATOR);
  return idx > 0 ? surfaceName.slice(0, idx) : undefined;
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
  const acc = new Map<
    string,
    { toolCount: number; resourceCount: number; description: string; active: boolean }
  >();
  for (const t of tools) {
    const f = deriveFlow(t.name);
    if (!f) continue;
    const entry =
      acc.get(f) ?? {
        toolCount: 0,
        resourceCount: 0,
        description: '',
        active: false,
      };
    entry.toolCount += 1;
    if (!entry.description && t.description) entry.description = t.description;
    if (passesWhere(t.where, pageState)) entry.active = true;
    acc.set(f, entry);
  }
  for (const r of resources) {
    const f = deriveFlow(r.name);
    if (!f) continue;
    const entry =
      acc.get(f) ?? {
        toolCount: 0,
        resourceCount: 0,
        description: '',
        active: false,
      };
    entry.resourceCount += 1;
    if (!entry.description && r.description) entry.description = r.description;
    if (passesWhere(r.where, pageState)) entry.active = true;
    acc.set(f, entry);
  }
  return [...acc.entries()]
    .map(([name, info]) => ({
      name,
      description: info.description,
      toolCount: info.toolCount,
      resourceCount: info.resourceCount,
      active: info.active,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * If `flow` is provided, returns every tool in that flow (irrespective of
 * pageState — the agent is exploring). If `flow` is undefined, returns
 * tools active under the current pageState (whatever the `tools/list`
 * default scope would surface, minus the namespacing wrapper).
 */
export function summarizeTools(
  tools: ToolSpec[],
  pageState: CapturedPageState,
  flow?: string | undefined,
): ToolDescriptor[] {
  const out: ToolDescriptor[] = [];
  for (const t of tools) {
    if (flow !== undefined) {
      if (deriveFlow(t.name) !== flow) continue;
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
