# Annotator Playbook

> Audience: an AI coding agent (Claude Code, Cursor, Claw, etc.) that's
> being asked to make an existing web app **AI-operable** via
> [web-companion][repo]. The agent runs as the user's pair-programmer
> and edits source directly; this playbook tells it how.
>
> This document is intentionally framework-agnostic and assumes no
> existing tooling. There's a Claude Code skill at
> `.claude/skills/web-companion-annotate/SKILL.md` that wraps these
> steps into a `/web-companion-annotate <path>` invocation — read this
> file regardless, the skill is just a thin wrapper.

## What "annotating" means here

web-companion lets an external agent (`claude code`, a SaaS backend's
LLM, etc.) drive a website **through the same UI a human would use**:
the cursor flies to a button, real `MouseEvent('click')` fires, the
page's own `onClick` handles it. No parallel data path, no business
code rewrite.

The contract the agent needs is a JSON document at
`/.well-known/companion.json` describing:

- **tools** — UI action sequences (`click` / `fill` / `select` /
  `check` / `wait_for`) on CSS-selectable elements
- **resources** — DOM-extraction rules that pull structured data
  without running JS

For the runtime to find each element reliably, the app's HTML needs
**stable selectors**. Where existing selectors aren't stable, the
annotator's job is to **add `data-ai-*` attributes** — markup-only,
no behavior change — and reference them from `companion.json`.

That's the whole gig. You're a librarian for the page, not a
refactorer.

## Safety properties — the four hard rules

These are non-negotiable. They're how an "untrusted AI annotator"
stays trustworthy. If you break one, the annotation is rejected.

1. **No business logic in the spec.** A `companion.json` only points
   at DOM elements. It never references a JS function, never imports
   a module, never embeds executable code.
2. **Selectors are plain CSS.** Use what's on the element today
   (`aria-*`, `role`, classes, text content) when stable. When not,
   **add a `data-ai-*` attribute** as an anchor — DO NOT rewrite
   selectors that the app's CSS or framework relies on.
3. **Steps are five known kinds.** `click` / `fill` / `select` /
   `check` / `wait_for`. If a flow can't be expressed with these,
   leave it out — don't invent step types.
4. **No `onClick` rewrites, no state-management changes.** The
   spec invokes existing event handlers. If a button has no handler,
   it's not a candidate — flag it, don't fabricate a handler.

If you find yourself reaching for "I'll just edit this reducer real
quick", stop. That's outside scope. Surface the limitation to the
user instead.

## End goal — the v0.2 spec shape

A real-world app's `companion.json` is split across **modules** so the
catalog stays maintainable and the agent's per-page tool list stays
small. For projects with > ~5 flows, always split.

```
public/.well-known/
├── companion.json                 # index — only modules + (rare) site-level tools
└── companion/
    ├── cart.json                  # one module per flow
    ├── search.json
    ├── account.json
    └── support.json
```

`companion.json` (the index):

```jsonc
{
  "version": "0.2",
  "modules": [
    { "name": "cart",
      "url": "./companion/cart.json",
      "where": { "marker": "[data-ai-view='cart']" } },
    { "name": "search",
      "url": "./companion/search.json",
      "where": { "marker": "[data-ai-view='search']" } }
  ]
}
```

Each module:

```jsonc
{
  "version": "0.2",
  "tools": [
    { "name": "add_to_cart", "description": "...",
      "params": { "type": "object",
                  "properties": { "id": { "type": "string", "enum": [...] } },
                  "required": ["id"] },
      "steps": [ { "type": "click",
                   "target": "[data-ai-tool='add-cart-{id}']" } ] }
  ],
  "resources": [
    { "name": "cart", "description": "...",
      "schema": { "type": "array", "items": { ... } },
      "extract": { "type": "list",
                   "selector": "[data-ai='cart-item']",
                   "fields": { "id": { "from": "attr", "attr": "data-id" },
                               "name": { "from": "text",
                                         "selector": "[data-ai='item-name']" } } } }
  ]
}
```

Tool/resource names inside a module are RAW (`add_to_cart`,
not `cart.add_to_cart`). The SDK loader applies the `<flow>.` prefix
at runtime; you write the file's `name` field bare.

Full TS reference: see top-level `README.md` Spec reference section,
or [`docs/v0.4-spec-at-scale.md`][design] for the wire / loader
details.

## Recommended pass over a project

### Step 1 — discover the routes and views

Find where the app declares its top-level navigation. Typical signals:

- React: `react-router-dom`, `@tanstack/router`, Next.js `app/` /
  `pages/`
- Vue: `vue-router`
- Svelte: `+page.svelte` files
- Vanilla / SPA: a `switch` over `location.hash` or `location.pathname`

Each route = a candidate **flow**. If two routes share most tools
(e.g. `/cart/edit` and `/cart/review`), consider one flow named
`cart` with `where: { url: "**/cart**" }`.

**Output of this step:** a list of `{flowName, urlGlob?, marker?}`
tuples. Get user buy-in on the names before going further — flow
names are user-visible in the agent UX.

### Step 2 — for each flow, list interactive elements

Inside each view's source file, find:

- `<button>` / `<a>` / `<input type='submit'>` / `<form>` `onSubmit`
- Custom button components (`<Button>`, `<IconButton>`, `<Pressable>`,
  etc.) — recurse into them if needed to confirm they render a real
  `<button>`
- `<input>` / `<select>` / `<textarea>` with `onChange` handlers
- Things that look interactive but use synthesized handlers (e.g. a
  `<div onClick={...}>`) — flag these as "low-confidence" candidates

For each, gather:

- **What event does it fire?** (`click`, `change`, `submit`)
- **What state does it mutate?** (so the description can be useful)
- **Is the selector stable today?** If the element already has a
  unique `aria-label`, `role`, or `id`, use that. If not, plan to
  add `data-ai-tool="<verb>-<noun>"` (e.g. `data-ai-tool="add-cart-mocha"`).

### Step 3 — for each flow, list extractable data

Walk the same files looking for **read-only data the agent might want
to see**:

- Lists rendered via `.map()` — usually become a `type: 'list'`
  extract.
- Single values that come from state (cart total, user profile, etc.)
  — usually `type: 'single'`.

For each, decide:

- **Container selector** — a stable anchor for the whole list/object.
  Often needs a `data-ai="..."` marker.
- **Field selectors** — usually relative to the item element, often
  needing per-field markers (`data-ai="item-name"` /
  `data-ai="item-price"`).

### Step 4 — split into modules

For each flow:

- Module file: `public/.well-known/companion/<flowName>.json`
- Index: register the module + its `where:` (marker form preferred
  for SPAs; URL form preferred for SSR / multi-page)
- Site-level tools (`nav.home`, etc.) — only if they're truly
  available on every page. If they're only on some, give them their
  own module with `where`.

### Step 5 — apply marker additions to source

This is the only step that **mutates source code**. The mutations are
markup-only — no logic change:

- Add `data-ai-view="<flowName>"` to the view's wrapper element.
- Add `data-ai-tool="..."` to each interactive element a tool
  references.
- Add `data-ai="..."` to each container / field referenced by a
  resource extract.

Do NOT:

- Refactor JSX structure.
- Move `onClick` into a different handler.
- Replace `aria-*` attributes — add new `data-ai-*` alongside them.
- Wrap elements in new components.

### Step 6 — write the JSON files

Write the index + each module file under
`public/.well-known/companion/`. The index uses
`version: "0.2"` and `modules: [...]`. Each module uses
`version: "0.2"` with `tools: [...]` and/or `resources: [...]` (no
nested `modules`).

### Step 7 — verify

If `@web-companion/spec` is installed in the project,
`pnpm --filter @web-companion/spec smoke` validates the schema.

If not, hand the index + first module to the user and ask them to:

1. Open the page in a browser
2. Open devtools and check `document.querySelector('[data-ai-tool=...]')`
   returns a non-null for each tool's `target`
3. If web-companion has the SDK runtime mounted, the bundled sidebar
   (or a remote agent) can dispatch a test invocation

Don't claim "done" until the user confirms the page-level smoke. The
spec is the contract; the DOM is the ground truth.

## Worked example — the bundled coffee-shop

The repo's [`examples/coffee-shop`][demo] is a real worked example of
all the above. To see what an annotated v0.2 spec looks like:

- `examples/coffee-shop/public/.well-known/companion.json` — index
  with 5 modules (cart / search / account / support / admin)
- `examples/coffee-shop/public/.well-known/companion/cart.json` — the
  flow with 3 tools + 1 resource (add_to_cart, remove_from_cart,
  checkout, cart-list extract)
- `examples/coffee-shop/public/.well-known/companion/admin.json` —
  v0.5 auth-aware flow (delete_user, refund_order) hoisted to module
  scope via `where.roles: ['admin']` — see *Auth-aware tools* below
- `examples/coffee-shop/src/App.tsx` — the source with all the
  `data-ai-*` markers added inline plus the v0.5 `<body
  data-wc-user-roles>` plumbing

When unsure how to structure a new flow, search the coffee-shop demo
for an analogous one (a list + tools-on-items pattern matches
`cart`; a form + async result matches `search`; a role-gated panel
matches `admin`).

## Auth-aware tools (v0.5)

By default a tool's `where:` only filters by *page* (url + marker).
v0.5 adds an optional `roles:` field so the catalog the agent sees
also narrows by *who's logged in*. Use this when the same page legitimately
shows different actions to different users — admin vs staff vs customer
vs anonymous.

> **Safety check first.** This filter is **ergonomics, not
> authorization.** The user-roles signal is page-supplied and untrusted.
> The server enforcing the actual tool action (the click handler, the
> fetch, the mutation) MUST still independently check RBAC — the filter
> only shapes what the agent's planner sees, it doesn't gate
> execution. See [`docs/v0.5-auth-aware-filter.md`][rfc] for the threat
> model. If you're tempted to "use `roles:` to keep admin tools out of
> a customer's reach", that's the *symptom*; the *cure* is the server
> still saying 403, no matter what the spec says.

### Pick the auth source

The SDK collects `userRoles` from the DOM via this four-level
fallback, first wins:

1. **Explicit override** — the integrator passes
   `attachWebSocket({ userRoles: [...] })` or
   `<Sidecar userRoles={...} />`. Use this for reactive frameworks
   that have a clean auth store (Redux/Zustand/Pinia). The function
   form is re-evaluated on every page-state diff.
2. **`<meta name="wc-user-roles" content="admin,staff">`** — emit
   server-side for SSR'd apps. Comma OR whitespace separated.
3. **`<body data-wc-user-roles="admin staff">`** — DOM attribute,
   same separator rules. Friendliest for apps that already mirror
   auth state to `<body class="role-admin">`-style class names.
4. **Empty** — anonymous user; any tool with `where.roles: [...]`
   becomes invisible.

For the coffee-shop demo we picked option 3 (`<body
data-wc-user-roles>`) wired through a `useEffect`:

```tsx
useEffect(() => {
  if (userRole === 'anonymous') {
    document.body.removeAttribute('data-wc-user-roles');
  } else {
    document.body.setAttribute('data-wc-user-roles', userRole);
  }
}, [userRole]);
```

The PageStateTracker's MutationObserver picks up the change, pushes
`page/changed` with the new `userRoles[]`, and the bridge / backend
re-runs `passesWhere` so the catalog narrows or widens in the same tick.

### Decide what to gate

Walk each module's tool list and ask "is there any user role for whom
this tool shouldn't even be visible?". Common patterns:

| Tool kind | Suggested `where.roles` |
| --- | --- |
| Destructive admin actions (delete_user, force_refund) | `['admin']` |
| Moderator tools (close_ticket, freeze_account) | `['staff', 'admin']` |
| Authenticated-only tools (place_order, save_profile) | every role except anonymous — e.g. `['customer', 'staff', 'admin']` |
| Public tools (search, view_menu) | omit `roles:` entirely |

If two roles share most tools, list them both. Don't try to express
"everyone except X" — split into two flows if you must (see *Common
anti-patterns* below for the rationale on negative match).

### Hoist common gates to the module ref

When a whole flow is role-gated, put `roles:` on the **`ModuleRef`**
in `companion.json` instead of repeating it on every tool. The loader's
`mergeWhere` propagates it down — child tools without their own `roles:`
inherit the parent's. Coffee-shop's `admin` module is the canonical
shape:

```jsonc
// public/.well-known/companion.json
{
  "version": "0.2",
  "modules": [
    {
      "name": "admin",
      "url": "./companion/admin.json",
      "where": {
        "marker": "[data-ai-view='admin']",
        "roles": ["admin"]
      }
    }
  ]
}
```

```jsonc
// public/.well-known/companion/admin.json
{
  "version": "0.2",
  "tools": [
    { "name": "delete_user", "description": "...",
      "steps": [{ "type": "click", "target": "[data-ai-tool='admin-delete-user']" }] }
  ]
}
```

The child tool inherits `where: { marker: '[data-ai-view=admin]', roles: ['admin'] }`
without re-declaring either. Child can still override either field
locally (child-wins merge) — useful when most of a module is
`['admin']` but one tool is `['admin', 'staff']`.

### Module-level marker vs roles — when to combine

If you set BOTH `marker` and `roles` on the module ref:

- `marker` ensures the flow's UI is actually mounted (DOM check).
- `roles` ensures the user has permission to see those actions
  (page-supplied identity).

Combining them is *fail-safer* than either alone. If a buggy page
renders the admin panel for a customer user, the agent still won't see
the tools because `roles` wouldn't pass — and conversely, if the
identity is forged but the page hasn't rendered the panel, the agent
still can't fire steps against missing DOM.

### Anti-patterns the annotator should refuse

- **Putting business secrets in `roles:`**. Roles are advertised in
  the spec JSON, which is publicly fetchable from `/.well-known/`.
  Don't name a role `admin-after-2024-q4-rollout` if that itself leaks
  info — name roles by stable job function.
- **Using `roles:` for tool-level RBAC**. The spec layer is not the
  authorization layer. If a tool calls `/api/admin/delete_user`, the
  server must re-check the auth on that endpoint regardless of what
  the spec says.
- **Synthesizing roles the page doesn't have**. Don't add `roles:
  ['user']` to every tool just to "be safe" — anonymous users (e.g.
  search) will lose access to legitimately-public tools.
- **Compound conditions (`roles AND plan AND seat-count`)**. The DSL
  only does role intersection. If your app needs richer gates, split
  the tool across flows or accept that the filter is best-effort.

### Update the worked example

Coffee-shop's `admin` flow demonstrates the full end-to-end:
`<body data-wc-user-roles>` plumbing, module-level `where: { marker,
roles }`, two role-gated tools, a `list` resource, plus a backend e2e
test (`mode-2-backend.spec.ts`) that toggles role and confirms
`tools/list` narrows/widens.

[rfc]: ./v0.5-auth-aware-filter.md

## Decision rubric — when in doubt, lean these ways

| Situation | Prefer |
| --- | --- |
| Selector picks unstable class (`.css-1abc23`) | Add `data-ai-tool="..."` |
| Two elements have identical selector | Add `data-ai-tool="..."` with the differentiator (e.g. `add-cart-{id}`) |
| Flow spans multiple routes | Use `where: { url: "**/<prefix>**" }`, one flow |
| Flow only appears in a modal | Add a `data-ai-view="..."` marker on the modal wrapper; use `where: { marker }` |
| `<button onClick={fn}>` where `fn` does N things | Single tool, write the description from the user's PoV ("place the order") |
| `<button onClick={() => navigate('/x')}>` | Skip — pure-nav buttons rarely belong in the tool catalog; they don't *do* anything other agents can't already do |
| Input value should be set by AI | `fill` step; remember React-controlled inputs need the native setter (the SDK handles that) |
| Async results need to mount before next step | `wait_for` step after the trigger |
| Tool only valid for some user roles | `where.roles: [...]` on the tool — or hoist to the `ModuleRef` if the whole flow is gated. See *Auth-aware tools* |

## Common anti-patterns to refuse

- **Compound tools.** "Add an item AND go to checkout" — split into
  two tools so the agent can compose.
- **Synthetic resources.** Don't manufacture an `extract:` to read
  data that lives in localStorage/IndexedDB; the spec is for **DOM**
  extraction. If the data isn't on screen, the user must surface it
  to the page first.
- **Selectors with prose.** `[data-ai='the second one']` is brittle;
  add an index-aware marker (`data-ai-tool="add-cart-{id}"`) instead.
- **Catch-all flow.** A `general` flow with 20 unrelated tools is
  worse than no flow split. Either further-split, or move them
  site-level.

## What you DON'T do

- Run the app to verify (you don't have a browser).
- Install dependencies.
- Configure CI.
- Write tests.
- Touch the SDK / bridge / backend packages.
- Bump the spec version beyond 0.2 — that's a wc-internals change.

If the user asks for any of the above, surface it as out-of-scope and
recommend a follow-up task.

## Output expected from a single pass

Bullet form, what you hand back to the user at the end:

1. The list of flows you identified + their where: predicates.
2. The diff that adds `data-ai-*` markers across source files (no
   logic touched).
3. The new files under `public/.well-known/companion/`.
4. A list of files you **didn't** annotate and why (e.g. "third-party
   `<RichEditor>` — selectors are unstable and we can't add markers
   without forking").
5. The page-level smoke checklist for the user to walk through.

---

[repo]: https://github.com/hoveychen/web-companion
[design]: ./v0.4-spec-at-scale.md
[demo]: ../examples/coffee-shop
