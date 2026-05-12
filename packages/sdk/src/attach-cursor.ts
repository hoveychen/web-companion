import type { CompanionRuntimeOptions } from './runtime.js';
import { VisibleCursor, type CursorOptions } from './cursor.js';
import { highlightElement } from './highlight.js';

export interface AttachCursorOutput extends CompanionRuntimeOptions {
  cursor: VisibleCursor;
}

const NON_CLICK_DWELL_MS = 220;
const HIGHLIGHT_LINGER_MS = 350;

/**
 * Wraps CompanionRuntimeOptions so the visible cursor flies to each DSL step's
 * target before the step runs. Click/check steps play a click ripple; fill /
 * select / wait_for show a brief dwell on the target.
 */
export function attachCursor(
  baseOptions: CompanionRuntimeOptions = {},
  cursorOptions: CursorOptions = {},
): AttachCursorOutput {
  const cursor = new VisibleCursor(cursorOptions);
  cursor.mount();

  const originalBeforeStep = baseOptions.onBeforeStep;

  return {
    ...baseOptions,
    cursor,
    onBeforeStep: async (ctx) => {
      await cursor.flyToElement(ctx.target);
      const hl = highlightElement(ctx.target);
      if (ctx.step.type === 'click' || ctx.step.type === 'check') {
        await cursor.click();
      } else {
        await new Promise<void>((r) => setTimeout(r, NON_CLICK_DWELL_MS));
      }
      setTimeout(() => {
        void hl.dispose();
      }, HIGHLIGHT_LINGER_MS);
      await originalBeforeStep?.(ctx);
    },
  };
}
