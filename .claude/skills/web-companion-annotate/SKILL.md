---
name: web-companion-annotate
description: Use when the user asks to make an existing web app AI-operable via web-companion — phrased as "annotate this app for web-companion", "add data-ai markers", "create the companion.json", "let claude code drive this site", "wire up the AI sidekick spec", or any equivalent. Walks Claude through the annotator playbook: discover routes/flows, list interactive elements, add `data-ai-*` markers, write a v0.2 `companion.json` + per-module files under `public/.well-known/`. SKIP if the user just wants to use the existing demo (`examples/coffee-shop`), is debugging the SDK runtime, or is asking about agent-side integration (sidecar / local-bridge / reference-backend) rather than spec authoring.
---

# Annotate this app for web-companion

The user wants to make their app driveable by an external AI agent
(claude code, claw, their own SaaS backend's LLM, etc.) through
[web-companion][repo]. Your job: produce a `companion.json` tree at
`public/.well-known/` plus the minimal source diff to make the
referenced markers resolve.

## Required reading

Before writing anything, read these files in this order:

1. **`docs/annotator-playbook.md`** — the framework-agnostic manual.
   Defines the safety properties, the v0.2 spec shape, the 7-step
   pass over a project, and (v0.5+) the *Auth-aware tools* section
   on role gating. Treat it as authoritative — if this skill and the
   playbook disagree, the playbook wins.
2. **`docs/v0.4-spec-at-scale.md`** — wire-protocol-level details on
   modules, namespacing, server-side filter, and meta tools. Mostly
   reference; consult when you need to confirm a schema detail.
3. **`docs/v0.5-auth-aware-filter.md`** — RFC covering the
   `where.roles` field, `PageState.userRoles` collection, and the
   security disclosure (the filter is *ergonomics*, not an
   authorization boundary). Only consult this when the project has
   role-gated UI; for public-only apps the playbook section is enough.

If `docs/annotator-playbook.md` isn't present in the current
workspace, the user probably cloned a downstream of web-companion
without docs. Stop and tell them — annotating without the playbook
risks breaking the safety properties.

## How to invoke this skill

The user will typically say something like "annotate my app for
web-companion" or "set up the companion.json". They may pass a
directory hint:

- `/web-companion-annotate src/` — start from `src/`
- `/web-companion-annotate src/routes/checkout/` — annotate this one
  flow only

If no path is given, default to scanning `src/` (or `app/` for
Next.js app router).

## Execution outline

For each request:

1. **Confirm scope first.** Read the playbook's section "Recommended
   pass over a project" → Step 1. Use Read/Glob to enumerate the
   route files. Surface the candidate flow list to the user and ask
   for confirmation **before** mutating any source. (Skip this only
   if the user has already pre-approved the flow list in this turn.)
2. **Per-flow walk.** Follow playbook steps 2-5. Each flow gets:
   - A clear list of `(tool, selector)` decisions.
   - A clear list of `(resource, selector)` decisions.
   - The minimal `data-ai-*` markup diff.
3. **Write the spec files.** Follow playbook step 6. Layout:
   ```
   public/.well-known/companion.json            (v0.2 index, modules ref array)
   public/.well-known/companion/<flow>.json     (one per flow)
   ```
4. **Verify.** Follow playbook step 7. If the workspace has
   `@web-companion/spec` installed, run
   `pnpm --filter @web-companion/spec smoke` — that validates the
   schema. Then hand the user the page-level smoke checklist (open
   page in browser, querySelector each tool target).

## Safety reminders

- **Don't break the four safety properties** (playbook → "Safety
  properties"): no business logic in spec, plain-CSS selectors, only
  the 5 step kinds, no `onClick` rewrites. If a flow won't fit, leave
  it out and tell the user why.
- **Don't mutate non-markup code.** State management, reducers, route
  config — all out of scope. Surface as out-of-scope.
- **Don't install dependencies.** Annotation is a code-edit task, not
  an env-setup task. If the user wants the runtime, that's a separate
  follow-up (point them at `examples/coffee-shop` for an example
  integration).
- **Don't run the dev server.** You don't have a browser to verify
  with. The user has to do the page-level smoke.

## Worked reference

The playbook points at `examples/coffee-shop` as a complete worked
example: 4 modules, 11 tools, 5 resources, plus the `App.tsx` source
with all `data-ai-*` markers inline. When unsure how to structure a
new flow, search the coffee-shop demo for an analogous pattern (list
+ tools-on-items → `cart`; form + async result → `search`).

## What output goes back to the user

At the end of a successful pass, surface (matches playbook → "Output
expected from a single pass"):

1. The list of flows and their where: predicates.
2. The marker-additions diff (no logic touched).
3. The new files under `public/.well-known/companion/`.
4. The list of files you didn't annotate + reasons.
5. The page-level smoke checklist.

Stop before declaring done; the user does the browser smoke.

## When NOT to invoke this skill

The skill is for **spec authoring on a user's own app**. Skip when:

- The user is debugging the SDK runtime / DSL executor (that's a
  `packages/sdk` change, not an annotation task).
- The user wants to expand the coffee-shop demo itself — they're a
  contributor, not an integrator.
- The user is asking about the agent side (sidecar / local-bridge /
  reference-backend) — those are control-plane concerns.
- The user already has a `companion.json` and just wants a small
  edit — do the edit directly, don't restart the full playbook.

---

This skill is part of the [web-companion][repo] repo, shipped under
its workspace's `.claude/skills/` directory. Copy it into
`~/.claude/skills/` if you want it available across all your Claude
Code sessions, or invoke it inline from this repo as
`/web-companion-annotate`.

[repo]: https://github.com/hoveychen/web-companion
