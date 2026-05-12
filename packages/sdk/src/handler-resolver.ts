import { parseHandlerRef, type HandlerRef } from '@web-companion/spec';

export type HandlerFn = (input?: unknown) => unknown | Promise<unknown>;

export interface ResolveHandlerOptions {
  /** Absolute URL of the spec document; relative module paths in handler refs are resolved against it. */
  baseUrl: string;
}

const handlerCache = new Map<string, HandlerFn>();

const dynamicImport: (url: string) => Promise<Record<string, unknown>> =
  new Function('url', 'return import(url)') as never;

export async function resolveHandler(
  ref: HandlerRef,
  options: ResolveHandlerOptions,
): Promise<HandlerFn> {
  const cached = handlerCache.get(ref);
  if (cached) return cached;

  const { module, export: exportName } = parseHandlerRef(ref);
  const moduleUrl = new URL(module, options.baseUrl).toString();

  const mod = await dynamicImport(moduleUrl);
  const fn = mod[exportName];
  if (typeof fn !== 'function') {
    throw new Error(
      `Handler ${ref}: module ${moduleUrl} exports no function named "${exportName}"`,
    );
  }
  const handlerFn = fn as HandlerFn;
  handlerCache.set(ref, handlerFn);
  return handlerFn;
}

export function clearHandlerCache(): void {
  handlerCache.clear();
}
