import { randomUUID } from 'node:crypto';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { withOrgCore, withOrgCoreTransaction, type CoreTx } from '$server/db/with-org-core';
import { getCoreDb, getOrgTransactionDb } from '$server/db/pg-client';
import {
  pulseDigestAdmission as admission,
  pulseDigestRuns as runs,
  pulseDigestSources as sources,
  type DigestRun,
} from '$server/db/pg-schema/pulse-digest';
import { bgJobs } from '$server/db/pg-schema/bg-jobs';
import { enqueueJobInTransaction, type BgJob, type JobExecution } from './bg-runtime';
import { assertDigestAuthorityTx } from './pulse-digest.authority';
import { assertDigestPolicyCurrent, type DigestPolicy } from './pulse-digest.policy';
import { boundDigestEvidence, type DigestSnapshot } from './pulse-digest.sources';
import {
  digestPrompt,
  type DigestTerminalReceipt,
  type DigestResult,
} from './pulse-digest.reasoning';
import { pulseHash } from './pulse-action-contract';
import { insertInternalPulseProposalTx, digestCardPayload } from './pulse-publication';

export const digestScope = (p: DigestPolicy) => ({
  tenantId: p.tenantId,
  profileId: p.ownerProfileId,
});
const namespaceWhere = (p: DigestPolicy) =>
  and(
    eq(admission.orgId, p.tenantId),
    eq(admission.ownerProfileId, p.ownerProfileId),
    eq(admission.budgetNamespace, p.budgetNamespace),
  );
export async function ensureDigestNamespaceTx(tx: CoreTx, policy: DigestPolicy) {
  await assertDigestAuthorityTx(tx, policy);
  return withOrgCoreTransaction(digestScope(policy), tx, async (domain) => {
    const values = {
      orgId: policy.tenantId,
      ownerProfileId: policy.ownerProfileId,
      budgetNamespace: policy.budgetNamespace,
      policyRevision: policy.revision,
      policyHash: pulseHash(policy),
      enabled: policy.enabled,
      approvalRevision: policy.approval.revision,
      approvalExpiresAt: new Date(policy.approval.expiresAt),
      maxCalls: policy.maxCallsPerDay,
      upperMicroUsd: policy.approval.upperMicroUsd,
      dailyMicroUsd: policy.approval.dailyMicroUsd,
      budgetDay: sql`(clock_timestamp() at time zone 'UTC')::date`,
    };
    await domain.insert(admission).values(values).onConflictDoNothing();
    const [current] = await domain
      .select()
      .from(admission)
      .where(namespaceWhere(policy))
      .for('update');
    if (!current || current.retiredAt) throw new Error('digest_namespace_retired');
    if (current.policyHash !== pulseHash(policy)) {
      if (current.activeRunId) throw new Error('digest_policy_reconciliation_required');
      const [updated] = await domain
        .update(admission)
        .set({
          ...values,
          budgetDay: current.budgetDay,
          nextPollAt: new Date(),
          collectionOwner: null,
          collectionLeaseUntil: null,
          collectionGeneration: sql`${admission.collectionGeneration}+1`,
          updatedAt: new Date(),
        })
        .where(namespaceWhere(policy))
        .returning();
      return updated;
    }
    if (!current.enabled || current.approvalExpiresAt.getTime() <= Date.now())
      throw new Error('digest_namespace_disabled');
    return current;
  });
}
/** Domain uniqueness is consulted before enqueue. The caller's transaction owns both facts. */
export async function queueDigestSnapshotTx(
  tx: CoreTx,
  policy: DigestPolicy,
  snapshot: DigestSnapshot,
): Promise<{ runId: string; jobId: string; existing: boolean } | null> {
  await assertDigestAuthorityTx(tx, policy);
  const namespace = await ensureDigestNamespaceTx(tx, policy);
  const scope = digestScope(policy);
  const prior = await withOrgCoreTransaction(
    scope,
    tx,
    async (domain) =>
      (
        await domain
          .select()
          .from(runs)
          .where(
            and(
              eq(runs.orgId, policy.tenantId),
              eq(runs.ownerProfileId, policy.ownerProfileId),
              eq(runs.policyRevision, policy.revision),
              eq(runs.sourceSnapshotHash, snapshot.hash),
            ),
          )
          .limit(1)
      )[0],
  );
  if (prior) return { runId: prior.id, jobId: prior.bgJobId, existing: true };
  if (namespace.activeRunId || namespace.unknownExposureFence) return null;
  const evidence = boundDigestEvidence(snapshot.evidence);
  const requestHash = pulseHash(digestPrompt(policy, snapshot));
  const id = randomUUID();
  const jobId = await enqueueJobInTransaction(tx, {
    tenantId: policy.tenantId,
    userId: policy.ownerProfileId,
    type: 'pulse_digest',
    refId: id,
  });
  await withOrgCoreTransaction(scope, tx, async (domain) => {
    for (const source of snapshot.sources)
      await domain
        .insert(sources)
        .values({
          orgId: policy.tenantId,
          ownerProfileId: policy.ownerProfileId,
          policyRevision: policy.revision,
          sourceId: source.sourceId,
        })
        .onConflictDoNothing();
    await domain.insert(runs).values({
      id,
      orgId: policy.tenantId,
      ownerProfileId: policy.ownerProfileId,
      budgetNamespace: policy.budgetNamespace,
      policyRevision: policy.revision,
      policyHash: pulseHash(policy),
      sourceSnapshotHash: snapshot.hash,
      sourceRevisions: snapshot.sources.map((s) => ({
        sourceId: s.sourceId,
        revision: s.revision,
        contentHash: s.contentHash,
      })),
      requestHash,
      snapshot,
      evidence,
      requestedModel: policy.model,
      bgJobId: jobId,
    });
    await domain
      .update(admission)
      .set({ activeRunId: id, activeAttemptId: null, updatedAt: new Date() })
      .where(namespaceWhere(policy));
  });
  return { runId: id, jobId, existing: false };
}
export async function loadDigestRunTx(tx: CoreTx, job: BgJob): Promise<DigestRun | undefined> {
  if (!job.userId || !job.refId) return;
  return withOrgCoreTransaction(
    { tenantId: job.tenantId, profileId: job.userId },
    tx,
    async (domain) =>
      (
        await domain
          .select()
          .from(runs)
          .where(
            and(
              eq(runs.id, job.refId!),
              eq(runs.orgId, job.tenantId),
              eq(runs.ownerProfileId, job.userId!),
              eq(runs.bgJobId, job.id),
            ),
          )
          .for('update')
      )[0],
  );
}
export async function digestCheckpointsCurrentTx(tx: CoreTx, row: DigestRun): Promise<boolean> {
  if (!row.snapshot || row.redactedAt) return false;
  return withOrgCoreTransaction(
    { tenantId: row.orgId, profileId: row.ownerProfileId },
    tx,
    async (domain) => {
      const checkpoints = await domain
        .select()
        .from(sources)
        .where(
          and(
            eq(sources.orgId, row.orgId),
            eq(sources.ownerProfileId, row.ownerProfileId),
            eq(sources.policyRevision, row.policyRevision),
          ),
        )
        .orderBy(sources.sourceId)
        .for('update');
      return row.snapshot!.sources.every(
        (s) => checkpoints.find((c) => c.sourceId === s.sourceId)?.revision === s.revision,
      );
    },
  );
}
export async function admitDigestAttemptTx(
  tx: CoreTx,
  policy: DigestPolicy,
  row: DigestRun,
  generation: number,
): Promise<DigestRun | null> {
  await assertDigestAuthorityTx(tx, policy);
  return withOrgCoreTransaction(digestScope(policy), tx, async (domain) => {
    const [ns] = await domain.select().from(admission).where(namespaceWhere(policy)).for('update');
    const [current] = await domain.select().from(runs).where(eq(runs.id, row.id)).for('update');
    const [clock] = await domain.execute<{ day: string }>(
      sql`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD') as day`,
    );
    const day = clock.day;
    if (
      !ns ||
      !current ||
      current.state !== 'queued' ||
      current.policyHash !== pulseHash(policy) ||
      ns.policyHash !== current.policyHash ||
      ns.upperMicroUsd !== policy.approval.upperMicroUsd ||
      ns.dailyMicroUsd !== policy.approval.dailyMicroUsd ||
      ns.maxCalls !== policy.maxCallsPerDay ||
      ns.approvalRevision !== policy.approval.revision ||
      !ns.enabled ||
      ns.retiredAt ||
      ns.unknownExposureFence ||
      ns.activeRunId !== row.id ||
      ns.activeAttemptId ||
      ns.approvalExpiresAt.getTime() <= Date.now()
    )
      return null;
    if (!(await digestCheckpointsCurrentTx(domain, current))) return null;
    const calls = ns.budgetDay === day ? ns.attemptedCalls : 0;
    const settled = ns.budgetDay === day ? ns.settledMicroUsd : 0;
    const exposure = BigInt(ns.reservedMicroUsd) + BigInt(settled) + BigInt(ns.upperMicroUsd);
    if (
      ns.upperMicroUsd <= 0 ||
      ns.dailyMicroUsd <= 0 ||
      calls >= ns.maxCalls ||
      calls >= 5 ||
      exposure > BigInt(ns.dailyMicroUsd) ||
      exposure > BigInt(Number.MAX_SAFE_INTEGER)
    )
      return null;
    assertDigestPolicyCurrent(policy);
    const attemptId = randomUUID();
    const admissionGeneration = ns.admissionGeneration + 1;
    if (!Number.isSafeInteger(admissionGeneration)) throw new Error('digest_generation_overflow');
    await domain
      .update(admission)
      .set({
        budgetDay: day,
        attemptedCalls: calls + 1,
        settledMicroUsd: settled,
        reservedMicroUsd: ns.reservedMicroUsd + ns.upperMicroUsd,
        activeAttemptId: attemptId,
        admissionGeneration,
        updatedAt: new Date(),
      })
      .where(namespaceWhere(policy));
    const [updated] = await domain
      .update(runs)
      .set({
        state: 'reasoning_admitted',
        attemptId,
        admittedGeneration: generation,
        admittedDay: day,
        admittedAt: new Date(),
        upperMicroUsd: ns.upperMicroUsd,
        nextAttemptAt: null,
        receiptMetadata: { admissionGeneration },
        updatedAt: new Date(),
      })
      .where(and(eq(runs.id, row.id), eq(runs.state, 'queued')))
      .returning();
    assertDigestPolicyCurrent(policy);
    return updated;
  });
}
/** Positive terminal evidence is admission-bound, independent of stale job/authority. No publication. */
export async function retainDigestReceipt(
  db: ReturnType<typeof getCoreDb>,
  admitted: DigestRun,
  receipt: DigestTerminalReceipt,
): Promise<void> {
  if (!admitted.attemptId || !admitted.admittedGeneration || !admitted.admittedDay)
    throw new Error('digest_missing_admission');
  await withOrgCore(
    { db, tenantId: admitted.orgId, profileId: admitted.ownerProfileId },
    async (domain) => {
      const [row] = await domain.select().from(runs).where(eq(runs.id, admitted.id)).for('update');
      if (
        !row ||
        row.attemptId !== admitted.attemptId ||
        row.admittedGeneration !== admitted.admittedGeneration ||
        row.admittedDay !== admitted.admittedDay ||
        row.requestHash !== admitted.requestHash ||
        row.bgJobId !== admitted.bgJobId
      )
        throw new Error('digest_receipt_binding');
      if (row.receiptHash) {
        if (row.receiptHash !== receipt.receiptHash) throw new Error('digest_receipt_conflict');
        return;
      }
      if (!['reasoning_admitted', 'indeterminate'].includes(row.state))
        throw new Error('digest_receipt_state');
      const expired =
        row.redactedAt !== null || row.createdAt.getTime() < Date.now() - 30 * 86400000;
      await domain
        .update(runs)
        .set({
          state:
            row.state === 'indeterminate' || expired
              ? 'indeterminate'
              : receipt.rawResponse === null
                ? 'reasoning_admitted'
                : 'reasoning_received',
          rawResponse: expired ? null : receipt.rawResponse,
          ...(expired ? { safeReason: row.safeReason ?? 'payload_expired' } : {}),
          receiptHash: receipt.receiptHash,
          usageStatus: receipt.usageStatus,
          costMicroUsd: receipt.costMicroUsd,
          resolvedModel: receipt.resolvedModel,
          receiptMetadata: { ...row.receiptMetadata, ...receipt.metadata },
          updatedAt: new Date(),
        })
        .where(eq(runs.id, row.id));
      if (
        expired ||
        receipt.usageStatus === 'unknown' ||
        (receipt.costMicroUsd ?? 0) > (row.upperMicroUsd ?? 0)
      )
        await domain
          .update(admission)
          .set({ unknownExposureFence: true, updatedAt: new Date() })
          .where(
            and(
              eq(admission.orgId, row.orgId),
              eq(admission.ownerProfileId, row.ownerProfileId),
              eq(admission.budgetNamespace, row.budgetNamespace),
              eq(admission.activeRunId, row.id),
              eq(admission.activeAttemptId, row.attemptId!),
              eq(admission.admissionGeneration, Number(row.receiptMetadata?.admissionGeneration)),
            ),
          );
    },
  );
}
async function settleAccountingTx(domain: CoreTx, row: DigestRun, terminal: string): Promise<void> {
  const [ns] = await domain
    .select()
    .from(admission)
    .where(
      and(
        eq(admission.orgId, row.orgId),
        eq(admission.ownerProfileId, row.ownerProfileId),
        eq(admission.budgetNamespace, row.budgetNamespace),
      ),
    )
    .for('update');
  if (!ns || ns.activeRunId !== row.id) return;
  if (
    row.attemptId &&
    (ns.activeAttemptId !== row.attemptId ||
      row.receiptMetadata?.admissionGeneration !== ns.admissionGeneration)
  )
    return;
  const known = row.attemptId === null || row.usageStatus === 'known';
  const reserved = row.attemptId
    ? ns.reservedMicroUsd - (row.upperMicroUsd ?? 0)
    : ns.reservedMicroUsd;
  const cost = row.costMicroUsd ?? 0;
  const settled =
    BigInt(ns.settledMicroUsd) + (row.admittedDay === ns.budgetDay ? BigInt(cost) : 0n);
  const bounded =
    known &&
    reserved >= 0 &&
    settled <= BigInt(Number.MAX_SAFE_INTEGER) &&
    cost <= (row.upperMicroUsd ?? 0);
  const indeterminate = terminal === 'indeterminate' || !bounded;
  await domain
    .update(admission)
    .set({
      unknownExposureFence: ns.unknownExposureFence || indeterminate,
      ...(bounded ? { reservedMicroUsd: reserved, settledMicroUsd: Number(settled) } : {}),
      ...(!indeterminate ? { activeRunId: null, activeAttemptId: null } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(admission.orgId, row.orgId),
        eq(admission.ownerProfileId, row.ownerProfileId),
        eq(admission.budgetNamespace, row.budgetNamespace),
      ),
    );
}
export async function finishDigestTx(
  tx: CoreTx,
  job: BgJob,
  row: DigestRun,
  state: string,
  reason: string | null,
): Promise<void> {
  await withOrgCoreTransaction(
    { tenantId: row.orgId, profileId: row.ownerProfileId },
    tx,
    async (domain) => {
      await domain
        .update(runs)
        .set({ state, safeReason: reason, nextAttemptAt: null, updatedAt: new Date() })
        .where(eq(runs.id, row.id));
      await settleAccountingTx(domain, row, state);
    },
  );
  const written = await tx
    .update(bgJobs)
    .set({
      status: state === 'failed' ? 'failed' : 'done',
      error: reason,
      cursor: JSON.stringify({ digestRunId: row.id, state }),
      leaseUntil: null,
      finishedAt: Date.now(),
      updatedAt: Date.now(),
    })
    .where(
      and(
        eq(bgJobs.id, job.id),
        eq(bgJobs.status, 'running'),
        eq(bgJobs.leaseGeneration, job.leaseGeneration),
      ),
    )
    .returning({ id: bgJobs.id });
  if (written.length !== 1) throw new Error('digest_job_settlement_conflict');
}
export async function publishDigestTx(
  tx: CoreTx,
  policy: DigestPolicy,
  job: BgJob,
  row: DigestRun,
  result: DigestResult | null,
): Promise<string | null> {
  await assertDigestAuthorityTx(tx, policy);
  if (row.policyHash !== pulseHash(policy) || !row.snapshot || row.redactedAt)
    throw new Error('digest_publication_policy');
  let cardId: string | null = null;
  const state = await withOrgCoreTransaction(digestScope(policy), tx, async (domain) => {
    const checkpoints = await domain
      .select()
      .from(sources)
      .where(
        and(
          eq(sources.orgId, row.orgId),
          eq(sources.ownerProfileId, row.ownerProfileId),
          eq(sources.policyRevision, row.policyRevision),
        ),
      )
      .orderBy(sources.sourceId)
      .for('update');
    if (
      row.snapshot!.sources.some(
        (s) => checkpoints.find((c) => c.sourceId === s.sourceId)?.revision !== s.revision,
      )
    )
      return 'superseded';
    if (result?.disposition === 'actionable') {
      assertDigestPolicyCurrent(policy);
      const resultHash = pulseHash(result);
      const card = await insertInternalPulseProposalTx(domain, digestScope(policy), {
        runId: row.id,
        policyRevision: row.policyRevision,
        inputHash: row.sourceSnapshotHash,
        resultHash,
        title: result.title,
        summary: result.summary,
        payload: digestCardPayload(result, row.snapshot!),
      });
      cardId = card.cardId;
    }
    for (const source of row.snapshot!.sources) {
      assertDigestPolicyCurrent(policy);
      const updated = await domain
        .update(sources)
        .set({
          revision: source.revision + 1,
          contentHash: source.contentHash,
          etag: source.etag,
          lastModified: source.lastModified,
          evidence: source.evidence,
          lastRunId: row.id,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(sources.orgId, row.orgId),
            eq(sources.ownerProfileId, row.ownerProfileId),
            eq(sources.policyRevision, row.policyRevision),
            eq(sources.sourceId, source.sourceId),
            eq(sources.revision, source.revision),
          ),
        )
        .returning({ id: sources.sourceId });
      if (updated.length !== 1) throw new Error('digest_cursor_conflict');
    }
    assertDigestPolicyCurrent(policy);
    if (result)
      await domain
        .update(runs)
        .set({ result, resultHash: pulseHash(result), cardId, updatedAt: new Date() })
        .where(eq(runs.id, row.id));
    return cardId ? 'published' : 'no_signal';
  });
  await finishDigestTx(
    tx,
    job,
    row,
    state,
    state === 'superseded'
      ? 'cursor_superseded'
      : state === 'no_signal'
        ? 'no_supported_change'
        : null,
  );
  assertDigestPolicyCurrent(policy);
  return cardId;
}
/** Job locks first, domain locks second, shared with membership deletion and policy reconciliation. */
export async function cancelDigestForOwnerTx(
  tx: CoreTx,
  scope: { tenantId: string; profileId: string },
  reason = 'authority_revoked',
): Promise<void> {
  const jobs = await tx
    .select()
    .from(bgJobs)
    .where(
      and(
        eq(bgJobs.tenantId, scope.tenantId),
        eq(bgJobs.userId, scope.profileId),
        eq(bgJobs.type, 'pulse_digest'),
        inArray(bgJobs.status, ['queued', 'running']),
      ),
    )
    .orderBy(bgJobs.id)
    .for('update');
  await withOrgCoreTransaction(scope, tx, async (domain) => {
    await domain
      .update(runs)
      .set({ state: 'canceled', safeReason: reason, updatedAt: new Date() })
      .where(
        and(
          eq(runs.orgId, scope.tenantId),
          eq(runs.ownerProfileId, scope.profileId),
          eq(runs.state, 'queued'),
        ),
      );
    await domain
      .update(runs)
      .set({
        state: 'indeterminate',
        safeReason: 'authority_revoked_after_admission',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(runs.orgId, scope.tenantId),
          eq(runs.ownerProfileId, scope.profileId),
          inArray(runs.state, ['reasoning_admitted', 'reasoning_received']),
        ),
      );
    const namespaces = await domain
      .select()
      .from(admission)
      .where(
        and(eq(admission.orgId, scope.tenantId), eq(admission.ownerProfileId, scope.profileId)),
      )
      .for('update');
    for (const ns of namespaces)
      await domain
        .update(admission)
        .set({
          enabled: false,
          collectionOwner: null,
          collectionLeaseUntil: null,
          collectionGeneration: sql`${admission.collectionGeneration}+1`,
          unknownExposureFence: ns.unknownExposureFence || ns.activeAttemptId !== null,
          ...(!ns.activeAttemptId ? { activeRunId: null } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(admission.orgId, scope.tenantId),
            eq(admission.ownerProfileId, scope.profileId),
            eq(admission.budgetNamespace, ns.budgetNamespace),
          ),
        );
  });
  if (jobs.length)
    await tx
      .update(bgJobs)
      .set({
        status: 'cancelled',
        leaseUntil: null,
        leaseGeneration: sql`${bgJobs.leaseGeneration}+1`,
        finishedAt: Date.now(),
        updatedAt: Date.now(),
      })
      .where(
        inArray(
          bgJobs.id,
          jobs.map((j) => j.id),
        ),
      );
}
export async function reconcileDigestPolicyTx(tx: CoreTx, policy: DigestPolicy): Promise<void> {
  const [old] = await tx.select().from(admission).where(namespaceWhere(policy));
  if (old && old.policyRevision === policy.revision && old.policyHash !== pulseHash(policy))
    throw new Error('digest_policy_revision_reused');
  if (old && (old.policyHash !== pulseHash(policy) || !policy.enabled))
    await cancelDigestForOwnerTx(tx, digestScope(policy), 'policy_changed');
  // Never release an admitted attempt/fence. Reapproval changes policy, not accounting identity.
  if (policy.enabled) {
    await assertDigestAuthorityTx(tx, policy);
    if (old && !old.activeAttemptId)
      await withOrgCoreTransaction(digestScope(policy), tx, async (d) => {
        await d
          .update(admission)
          .set({
            policyHash: pulseHash(policy),
            policyRevision: policy.revision,
            enabled: true,
            approvalRevision: policy.approval.revision,
            approvalExpiresAt: new Date(policy.approval.expiresAt),
            maxCalls: policy.maxCallsPerDay,
            upperMicroUsd: policy.approval.upperMicroUsd,
            dailyMicroUsd: policy.approval.dailyMicroUsd,
            nextPollAt: old.policyHash === pulseHash(policy) ? old.nextPollAt : new Date(),
          })
          .where(namespaceWhere(policy));
      });
  }
}
/** At most 60 raw records here plus 20 feedback and 20 shared dispatch records. */
export async function redactDigestTx(
  tx: CoreTx,
  scope: { tenantId: string; profileId: string },
): Promise<number> {
  const expired = await tx
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.orgId, scope.tenantId),
        eq(runs.ownerProfileId, scope.profileId),
        sql`${runs.createdAt}<now()-interval '30 days'`,
        sql`${runs.redactedAt} is null`,
      ),
    )
    .orderBy(runs.bgJobId)
    .limit(50);
  const expiredSources = await tx
    .select()
    .from(sources)
    .where(
      and(
        eq(sources.orgId, scope.tenantId),
        eq(sources.ownerProfileId, scope.profileId),
        sql`${sources.updatedAt}<now()-interval '30 days'`,
        sql`${sources.evidence} is not null`,
      ),
    )
    .orderBy(sources.policyRevision, sources.sourceId)
    .limit(10);
  if (!expired.length && !expiredSources.length) return 0;
  const ids = expired.map((r) => r.id);
  const jobs = expired.map((r) => r.bgJobId);
  if (jobs.length)
    await tx.select().from(bgJobs).where(inArray(bgJobs.id, jobs)).orderBy(bgJobs.id).for('update');
  for (const row of expired)
    if (
      row.state === 'queued' ||
      row.state === 'reasoning_admitted' ||
      row.state === 'reasoning_received'
    ) {
      await tx
        .update(runs)
        .set({
          state: row.state === 'queued' ? 'canceled' : 'indeterminate',
          safeReason: 'payload_expired',
          updatedAt: new Date(),
        })
        .where(eq(runs.id, row.id));
      await settleAccountingTx(tx, row, row.state === 'queued' ? 'canceled' : 'indeterminate');
    }
  if (jobs.length)
    await tx
      .update(bgJobs)
      .set({
        status: 'cancelled',
        leaseUntil: null,
        leaseGeneration: sql`${bgJobs.leaseGeneration}+1`,
        updatedAt: Date.now(),
      })
      .where(and(inArray(bgJobs.id, jobs), inArray(bgJobs.status, ['queued', 'running'])));
  if (ids.length)
    await tx
      .update(runs)
      .set({
        snapshot: null,
        evidence: null,
        rawResponse: null,
        redactedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(inArray(runs.id, ids));
  if (expiredSources.length)
    await tx
      .update(sources)
      .set({ evidence: null })
      .where(
        and(
          eq(sources.orgId, scope.tenantId),
          eq(sources.ownerProfileId, scope.profileId),
          or(
            ...expiredSources.map((s) =>
              and(eq(sources.policyRevision, s.policyRevision), eq(sources.sourceId, s.sourceId)),
            ),
          ),
        ),
      );
  return expired.length + expiredSources.length;
}
export async function retireDigestNamespaceTx(tx: CoreTx, policy: DigestPolicy): Promise<void> {
  await cancelDigestForOwnerTx(tx, digestScope(policy), 'namespace_retired');
  await withOrgCoreTransaction(digestScope(policy), tx, async (domain) => {
    await domain
      .update(admission)
      .set({ retiredAt: new Date(), enabled: false })
      .where(namespaceWhere(policy));
  });
}
export function digestDatabase() {
  return getOrgTransactionDb(getCoreDb());
}
