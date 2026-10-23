import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { openPulsePostgres } from '../test-utils/pulse-postgres';
import {
  seedPulseAuthority,
  PULSE_FIXTURE_ORG as org,
  PULSE_FIXTURE_PROFILE as profile,
} from '../test-utils/pulse-fixtures';
import { digestFixturePolicy, digestFixtureSnapshot } from '../test-utils/pulse-digest-fixtures';
import {
  queueDigestSnapshotTx,
  admitDigestAttemptTx,
  retainDigestReceipt,
  cancelDigestForOwnerTx,
  retireDigestNamespaceTx,
  finishDigestTx,
} from './pulse-digest.store';
import { pulseDigestRuns } from '../db/pg-schema/pulse-digest';
import { seed as seedPulse } from '../../../scripts/qa/seed/pulse';
let f: Awaited<ReturnType<typeof openPulsePostgres>>;
let policy: ReturnType<typeof digestFixturePolicy>;
beforeEach(async () => {
  f = await openPulsePostgres();
  await seedPulseAuthority(f, 'wss://gateway.example.invalid');
  delete process.env.MINION_PULSE_WORKER_CONFIG;
  policy = digestFixturePolicy();
  process.env.MINION_PULSE_DIGEST_POLICY = JSON.stringify(policy);
  process.env.MINION_PULSE_DIGEST_SCOPE = JSON.stringify({
    tenantId: policy.tenantId,
    ownerProfileId: policy.ownerProfileId,
  });
});
afterEach(async () => {
  delete process.env.MINION_PULSE_DIGEST_POLICY;
  delete process.env.MINION_PULSE_DIGEST_SCOPE;
  await f?.close();
});
async function queued() {
  const snapshot = await digestFixtureSnapshot(policy);
  const q = await f.db.transaction((tx) => queueDigestSnapshotTx(tx, policy, snapshot));
  if (!q) throw new Error('fixture queue');
  return {
    ...q,
    snapshot,
    row: (await f.db.select().from(pulseDigestRuns).where(eq(pulseDigestRuns.id, q.runId)))[0],
  };
}
describe('native digest accounting and schema', () => {
  it('requires a stored bounded raw response and usage envelope before received state', async () => {
    const q = await queued();
    await f.db.transaction((tx) => admitDigestAttemptTx(tx, policy, q.row, 1));
    let accepted = false;
    try {
      await f.pg`update pulse_digest_runs set state='reasoning_received',receipt_hash='empty' where id=${q.runId}`;
      accepted = true;
    } catch {}
    console.info(
      'received-envelope-constraint-probe',
      JSON.stringify({
        accepted,
        ...(
          await f.pg`select state,raw_response,usage_status,receipt_hash from pulse_digest_runs where id=${q.runId}`
        )[0],
      }),
    );
    expect(accepted).toBe(false);
    await expect(
      f.pg`update pulse_digest_runs set state='indeterminate',safe_reason=null where id=${q.runId}`,
    ).rejects.toThrow();
    const [row] = await f.pg`select state,receipt_hash from pulse_digest_runs where id=${q.runId}`;
    expect(row).toEqual({ state: 'reasoning_admitted', receipt_hash: null });
  });

  it('retains replay hashes and bills while bounded cleanup cancels and redacts expired raw evidence', async () => {
    const q = await queued();
    await f.pg.unsafe('alter table pulse_digest_runs disable trigger pulse_digest_guard');
    await f.pg`update pulse_digest_runs set created_at=now()-interval '31 days' where id=${q.runId}`;
    await f.pg.unsafe('alter table pulse_digest_runs enable trigger pulse_digest_guard');
    const { redactDigestTx } = await import('./pulse-digest.store');
    expect(
      await f.db.transaction((tx) => redactDigestTx(tx, { tenantId: org, profileId: profile })),
    ).toBe(1);
    const [run] =
      await f.pg`select state,evidence,snapshot,redacted_at,source_snapshot_hash from pulse_digest_runs where id=${q.runId}`;
    expect(run.state).toBe('canceled');
    expect(run.evidence).toBeNull();
    expect(run.snapshot).toBeNull();
    expect(run.redacted_at).toBeTruthy();
    expect(run.source_snapshot_hash).toBe(q.snapshot.hash);
    const duplicate = await f.db.transaction((tx) => queueDigestSnapshotTx(tx, policy, q.snapshot));
    expect(duplicate?.runId).toBe(q.runId);
    expect((await f.pg`select status from bg_jobs where id=${q.jobId}`)[0].status).toBe(
      'cancelled',
    );
  });

  it('applies real D and E migration runners twice and paired seed twice', async () => {
    expect(await f.migrate()).toBe(false);
    expect(await f.migrateDigest()).toBe(false);
    await f.rerunDigestSql();
    await f.rerunDigestSql();
    const registered: string[] = [];
    const ctx = {
      sql: f.pg,
      register: (id: string) => {
        registered.push(id);
      },
    };
    await seedPulse(ctx);
    await seedPulse(ctx);
    expect(registered).toHaveLength(20);
    const [counts] = await f.pg`select count(*)::int as n from pulse_digest_runs`;
    expect(counts.n).toBe(5);
  });
  it('deduplicates on independent connections before enqueue and permits only one competing snapshot', async () => {
    const snapshot = await digestFixtureSnapshot(policy);
    const [a, b] = await Promise.all([
      f.db.transaction((tx) => queueDigestSnapshotTx(tx, policy, snapshot)),
      f.peerDb.transaction((tx) => queueDigestSnapshotTx(tx, policy, snapshot)),
    ]);
    expect(a?.runId).toBe(b?.runId);
    expect([a?.existing, b?.existing].sort()).toEqual([false, true]);
    const newer = await digestFixtureSnapshot(policy, 'v2');
    expect(await f.peerDb.transaction((tx) => queueDigestSnapshotTx(tx, policy, newer))).toBeNull();
    const [counts] =
      await f.pg`select (select count(*)::int from pulse_digest_runs) runs,(select count(*)::int from bg_jobs) jobs`;
    expect(counts).toEqual({ runs: 1, jobs: 1 });
  });
  it('locks the last daily allowance and admits one immutable attempt', async () => {
    const q = await queued();
    await f.pg`update pulse_digest_admission set attempted_calls=4`;
    const results = await Promise.all([
      f.db.transaction((tx) => admitDigestAttemptTx(tx, policy, q.row, 1)),
      f.peerDb.transaction((tx) => admitDigestAttemptTx(tx, policy, q.row, 2)),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const [ns] = await f.pg`select attempted_calls,reserved_micro_usd from pulse_digest_admission`;
    expect(ns.attempted_calls).toBe(5);
    expect(Number(ns.reserved_micro_usd)).toBe(1000);
  });
  it('denies zero spend unsupported policy amounts and current business or revoked owner', async () => {
    policy = { ...policy, approval: { ...policy.approval, upperMicroUsd: 0, dailyMicroUsd: 0 } };
    process.env.MINION_PULSE_DIGEST_POLICY = JSON.stringify(policy);
    process.env.MINION_PULSE_DIGEST_SCOPE = JSON.stringify({
      tenantId: policy.tenantId,
      ownerProfileId: policy.ownerProfileId,
    });
    const q = await queued();
    expect(await f.db.transaction((tx) => admitDigestAttemptTx(tx, policy, q.row, 1))).toBeNull();
    await f.pg`update organizations set kind='business' where id=${org}`;
    await expect(
      f.db.transaction((tx) => queueDigestSnapshotTx(tx, policy, q.snapshot)),
    ).rejects.toThrow('digest_owner_unavailable');
    await f.pg`update organizations set kind='personal' where id=${org}`;
    await f.pg`delete from organization_members where profile_id=${profile}`;
    await expect(
      f.db.transaction((tx) => admitDigestAttemptTx(tx, policy, q.row, 1)),
    ).rejects.toThrow('digest_owner_unavailable');
  });
  it('preserves admitted exposure across policy and day changes and stale late receipt', async () => {
    const q = await queued();
    const admitted = (await f.db.transaction((tx) => admitDigestAttemptTx(tx, policy, q.row, 1)))!;
    await f.db.transaction((tx) =>
      cancelDigestForOwnerTx(tx, { tenantId: org, profileId: profile }),
    );
    await f.pg`update pulse_digest_admission set budget_day='2000-01-01',policy_revision='changed',enabled=true`;
    await retainDigestReceipt(f.db, admitted, {
      rawResponse: '{}',
      receiptHash: 'r',
      usageStatus: 'known',
      costMicroUsd: 100,
      resolvedModel: policy.model,
      metadata: { status: 200 },
    });
    const [run] = await f.pg`select state,cost_micro_usd,receipt_hash from pulse_digest_runs`;
    expect(run.state).toBe('indeterminate');
    expect(Number(run.cost_micro_usd)).toBe(100);
    expect(run.receipt_hash).toBe('r');
    const [ns] =
      await f.pg`select unknown_exposure_fence,reserved_micro_usd,active_attempt_id from pulse_digest_admission`;
    expect(ns.unknown_exposure_fence).toBe(true);
    expect(Number(ns.reserved_micro_usd)).toBe(1000);
    expect(ns.active_attempt_id).toBe(admitted.attemptId);
    await expect(
      f.pg`update pulse_digest_admission set unknown_exposure_fence=false`,
    ).rejects.toThrow();
  });
  it('enforces effective nonbypass org plus owner RLS and restricts deletion', async () => {
    const q = await queued();
    await f.pg.begin(async (tx) => {
      await tx`select set_config('role','app_ledger',true),set_config('app.current_org_id',${org},true),set_config('app.current_profile_id',${profile},true)`;
      const [role] =
        await tx`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`;
      expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
      expect(await tx`select id from pulse_digest_runs`).toHaveLength(1);
      await tx`select set_config('app.current_profile_id','other-owner',true)`;
      expect(await tx`select id from pulse_digest_runs`).toHaveLength(0);
    });
    await expect(f.pg`delete from pulse_digest_runs where id=${q.runId}`).rejects.toThrow('Retire');
    await expect(
      f.pg`update pulse_digest_runs set request_hash='changed' where id=${q.runId}`,
    ).rejects.toThrow('immutable');
    await f.db.transaction((tx) => retireDigestNamespaceTx(tx, policy));
    await expect(
      f.db.transaction((tx) => queueDigestSnapshotTx(tx, policy, q.snapshot)),
    ).rejects.toThrow('retired');
  });
  it('rejects mismatched foreign job owner and namespace changes instead of resetting accounting', async () => {
    await queued();
    const second = { ...policy, budgetNamespace: 'other-namespace', revision: 'new' };
    process.env.MINION_PULSE_DIGEST_POLICY = JSON.stringify(second);
    const snapshot = await digestFixtureSnapshot(second);
    await expect(
      f.db.transaction((tx) => queueDigestSnapshotTx(tx, second, snapshot)),
    ).rejects.toThrow();
    await expect(f.pg`update pulse_digest_admission set budget_namespace='new'`).rejects.toThrow(
      'cannot be reset',
    );
    await expect(f.pg`update pulse_digest_runs set state='reasoning_admitted'`).rejects.toThrow();
  });
});
