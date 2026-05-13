# web-companion

A spec-first SDK that turns any website into something an AI agent can drive
**through the same UI a human would use** — the cursor flies, the button
gets clicked, the existing `onClick` runs. No parallel business code, no
fidelity gap.

The contract is a single JSON document at `/.well-known/companion.json`
that declares:

- **tools** — UI action sequences expressed as `click` / `fill` / `select` /
  `check` / `wait_for` steps
- **resources** — structured data the AI can read by extracting from the DOM

The runtime dispatches real DOM events against the user's actual elements.
`add_to_cart` calls the same button's `onClick` your user would press.

```
  ┌──────────────┐                ┌──────────────────────────────┐
  │  agent host  │   MCP / ws     │           web page           │
  │  (claude     │ ◀────────────▶ │  @web-companion/sdk          │
  │   code,      │                │  + visible cursor            │
  │   etc.)      │                │  + DSL executor              │
  └──────────────┘                └──────────────────────────────┘
                                       loads /.well-known/companion.json
                                       dispatches real DOM events
                                       runs the page's own onClick/onChange
```

---

## Two ways to plug an agent in

| Surface | Who's the agent? | Package | When to pick it |
| --- | --- | --- | --- |
| **Mode 1 — local desktop** | Whatever stdio MCP host you run locally (claude code, claw, etc.) | [`@web-companion/local-bridge`](packages/local-bridge) | Solo developer, single user, no infra |
| **Mode 2 — remote multi-user** | Your own backend agent, reachable over the network | [`@web-companion/sidecar`](packages/sidecar) | Production, multiple users, your own LLM service |
| _Bonus_ — **Browser-native via WebMCP** | Browser's `navigator.modelContext` agent | [`@web-companion/webmcp`](packages/webmcp) | Chrome 146+ Canary; experimental but zero infra |

Same `companion.json`, same DSL, same fidelity — only the transport differs.

---

## Quickstart A — Local desktop agent (Mode 1)

You have `claude code` (or any other stdio-MCP host) on your laptop and you
want it to drive *your* dev server.

```sh
# 1. on the page side: drop the sidecar into your React/Vue/vanilla app.
#    It mounts the runtime + cursor, and dials the local bridge over ws.
npm install @web-companion/sidecar
```

```tsx
import { Sidecar } from '@web-companion/sidecar/react';

export function App() {
  return (
    <>
      {/* your existing app */}
      <Sidecar backendUrl="ws://127.0.0.1:8765/ws" />
    </>
  );
}
```

```sh
# 2. on the desktop side: run the bridge. It speaks stdio MCP up to claude
#    code and ws down to the page. First connect from a new origin will
#    prompt you to allow / deny.
npm install -g @web-companion/local-bridge
web-companion-bridge start
```

```jsonc
// 3. tell claude code about the bridge (claude_desktop_config.json):
{
  "mcpServers": {
    "web-companion": {
      "command": "web-companion-bridge",
      "args": ["start"]
    }
  }
}
```

Now `claude code` sees tools like `<originSlug>--<sessionShort>:add_to_cart`
and calls them; the bridge forwards to the matching ws session; the cursor
flies, the button gets clicked. The bridge meta-tool
`companion_list_sessions` is your "which tab am I working with" lookup.

---

## Quickstart B — Remote multi-user agent (Mode 2)

You're shipping a SaaS where end-users get their own AI assistant running on
your servers. The page connects out to *your* backend; your backend hosts
the agent and pushes `tools/call` down.

The reference implementation in [`examples/reference-backend`](examples/reference-backend)
is intentionally agent-less — it shows the **routing skeleton** (HS256 JWT
identity → ws session lookup → MCP Streamable HTTP relay) without binding
you to a particular LLM. Drop your agent on top of `SessionRegistry.request()`.

```tsx
// page side — same Sidecar component, just a remote URL + per-user token.
import { Sidecar } from '@web-companion/sidecar/react';

<Sidecar
  backendUrl="wss://agent.yoursaas.com/ws"
  token={signedJwtForCurrentUser}
/>
```

```sh
# pull up the reference backend to see the wiring end-to-end
cd examples/reference-backend
pnpm dev                                # listens on 127.0.0.1:3001
pnpm sign-token alice                   # mint a HS256 JWT
```

Backend exposes:

- `ws://…/ws?token=<JWT>` — page sdk dials here
- `http://…/mcp` — desktop MCP client posts here with `Authorization: Bearer <JWT>`
- `http://…/health` — debug only

Tools surface to the MCP client as `<userId>:<toolName>`. Two browsers with
two different tokens get fully disjoint tool namespaces; cross-tenant
attempts are rejected with HTTP 403. See
[`examples/reference-backend/README.md`](examples/reference-backend/README.md)
for the file map, multi-user demo recipe, and `claude_desktop_config.json`
snippet.

---

## Quickstart C — Browser-native via WebMCP (experimental)

If your users are on Chrome 146+ Canary with `chrome://flags` → "WebMCP for
testing", the page can register its tools directly with the browser's
`navigator.modelContext`. The agent lives in the browser; no bridge, no
backend.

```tsx
import { CompanionRuntime, attachCursor } from '@web-companion/sdk';
import { registerCompanionWithWebMCP } from '@web-companion/webmcp';

const runtime = new CompanionRuntime(attachCursor({}, {}));
await runtime.load();

registerCompanionWithWebMCP(runtime, {
  onUnsupported: (info) => console.warn('WebMCP unavailable:', info.reason),
});
```

What happens when the browser-side agent calls `add_to_cart({id:'mocha'})`:
the adapter routes through `runtime.invokeTool`, cursor flies, real
`MouseEvent('click')` is dispatched, the button's existing `onClick` fires,
WebMCP returns `{ ok: true, stepCount: 1 }`. Resources surface as
`read_<name>` tools. Falls back silently in non-WebMCP browsers — safe to
call unconditionally.

---

## Write a tool

A tool is a sequence of UI steps. Every `target`, `value`, and field
selector can contain `{paramName}` placeholders interpolated from the
tool's `params` at invocation time.

### Single-step

```jsonc
{
  "name": "checkout",
  "description": "Place the order.",
  "steps": [
    { "type": "click", "target": "[data-ai-tool='checkout']" }
  ]
}
```

Cursor flies to the element, plays a click ripple, dispatches
`MouseEvent('click', { bubbles: true })`. Whatever onClick you have runs.

### Multi-step with a parameter and async wait

```jsonc
{
  "name": "search",
  "description": "Search the catalog.",
  "params": {
    "type": "object",
    "properties": { "query": { "type": "string" } },
    "required": ["query"]
  },
  "steps": [
    { "type": "fill",     "target": "[data-ai='search-input']", "value": "{query}" },
    { "type": "click",    "target": "[data-ai='search-submit']" },
    { "type": "wait_for", "target": "[data-ai='results']", "timeoutMs": 3000 }
  ]
}
```

`fill` uses the native React-compatible value setter so controlled inputs
sync; `wait_for` polls via `MutationObserver` so async results region is
waited on, not raced.

### Step semantics

| Step | Effect on the target element |
| --- | --- |
| `click` | `dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))` |
| `fill` | Native value setter + `InputEvent('input')` + `Event('change')` |
| `select` | `element.value = value` + `Event('change')` |
| `check` | Toggle `.checked` (or set from `step.checked`) + `Event('change')` |
| `wait_for` | Poll via `MutationObserver` until the selector matches, up to `timeoutMs` (default 3000) |

Non-`wait_for` steps default to a 1500ms wait for their target to appear;
no immediate fail on race conditions.

### `where:` — scope tools to specific pages

Multi-route apps can scope a tool to a URL pattern, a DOM marker, or both:

```jsonc
{
  "name": "checkout",
  "where": {
    "url":    "**/cart",                  // optional, glob over location.pathname+search+hash
    "marker": "[data-ai-view='cart']"     // optional, DOM marker for SPAs
  },
  "steps": [ /* ... */ ]
}
```

Both fields are AND'd; omit `where` for site-global tools. When the agent
invokes the tool from the wrong page, the runtime throws `WrongPageError`
with `{currentUrl, currentMarkers, expectedWhere}` so the agent can decide
whether to navigate first.

Beyond per-tool error handling, `where:` also drives **server-side
filtering** in v0.4 — see the next section.

---

## Write a resource

A resource is a pure DOM-extraction rule — no JavaScript runs, no parallel
data path.

```jsonc
{
  "name": "cart",
  "description": "Current cart contents.",
  "schema": { /* JSON Schema for the result */ },
  "extract": {
    "type": "list",
    "selector": "[data-ai='cart-item']",
    "fields": {
      "id":    { "from": "attr",  "attr": "data-id" },
      "name":  { "from": "text",  "selector": "[data-ai='item-name']" },
      "price": { "from": "text",  "selector": "[data-ai='item-price']" }
    }
  }
}
```

`type: 'single'` returns one object; `type: 'list'` returns one per matched
element. `from` options:

| from | What it reads |
| --- | --- |
| `text` | `element.textContent`, trimmed |
| `attr` | `element.getAttribute(attr)` — `attr` is required |
| `value` | `.value` of `<input>` / `<select>` / `<textarea>` |
| `checked` | `.checked` of a checkbox/radio |

`selector` on a field is optional — omit to read the source from the item
element itself.

---

## Spec at scale (v0.2)

A flat 5-tool catalog is fine for the coffee-shop demo. A real SaaS
dashboard with 100+ flows isn't — token bloat, name collisions, and an
agent that can't tell which tools are usable from the current page.

v0.4 introduces three mechanisms, all opt-in:

### 1. Modules — split the catalog across files

A v0.2 index `companion.json` can declare `modules` instead of (or
alongside) inline `tools` / `resources`:

```jsonc
{
  "version": "0.2",
  "modules": [
    {
      "name": "checkout",
      "url":  "./companion/checkout.json",
      "where": { "marker": "[data-ai-view='cart']" }
    },
    {
      "name": "search",
      "url":  "./companion/search.json",
      "where": { "marker": "[data-ai-view='search']" }
    }
  ]
}
```

Each module file is itself a `CompanionSpec` (v0.2, no nested modules).
The SDK loader fetches them in parallel after the index, AND-merging
each module's per-module `where:` into every tool/resource inside.

### 2. Namespacing — `flow.tool` for free

Tools declared inside a module get their flow name prefixed at the
runtime surface: a tool named `submit` inside the `checkout` module
becomes `checkout.submit`. The agent sees the namespaced form, but the
raw name in the JSON file stays unqualified.

`invokeTool('checkout.submit', input)` routes to the namespaced entry;
`invokeTool('submit', input)` resolves only to a site-level tool of
that exact name. Identifiers are validated against
`/^[A-Za-z][A-Za-z0-9_-]*$/` — the `.` is reserved.

### 3. Server-side filter + meta tools

Once a catalog is split by flow with `where:` clauses, both
[`@web-companion/local-bridge`](packages/local-bridge) and the
[reference-backend](examples/reference-backend) automatically:

- Pre-filter `tools/list` to only the entries whose `where:` matches
  the page's current state.
- Push `notifications/tools/list_changed` when the SDK's
  PageStateTracker reports a navigation or marker change.
- Accept `_meta: { "scope": "all" }` on `tools/list` as an opt-out for
  agents that want the full catalog.

Three new meta tools (`companion_pages` / `companion_flows` /
`companion_tools`) let the agent introspect:

| Meta tool | Returns |
| --- | --- |
| `companion_pages` | `{ currentUrl, matchedMarkers, currentFlows }` per session |
| `companion_flows` | `[{ name, description, toolCount, resourceCount, active }]` — every flow in the catalog with an `active` flag |
| `companion_tools` | `[{ name, description, params }]` — drill into a specific flow (optional `flow` arg) or the page-active set |

So the agent's natural first move on connect becomes: call
`companion_pages` → see "I'm on `/cart`, flow `cart` is active" → call
`companion_tools(flow='cart')` → see just the four cart tools instead
of all 87 in the site catalog.

---

## Adapting an existing app

The protocol is designed so an AI annotator — even one with limited
context — can read a page's source, identify interactive elements, and
emit a `companion.json` *without writing business code*. Four properties
make this safe:

1. **No business logic in the spec.** The annotator never references a JS
   function. It only points at DOM elements.
2. **Selectors are plain CSS.** Use whatever's already on the element
   (`aria-*`, `role`, classes, text content) or add a `data-ai-*`
   attribute as an anchor when existing markup is unstable.
3. **Step semantics are explicit.** Every step is one of five known kinds.
   No arbitrary code path.
4. **Fidelity is structural.** Real DOM events on actual elements;
   whatever the user's `onClick` does is what the agent triggers.

A typical pass over an existing React app:

1. Identify interactive elements you want to expose (buttons, inputs,
   dropdowns).
2. If their existing selectors aren't stable, add `data-ai-*` attributes —
   marker only, no logic change.
3. Identify data the AI should be able to read (cart list, product info).
   Add `data-ai-*` markers to the wrapper and field-bearing children.
4. Write `companion.json` referencing those markers.

No state-management changes. No `onClick` rewrites. The annotator is
annotating, not refactoring.

**Recommended path (v0.4): your existing AI coding agent is the
annotator.** Read [`docs/annotator-playbook.md`](docs/annotator-playbook.md)
— it's the framework-agnostic manual any agent (Claude Code, Cursor,
Claw, etc.) follows to do the four steps above. Claude Code users
can also load the bundled skill at
[`.claude/skills/web-companion-annotate/`](.claude/skills/web-companion-annotate)
and invoke `/web-companion-annotate <path>`.

For CI / batch annotations without an interactive agent,
[`@web-companion/annotator`](packages/annotator) is a Claude API-backed
CLI MVP that does steps 1–4 from a single `.tsx` file (suggestions
only, doesn't mutate source) — see its NOTE.md for when to pick which
route.

---

## Spec reference

```ts
type CompanionSpec = {
  version: '0.1' | '0.2';
  modules?: ModuleRef[];          // 0.2 only
  tools?: ToolSpec[];             // site-level (no flow)
  resources?: ResourceSpec[];     // site-level (no flow)
};

type ModuleRef = {
  name: string;                   // [A-Za-z][A-Za-z0-9_-]* — becomes the flow namespace
  url: string;                    // resolved relative to the parent spec
  description?: string;           // shown by `companion_flows`
  where?: WhereSpec;              // AND'd into every contained capability
};

type ToolSpec = {
  name: string;                   // identifier — no `.` (reserved for namespacing)
  description: string;
  params?: JsonSchema;
  where?: WhereSpec;
  steps: Step[];                  // at least one
};

type ResourceSpec = {
  name: string;
  description: string;
  schema: JsonSchema;             // shape of the returned data
  where?: WhereSpec;
  extract: ExtractConfig;
};

type WhereSpec = {
  url?: string;                   // glob over location.pathname+search+hash
  marker?: string;                // CSS selector; presence in DOM
};                                // at least one of url/marker required

type Step =
  | { type: 'click';    target: string }
  | { type: 'fill';     target: string; value: string }
  | { type: 'select';   target: string; value: string }
  | { type: 'check';    target: string; checked?: boolean }
  | { type: 'wait_for'; target: string; timeoutMs?: number };

type ExtractConfig =
  | { type: 'single'; selector: string; fields: Record<string, FieldExtract> }
  | { type: 'list';   selector: string; fields: Record<string, FieldExtract> };

type FieldExtract =
  | { from: 'text';    selector?: string }
  | { from: 'attr';    selector?: string; attr: string }
  | { from: 'value';   selector?: string }
  | { from: 'checked'; selector?: string };
```

A live `companion.schema.json` (draft 2019-09) is published from the spec
package at [`packages/spec/companion.schema.json`](packages/spec/companion.schema.json)
for editor autocomplete and external validators.

### Migrating from 0.1 → 0.2

The 0.2 schema is a strict superset of 0.1 — every existing 0.1 file
keeps parsing unchanged. Opt into the new shape at your own pace:

1. **Bump `version` to `'0.2'`.** Required to use the `modules` field.
2. **For each conceptual flow, move its tools/resources into
   `companion/<flowName>.json`.** Each module file is itself a v0.2
   `CompanionSpec` with `modules: []` (one level deep, enforced).
3. **Replace the moved entries in `companion.json` with a `modules`
   ref each:**
   ```jsonc
   "modules": [
     { "name": "checkout", "url": "./companion/checkout.json",
       "where": { "marker": "[data-ai-view='cart']" } }
   ]
   ```
4. **(Optional)** Add per-flow `where:` to the module ref — this is what
   activates the server-side filter. Without it, every module's tools
   stay site-wide.

The full reference design lives in
[`docs/v0.4-spec-at-scale.md`](docs/v0.4-spec-at-scale.md).

For backwards compatibility safeguards:

- A v0.1 file may **not** declare `modules` (rejected by the parser).
- Tool/resource/module identifiers (`[A-Za-z][A-Za-z0-9_-]*`) are
  enforced in both versions — `.` was de-facto unused, now reserved.
- `_meta: { scope: "all" }` on `tools/list` bypasses the v0.4 filter,
  so an agent that doesn't know about the filter still works.

---

## Packages

```
packages/
  spec/          @web-companion/spec          Zod schema (v0.1 + v0.2) + TS types + parser/validator + companion.schema.json
  sdk/           @web-companion/sdk           Runtime: registry, recursive-modules loader, dsl-executor, dom-extractor, cursor, where-check, ws-client, PageStateTracker, meta-tools helpers
  sidecar/       @web-companion/sidecar       Headless connector for mode 2 — React/Vue/Vanilla entries
  local-bridge/  @web-companion/local-bridge  Mode 1 — stdio MCP ↔ ws bridge; origin allowlist; navigation grace; server-side filter + meta tools
  webmcp/        @web-companion/webmcp        W3C WebMCP adapter — `navigator.modelContext.registerTool` from a CompanionSpec
  annotator/     @web-companion/annotator     LLM-backed source → spec+marker suggestions; Claude Opus 4.7
examples/
  coffee-shop/                                vite 6 + react 19 end-to-end demo (v0.2 spec, 4 modules, 11 tools / 5 resources). Three Playwright suites: default (8), mode-1 bridge (1), mode-2 backend (2).
  reference-backend/                          Skeleton remote agent backend for mode 2: ws + JWT + MCP Streamable HTTP + v0.4 filter / meta tools; agent-less by design.
  with-sidebar/                               Demo: in-page chat sidebar (the old @web-companion/react package, repositioned in v0.3 — see its NOTE.md).
```

Build chain: `spec → sdk → {sidecar, local-bridge, webmcp, annotator, with-sidebar}
→ examples/*`. After modifying any package, `pnpm -r build` before
exercising the demo.

---

## Status (v0.4)

| | |
| --- | --- |
| DSL with 5 step types + `where:` page-scope | ✅ |
| DOM extraction (single + list, 4 field types) | ✅ |
| Visible cursor with per-step animation (motion.dev) | ✅ |
| `companion.schema.json` for IDE autocomplete | ✅ |
| W3C WebMCP adapter (validated in Chrome 146 Canary) | ✅ |
| Mode 1 — `@web-companion/local-bridge` (stdio MCP, origin allowlist, navigation grace) | ✅ |
| Mode 2 — `@web-companion/sidecar` (React / Vue / Vanilla entries) | ✅ |
| Mode 2 — `examples/reference-backend` (ws + JWT + MCP Streamable HTTP, multi-user) | ✅ |
| LLM-backed annotator (`@web-companion/annotator`, Claude Opus 4.7) | ✅ |
| Annotator playbook + Claude Code skill (`docs/annotator-playbook.md` + `.claude/skills/web-companion-annotate`) | ✅ |
| v0.2 spec: modules + flow namespacing + `where:` cascade | ✅ |
| SDK `PageStateTracker` + `page/changed` wire push | ✅ |
| Server-side `where:` filter + `notifications/tools/list_changed` | ✅ |
| `companion_pages` / `companion_flows` / `companion_tools` meta tools | ✅ |
| Playwright e2e (default 8/8 + mode-1 bridge 1/1 + mode-2 backend 2/2) | ✅ |
| `@web-companion/sidecar` for Svelte / SolidJS | planned |

---

## Development

```sh
pnpm install
pnpm -r build
pnpm -r typecheck
pnpm --filter coffee-shop dev --host 127.0.0.1
pnpm --filter coffee-shop test:e2e

# explore the reference backend
cd examples/reference-backend
pnpm dev
pnpm sign-token alice
```

Drop a Playwright spec under `examples/coffee-shop/e2e/` if you're
touching the cursor or DSL executor.
