export interface ResolvedTarget {
  element: Element;
  rect: DOMRect;
}

export function resolveTarget(
  selector: string,
  root: ParentNode = document,
): ResolvedTarget | null {
  const element = root.querySelector(selector);
  if (!element) return null;
  return { element, rect: element.getBoundingClientRect() };
}

export function waitForTarget(
  selector: string,
  options: { timeoutMs?: number; root?: ParentNode } = {},
): Promise<ResolvedTarget> {
  const { timeoutMs = 2000, root = document } = options;
  const immediate = resolveTarget(selector, root);
  if (immediate) return Promise.resolve(immediate);

  return new Promise((resolve, reject) => {
    const observerRoot = root instanceof Document ? root.body : (root as Node);
    const observer = new MutationObserver(() => {
      const found = resolveTarget(selector, root);
      if (found) {
        observer.disconnect();
        clearTimeout(timeoutHandle);
        resolve(found);
      }
    });
    observer.observe(observerRoot, { childList: true, subtree: true });

    const timeoutHandle = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Target "${selector}" not found within ${timeoutMs}ms`));
    }, timeoutMs);
  });
}
