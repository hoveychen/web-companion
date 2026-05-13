import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { companionSpecSchema } from '@web-companion/spec';
import type { SourceSummary } from './extract-ast.js';
import type { AnnotateOptions, AnnotateResult } from './types.js';

const markerSchema = z.object({
  line: z.number().int().min(1),
  column: z.number().int().min(1),
  attribute: z.string().min(1),
  value: z.string().min(1),
  rationale: z.string().min(1),
});

const annotatorOutputSchema = z.object({
  spec: companionSpecSchema,
  markers: z.array(markerSchema),
});

const DEFAULT_MODEL = 'claude-opus-4-7';
const MAX_RETRIES = 2;

export async function annotateWithClaude(
  summary: SourceSummary,
  options: AnnotateOptions = {},
): Promise<AnnotateResult> {
  const apiKey =
    options.apiKey ??
    (typeof process !== 'undefined' ? process.env['ANTHROPIC_API_KEY'] : undefined);
  if (!apiKey) {
    throw new Error(
      'annotator: ANTHROPIC_API_KEY is not set (pass apiKey in options or export ANTHROPIC_API_KEY)',
    );
  }

  const client = new Anthropic({ apiKey });
  const model = options.model ?? DEFAULT_MODEL;

  const system = buildSystemPrompt();
  const user = buildUserPrompt(summary);

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      const response = await client.messages.parse({
        model,
        max_tokens: 8192,
        system: [
          {
            type: 'text',
            text: system,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content:
              attempt === 1
                ? user
                : `${user}\n\nThe previous attempt failed validation: ${String(lastError).slice(0, 400)}\nReturn JSON that validates against the schema this time.`,
          },
        ],
        output_config: { format: zodOutputFormat(annotatorOutputSchema) },
      });

      const parsed = response.parsed_output;
      if (!parsed) {
        lastError = new Error('parsed_output was null');
        continue;
      }
      return parsed as AnnotateResult;
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `annotator: Claude failed after ${MAX_RETRIES + 1} attempts. Last error: ${String(lastError)}`,
  );
}

function buildSystemPrompt(): string {
  return [
    'You are a code analyzer that turns a React .tsx file into a companion.json — a spec-first protocol that lets in-page AI agents drive the page.',
    '',
    'A companion.json declares two kinds of capabilities:',
    '',
    '1. tools — UI action sequences. Each tool has a name, description, optional params (JSON Schema), and an ordered `steps` array. Steps are one of:',
    '   - { type: "click",    target: <CSS selector> }',
    '   - { type: "fill",     target: <CSS selector>, value: <string with {param} placeholders> }',
    '   - { type: "select",   target: <CSS selector>, value: <string> }',
    '   - { type: "check",    target: <CSS selector>, checked?: <bool> }',
    '   - { type: "wait_for", target: <CSS selector>, timeoutMs?: <int> }',
    '   Any `target` or `value` can contain `{paramName}` placeholders interpolated from the tool\'s params at invocation time.',
    '',
    '2. resources — DOM-extraction rules. Each resource has a name, description, JSON-Schema for the returned shape, and an `extract` config:',
    '   - { type: "single", selector: <CSS>, fields: { fieldName: { from: "text"|"attr"|"value"|"checked", selector?: <CSS relative to item>, attr?: <name> } } }',
    '   - { type: "list",   selector: <CSS — picks each item>, fields: { ... same shape ... } }',
    '',
    'RULES YOU MUST FOLLOW:',
    '- Never invent JavaScript functions, API endpoints, or business logic. Every action must reach the user\'s real DOM event handlers.',
    '- Selectors are plain CSS. Prefer existing class names, aria attributes, role, or text content. When the existing markup has no stable hook, suggest adding a `data-ai-*` attribute — surface that in the `markers` array, but DO NOT change the user\'s source code or business logic in the spec.',
    '- For each tool, the `steps` chain must mirror what a real user would do: filling an input, clicking a button, possibly waiting for a result region. Use `wait_for` whenever a step\'s effect is async (network call, state update via setTimeout, etc.).',
    '- For each list rendering you see (an `xs.map(item => <Tag .../>)`), prefer to expose it as a `list` resource. Use the list-item element as the outer selector and pull per-item fields off children that hold the data.',
    '',
    'OUTPUT:',
    'Emit a single JSON object with two top-level fields:',
    '- spec: { version: "0.1", tools: [...], resources: [...] }',
    '- markers: array of { line, column, attribute, value, rationale } — one entry for each `data-ai-*` attribute you want a follow-up codemod (or human) to add to the source. Line and column are 1-indexed against the original file. Each marker rationale should explain why the existing selectors weren\'t stable enough.',
    '',
    'Be conservative: only emit tools and resources that you can ground in concrete JSX you saw in the file. If you\'re unsure, omit rather than hallucinate.',
  ].join('\n');
}

function buildUserPrompt(summary: SourceSummary): string {
  const interactiveLines = summary.interactiveElements.map(
    (el) =>
      `- L${el.line}:${el.column} ${el.kind}<${el.tagName}> handlers=[${el.eventHandlers.join(',')}] text=${JSON.stringify(el.textContent)} attrs=${JSON.stringify(el.attributes)}`,
  );
  const listLines = summary.listRenderings.map(
    (lr) =>
      `- L${lr.line}:${lr.column} iter=${lr.source} → <${lr.itemElementTag}> attrs=${JSON.stringify(lr.itemAttributes)}`,
  );

  return [
    `File: ${summary.filePath} (${summary.byteSize} bytes)`,
    '',
    '## Interactive elements detected by AST',
    interactiveLines.length > 0 ? interactiveLines.join('\n') : '(none)',
    '',
    '## List renderings detected by AST',
    listLines.length > 0 ? listLines.join('\n') : '(none)',
    '',
    '## Raw source',
    '```tsx',
    summary.source,
    '```',
    '',
    'Now produce the companion.json spec + marker suggestions for this file. Output only the JSON object.',
  ].join('\n');
}
