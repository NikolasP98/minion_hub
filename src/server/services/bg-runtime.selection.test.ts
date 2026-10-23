import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPulsePostgres } from '../test-utils/pulse-postgres';
const boundary = vi.hoisted(() => ({ pool: vi.fn() }));
vi.mock('$server/db/pg-pool', () => ({
  getPgClient: boundary.pool,
  getRlsPgClient: boundary.pool,
  getCriticalPgClient: boundary.pool,
  resetAllPgPools: vi.fn(),
}));
import { enqueueJob, advanceJob, registerJobHandler, runSelectedTick } from './bg-runtime';
let fixture: Awaited<ReturnType<typeof openPulsePostgres>>;
const scope = {
  tenantId: 'org-fixture',
  ownerProfileId: 'owner-fixture',
  types: ['pulse_dispatch'],
  budgetMs: 5000,
};
beforeAll(async () => {
  fixture = await openPulsePostgres();
  boundary.pool.mockReturnValue(fixture.pg);
});
afterAll(async () => {
  await fixture?.close();
});
beforeEach(async () => {
  await fixture.pg`delete from bg_jobs`;
});
async function seed(type = 'pulse_dispatch', owner = scope.ownerProfileId, org = scope.tenantId) {
  return enqueueJob({ tenantId: org, userId: owner, type });
}
describe('selected queue uses real PostgreSQL admission predicates', () => {
  it('does not invoke after a post-claim read exhausts its budget and retains resumable bookkeeping', async () => {
    const id = await enqueueJob({
      tenantId: scope.tenantId,
      userId: scope.ownerProfileId,
      type: 'pulse_dispatch',
      cursor: { offset: 7 },
    });
    let monotonic = 0;
    let jobReads = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => monotonic);
    const previousDebug = fixture.pg.options.debug;
    fixture.pg.options.debug = (_connection, text) => {
      if (
        text.startsWith('select ') &&
        text.includes('from "bg_jobs" where "bg_jobs"."id" =') &&
        ++jobReads === 2
      )
        monotonic = 1001;
    };
    const run = vi.fn(async () => ({ done: true }));
    registerJobHandler({ type: 'pulse_dispatch', advance: run });
    try {
      expect(await runSelectedTick({ ...scope, budgetMs: 1000 })).toEqual({ advanced: 0 });
      expect(jobReads).toBe(2);
      expect(run).not.toHaveBeenCalled();
      const [job] =
        await fixture.pg`select status,lease_generation,cursor,attempts,next_attempt_at,lease_until from bg_jobs where id=${id}`;
      expect(job).toMatchObject({
        status: 'running',
        lease_generation: 1,
        cursor: JSON.stringify({ offset: 7 }),
        attempts: 0,
        next_attempt_at: null,
      });
      expect(Number(job.lease_until)).toBeGreaterThan(Date.now());
    } finally {
      fixture.pg.options.debug = previousDebug;
      clock.mockRestore();
    }
  });
  it('does not extend selected admission or callback budget when wall time moves backward', async () => {
    const first = await seed();
    await seed();
    await fixture.pg`update bg_jobs set updated_at=1 where id=${first}`;
    const invoked: string[] = [];
    let shiftedBudget = 0;
    let restoreWallClock = () => {};
    registerJobHandler({
      type: 'pulse_dispatch',
      advance: async (job, execution) => {
        invoked.push(job.id);
        if (invoked.length === 1) {
          const shiftedNow = Date.now() - 60_000;
          const wallClock = vi.spyOn(Date, 'now').mockReturnValue(shiftedNow);
          restoreWallClock = () => wallClock.mockRestore();
          shiftedBudget = execution.remainingMs();
          await new Promise<void>((resolve) => {
            if (execution.signal.aborted) resolve();
            else execution.signal.addEventListener('abort', () => resolve(), { once: true });
          });
        }
        return { done: true };
      },
    });
    try {
      expect(await runSelectedTick({ ...scope, budgetMs: 1000 })).toEqual({ advanced: 1 });
      expect(invoked).toEqual([first]);
      expect(shiftedBudget).toBeGreaterThan(0);
      expect(shiftedBudget).toBeLessThanOrEqual(1000);
    } finally {
      restoreWallClock();
    }
  });
  it('selects owner/org/type/due before LIMIT and counts only handler invocation', async () => {
    for (let i = 0; i < 25; i++) await seed('unrelated');
    await seed('pulse_dispatch', 'other-owner');
    await seed('pulse_dispatch', scope.ownerProfileId, 'other-org');
    const future = await seed();
    await fixture.pg`update bg_jobs set next_attempt_at=${Date.now() + 30000} where id=${future}`;
    const wanted = await seed();
    const run = vi.fn(async (_job: import('./bg-runtime').BgJob) => ({ done: true }));
    registerJobHandler({ type: 'pulse_dispatch', advance: run });
    const captured: { query?: { text: string; parameters: (string | number | boolean | null)[] } } =
      {};
    const previousDebug = fixture.pg.options.debug;
    fixture.pg.options.debug = (_connection, text, parameters) => {
      if (text.startsWith('select "id", "lease_generation" from "bg_jobs"'))
        captured.query = {
          text,
          parameters: parameters.map((value: unknown) => {
            if (value === null || ['string', 'number', 'boolean'].includes(typeof value))
              return value as string | number | boolean | null;
            throw new Error('Unexpected selected-query parameter');
          }),
        };
    };
    try {
      expect(await runSelectedTick(scope)).toEqual({ advanced: 1 });
    } finally {
      fixture.pg.options.debug = previousDebug;
    }
    expect(captured.query).toBeDefined();
    const plan = await fixture.pg.unsafe(
      `explain (analyze,buffers,format json) ${captured.query!.text}`,
      captured.query!.parameters,
    );
    console.info(
      JSON.stringify({
        pulseSelectedQueuePlan: {
          query: captured.query,
          plan,
          unrelatedRows: 25,
          note: 'Actual captured selection query; completed candidate is now done; no forced planner choice.',
        },
      }),
    );
    expect(plan).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0].id).toBe(wanted);
    expect(await advanceJob(future)).toBe(false);
    const [row] = await fixture.pg`select status,lease_generation from bg_jobs where id=${future}`;
    expect(row).toEqual({ status: 'queued', lease_generation: 0 });
  });
  it('rechecks due time and generation after a stale candidate waits for another transaction', async () => {
    const id = await seed();
    let unlock!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const hasLock = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const transaction = fixture.peer.begin(async (tx) => {
      await tx`select id from bg_jobs where id=${id} for update`;
      locked();
      await gate;
      await tx`update bg_jobs set next_attempt_at=${Date.now() + 30000},lease_generation=lease_generation+1 where id=${id}`;
    });
    await hasLock;
    const run = vi.fn(async () => ({ done: true }));
    registerJobHandler({ type: 'pulse_dispatch', advance: run });
    const tick = runSelectedTick(scope);
    let waiting = false;
    for (let n = 0; n < 100; n++) {
      const rows = await fixture.harness
        .owner`select pid from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query ilike '%update%bg_jobs%'`;
      if (rows.length) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    unlock();
    await transaction;
    expect(waiting).toBe(true);
    expect(await tick).toEqual({ advanced: 0 });
    expect(run).not.toHaveBeenCalled();
    expect(await advanceJob(id)).toBe(false);
  });
  it('postpones domain/job atomically, releases ownership and cannot direct-advance due work', async () => {
    const id = await seed();
    const run = vi.fn(async () => ({
      done: false,
      postponeUntil: Date.now() + 5000,
      commitPostpone: async (tx: import('./bg-runtime').JobTransaction) => {
        await tx.execute((await import('drizzle-orm')).sql`select 1`);
      },
    }));
    registerJobHandler({ type: 'pulse_dispatch', pulseRetry: true, advance: run });
    expect(await runSelectedTick(scope)).toEqual({ advanced: 1 });
    const [row] =
      await fixture.pg`select status,lease_generation,lease_until,next_attempt_at from bg_jobs where id=${id}`;
    expect(row.status).toBe('queued');
    expect(row.lease_generation).toBe(2);
    expect(row.lease_until).toBeNull();
    expect(Number(row.next_attempt_at)).toBeGreaterThan(Date.now());
    expect(await advanceJob(id)).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('rolls back domain retry bookkeeping when the owned postponement transaction fails', async () => {
    await fixture.pg.unsafe(
      'create table pulse_fixture_retry_counter(n integer not null); insert into pulse_fixture_retry_counter values(0)',
    );
    const id = await seed();
    registerJobHandler({
      type: 'pulse_dispatch',
      pulseRetry: true,
      advance: async () => ({
        done: false,
        postponeUntil: Date.now() + 5000,
        commitPostpone: async (tx) => {
          const { sql } = await import('drizzle-orm');
          await tx.execute(sql`update pulse_fixture_retry_counter set n=n+1`);
          throw new Error('fixture postponement rollback');
        },
      }),
    });
    await expect(runSelectedTick(scope)).rejects.toThrow('fixture postponement rollback');
    const [counter] = await fixture.pg`select n from pulse_fixture_retry_counter`;
    expect(counter.n).toBe(0);
    const [job] =
      await fixture.pg`select next_attempt_at,lease_generation from bg_jobs where id=${id}`;
    expect(job).toEqual({ next_attempt_at: null, lease_generation: 1 });
  });
  it('does not count a missing handler and rejects accidental postponement opt-in', async () => {
    const id = await seed('pulse_digest');
    expect(await runSelectedTick({ ...scope, types: ['pulse_digest'] })).toEqual({ advanced: 0 });
    registerJobHandler({
      type: 'pulse_digest',
      advance: async () => ({
        done: false,
        postponeUntil: Date.now() + 5000,
        commitPostpone: async () => {},
      }),
    });
    expect(await runSelectedTick({ ...scope, types: ['pulse_digest'] })).toEqual({ advanced: 1 });
    const [row] = await fixture.pg`select status from bg_jobs where id=${id}`;
    expect(row.status).toBe('failed');
  });
});
