import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
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
const boundary = vi.hoisted(() => ({ pool: vi.fn(), source: vi.fn(), admin: vi.fn() }));
vi.mock('$server/supabase', () => ({ supabaseAdmin: boundary.admin }));
vi.mock('$server/db/pg-pool', () => ({
  getPgClient: boundary.pool,
  getRlsPgClient: boundary.pool,
  getCriticalPgClient: boundary.pool,
  resetAllPgPools: vi.fn(),
}));
vi.mock('./pulse-digest.fetch', () => ({ fetchDigestSource: boundary.source }));
import { collectDueDigest } from './pulse-digest.collection';
import { GET } from '../../routes/api/pulse/tick/+server';
import { updateUserOrganizations } from './user.service';
import {
  queueDigestSnapshotTx,
  admitDigestAttemptTx,
  retainDigestReceipt,
  publishDigestTx,
} from './pulse-digest.store';
import { pulseDigestRuns } from '../db/pg-schema/pulse-digest';
import { bgJobs } from '../db/pg-schema/bg-jobs';
import { parseDigestReceipt, validateDigestResult } from './pulse-digest.reasoning';
import { savePulseFeedback } from './pulse-feedback.service';
import { pulseHash } from './pulse-action-contract';
let f: Awaited<ReturnType<typeof openPulsePostgres>>,
  policy: ReturnType<typeof digestFixturePolicy>,
  server: Server,
  origin: string,
  version: string,
  sourceCalls: number,
  modelCalls: number;
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
  process.env.CRON_SECRET = 'local-pulse-cron-fixture';
  process.env.OPENROUTER_API_KEY = 'local-fixture-no-paid-access';
  version = 'v1';
  sourceCalls = 0;
  modelCalls = 0;
  boundary.admin.mockReturnValue({
    from: (table: string) => {
      if (table !== 'organization_members') throw new Error('fixture table');
      return {
        select: () => ({
          eq: async () => ({
            data: await f.pg`select organization_id from organization_members where profile_id=${profile}`,
            error: null,
          }),
        }),
        delete: () => ({
          eq: () => ({
            in: async () => {
              await f.peer`delete from organization_members where profile_id=${profile}`;
              return { error: null };
            },
          }),
        }),
      };
    },
  });
  boundary.source.mockReset();
  boundary.source.mockImplementation(async () => {
    sourceCalls++;
    return {
      status: 200,
      etag: version,
      lastModified: null,
      body: JSON.stringify([
        {
          html_url: `https://github.com/vercel/ai/releases/tag/${version}`,
          tag_name: `ai@${version}`,
          name: 'Fixture release',
          body: 'A supported synthetic dependency change.',
        },
      ]),
    };
  });
  server = createServer(async (req, res) => {
    for await (const _chunk of req) {
    }
    modelCalls++;
    const snapshot = await digestFixtureSnapshot(policy, version);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(digestFixtureResponse(snapshot)));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture_bind');
  origin = `http://127.0.0.1:${address.port}`;
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = new URL(String(input));
    if (url.origin !== 'https://openrouter.ai' || !url.pathname.endsWith('/chat/completions'))
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
  delete process.env.CRON_SECRET;
  await f?.close();
});
const event = () =>
  ({
    request: new Request('http://127.0.0.1/api/pulse/tick', {
      headers: { authorization: 'Bearer local-pulse-cron-fixture' },
    }),
    url: new URL('http://127.0.0.1/api/pulse/tick'),
  }) as unknown as Parameters<typeof GET>[0];
async function resetRetentionFixture() {
  await f.close();
  f = await openPulsePostgres();
  boundary.pool.mockReturnValue(f.pg);
  await seedPulseAuthority(f, 'wss://fixture.invalid');
  delete process.env.MINION_PULSE_WORKER_CONFIG;
  process.env.MINION_PULSE_DIGEST_POLICY = JSON.stringify(policy);
}
async function expiredRun(admit = false) {
  const snapshot = await digestFixtureSnapshot(policy, 'retention');
  const queued = await f.db.transaction((tx) => queueDigestSnapshotTx(tx, policy, snapshot));
  if (!queued) throw new Error('fixture queue denied');
  let admitted: typeof pulseDigestRuns.$inferSelect | null = null;
  if (admit) {
    const [row] = await f.db
      .select()
      .from(pulseDigestRuns)
      .where(eq(pulseDigestRuns.id, queued.runId));
    admitted = await f.db.transaction((tx) => admitDigestAttemptTx(tx, policy, row, 1));
    if (!admitted) throw new Error('fixture admission denied');
    await f.pg`update bg_jobs set status='running',lease_generation=1,lease_until=${Date.now() + 60000} where id=${queued.jobId}`;
  }
  await f.pg.unsafe('alter table pulse_digest_runs disable trigger pulse_digest_guard');
  try {
    await f.pg`update pulse_digest_runs set created_at=now()-interval '31 days' where id=${queued.runId}`;
  } finally {
    await f.pg.unsafe('alter table pulse_digest_runs enable trigger pulse_digest_guard');
  }
  return { queued, snapshot, admitted };
}
describe('native cold-start collection and authenticated selected tick', () => {
  it.each(['missing-policy', 'expired-policy', 'module-disabled'])(
    'redacts expired raw runs through actual tick with %s',
    async (mode) => {
      const { queued, snapshot } = await expiredRun();
      if (mode === 'missing-policy') delete process.env.MINION_PULSE_DIGEST_POLICY;
      else if (mode === 'expired-policy')
        process.env.MINION_PULSE_DIGEST_POLICY = JSON.stringify({
          ...policy,
          approval: { ...policy.approval, expiresAt: '2000-01-01T00:00:00Z' },
        });
      else
        await f.pg`insert into app_modules(org_id,module_id,enabled)values(${org},'pulse',false)`;
      await GET(event());
      const [row] =
        await f.pg`select state,evidence,snapshot,raw_response,redacted_at,source_snapshot_hash from pulse_digest_runs where id=${queued.runId}`;
      expect(row.state).toBe('canceled');
      expect(row.evidence).toBeNull();
      expect(row.snapshot).toBeNull();
      expect(row.raw_response).toBeNull();
      expect(row.redacted_at).toBeTruthy();
      expect(row.source_snapshot_hash).toBe(snapshot.hash);
      expect(modelCalls).toBe(0);
      expect(sourceCalls).toBe(0);
    },
  );
  it('keeps expired late bills without rehydrating response bodies or releasing unknown exposure', async () => {
    for (const timing of ['before-cleanup', 'after-cleanup']) {
      if (timing === 'after-cleanup') await resetRetentionFixture();
      const { queued, admitted, snapshot } = await expiredRun(true);
      if (!admitted) throw new Error('fixture admission missing');
      delete process.env.MINION_PULSE_DIGEST_POLICY;
      if (timing === 'after-cleanup') await GET(event());
      const receipt = parseDigestReceipt(JSON.stringify(digestFixtureResponse(snapshot)), 200);
      await retainDigestReceipt(f.db, admitted, receipt);
      const [late] =
        await f.pg`select state,raw_response,cost_micro_usd,receipt_hash from pulse_digest_runs where id=${queued.runId}`;
      expect(late.state).toBe('indeterminate');
      expect(late.raw_response).toBeNull();
      expect(Number(late.cost_micro_usd)).toBe(100);
      expect(late.receipt_hash).toBe(receipt.receiptHash);
      if (timing === 'before-cleanup') await GET(event());
      const [row] =
        await f.pg`select evidence,snapshot,raw_response,cost_micro_usd,redacted_at from pulse_digest_runs where id=${queued.runId}`;
      expect(row.evidence).toBeNull();
      expect(row.snapshot).toBeNull();
      expect(row.raw_response).toBeNull();
      expect(Number(row.cost_micro_usd)).toBe(100);
      expect(row.redacted_at).toBeTruthy();
      const [ns] =
        await f.pg`select reserved_micro_usd,unknown_exposure_fence,active_attempt_id,attempted_calls from pulse_digest_admission`;
      expect(Number(ns.reserved_micro_usd)).toBe(1000);
      expect(ns.unknown_exposure_fence).toBe(true);
      expect(ns.active_attempt_id).toBe(admitted.attemptId);
      expect(ns.attempted_calls).toBe(1);
      expect(modelCalls).toBe(0);
      expect(sourceCalls).toBe(0);
      expect(await f.pg`select id from pulse_proposals`).toHaveLength(0);
    }
  });
  it('performs no retained maintenance for absent malformed or mismatching scope', async () => {
    const { queued } = await expiredRun();
    for (const mode of ['absent', 'malformed', 'mismatched']) {
      if (mode === 'absent') delete process.env.MINION_PULSE_DIGEST_SCOPE;
      else
        process.env.MINION_PULSE_DIGEST_SCOPE =
          mode === 'malformed'
            ? '{'
            : JSON.stringify({ tenantId: org, ownerProfileId: randomUUID() });
      boundary.pool.mockClear();
      await GET(event());
      expect(boundary.pool).not.toHaveBeenCalled();
      const [row] =
        await f.pg`select evidence,snapshot,redacted_at,state from pulse_digest_runs where id=${queued.runId}`;
      expect(row.evidence).not.toBeNull();
      expect(row.snapshot).not.toBeNull();
      expect(row.redacted_at).toBeNull();
      expect(row.state).toBe('queued');
      expect(modelCalls).toBe(0);
      expect(sourceCalls).toBe(0);
    }
  });
  it('caps combined dispatch run source and feedback housekeeping at one hundred raw records per tick', async () => {
    const snapshot = await digestFixtureSnapshot(policy, 'retention-published');
    const queued = (await f.db.transaction((tx) => queueDigestSnapshotTx(tx, policy, snapshot)))!;
    await f.pg`update bg_jobs set status='running',lease_generation=1,lease_until=${Date.now() + 60000} where id=${queued.jobId}`;
    const [run] = await f.db
      .select()
      .from(pulseDigestRuns)
      .where(eq(pulseDigestRuns.id, queued.runId));
    const admitted = (await f.db.transaction((tx) => admitDigestAttemptTx(tx, policy, run, 1)))!;
    const receipt = parseDigestReceipt(JSON.stringify(digestFixtureResponse(snapshot)), 200);
    await retainDigestReceipt(f.db, admitted, receipt);
    const [received] = await f.db
      .select()
      .from(pulseDigestRuns)
      .where(eq(pulseDigestRuns.id, run.id));
    const [job] = await f.db.select().from(bgJobs).where(eq(bgJobs.id, queued.jobId));
    const card = (await f.db.transaction((tx) =>
      publishDigestTx(tx, policy, job, received, validateDigestResult(receipt, policy, snapshot)),
    ))!;
    for (let i = 0; i < 25; i++) {
      await savePulseFeedback({ db: f.db, tenantId: org, profileId: profile }, card, {
        clientActionId: randomUUID(),
        expectedContentRevision: 1,
        reason: 'useful',
        comment: 'Expired fixture comment',
      });
      const proposal = randomUUID(),
        dispatch = randomUUID(),
        dispatchJob = randomUUID();
      await f.pg`insert into pulse_proposals(id,org_id,owner_profile_id,source,kind,title,dedup_key,status)values(${proposal},${org},${profile},'fixture','reminder','Archived reminder',${proposal},'approved')`;
      await f.pg`insert into bg_jobs(id,tenant_id,user_id,type,ref_id,status,created_at,updated_at)values(${dispatchJob},${org},${profile},'pulse_dispatch',${dispatch},'done',1,1)`;
      await f.pg`insert into pulse_dispatches(id,org_id,proposal_id,proposal_revision,actor_profile_id,gateway_id,channel,agent_id,origin_session_key,action_kind,payload,payload_hash,tool_schema_revision,authority_snapshot_hash,gateway_qualification_revision,bg_job_id,state,admitted_at,admitted_generation,safe_reason,created_at)values(${dispatch},${org},${proposal},1,${profile},${randomUUID()},'prd','fixture-agent','agent:fixture-agent:main','reminder','{}','fixture','fixture','fixture','fixture',${dispatchJob},'indeterminate',now()-interval '31 days',1,'fixture_unknown',now()-interval '31 days')`;
    }
    for (let i = 0; i < 65; i++) {
      const id = randomUUID(),
        jobId = randomUUID(),
        old = await digestFixtureSnapshot(policy, `archived-${i}`);
      await f.pg`insert into bg_jobs(id,tenant_id,user_id,type,ref_id,status,created_at,updated_at)values(${jobId},${org},${profile},'pulse_digest',${id},'done',1,1)`;
      await f.pg`insert into pulse_digest_runs(id,org_id,owner_profile_id,budget_namespace,policy_revision,policy_hash,source_snapshot_hash,request_hash,snapshot,evidence,requested_model,bg_job_id,state,created_at)values(${id},${org},${profile},${policy.budgetNamespace},${policy.revision},${pulseHash(policy)},${old.hash},${pulseHash(['fixture-request', i])},${JSON.stringify(old)}::jsonb,${JSON.stringify(old.evidence)},${policy.model},${jobId},'canceled',now()-interval '31 days')`;
    }
    for (let i = 0; i < 15; i++)
      await f.pg`insert into pulse_digest_sources(org_id,owner_profile_id,policy_revision,source_id,revision,content_hash,evidence,updated_at)values(${org},${profile},${`archived-policy-${i}`},'ai',1,${pulseHash(snapshot.evidence)},${JSON.stringify(snapshot.evidence)}::jsonb,now()-interval '31 days')`;
    await f.pg.unsafe(
      'alter table pulse_digest_runs disable trigger pulse_digest_guard;alter table pulse_feedback disable trigger pulse_feedback_guard',
    );
    try {
      await f.pg`update pulse_digest_runs set created_at=now()-interval '31 days'`;
      await f.pg`update pulse_feedback set created_at=now()-interval '31 days'`;
      await f.pg`update pulse_digest_sources set updated_at=now()-interval '31 days'`;
    } finally {
      await f.pg.unsafe(
        'alter table pulse_digest_runs enable trigger pulse_digest_guard;alter table pulse_feedback enable trigger pulse_feedback_guard',
      );
    }
    await f.pg`insert into app_modules(org_id,module_id,enabled)values(${org},'pulse',false)`;
    const counts = async () => {
      const [row] =
        await f.pg`select (select count(*)::int from pulse_dispatches where payload is null) dispatch,(select count(*)::int from pulse_digest_runs where redacted_at is not null) runs,(select count(*)::int from pulse_digest_sources where evidence is null) sources,(select count(*)::int from pulse_feedback where redacted_at is not null) feedback`;
      return Object.values(row).reduce((sum: number, value) => sum + Number(value), 0);
    };
    await GET(event());
    expect(await counts()).toBe(100);
    expect(modelCalls).toBe(0);
    expect(sourceCalls).toBe(0);
    await GET(event());
    expect(await counts()).toBe(132);
    expect(
      (await f.pg`select cost_micro_usd from pulse_digest_runs where id=${run.id}`)[0]
        .cost_micro_usd,
    ).toBe('100');
  }, 30000);
  it('starts with an empty queue and one durable immediate poll under duplicate authenticated ticks', async () => {
    expect(await f.pg`select id from bg_jobs`).toHaveLength(0);
    await Promise.all([GET(event()), GET(event())]);
    expect(sourceCalls).toBe(1);
    expect(modelCalls).toBe(1);
    expect(await f.pg`select id from pulse_proposals`).toHaveLength(1);
    const [ns] =
      await f.pg`select extract(epoch from next_poll_at-clock_timestamp()) as remaining,collection_owner from pulse_digest_admission`;
    expect(Number(ns.remaining)).toBeGreaterThan(890);
    expect(ns.collection_owner).toBeNull();
    await GET(event());
    expect(sourceCalls).toBe(1);
    version = 'v2';
    await f.pg`update pulse_digest_admission set next_poll_at=now()-interval '1 second'`;
    await GET(event());
    expect(sourceCalls).toBe(2);
    expect(modelCalls).toBe(2);
    expect(await f.pg`select id from pulse_proposals`).toHaveLength(2);
  });
  it('leaves more than twenty unrelated older jobs untouched', async () => {
    await f.pg`insert into bg_jobs(id,tenant_id,user_id,type,status,created_at,updated_at) select gen_random_uuid()::text,${org},'other-owner','pulse_digest','queued',1,1 from generate_series(1,25)`;
    await GET(event());
    const [count] =
      await f.pg`select count(*)::int as n from bg_jobs where user_id='other-owner' and status='queued' and attempts=0`;
    expect(count.n).toBe(25);
    expect(modelCalls).toBe(1);
  });
  it('records a failed poll at five minutes without a mixed snapshot queue or cursor advance', async () => {
    boundary.source.mockRejectedValue(new Error('fixture source unavailable'));
    await GET(event());
    expect(await f.pg`select id from pulse_digest_runs`).toHaveLength(0);
    expect(await f.pg`select source_id from pulse_digest_sources`).toHaveLength(0);
    expect(modelCalls).toBe(0);
    const [ns] =
      await f.pg`select last_collection_outcome,extract(epoch from next_poll_at-clock_timestamp()) as remaining from pulse_digest_admission`;
    expect(ns.last_collection_outcome).toBe('failed');
    expect(Number(ns.remaining)).toBeGreaterThan(290);
    expect(Number(ns.remaining)).toBeLessThanOrEqual(300);
  });
  it('reclaims an expired generation lease and denies a stale collectors successor cadence write', async () => {
    await collectDueDigest(policy, performance.now() + 15000);
    await f.pg`update pulse_digest_admission set collection_owner=gen_random_uuid(),collection_lease_until=now()-interval '1 second',next_poll_at=now()-interval '1 second'`;
    expect((await collectDueDigest(policy, performance.now() + 15000)).outcome).toBe('duplicate');
    await f.pg`update pulse_digest_admission set next_poll_at=now()-interval '1 second'`;
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((r) => {
      entered = r;
    });
    const original = boundary.source.getMockImplementation()!;
    boundary.source.mockImplementation(async (...args: unknown[]) => {
      entered();
      await new Promise<void>((r) => {
        release = r;
      });
      return original(...args);
    });
    const pending = collectDueDigest(policy, performance.now() + 15000);
    await ready;
    await f.peer`update pulse_digest_admission set collection_generation=collection_generation+1,collection_owner=gen_random_uuid(),collection_lease_until=now()+interval '30 seconds',next_poll_at=now()+interval '1 hour'`;
    release();
    expect((await pending).outcome).toBe('failed');
    const [ns] =
      await f.pg`select extract(epoch from next_poll_at-clock_timestamp()) as remaining from pulse_digest_admission`;
    expect(Number(ns.remaining)).toBeGreaterThan(3500);
  });
  it('fences actual membership deletion during collection and cancels queued digest via the shared caller', async () => {
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((r) => {
      entered = r;
    });
    const original = boundary.source.getMockImplementation()!;
    boundary.source.mockImplementation(async (...args: unknown[]) => {
      entered();
      await new Promise<void>((r) => {
        release = r;
      });
      return original(...args);
    });
    const pending = collectDueDigest(policy, performance.now() + 15000);
    await ready;
    await updateUserOrganizations({ db: {} as never, tenantId: org }, profile, []);
    release();
    await pending;
    expect(await f.pg`select id from pulse_digest_runs`).toHaveLength(0);
    const [ns] = await f.pg`select enabled,collection_owner from pulse_digest_admission`;
    expect(ns.enabled).toBe(false);
    expect(ns.collection_owner).toBeNull();
    expect(modelCalls).toBe(0);
  });
  it('defers inference without admission when collection leaves fewer than thirty two seconds', async () => {
    const nativeNow = performance.now.bind(performance);
    let offset = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => nativeNow() + offset);
    const original = boundary.source.getMockImplementation()!;
    boundary.source.mockImplementation(async (...args: unknown[]) => {
      const response = await original(...args);
      offset = 19000;
      return response;
    });
    await GET(event());
    expect(modelCalls).toBe(0);
    const [run] = await f.pg`select state,attempt_id from pulse_digest_runs`;
    expect(run).toEqual({ state: 'queued', attempt_id: null });
    const [job] = await f.pg`select status,next_attempt_at from bg_jobs`;
    expect(job.status).toBe('queued');
    expect(job.next_attempt_at).toBeTruthy();
    const [ns] = await f.pg`select attempted_calls from pulse_digest_admission`;
    expect(ns.attempted_calls).toBe(0);
  });
});
