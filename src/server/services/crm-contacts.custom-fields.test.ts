import { describe, it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';
import { crmContacts } from '$server/db/pg-crm-schema';

/**
 * `custom_fields` write-contract coverage — spec 2026-08-18-hub-funnel-atomic-write, S2.
 *
 * S1 made the reserved-key writers (`_funnel`, `_relationship`, `_journey`)
 * atomic. S2 closes the race's other half: every remaining writer of the same
 * column. Two of them exist, with DELIBERATELY DIFFERENT contracts, and this
 * file pins both against a real Postgres engine so "atomic" can never be
 * confused with "changed what the write means":
 *
 *  - `customFields`      — the contact-detail PATCH route's contract: the payload
 *                          IS the whole user-editable namespace, so an omitted
 *                          user key is a DELETION. Stored `_`-reserved keys are
 *                          preserved regardless (the editor never sees them).
 *  - `customFieldsPatch` — the gateway `contact-update` action's contract (new in
 *                          S2): set these keys, leave every other key alone. It
 *                          replaces a `getContact` → spread-in-JS → whole-namespace
 *                          write, i.e. the last lost-update site on this column.
 *
 * Both compile to ONE `UPDATE` whose SET expression reads the pre-update row
 * inside the statement, so there is no application-visible window in which a
 * concurrent writer's key can be lost.
 */

vi.mock('@minion-stack/cache', () => ({
  cached: (_k: string, _o: unknown, fn: () => Promise<unknown>) => fn(),
  keys: { hub: () => 'k' },
  invalidateTags: async () => {},
  tags: { tenantDomain: () => ['t'] },
}));

/**
 * Production `withOrgCore` opens ONE transaction per call and services nest
 * calls freely (`updateContact` → `recordAudit`), because postgres-js hands out
 * a fresh pooled connection each time. pglite is a single session, so a nested
 * `db.transaction()` would wait forever on its own outer transaction — this
 * stand-in is reentrant: the outermost call owns the transaction, inner calls
 * join it. That matches production's isolation for this test's purposes (the
 * audit insert is in the same unit of work as the write it describes).
 */
let openTx: unknown = null;
type OrgScope = { db: { transaction: (fn: (tx: unknown) => unknown) => unknown } };
function reentrantWithOrgCore(scope: OrgScope, fn: (tx: unknown) => unknown) {
  if (openTx) return fn(openTx);
  return scope.db.transaction(async (tx: unknown) => {
    openTx = tx;
    try {
      return await fn(tx);
    } finally {
      openTx = null;
    }
  });
}
const mockWithOrgCore = vi.fn(reentrantWithOrgCore);
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (scope: unknown, fn: (tx: unknown) => unknown) =>
    mockWithOrgCore(scope as never, fn),
}));

import {
  customFieldsMergeSql,
  customFieldsPatchSql,
  updateContact,
  setFunnelStage,
} from './crm-contacts.service';

const ORG = 'org-1';
const dialect = new PgDialect();

/** Only the tables `updateContact` + `setFunnelStage` touch, with the columns they read. */
async function createContactsDb() {
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
    create table crm_contact_identities (
      id uuid primary key default gen_random_uuid(),
      org_id text not null, contact_id uuid not null, channel text not null,
      external_id text not null, handle text,
      created_at timestamptz not null default now()
    );
    create table crm_activities (
      id uuid primary key default gen_random_uuid(),
      org_id text not null,
      contact_id uuid not null references crm_contacts(id) on delete cascade,
      kind text not null,
      body text,
      actor_id uuid,
      data jsonb not null default '{}'::jsonb,
      occurred_at timestamptz not null default now(),
      created_at timestamptz not null default now()
    );
    create table doc_audit_log (
      id uuid primary key default gen_random_uuid(),
      org_id text not null,
      ref_type text not null,
      ref_id uuid not null,
      actor_id uuid,
      actor_name text,
      op text not null default 'update',
      changes jsonb not null default '[]'::jsonb,
      occurred_at timestamptz not null default now()
    );
  `);
  await client.exec(`select set_config('app.current_org_id', '${ORG}', false);`);
  return { client, db };
}

async function seedContact(client: PGlite, customFields: Record<string, unknown>) {
  const contactId = crypto.randomUUID();
  await client.query(
    `insert into crm_contacts (id, org_id, source, display_name, custom_fields)
     values ($1, $2, 'manual', 'Ana', $3::jsonb)`,
    [contactId, ORG, JSON.stringify(customFields)],
  );
  return contactId;
}

async function readFields(db: ReturnType<typeof drizzle>, contactId: string) {
  const [row] = await db
    .select({ cf: crmContacts.customFields })
    .from(crmContacts)
    .where(eq(crmContacts.id, contactId));
  return row.cf as Record<string, unknown>;
}

const ctxFor = (db: ReturnType<typeof drizzle>) => ({ db: db as never, tenantId: ORG });

// ── Statement shape ─────────────────────────────────────────────────────────

describe('customFieldsPatchSql (S2 — partial merge, no application-side read)', () => {
  it('merges the caller\'s keys OVER the pre-update row, in one statement with no SELECT', () => {
    const query = dialect.sqlToQuery(customFieldsPatchSql({ email: 'ana@example.com' }));
    // The left operand is the stored column read inside the UPDATE's own SET
    // expression — that is what makes the merge atomic instead of a snapshot.
    expect(query.sql).toContain('custom_fields');
    expect(query.sql.toLowerCase()).not.toMatch(/\bselect\b/);
    // `||` with the caller's payload on the RIGHT: submitted keys win, every
    // other stored key (user or reserved) passes through.
    expect(query.sql).toContain('||');
  });

  it('binds the payload as a param — never string-interpolated into the SQL text', () => {
    const query = dialect.sqlToQuery(customFieldsPatchSql({ email: "o'brien@example.com" }));
    expect(query.sql).not.toContain('example.com');
    expect(query.params).toContain(JSON.stringify({ email: "o'brien@example.com" }));
  });

  it('strips a caller-supplied `_`-reserved key before it reaches SQL', () => {
    const query = dialect.sqlToQuery(
      customFieldsPatchSql({ email: 'ana@example.com', _funnel: { stage: 'customer' } }),
    );
    const payload = query.params.find((p) => typeof p === 'string' && p.includes('email'));
    expect(String(payload)).not.toContain('_funnel');
  });

  it('differs from customFieldsMergeSql in exactly one way: omission is not deletion', () => {
    // The whole-namespace form has to enumerate the stored reserved keys to
    // rebuild them; the patch form does not, because it never drops anything.
    expect(dialect.sqlToQuery(customFieldsMergeSql({ a: 1 })).sql).toContain('jsonb_each');
    expect(dialect.sqlToQuery(customFieldsPatchSql({ a: 1 })).sql).not.toContain('jsonb_each');
  });
});

// ── Real engine: the two contracts ──────────────────────────────────────────

describe('updateContact custom_fields contracts against a real Postgres engine', () => {
  it('`customFields` (PATCH route): add, overwrite, and omission-as-deletion — reserved keys survive all three', async () => {
    const { client, db } = await createContactsDb();
    try {
      const contactId = await seedContact(client, {
        _funnel: { stage: 'lead', auto: true },
        _relationship: { label: 'mamá' },
        distrito: 'Miraflores',
        edad: '34',
      });
      const ctx = ctxFor(db);

      // Overwrite `distrito`, ADD `email`, OMIT `edad`.
      await updateContact(ctx, contactId, {
        customFields: { distrito: 'San Isidro', email: 'ana@example.com' },
      });

      const fields = await readFields(db, contactId);
      expect(fields.distrito).toBe('San Isidro'); // overwrite
      expect(fields.email).toBe('ana@example.com'); // add
      expect(fields.edad).toBeUndefined(); // omission = deletion (the editor's contract)
      // Reserved keys are not part of the editor's namespace and never vanish.
      expect(fields._funnel).toEqual({ stage: 'lead', auto: true });
      expect(fields._relationship).toEqual({ label: 'mamá' });
    } finally {
      await client.close();
    }
  }, 30_000);

  it('`customFields` cannot forge a reserved key: a client-sent `_funnel` loses to the stored one', async () => {
    const { client, db } = await createContactsDb();
    try {
      const contactId = await seedContact(client, { _funnel: { stage: 'lead', auto: true } });

      await updateContact(ctxFor(db), contactId, {
        customFields: { _funnel: { stage: 'customer', auto: false } },
      });

      expect((await readFields(db, contactId))._funnel).toEqual({ stage: 'lead', auto: true });
    } finally {
      await client.close();
    }
  }, 30_000);

  it('`customFieldsPatch` (gateway action): sets only the submitted keys, keeps every other one', async () => {
    const { client, db } = await createContactsDb();
    try {
      const contactId = await seedContact(client, {
        _funnel: { stage: 'lead', auto: true },
        distrito: 'Miraflores',
        edad: '34',
      });

      await updateContact(ctxFor(db), contactId, {
        customFieldsPatch: { email: 'ana@example.com' },
      });

      const fields = await readFields(db, contactId);
      expect(fields.email).toBe('ana@example.com');
      // Neither the other user keys NOR the reserved key were in the payload —
      // and unlike the whole-namespace form, omission keeps them.
      expect(fields.distrito).toBe('Miraflores');
      expect(fields.edad).toBe('34');
      expect(fields._funnel).toEqual({ stage: 'lead', auto: true });
    } finally {
      await client.close();
    }
  }, 30_000);

  it('`customFieldsPatch` overwrites a submitted key and can clear it with null', async () => {
    const { client, db } = await createContactsDb();
    try {
      const contactId = await seedContact(client, { email: 'old@example.com', edad: '34' });
      const ctx = ctxFor(db);

      await updateContact(ctx, contactId, { customFieldsPatch: { email: 'new@example.com' } });
      expect((await readFields(db, contactId)).email).toBe('new@example.com');

      await updateContact(ctx, contactId, { customFieldsPatch: { email: null } });
      const cleared = await readFields(db, contactId);
      expect(cleared.email).toBeNull();
      expect(cleared.edad).toBe('34');
    } finally {
      await client.close();
    }
  }, 30_000);

  it('rejects a caller that passes both contracts at once instead of silently picking one', async () => {
    const { client, db } = await createContactsDb();
    try {
      const contactId = await seedContact(client, { edad: '34' });
      await expect(
        updateContact(ctxFor(db), contactId, {
          customFields: { distrito: 'Lima' },
          customFieldsPatch: { email: 'ana@example.com' },
        }),
      ).rejects.toThrow(/customFields.*customFieldsPatch|not both/);
      // Nothing was written.
      expect((await readFields(db, contactId)).edad).toBe('34');
    } finally {
      await client.close();
    }
  }, 30_000);

  it('leaves the non-custom_fields columns of the same write untouched in semantics', async () => {
    const { client, db } = await createContactsDb();
    try {
      const contactId = await seedContact(client, { edad: '34' });

      const row = await updateContact(ctxFor(db), contactId, {
        displayName: 'Ana María',
        lifecycleOverride: 'vip',
        customFieldsPatch: { email: 'ana@example.com' },
      });

      expect(row?.displayName).toBe('Ana María');
      expect(row?.lifecycleOverride).toBe('vip');
      expect((row?.customFields as Record<string, unknown>).edad).toBe('34');
    } finally {
      await client.close();
    }
  }, 30_000);

  it('a missing / other-org contact still returns null (no row invented by the merge)', async () => {
    const { client, db } = await createContactsDb();
    try {
      const contactId = await seedContact(client, { edad: '34' });
      const otherOrg = { db: db as never, tenantId: 'org-2' };

      expect(
        await updateContact(otherOrg, contactId, { customFieldsPatch: { email: 'x@y.z' } }),
      ).toBeNull();
      expect(
        await updateContact(ctxFor(db), crypto.randomUUID(), {
          customFieldsPatch: { email: 'x@y.z' },
        }),
      ).toBeNull();
      // The org-scoped write did not leak across the tenant boundary.
      expect(await readFields(db, contactId)).toEqual({ edad: '34' });
    } finally {
      await client.close();
    }
  }, 30_000);
});

// ── Real engine: the writers survive each other ─────────────────────────────

describe('a user-field write and a `_funnel` write on the same contact both survive', () => {
  it('funnel first, then the user edit', async () => {
    const { client, db } = await createContactsDb();
    try {
      const contactId = await seedContact(client, { _funnel: { stage: 'lead', auto: true } });
      const ctx = ctxFor(db);

      await setFunnelStage(ctx, contactId, 'customer', { by: 'user' });
      await updateContact(ctx, contactId, { customFieldsPatch: { favoriteColor: 'blue' } });

      const fields = await readFields(db, contactId);
      expect(fields._funnel).toMatchObject({ stage: 'customer', auto: false });
      expect(fields.favoriteColor).toBe('blue');
    } finally {
      await client.close();
    }
  }, 30_000);

  it('the user edit first, then funnel', async () => {
    const { client, db } = await createContactsDb();
    try {
      const contactId = await seedContact(client, { _funnel: { stage: 'lead', auto: true } });
      const ctx = ctxFor(db);

      await updateContact(ctx, contactId, { customFieldsPatch: { favoriteColor: 'blue' } });
      await setFunnelStage(ctx, contactId, 'customer', { by: 'user' });

      const fields = await readFields(db, contactId);
      expect(fields._funnel).toMatchObject({ stage: 'customer', auto: false });
      expect(fields.favoriteColor).toBe('blue');
    } finally {
      await client.close();
    }
  }, 30_000);

  it('a `_funnel` write that commits INSIDE the user edit\'s transaction is not reverted by it', async () => {
    const { client, db } = await createContactsDb();
    try {
      const contactId = await seedContact(client, {
        _funnel: { stage: 'lead', auto: true },
        distrito: 'Miraflores',
      });
      const ctx = ctxFor(db);

      // pglite is a single session, so the interleaving is expressed the only
      // way it can be: the competing funnel write lands between the moment the
      // user edit's payload is decided and the moment its statement executes.
      // Under the replaced shape (read the column, spread it in JS, write the
      // whole object back) that snapshot is exactly what got written back over
      // the funnel write. Under the merge expression there is no snapshot: the
      // left operand is read by Postgres when the UPDATE runs.
      mockWithOrgCore.mockImplementationOnce(async (scope, fn) => {
        await client.query(
          `update crm_contacts set custom_fields = jsonb_set(custom_fields, array['_funnel'],
             '{"stage":"customer","auto":false}'::jsonb, true) where id = $1`,
          [contactId],
        );
        return reentrantWithOrgCore(scope, fn);
      });

      await updateContact(ctx, contactId, { customFieldsPatch: { favoriteColor: 'blue' } });

      const fields = await readFields(db, contactId);
      expect(fields._funnel).toEqual({ stage: 'customer', auto: false });
      expect(fields.favoriteColor).toBe('blue');
      expect(fields.distrito).toBe('Miraflores');
    } finally {
      await client.close();
    }
  }, 30_000);
});
