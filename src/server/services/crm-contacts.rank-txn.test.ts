import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { appModules } from '$server/db/pg-modules-schema';
import { crmSettings } from '$server/db/pg-crm-schema';

/**
 * Transaction-boundary regression for the ranked-contacts path.
 *
 * `withOrgCore` runs on the RLS pool, whose size defaults to ONE connection
 * (`src/server/db/pg-pool.ts` → `getRlsPgClient`). A settings read issued from
 * INSIDE an open ranking transaction therefore waits for a second connection
 * that the outer transaction is itself holding: in production that is a wedge
 * (until `idle_in_transaction_session_timeout` aborts it), and a larger
 * configured pool only downgrades it to a concurrency race under load.
 *
 * The sibling suites cannot catch it — `crm-contacts.service.test.ts` mocks
 * `bothEnabled`/`resolveDepositRule` away, and the PostgreSQL suite replaces
 * `withOrgCore` with a callback over a non-transactional client, so both are
 * blind to re-entry. Here the module gate and the deposit rule are REAL, and
 * `withOrgCore` is a one-slot semaphore that fails loudly (rather than hanging)
 * the moment a second transaction opens while the first is still open.
 */

/** Concurrent/nested `withOrgCore` transactions, and the high-water mark. */
let depth = 0;
let maxDepth = 0;
/** Tables a `tx.select().from(...)` targeted, in order. */
let selectedTables: unknown[] = [];
/** Raw-SQL statements the ranking query issued through `tx.execute`. */
let executed: SQL[] = [];
let moduleRows: unknown[] = [];
let settingsRows: unknown[] = [];
let rosterRows: unknown[] = [];

/** Fake tx: drizzle `select()` chains for the two settings reads, `execute` for
 *  the raw ranking SQL. Deliberately NOT transactional — the property under
 *  test is when transactions are opened, not what they read. */
function makeTx() {
  function chain(table?: unknown): Record<string, unknown> {
    const rows = () => (table === crmSettings ? settingsRows : moduleRows);
    return {
      from: (t: unknown) => {
        selectedTables.push(t);
        return chain(t);
      },
      where: () => chain(table),
      limit: () => Promise.resolve(rows()),
      then: (onFulfilled: (v: unknown) => unknown) => Promise.resolve(rows()).then(onFulfilled),
    };
  }
  return {
    execute: async (statement: SQL) => {
      executed.push(statement);
      return rosterRows;
    },
    select: () => chain(),
  };
}

vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: async (_scope: unknown, fn: (tx: unknown) => unknown) => {
    if (depth > 0) {
      throw new Error(
        'nested withOrgCore: the RLS pool has a single connection, so this would deadlock',
      );
    }
    depth++;
    maxDepth = Math.max(maxDepth, depth);
    try {
      return await fn(makeTx());
    } finally {
      depth--;
    }
  },
}));

import { rankContactsPage, listContactsCached } from './crm-contacts.service';

const ROSTER = [
  {
    contact_id: '00000000-0000-4000-8000-000000000001',
    total_rows: 1,
    page_position: 1,
    custom_fields: {},
    identities: [],
  },
];

beforeEach(async () => {
  const { configureCache, MemoryBackend } = await import('@minion-stack/cache');
  // A fresh backend per test: `listModuleStates` is cached, and a warm entry
  // would skip the very transaction whose ordering is under test.
  configureCache({ backend: new MemoryBackend(), namespace: `rank-txn-${Math.random()}` });
  depth = 0;
  maxDepth = 0;
  selectedTables = [];
  executed = [];
  moduleRows = []; // no app_modules rows ⇒ crm + finances both default to enabled
  settingsRows = [{ value: { deposit: { keywords: ['adelanto'], label: 'Adelanto' } } }];
  rosterRows = ROSTER;
});

const ctx = { db: {} as never, tenantId: 'org-rank-txn' };

describe('rankContactsPage transaction boundary', () => {
  it('completes with the finance bridge on, opening its transactions one at a time', async () => {
    const page = await rankContactsPage(ctx);

    expect(page.rows).toHaveLength(1);
    expect(maxDepth).toBe(1);
  });

  it('reads the module gate and the deposit rule BEFORE the ranking transaction, not inside it', async () => {
    await rankContactsPage(ctx);

    // Both settings reads really happened (real bothEnabled + real
    // resolveDepositRule), so the single-transaction result above is not
    // vacuously true.
    expect(selectedTables).toContain(appModules);
    expect(selectedTables).toContain(crmSettings);
  });

  it('the org-configured rule it read is the one the ranking SQL binds', async () => {
    await rankContactsPage(ctx);

    const compiled = executed.map((s) => new PgDialect().sqlToQuery(s));
    const ranking = compiled.find((q) => q.sql.includes('contact_invoice_class'));
    expect(ranking).toBeDefined();
    expect(ranking!.params).toContain('%adelanto%');
    expect(ranking!.params).not.toContain('%reserva%');
  });

  it('the cached roster path has the same single-transaction shape', async () => {
    const rows = await listContactsCached(ctx);

    expect(rows).toHaveLength(1);
    expect(maxDepth).toBe(1);
  });
});
