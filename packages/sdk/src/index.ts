export {
  ActionRegistry,
  type ToolEntry,
  type ResourceEntry,
} from './registry.js';
export {
  DEFAULT_SPEC_PATH,
  loadCompanionSpec,
  type LoadResult,
  type LoaderOptions,
  type ModuleErrorInfo,
  type ResolvedModule,
  type ResolvedResource,
  type ResolvedTool,
} from './loader.js';
export {
  executeSteps,
  type DslExecutorOptions,
  type StepContext,
} from './dsl-executor.js';
export { extractData } from './dom-extractor.js';
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
  type ToolResult,
} from './runtime.js';
export {
  VisibleCursor,
  type CursorOptions,
  type CursorRenderContext,
  type CursorRenderResult,
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
export {
  checkWhere,
  globMatch,
  WrongPageError,
  type WhereCheckResult,
  type WhereCheckOk,
  type WhereCheckFail,
} from './where-check.js';
export {
  attachWebSocket,
  type AttachWebSocketOptions,
  type WebCompanionWsClient,
  type WsState,
  type RuntimeLike,
} from './ws-client.js';
export {
  PageStateTracker,
  type PageState,
  type PageStateTrackerOptions,
} from './page-state.js';
