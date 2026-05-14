/**
 * Schema smoke for v0.4 P1 — covers the version 0.1 ↔ 0.2 discriminator,
 * the modules ref array, the identifier grammar, and per-file duplicate
 * name rejection.
 *
 * Run with `pnpm --filter @web-companion/spec smoke`.
 *
 * Exit code is 0 if every case matches its expected verdict; non-zero
 * otherwise. Logs every case to stdout.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeParseCompanionSpec } from '../src/schema.js';

interface Case {
  label: string;
  input: unknown;
  expect: 'ok' | 'fail';
  /** Optional substring search inside the first issue message when expect='fail'. */
  failContains?: string;
}

const cases: Case[] = [
  {
    label: 'v0.1 happy: minimal single tool',
    input: {
      version: '0.1',
      tools: [
        {
          name: 'submit',
          description: 'submit the form',
          steps: [{ type: 'click', target: '[data-ai-tool="submit"]' }],
        },
      ],
    },
    expect: 'ok',
  },
  {
    label: 'v0.1 reject modules field (strict)',
    input: {
      version: '0.1',
      modules: [{ name: 'foo', url: './foo.json' }],
    },
    expect: 'fail',
    failContains: 'modules',
  },
  {
    label: 'v0.2 happy: modules ref array + per-module where',
    input: {
      version: '0.2',
      modules: [
        {
          name: 'checkout',
          url: './companion/checkout.json',
          description: 'cart + checkout flow',
          where: { url: '**/cart' },
        },
        {
          name: 'search',
          url: './companion/search.json',
          where: { marker: '[data-ai-view="search"]' },
        },
      ],
    },
    expect: 'ok',
  },
  {
    label: 'v0.2 reject `.` in tool name (reserved separator)',
    input: {
      version: '0.2',
      tools: [
        {
          name: 'checkout.submit',
          description: 'place the order',
          steps: [{ type: 'click', target: '[data-ai-tool="submit"]' }],
        },
      ],
    },
    expect: 'fail',
    failContains: 'identifier must match',
  },
  {
    label: 'v0.2 reject duplicate module names',
    input: {
      version: '0.2',
      modules: [
        { name: 'foo', url: './a.json' },
        { name: 'foo', url: './b.json' },
      ],
    },
    expect: 'fail',
    failContains: 'duplicate',
  },
  {
    label: 'v0.2 reject duplicate site-level tool names',
    input: {
      version: '0.2',
      tools: [
        {
          name: 'submit',
          description: 'first',
          steps: [{ type: 'click', target: '[data-ai="a"]' }],
        },
        {
          name: 'submit',
          description: 'second',
          steps: [{ type: 'click', target: '[data-ai="b"]' }],
        },
      ],
    },
    expect: 'fail',
    failContains: 'duplicate',
  },
  {
    label: 'v0.2 reject identifier starting with digit',
    input: {
      version: '0.2',
      modules: [{ name: '1stFlow', url: './x.json' }],
    },
    expect: 'fail',
    failContains: 'identifier must match',
  },
  {
    label: 'v0.5 happy: tool with where.roles only (no url/marker)',
    input: {
      version: '0.2',
      tools: [
        {
          name: 'delete_user',
          description: 'soft-delete a user account',
          where: { roles: ['admin'] },
          steps: [
            { type: 'click', target: '[data-ai-tool="delete-user-{id}"]' },
          ],
        },
      ],
    },
    expect: 'ok',
  },
  {
    label: 'v0.5 reject empty roles array',
    input: {
      version: '0.2',
      tools: [
        {
          name: 'delete_user',
          description: 'soft-delete a user account',
          where: { roles: [] },
          steps: [{ type: 'click', target: '[data-ai-tool="x"]' }],
        },
      ],
    },
    expect: 'fail',
    failContains: 'at least 1',
  },
  {
    label: 'v0.5 reject non-identifier role name',
    input: {
      version: '0.2',
      tools: [
        {
          name: 'delete_user',
          description: 'soft-delete a user account',
          where: { roles: ['super.admin'] },
          steps: [{ type: 'click', target: '[data-ai-tool="x"]' }],
        },
      ],
    },
    expect: 'fail',
    failContains: 'identifier must match',
  },
  {
    label: 'backward compat: real-world coffee-shop spec (v0.1) still parses',
    input: loadCoffeeShopSpec(),
    expect: 'ok',
  },
];

function loadCoffeeShopSpec(): unknown {
  const __filename = fileURLToPath(import.meta.url);
  const path = resolve(
    dirname(__filename),
    '..',
    '..',
    '..',
    'examples/coffee-shop/public/.well-known/companion.json',
  );
  return JSON.parse(readFileSync(path, 'utf8'));
}

let failed = 0;
for (const c of cases) {
  const r = safeParseCompanionSpec(c.input);
  const ok = r.success;
  const matchesVerdict = (c.expect === 'ok') === ok;
  let matchesMessage = true;
  if (!ok && c.failContains !== undefined) {
    const firstMsg = r.error.issues[0]?.message ?? '';
    matchesMessage = firstMsg.includes(c.failContains);
  }
  const verdict = matchesVerdict && matchesMessage ? 'OK  ' : 'FAIL';
  if (verdict.trim() === 'FAIL') failed++;
  const detail =
    ok
      ? ''
      : ` (first issue: ${r.error.issues[0]?.path.join('.')} → ${r.error.issues[0]?.message})`;
  process.stdout.write(`  ${verdict}  ${c.label}${detail}\n`);
}

if (failed > 0) {
  process.stderr.write(`\n${failed}/${cases.length} smoke cases failed\n`);
  process.exit(1);
}
process.stdout.write(`\n${cases.length}/${cases.length} smoke cases passed\n`);
