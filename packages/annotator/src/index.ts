import { extractSourceSummary } from './extract-ast.js';
import { annotateWithClaude } from './llm.js';
import type { AnnotateOptions, AnnotateResult } from './types.js';

export type {
  AnnotateOptions,
  AnnotateResult,
  MarkerSuggestion,
} from './types.js';
export {
  extractSourceSummary,
  summarizeSource,
  type SourceSummary,
  type InteractiveElement,
  type ListRendering,
} from './extract-ast.js';

/**
 * Read a single React `.tsx` file and emit a `companion.json` draft plus the
 * `data-ai-*` markers an external codemod (or human) should add to make the
 * draft point at stable selectors. Pure suggestion — never patches the source.
 *
 * Implementation is staged in v0.2:
 *   - P5 (this file): skeleton + types + CLI plumbing
 *   - P6: TS Compiler API source-walk (interactive elements, list rendering)
 *   - P7: Claude Opus 4.7 LLM with structured output against companion.schema.json
 *   - P8: self-test on the bundled coffee-shop App.tsx
 */
export async function annotateFile(
  filePath: string,
  options: AnnotateOptions = {},
): Promise<AnnotateResult> {
  const summary = await extractSourceSummary(filePath);
  return annotateWithClaude(summary, options);
}
