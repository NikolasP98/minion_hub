import { and, eq } from 'drizzle-orm';
import { getCoreDb } from '$server/db/pg-client';
import { env } from '$env/dynamic/private';
import { validateOpenRouterDigestReceipt, assertOpenRouterDigestWireSupport } from '$server/llm';
import { withOrgCoreTransaction } from '$server/db/with-org-core';
import { pulseDigestRuns as runs } from '$server/db/pg-schema/pulse-digest';
import {
  registerJobHandler,
  type BgJob,
  type JobExecution,
  type AdvanceResult,
} from './bg-runtime';
import { readDigestPolicy, verifyDigestDependencies } from './pulse-digest.policy';
import { pulseHash } from './pulse-action-contract';
import { assertDigestAuthorityTx } from './pulse-digest.authority';
import {
  admitDigestAttemptTx,
  finishDigestTx,
  loadDigestRunTx,
  publishDigestTx,
  retainDigestReceipt,
  digestCheckpointsCurrentTx,
} from './pulse-digest.store';
import {
  reasonDigest,
  validateDigestResult,
  digestPrompt,
  type DigestTerminalReceipt,
} from './pulse-digest.reasoning';

export async function advancePulseDigest(
  job: BgJob,
  execution: JobExecution,
): Promise<AdvanceResult> {
  let row = await execution.withOwnership((tx) => loadDigestRunTx(tx, job));
  if (!row) return { done: true, error: 'digest_unavailable' };
  const finish = (state: string, reason: string) =>
    execution.withOwnership(async (tx, current) => {
      const latest = await loadDigestRunTx(tx, current);
      if (!latest) throw new Error('digest_unavailable');
      await finishDigestTx(tx, current, latest, state, reason);
    });
  if (!['queued', 'reasoning_admitted', 'reasoning_received'].includes(row.state))
    return { done: true };
  if (row.state === 'reasoning_admitted') {
    await finish('indeterminate', 'admission_reclaimed');
    return { done: true };
  }
  const policy = readDigestPolicy();
  if (
    !policy ||
    policy.tenantId !== row.orgId ||
    policy.ownerProfileId !== row.ownerProfileId ||
    row.policyHash !== pulseHash(policy)
  ) {
    await finish(row.state === 'queued' ? 'canceled' : 'indeterminate', 'policy_unavailable');
    return { done: true };
  }
  try {
    if (!row.snapshot || !row.evidence || row.redactedAt) {
      await finish(row.state === 'queued' ? 'failed' : 'indeterminate', 'payload_unavailable');
      return { done: true };
    }
    if ((row.snapshot.unchanged || row.snapshot.evidence.length === 0) && row.state === 'queued') {
      await execution.withOwnership(async (tx, current) => {
        const latest = await loadDigestRunTx(tx, current);
        if (!latest) throw new Error('digest_unavailable');
        await publishDigestTx(tx, policy, current, latest, null);
      });
      return { done: true };
    }
    if (row.state === 'queued') {
      if (!env.OPENROUTER_API_KEY) {
        await finish('failed', 'transport_unavailable');
        return { done: true };
      }
      if (execution.remainingMs() < 32000)
        return { done: false, postponeUntil: Date.now() + 5000, commitPostpone: async () => {} };
      await verifyDigestDependencies(policy);
      await assertOpenRouterDigestWireSupport(policy.model, digestPrompt(policy, row.snapshot));
      // Dependency reads and SQL waits consume the same monotonic handler budget.
      if (execution.signal.aborted || execution.remainingMs() < 32000)
        return { done: false, postponeUntil: Date.now() + 5000, commitPostpone: async () => {} };
      const admitted = await execution.withOwnership(async (tx, current) => {
        if (execution.signal.aborted || execution.remainingMs() < 32000) return null;
        const latest = await loadDigestRunTx(tx, current);
        if (!latest) throw new Error('digest_unavailable');
        if (!(await digestCheckpointsCurrentTx(tx, latest))) {
          await finishDigestTx(tx, current, latest, 'superseded', 'cursor_superseded');
          return 'superseded' as const;
        }
        return admitDigestAttemptTx(tx, policy, latest, execution.leaseGeneration);
      });
      if (admitted === 'superseded') return { done: true };
      if (!admitted) {
        await finish('failed', 'budget_or_authority_denied');
        return { done: true };
      }
      row = admitted;
      // Admission committed before external transport. Loss after this point is never replayable.
      if (execution.signal.aborted || execution.remainingMs() < 32000) {
        await finish('indeterminate', 'admission_budget_lost');
        return { done: true };
      }
      await reasonDigest(policy, row.snapshot!, {
        signal: execution.signal,
        beforeDispatch: () =>
          execution.withOwnership(async (tx, current) => {
            await assertDigestAuthorityTx(tx, policy);
            const fresh = await loadDigestRunTx(tx, current);
            if (fresh?.state !== 'reasoning_admitted' || fresh.attemptId !== admitted.attemptId)
              throw new Error('digest_admission_retired');
          }),
        onReceipt: (receipt) => retainDigestReceipt(getCoreDb(), admitted, receipt),
      });
      row = await execution.withOwnership((tx) => loadDigestRunTx(tx, job));
      if (!row) throw new Error('digest_unavailable');
    }
    if (row.state === 'reasoning_admitted' && row.receiptHash) {
      await finish('indeterminate', 'response_unknown');
      return { done: true };
    }
    if (row.state !== 'reasoning_received') return { done: true };
    if (
      row.usageStatus !== 'known' ||
      row.costMicroUsd === null ||
      row.costMicroUsd > (row.upperMicroUsd ?? 0)
    ) {
      await finish('indeterminate', 'billing_unknown_or_out_of_bound');
      return { done: true };
    }
    const receipt: DigestTerminalReceipt = {
      rawResponse: row.rawResponse,
      receiptHash: row.receiptHash!,
      usageStatus: 'known',
      costMicroUsd: row.costMicroUsd,
      resolvedModel: row.resolvedModel,
      metadata: {
        status: typeof row.receiptMetadata?.status === 'number' ? row.receiptMetadata.status : 0,
      },
    };
    let result;
    try {
      await validateOpenRouterDigestReceipt(
        policy.model,
        receipt.rawResponse ?? '',
        receipt.metadata.status,
      );
      result = validateDigestResult(receipt, policy, row.snapshot!);
    } catch {
      await finish('failed', 'invalid_result');
      return { done: true };
    }
    await execution.withOwnership(async (tx, current) => {
      const latest = await loadDigestRunTx(tx, current);
      if (!latest || latest.state !== 'reasoning_received')
        throw new Error('digest_received_unavailable');
      await publishDigestTx(tx, policy, current, latest, result);
    });
    return { done: true };
  } catch (cause) {
    if (execution.signal.aborted) throw cause;
    const latest = await execution.withOwnership((tx) => loadDigestRunTx(tx, job));
    if (!latest) return { done: true, error: 'digest_unavailable' };
    if (latest.state !== 'queued') {
      if (latest.state === 'reasoning_admitted' || latest.state === 'reasoning_received')
        await finish('indeterminate', 'processing_unavailable_after_admission');
      return { done: true };
    }
    if (cause instanceof Error && cause.message.includes('digest_unsupported_wire')) {
      await finish('failed', 'unsupported_provider_bound');
      return { done: true };
    }
    if (latest.attemptCount >= 2) {
      await finish('failed', 'pre_admission_unavailable');
      return { done: true };
    }
    const attempt = latest.attemptCount + 1;
    return {
      done: false,
      postponeUntil: Date.now() + (attempt === 1 ? 5000 : 30000),
      commitPostpone: (tx) =>
        withOrgCoreTransaction(
          { tenantId: job.tenantId, profileId: job.userId },
          tx,
          async (domain) => {
            const updated = await domain
              .update(runs)
              .set({
                attemptCount: attempt,
                nextAttemptAt: Date.now() + (attempt === 1 ? 5000 : 30000),
                safeReason: 'pre_admission_unavailable',
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(runs.id, latest.id),
                  eq(runs.state, 'queued'),
                  eq(runs.attemptCount, latest.attemptCount),
                ),
              )
              .returning({ id: runs.id });
            if (updated.length !== 1) throw new Error('digest_postpone_conflict');
          },
        ),
    };
  }
}
registerJobHandler({ type: 'pulse_digest', pulseRetry: true, advance: advancePulseDigest });
