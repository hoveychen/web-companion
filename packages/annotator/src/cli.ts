#!/usr/bin/env node
import { resolve } from 'node:path';
import { annotateFile } from './index.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    process.stderr.write(usage());
    process.exit(args.length === 0 ? 1 : 0);
  }

  const filePath = resolve(args[0]!);
  try {
    const result = await annotateFile(filePath);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`annotator: ${message}\n`);
    process.exit(2);
  }
}

function usage(): string {
  return [
    'Usage: web-companion-annotator <file.tsx>',
    '',
    'Reads a React component file and prints a JSON object with two fields:',
    '  - spec:    a companion.json draft (tools + resources)',
    '  - markers: data-ai-* attributes a codemod should add for stable selectors',
    '',
    'Set ANTHROPIC_API_KEY to authenticate with Claude.',
    '',
  ].join('\n');
}

main();
