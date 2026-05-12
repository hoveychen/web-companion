# web-companion

A spec-first SDK that gives any website a built-in AI sidekick — a chat sidebar with a visible cursor that flies across the page to click, fill, and verify, just as the user would.

The contract is a single JSON document at `/.well-known/companion.json` that declares:

- **tools** — UI action sequences expressed as `click` / `fill` / `select` / `check` / `wait_for` steps
- **resources** — structured data the AI can read by extracting from the DOM

The runtime dispatches real DOM events against the user's actual elements. The AI's `add_to_cart` ends up calling the same button's `onClick` your user would press — no parallel business code, no fidelity gap.

## Quickstart

Three steps for a React app.

**1. Install:**

```sh
npm install @web-companion/react
```

**2. Mount the sidebar:**

```tsx
import { Companion } from '@web-companion/react';

export function App() {
  return (
    <>
      {/* your existing app */}
      <Companion />
    </>
  );
}
```

**3. Serve a spec at `/.well-known/companion.json`:**

```jsonc
{
  "version": "0.1",
  "tools": [
    {
      "name": "add_to_cart",
      "description": "Add a product to the cart by id.",
      "params": {
        "type": "object",
        "properties": { "id": { "type": "string" } },
        "required": ["id"]
      },
      "steps": [
        { "type": "click", "target": "[data-ai-tool='add-cart-{id}']" }
      ]
    }
  ]
}
```

Then sprinkle a `data-ai-tool="add-cart-mocha"` (etc.) on your existing buttons. No other business code changes — the cursor will fly to that button and dispatch a real click event; your existing `onClick` runs.

To play with the bundled demo:

```sh
pnpm install
pnpm -r build
pnpm --filter coffee-shop dev --host 127.0.0.1
# open http://127.0.0.1:5173
```

## Write a tool

A tool is a sequence of UI steps. Every `target`, `value`, and field selector can contain `{paramName}` placeholders that get interpolated from the tool's `params` at invocation time.

### Single-step tool

```jsonc
{
  "name": "checkout",
  "description": "Place the order.",
  "steps": [
    { "type": "click", "target": "[data-ai-tool='checkout']" }
  ]
}
```

At invocation: cursor flies to the element matching `[data-ai-tool='checkout']`, plays a click ripple, and dispatches a `MouseEvent('click', { bubbles: true })`. Whatever React/Vue/vanilla `onClick` you have on that button runs.

### Multi-step tool with a parameter and async wait

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

At invocation with `{ query: "mocha" }`: cursor visits the input (220ms dwell), the input gets the value via the native React-compatible setter so `onChange` fires; then the submit button (click ripple), real `MouseEvent('click')`; then the cursor parks on the results region as it appears.

### What every step type does

| Step | Effect on the target element |
|---|---|
| `click` | `dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))` |
| `fill` | Native value setter + `dispatchEvent(new InputEvent('input'))` + `dispatchEvent(new Event('change'))` — needed to make React's controlled-input state sync |
| `select` | `element.value = value` + `dispatchEvent(new Event('change'))` |
| `check` | Toggle `checkbox.checked` (or set to `step.checked`) + `dispatchEvent(new Event('change'))` |
| `wait_for` | Poll via `MutationObserver` until the selector matches, up to `timeoutMs` (default 3000) |

Non-wait steps default to a 1500ms wait for their target to appear; they don't fail immediately on race conditions.

### What you don't write

No handler module, no Node-side function, no API endpoint. The step's effect is whatever your existing event handlers do. If the search submit button currently runs `fetch('/api/search', …)`, that's what runs when the AI triggers it.

## Write a resource

A resource is a DOM-extraction rule. The runtime queries elements and reads scalar fields off them. No JavaScript runs.

```jsonc
{
  "name": "cart",
  "description": "Current cart contents.",
  "schema": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "id":    { "type": "string" },
        "name":  { "type": "string" },
        "price": { "type": "string" }
      }
    }
  },
  "extract": {
    "type": "list",
    "selector": "[data-ai='cart-item']",
    "fields": {
      "id":    { "from": "attr", "attr": "data-id" },
      "name":  { "from": "text", "selector": "[data-ai='item-name']" },
      "price": { "from": "text", "selector": "[data-ai='item-price']" }
    }
  }
}
```

The runtime queries every `[data-ai='cart-item']` and, for each match, reads `id` from `data-id`, `name` from the descendant's text, etc. A `"type": "single"` extract returns one object instead of an array.

`from` options:

| from | What it reads |
|---|---|
| `text` | `element.textContent`, trimmed |
| `attr` | `element.getAttribute(attr)` — `attr` is required |
| `value` | `.value` from `<input>` / `<select>` / `<textarea>` |
| `checked` | `.checked` from a checkbox/radio |

`selector` on a field is optional — omit it to read the source from the item element itself.

## Connect Claude

By default the sidebar uses a keyword-matching stub to pick which tool to invoke from a user message. For real natural-language understanding:

```tsx
import { Companion, createAnthropicDecider } from '@web-companion/react';

const decider = createAnthropicDecider({
  apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY,
  // Optional: extra context appended to the system prompt
  systemPromptHint:
    'This is a coffee shop. Map Chinese names to enum values: 拿铁→latte, 摩卡→mocha, ...',
});

export function App() {
  return <Companion decider={decider} />;
}
```

Set `VITE_ANTHROPIC_API_KEY` in `.env.local` for local dev. Uses `claude-opus-4-7` with prompt caching on the tool catalog. Note: the key is inlined in the client bundle — fine for demos, but use a backend proxy in production.

## Spec reference

```ts
type CompanionSpec = {
  version: '0.1';
  tools?: ToolSpec[];
  resources?: ResourceSpec[];
};

type ToolSpec = {
  name: string;
  description: string;
  params?: JsonSchema;
  steps: Step[];                 // at least one
};

type Step =
  | { type: 'click';    target: string }
  | { type: 'fill';     target: string; value: string }
  | { type: 'select';   target: string; value: string }
  | { type: 'check';    target: string; checked?: boolean }
  | { type: 'wait_for'; target: string; timeoutMs?: number };

type ResourceSpec = {
  name: string;
  description: string;
  schema: JsonSchema;            // shape of the returned data
  extract: ExtractConfig;
};

type ExtractConfig =
  | { type: 'single'; selector: string; fields: Record<string, FieldExtract> }
  | { type: 'list';   selector: string; fields: Record<string, FieldExtract> };

type FieldExtract =
  | { from: 'text';    selector?: string }
  | { from: 'attr';    selector?: string; attr: string }
  | { from: 'value';   selector?: string }
  | { from: 'checked'; selector?: string };
```

All `target`, `value`, and `selector` strings may contain `{paramName}` placeholders interpolated from the tool's `params` at invocation time.

## Adapting an existing app

The protocol is designed so that an AI agent — even one with limited context — can read a page's source, identify the interactive elements, and emit a `companion.json` *without writing business code*. Four properties make this safe:

1. **No business logic in the spec.** The agent never references a JS function. It only points at DOM elements.
2. **Selectors are plain CSS.** The agent uses whatever's already on the element (`aria-*`, `role`, classes, text content) or **adds a `data-ai-*` attribute as an anchor** when the existing markup is unstable.
3. **Step semantics are explicit.** Every step is one of five known kinds. The agent can't smuggle in arbitrary code.
4. **Fidelity is structural.** The runtime dispatches real DOM events on the user's actual elements; whatever the user's `onClick` does is what the AI triggers. Cursor演的=用户操作的。

A typical pass over an existing React app:

1. Identify interactive elements you want to expose (buttons, inputs, dropdowns).
2. If their existing selectors aren't stable, add `data-ai-*` attributes — marker only, no logic change.
3. Identify data the AI should be able to read (cart list, product info). Add `data-ai-*` markers to the wrapper element and the field-bearing children.
4. Write `companion.json` referencing those markers.

No state-management changes. No `onClick` rewrites. The agent is annotating, not refactoring.

## Packages

```
packages/
  spec/    @web-companion/spec    Zod schema + TS types + parser/validator
  sdk/     @web-companion/sdk     runtime: registry, dsl-executor, dom-extractor, cursor, target waiter
  react/   @web-companion/react   <Companion>, sidebar, keyword-stub + Anthropic deciders
examples/
  coffee-shop/                    vite 6 + react 19 demo + Playwright e2e
```

Build chain: `spec → sdk → react → examples/*`. After modifying any package, `pnpm -r build` before exercising the demo.

## Status (v0.1)

| | |
|---|---|
| DSL with 5 step types | ✅ |
| DOM extraction (single + list) | ✅ |
| Visible cursor with per-step animation (motion.dev) | ✅ |
| React 19 `<Companion>` + pluggable decider | ✅ |
| Anthropic Opus 4.7 decider with prompt caching | ✅ |
| Playwright e2e (4/4) covering cursor flight, DOM dispatch, extraction | ✅ |
| MCP server adapter (use the same spec from Claude Desktop / Cursor) | planned v0.2 |
| Headless CLI driver | planned v0.2 |
| Standalone `companion.schema.json` for editor autocomplete | planned v0.2 |
| Vue / Svelte adapters | planned v0.3 |
| Nested resource extraction | planned v0.3 |

## Development

```sh
pnpm install
pnpm -r build
pnpm -r typecheck
pnpm --filter coffee-shop dev --host 127.0.0.1
pnpm --filter coffee-shop test:e2e
```
