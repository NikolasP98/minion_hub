import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { Capabilities } from '$server/services/rbac.service';

/**
 * POST /api/gateway/actions/contact-update — the agent-facing CRM write.
 *
 * Spec 2026-08-18-hub-funnel-atomic-write, S2. This handler was the last
 * whole-column read-modify-write of `crm_contacts.custom_fields` in the repo:
 * because `updateContact`'s `customFields` param means "this is the WHOLE
 * user-editable namespace", the handler had to `getContact` first and spread the
 * stored object in JS to avoid deleting the keys it wasn't editing. Anything
 * committed between that read and the write — a contact-detail PATCH, a second
 * agent call, a funnel tick — was silently dropped, because the loser's key was
 * never in the winner's snapshot.
 *
 * These tests run the real handler against a real Postgres engine (pglite) and
 * pin the property that closes the window: setting `email` issues exactly ONE
 * statement against `crm_contacts`, and it is the UPDATE. No read to go stale.
 */

const mockResolveAssistantPrincipal = vi.fn();
vi.mock('$server/auth/assistant-principal', () => ({
  resolveAssistantPrincipal: (...args: unknown[]) => mockResolveAssistantPrincipal(...args),
}));

vi.mock('@minion-stack/cache', () => ({
  cached: (_k: string, _o: unknown, fn: () => Promise<unknown>) => fn(),
  keys: { hub: () => 'k' },
  invalidateTags: async () => {},
  tags: { tenantDomain: () => ['t'] },
}));

/** The db `requireAssistantCapability` puts on the ctx — swapped per test. */
let coreDb: unknown = null;
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => coreDb }));

/**
 * Production runs on postgres-js, whose `tx.execute()` resolves to the row
 * ARRAY; pglite's resolves to `{ rows, fields }`, and CRM service code
 * destructures the array shape. Same adapter the `_journey` atomic-write suite
 * uses; every other member passes straight through to the real transaction.
 */
function withPgDriverShape<T extends object>(tx: T): T {
  return new Proxy(tx, {
    get(target, prop, recv) {
      if (prop === 'execute') {
        return async (query: unknown) => {
          const res = (await (target as { execute: (q: unknown) => Promise<unknown> }).execute(
            query,
          )) as { rows?: unknown[] } | unknown[];
          return Array.isArray(res) ? res : (res?.rows ?? []);
        };
      }
      const value = Reflect.get(target, prop, recv);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

// Reentrant stand-in for withOrgCore: pglite is a single session, so a nested
// transaction (updateContact → recordAudit) would wait on its own outer one.
let openTx: unknown = null;
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (
    scope: { db: { transaction: (fn: (tx: unknown) => unknown) => unknown } },
    fn: (tx: unknown) => unknown,
  ) => {
    if (openTx) return fn(openTx);
    return scope.db.transaction(async (tx: unknown) => {
      openTx = withPgDriverShape(tx as object);
      try {
        return await fn(openTx);
      } finally {
        openTx = null;
      }
    });
  },
}));

import { POST as contactUpdatePOST } from './contact-update/+server';

const ORG = 'org-1';
const PRINCIPAL = '11111111-1111-4111-8111-111111111111';

function makeCaps(allowed: Record<string, boolean> = {}): Capabilities {
  return {
    roles: ['staff'],
    can: (module, action) => allowed[`${module}.${action}`] ?? false,
    canRunAnalytics: () => false,
    visibleModules: () => [],
    ownerScoped: () => false,
    fieldLevel: () => 0,
  };
}

function makeEvent(body: unknown) {
  return {
    locals: {},
    url: new URL('http://localhost/api/gateway/actions/contact-update?agentId=personal-u1'),
    request: { json: async () => body },
  } as never;
}

/**
 * A one-shot hook fired just before the handler's UPDATE of `crm_contacts`
 * reaches the engine. That instant is the far end of the read-modify-write
 * window: whatever the handler decided to write is already fixed, and the row
 * is about to change under it. Installing a competing write here is the
 * deterministic form of "two writers, different keys" — no timing, no
 * `Promise.all` race.
 */
let beforeContactUpdate: (() => Promise<void>) | null = null;

/**
 * Every SQL string the driver actually sends, including inside transactions —
 * so "does this handler read the column before writing it?" is answered by the
 * engine, not by a spy on our own service function.
 */
function withSqlSink<T extends object>(target: T, sink: string[]): T {
  return new Proxy(target, {
    get(t, prop, recv) {
      const value = Reflect.get(t, prop, recv);
      if (prop === 'query' || prop === 'exec') {
        return async (query: string, ...rest: unknown[]) => {
          sink.push(query);
          if (beforeContactUpdate && /update\s+"?crm_contacts"?/i.test(query)) {
            const hook = beforeContactUpdate;
            beforeContactUpdate = null;
            await hook();
          }
          return (value as (...a: unknown[]) => unknown).call(t, query, ...rest);
        };
      }
      if (prop === 'transaction') {
        return (fn: (tx: object) => unknown) =>
          (value as (...a: unknown[]) => unknown).call(t, (tx: object) =>
            fn(withSqlSink(tx, sink)),
          );
      }
      return typeof value === 'function' ? value.bind(t) : value;
    },
  });
}

async function createDb() {
  const client = new PGlite();
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
      kind text not null, body text, actor_id uuid,
      data jsonb not null default '{}'::jsonb,
      occurred_at timestamptz not null default now(),
      created_at timestamptz not null default now()
    );
    create table doc_audit_log (
      id uuid primary key default gen_random_uuid(),
      org_id text not null, ref_type text not null, ref_id uuid not null,
      actor_id uuid, actor_name text, op text not null default 'update',
      changes jsonb not null default '[]'::jsonb,
      occurred_at timestamptz not null default now()
    );
  `);
  await client.exec(`select set_config('app.current_org_id', '${ORG}', false);`);
  const sink: string[] = [];
  coreDb = drizzle(withSqlSink(client, sink));
  return { client, sink };
}

async function seed(client: PGlite, customFields: Record<string, unknown>) {
  const contactId = crypto.randomUUID();
  await client.query(
    `insert into crm_contacts (id, org_id, source, display_name, custom_fields)
     values ($1, $2, 'manual', 'Ana', $3::jsonb)`,
    [contactId, ORG, JSON.stringify(customFields)],
  );
  return contactId;
}

async function readFields(client: PGlite, contactId: string) {
  const res = await client.query<{ custom_fields: Record<string, unknown> }>(
    `select custom_fields from crm_contacts where id = $1`,
    [contactId],
  );
  return res.rows[0].custom_fields;
}

const allowed = {
  principalId: PRINCIPAL,
  orgId: ORG,
  capabilities: makeCaps({ 'crm.edit': true }),
};

beforeEach(() => {
  // reset, not clear: one test installs a mockImplementation that issues a
  // competing SQL write, and a leaked implementation would fire against the
  // previous test's already-closed database.
  mockResolveAssistantPrincipal.mockReset();
  openTx = null;
  coreDb = null;
});

describe('POST /api/gateway/actions/contact-update — RBAC and preview (unchanged by S2)', () => {
  it('403s when the principal lacks crm:edit', async () => {
    const { client } = await createDb();
    try {
      const contactId = await seed(client, { edad: '34' });
      mockResolveAssistantPrincipal.mockResolvedValue({
        principalId: PRINCIPAL,
        orgId: ORG,
        capabilities: makeCaps(),
      });
      await expect(
        contactUpdatePOST(makeEvent({ confirm: true, contactId, email: 'ana@example.com' })),
      ).rejects.toMatchObject({ status: 403 });
      expect(await readFields(client, contactId)).toEqual({ edad: '34' });
    } finally {
      await client.close();
    }
  }, 30_000);

  it('confirm:false previews and writes nothing', async () => {
    const { client } = await createDb();
    try {
      const contactId = await seed(client, { edad: '34' });
      mockResolveAssistantPrincipal.mockResolvedValue(allowed);

      const res = await contactUpdatePOST(
        makeEvent({ confirm: false, contactId, email: 'ana@example.com' }),
      );
      const body = (await res.json()) as { preview: { action: string; email: string } };

      expect(body.preview.action).toBe('contact-update');
      expect(body.preview.email).toBe('ana@example.com');
      expect(await readFields(client, contactId)).toEqual({ edad: '34' });
    } finally {
      await client.close();
    }
  }, 30_000);

  it('404s on a contact the org cannot see, without writing', async () => {
    const { client } = await createDb();
    try {
      mockResolveAssistantPrincipal.mockResolvedValue(allowed);
      await expect(
        contactUpdatePOST(
          makeEvent({ confirm: true, contactId: crypto.randomUUID(), email: 'ana@example.com' }),
        ),
      ).rejects.toMatchObject({ status: 404 });
    } finally {
      await client.close();
    }
  }, 30_000);
});

describe('POST /api/gateway/actions/contact-update — the email write is atomic (S2)', () => {
  it('touches crm_contacts exactly once, with an UPDATE — it never reads the row first', async () => {
    const { client, sink } = await createDb();
    try {
      const contactId = await seed(client, { edad: '34' });
      mockResolveAssistantPrincipal.mockResolvedValue(allowed);

      sink.length = 0;
      await contactUpdatePOST(makeEvent({ confirm: true, contactId, email: 'ana@example.com' }));

      const contactStatements = sink.filter((s) => s.includes('crm_contacts'));
      expect(contactStatements).toHaveLength(1);
      expect(contactStatements[0].toLowerCase()).toContain('update');
      // The pre-fix shape was SELECT-then-UPDATE; any select of the column here
      // is a window a concurrent writer's key can be lost in.
      expect(contactStatements[0].toLowerCase()).not.toContain('select');
    } finally {
      await client.close();
    }
  }, 30_000);

  it('sets `email` without disturbing the other user fields or the reserved keys', async () => {
    const { client } = await createDb();
    try {
      const contactId = await seed(client, {
        edad: '34',
        distrito: 'Miraflores',
        _funnel: { stage: 'lead', auto: true },
        _relationship: { label: 'mamá' },
      });
      mockResolveAssistantPrincipal.mockResolvedValue(allowed);

      await contactUpdatePOST(
        makeEvent({ confirm: true, contactId, name: 'Ana María', email: 'ana@example.com' }),
      );

      expect(await readFields(client, contactId)).toEqual({
        edad: '34',
        distrito: 'Miraflores',
        email: 'ana@example.com',
        _funnel: { stage: 'lead', auto: true },
        _relationship: { label: 'mamá' },
      });
      const res = await client.query<{ display_name: string }>(
        `select display_name from crm_contacts where id = $1`,
        [contactId],
      );
      expect(res.rows[0].display_name).toBe('Ana María');
    } finally {
      await client.close();
    }
  }, 30_000);

  it("a user key written between the agent call's decision and its statement is NOT lost", async () => {
    const { client } = await createDb();
    try {
      const contactId = await seed(client, { edad: '34' });
      mockResolveAssistantPrincipal.mockResolvedValue(allowed);
      // pglite backs this whole suite with ONE session, so this is a SIMULATED
      // interleave (a raw SQL write injected via the mocked principal-resolve
      // hook), not a second real connection/transaction — it pins the merge
      // expression's shape (no application-side read to go stale), not
      // lock-wait behavior under a genuine concurrent writer. The real
      // coordinator-lock proof (two independent connections, both verified
      // blocked via pg_stat_activity before release) is
      // crm-funnel.concurrent.integration.test.ts (real Postgres via
      // SUPABASE_DB_URL). The competing edit commits after the handler has
      // decided what to send and before its UPDATE runs — precisely the window
      // the removed getContact-and-spread straddled. Its key must survive,
      // because the handler's payload is `{email}` alone and the merge's left
      // operand is read by Postgres at UPDATE time.
      mockResolveAssistantPrincipal.mockImplementation(async () => {
        await client.query(
          `update crm_contacts set custom_fields = custom_fields || '{"distrito":"Barranco"}'::jsonb
           where id = $1`,
          [contactId],
        );
        return allowed;
      });

      await contactUpdatePOST(makeEvent({ confirm: true, contactId, email: 'ana@example.com' }));

      expect(await readFields(client, contactId)).toEqual({
        edad: '34',
        distrito: 'Barranco',
        email: 'ana@example.com',
      });
    } finally {
      await client.close();
    }
  }, 30_000);

  it('an agent may not forge a reserved key through the email field', async () => {
    const { client } = await createDb();
    try {
      const contactId = await seed(client, { _funnel: { stage: 'lead', auto: true } });
      mockResolveAssistantPrincipal.mockResolvedValue(allowed);

      // The whitelisted payload has no reserved-key surface at all, and the
      // service strips one anyway — assert the stored value is untouched.
      await contactUpdatePOST(makeEvent({ confirm: true, contactId, email: 'ana@example.com' }));

      const fields = await readFields(client, contactId);
      expect(fields._funnel).toEqual({ stage: 'lead', auto: true });
    } finally {
      await client.close();
    }
  }, 30_000);

  it('the funnel stage still routes through setFunnelStage (agent = advance-only)', async () => {
    const { client } = await createDb();
    try {
      const contactId = await seed(client, { _funnel: { stage: 'customer', auto: false } });
      mockResolveAssistantPrincipal.mockResolvedValue(allowed);

      const res = await contactUpdatePOST(
        makeEvent({ confirm: true, contactId, funnelStage: 'lead' }),
      );
      const body = (await res.json()) as { funnel: { applied: boolean; stage: string } };

      // A human pin is never overwritten by an agent — unchanged by S2.
      expect(body.funnel).toEqual({ applied: false, stage: 'customer' });
      expect((await readFields(client, contactId))._funnel).toEqual({
        stage: 'customer',
        auto: false,
      });
    } finally {
      await client.close();
    }
  }, 30_000);
});
