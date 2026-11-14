import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schemaTypes from '@minion-stack/db/pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDisposablePostgres } from '../../../scripts/qc/disposable-postgres';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { PosTicket } from '$server/db/pg-pos-schema';
import type { PosSettings } from './pos/settings';

/**
 * One live tax document per ticket (spec 118 slice 3) against the real
 * migrations: the partial unique index, the number allocator's rollback, the
 * guarded result write and the stale-send sweep. Only the provider call, the
 * org's finance settings and the detached runner are doubles.
 */
const h = vi.hoisted(() => ({
  coreDb: null as unknown,
  detached: [] as Promise<unknown>[],
  emit: null as null | (() => Promise<unknown>),
}));
vi.mock('$server/db/pg-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$server/db/pg-client')>()),
  getCoreDb: () => h.coreDb,
}));
vi.mock('./finance.service', () => ({
  getFinSettings: async () => ({ taxRate: 0.18 }),
  getSource: async () => ({
    enabled: true,
    config: { ruc: '20611172967', clientId: 'client-id', legalName: 'FACES BETA SAC' },
  }),
}));
vi.mock('$server/finance/emission', () => ({
  emitToBeta: () =>
    h.emit ? h.emit() : { responseCode: '0', description: 'ACEPTADA', xmlHash: 'hash-1' },
}));
vi.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => h.detached.push(p) }));
vi.mock('$env/dynamic/private', () => ({
  env: { POS_EMISSION_BETA_CERT: 'CERT-PEM', POS_EMISSION_BETA_KEY: 'KEY-PEM' },
}));

import { triggerShadowEmission } from './pos-emission.service';
import { reapStaleSends } from './stale-sends.service';

let harness: Awaited<ReturnType<typeof openDisposablePostgres>>;
let owner: ReturnType<typeof harness.createConnection>;
let ctxA: CoreCtx;
let ctxB: CoreCtx;
const fixtureSchema = `qc_job_stock_${crypto.randomUUID().replaceAll('-', '')}`;
const ORG = 'pos-emission-native-org';
const ticket = (id: string) =>
  ({ id, orgId: ORG, partyId: null, subtotal: '118', total: '118' }) as unknown as PosTicket;
const settings = { emission: { mode: 'shadow', docTypeDefault: '03' } } as unknown as PosSettings;
const migration = (file: string) =>
  readFileSync(new URL(`../../../supabase/migrations/${file}`, import.meta.url), 'utf8').replaceAll(
    'public.',
    `"${fixtureSchema}".`,
  );

beforeAll(async () => {
  harness = await openDisposablePostgres();
  await harness.owner.unsafe(`CREATE SCHEMA "${fixtureSchema}"`);
  owner = harness.createConnection(fixtureSchema);
  await owner.unsafe(`
    CREATE TABLE pos_settings (org_id text PRIMARY KEY);
    CREATE TABLE pos_tickets (id uuid PRIMARY KEY, org_id text NOT NULL);
    CREATE TABLE pos_ticket_lines (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id text NOT NULL,
      ticket_id uuid NOT NULL REFERENCES pos_tickets(id), description text NOT NULL,
      qty numeric NOT NULL, total numeric NOT NULL
    );
    -- Only so the cross-organisation sweep's other two statements have a target.
    CREATE TABLE sched_reminders (id uuid PRIMARY KEY, status text, error text, created_at timestamptz);
    CREATE TABLE crm_door_followups (id uuid PRIMARY KEY, status text, error text, created_at timestamptz);
  `);
  // The real tables, grants and RLS policies, then the index under test.
  await owner.unsafe(migration('20260814040000_pos_shadow_emission.sql'));
  await owner.unsafe(migration('20261114120000_pos_emissions_one_live_per_ticket.sql'));
  await owner.unsafe(`
    GRANT USAGE ON SCHEMA "${fixtureSchema}" TO app_ledger;
    GRANT SELECT ON pos_tickets, pos_ticket_lines TO app_ledger;
  `);
  // Two connections, so two triggers really run at the same time.
  const db = () => drizzle(harness.createConnection(fixtureSchema), { schema: schemaTypes });
  ctxA = { tenantId: ORG, db: db() } as CoreCtx;
  ctxB = { tenantId: ORG, db: db() } as CoreCtx;
  h.coreDb = db();
});

beforeEach(async () => {
  await owner.unsafe('TRUNCATE pos_emissions, pos_ticket_lines, pos_tickets, pos_series CASCADE');
  await owner`INSERT INTO pos_series (org_id,doc_type,serie,next_number,environment) VALUES (${ORG},'03','B999',1,'beta')`;
  h.detached.length = 0;
  h.emit = null;
});

afterAll(async () => {
  if (!harness) return;
  try {
    await harness.owner.unsafe(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
  } finally {
    await harness.close();
  }
});

async function newTicket() {
  const id = crypto.randomUUID();
  await owner`INSERT INTO pos_tickets (id,org_id) VALUES (${id},${ORG})`;
  await owner`INSERT INTO pos_ticket_lines (org_id,ticket_id,description,qty,total) VALUES (${ORG},${id},'Servicio',1,118)`;
  return ticket(id);
}
const rows = (ticketId: string) =>
  owner<{ status: string; correlativo: number; response_description: string | null }[]>`
    SELECT status, correlativo, response_description FROM pos_emissions
    WHERE ticket_id=${ticketId} ORDER BY correlativo`;
const nextNumber = async () =>
  (await owner<{ n: number }[]>`SELECT next_number AS n FROM pos_series`)[0].n;

describe('native POS one live emission per ticket', () => {
  it('two concurrent triggers leave one live row and consume one document number', async () => {
    const t = await newTicket();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await Promise.all([
      triggerShadowEmission(ctxA, t, settings),
      triggerShadowEmission(ctxB, t, settings),
    ]);
    await Promise.all(h.detached);
    expect(await rows(t.id)).toEqual([
      { status: 'accepted', correlativo: 1, response_description: 'ACEPTADA' },
    ]);
    expect(await nextNumber()).toBe(2);
    // The losing trigger is a silent no-op, not a logged failure.
    expect(log).not.toHaveBeenCalledWith(
      '[pos-emission] shadow emission trigger failed',
      expect.anything(),
      expect.anything(),
    );
    log.mockRestore();
  });

  it('a ticket whose only emission is error gets a new row on retry', async () => {
    const t = await newTicket();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.emit = async () => {
      throw new Error('beta unreachable');
    };
    await triggerShadowEmission(ctxA, t, settings);
    await Promise.all(h.detached);
    h.emit = null;
    await triggerShadowEmission(ctxA, t, settings);
    await Promise.all(h.detached);
    expect((await rows(t.id)).map((r) => r.status)).toEqual(['error', 'accepted']);
    expect(await nextNumber()).toBe(3);
    log.mockRestore();
  });

  it('a late provider result on a row the sweep already failed changes nothing', async () => {
    const t = await newTicket();
    let answer!: (v: unknown) => void;
    h.emit = () => new Promise((resolve) => (answer = resolve));
    await triggerShadowEmission(ctxA, t, settings);
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'), { timeout: 10_000 });
    // The invocation "died": its pending row is older than the limit.
    await owner`UPDATE pos_emissions SET updated_at = now() - interval '20 minutes' WHERE ticket_id=${t.id}`;
    expect(await reapStaleSends()).toMatchObject({ emissions: 1 });
    answer({ responseCode: '0', description: 'ACEPTADA', xmlHash: 'hash-late' });
    await Promise.all(h.detached);
    expect(await rows(t.id)).toEqual([
      { status: 'error', correlativo: 1, response_description: 'stale_pending' },
    ]);
  });
});
