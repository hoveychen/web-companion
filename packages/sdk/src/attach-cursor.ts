import type { CompanionRuntimeOptions } from './runtime.js';
import { VisibleCursor, type CursorOptions } from './cursor.js';
import { highlightElement } from './highlight.js';

export interface AttachCursorOutput extends CompanionRuntimeOptions {
  cursor: VisibleCursor;
}

/**
 * Wraps a CompanionRuntimeOptions so that, before each tool invocation, the visible
 * cursor flies to the tool's target element, briefly highlights it, plays a click
 * ripple, then yields to any onBeforeInvoke the caller already supplied.
 *
 * Typical use:
 *   const opts = attachCursor({ specUrl: '/.well-known/companion.json' });
 *   const runtime = new CompanionRuntime(opts);
 */
export function attachCursor(
  baseOptions: CompanionRuntimeOptions = {},
  cursorOptions: CursorOptions = {},
): AttachCursorOutput {
  const cursor = new VisibleCursor(cursorOptions);
  cursor.mount();

  const originalBefore = baseOptions.onBeforeInvoke;

  return {
    ...baseOptions,
    cursor,
    onBeforeInvoke: async (event) => {
      if (event.target) {
        await cursor.flyToElement(event.target.element);
        const hl = highlightElement(event.target.element);
        await cursor.click();
        setTimeout(() => {
          void hl.dispose();
        }, 350);
      }
      await originalBefore?.(event);
    },
  };
}
