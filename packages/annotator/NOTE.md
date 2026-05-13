# `@web-companion/annotator` — positioning

The v0.4 deliverable for AI-assisted spec authoring is the **playbook
+ skill**, not this npm package:

- [`docs/annotator-playbook.md`](../../docs/annotator-playbook.md) — the
  framework-agnostic manual any AI coding agent (Claude Code, Cursor,
  Claw, etc.) reads to annotate a project's source into a v0.2
  `companion.json`.
- [`.claude/skills/web-companion-annotate/`](../../.claude/skills/web-companion-annotate)
  — Claude Code skill wrapping the playbook into a
  `/web-companion-annotate <path>` invocation.

This package — `@web-companion/annotator` — predates that route and
takes a different shape: it's a CLI that **calls the Claude API
itself** to produce a suggestion JSON from a single `.tsx` file. Two
reasons it still exists:

1. **CI / batch jobs.** When an agent isn't already in the loop (a
   build-time validator, a code-review bot, a CI step that wants to
   diff against a reference spec) and you need a deterministic
   `annotate <file> → JSON` command, this package fills that role.
2. **No agent host required.** If a contributor doesn't have Claude
   Code / Cursor / Claw, they can still drive the annotator with an
   `ANTHROPIC_API_KEY`. The output overlaps the skill's, just without
   the conversational refinement loop.

For anyone using an AI coding agent interactively, the
playbook + skill is the better path: the agent is already an LLM, so
double-LLM'ing the workflow wastes context and API spend.

For new integrations, prefer the playbook + skill route. We may
deprecate this package once the playbook is battle-tested across a
few real repos — for now it's a complementary tool, not a competitor.

## Status

- v0.2 P5–P7: shipped as the primary annotator surface (single-file
  CLI + Claude API call + structured-output validation).
- v0.4 P6: redirected to playbook + skill. This package wasn't
  retired but is no longer the recommended path.
- TODO before retirement: verify the playbook produces equivalent or
  better quality on `examples/coffee-shop` over 3+ runs. Until that's
  done, this CLI is the fallback.
