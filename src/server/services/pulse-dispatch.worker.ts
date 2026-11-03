import { and, eq } from 'drizzle-orm';
import { getCoreDb } from '$server/db/pg-client';
import { withOrgCoreTransaction } from '$server/db/with-org-core';
import { pulseDispatches, type PulseDispatchRow } from '$server/db/pg-schema/pulse-dispatches';
import {
  registerJobHandler,
  type BgJob,
  type JobExecution,
  type AdvanceResult,
} from './bg-runtime';
import {
  preparePulseAuthority,
  resolvePulseAuthorityTx,
  PulseAuthorityError,
} from './pulse-dispatch.authority';
import { pulseCronRequest, pulseHash, PULSE_TOOL_SCHEMA_REVISION } from './pulse-action-contract';
import { retainPulseRemoteAcceptance } from './pulse-dispatch.store';

function safeRemoteId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id) ? id : null;
}
export async function advancePulseDispatch(
  job: BgJob,
  execution: JobExecution,
): Promise<AdvanceResult> {
  if (!job.userId || !job.refId) return { done: true, error: 'dispatch_binding_unavailable' };
  if (execution.remainingMs() < 20_000)
    return { done: false, ...(await postponeBudget(job, execution)) };
  const ctx = { db: getCoreDb(), tenantId: job.tenantId, profileId: job.userId };
  const scope = { tenantId: job.tenantId, profileId: job.userId };
  const load = () =>
    execution.withOwnership((tx) =>
      withOrgCoreTransaction(scope, tx, async (domain) => {
        const [row] = await domain
          .select()
          .from(pulseDispatches)
          .where(
            and(
              eq(pulseDispatches.id, job.refId!),
              eq(pulseDispatches.orgId, job.tenantId),
              eq(pulseDispatches.actorProfileId, job.userId!),
              eq(pulseDispatches.bgJobId, job.id),
            ),
          )
          .for('update');
        return row;
      }),
    );
  let row = await load();
  if (!row) return { done: true, error: 'dispatch_unavailable' };
  const settle = (state: string, reason: string | null, remoteJobId?: string) =>
    execution.withOwnership((tx) =>
      withOrgCoreTransaction(scope, tx, async (domain) => {
        await domain
          .update(pulseDispatches)
          .set({
            state,
            safeReason: reason,
            nextAttemptAt: null,
            ...(remoteJobId ? { remoteJobId } : {}),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(pulseDispatches.id, row.id),
              eq(pulseDispatches.orgId, job.tenantId),
              ...(state === 'scheduled'
                ? [eq(pulseDispatches.admittedGeneration, execution.leaseGeneration)]
                : []),
            ),
          );
      }),
    );
  if (row.state === 'admitted') {
    await settle('indeterminate', 'admission_reclaimed');
    return { done: true };
  }
  if (row.state !== 'queued') return { done: true };
  let payloadValid = false;
  try {
    payloadValid =
      !!row.payload &&
      !row.payloadRedactedAt &&
      row.payloadHash === pulseHash(JSON.parse(row.payload) as unknown) &&
      row.toolSchemaRevision === PULSE_TOOL_SCHEMA_REVISION;
  } catch {
    /* Rejected below without dispatch. */
  }
  if (!payloadValid) {
    await settle('rejected', 'payload_unavailable');
    return { done: true };
  }
  let prepared: Awaited<ReturnType<typeof preparePulseAuthority>> | undefined;
  let admitted = false;
  try {
    prepared = await preparePulseAuthority(ctx, execution.signal);
    if (execution.remainingMs() < 10_000) throw new Error('Insufficient dispatch budget');
    const frozen = prepared;
    await execution.withOwnership(async (tx) => {
      const authority = await resolvePulseAuthorityTx(tx, ctx, frozen.config);
      if (
        authority.gatewayId !== row.gatewayId ||
        authority.channel !== row.channel ||
        authority.agentId !== row.agentId ||
        authority.originSessionKey !== row.originSessionKey ||
        authority.qualificationRevision !== row.gatewayQualificationRevision ||
        authority.authorityHash !== row.authoritySnapshotHash ||
        !frozen.connection.isConnected() ||
        authority.validUntil <= Date.now()
      )
        throw new PulseAuthorityError();
      await withOrgCoreTransaction(scope, tx, async (domain) => {
        const [current] = await domain
          .select()
          .from(pulseDispatches)
          .where(eq(pulseDispatches.id, row.id))
          .for('update');
        if (!current || current.state !== 'queued' || !current.payload || current.attemptCount >= 3)
          throw new PulseAuthorityError();
        const [updated] = await domain
          .update(pulseDispatches)
          .set({
            state: 'admitted',
            admittedAt: new Date(),
            admittedGeneration: execution.leaseGeneration,
            nextAttemptAt: null,
            updatedAt: new Date(),
          })
          .where(eq(pulseDispatches.id, row.id))
          .returning();
        row = updated;
      });
    });
    admitted = true;
    const response = await frozen.connection.dispatch(
      pulseCronRequest({
        id: row.id,
        agentId: row.agentId,
        originSessionKey: row.originSessionKey,
        actionKind: row.actionKind,
        payload: row.payload!,
      }),
    );
    const remoteId = safeRemoteId(response);
    if (!remoteId) throw new Error('Malformed remote receipt');
    if (!(await retainPulseRemoteAcceptance(ctx, row, remoteId)))
      throw new Error('Remote acceptance evidence binding unavailable');
    await settle('scheduled', null, remoteId);
    return { done: true };
  } catch (cause) {
    if (execution.signal.aborted) throw cause;
    if (admitted) {
      await settle('indeterminate', 'remote_acceptance_unknown');
      return { done: true };
    }
    if (cause instanceof PulseAuthorityError) {
      await settle('rejected', cause.reason);
      return { done: true };
    }
    const attempt = row.attemptCount + 1;
    if (attempt >= 3) {
      await execution.withOwnership((tx) =>
        withOrgCoreTransaction(scope, tx, async (domain) => {
          await domain
            .update(pulseDispatches)
            .set({
              state: 'rejected',
              attemptCount: 3,
              safeReason: 'pre_admission_unavailable',
              nextAttemptAt: null,
              updatedAt: new Date(),
            })
            .where(and(eq(pulseDispatches.id, row.id), eq(pulseDispatches.state, 'queued')));
        }),
      );
      return { done: true };
    }
    const until = Date.now() + (attempt === 1 ? 5000 : 30000);
    return {
      done: false,
      postponeUntil: until,
      commitPostpone: (tx) =>
        withOrgCoreTransaction(scope, tx, async (domain) => {
          await domain
            .update(pulseDispatches)
            .set({
              attemptCount: attempt,
              nextAttemptAt: until,
              safeReason: 'pre_admission_unavailable',
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(pulseDispatches.id, row.id),
                eq(pulseDispatches.state, 'queued'),
                eq(pulseDispatches.attemptCount, row.attemptCount),
              ),
            );
        }),
    };
  } finally {
    prepared?.connection.close();
  }
}
async function postponeBudget(_job: BgJob, _execution: JobExecution) {
  return { postponeUntil: Date.now() + 5000, commitPostpone: async () => {} };
}
registerJobHandler({
  type: 'pulse_dispatch',
  pulseRetry: true,
  feature: 'ai.proactive',
  advance: advancePulseDispatch,
});
