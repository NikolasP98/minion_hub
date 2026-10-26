import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as pgSchema from '@minion-stack/db/pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { testDatabaseUrl } from '$server/test-utils/test-db-url';

/**
 * Spec 041 Amendment A, F2 against the real QA schema: the contact upsert's
 * savepoint (item 6) and the shared form-door rate limit (item 16).
 * Every row written here is keyed by a random org id / bucket and deleted in `finally`.
 */
const databaseUrl = testDatabaseUrl();
const admin = databaseUrl ? postgres(databaseUrl, { max: 2, prepare: false }) : null;
const racer = databaseUrl
  ? postgres(databaseUrl, {
      max: 1,
      prepare: false,
      connection: { application_name: 'f2-contact-race' },
    })
  : null;
const racerDb = racer ? drizzle(racer, { schema: pgSchema }) : null;

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('$server/db/pg-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCoreDb: () => h.db,
}));
vi.mock('$server/services/doors-form.service', () => ({
  submitFormDoor: async () => ({ status: 'ok', message: null }),
}));
h.db = racerDb;

import { ensureCrmContact } from './crm-contact-ensure';

async function waitForLockWait(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const [row] = await admin!<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity
      where application_name = 'f2-contact-race' and wait_event_type = 'Lock'`;
    if (row.n > 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('the racing insert never blocked on the identity lock');
}

describe.runIf(Boolean(databaseUrl))('doors hardening native SQL', () => {
  afterAll(async () => {
    await Promise.all([admin?.end(), racer?.end()]);
  });

  it('a contact upsert that loses the identity race resolves to the winner and leaves the outer transaction usable', async () => {
    const org = `f2-race-${randomUUID()}`;
    const phone = `+519${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const winner = randomUUID();
    try {
      let releaseWinner!: () => void;
      const winnerMayCommit = new Promise<void>((r) => (releaseWinner = r));
      let winnerInserted!: () => void;
      const winnerReady = new Promise<void>((r) => (winnerInserted = r));
      // Connection A claims the phone identity but holds its commit open.
      const winnerTx = admin!.begin(async (tx) => {
        await tx`insert into crm_contacts (id, org_id, source) values (${winner}, ${org}, 'race-winner')`;
        await tx`insert into crm_contact_identities (org_id, contact_id, channel, external_id)
          values (${org}, ${winner}, 'whatsapp', ${phone})`;
        winnerInserted();
        await winnerMayCommit;
      });
      await winnerReady;

      // Connection B: resolve cannot see A's row, so it inserts and blocks on the unique index.
      const loser = racerDb!.transaction(async (tx) => {
        const out = await ensureCrmContact(tx as never, org, {
          name: 'Race',
          phone,
          source: 'race-loser',
        });
        // The caller's next statement must still run (a bare catch left the tx aborted, 25P02).
        await tx.execute(
          sql`insert into crm_contacts (id, org_id, source) values (${randomUUID()}, ${org}, 'after-race')`,
        );
        return out;
      });
      await waitForLockWait();
      releaseWinner();
      await winnerTx;

      expect(await loser).toEqual({ id: winner, created: false });
      const rows = await admin!<{ source: string }[]>`
        select source from crm_contacts where org_id = ${org} order by source`;
      expect(rows.map((r) => r.source)).toEqual(['after-race', 'race-winner']);
    } finally {
      await admin!`delete from crm_contact_identities where org_id = ${org}`;
      await admin!`delete from crm_contacts where org_id = ${org}`;
    }
  });

  it('the 6th form-door POST in a minute gets 429 even when the posts land on different instances', async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 250)}`;
    const slug = `f2-rate-${randomUUID().slice(0, 8)}`;
    const keys = [slug, `${slug}-other`].map((s) =>
      createHash('sha256').update(`door-submit:${ip}:${s}`).digest('hex'),
    );
    const post = async (
      handler: (e: never) => Response | Promise<Response>,
      s: string = slug,
    ): Promise<number> =>
      (
        await handler({
          params: { slug: s },
          request: new Request(`http://hub.test/api/doors/public/${s}/submit`, {
            method: 'POST',
            body: JSON.stringify({ values: { nombre: 'Ana' }, consent: true }),
          }),
          getClientAddress: () => ip,
        } as never)
      ).status;
    try {
      // Two module instances = two lambdas, each with its own in-memory state.
      const a = (await import('../../routes/api/doors/public/[slug]/submit/+server')).POST;
      vi.resetModules();
      const b = (await import('../../routes/api/doors/public/[slug]/submit/+server')).POST;
      expect(a).not.toBe(b);
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) statuses.push(await post(i % 2 ? b : a));
      expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
      expect(await post(b, `${slug}-other`)).toBe(200);

      // An expired window resets in place instead of throttling forever.
      await admin!`update public_rate_limits set window_start = now() - interval '61 seconds'
        where bucket = ${keys[0]}`;
      expect(await post(a)).toBe(200);
      const [row] = await admin!<{ hits: number }[]>`
        select hits from public_rate_limits where bucket = ${keys[0]}`;
      expect(row.hits).toBe(1);
    } finally {
      await admin!`delete from public_rate_limits where bucket in ${admin!(keys)}`;
    }
  });
});
