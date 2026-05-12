export { Companion, type CompanionProps } from './Companion.js';
export type { CompanionRuntime } from '@web-companion/sdk';
export {
  CompanionProvider,
  useCompanion,
  type CompanionProviderProps,
} from './provider.js';
export {
  CompanionSidebar,
  type CompanionSidebarProps,
  type DeciderFn,
} from './Sidebar.js';
export { ruleBasedDecide, type Decision } from './decide.js';
export {
  createAnthropicDecider,
  type AnthropicDecider,
  type AnthropicDeciderOptions,
} from './anthropic-decider.js';
