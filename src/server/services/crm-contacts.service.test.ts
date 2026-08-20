import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { createMockDb } from '$server/test-utils/mock-db';
import { crmContacts } from '$server/db/pg-crm-schema';
import {
  ensureAccountInScope,
  getContactGraph,
  customFieldsMergeSql,
  rankContacts,
  rankContactsPage,
  contactCustomFieldSetSql,
  assertJsonValue,
  setContactCustomField,
  setFunnelStage,
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
// working. getContactGraph tests override it via useExecMock to hand back a
// bare `{ execute }` tx (avoids typing tx.execute onto the tenant-DB mock).
const mockWithOrgCore = vi.fn(
  (
    scope: { db: { transaction: (fn: (tx: unknown) => unknown) => unknown } },
    fn: (tx: unknown) => unknown,
  ) => scope.db.transaction((tx: unknown) => fn(tx)),
);

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

describe('getContactGraph', () => {
  const row = {
    contact_id: 'c1',
    label: 'John Smith',
    message_count: '5',
    last_at: '2026-07-01T00:00:00Z',
    relationship: {
      label: 'mamá',
      category: 'family',
      source: 'ai',
      updatedAt: '2026-07-01T00:00:00Z',
    },
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
  });
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
    revenue: 1200,
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
  });

  it('strips the helper columns — a page row is exactly a RankedContact', async () => {
    const execute = vi.fn().mockResolvedValueOnce([rankedRow()]);
    useExecMock(execute);

    const { rows } = await rankContactsPage(ctx, {});

    expect(rows[0]).not.toHaveProperty('total_rows');
    expect(rows[0]).not.toHaveProperty('revenue');
    expect(rows[0]).not.toHaveProperty('page_position');
    // …and the numeric coercion still applies to what remains.
    expect(rows[0].score).toBe(65);
    expect(rows[0].total_msgs).toBe(12);
  });

  it('an out-of-range page preserves the nonzero filtered total in one round trip', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ contact_id: null, total_rows: 25, page_position: null }]);
    useExecMock(execute);

    const page = await rankContactsPage(ctx, { limit: 100, offset: 99900 });

    expect(page).toEqual({ rows: [], total: 25 });
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
    // name = substring; phone + dni = prefix. A mid-string phone match would
    // need a leading '%', and there is exactly one of those (the name).
    expect(query.params.filter((p) => p === '%9876%')).toHaveLength(1);
    expect(query.params.filter((p) => p === '9876%')).toHaveLength(2);
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
    expect(await sqlWithFinance(true)).toContain('sum(coalesce(fi.total, 0))::float8 as revenue');
  });

  it('finances off: the stub CTE still declares revenue, so sort:revenue degrades instead of erroring', async () => {
    const sqlText = await sqlWithFinance(false);

    expect(sqlText).not.toContain('sum(coalesce(fi.total, 0))');
    expect(sqlText).toContain('null::float8 as revenue');
    expect(sqlText).toContain('revenue desc nulls last');
  });
});
