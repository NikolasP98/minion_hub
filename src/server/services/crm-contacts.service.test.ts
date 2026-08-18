import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { createMockDb } from '$server/test-utils/mock-db';
import {
  ensureAccountInScope,
  getContactGraph,
  customFieldsMergeSql,
  contactCustomFieldSetSql,
  setContactCustomField,
  setFunnelStage,
} from './crm-contacts.service';

// Default passthrough mirrors the real withOrgCore's `db.transaction(cb => cb(db))`
// shape (see mock-db.ts) — keeps ensureAccountInScope's select/insert chains
// working. getContactGraph tests override it via useExecMock to hand back a
// bare `{ execute }` tx (avoids typing tx.execute onto the tenant-DB mock).
const mockWithOrgCore = vi.fn(
  (scope: { db: { transaction: (fn: (tx: unknown) => unknown) => unknown } }, fn: (tx: unknown) => unknown) =>
    scope.db.transaction((tx: unknown) => fn(tx)),
);

vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (scope: unknown, fn: (tx: unknown) => unknown) => mockWithOrgCore(scope as never, fn),
}));

function useExecMock(execute: ReturnType<typeof vi.fn>) {
  mockWithOrgCore.mockImplementationOnce((_scope, fn) => fn({ execute } as never));
}

/**
 * A fake `tx` for `setFunnelStage` scenarios that need to inspect the value
 * passed to `.set(...)` on the write — the generic `createMockDb` chain proxy
 * mints a fresh untracked `vi.fn` per property access, so it can't record
 * intermediate chain arguments. `sequence` supplies one resolved value per
 * chain-terminal call (`.limit()`/`.returning()`/`.values()`), consumed in
 * call order — the same contract as `resolveSequence`.
 */
function makeFunnelTx(sequence: unknown[]) {
  let cursor = 0;
  const setCalls: Array<{ customFields: unknown }> = [];
  function next() {
    return Promise.resolve(sequence[cursor++] ?? []);
  }
  function chain(): Record<string, unknown> {
    return {
      from: () => chain(),
      where: () => chain(),
      limit: () => next(),
      set: (v: { customFields: unknown }) => {
        setCalls.push(v);
        return chain();
      },
      returning: () => next(),
      values: () => next(),
    };
  }
  const tx = {
    select: () => chain(),
    update: () => chain(),
    insert: () => chain(),
  };
  return { tx, setCalls };
}

describe('ensureAccountInScope', () => {
  it('is a no-op on the legacy (unconfigured) scope — accounts stays null', async () => {
    const { db, resolve } = createMockDb();
    resolve([]); // crm_settings select → no row → getCrmSettings returns { accounts: null }
    const ctx = { db: db as never, tenantId: 'org-1' };

    await ensureAccountInScope(ctx, 'messenger', 'page-1', 'FACES Page');

    expect(db.insert).not.toHaveBeenCalled();
  });

  it('appends the account when the explicit scope does not have it yet', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ value: { accounts: [{ channel: 'whatsapp', accountId: 'wa-1' }] } }], // getCrmSettings select
      [], // persistConfigs insert().onConflictDoUpdate()
    ]);
    const ctx = { db: db as never, tenantId: 'org-1' };

    await ensureAccountInScope(ctx, 'messenger', 'page-1', 'FACES Page');

    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — already-present account does not trigger a write', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ value: { accounts: [{ channel: 'messenger', accountId: 'page-1' }] } }]);
    const ctx = { db: db as never, tenantId: 'org-1' };

    await ensureAccountInScope(ctx, 'messenger', 'page-1', 'FACES Page');

    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe('getContactGraph', () => {
  const row = {
    contact_id: 'c1',
    label: 'John Smith',
    message_count: '5',
    last_at: '2026-07-01T00:00:00Z',
    relationship: { label: 'mamá', category: 'family', source: 'ai', updatedAt: '2026-07-01T00:00:00Z' },
  };
  const ctx = { db: {} as never, tenantId: 'org-1' };

  it('unrestricted caller: query carries no owner_id clause; label passes through', async () => {
    const execute = vi.fn().mockResolvedValueOnce([row]);
    useExecMock(execute);

    const rows = await getContactGraph(ctx);

    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(query.sql).not.toContain('owner_id');
    expect(rows[0].label).toBe('John Smith');
  });

  it('owner-scoped caller: query filters on c.owner_id', async () => {
    const execute = vi.fn().mockResolvedValueOnce([row]);
    useExecMock(execute);

    await getContactGraph(ctx, { ownerId: 'profile-1' });

    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(query.sql).toContain('c.owner_id');
    expect(query.params).toContain('profile-1');
  });

  it('one row per contact — no per-channel split (spec v2 §C1)', async () => {
    const execute = vi.fn().mockResolvedValueOnce([row]);
    useExecMock(execute);

    const rows = await getContactGraph(ctx);

    expect(rows).toHaveLength(1);
    expect(rows[0].messageCount).toBe(5);
    expect(rows[0].lastAt).toBe('2026-07-01T00:00:00Z');
  });

  it('surfaces a valid stored relationship', async () => {
    const execute = vi.fn().mockResolvedValueOnce([row]);
    useExecMock(execute);

    const rows = await getContactGraph(ctx);

    expect(rows[0].relationship).toEqual({ label: 'mamá', category: 'family', source: 'ai' });
  });

  it('unmasked caller with no stored relationship gets null, not a default', async () => {
    const execute = vi.fn().mockResolvedValueOnce([{ ...row, relationship: null }]);
    useExecMock(execute);

    const rows = await getContactGraph(ctx);

    expect(rows[0].relationship).toBeNull();
  });

  it('masked caller: contact label is PII-masked, not the raw name', async () => {
    const execute = vi.fn().mockResolvedValueOnce([row]);
    useExecMock(execute);

    const rows = await getContactGraph(ctx, { maskSensitive: true });

    expect(rows[0].label).not.toBe('John Smith');
    expect(rows[0].label.endsWith('mith')).toBe(true); // maskPii keeps the last 4 chars
  });

  it('masked caller: relationship is null even though the row has one (spec R6)', async () => {
    const execute = vi.fn().mockResolvedValueOnce([row]);
    useExecMock(execute);

    const rows = await getContactGraph(ctx, { maskSensitive: true });

    expect(rows[0].relationship).toBeNull();
  });
});

describe('customFieldsMergeSql (spec F3b — client cannot forge/delete reserved keys)', () => {
  it('strips a client-supplied `_`-prefixed key before it ever reaches SQL', () => {
    const query = new PgDialect().sqlToQuery(
      customFieldsMergeSql({
        distrito: 'Miraflores',
        _relationship: { label: 'mamá', category: 'family', source: 'user', updatedAt: 'now' },
      }),
    );
    // The client's `_relationship` value must never appear as a bound param —
    // only the non-reserved key made it into the stripped JSON payload.
    const jsonParam = query.params.find((p) => typeof p === 'string' && p.includes('distrito'));
    expect(jsonParam).toBeDefined();
    expect(String(jsonParam)).not.toContain('_relationship');
  });

  it('an empty client payload still merges in whatever reserved keys are stored on the row', () => {
    const query = new PgDialect().sqlToQuery(customFieldsMergeSql({}));
    // The merge expression must reference the existing row's custom_fields
    // (preserving stored `_`-prefixed keys), not just the client's payload.
    expect(query.sql).toContain('jsonb_each');
    expect(query.sql).toContain('custom_fields');
    const jsonParam = query.params.find((p) => typeof p === 'string' && p === '{}');
    expect(jsonParam).toBe('{}');
  });

  it('non-reserved keys pass through untouched', () => {
    const query = new PgDialect().sqlToQuery(customFieldsMergeSql({ distrito: 'Miraflores', edad: '34' }));
    const jsonParam = query.params.find((p) => typeof p === 'string' && p.includes('distrito'));
    expect(jsonParam).toBe(JSON.stringify({ distrito: 'Miraflores', edad: '34' }));
  });
});

describe('contactCustomFieldSetSql (spec hub-funnel-atomic-write S1 — atomic per-key write)', () => {
  it('is a single jsonb_set targeting one key, never a SELECT of the column', () => {
    const query = new PgDialect().sqlToQuery(contactCustomFieldSetSql('_funnel', { stage: 'opportunity' }));
    expect(query.sql).toContain('jsonb_set');
    expect(query.sql.toLowerCase()).not.toMatch(/\bselect\b/);
  });

  it('binds the key and value as params, never string-interpolated into the SQL text', () => {
    const query = new PgDialect().sqlToQuery(contactCustomFieldSetSql('_funnel', { stage: 'opportunity' }));
    expect(query.sql).not.toContain('_funnel');
    expect(query.sql).not.toContain('opportunity');
    expect(query.params).toContain('_funnel');
    expect(query.params).toContain(JSON.stringify({ stage: 'opportunity' }));
  });

  it('a fragment for one key never carries another key\'s value as a param — the statement cannot clobber it', () => {
    const query = new PgDialect().sqlToQuery(contactCustomFieldSetSql('_relationship', { label: 'mamá' }));
    expect(query.params).not.toContain('_funnel');
    expect(query.params.some((p) => typeof p === 'string' && p.includes('opportunity'))).toBe(false);
  });
});

describe('setContactCustomField (S1 — shared atomic setter)', () => {
  it('reports applied when the update matches exactly one row', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'c1' }]);

    const applied = await setContactCustomField(db as never, 'org-1', 'c1', '_funnel', { stage: 'lead' });

    expect(applied).toBe(true);
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it('reports not applied when 0 rows matched (e.g. a different org context) — no existence leak, no write effect', async () => {
    const { db, resolve } = createMockDb();
    resolve([]); // id+orgId predicate excluded the row

    const applied = await setContactCustomField(db as never, 'org-2', 'c1', '_funnel', { stage: 'lead' });

    expect(applied).toBe(false);
  });
});

describe('setFunnelStage (S1 — converted off whole-column read-modify-write)', () => {
  it('writes via ONE atomic jsonb_set targeting only `_funnel` — not a whole-object merge back over the column', async () => {
    // The stored row carries two OTHER reserved/user keys the old RMW write
    // would have silently reproduced only by accident (spread order) — the
    // fixed writer never even reads them into the outgoing statement.
    const existing = {
      _relationship: { label: 'mamá', category: 'family', source: 'ai', updatedAt: '2026-08-01T00:00:00Z' },
      someUserField: 'x',
    };
    const { tx, setCalls } = makeFunnelTx([
      [{ customFields: existing }], // select
      [{ id: 'c1' }], // update .returning()
      [{}], // insert crm_activities .values()
    ]);
    mockWithOrgCore.mockImplementationOnce((_scope, fn) => fn(tx));
    const ctx = { db: {} as never, tenantId: 'org-1' };

    const result = await setFunnelStage(ctx, 'c1', 'opportunity', { by: 'auto' });

    expect(result.applied).toBe(true);
    expect(setCalls).toHaveLength(1); // exactly one write statement
    const query = new PgDialect().sqlToQuery(setCalls[0].customFields as Parameters<typeof PgDialect.prototype.sqlToQuery>[0]);
    expect(query.sql).toContain('jsonb_set');
    expect(query.sql.toLowerCase()).not.toMatch(/\bselect\b/);
    expect(query.params).toContain('_funnel');
    // Neither other reserved key's value nor the user field's value is bound
    // into this statement — jsonb_set's path targets `_funnel` only, so a
    // concurrent writer of `_relationship` or `someUserField` can never be
    // clobbered by this one, regardless of commit order.
    expect(query.params.some((p) => typeof p === 'string' && p.includes('someUserField'))).toBe(false);
    expect(query.params.some((p) => typeof p === 'string' && p.includes('"label":"mamá"'))).toBe(false);
  });

  it('auto/agent writes are skipped when a human has pinned the stage — unchanged business logic (parity)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ customFields: { _funnel: { stage: 'customer', auto: false } } }]]);
    const ctx = { db: db as never, tenantId: 'org-1' };

    const result = await setFunnelStage(ctx, 'c1', 'loyal', { by: 'auto' });

    expect(result).toEqual({ applied: false, stage: 'customer' });
    expect(db.update).not.toHaveBeenCalled();
  });

  it('auto/agent writes never move the stage backward or sideways — advance-only (parity)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ customFields: { _funnel: { stage: 'customer', auto: true } } }]]);
    const ctx = { db: db as never, tenantId: 'org-1' };

    const result = await setFunnelStage(ctx, 'c1', 'opportunity', { by: 'auto' });

    expect(result).toEqual({ applied: false, stage: 'customer' });
    expect(db.update).not.toHaveBeenCalled();
  });

  it('a manual (`by: "user"`) override applies even over a pinned stage, writing through the atomic setter', async () => {
    const { tx, setCalls } = makeFunnelTx([
      [{ customFields: { _funnel: { stage: 'customer', auto: false } } }],
      [{ id: 'c1' }],
      [{}],
    ]);
    mockWithOrgCore.mockImplementationOnce((_scope, fn) => fn(tx));
    const ctx = { db: {} as never, tenantId: 'org-1' };

    const result = await setFunnelStage(ctx, 'c1', 'lead', { by: 'user' });

    expect(result.applied).toBe(true);
    expect(setCalls).toHaveLength(1);
  });
});
