import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { companionSpecSchema } from '../src/schema.js';

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = resolve(outDir, 'companion.schema.json');

const jsonSchema = zodToJsonSchema(companionSpecSchema, {
  name: 'CompanionSpec',
  target: 'jsonSchema2019-09',
  $refStrategy: 'root',
});

const wrapped = {
  ...jsonSchema,
  $id: 'https://web-companion.dev/companion.schema.json',
  title: 'Companion Spec',
  description:
    'Schema for /.well-known/companion.json — declares an AI-operable surface (DSL tools + DOM-extract resources) over a website. Draft is JSON Schema 2019-09 (what zod-to-json-schema emits); compatible with 2020-12 validators in the common subset.',
};

writeFileSync(outPath, JSON.stringify(wrapped, null, 2) + '\n', 'utf8');
console.log(`wrote ${outPath}`);
