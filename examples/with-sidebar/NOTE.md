# with-sidebar (formerly `@web-companion/react`)

This directory is the same code that used to ship as the
**`@web-companion/react`** npm package (versions through 0.1.0). In v0.3
we repositioned the project: web-companion's production surfaces are the
runtime SDK and the headless remote-agent connector — the chat sidebar is
a demo, not a deliverable.

| Before v0.3                | After v0.3                                  |
| -------------------------- | ------------------------------------------- |
| `@web-companion/react`     | `examples/with-sidebar` (this directory)    |
| `<Companion/>` sidebar     | unchanged, still imported in `coffee-shop`  |
| `npm install` then `<Companion/>` | not a published path — copy this dir     |

## Why the change

The vision for v0.3 (see the top-level README) is: **the SDK + control
plane is the product; how the agent is presented is up to the
integrator.** Most production teams want either:

- A **headless remote-agent connection** that lets a backend agent
  (`claude code`, an in-house LLM service, etc.) drive the page —
  → `@web-companion/sidecar`
- A **custom UI** they design themselves on top of the runtime —
  → `@web-companion/sdk` directly

The chat sidebar in `<Companion/>` is opinionated UX and not what most
integrators want; keeping it as a published package was creating a false
impression that web-companion ships a chat product.

## Migrating from `@web-companion/react` <= 0.1.0

If you were using `<Companion/>` to embed a chat sidebar:

1. Copy this whole directory into your repo (it's MIT-licensed source,
   ~300 lines of React).
2. Tailor it to your design system; the underlying contract
   (`CompanionRuntime` from `@web-companion/sdk`) is stable.

If you were using `<Companion/>` because you actually wanted a *remote*
agent (i.e. an LLM running somewhere else), use
`@web-companion/sidecar` instead — it does the network + cursor + runtime
plumbing without rendering any sidebar at all.

## npm package status

The 0.x line of `@web-companion/react` on npm is now **unmaintained**.
A final 0.1.x will be published with a deprecation message pointing here;
no 0.3+ will ship. If you're pinned, follow either migration above.
