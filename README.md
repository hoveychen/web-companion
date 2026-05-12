# web-companion

Turn a website into an AI-operable surface, declaratively. One JSON document at `/.well-known/companion.json` declares the page's tools (actions) and resources (readable data); the SDK gives you an in-page sidebar with a visible cursor that flies to whichever element it's about to click.

This is the **v0 monorepo** — in-page sidebar + visible cursor + Anthropic-driven decisions are working end-to-end. MCP-server and CLI surfaces are designed for but not yet implemented (see Status below).

## Why

Three properties that no single existing library gives you:

1. **100% precision via declaration.** No DOM-scraping or vision inference — the developer states what's clickable and what's readable in a manifest. The AI calls those by name.
2. **Visible cursor as a first-class UX.** Traditional users need to see what the AI is doing. The cursor literally flies across the page to the button before it's pressed.
3. **One declaration, three exposure modes.** Same `companion.json` can drive (a) the in-page sidebar, (b) an MCP server for external agents, (c) a CLI — all without rewriting business logic.

## Quick start

```sh
pnpm install
pnpm -r build
pnpm --filter coffee-shop dev --host 127.0.0.1
# open http://127.0.0.1:5173
```

Try saying things like:

- `add_to_cart mocha` — cursor flies to the 摩卡 card's "加入购物车" button, then adds it.
- `cart` — reads the cart resource and renders the JSON in the sidebar.
- `checkout` — cursor flies to the bottom-right "结账" button and clears the cart.

To upgrade the decision-maker from the keyword-stub to Claude (Opus 4.7):

```sh
cp examples/coffee-shop/.env.example examples/coffee-shop/.env
# fill in VITE_ANTHROPIC_API_KEY
```

After restart, natural-language prompts like "加一份摩卡" / "看看购物车" / "结账" work because Claude interprets the intent and picks the right tool.

## The spec

A page declares its AI-operable surface as a single JSON document, traditionally served at `/.well-known/companion.json`:

```jsonc
{
  "version": "0.1",
  "tools": [
    {
      "name": "add_to_cart",
      "description": "把一杯咖啡加入购物车。",
      "params": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "enum": ["latte", "mocha", "americano", "cappuccino"]
          }
        },
        "required": ["id"]
      },
      "target": "[data-ai-tool='add-cart-{id}']",
      "handler": "/actions/companion.js#addToCart"
    }
  ],
  "resources": [
    {
      "name": "cart",
      "description": "当前购物车里的所有商品。",
      "schema": { "type": "array", "items": { /* ... */ } },
      "source": "/actions/companion.js#getCart"
    }
  ]
}
```

Three rules:

- **`target`** is a CSS selector — the visible cursor flies to whatever matches. `{paramName}` placeholders are interpolated from the tool's params at invocation time.
- **`handler` / `source`** is a `path/to/file.js#exportedFn` reference. The SDK dynamically imports it and calls the named export. Path is resolved against the spec document's URL.
- **Tools mutate, resources read.** They're the same shape as MCP's `tools` and `resources`, so a future MCP-server surface (P9 / v0.2) drops in.

## Packages

| Package | Purpose |
|---|---|
| [`@web-companion/spec`](packages/spec) | Zod schema + TS types + `parseCompanionSpec` / `safeParseCompanionSpec` / `parseHandlerRef`. No runtime side effects — single source of truth for the wire format. |
| [`@web-companion/sdk`](packages/sdk) | Runtime: `ActionRegistry`, spec loader, dynamic-import handler resolver, target resolver (`querySelector` + `waitForTarget`), and the `CompanionRuntime` orchestration layer with `onBeforeInvoke` / `onAfterInvoke` / `onInvokeError` hooks. Also ships the `VisibleCursor` (motion.dev SVG cursor + click ripple), `highlightElement` spotlight, and `attachCursor` adapter. |
| [`@web-companion/react`](packages/react) | React bindings: `<Companion specUrl="..."/>` mounts everything in one line. Also `<CompanionProvider>` + `useCompanion` for advanced layouts, and `<CompanionSidebar>` for custom UIs. The decider is pluggable — defaults to a Chinese/English keyword-matching stub, optionally swapped for `createAnthropicDecider({apiKey})` for real LLM intent. |
| [`examples/coffee-shop`](examples/coffee-shop) | Minimal Vite + React 19 demo: 4 coffees, a cart, and a checkout button. Companion exposes 3 tools and 2 resources. |

## Status — what's done in v0

- ✅ Spec format (`/.well-known/companion.json`)
- ✅ In-page sidebar with chat-style transcript
- ✅ Visible cursor: SVG circle + drop-shadow, framer-motion `easeOutQuint` flight, click ripple, drop-shadow, element spotlight
- ✅ Tool target selector interpolation: `[data-ai-tool='add-cart-{id}']` resolves at invocation time
- ✅ Rule-based decider stub (keyword scoring + enum-aware param extraction)
- ✅ Claude (Opus 4.7) decider via `createAnthropicDecider` — uses tool_use, system prompt is cached
- ✅ Playwright e2e test suite (4 specs, ~6s) verifying spec load, cursor mount, highlight-target alignment, tool execution, resource read, checkout cursor + cart empty

## Roadmap

- v0.2 — MCP-server adapter (`@web-companion/mcp`) so Claude Desktop / Cursor / claw-os can drive the page over MCP. Same spec file, no extra wiring.
- v0.2 — CLI (`@web-companion/cli`) that drives a headless browser from the same spec.
- v0.3 — Vue / Svelte / Vanilla framework adapters.
- v0.3 — Standalone JSON Schema file (`companion.schema.json`) for editor autocomplete + external validation.

## Project layout

```
packages/
  spec/        # protocol — schema + types
  sdk/         # runtime — registry, loader, cursor, runtime
  react/       # <Companion> + sidebar + deciders
examples/
  coffee-shop/ # demo app + Playwright e2e
```

## Development

```sh
pnpm install
pnpm -r build           # build all packages
pnpm -r typecheck       # tsc --noEmit across the monorepo
pnpm --filter coffee-shop dev --host 127.0.0.1
pnpm --filter coffee-shop test:e2e
```

`TASKS.md` carries the v0 plan + per-task notes. The build chain is `spec → sdk → react → examples/*`; modifying a SDK package needs a `pnpm -r build` before the demo picks it up.
