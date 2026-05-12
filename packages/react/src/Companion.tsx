import type { CursorOptions } from '@web-companion/sdk';
import { CompanionProvider } from './provider.js';
import { CompanionSidebar, type CompanionSidebarProps } from './Sidebar.js';

export interface CompanionProps extends CompanionSidebarProps {
  /** URL of the companion.json document. Defaults to `/.well-known/companion.json`. */
  specUrl?: string;
  /** Visible cursor styling. */
  cursorOptions?: CursorOptions;
  /** Inherited from CompanionSidebarProps for convenience — overrides the default rule-based decider. */
}

export function Companion({
  specUrl,
  cursorOptions,
  ...sidebarProps
}: CompanionProps) {
  const providerProps: { specUrl?: string; cursorOptions?: CursorOptions } = {};
  if (specUrl !== undefined) providerProps.specUrl = specUrl;
  if (cursorOptions !== undefined) providerProps.cursorOptions = cursorOptions;

  return (
    <CompanionProvider {...providerProps}>
      <CompanionSidebar {...sidebarProps} />
    </CompanionProvider>
  );
}
