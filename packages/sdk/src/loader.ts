import { parseCompanionSpec, type CompanionSpec } from '@web-companion/spec';

export const DEFAULT_SPEC_PATH = '/.well-known/companion.json';

export interface LoadResult {
  spec: CompanionSpec;
  /** Absolute URL where the spec was fetched from — used as the base for resolving handler module paths. */
  url: string;
}

export async function loadCompanionSpec(
  url: string = DEFAULT_SPEC_PATH,
  fetchImpl: typeof fetch = fetch,
): Promise<LoadResult> {
  const absolute = toAbsoluteUrl(url);
  const res = await fetchImpl(absolute);
  if (!res.ok) {
    throw new Error(
      `Failed to load companion spec from ${absolute}: HTTP ${res.status}`,
    );
  }
  const json = await res.json();
  const spec = parseCompanionSpec(json);
  return { spec, url: absolute };
}

function toAbsoluteUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  if (typeof location !== 'undefined') {
    return new URL(url, location.href).toString();
  }
  return url;
}
