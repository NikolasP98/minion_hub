import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { openPulsePostgres } from '../test-utils/pulse-postgres';
import {
  seedPulseAuthority,
  PULSE_FIXTURE_ORG as org,
  PULSE_FIXTURE_PROFILE as profile,
} from '../test-utils/pulse-fixtures';
import {
  digestFixturePolicy,
  digestFixtureSnapshot,
  digestFixtureResponse,
} from '../test-utils/pulse-digest-fixtures';
const boundary = vi.hoisted(() => ({ pool: vi.fn() }));
vi.mock('$server/db/pg-pool', () => ({
  getPgClient: boundary.pool,
  getRlsPgClient: boundary.pool,
  getCriticalPgClient: boundary.pool,
  resetAllPgPools: vi.fn(),
}));
import {
  queueDigestSnapshotTx,
  admitDigestAttemptTx,
  retainDigestReceipt,
  publishDigestTx,
} from './pulse-digest.store';
import { pulseDigestRuns } from '../db/pg-schema/pulse-digest';
import { bgJobs } from '../db/pg-schema/bg-jobs';
import { runSelectedTick } from './bg-runtime';
import './pulse-digest.worker';
import { parseDigestReceipt, validateDigestResult } from './pulse-digest.reasoning';
import { insertInternalPulseProposalTx, digestCardPayload } from './pulse-publication';
import { withOrgCoreTransaction } from '../db/with-org-core';
import { pulseHash } from './pulse-action-contract';
import type { DigestSnapshot } from './pulse-digest.sources';
let f: Awaited<ReturnType<typeof openPulsePostgres>>,
  policy: ReturnType<typeof digestFixturePolicy>,
  snapshot: DigestSnapshot;
let server: Server, origin: string, response: unknown, calls: number;
const nativeFetch = globalThis.fetch;
beforeEach(async () => {
  f = await openPulsePostgres();
  boundary.pool.mockReturnValue(f.pg);
  await seedPulseAuthority(f, 'wss://fixture.invalid');
  delete process.env.MINION_PULSE_WORKER_CONFIG;
  policy = digestFixturePolicy();
  process.env.MINION_PULSE_DIGEST_POLICY = JSON.stringify(policy);
  process.env.MINION_PULSE_DIGEST_SCOPE = JSON.stringify({
    tenantId: policy.tenantId,
    ownerProfileId: policy.ownerProfileId,
  });
  process.env.OPENROUTER_API_KEY = 'local-fixture-no-paid-access';
  snapshot = await digestFixtureSnapshot(policy);
  response = digestFixtureResponse(snapshot);
  calls = 0;
  server = createServer(async (req, res) => {
    for await (const _chunk of req) {
      /* consume the bounded SDK request */
    }
    calls++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(response));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture_bind');
  origin = `http://127.0.0.1:${address.port}`;
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = new URL(String(input));
    if (url.origin !== 'https://openrouter.ai' || url.pathname !== '/api/v1/chat/completions')
      throw new Error('external_fixture_network_denied');
    return nativeFetch(origin + url.pathname, init);
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.MINION_PULSE_DIGEST_POLICY;
  delete process.env.MINION_PULSE_DIGEST_SCOPE;
  delete process.env.OPENROUTER_API_KEY;
  await f?.close();
});
const tick = () =>
  runSelectedTick({
    tenantId: org,
    ownerProfileId: profile,
    types: ['pulse_digest'],
    budgetMs: 45000,
  });
async function queue() {
  const q = await f.db.transaction((tx) => queueDigestSnapshotTx(tx, policy, snapshot));
  if (!q) throw new Error('queue_denied');
  return q;
}
async function received(rawOverride?: string) {
  const q = await queue();
  await f.pg`update bg_jobs set status='running',lease_generation=1,lease_until=${Date.now() + 60000} where id=${q.jobId}`;
  const [row] = await f.db.select().from(pulseDigestRuns).where(eq(pulseDigestRuns.id, q.runId));
  const admitted = (await f.db.transaction((tx) => admitDigestAttemptTx(tx, policy, row, 1)))!;
  const receipt = parseDigestReceipt(
    rawOverride ?? JSON.stringify(digestFixtureResponse(snapshot)),
    200,
  );
  await retainDigestReceipt(f.db, admitted, receipt);
  return {
    q,
    row: (await f.db.select().from(pulseDigestRuns).where(eq(pulseDigestRuns.id, q.runId)))[0],
    job: (await f.db.select().from(bgJobs).where(eq(bgJobs.id, q.jobId)))[0],
    result: validateDigestResult(
      parseDigestReceipt(JSON.stringify(digestFixtureResponse(snapshot)), 200),
      policy,
      snapshot,
    ),
  };
}
describe('native actual digest worker and atomic publication', () => {
  it('rejects direct SQL publication binding a received run to another owners card', async () => {
    const r = await received();
    const otherCard = crypto.randomUUID();
    await f.pg`insert into pulse_proposals(id,org_id,owner_profile_id,source,kind,title,dedup_key)values(${otherCard},${org},'another-owner','fixture','fyi','Other private card',${otherCard})`;
    await expect(
      f.pg`update pulse_digest_runs set state='published',card_id=${otherCard},result_hash='wrong',result='{}'::jsonb where id=${r.row.id}`,
    ).rejects.toThrow('card binding mismatch');
    expect(
      (await f.pg`select state,card_id from pulse_digest_runs where id=${r.row.id}`)[0],
    ).toEqual({ state: 'reasoning_received', card_id: null });
  });

  it('rejects a stale checkpoint before admission with zero provider calls and superseded bookkeeping', async () => {
    const q = await queue();
    await f.pg`update pulse_digest_sources set revision=1,content_hash='newer'`;
    await tick();
    const [run] = await f.pg`select state from pulse_digest_runs where id=${q.runId}`;
    const [ns] = await f.pg`select attempted_calls,reserved_micro_usd from pulse_digest_admission`;
    console.info(
      'checkpoint-admission-probe',
      JSON.stringify({
        providerRequests: calls,
        admittedCalls: ns.attempted_calls,
        reservedMicroUsd: Number(ns.reserved_micro_usd),
        state: run.state,
        cards: (await f.pg`select id from pulse_proposals`).length,
      }),
    );
    expect(calls).toBe(0);
    expect(ns.attempted_calls).toBe(0);
    expect(Number(ns.reserved_micro_usd)).toBe(0);
    expect(run.state).toBe('superseded');
    expect((await f.pg`select status from bg_jobs where id=${q.jobId}`)[0].status).toBe('done');
  });

  it('publishes one card with accepted cursors run and job in the actual selected worker', async () => {
    const q = await queue();
    expect(await tick()).toEqual({ advanced: 1 });
    expect(calls).toBe(1);
    const [state] =
      await f.pg`select r.state,r.card_id,j.status,s.revision from pulse_digest_runs r join bg_jobs j on j.id=r.bg_job_id join pulse_digest_sources s on s.last_run_id=r.id where r.id=${q.runId}`;
    expect(state).toMatchObject({ state: 'published', status: 'done', revision: 1 });
    expect(state.card_id).toBeTruthy();
    expect(await f.pg`select id from pulse_proposals`).toHaveLength(1);
    expect((await f.pg`select kind from pulse_proposals`)[0].kind).toBe('digest');
    expect((await queue()).runId).toBe(q.runId);
    expect(await tick()).toEqual({ advanced: 0 });
    expect(calls).toBe(1);
  });
  it('settles deterministic unchanged no-signal without provider traffic', async () => {
    snapshot = { ...snapshot, unchanged: true };
    await queue();
    await tick();
    expect(calls).toBe(0);
    expect(await f.pg`select id from pulse_proposals`).toHaveLength(0);
    const [r] = await f.pg`select state from pulse_digest_runs`;
    expect(r.state).toBe('no_signal');
    const [s] = await f.pg`select revision from pulse_digest_sources`;
    expect(s.revision).toBe(1);
  });
  it('retains billed invalid output without cursor advance and fences unknown billing', async () => {
    response = digestFixtureResponse(snapshot, { invalid: true });
    await queue();
    await tick();
    const [r] = await f.pg`select state,cost_micro_usd from pulse_digest_runs`;
    expect(r.state).toBe('failed');
    expect(Number(r.cost_micro_usd)).toBe(100);
    const [s] = await f.pg`select revision from pulse_digest_sources`;
    expect(s.revision).toBe(0);
    expect(calls).toBe(1);
    snapshot = await digestFixtureSnapshot(policy, 'v2');
    response = digestFixtureResponse(snapshot, { cost: null });
    await queue();
    await tick();
    const [ns] =
      await f.pg`select unknown_exposure_fence,reserved_micro_usd from pulse_digest_admission`;
    expect(ns.unknown_exposure_fence).toBe(true);
    expect(Number(ns.reserved_micro_usd)).toBe(1000);
    expect(await f.pg`select id from pulse_proposals`).toHaveLength(0);
  });
  it('rolls back card cursor run and job together on a cursor fault then recovers locally', async () => {
    const r = await received();
    await f.pg.unsafe(
      "create function fixture_cursor_fault() returns trigger language plpgsql as $$begin raise exception 'fixture cursor fault'; end$$;create trigger fixture_cursor_fault before update on pulse_digest_sources for each row execute function fixture_cursor_fault()",
    );
    await expect(
      f.db.transaction((tx) => publishDigestTx(tx, policy, r.job, r.row, r.result)),
    ).rejects.toThrow();
    expect(await f.pg`select id from pulse_proposals`).toHaveLength(0);
    expect((await f.pg`select revision from pulse_digest_sources`)[0].revision).toBe(0);
    expect((await f.pg`select state from pulse_digest_runs`)[0].state).toBe('reasoning_received');
    expect((await f.pg`select status from bg_jobs`)[0].status).toBe('running');
    await f.pg.unsafe('drop trigger fixture_cursor_fault on pulse_digest_sources');
    await f.db.transaction((tx) => publishDigestTx(tx, policy, r.job, r.row, r.result));
    expect(calls).toBe(0);
    expect(await f.pg`select id from pulse_proposals`).toHaveLength(1);
  });
  it('supersedes a stale source revision without any card or checkpoint overwrite', async () => {
    const r = await received();
    await f.pg`update pulse_digest_sources set revision=revision+1,content_hash='newer'`;
    await f.db.transaction((tx) => publishDigestTx(tx, policy, r.job, r.row, r.result));
    expect(await f.pg`select id from pulse_proposals`).toHaveLength(0);
    expect((await f.pg`select state from pulse_digest_runs`)[0].state).toBe('superseded');
    expect((await f.pg`select content_hash from pulse_digest_sources`)[0].content_hash).toBe(
      'newer',
    );
  });
  it('requires full immutable binding and returns the existing decided card only for identical content', async () => {
    const r = await received();
    const cardId = await f.db.transaction((tx) =>
      publishDigestTx(tx, policy, r.job, r.row, r.result),
    );
    const input = {
      runId: r.row.id,
      policyRevision: policy.revision,
      inputHash: snapshot.hash,
      resultHash: pulseHash(r.result),
      title: r.result.title,
      summary: r.result.summary,
      payload: digestCardPayload(r.result, snapshot),
    };
    await f.pg`update pulse_proposals set status='dismissed' where id=${cardId}`;
    const same = await f.db.transaction((tx) =>
      withOrgCoreTransaction({ tenantId: org, profileId: profile }, tx, (d) =>
        insertInternalPulseProposalTx(d, { tenantId: org, profileId: profile }, input),
      ),
    );
    expect(same).toEqual({ cardId, existing: true });
    await expect(
      f.db.transaction((tx) =>
        withOrgCoreTransaction({ tenantId: org, profileId: profile }, tx, (d) =>
          insertInternalPulseProposalTx(
            d,
            { tenantId: org, profileId: profile },
            { ...input, title: 'changed' },
          ),
        ),
      ),
    ).rejects.toThrow('binding_conflict');
  });
  it('rejects malformed received SDK index annotations usage and custom output locally preserving raw known bills', async () => {
    for (const kind of ['index', 'annotations', 'usage', 'custom']) {
      if (kind !== 'index') {
        await f.close();
        f = await openPulsePostgres();
        boundary.pool.mockReturnValue(f.pg);
        await seedPulseAuthority(f, 'wss://fixture.invalid');
        delete process.env.MINION_PULSE_WORKER_CONFIG;
      }
      const wire = digestFixtureResponse(snapshot);
      let malformed: unknown = wire;
      if (kind === 'index')
        malformed = { ...wire, choices: [{ ...wire.choices[0], index: 'invalid' }] };
      if (kind === 'annotations')
        malformed = {
          ...wire,
          choices: [
            {
              ...wire.choices[0],
              message: { ...wire.choices[0].message, annotations: [{ type: 'invalid' }] },
            },
          ],
        };
      if (kind === 'usage')
        malformed = { ...wire, usage: { ...wire.usage, prompt_tokens: 'invalid' } };
      if (kind === 'custom')
        malformed = {
          ...wire,
          choices: [
            {
              ...wire.choices[0],
              message: { ...wire.choices[0].message, content: 'invalid-json' },
            },
          ],
        };
      const raw = JSON.stringify(malformed);
      const r = await received(raw);
      await f.pg`update bg_jobs set lease_until=0 where id=${r.q.jobId}`;
      await tick();
      const [stored] =
        await f.pg`select state,raw_response,receipt_hash,cost_micro_usd from pulse_digest_runs`;
      expect(stored.state).toBe('failed');
      expect(stored.raw_response).toBe(raw);
      expect(stored.receipt_hash).toBe(parseDigestReceipt(raw, 200).receiptHash);
      expect(Number(stored.cost_micro_usd)).toBe(100);
      expect(calls).toBe(0);
      expect(await f.pg`select id from pulse_proposals`).toHaveLength(0);
      expect((await f.pg`select revision from pulse_digest_sources`)[0].revision).toBe(0);
      const [ns] =
        await f.pg`select attempted_calls,reserved_micro_usd,settled_micro_usd from pulse_digest_admission`;
      expect(ns.attempted_calls).toBe(1);
      expect(Number(ns.reserved_micro_usd)).toBe(0);
      expect(Number(ns.settled_micro_usd)).toBe(100);
    }
  });
  it('crashes actual worker children at admission received card cursor and commit boundaries without recall', async () => {
    for (const checkpoint of [
      'after-admission',
      'after-received',
      'after-card',
      'after-cursor',
      'before-commit',
      'after-commit',
    ]) {
      // Complete each prior logical namespace before the next case; admitted uncertainty gets its own schema.
      if (checkpoint !== 'after-admission') {
        await f.close();
        f = await openPulsePostgres();
        boundary.pool.mockReturnValue(f.pg);
        await seedPulseAuthority(f, 'wss://fixture.invalid');
        delete process.env.MINION_PULSE_WORKER_CONFIG;
      }
      const q = await queue();
      const before = calls;
      const exit = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
        const child = spawn(process.execPath, ['scripts/qc/pulse-digest-crash-child.mjs'], {
          cwd: process.cwd(),
          env: {
            PATH: process.env.PATH,
            NODE_ENV: 'test',
            TURSO_DB_URL: 'file::memory:',
            OPENROUTER_API_KEY: 'local-fixture-no-paid-access',
            MINION_QC_DISPOSABLE: '1',
            MINION_QC_DATABASE_URL: process.env.MINION_QC_DATABASE_URL,
            MINION_PULSE_DIGEST_POLICY: JSON.stringify(policy),
            MINION_PULSE_DIGEST_SCOPE: JSON.stringify({
              tenantId: policy.tenantId,
              ownerProfileId: policy.ownerProfileId,
            }),
            MINION_PULSE_CRASH_SCHEMA: f.schema,
            MINION_PULSE_CRASH_ORG: org,
            MINION_PULSE_CRASH_PROFILE: profile,
            MINION_PULSE_CRASH_CHECKPOINT: checkpoint,
            MINION_DIGEST_FIXTURE_PROVIDER: origin,
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_CONFIG_NOSYSTEM: '1',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error('digest child timeout'));
        }, 20000);
        child.stdout.on('data', (chunk) => {
          output += String(chunk);
        });
        child.stderr.on('data', (chunk) => {
          output += String(chunk);
        });
        child.on('error', reject);
        child.on('exit', (code) => {
          clearTimeout(timer);
          resolve({ code, output });
        });
      });
      expect(exit.code, `${checkpoint}: ${exit.output}`).toBe(74);
      expect(calls - before).toBe(checkpoint === 'after-admission' ? 0 : 1);
      await f.pg`update bg_jobs set lease_until=0 where id=${q.jobId} and status='running'`;
      await tick();
      const [r] = await f.pg`select state from pulse_digest_runs where id=${q.runId}`;
      expect(r.state).toBe(checkpoint === 'after-admission' ? 'indeterminate' : 'published');
      expect(calls - before).toBe(checkpoint === 'after-admission' ? 0 : 1);
      expect(await f.pg`select id from pulse_proposals`).toHaveLength(
        checkpoint === 'after-admission' ? 0 : 1,
      );
    }
  }, 120000);
});
