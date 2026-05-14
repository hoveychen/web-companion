/**
 * v0.5 P2 smoke — exercises the four-level user-roles collector,
 * `passesWhere` roles branch, and `mergeWhere` roles propagation.
 *
 * Run with `pnpm --filter @web-companion/sdk smoke-roles`. Pure Node:
 * we polyfill a minimal `globalThis.document` for the meta/body cases so
 * we don't have to pull jsdom in.
 */
import {
  collectUserRoles,
  mergeWhere,
  passesWhere,
} from '../src/index.js';
import type { WhereSpec } from '@web-companion/spec';

interface Case {
  label: string;
  run: () => void | Promise<void>;
}

function assertDeepEqual(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`${label}: expected ${b}, got ${a}`);
  }
}

function assert(cond: boolean, label: string): void {
  if (!cond) throw new Error(label);
}

interface MockDoc {
  meta?: string | null;
  bodyAttr?: string | null;
}

/**
 * Install a minimal `globalThis.document` covering only the two query
 * shapes `collectUserRoles` performs. Returns a restore() thunk.
 */
function mockDocument(opts: MockDoc): () => void {
  const original = (globalThis as { document?: unknown }).document;
  const fakeMeta =
    opts.meta !== undefined && opts.meta !== null
      ? { getAttribute: (n: string) => (n === 'content' ? opts.meta! : null) }
      : null;
  const fakeBody =
    opts.bodyAttr !== undefined
      ? {
          getAttribute: (n: string) =>
            n === 'data-wc-user-roles' ? opts.bodyAttr ?? null : null,
        }
      : null;
  (globalThis as { document?: unknown }).document = {
    querySelector: (sel: string) => {
      if (sel === 'meta[name="wc-user-roles"]') return fakeMeta;
      return null;
    },
    body: fakeBody,
  };
  return () => {
    if (original === undefined) {
      delete (globalThis as { document?: unknown }).document;
    } else {
      (globalThis as { document?: unknown }).document = original;
    }
  };
}

const cases: Case[] = [
  {
    label: '1. explicit array override — sorted + deduped + trimmed',
    run: () => {
      const roles = collectUserRoles([' staff ', 'admin', 'staff', '']);
      assertDeepEqual(roles, ['admin', 'staff'], 'roles output');
    },
  },
  {
    label: '2. explicit function override — invoked on each call',
    run: () => {
      let calls = 0;
      const provider = (): string[] => {
        calls += 1;
        return ['customer'];
      };
      assertDeepEqual(collectUserRoles(provider), ['customer'], 'first call');
      assertDeepEqual(collectUserRoles(provider), ['customer'], 'second call');
      assert(calls === 2, `expected 2 invocations, got ${calls}`);
    },
  },
  {
    label: '3. <meta name="wc-user-roles"> — comma + whitespace tolerant',
    run: () => {
      const restore = mockDocument({ meta: 'admin, staff customer' });
      try {
        const roles = collectUserRoles();
        assertDeepEqual(
          roles,
          ['admin', 'customer', 'staff'],
          'meta tag roles',
        );
      } finally {
        restore();
      }
    },
  },
  {
    label: '4. <body data-wc-user-roles> — used when meta is absent',
    run: () => {
      const restore = mockDocument({ bodyAttr: 'admin staff' });
      try {
        const roles = collectUserRoles();
        assertDeepEqual(roles, ['admin', 'staff'], 'body data-attr roles');
      } finally {
        restore();
      }
    },
  },
  {
    label: '5. fallback to [] when neither meta nor body data-attr present',
    run: () => {
      const restore = mockDocument({});
      try {
        assertDeepEqual(collectUserRoles(), [], 'empty page');
      } finally {
        restore();
      }
    },
  },
  {
    label: '6. mergeWhere propagates roles from parent to child',
    run: () => {
      const parent: WhereSpec = { roles: ['admin'] };
      const child: WhereSpec = { marker: '[data-ai-view="users"]' };
      const merged = mergeWhere(parent, child);
      assertDeepEqual(
        merged,
        { marker: '[data-ai-view="users"]', roles: ['admin'] },
        'child without roles inherits parent roles',
      );
    },
  },
  {
    label: '7. mergeWhere — child roles win when both define them',
    run: () => {
      const parent: WhereSpec = { roles: ['admin'] };
      const child: WhereSpec = { roles: ['staff'] };
      const merged = mergeWhere(parent, child);
      assertDeepEqual(
        merged,
        { roles: ['staff'] },
        'child roles override parent',
      );
    },
  },
  {
    label: '8. passesWhere — where.roles matched against state.userRoles',
    run: () => {
      const where: WhereSpec = { roles: ['admin', 'staff'] };
      // happy: user has staff
      assert(
        passesWhere(where, {
          currentUrl: '/anywhere',
          matchedMarkers: [],
          userRoles: ['staff'],
        }),
        'staff user matches admin|staff predicate',
      );
      // miss: user only customer
      assert(
        !passesWhere(where, {
          currentUrl: '/anywhere',
          matchedMarkers: [],
          userRoles: ['customer'],
        }),
        'customer user does NOT match admin|staff predicate',
      );
      // miss: anonymous
      assert(
        !passesWhere(where, {
          currentUrl: '/anywhere',
          matchedMarkers: [],
          userRoles: [],
        }),
        'anonymous user does NOT match admin|staff predicate',
      );
      // back-compat: state without userRoles field treated as [] (anonymous)
      assert(
        !passesWhere(where, {
          currentUrl: '/anywhere',
          matchedMarkers: [],
        }),
        'state missing userRoles treated as anonymous (fail-closed)',
      );
    },
  },
  {
    label: '9. passesWhere — roles combined with url + marker (AND)',
    run: () => {
      const where: WhereSpec = {
        url: '**/admin/**',
        marker: '[data-ai-view="admin"]',
        roles: ['admin'],
      };
      // all three pass
      assert(
        passesWhere(where, {
          currentUrl: '/admin/users',
          matchedMarkers: ['[data-ai-view="admin"]'],
          userRoles: ['admin'],
        }),
        'all three pass',
      );
      // url miss
      assert(
        !passesWhere(where, {
          currentUrl: '/public',
          matchedMarkers: ['[data-ai-view="admin"]'],
          userRoles: ['admin'],
        }),
        'url miss blocks',
      );
      // marker miss
      assert(
        !passesWhere(where, {
          currentUrl: '/admin/users',
          matchedMarkers: [],
          userRoles: ['admin'],
        }),
        'marker miss blocks',
      );
      // roles miss
      assert(
        !passesWhere(where, {
          currentUrl: '/admin/users',
          matchedMarkers: ['[data-ai-view="admin"]'],
          userRoles: ['customer'],
        }),
        'roles miss blocks',
      );
    },
  },
];

let failed = 0;
for (const c of cases) {
  try {
    await c.run();
    process.stdout.write(`  OK    ${c.label}\n`);
  } catch (err) {
    failed += 1;
    process.stdout.write(
      `  FAIL  ${c.label} — ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

if (failed > 0) {
  process.stderr.write(`\n${failed}/${cases.length} smoke cases failed\n`);
  process.exit(1);
}
process.stdout.write(`\n${cases.length}/${cases.length} smoke cases passed\n`);
