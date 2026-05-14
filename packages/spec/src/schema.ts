import { z } from 'zod';

// --- JSON Schema subset (for params and resource schema) -------------------

const jsonSchemaSchema: z.ZodType = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('string'),
      description: z.string().optional(),
      enum: z.array(z.string()).optional(),
    }),
    z.object({ type: z.literal('number'), description: z.string().optional() }),
    z.object({ type: z.literal('integer'), description: z.string().optional() }),
    z.object({ type: z.literal('boolean'), description: z.string().optional() }),
    z.object({
      type: z.literal('array'),
      items: jsonSchemaSchema,
      description: z.string().optional(),
    }),
    z.object({
      type: z.literal('object'),
      properties: z.record(z.string(), jsonSchemaSchema),
      required: z.array(z.string()).optional(),
      description: z.string().optional(),
    }),
  ]),
);

// --- Identifier grammar ----------------------------------------------------

/**
 * Tool / resource / module identifier (the raw, in-file `name`). v0.4 reserves
 * `.` as the namespace separator (`<flow>.<toolName>`), so raw names may not
 * contain it. The runtime applies the namespace prefix when surfacing items
 * from a module to the MCP / WebMCP / sidebar layer.
 */
const identifierRegex = /^[A-Za-z][A-Za-z0-9_-]*$/;
const identifierSchema = z
  .string()
  .min(1)
  .regex(identifierRegex, {
    message:
      'identifier must match /^[A-Za-z][A-Za-z0-9_-]*$/ — `.` is reserved for namespacing',
  });

// --- DSL: tool steps -------------------------------------------------------

/**
 * One UI action a tool performs. `target` is a CSS selector and may contain
 * `{paramName}` placeholders interpolated at invocation time. The `value`
 * field (where present) also supports `{paramName}` interpolation.
 *
 * The runtime dispatches real DOM events so framework-bound listeners
 * (React onClick, Vue @click, etc.) fire identically to a user action.
 */
export const stepSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('click'),
    target: z.string().min(1),
  }),
  z.object({
    type: z.literal('fill'),
    target: z.string().min(1),
    value: z.string(),
  }),
  z.object({
    type: z.literal('select'),
    target: z.string().min(1),
    value: z.string(),
  }),
  z.object({
    type: z.literal('check'),
    target: z.string().min(1),
    checked: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('wait_for'),
    target: z.string().min(1),
    timeoutMs: z.number().int().positive().optional(),
  }),
]);

// --- DSL: resource extraction ---------------------------------------------

/**
 * How to pull one scalar out of the DOM. `selector` is optional and is
 * resolved relative to the item element (for `list`) or the document
 * (for `single`); omit it to use the item element itself as the source.
 */
export const fieldExtractSchema = z.discriminatedUnion('from', [
  z.object({ from: z.literal('text'), selector: z.string().min(1).optional() }),
  z.object({
    from: z.literal('attr'),
    selector: z.string().min(1).optional(),
    attr: z.string().min(1),
  }),
  z.object({ from: z.literal('value'), selector: z.string().min(1).optional() }),
  z.object({ from: z.literal('checked'), selector: z.string().min(1).optional() }),
]);

export const extractConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('single'),
    selector: z.string().min(1),
    fields: z.record(z.string(), fieldExtractSchema),
  }),
  z.object({
    type: z.literal('list'),
    selector: z.string().min(1),
    fields: z.record(z.string(), fieldExtractSchema),
  }),
]);

// --- Capabilities & document ----------------------------------------------

/**
 * Page-scope predicate for a tool or resource. All provided fields must pass
 * (AND). Omit entirely to make the capability site-wide available.
 *
 *   - `url`    : minimatch-style glob against `location.pathname + search + hash`
 *                (NOT the full href — origin is handled at connection level).
 *                Use this for SSR / multi-page apps.
 *   - `marker` : a CSS selector that must `querySelector` non-null on the
 *                current document. Use this for SPAs that don't rotate URLs
 *                (hash routing, state-only routing) — the developer / AI
 *                annotator tags each "view" wrapper with `data-ai-view='...'`.
 *   - `roles`  : v0.5 — at least one of these role names must appear in the
 *                runtime's collected `userRoles`. This is an ergonomics filter
 *                (reduces agent token cost / confusion when the catalog has
 *                role-gated tools), NOT a security boundary — see
 *                `docs/v0.5-auth-aware-filter.md`.
 *
 * Any combination can be supplied; all provided fields are AND'd together.
 */
export const whereSchema = z
  .object({
    url: z.string().min(1).optional(),
    marker: z.string().min(1).optional(),
    roles: z.array(identifierSchema).min(1).optional(),
  })
  .refine(
    (w) =>
      w.url !== undefined || w.marker !== undefined || w.roles !== undefined,
    {
      message: 'where must declare at least one of `url`, `marker`, or `roles`',
    },
  );

export const toolSchema = z.object({
  name: identifierSchema,
  description: z.string().min(1),
  params: jsonSchemaSchema.optional(),
  where: whereSchema.optional(),
  steps: z.array(stepSchema).min(1, 'tool must have at least one step'),
});

export const resourceSchema = z.object({
  name: identifierSchema,
  description: z.string().min(1),
  schema: jsonSchemaSchema,
  where: whereSchema.optional(),
  extract: extractConfigSchema,
});

/**
 * v0.2 only — a pointer to another `companion.json` whose `tools` / `resources`
 * are namespaced under `<moduleName>.` at load time. The module's URL is
 * resolved against the parent document's URL. Per-module `where` (if present)
 * is AND'd with each contained capability's `where` by the loader.
 *
 * Modules themselves may NOT declare `modules` in v0.2 (one-level deep).
 */
export const moduleRefSchema = z.object({
  name: identifierSchema,
  url: z.string().min(1),
  description: z.string().optional(),
  where: whereSchema.optional(),
});

const v01SpecSchema = z
  .object({
    version: z.literal('0.1'),
    tools: z.array(toolSchema).optional(),
    resources: z.array(resourceSchema).optional(),
  })
  .strict();

const v02SpecSchema = z
  .object({
    version: z.literal('0.2'),
    modules: z.array(moduleRefSchema).optional(),
    tools: z.array(toolSchema).optional(),
    resources: z.array(resourceSchema).optional(),
  })
  .strict();

/**
 * Top-level companion document. v0.1 keeps the original flat shape; v0.2
 * adds the optional `modules` ref array for splitting large catalogs.
 *
 * Cross-file duplicate detection (e.g. two modules each named `foo`) is the
 * loader's job — at the schema layer we only enforce per-file duplicate name
 * rejection via the .refine() below.
 */
export const companionSpecSchema = z
  .discriminatedUnion('version', [v01SpecSchema, v02SpecSchema])
  .superRefine((spec, ctx) => {
    rejectDuplicateNames(spec.tools, 'tools', ctx);
    rejectDuplicateNames(spec.resources, 'resources', ctx);
    if ('modules' in spec) {
      rejectDuplicateNames(spec.modules, 'modules', ctx);
    }
  });

function rejectDuplicateNames(
  items: Array<{ name: string }> | undefined,
  collection: string,
  ctx: z.RefinementCtx,
): void {
  if (!items) return;
  const seen = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    const n = items[i]!.name;
    if (seen.has(n)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [collection, i, 'name'],
        message: `duplicate ${collection.slice(0, -1)} name '${n}'`,
      });
    }
    seen.add(n);
  }
}

// --- Inferred types -------------------------------------------------------

export type CompanionSpec = z.infer<typeof companionSpecSchema>;
export type ToolSpec = z.infer<typeof toolSchema>;
export type ResourceSpec = z.infer<typeof resourceSchema>;
export type ModuleRef = z.infer<typeof moduleRefSchema>;
export type Step = z.infer<typeof stepSchema>;
export type FieldExtract = z.infer<typeof fieldExtractSchema>;
export type ExtractConfig = z.infer<typeof extractConfigSchema>;
export type WhereSpec = z.infer<typeof whereSchema>;

export function parseCompanionSpec(input: unknown): CompanionSpec {
  return companionSpecSchema.parse(input);
}

export function safeParseCompanionSpec(input: unknown) {
  return companionSpecSchema.safeParse(input);
}
