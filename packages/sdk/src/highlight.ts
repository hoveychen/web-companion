import { animate } from 'motion';

export interface HighlightOptions {
  color?: string;
  padding?: number;
  zIndex?: number;
  durationMs?: number;
}

export interface HighlightHandle {
  dispose(): Promise<void>;
}

export function highlightElement(
  element: Element,
  options: HighlightOptions = {},
): HighlightHandle {
  const color = options.color ?? 'rgb(99 102 241)';
  const padding = options.padding ?? 4;
  const zIndex = options.zIndex ?? 2147483645;
  const rect = element.getBoundingClientRect();

  const overlay = document.createElement('div');
  overlay.setAttribute('data-web-companion-highlight', '');
  Object.assign(overlay.style, {
    position: 'fixed',
    left: `${rect.left - padding}px`,
    top: `${rect.top - padding}px`,
    width: `${rect.width + padding * 2}px`,
    height: `${rect.height + padding * 2}px`,
    borderRadius: '6px',
    border: `2px solid ${color}`,
    boxShadow: `0 0 0 4px ${color}33`,
    pointerEvents: 'none',
    zIndex: String(zIndex),
    opacity: '0',
  });
  document.body.appendChild(overlay);
  animate(overlay, { opacity: 1 }, { duration: 0.2 });

  return {
    async dispose() {
      await animate(overlay, { opacity: 0 }, { duration: 0.2 });
      overlay.remove();
    },
  };
}
