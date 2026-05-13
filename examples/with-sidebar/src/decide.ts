import type { ResourceSpec, ToolSpec } from '@web-companion/spec';

export type Decision =
  | {
      kind: 'tool';
      name: string;
      params: Record<string, unknown>;
      reason: string;
    }
  | { kind: 'resource'; name: string; reason: string }
  | { kind: 'unknown'; reason: string };

const PUNCTUATION = /[\s,，。.、？！?!:：;；()（）\[\]【】]+/;

function tokenize(s: string): string[] {
  return s.toLowerCase().split(PUNCTUATION).filter((t) => t.length > 0);
}

function scoreMatch(
  input: string,
  candidate: { name: string; description: string },
): number {
  const inputLower = input.toLowerCase();
  const tokens = tokenize(input);
  const haystack = (candidate.name + ' ' + candidate.description).toLowerCase();

  let score = 0;
  for (const tok of tokens) {
    if (tok.length === 0) continue;
    if (haystack.includes(tok)) score += 1;
  }
  if (inputLower.includes(candidate.name.toLowerCase())) score += 3;

  for (const word of haystack.split(PUNCTUATION)) {
    if (word.length >= 2 && inputLower.includes(word)) score += 1;
  }
  return score;
}

function extractParam(
  input: string,
  key: string,
  schema: unknown,
): unknown {
  if (!schema || typeof schema !== 'object') return undefined;
  const type = (schema as { type?: string }).type;
  const enumValues = (schema as { enum?: unknown[] }).enum;

  const eq = input.match(new RegExp(`${key}\\s*[=:：]\\s*("([^"]+)"|(\\S+))`));
  if (eq) return eq[2] ?? eq[3];

  if (type === 'string') {
    if (Array.isArray(enumValues)) {
      const inputLower = input.toLowerCase();
      for (const val of enumValues) {
        const v = String(val).toLowerCase();
        if (v.length > 0 && inputLower.includes(v)) return val;
      }
    }
    const sku = input.match(/\b([a-z]+-[\w-]+|sku-?\w+|item-?\w+)\b/i);
    if (sku) return sku[1];
    const quoted = input.match(/["「『]([^"」』]+)["」』]/);
    if (quoted) return quoted[1];
  }
  if (type === 'number' || type === 'integer') {
    const num = input.match(/-?\d+(\.\d+)?/);
    if (num) return type === 'integer' ? parseInt(num[0], 10) : Number(num[0]);
  }
  if (type === 'boolean') {
    if (/(true|yes|开|是|对|要)/.test(input)) return true;
    if (/(false|no|关|否|不)/.test(input)) return false;
  }
  return undefined;
}

export function ruleBasedDecide(
  input: string,
  tools: ToolSpec[],
  resources: ResourceSpec[],
): Decision {
  if (!input.trim()) return { kind: 'unknown', reason: 'empty input' };

  const candidates = [
    ...tools.map((t) => ({ kind: 'tool' as const, spec: t, score: scoreMatch(input, t) })),
    ...resources.map((r) => ({ kind: 'resource' as const, spec: r, score: scoreMatch(input, r) })),
  ].sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best || best.score === 0) {
    return {
      kind: 'unknown',
      reason: `没匹配到任何 tool/resource。可选：${[...tools, ...resources]
        .map((x) => x.name)
        .join(', ')}`,
    };
  }

  if (best.kind === 'resource') {
    return {
      kind: 'resource',
      name: best.spec.name,
      reason: `匹配到 resource "${best.spec.name}" (score=${best.score})`,
    };
  }

  const params: Record<string, unknown> = {};
  const paramSchema = best.spec.params;
  if (
    paramSchema &&
    typeof paramSchema === 'object' &&
    'type' in paramSchema &&
    paramSchema.type === 'object' &&
    'properties' in paramSchema &&
    paramSchema.properties
  ) {
    for (const [key, sub] of Object.entries(paramSchema.properties as Record<string, unknown>)) {
      const val = extractParam(input, key, sub);
      if (val !== undefined) params[key] = val;
    }
  }

  return {
    kind: 'tool',
    name: best.spec.name,
    params,
    reason: `匹配到 tool "${best.spec.name}" (score=${best.score})，提取 params=${JSON.stringify(params)}`,
  };
}
