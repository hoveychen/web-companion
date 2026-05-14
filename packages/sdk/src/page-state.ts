/**
 * Tracks the `(currentUrl, matchedMarkers)` pair that v0.4 server-side
 * filtering needs. Watches History API + popstate for URL changes, and
 * runs a MutationObserver over `document.body` to re-evaluate which of
 * the known marker selectors `querySelector`-match. Diffs are
 * frame-rate throttled — at most one `onChange` call per animation
 * frame.
 *
 * The tracker is browser-only: in non-DOM environments (Node smoke
 * tests, SSR), `start()` is a no-op and `current` returns whatever was
 * computed at construction time from `location`/`document` (typically
 * `currentUrl: ''`, `matchedMarkers: []`).
 */
export interface PageState {
  currentUrl: string;
  matchedMarkers: string[];
  /**
   * v0.5: roles the page declares the current user has. See `collectUserRoles`
   * for the four-level fallback. Sorted+deduped so diff comparisons are stable.
   * Treated as untrusted by the server — this is an ergonomics signal, not an
   * authorization claim (the server must independently enforce RBAC).
   */
  userRoles: string[];
}

/**
 * v0.5: where the SDK pulls the user-roles list from.
 * - `string[]` — set once at construction; e.g. backend-injected via a build step.
 * - `() => string[]` — called every diff; wire to your auth store for reactive apps.
 */
export type UserRolesSource = string[] | (() => string[]);

export interface PageStateTrackerOptions {
  /** CSS selectors the catalog cares about. Order is not preserved. */
  knownMarkers: Iterable<string>;
  /** Fired with the new state when a diff is detected. */
  onChange: (state: PageState) => void;
  /**
   * v0.5 explicit override. If provided, skips the meta/body DOM fallbacks.
   * Function form lets a reactive app re-evaluate on each compute() (e.g. read
   * from a React store ref).
   */
  userRoles?: UserRolesSource;
}

/**
 * Patch History.pushState / replaceState exactly once per window so any
 * number of trackers can observe URL changes by listening to
 * `'wc:location-change'`. Idempotent.
 */
function ensureHistoryPatched(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __webCompanionHistoryPatched?: boolean };
  if (w.__webCompanionHistoryPatched) return;
  w.__webCompanionHistoryPatched = true;

  const fire = (): void => {
    try {
      window.dispatchEvent(new Event('wc:location-change'));
    } catch {
      /* ignore */
    }
  };

  const original = {
    pushState: history.pushState.bind(history),
    replaceState: history.replaceState.bind(history),
  };
  history.pushState = function patchedPushState(...args) {
    const r = original.pushState.apply(history, args as Parameters<typeof history.pushState>);
    fire();
    return r;
  };
  history.replaceState = function patchedReplaceState(...args) {
    const r = original.replaceState.apply(history, args as Parameters<typeof history.replaceState>);
    fire();
    return r;
  };
  window.addEventListener('popstate', fire);
  window.addEventListener('hashchange', fire);
}

export class PageStateTracker {
  private readonly knownMarkers: string[];
  private readonly onChange: (state: PageState) => void;
  private readonly userRolesSource: UserRolesSource | undefined;
  private currentState: PageState;
  private observer: MutationObserver | null = null;
  private rafScheduled = false;
  private rafId: number | null = null;
  private locationListener: EventListener | null = null;
  private started = false;

  constructor(opts: PageStateTrackerOptions) {
    this.knownMarkers = [...new Set(opts.knownMarkers)];
    this.onChange = opts.onChange;
    this.userRolesSource = opts.userRoles;
    this.currentState = this.compute();
  }

  get current(): PageState {
    return this.currentState;
  }

  /** Snapshot, comparison-friendly (sorted markers + roles). */
  snapshot(): PageState {
    return {
      currentUrl: this.currentState.currentUrl,
      matchedMarkers: [...this.currentState.matchedMarkers].sort(),
      userRoles: [...this.currentState.userRoles].sort(),
    };
  }

  start(): void {
    if (this.started) return;
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      // Non-DOM env: nothing to observe.
      this.started = true;
      return;
    }
    this.started = true;

    ensureHistoryPatched();
    this.locationListener = (): void => this.schedule();
    window.addEventListener('wc:location-change', this.locationListener);

    this.observer = new MutationObserver(() => this.schedule());
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.locationListener && typeof window !== 'undefined') {
      window.removeEventListener('wc:location-change', this.locationListener);
      this.locationListener = null;
    }
    if (this.rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
      this.rafScheduled = false;
    }
  }

  /**
   * Force a fresh evaluation. Useful right after a `spec/reload` or when
   * the catalog of known markers changes.
   */
  refresh(): void {
    this.schedule();
  }

  private schedule(): void {
    if (this.rafScheduled) return;
    if (typeof requestAnimationFrame === 'undefined') {
      // Fallback (jsdom etc.): just re-evaluate synchronously next microtask.
      this.rafScheduled = true;
      queueMicrotask(() => this.flush());
      return;
    }
    this.rafScheduled = true;
    this.rafId = requestAnimationFrame(() => this.flush());
  }

  private flush(): void {
    this.rafScheduled = false;
    this.rafId = null;
    const next = this.compute();
    if (!sameState(next, this.currentState)) {
      this.currentState = next;
      this.onChange(next);
    }
  }

  private compute(): PageState {
    // Match the semantics of `where.url` (per spec docs: globs match
    // `pathname + search + hash`, not the full href — origin is handled
    // at connection level).
    const currentUrl =
      typeof location !== 'undefined'
        ? location.pathname + location.search + location.hash
        : '';
    const matched: string[] = [];
    if (typeof document !== 'undefined') {
      for (const sel of this.knownMarkers) {
        try {
          if (document.querySelector(sel) !== null) matched.push(sel);
        } catch {
          // Bad selector — skip it silently; the spec parser should have
          // caught most cases, and crashing the tracker over one bad
          // marker would also drop URL updates.
        }
      }
    }
    const userRoles = collectUserRoles(this.userRolesSource);
    return { currentUrl, matchedMarkers: matched, userRoles };
  }
}

/**
 * v0.5 user-roles collection. Four-level fallback, first wins:
 *   1. `provider` — explicit override (array or thunk) passed to the tracker
 *   2. `<meta name="wc-user-roles" content="admin,staff">`
 *   3. `<body data-wc-user-roles="admin staff">`
 *   4. `[]` (anonymous)
 *
 * Returned list is normalized: trimmed, deduped, sorted. Empty strings are
 * dropped. Separator is comma OR any whitespace (so both `"admin,staff"` and
 * `"admin staff"` work — the latter is friendlier when interpolating from a
 * `String.join(' ')` shape).
 */
export function collectUserRoles(provider?: UserRolesSource): string[] {
  if (provider !== undefined) {
    const raw = typeof provider === 'function' ? provider() : provider;
    return normalizeRoles(raw);
  }
  if (typeof document === 'undefined') return [];
  try {
    const meta = document.querySelector('meta[name="wc-user-roles"]');
    if (meta) {
      const content = (meta as Element).getAttribute('content') ?? '';
      return normalizeRoles(splitRoles(content));
    }
  } catch {
    /* querySelector can throw on extreme docs — fall through */
  }
  try {
    const body = document.body;
    if (body) {
      const attr = body.getAttribute('data-wc-user-roles');
      if (attr !== null) {
        return normalizeRoles(splitRoles(attr));
      }
    }
  } catch {
    /* same — fall through */
  }
  return [];
}

function splitRoles(str: string): string[] {
  // Comma OR whitespace separated. Empty results are dropped by normalizeRoles.
  return str.split(/[,\s]+/);
}

function normalizeRoles(raw: Iterable<string>): string[] {
  const seen = new Set<string>();
  for (const r of raw) {
    const trimmed = String(r).trim();
    if (trimmed.length > 0) seen.add(trimmed);
  }
  return [...seen].sort();
}

function sameState(a: PageState, b: PageState): boolean {
  if (a.currentUrl !== b.currentUrl) return false;
  if (a.matchedMarkers.length !== b.matchedMarkers.length) return false;
  const aMarkers = new Set(a.matchedMarkers);
  for (const m of b.matchedMarkers) {
    if (!aMarkers.has(m)) return false;
  }
  if (a.userRoles.length !== b.userRoles.length) return false;
  const aRoles = new Set(a.userRoles);
  for (const r of b.userRoles) {
    if (!aRoles.has(r)) return false;
  }
  return true;
}
