import type { CompanionRuntime, CursorOptions } from '@web-companion/sdk';
import { CompanionProvider } from './provider.js';
import { CompanionSidebar, type CompanionSidebarProps } from './Sidebar.js';

export interface CompanionProps extends CompanionSidebarProps {
  /** URL of the companion.json document. Defaults to `/.well-known/companion.json`. */
  specUrl?: string;
  /** Visible cursor styling. */
  cursorOptions?: CursorOptions;
  /** Fired once after the runtime finishes loading the spec. */
  onRuntimeReady?: (runtime: CompanionRuntime) => void;
}

export function Companion({
  specUrl,
  cursorOptions,
  onRuntimeReady,
  ...sidebarProps
}: CompanionProps) {
  const providerProps: {
    specUrl?: string;
    cursorOptions?: CursorOptions;
    onRuntimeReady?: (runtime: CompanionRuntime) => void;
  } = {};
  if (specUrl !== undefined) providerProps.specUrl = specUrl;
  if (cursorOptions !== undefined) providerProps.cursorOptions = cursorOptions;
  if (onRuntimeReady !== undefined) providerProps.onRuntimeReady = onRuntimeReady;

  return (
    <CompanionProvider {...providerProps}>
      <CompanionSidebar {...sidebarProps} />
    </CompanionProvider>
  );
}
