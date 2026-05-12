import { z } from 'zod';

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

const handlerRefSchema = z
  .string()
  .regex(
    /^[^#]+#[A-Za-z_$][\w$]*$/,
    'handler must look like "path/to/file.js#exportedFn"',
  );

export const toolSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  params: jsonSchemaSchema.optional(),
  target: z.string().min(1).optional(),
  handler: handlerRefSchema,
});

export const resourceSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  schema: jsonSchemaSchema,
  source: handlerRefSchema,
});

export const companionSpecSchema = z.object({
  version: z.literal('0.1'),
  tools: z.array(toolSchema).optional(),
  resources: z.array(resourceSchema).optional(),
});

export type CompanionSpec = z.infer<typeof companionSpecSchema>;
export type ToolSpec = z.infer<typeof toolSchema>;
export type ResourceSpec = z.infer<typeof resourceSchema>;
export type HandlerRef = z.infer<typeof handlerRefSchema>;

export function parseCompanionSpec(input: unknown): CompanionSpec {
  return companionSpecSchema.parse(input);
}

export function safeParseCompanionSpec(input: unknown) {
  return companionSpecSchema.safeParse(input);
}

export function parseHandlerRef(ref: HandlerRef): { module: string; export: string } {
  const hashIdx = ref.indexOf('#');
  return {
    module: ref.slice(0, hashIdx),
    export: ref.slice(hashIdx + 1),
  };
}
