import Anthropic from '@anthropic-ai/sdk';
import type { ResourceSpec, ToolSpec } from '@web-companion/spec';
import type { Decision } from './decide.js';

export interface AnthropicDeciderOptions {
  apiKey: string;
  /** Defaults to claude-opus-4-7 — the most capable Claude model. */
  model?: string;
  /** Extra instructions appended to the system prompt. */
  systemPromptHint?: string;
  /** Defaults to true. Required when calling Anthropic directly from a browser — exposes the key in the bundle. Use a proxy in production. */
  dangerouslyAllowBrowser?: boolean;
}

const READ_PREFIX = 'read_';

export function createAnthropicDecider(options: AnthropicDeciderOptions) {
  const client = new Anthropic({
    apiKey: options.apiKey,
    dangerouslyAllowBrowser: options.dangerouslyAllowBrowser ?? true,
  });
  const model = options.model ?? 'claude-opus-4-7';

  return async function decide(
    input: string,
    tools: ToolSpec[],
    resources: ResourceSpec[],
  ): Promise<Decision> {
    const claudeTools: Anthropic.Tool[] = [
      ...tools.map(
        (t): Anthropic.Tool => ({
          name: t.name,
          description: t.description,
          input_schema: (t.params ?? {
            type: 'object',
            properties: {},
          }) as Anthropic.Tool.InputSchema,
        }),
      ),
      ...resources.map(
        (r): Anthropic.Tool => ({
          name: `${READ_PREFIX}${r.name}`,
          description: `Read the resource "${r.name}". ${r.description} The returned data follows this JSON schema: ${JSON.stringify(r.schema)}`,
          input_schema: { type: 'object', properties: {} },
        }),
      ),
    ];

    const systemPrompt = [
      'You are an AI assistant embedded in a web page. The page exposes a set of TOOLS (side-effectful actions) and RESOURCES (readable structured data) via this conversation.',
      '',
      'Behaviour:',
      `- For RESOURCES (read-only data), call the tool named "${READ_PREFIX}<resource_name>".`,
      '- For TOOLS (actions like add_to_cart, checkout), call the tool with its declared parameters.',
      '- Pick exactly ONE tool per user message — the rest of the application will execute it and may follow up with you.',
      '- If no tool fits, respond with a short plain-text explanation instead of guessing.',
      options.systemPromptHint,
    ]
      .filter(Boolean)
      .join('\n');

    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: claudeTools,
      messages: [{ role: 'user', content: input }],
    });

    for (const block of response.content) {
      if (block.type === 'tool_use') {
        const params = (block.input ?? {}) as Record<string, unknown>;
        if (block.name.startsWith(READ_PREFIX)) {
          return {
            kind: 'resource',
            name: block.name.slice(READ_PREFIX.length),
            reason: `Claude → resource "${block.name.slice(READ_PREFIX.length)}"`,
          };
        }
        return {
          kind: 'tool',
          name: block.name,
          params,
          reason: `Claude → tool "${block.name}" params=${JSON.stringify(params)}`,
        };
      }
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    return {
      kind: 'unknown',
      reason: text || 'Claude did not pick a tool',
    };
  };
}

export type AnthropicDecider = ReturnType<typeof createAnthropicDecider>;
