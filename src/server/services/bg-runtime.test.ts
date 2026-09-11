import { readFileSync } from 'node:fs';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const entry = vi.hoisted(() => ({ db: vi.fn() }));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: entry.db }));
import {
  advanceJob,
  cancelJobsByRef,
  enqueueJob,
  registerJobHandler,
  type AdvanceResult,
} from './bg-runtime';

const client = new PGlite();
const database = drizzle(client);
const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/20260909090100_bg_job_lease_generation.sql',
    import.meta.url,
  ),
  'utf8',
);
const NOW = 1_800_000_000_000;
const type = 'lease-fixture';
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function until(check: () => boolean) {
  for (let n = 0; n < 1_000; n++) {
    if (check()) return;
    await nextTurn();
  }
  throw new Error('Fixture condition did not settle');
}
async function row(id: string) {
  const result = await client.query<{
    status: string;
    lease_generation: number;
    lease_until: number | null;
    cursor: string | null;
  }>('SELECT * FROM bg_jobs WHERE id=$1', [id]);
  return result.rows[0];
}
async function seed() {
  return enqueueJob({ tenantId: 'tenant-a', type, refId: 'ref-a', cursor: { initial: true } });
}
function handler() {
  const pending = deferred<AdvanceResult>();
  const advance = vi.fn(() => pending.promise);
  registerJobHandler({ type, advance });
  return { ...pending, advance };
}

beforeAll(async () => {
  await client.exec(`CREATE TABLE bg_jobs (
    id text PRIMARY KEY, tenant_id text NOT NULL, user_id text, type text NOT NULL, ref_id text,
    status text NOT NULL DEFAULT 'queued', cursor text, error text, attempts integer NOT NULL DEFAULT 0,
    lease_until bigint, created_at bigint NOT NULL, updated_at bigint NOT NULL, started_at bigint, finished_at bigint
  ); INSERT INTO bg_jobs (id, tenant_id, type, created_at, updated_at) VALUES ('existing', 'tenant-a', 'fixture', 1, 1);`);
  await client.exec(migration);
}, 30_000);
afterAll(async () => {
  await client.close();
});
beforeEach(() => {
  entry.db.mockReturnValue(database);
});
afterEach(async () => {
  vi.useRealTimers();
  await client.exec('DELETE FROM bg_jobs');
});

describe('generation storage and real PostgreSQL predicates (single embedded connection)', () => {
  it('preserves existing records and rejects negative, null and overflowing generations', async () => {
    expect((await row('existing')).lease_generation).toBe(0);
    for (const value of [-1, null, 2_147_483_648]) {
      await expect(
        client.query('UPDATE bg_jobs SET lease_generation=$1 WHERE id=$2', [value, 'existing']),
      ).rejects.toThrow();
    }
  });
  it('admits only one of two queued claim attempts', async () => {
    const h = handler();
    const id = await seed();
    const a = advanceJob(id);
    const b = advanceJob(id);
    await until(() => h.advance.mock.calls.length > 0);
    h.resolve({ done: true });
    await Promise.all([a, b]);
    expect(h.advance).toHaveBeenCalledTimes(1);
    expect(await row(id)).toMatchObject({ status: 'done', lease_generation: 1 });
  });
  it.each(['success', 'failure', 'progress'] as const)(
    'rejects old-owner %s after takeover',
    async (outcome) => {
      const old = handler();
      const id = await seed();
      const a = advanceJob(id);
      await until(() => old.advance.mock.calls.length === 1);
      await client.query('UPDATE bg_jobs SET lease_until=0 WHERE id=$1', [id]);
      const current = handler();
      const b = advanceJob(id);
      await until(() => current.advance.mock.calls.length === 1);
      if (outcome === 'failure') old.reject(new Error('old error'));
      else old.resolve({ done: outcome === 'success', cursor: { stale: true } });
      await a;
      expect(await row(id)).toMatchObject({
        status: 'running',
        lease_generation: 2,
        cursor: '{"initial":true}',
      });
      current.resolve({ done: true });
      await b;
      expect((await row(id)).status).toBe('done');
    },
  );
  it.each(['success', 'failure'] as const)(
    'preserves cancellation against late %s',
    async (outcome) => {
      const h = handler();
      const id = await seed();
      const run = advanceJob(id);
      await until(() => h.advance.mock.calls.length === 1);
      await cancelJobsByRef('ref-a');
      if (outcome === 'success') h.resolve({ done: true });
      else h.reject(new Error('late failure'));
      await run;
      expect(await row(id)).toMatchObject({
        status: 'cancelled',
        lease_generation: 2,
        lease_until: null,
      });
    },
  );
  it('rejects progress and completion when a tenant assignment changes', async () => {
    const h = handler();
    const id = await seed();
    const run = advanceJob(id);
    await until(() => h.advance.mock.calls.length === 1);
    await client.query('UPDATE bg_jobs SET tenant_id=$1 WHERE id=$2', ['tenant-b', id]);
    h.resolve({ done: false, cursor: 'wrong tenant' });
    await run;
    expect(await row(id)).toMatchObject({ status: 'running', cursor: '{"initial":true}' });
    expect(h.advance).toHaveBeenCalledTimes(1);
  });
  it('never admits a previously cancelled job', async () => {
    const h = handler();
    const id = await seed();
    await cancelJobsByRef('ref-a');
    await advanceJob(id);
    expect(h.advance).not.toHaveBeenCalled();
  });
});

describe('heartbeat lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
  });
  it('keeps a healthy pending step owned beyond the original lease and cleans up on completion', async () => {
    const h = handler();
    const id = await seed();
    const run = advanceJob(id);
    await until(() => h.advance.mock.calls.length === 1);
    for (let n = 0; n < 4; n++) {
      await vi.advanceTimersByTimeAsync(20_000);
      await row(id);
      await nextTurn();
    }
    expect(Number((await row(id)).lease_until)).toBeGreaterThan(Date.now());
    await advanceJob(id);
    expect(h.advance).toHaveBeenCalledTimes(1);
    h.resolve({ done: true });
    await run;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('stops waiting and removes its timer when cancellation revokes a stalled handler', async () => {
    const h = handler();
    const id = await seed();
    const run = advanceJob(id);
    await until(() => h.advance.mock.calls.length === 1);
    await cancelJobsByRef('ref-a');
    await vi.advanceTimersByTimeAsync(20_000);
    await run;
    expect(vi.getTimerCount()).toBe(0);
    h.reject(new Error('late ignored rejection'));
    await nextTurn();
    expect((await row(id)).status).toBe('cancelled');
  });
  it('stops admission and cleans up when heartbeat storage fails', async () => {
    const h = handler();
    const id = await seed();
    const run = advanceJob(id);
    await until(() => h.advance.mock.calls.length === 1);
    entry.db.mockImplementationOnce(() => {
      throw new Error('fixture storage unavailable');
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await run;
    expect(vi.getTimerCount()).toBe(0);
    h.resolve({ done: true });
    await nextTurn();
    expect((await row(id)).status).toBe('running');
    expect(h.advance).toHaveBeenCalledTimes(1);
  });
  it('does not resurrect an expired lease on heartbeat', async () => {
    const h = handler();
    const id = await seed();
    const run = advanceJob(id);
    await until(() => h.advance.mock.calls.length === 1);
    vi.setSystemTime(NOW + 90_000);
    await vi.advanceTimersByTimeAsync(20_000);
    await run;
    expect(Number((await row(id)).lease_until)).toBe(NOW + 60_000);
    expect(vi.getTimerCount()).toBe(0);
    const replacement = handler();
    const next = advanceJob(id);
    await until(() => replacement.advance.mock.calls.length === 1);
    replacement.resolve({ done: true });
    await next;
    h.resolve({ done: false, cursor: 'late' });
    await nextTurn();
    expect((await row(id)).lease_generation).toBe(2);
  });
  it('cleans up after handler failure and budget exhaustion', async () => {
    const h = handler();
    const id = await seed();
    const run = advanceJob(id);
    await until(() => h.advance.mock.calls.length === 1);
    h.reject(new Error('fixture failure'));
    await run;
    expect((await row(id)).status).toBe('failed');
    expect(vi.getTimerCount()).toBe(0);
    const next = handler();
    const id2 = await seed();
    const run2 = advanceJob(id2, 1);
    await until(() => next.advance.mock.calls.length === 1);
    vi.setSystemTime(NOW + 2);
    next.resolve({ done: false, cursor: { page: 1 } });
    await run2;
    expect((await row(id2)).cursor).toBe('{"page":1}');
    expect(vi.getTimerCount()).toBe(0);
  });
});
