import type { CompanionSpec } from '@web-companion/spec';

export interface MarkerSuggestion {
  /** 1-indexed line in the source file. */
  line: number;
  /** 1-indexed column. */
  column: number;
  /** Attribute name to add, e.g. `data-ai-tool` or `data-ai`. */
  attribute: string;
  /** Value the attribute should carry, e.g. `add-cart-mocha` or `cart-item`. */
  value: string;
  /** Why the annotator thinks this marker is needed (LLM-authored). */
  rationale: string;
}

export interface AnnotateResult {
  spec: CompanionSpec;
  markers: MarkerSuggestion[];
}

export interface AnnotateOptions {
  /** Override the default Claude model. Defaults to `claude-opus-4-7`. */
  model?: string;
  /** Anthropic API key. Falls back to `process.env.ANTHROPIC_API_KEY`. */
  apiKey?: string;
}
