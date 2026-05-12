export { ActionRegistry } from './registry.js';
export {
  DEFAULT_SPEC_PATH,
  loadCompanionSpec,
  type LoadResult,
} from './loader.js';
export {
  resolveHandler,
  clearHandlerCache,
  type HandlerFn,
  type ResolveHandlerOptions,
} from './handler-resolver.js';
export {
  resolveTarget,
  waitForTarget,
  type ResolvedTarget,
} from './target-resolver.js';
export {
  CompanionRuntime,
  type CompanionRuntimeOptions,
  type BeforeInvokeEvent,
  type AfterInvokeEvent,
  type InvokeErrorEvent,
} from './runtime.js';
export {
  VisibleCursor,
  type CursorOptions,
} from './cursor.js';
export {
  highlightElement,
  type HighlightOptions,
  type HighlightHandle,
} from './highlight.js';
export {
  attachCursor,
  type AttachCursorOutput,
} from './attach-cursor.js';
