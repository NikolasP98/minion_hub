import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { createMockDb } from '$server/test-utils/mock-db';
import { crmContacts } from '$server/db/pg-crm-schema';
import {
  ensureAccountInScope,
  customFieldsMergeSql,
  rankContacts,
  rankContactsPage,
  getCrmDashboardStats,
  contactCustomFieldSetSql,
  assertJsonValue,
  setContactCustomField,
  setFunnelStage,
  listContactsCached,
  getMetaKeys,
  listContactChannels,
  softDeleteContacts,
} from './crm-contacts.service';

/**
 * A real Postgres engine (WASM-embedded, via pglite) rather than a mock —
 * for the cross-org isolation case a mock can only replay the row count it
 * was configured to return, which proves nothing about whether
 * `setContactCustomField`'s own `eq(orgId, ...)` predicate actually excludes
 * a mismatched org. Only `crm_contacts`' columns are created (the setter
 * touches none of the CRM tables' foreign relations).
 */
async function createRealCrmContactsDb() {
  const client = new PGlite();
  const db = drizzle(client);
  await client.exec(`
    create table crm_contacts (
      id uuid primary key,
      org_id text not null,
      human_id text,
      display_name text,
      profile_id uuid,
      owner_id uuid,
      party_id uuid,
      lifecycle_override text,
      source text not null default 'harvested',
      custom_fields jsonb not null default '{}'::jsonb,
      deleted_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);
  return { client, db };
}

// Default passthrough mirrors the real withOrgCore's `db.transaction(cb => cb(db))`
// shape (see mock-db.ts) — keeps ensureAccountInScope's select/insert chains
// working. Several describe blocks below override it via useExecMock to hand
// back a bare `{ execute }` tx (avoids typing tx.execute onto the tenant-DB mock).
const defaultWithOrgCore = (
  scope: { db: { transaction: (fn: (tx: unknown) => unknown) => unknown } },
  fn: (tx: unknown) => unknown,
) => scope.db.transaction((tx: unknown) => fn(tx));
const mockWithOrgCore = vi.fn(defaultWithOrgCore);

vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (scope: unknown, fn: (tx: unknown) => unknown) =>
    mockWithOrgCore(scope as never, fn),
}));

// rankContacts asks whether crm+finances are BOTH enabled before shaping the
// finance CTE, and that check runs its own withOrgCore round-trip — left real it
// would eat the exec mock queued for the ranking query itself.
const { mockBothEnabled } = vi.hoisted(() => ({ mockBothEnabled: vi.fn(async () => false) }));
vi.mock('./modules.service', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  bothEnabled: () => mockBothEnabled(),
}));

// Same reasoning as bothEnabled above: resolveDepositRule (called only when
// withFinance is true) issues its own withOrgCore round-trip via
// crm-settings.service.ts and would otherwise eat the exec mock
// queued for the ranking query.
const { mockResolveDepositRule } = vi.hoisted(() => ({
  mockResolveDepositRule: vi.fn(async () => ({ keywords: ['reserva'], label: 'Reserva' })),
}));
vi.mock('./crm-settings.service', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveDepositRule: () => mockResolveDepositRule(),
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
  const lockCalls: string[] = [];
  function next() {
    return Promise.resolve(sequence[cursor++] ?? []);
  }
  function chain(): Record<string, unknown> {
    return {
      from: () => chain(),
      where: () => chain(),
      for: (strength: string) => {
        lockCalls.push(strength);
        return chain();
      },
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
  return { tx, setCalls, lockCalls };
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
    const query = new PgDialect().sqlToQuery(
      customFieldsMergeSql({ distrito: 'Miraflores', edad: '34' }),
    );
    const jsonParam = query.params.find((p) => typeof p === 'string' && p.includes('distrito'));
    expect(jsonParam).toBe(JSON.stringify({ distrito: 'Miraflores', edad: '34' }));
  });
});

describe('contactCustomFieldSetSql (spec hub-funnel-atomic-write S1 — atomic per-key write)', () => {
  it('is a single jsonb_set targeting one key, never a SELECT of the column', () => {
    const query = new PgDialect().sqlToQuery(
      contactCustomFieldSetSql('_funnel', { stage: 'opportunity' }),
    );
    expect(query.sql).toContain('jsonb_set');
    expect(query.sql.toLowerCase()).not.toMatch(/\bselect\b/);
  });

  it('binds the key and value as params, never string-interpolated into the SQL text', () => {
    const query = new PgDialect().sqlToQuery(
      contactCustomFieldSetSql('_funnel', { stage: 'opportunity' }),
    );
    expect(query.sql).not.toContain('_funnel');
    expect(query.sql).not.toContain('opportunity');
    expect(query.params).toContain('_funnel');
    expect(query.params).toContain(JSON.stringify({ stage: 'opportunity' }));
  });

  it("a fragment for one key never carries another key's value as a param — the statement cannot clobber it", () => {
    const query = new PgDialect().sqlToQuery(
      contactCustomFieldSetSql('_relationship', { label: 'mamá' }),
    );
    expect(query.params).not.toContain('_funnel');
    expect(query.params.some((p) => typeof p === 'string' && p.includes('opportunity'))).toBe(
      false,
    );
  });
});

describe('setContactCustomField (S1 — shared atomic setter)', () => {
  it('reports applied when the update matches exactly one row', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'c1' }]);

    const applied = await setContactCustomField(db as never, 'org-1', 'c1', '_funnel', {
      stage: 'lead',
    });

    expect(applied).toBe(true);
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it("cross-org isolation on a real Postgres engine: same contact id under a different org updates zero rows and leaves org-A's row unchanged", async () => {
    const { client, db } = await createRealCrmContactsDb();
    try {
      const contactId = crypto.randomUUID();
      await db.insert(crmContacts).values({
        id: contactId,
        orgId: 'org-A',
        customFields: { _funnel: { stage: 'lead' } },
      });

      const applied = await db.transaction((tx) =>
        setContactCustomField(tx as never, 'org-B', contactId, '_funnel', { stage: 'customer' }),
      );
      expect(applied).toBe(false);

      const [row] = await db.select().from(crmContacts).where(eq(crmContacts.id, contactId));
      expect(row.orgId).toBe('org-A');
      expect(row.customFields).toEqual({ _funnel: { stage: 'lead' } }); // unchanged

      // Sanity: the same write through the OWNING org does apply and does persist —
      // proves the zero-rows result above is the org predicate, not a broken statement.
      const appliedSameOrg = await db.transaction((tx) =>
        setContactCustomField(tx as never, 'org-A', contactId, '_funnel', { stage: 'customer' }),
      );
      expect(appliedSameOrg).toBe(true);

      const [rowAfter] = await db.select().from(crmContacts).where(eq(crmContacts.id, contactId));
      expect(rowAfter.customFields).toEqual({ _funnel: { stage: 'customer' } });
    } finally {
      await client.close();
    }
  }, 15_000); // PGlite WASM cold-start is slower under the fully parallel suite.
});

describe('assertJsonValue (S1 — reject non-JSON values before they reach SQL)', () => {
  it('accepts plain JSON-shaped values (string/number/boolean/null/array/nested object)', () => {
    expect(() =>
      assertJsonValue({ a: 1, b: 'x', c: true, d: null, e: [1, 2, { f: 'g' }] }),
    ).not.toThrow();
  });

  it('rejects undefined', () => {
    expect(() => assertJsonValue(undefined)).toThrow();
  });

  it('rejects undefined nested inside an object', () => {
    expect(() => assertJsonValue({ a: undefined })).toThrow();
  });

  it('rejects NaN', () => {
    expect(() => assertJsonValue(Number.NaN)).toThrow();
  });

  it('rejects Infinity and -Infinity', () => {
    expect(() => assertJsonValue(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => assertJsonValue(Number.NEGATIVE_INFINITY)).toThrow();
  });

  it('rejects a circular reference instead of hanging or throwing an opaque stack overflow', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(() => assertJsonValue(obj)).toThrow();
  });

  it('rejects functions and other non-JSON types', () => {
    expect(() => assertJsonValue(() => {})).toThrow();
    expect(() => assertJsonValue(Symbol('x'))).toThrow();
    expect(() => assertJsonValue(10n)).toThrow();
  });

  it('rejects a Map instead of silently round-tripping to `{}`', () => {
    expect(() => assertJsonValue(new Map([['stage', 'customer']]))).toThrow();
  });

  it('rejects a Date instead of silently round-tripping to a string', () => {
    expect(() => assertJsonValue(new Date())).toThrow();
  });

  it('accepts an acyclic value that references the same child object from two properties', () => {
    const shared = { x: 1 };
    expect(() => assertJsonValue({ a: shared, b: shared })).not.toThrow();
  });

  it('accepts the same array value repeated as siblings, not just as a cycle', () => {
    const shared = [1, 2, 3];
    expect(() => assertJsonValue([shared, shared])).not.toThrow();
  });

  it('contactCustomFieldSetSql rejects an invalid value before building SQL', () => {
    expect(() => contactCustomFieldSetSql('_funnel', { stage: Number.NaN } as never)).toThrow();
  });
});

describe('setFunnelStage (S1 — converted off whole-column read-modify-write)', () => {
  it('locks the contact row before deciding and holds the lock through the write/activity transaction', async () => {
    const { tx, lockCalls } = makeFunnelTx([
      [{ customFields: { _funnel: { stage: 'lead', auto: true } } }],
      [{ id: 'c1' }],
      [{}],
    ]);
    mockWithOrgCore.mockImplementationOnce((_scope, fn) => fn(tx));

    const result = await setFunnelStage({ db: {} as never, tenantId: 'org-1' }, 'c1', 'customer', {
      by: 'auto',
    });

    expect(result).toEqual({ applied: true, stage: 'customer' });
    expect(lockCalls).toEqual(['update']);
  });

  it('writes via ONE atomic jsonb_set targeting only `_funnel` — not a whole-object merge back over the column', async () => {
    // The stored row carries two OTHER reserved/user keys the old RMW write
    // would have silently reproduced only by accident (spread order) — the
    // fixed writer never even reads them into the outgoing statement.
    const existing = {
      _relationship: {
        label: 'mamá',
        category: 'family',
        source: 'ai',
        updatedAt: '2026-08-01T00:00:00Z',
      },
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
    const query = new PgDialect().sqlToQuery(
      setCalls[0].customFields as Parameters<typeof PgDialect.prototype.sqlToQuery>[0],
    );
    expect(query.sql).toContain('jsonb_set');
    expect(query.sql.toLowerCase()).not.toMatch(/\bselect\b/);
    expect(query.params).toContain('_funnel');
    // Neither other reserved key's value nor the user field's value is bound
    // into this statement — jsonb_set's path targets `_funnel` only, so a
    // concurrent writer of `_relationship` or `someUserField` can never be
    // clobbered by this one, regardless of commit order.
    expect(query.params.some((p) => typeof p === 'string' && p.includes('someUserField'))).toBe(
      false,
    );
    expect(query.params.some((p) => typeof p === 'string' && p.includes('"label":"mamá"'))).toBe(
      false,
    );
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

// ── S1: paged query with total (rankContactsPage) ────────────────────────────

/** Minimal shape the post-query mapping in runRankQuery touches. */
function rankedRow(over: Record<string, unknown> = {}) {
  return {
    contact_id: 'c1',
    display_name: 'Marisol',
    owner_id: null,
    source: 'ledger',
    total_msgs: '12',
    inbound_msgs: '7',
    channels_used: '2',
    channels: ['whatsapp'],
    identities: [{ channel: 'whatsapp', externalId: '51987654321', handle: null }],
    tag_ids: [],
    custom_fields: { telefono: '51987654321' },
    party_id: null,
    dni_verified: false,
    age: null,
    dob: null,
    sex: null,
    first_contact_at: null,
    last_contact_at: null,
    is_buyer: false,
    awaiting_reply: false,
    lead_origin: null,
    lead_campaign: null,
    last_days: '3.0',
    reciprocity: '0.5',
    r_score: '80',
    f_score: '60',
    m_score: '40',
    score: '65',
    stage: 'Engaged',
    funnel_stage: 'lead',
    revenue: 1200,
    fin_invoices: 3,
    fin_last_purchase_at: '2026-08-20T12:00:00.000Z',
    fin_purchased: true,
    fin_reserved_only: false,
    fin_loyal: true,
    page_position: 1,
    total_rows: 1543,
    ...over,
  };
}

describe('rankContactsPage (S1 — one round-trip page + filtered total)', () => {
  const ctx = { db: {} as never, tenantId: 'org-1' };

  it('reads the total from the filtered set before limit/offset', async () => {
    const execute = vi.fn().mockResolvedValueOnce([rankedRow(), rankedRow({ contact_id: 'c2' })]);
    useExecMock(execute);

    const page = await rankContactsPage(ctx, { limit: 2 });

    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(query.sql).toContain('select count(*)::int as total_rows from filtered');
    expect(page.rows).toHaveLength(2);
    expect(page.total).toBe(1543); // ≫ the 2 rows on this page
    expect(page.hasMore).toBe(true);
    expect(page.financeEnabled).toBe(false);
  });

  it('skips the exact count for continuation pages and uses one look-ahead row', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        rankedRow(),
        rankedRow({ contact_id: 'c2', page_position: 2 }),
        rankedRow({ contact_id: 'c3', page_position: 3 }),
      ]);
    useExecMock(execute);

    const page = await rankContactsPage(ctx, { limit: 2, offset: 2, includeTotal: false });

    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(query.sql).not.toContain('select count(*)::int as total_rows from filtered');
    expect(page.rows.map((r) => r.contact_id)).toEqual(['c1', 'c2']);
    expect(page.total).toBeNull();
    expect(page.hasMore).toBe(true);
  });

  it('decorates finance from the page query and strips its SQL helper columns', async () => {
    mockBothEnabled.mockResolvedValueOnce(true);
    const execute = vi.fn().mockResolvedValueOnce([rankedRow()]);
    useExecMock(execute);

    const { rows } = await rankContactsPage(ctx, {});

    expect(rows[0]).not.toHaveProperty('total_rows');
    expect(rows[0]).not.toHaveProperty('revenue');
    expect(rows[0]).not.toHaveProperty('fin_invoices');
    expect(rows[0]).not.toHaveProperty('fin_last_purchase_at');
    expect(rows[0]).not.toHaveProperty('fin_purchased');
    expect(rows[0]).not.toHaveProperty('fin_reserved_only');
    expect(rows[0]).not.toHaveProperty('fin_loyal');
    expect(rows[0]).not.toHaveProperty('page_position');
    expect(rows[0].finance).toEqual({
      revenue: 1200,
      invoices: 3,
      lastPurchaseAt: '2026-08-20T12:00:00.000Z',
      purchased: true,
      reservedOnly: false,
      loyal: true,
    });
    // …and the numeric coercion still applies to what remains.
    expect(rows[0].score).toBe(65);
    expect(rows[0].total_msgs).toBe(12);
  });

  it('runs identity and tag decoration after the requested page has been bounded', async () => {
    const execute = vi.fn().mockResolvedValueOnce([]);
    useExecMock(execute);

    await rankContactsPage(ctx, { limit: 100 });

    const sqlText = new PgDialect().sqlToQuery(execute.mock.calls[0][0]).sql;
    const pageAt = sqlText.indexOf('requested_page as');
    expect(pageAt).toBeGreaterThan(-1);
    expect(sqlText.indexOf("json_build_object('channel'", pageAt)).toBeGreaterThan(pageAt);
    expect(sqlText.indexOf('array_agg(ct.tag_id::text)', pageAt)).toBeGreaterThan(pageAt);
  });

  it('keeps LIMIT eligible for a top-N sort instead of numbering the full filtered roster', async () => {
    const execute = vi.fn().mockResolvedValueOnce([]);
    useExecMock(execute);

    await rankContactsPage(ctx, { sort: 'name', limit: 100, includeTotal: false });

    const sqlText = new PgDialect().sqlToQuery(execute.mock.calls[0][0]).sql;
    expect(sqlText).toContain('requested_page as');
    expect(sqlText).toContain('order by display_name asc nulls last, contact_id asc');
    expect(sqlText).not.toContain('row_number() over');
  });

  it('builds lead attribution once instead of probing it laterally for every contact', async () => {
    const execute = vi.fn().mockResolvedValueOnce([]);
    useExecMock(execute);

    await rankContactsPage(ctx, { limit: 100 });

    const sqlText = new PgDialect().sqlToQuery(execute.mock.calls[0][0]).sql;
    expect(sqlText).toContain('lead_attr as');
    expect(sqlText).toContain('distinct on (ci.contact_id)');
    expect(sqlText).toContain('left join lead_attr attr on attr.contact_id = c.id');
    expect(sqlText).not.toContain('left join lateral');
  });

  it('an out-of-range page preserves the nonzero filtered total in one round trip', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ contact_id: null, total_rows: 25, page_position: null }]);
    useExecMock(execute);

    const page = await rankContactsPage(ctx, { limit: 100, offset: 99900 });

    expect(page).toEqual({
      rows: [],
      total: 25,
      hasMore: false,
      financeEnabled: false,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rankContacts keeps its pre-pagination contract — rows only', async () => {
    const execute = vi.fn().mockResolvedValueOnce([rankedRow()]);
    useExecMock(execute);

    const out = await rankContacts(ctx, {});

    expect(Array.isArray(out)).toBe(true);
    expect(out[0].contact_id).toBe('c1');
    expect(out[0]).not.toHaveProperty('total_rows');
  });
});

describe('getCrmDashboardStats', () => {
  it('returns one compact SQL aggregate with the roster scoring and finance semantics', async () => {
    const { configureCache, MemoryBackend } = await import('@minion-stack/cache');
    configureCache({ backend: new MemoryBackend(), namespace: `crm-dashboard-${Math.random()}` });
    mockBothEnabled.mockResolvedValueOnce(true);
    mockResolveDepositRule.mockResolvedValueOnce({ keywords: ['reserva'], label: 'Reserva' });
    const execute = vi.fn().mockResolvedValueOnce([
      {
        total: 8,
        stage_new: 1,
        stage_engaged: 2,
        stage_active: 3,
        stage_dormant: 1,
        stage_churned: 1,
        new_count: 2,
        active_week: 3,
        avg_score: 64,
        score_buckets: [0, 0, 0, 0, 1, 1, 2, 1, 2, 1],
        temp_hot: 4,
        temp_warm: 3,
        temp_cold: 1,
        funnel_lead: 4,
        funnel_opportunity: 2,
        funnel_customer: 1,
        funnel_loyal: 1,
        inbound_contacts: 6,
        awaiting: 2,
        awaiting_hot: 1,
        awaiting_warm: 1,
        awaiting_cold: 0,
        booked: 4,
        bought: 2,
        origin_ad: 3,
        origin_organic: 2,
        origin_untracked: 3,
        channels: [
          { channel: 'instagram', count: 5 },
          { channel: 'whatsapp', count: 3 },
        ],
        campaigns: [{ name: 'Launch', count: 2 }],
        finance_revenue: 900,
        finance_invoices: 3,
        finance_buyers: 4,
        finance_customers: 2,
        finance_reserved: 1,
        finance_loyal: 1,
      },
    ]);
    useExecMock(execute);

    const stats = await getCrmDashboardStats(
      { db: {} as never, tenantId: 'org-dashboard' },
      {
        ownerId: 'owner-1',
        from: new Date('2026-08-01T00:00:00Z'),
        to: new Date('2026-08-25T23:59:59Z'),
      },
    );

    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(query.sql).toContain('from scoped');
    expect(query.sql).toContain("count(*) filter (where stage = 'Active')");
    expect(query.sql).toContain('select distinct s.contact_id, ci.channel');
    expect(query.sql).toContain('from contact_invoice_class');
    expect(query.sql).not.toContain('requested_page as');
    expect(query.params).toEqual(
      expect.arrayContaining([
        'owner-1',
        new Date('2026-08-01T00:00:00Z'),
        new Date('2026-08-25T23:59:59Z'),
      ]),
    );
    expect(stats).toMatchObject({
      total: 8,
      avgScore: 64,
      stageCounts: { Active: 3, Churned: 1 },
      funnelCounts: { lead: 4, opportunity: 2, customer: 1, loyal: 1 },
      response: { inboundContacts: 6, awaiting: 2, answered: 4, responseRate: 67 },
      conversion: { leads: 6, booked: 4, bought: 2, bookedRate: 67, boughtRate: 50 },
      revenue: { revenue: 900, invoices: 3, buyers: 4, avgTicket: 300 },
    });
    expect(stats.channels).toEqual([
      { channel: 'instagram', count: 5 },
      { channel: 'whatsapp', count: 3 },
    ]);
  });
});

describe('rankContacts sorting (S1 — server-side ICP + revenue)', () => {
  const ctx = { db: {} as never, tenantId: 'org-1' };

  async function sqlFor(f: Parameters<typeof rankContacts>[1]) {
    const execute = vi.fn().mockResolvedValueOnce([]);
    useExecMock(execute);
    await rankContacts(ctx, f);
    return new PgDialect().sqlToQuery(execute.mock.calls[0][0]).sql;
  }

  it("sort:'icp' orders by the stored _icp score with unscored rows LAST, never as 0", async () => {
    const sqlText = await sqlFor({ sort: 'icp' });

    expect(sqlText).toContain("(custom_fields->'_icp'->>'score')::numeric");
    // A missing/typeless _icp yields NULL (not 0) and `nulls last` sinks it.
    expect(sqlText).toContain("jsonb_typeof(custom_fields->'_icp'->'score') = 'number'");
    expect(sqlText).toMatch(/order by[\s\S]*end\)\s*desc nulls last/);
  });

  it("sort:'revenue' orders by the finance-bridge revenue sum, nulls last", async () => {
    const sqlText = await sqlFor({ sort: 'revenue' });

    expect(sqlText).toMatch(/order by\s*\n?\s*revenue desc nulls last/);
  });

  it('the default sort keeps score/name precedence and ends with a unique contact id', async () => {
    const sqlText = await sqlFor({});

    expect(sqlText).toMatch(
      /order by\s*\n?\s*score desc, display_name asc nulls last, contact_id asc/,
    );
  });

  it.each(['recent', 'frequency', 'name', 'revenue', 'icp'] as const)(
    "sort '%s' ends with contact_id so tied rows have one stable page order",
    async (sort) => {
      const sqlText = await sqlFor({ sort });

      expect(sqlText).toMatch(/order by[\s\S]*contact_id asc/);
    },
  );
});

describe('rankContacts search (S1 — phone/DNI exact-prefix)', () => {
  const ctx = { db: {} as never, tenantId: 'org-1' };

  it('matches display_name mid-string but telefono/dni only as a PREFIX', async () => {
    const execute = vi.fn().mockResolvedValueOnce([]);
    useExecMock(execute);

    await rankContacts(ctx, { search: '9876' });

    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(query.sql).toContain("c.custom_fields->>'telefono' like");
    expect(query.sql).toContain('p.doc_number like');
    // name = substring; phone + custom_fields.dni + party-spine doc_number =
    // prefix. A mid-string phone match would need a leading '%', and there is
    // exactly one of those (the name).
    expect(query.params.filter((p) => p === '%9876%')).toHaveLength(1);
    expect(query.params.filter((p) => p === '9876%')).toHaveLength(3);
  });

  it('DNI search uses the custom_fields prefix required by the server-pagination contract', async () => {
    const execute = vi.fn().mockResolvedValueOnce([]);
    useExecMock(execute);

    await rankContacts(ctx, { search: '4455' });

    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(query.sql).toContain("c.custom_fields->>'dni' like");
  });

  it('a field-level-masked principal never searches the raw phone/DNI it cannot read', async () => {
    const execute = vi.fn().mockResolvedValueOnce([]);
    useExecMock(execute);

    await rankContacts(ctx, { search: '5198', maskSensitive: true });

    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    // Masked callers receive `•••••4321`; matching the raw column would let them
    // recover the hidden digits by lengthening the prefix one probe at a time.
    expect(query.sql).not.toContain("c.custom_fields->>'telefono' like");
    expect(query.sql).not.toContain("c.custom_fields->>'dni' like");
    expect(query.sql).not.toContain('p.doc_number like');
    expect(query.sql).toContain('c.display_name ilike');
    expect(query.params).not.toContain('5198%');
    expect(query.params).toContain('%5198%');
  });

  it('no search term adds no search predicate at all', async () => {
    const execute = vi.fn().mockResolvedValueOnce([]);
    useExecMock(execute);

    await rankContacts(ctx, {});

    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(query.sql).not.toContain("c.custom_fields->>'telefono' like");
    expect(query.sql).not.toContain('display_name ilike');
  });
});

describe('rankContacts channel filter', () => {
  const ctx = { db: {} as never, tenantId: 'org-1' };

  it('correlates the identity probe to the scored contact instead of matching itself', async () => {
    const execute = vi.fn().mockResolvedValueOnce([]);
    useExecMock(execute);

    await rankContacts(ctx, { channel: 'instagram' });

    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(query.sql).toContain('ci2.contact_id = scored.contact_id');
    expect(query.sql).not.toContain('ci2.contact_id = contact_id');
  });
});

describe('rankContacts revenue column (S1 — order-by fuel, not part of the payload)', () => {
  const ctx = { db: {} as never, tenantId: 'org-1' };

  async function sqlWithFinance(enabled: boolean) {
    mockBothEnabled.mockResolvedValueOnce(enabled);
    const execute = vi.fn().mockResolvedValueOnce([]);
    useExecMock(execute);
    await rankContacts(ctx, { sort: 'revenue' });
    return new PgDialect().sqlToQuery(execute.mock.calls[0][0]).sql;
  }

  it('crm+finances on: the finance CTE sums invoice totals per contact', async () => {
    const sqlText = await sqlWithFinance(true);

    // S2 folded this CTE onto the shared per-invoice classification rows
    // (CONTACT_INVOICE_CLASS) so the funnel floor and ContactFinance cannot
    // drift; revenue is still the same sum of invoice totals.
    expect(sqlText).toContain('coalesce(fi.total,0)::float8 total');
    expect(sqlText).toContain('sum(total)::float8 as revenue');
    expect(sqlText).toContain('from contact_invoice_class');
  });

  it('finances off: the stub CTE still declares revenue, so sort:revenue degrades instead of erroring', async () => {
    const sqlText = await sqlWithFinance(false);

    expect(sqlText).not.toContain('contact_invoice_class');
    expect(sqlText).toContain('null::float8 as revenue');
    expect(sqlText).toContain('revenue desc nulls last');
  });
});

describe('rankContacts finance CTE deposit rule (Slice 1 — same resolved rule as crm-finance.service)', () => {
  const ctx = { db: {} as never, tenantId: 'org-1' };

  it("crm+finances on with the default rule binds '%reserva%', matching crm-finance.service's default", async () => {
    mockBothEnabled.mockResolvedValueOnce(true);
    mockResolveDepositRule.mockResolvedValueOnce({ keywords: ['reserva'], label: 'Reserva' });
    const execute = vi.fn().mockResolvedValueOnce([]);
    useExecMock(execute);

    await rankContacts(ctx, { sort: 'revenue' });

    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(query.sql).toContain('from contact_invoice_class');
    expect(query.params).toContain('%reserva%');
    expect(query.params).not.toContain('%adelanto%');
  });

  it('a custom resolved rule binds its own escaped keywords in the finance CTE, never %reserva%', async () => {
    mockBothEnabled.mockResolvedValueOnce(true);
    mockResolveDepositRule.mockResolvedValueOnce({
      keywords: ['adelanto', 'seña'],
      label: 'Adelanto',
    });
    const execute = vi.fn().mockResolvedValueOnce([]);
    useExecMock(execute);

    await rankContacts(ctx, { sort: 'revenue' });

    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(query.params).toEqual(
      expect.arrayContaining(['%adelanto%', '%seña%', '%adelanto%', '%seña%']),
    );
    expect(query.params).not.toContain('%reserva%');
  });

  it('an explicitly empty keyword set compiles the finance CTE to literal false/true — no dropped predicate', async () => {
    mockBothEnabled.mockResolvedValueOnce(true);
    mockResolveDepositRule.mockResolvedValueOnce({ keywords: [], label: 'None' });
    const execute = vi.fn().mockResolvedValueOnce([]);
    useExecMock(execute);

    await rankContacts(ctx, { sort: 'revenue' });

    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(query.sql).toContain('bool_or(false) has_deposit');
    expect(query.sql).toContain('bool_or((ii.description is not null and true)) has_proc');
    // No deposit-keyword ILIKE pattern is bound at all — an empty rule drops
    // the predicate's PARAMS, not the predicate itself (still `false`/`true`).
    expect(query.params.filter((p) => typeof p === 'string' && p.startsWith('%'))).toHaveLength(0);
  });
});

/**
 * The roster the CRM dashboard and the Customers page actually consume is the
 * CACHED one, and its rows carry the deposit-derived `fin_purchased` /
 * `fin_reserved_only` → `funnel_stage`. A cache identity that ignores the rule
 * would serve the previous classification for the whole TTL+SWR window after a
 * same-tenant settings change — the failure this fixture pins.
 */
describe('listContactsCached rule sensitivity', () => {
  /** One roster row, only the fields the mapper touches plus the classification. */
  const rosterRow = (funnelStage: string) => ({
    contact_id: 'c1',
    total_rows: 1,
    page_position: 1,
    custom_fields: {},
    identities: [],
    funnel_stage: funnelStage,
  });

  it('a same-tenant rule change is visible on the very next call, and each rule keeps its own entry', async () => {
    const { configureCache, MemoryBackend } = await import('@minion-stack/cache');
    configureCache({ backend: new MemoryBackend(), namespace: 'crm-contacts-rule-test' });
    const tenant = 'org-roster-fingerprint';
    const scoped = { db: {} as never, tenantId: tenant };

    // Default rule: the deposit line classifies c1 as reserved-only.
    mockBothEnabled.mockResolvedValueOnce(true);
    mockResolveDepositRule.mockResolvedValueOnce({ keywords: ['reserva'], label: 'Reserva' });
    useExecMock(vi.fn().mockResolvedValueOnce([rosterRow('reserved')]));
    const first = await listContactsCached(scoped);
    expect(first[0]).toMatchObject({ funnel_stage: 'reserved' });

    // Custom rule, same tenant: the same line is no longer a deposit, so the
    // roster must recompute rather than replay the cached 'reserved' payload.
    mockBothEnabled.mockResolvedValueOnce(true);
    mockResolveDepositRule.mockResolvedValueOnce({ keywords: ['adelanto'], label: 'Adelanto' });
    useExecMock(vi.fn().mockResolvedValueOnce([rosterRow('customer')]));
    const second = await listContactsCached(scoped);
    expect(second[0]).toMatchObject({ funnel_stage: 'customer' });

    // Explicitly empty keywords: a third distinct rule, a third distinct entry.
    mockBothEnabled.mockResolvedValueOnce(true);
    mockResolveDepositRule.mockResolvedValueOnce({ keywords: [], label: 'None' });
    useExecMock(vi.fn().mockResolvedValueOnce([rosterRow('customer-empty-rule')]));
    const third = await listContactsCached(scoped);
    expect(third[0]).toMatchObject({ funnel_stage: 'customer-empty-rule' });

    // Back to the default rule inside its TTL: a genuine cache HIT, so the
    // loader's poison rows must never surface — proving these are separate
    // entries rather than one entry being blown away each time.
    mockBothEnabled.mockResolvedValueOnce(true);
    mockResolveDepositRule.mockResolvedValueOnce({ keywords: ['reserva'], label: 'Reserva' });
    const poison = vi.fn().mockResolvedValueOnce([rosterRow('POISON')]);
    useExecMock(poison);
    const fourth = await listContactsCached(scoped);
    expect(fourth[0]).toMatchObject({ funnel_stage: 'reserved' });
    expect(poison).not.toHaveBeenCalled();
  });
});

describe('getMetaKeys (S3 meta-column discovery)', () => {
  it('returns the distinct custom_fields keys and serves repeats from cache', async () => {
    // The previous describe block's last case deliberately leaves a queued
    // mockImplementationOnce unconsumed (it asserts the poisoned loader is
    // never called on a cache hit). mockImplementationOnce queues survive
    // vi.clearAllMocks(), so drain it here or it silently backs THIS test's
    // first withOrgCore call instead of the one useExecMock queues below.
    mockWithOrgCore.mockReset();
    mockWithOrgCore.mockImplementation(defaultWithOrgCore);

    const { configureCache, MemoryBackend } = await import('@minion-stack/cache');
    configureCache({ backend: new MemoryBackend(), namespace: 'crm-meta-keys-test' });
    const scoped = { db: {} as never, tenantId: 'org-meta-keys' };

    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ key: 'dni' }, { key: 'edad' }, { key: 'telefono' }]);
    useExecMock(execute);
    const first = await getMetaKeys(scoped);
    // set equality against the fixture roster's key domain
    expect(new Set(first)).toEqual(new Set(['telefono', 'dni', 'edad']));
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(query.sql).toContain('jsonb_object_keys(custom_fields)');
    expect(query.sql).toContain('deleted_at is null');

    // second call inside the TTL: cache HIT — no second roster scan
    const poison = vi.fn().mockResolvedValueOnce([{ key: 'POISON' }]);
    useExecMock(poison);
    const second = await getMetaKeys(scoped);
    expect(second).toEqual(first);
    expect(poison).not.toHaveBeenCalled();
  });
});

describe('listContactChannels (organization-wide filter options)', () => {
  it('returns distinct live-contact channels and serves repeats from cache', async () => {
    mockWithOrgCore.mockReset();
    mockWithOrgCore.mockImplementation(defaultWithOrgCore);
    const { configureCache, MemoryBackend } = await import('@minion-stack/cache');
    configureCache({ backend: new MemoryBackend(), namespace: 'crm-contact-channels-test' });
    const scoped = { db: {} as never, tenantId: 'org-contact-channels' };

    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ channel: 'instagram' }, { channel: 'whatsapp' }]);
    useExecMock(execute);
    const first = await listContactChannels(scoped);

    expect(first).toEqual(['instagram', 'whatsapp']);
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(query.sql).toContain('select distinct ci.channel');
    expect(query.sql).toContain('c.deleted_at is null');

    const poison = vi.fn().mockResolvedValueOnce([{ channel: 'POISON' }]);
    useExecMock(poison);
    await expect(listContactChannels(scoped)).resolves.toEqual(first);
    expect(poison).not.toHaveBeenCalled();
  });
});

describe('softDeleteContacts', () => {
  it('deduplicates ids and writes the update plus audit batch in one org transaction', async () => {
    mockWithOrgCore.mockReset();
    const returning = vi
      .fn()
      .mockResolvedValue([
        { id: '00000000-0000-4000-8000-000000000001' },
        { id: '00000000-0000-4000-8000-000000000002' },
      ]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const values = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn(() => ({ values }));
    const tx = { update, insert };
    mockWithOrgCore.mockImplementationOnce((_scope, fn) => fn(tx as never));
    const ctx = { db: {} as never, tenantId: 'org-1', profileId: 'profile-1' };
    const ids = [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ];

    await expect(softDeleteContacts(ctx, ids)).resolves.toBe(2);

    expect(update).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledOnce();
    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({ refId: ids[0], op: 'delete', actorId: 'profile-1' }),
      expect.objectContaining({ refId: ids[2], op: 'delete', actorId: 'profile-1' }),
    ]);
    expect(mockWithOrgCore).toHaveBeenCalledOnce();
  });
});
