import { setImmediate as nextTurn } from 'node:timers/promises';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ db: vi.fn(), provider: vi.fn() }));
vi.mock('$server/db/pg-client', () => ({
  getCoreDb: boundary.db,
  getOrgTransactionDb: (db: unknown) => db,
}));
vi.mock('$lib/server/gateway-rpc', () => ({ gatewayCall: boundary.provider }));
import { advanceJob, cancelJobsByRef, enqueueJob } from './bg-runtime';
import { createGroupchatRun, setRunStatus } from './groupchat.service';

const client = new PGlite();
const db = drizzle(client);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function until(condition: () => boolean) {
  for (let attempt = 0; attempt < 2000; attempt++) {
    if (condition()) return;
    await nextTurn();
  }
  throw new Error('groupchat fixture did not reach the expected boundary');
}
async function seed(rounds = 1) {
  const runId = await createGroupchatRun({
    tenantId: 'tenant-a',
    prompt: 'Synthetic prompt',
    rounds,
    style: 'freeform',
    includeOrchestrator: false,
    background: true,
    agents: [{ name: 'Fixture', systemPrompt: 'Synthetic', provider: 'fake', modelId: 'fake' }],
  });
  const jobId = await enqueueJob({ tenantId: 'tenant-a', type: 'groupchat', refId: runId });
  return { runId, jobId };
}
beforeAll(async () => {
  await client.exec(`CREATE TABLE bg_jobs (
    id text PRIMARY KEY, tenant_id text NOT NULL, user_id text, type text NOT NULL, ref_id text,
    status text NOT NULL DEFAULT 'queued', cursor text, error text, attempts integer NOT NULL DEFAULT 0,
    lease_generation integer NOT NULL DEFAULT 0, lease_until bigint, created_at bigint NOT NULL,
    updated_at bigint NOT NULL, started_at bigint, finished_at bigint);
    CREATE TABLE workshop_groupchat_runs (id text PRIMARY KEY, tenant_id text NOT NULL,
    server_id text, user_id text, prompt text NOT NULL, status text NOT NULL DEFAULT 'draft',
    rounds integer, style text, include_orchestrator boolean NOT NULL DEFAULT false,
    background boolean NOT NULL DEFAULT false, settings text, current_round integer NOT NULL DEFAULT 0,
    created_at bigint NOT NULL, finished_at bigint);
    CREATE TABLE workshop_groupchat_agents (id text PRIMARY KEY, run_id text NOT NULL,
    name text NOT NULL, system_prompt text NOT NULL, provider text NOT NULL, model_id text NOT NULL,
    order_index integer NOT NULL DEFAULT 0);
    CREATE TABLE workshop_groupchat_messages (id text PRIMARY KEY, run_id text NOT NULL, agent_id text,
    round integer NOT NULL, role text NOT NULL, content text NOT NULL, model_id text,
    latency_ms integer, tokens integer, cost_usd double precision, created_at bigint NOT NULL);`);
}, 30_000);
beforeEach(async () => {
  boundary.db.mockReturnValue(db);
  boundary.provider.mockReset();
  await client.exec(
    'TRUNCATE bg_jobs, workshop_groupchat_runs, workshop_groupchat_agents, workshop_groupchat_messages',
  );
});
afterAll(() => client.close());

describe('groupchat effect ownership with a fake provider and actual SQL', () => {
  it('preserves unrelated run settings while persisting the server effect checkpoint', async () => {
    boundary.provider.mockResolvedValue({ text: 'Contribution' });
    const { runId, jobId } = await seed();
    await client.query('UPDATE workshop_groupchat_runs SET settings=$1 WHERE id=$2', [
      JSON.stringify({ fixturePreference: 'preserved' }),
      runId,
    ]);
    await advanceJob(jobId);
    const [row] = (
      await client.query<{ settings: string }>('SELECT settings FROM workshop_groupchat_runs')
    ).rows;
    expect(JSON.parse(row.settings)).toMatchObject({
      fixturePreference: 'preserved',
      __jobEffect: { state: 'committed' },
    });
  });
  it('does not let a job for another tenant admit or mutate this run', async () => {
    const { runId } = await seed();
    const other = await enqueueJob({ tenantId: 'tenant-b', type: 'groupchat', refId: runId });
    await advanceJob(other);
    expect(boundary.provider).not.toHaveBeenCalled();
    expect(
      (await client.query('SELECT status,settings FROM workshop_groupchat_runs')).rows,
    ).toEqual([{ status: 'draft', settings: null }]);
  });
  it('rejects transcript changes while an admitted model turn is in flight', async () => {
    const output = deferred<{ text: string }>();
    boundary.provider
      .mockResolvedValueOnce({ text: 'First contribution' })
      .mockReturnValueOnce(output.promise);
    const { jobId } = await seed(2);
    const advancing = advanceJob(jobId);
    await until(() => boundary.provider.mock.calls.length === 2);
    await client.query("UPDATE workshop_groupchat_messages SET content='Changed contribution'");
    output.resolve({ text: 'Response to original transcript' });
    await advancing;
    expect((await client.query('SELECT * FROM workshop_groupchat_messages')).rows).toHaveLength(1);
    expect(
      (await client.query<{ error: string }>('SELECT error FROM bg_jobs')).rows[0].error,
    ).toContain('configuration changed');
    expect((await client.query('SELECT status FROM workshop_groupchat_runs')).rows).toEqual([
      { status: 'failed' },
    ]);
    expect(boundary.provider).toHaveBeenCalledTimes(2);
  });
  it('preserves cancellation when the run update wins before the job cancellation update', async () => {
    const output = deferred<{ text: string }>();
    boundary.provider.mockReturnValue(output.promise);
    const { runId, jobId } = await seed();
    const advancing = advanceJob(jobId);
    await until(() => boundary.provider.mock.calls.length === 1);
    await setRunStatus(runId, 'cancelled');
    output.resolve({ text: 'Late result' });
    await advancing;
    expect((await client.query('SELECT status FROM bg_jobs')).rows).toEqual([
      { status: 'cancelled' },
    ]);
    expect((await client.query('SELECT * FROM workshop_groupchat_messages')).rows).toEqual([]);
  });
  it('a late cancellation cannot replace an already committed run terminal', async () => {
    boundary.provider.mockResolvedValue({ text: 'Completed' });
    const { runId, jobId } = await seed();
    await advanceJob(jobId);
    await setRunStatus(runId, 'cancelled');
    expect((await client.query('SELECT status FROM workshop_groupchat_runs')).rows).toEqual([
      { status: 'done' },
    ]);
  });
  it('does not persist late output or start another effect after cancellation', async () => {
    const output = deferred<{ text: string }>();
    boundary.provider.mockReturnValue(output.promise);
    const { runId, jobId } = await seed(2);
    const advancing = advanceJob(jobId);
    await until(() => boundary.provider.mock.calls.length === 1);
    await cancelJobsByRef(runId);
    output.resolve({ text: 'Late result' });
    await advancing;
    expect((await client.query('SELECT * FROM workshop_groupchat_messages')).rows).toEqual([]);
    expect(boundary.provider).toHaveBeenCalledTimes(1);
    expect((await client.query('SELECT status FROM bg_jobs')).rows).toEqual([
      { status: 'cancelled' },
    ]);
  });
  it('does not replay an indeterminate admitted provider call after restart', async () => {
    boundary.provider.mockRejectedValue(new Error('fake response lost'));
    const { jobId } = await seed();
    await advanceJob(jobId);
    expect((await client.query('SELECT status FROM workshop_groupchat_runs')).rows).toEqual([
      { status: 'failed' },
    ]);
    await client.query("UPDATE bg_jobs SET status='queued', lease_until=NULL WHERE id=$1", [jobId]);
    await advanceJob(jobId);
    expect(boundary.provider).toHaveBeenCalledTimes(1);
    expect((await client.query('SELECT error FROM bg_jobs')).rows[0]).toEqual({
      error: 'groupchat effect outcome indeterminate; reconciliation required',
    });
  });
  it('does not start an already admitted turn through a second job for the same run', async () => {
    const output = deferred<{ text: string }>();
    boundary.provider.mockReturnValue(output.promise);
    const { jobId, runId } = await seed();
    const first = advanceJob(jobId);
    await until(() => boundary.provider.mock.calls.length === 1);
    const secondId = await enqueueJob({ tenantId: 'tenant-a', type: 'groupchat', refId: runId });
    const second = advanceJob(secondId);
    // Resolve the original call; second must never have admitted another call.
    output.resolve({ text: 'One contribution' });
    await Promise.all([first, second]);
    expect(boundary.provider).toHaveBeenCalledTimes(1);
    expect(
      (await client.query('SELECT * FROM workshop_groupchat_messages')).rows.length,
    ).toBeLessThanOrEqual(1);
  });
});
