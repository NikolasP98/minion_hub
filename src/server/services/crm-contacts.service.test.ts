import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { createMockDb } from '$server/test-utils/mock-db';
import { ensureAccountInScope, getContactGraph, customFieldsMergeSql } from './crm-contacts.service';

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
