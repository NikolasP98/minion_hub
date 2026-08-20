import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';
import { eq, type SQL } from 'drizzle-orm';
import { crmContacts } from '$server/db/pg-crm-schema';

/**
 * `_journey` atomic-write coverage (spec 2026-08-18-hub-funnel-atomic-write-spec,
 * S2). `analyzeJourney` used to read the whole `custom_fields` value, assign
 * `_journey` on that JS snapshot and write the entire object back — so a
 * per-key writer (`setFunnelStage`, `_relationship`) committing between the
 * read and the write was silently reverted. These tests pin BOTH halves of the
 * fix: the shipped statement shape (one `jsonb_set`, no read), and the
 * behaviour on a real Postgres engine when a competing `_funnel` write lands
 * inside the same run.
 */

const dialect = new PgDialect();

/** The tx handed to the service; only `execute` is shape-sensitive. */
interface ExecTx {
  execute: (query: SQL) => Promise<unknown>;
}

/**
 * Production runs on postgres-js, whose `execute()` resolves to the row ARRAY;
 * pglite's resolves to a `{ rows, fields }` result object, and the service code
 * (`deterministicMilestones`, the messages read) iterates the array shape. This
 * adapts pglite to the production driver's shape and passes every other member
 * (`update`/`set`/`where`/`returning`) straight through to the real transaction
 * — the atomic write under test is never wrapped. Already-array results (the
 * recording tx below) pass through untouched.
 */
function withPgDriverShape<T extends ExecTx>(tx: T): T {
  return new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop === 'execute') {
        return async (query: SQL) => {
          const res = (await target.execute(query)) as { rows?: unknown[] } | unknown[];
          return Array.isArray(res) ? res : (res?.rows ?? []);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      // Bind so drizzle's internal (private-field) state stays on the real tx.
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

const mockWithOrgCore = vi.fn(
  (
    scope: { db: { transaction: (fn: (tx: unknown) => unknown) => unknown } },
    fn: (tx: unknown) => unknown,
  ) => scope.db.transaction((tx: unknown) => fn(withPgDriverShape(tx as ExecTx))),
);
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (scope: unknown, fn: (tx: unknown) => unknown) =>
    mockWithOrgCore(scope as never, fn),
}));

// Finance milestones need the fin_* spine; this suite is about the write, so
// the module pair reports disabled and that branch is skipped entirely.
vi.mock('./modules.service', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  bothEnabled: async () => false,
}));

vi.mock('$env/dynamic/private', () => ({
  env: { OPENROUTER_API_KEY: 'test-key', CRM_JOURNEY_MODEL: 'test/model' },
}));
vi.mock('$server/llm', () => ({ getOpenRouterModel: (id: string) => ({ id }) }));

const generateObject = vi.fn<() => Promise<{ object: unknown[] }>>();
vi.mock('ai', () => ({ generateObject: () => generateObject() }));

import { analyzeJourney } from './crm-journey.service';
import { setFunnelStage } from './crm-contacts.service';

const MILESTONE = { label: 'Asked about Botox', at: '2026-05-01', detail: 'price inquiry' };

beforeEach(() => {
  mockWithOrgCore.mockReset();
  mockWithOrgCore.mockImplementation((scope, fn) =>
    scope.db.transaction((tx: unknown) => fn(withPgDriverShape(tx as ExecTx))),
  );
  generateObject.mockReset();
  generateObject.mockResolvedValue({ object: [MILESTONE] });
});

// ── Statement shape ─────────────────────────────────────────────────────────

/**
 * A tx that records the write instead of executing it. `execute` answers the
 * deterministic recon queries with no rows and the messages read with one
 * message (analyzeJourney returns early on an empty conversation).
 */
function makeRecordingTx() {
  const setCalls: Array<{ customFields: unknown }> = [];
  let selectCalls = 0;
  function chain(): Record<string, unknown> {
    return {
      from: () => chain(),
      where: () => chain(),
      for: () => chain(),
      limit: () => Promise.resolve([]),
      set: (v: { customFields: unknown }) => {
        setCalls.push(v);
        return chain();
      },
      returning: () => Promise.resolve([{ id: 'c1' }]),
      values: () => Promise.resolve([]),
    };
  }
  const tx = {
    execute: async (query: SQL) => {
      const { sql: text } = dialect.sqlToQuery(query);
      return text.includes('from messages')
        ? [
            {
              at: '2026-05-01T00:00:00Z',
              direction: 'inbound',
              content: '¿Cuánto cuesta el botox?',
            },
          ]
        : [];
    },
    select: () => {
      selectCalls++;
      return chain();
    },
    update: () => chain(),
    insert: () => chain(),
  };
  return { tx, setCalls, selectCount: () => selectCalls };
}

describe('analyzeJourney — the `_journey` write (S2 — converted off whole-column read-modify-write)', () => {
  it('writes ONE atomic jsonb_set bound to `_journey`, and never reads custom_fields to build it', async () => {
    const { tx, setCalls, selectCount } = makeRecordingTx();
    mockWithOrgCore.mockImplementation((_scope, fn) => fn(tx));

    await analyzeJourney({ db: {} as never, tenantId: 'org-1' }, 'c1');

    // The old shape's `select({ cf: crmContacts.customFields })` is gone: the
    // whole run issues no select-builder read at all.
    expect(selectCount()).toBe(0);
    expect(setCalls).toHaveLength(1);

    const { sql: text, params } = dialect.sqlToQuery(setCalls[0].customFields as SQL);
    expect(text).toContain('jsonb_set');
    expect(params).toContain('_journey');
    // Only this key's own value is bound — the statement carries nothing that
    // could restore a stale copy of another key.
    expect(params.some((p) => typeof p === 'string' && p.includes('_funnel'))).toBe(false);
    expect(params.some((p) => typeof p === 'string' && p.includes('Asked about Botox'))).toBe(true);
  });
});

// ── Real Postgres engine (pglite) ───────────────────────────────────────────

const ORG = 'org-1';

/**
 * Only the tables `analyzeJourney` + `setFunnelStage` touch, with the columns
 * they read. `bothEnabled` is mocked false, so the fin_* spine is not needed.
 */
async function createJourneyDb() {
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
    create table sched_bookings (
      id uuid primary key, org_id text not null, crm_contact_id uuid, party_id uuid,
      start_time timestamptz, title text, status text
    );
    create table crm_contact_stats (contact_id uuid primary key, first_contact_at timestamptz);
    create table crm_contact_identities (
      org_id text not null, contact_id uuid not null, channel text not null, external_id text not null
    );
    create table meta_lead_attribution (
      org_id text not null, channel text not null, sender_id text not null,
      origin text, campaign_name text, first_contact_at timestamptz
    );
    create table messages (
      org_id text not null, channel text not null, chat_id text not null,
      direction text, content text, is_bot boolean,
      occurred_at timestamptz, created_at timestamptz not null default now()
    );
  `);
  // pglite is one session; the GUC withOrgCore normally sets per-transaction is
  // set once here so the org-scoped predicates in the shipped SQL still match.
  await client.exec(`select set_config('app.current_org_id', '${ORG}', false);`);
  return { client, db };
}

async function seedContact(client: PGlite, customFields: Record<string, unknown>) {
  const contactId = crypto.randomUUID();
  await client.query(
    `insert into crm_contacts (id, org_id, source, custom_fields) values ($1, $2, 'manual', $3::jsonb)`,
    [contactId, ORG, JSON.stringify(customFields)],
  );
  // One inbound message, so analyzeJourney reaches the model + the write.
  await client.query(
    `insert into crm_contact_identities (org_id, contact_id, channel, external_id) values ($1, $2, 'whatsapp', 'chat-1')`,
    [ORG, contactId],
  );
  await client.query(
    `insert into messages (org_id, channel, chat_id, direction, content, is_bot, occurred_at)
     values ($1, 'whatsapp', 'chat-1', 'inbound', '¿Cuánto cuesta el botox?', false, now())`,
    [ORG],
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

describe('analyzeJourney against a real Postgres engine — `_journey` and `_funnel` survive each other', () => {
  it('a `_funnel` write committed DURING the run is not reverted by the `_journey` write', async () => {
    const { client, db } = await createJourneyDb();
    try {
      const contactId = await seedContact(client, {
        _funnel: { stage: 'lead', auto: true },
        nombre: 'Ana',
      });
      const ctx = { db: db as never, tenantId: ORG };

      // The competing writer commits while the model call is in flight — i.e.
      // exactly the window the old read-modify-whole-column write straddled.
      generateObject.mockImplementation(async () => {
        await setFunnelStage(ctx, contactId, 'customer', { by: 'user' });
        return { object: [MILESTONE] };
      });

      const journey = await analyzeJourney(ctx, contactId);
      expect(journey.map((m) => m.label)).toContain('Asked about Botox');

      const fields = await readFields(db, contactId);
      // The concurrent per-key write survives, at its NEW value...
      expect(fields._funnel).toMatchObject({ stage: 'customer', auto: false });
      // ...alongside the key this run wrote, and the untouched user field.
      expect(Array.isArray(fields._journey)).toBe(true);
      expect((fields._journey as Array<{ label: string }>)[0].label).toBe('Asked about Botox');
      expect(fields.nombre).toBe('Ana');
    } finally {
      await client.close();
    }
  }, 30_000);

  it('the reverse order — a `_funnel` write AFTER the run leaves `_journey` intact', async () => {
    const { client, db } = await createJourneyDb();
    try {
      const contactId = await seedContact(client, { _funnel: { stage: 'lead', auto: true } });
      const ctx = { db: db as never, tenantId: ORG };

      await analyzeJourney(ctx, contactId);
      await setFunnelStage(ctx, contactId, 'customer', { by: 'user' });

      const fields = await readFields(db, contactId);
      expect(fields._funnel).toMatchObject({ stage: 'customer', auto: false });
      expect((fields._journey as Array<{ label: string }>)[0].label).toBe('Asked about Botox');
    } finally {
      await client.close();
    }
  }, 30_000);

  it('an empty AI result still lands as an atomic `_journey` write that keeps `_funnel`', async () => {
    const { client, db } = await createJourneyDb();
    try {
      const contactId = await seedContact(client, { _funnel: { stage: 'lead', auto: true } });
      generateObject.mockResolvedValue({ object: [] });

      await analyzeJourney({ db: db as never, tenantId: ORG }, contactId);

      const fields = await readFields(db, contactId);
      expect(fields._journey).toEqual([]);
      expect(fields._funnel).toMatchObject({ stage: 'lead', auto: true });
    } finally {
      await client.close();
    }
  }, 30_000);
});
