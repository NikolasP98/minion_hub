import { and, eq, inArray, sql } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import type { CoreCtx } from '$server/auth/core-ctx';
import { getOrgTransactionDb } from '$server/db/pg-client';
import { withOrgCore, withOrgCoreTransaction, type CoreTx } from '$server/db/with-org-core';
import { pulseProposals, type PulseProposalRow } from '$server/db/pg-schema/pulse';
import { pulseDispatches, type PulseDispatchRow } from '$server/db/pg-schema/pulse-dispatches';
import { bgJobs } from '$server/db/pg-schema/bg-jobs';
import { resolveFreshCapabilitiesInTransaction } from './rbac.service';
import { enqueueJobInTransaction } from './bg-runtime';
import { canonicalJson } from './pulse-ingest-contract';
import {
  EXECUTE_KINDS,
  parsePulseAction,
  pulseHash,
  PULSE_TOOL_SCHEMA_REVISION,
} from './pulse-action-contract';
import { preparePulseAuthority, resolvePulseAuthorityTx } from './pulse-dispatch.authority';

export async function assertPulsePersonalOrg(ctx: CoreCtx): Promise<void> {
  const [org] = await ctx.db.execute<{ kind: string; status: string }>(
    sql`select kind,status from organizations where id=${ctx.tenantId}::uuid`,
  );
  if (!org || org.kind !== 'personal' || org.status !== 'active') throw error(404, 'Not found');
}
function actionArgs(kind: string, args: unknown) {
  try {
    return parsePulseAction(kind, args);
  } catch {
    throw error(400, 'invalid_action_arguments');
  }
}
export type PulseReceipt = {
  proposalId: string;
  revision: number;
  decision: string;
  decidedAt: string | null;
  receiptId?: string;
  dispatch?: { state: string; reason: string | null; remoteJobId: string | null };
};
export function pulseOwnerPredicate(ctx: Pick<CoreCtx, 'profileId'>) {
  return ctx.profileId
    ? sql`(${pulseProposals.ownerProfileId} is null or ${pulseProposals.ownerProfileId}=${ctx.profileId})`
    : sql`${pulseProposals.ownerProfileId} is null`;
}
export function proposalReceipt(
  proposal: PulseProposalRow,
  dispatch?: PulseDispatchRow,
): PulseReceipt {
  return {
    proposalId: proposal.id,
    revision: proposal.revision,
    decision: proposal.status,
    decidedAt: proposal.decidedAt?.toISOString() ?? null,
    ...(dispatch
      ? {
          receiptId: dispatch.id,
          dispatch: {
            state: dispatch.state,
            reason: dispatch.payload === null ? 'payload_unavailable' : dispatch.safeReason,
            remoteJobId: dispatch.remoteJobId,
          },
        }
      : proposal.executedAt
        ? { dispatch: { state: 'legacy_unverified', reason: null, remoteJobId: null } }
        : {}),
  };
}
async function lockedProposal(tx: CoreTx, ctx: CoreCtx, id: string) {
  const [row] = await tx
    .select()
    .from(pulseProposals)
    .where(
      and(
        eq(pulseProposals.orgId, ctx.tenantId),
        eq(pulseProposals.id, id),
        pulseOwnerPredicate(ctx),
      ),
    )
    .for('update');
  if (!row) throw error(404, 'proposal not found');
  return row;
}
function conflict(): never {
  throw error(409, 'refresh_required');
}
function checkRevision(row: PulseProposalRow, expected?: number) {
  if (expected !== undefined && row.revision !== expected) conflict();
  if (EXECUTE_KINDS.has(row.kind) && expected === undefined) conflict();
}
async function dispatchFor(tx: CoreTx, ctx: CoreCtx, row: PulseProposalRow) {
  return (
    await tx
      .select()
      .from(pulseDispatches)
      .where(
        and(
          eq(pulseDispatches.orgId, ctx.tenantId),
          eq(pulseDispatches.proposalId, row.id),
          eq(pulseDispatches.proposalRevision, row.revision),
        ),
      )
      .limit(1)
  )[0];
}
export async function getPulseReceipt(ctx: CoreCtx, id: string): Promise<PulseReceipt> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(pulseProposals)
      .where(
        and(
          eq(pulseProposals.orgId, ctx.tenantId),
          eq(pulseProposals.id, id),
          pulseOwnerPredicate(ctx),
        ),
      )
      .limit(1);
    if (!row) throw error(404, 'proposal not found');
    return proposalReceipt(row, await dispatchFor(tx, ctx, row));
  });
}

/** Retain positive evidence for this immutable admitted attempt, even after revocation.
 * This cannot settle state or touch the successor job's ownership/progress. */
export async function retainPulseRemoteAcceptance(
  ctx: CoreCtx,
  admitted: PulseDispatchRow,
  remoteJobId: string,
): Promise<boolean> {
  if (
    !ctx.profileId ||
    admitted.orgId !== ctx.tenantId ||
    admitted.actorProfileId !== ctx.profileId ||
    admitted.admittedGeneration === null ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(remoteJobId)
  )
    return false;
  return withOrgCore(ctx, async (tx) => {
    const rows = await tx
      .update(pulseDispatches)
      .set({ remoteJobId, updatedAt: new Date() })
      .where(
        and(
          eq(pulseDispatches.id, admitted.id),
          eq(pulseDispatches.orgId, ctx.tenantId),
          eq(pulseDispatches.actorProfileId, ctx.profileId!),
          eq(pulseDispatches.bgJobId, admitted.bgJobId),
          eq(pulseDispatches.proposalId, admitted.proposalId),
          eq(pulseDispatches.proposalRevision, admitted.proposalRevision),
          eq(pulseDispatches.admittedGeneration, admitted.admittedGeneration!),
          eq(pulseDispatches.gatewayId, admitted.gatewayId),
          eq(pulseDispatches.channel, admitted.channel),
          eq(pulseDispatches.agentId, admitted.agentId),
          eq(pulseDispatches.originSessionKey, admitted.originSessionKey),
          eq(pulseDispatches.actionKind, admitted.actionKind),
          eq(pulseDispatches.payloadHash, admitted.payloadHash),
          eq(pulseDispatches.toolSchemaRevision, admitted.toolSchemaRevision),
          eq(pulseDispatches.authoritySnapshotHash, admitted.authoritySnapshotHash),
          eq(pulseDispatches.gatewayQualificationRevision, admitted.gatewayQualificationRevision),
          inArray(pulseDispatches.state, ['admitted', 'indeterminate']),
          sql`(${pulseDispatches.remoteJobId} is null or ${pulseDispatches.remoteJobId}=${remoteJobId})`,
        ),
      )
      .returning({ id: pulseDispatches.id });
    return rows.length === 1;
  });
}

export async function decidePulseProposal(
  ctx: CoreCtx,
  id: string,
  action: 'approve' | 'dismiss',
  expectedRevision?: number,
): Promise<PulseReceipt> {
  if (!ctx.profileId) throw error(401, 'profile required');
  // Read-only preparation never runs under the decision transaction. Duplicate approvals need no socket.
  const existing = await withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(pulseProposals)
      .where(
        and(
          eq(pulseProposals.orgId, ctx.tenantId),
          eq(pulseProposals.id, id),
          pulseOwnerPredicate(ctx),
        ),
      )
      .limit(1);
    if (!row) throw error(404, 'proposal not found');
    checkRevision(row, expectedRevision);
    return row;
  });
  const executable = EXECUTE_KINDS.has(existing.kind) && action === 'approve';
  const args =
    executable && existing.status === 'pending'
      ? actionArgs(existing.kind, existing.payload.args)
      : undefined;
  const snapshotHash = pulseHash(existing.payload);
  let prepared: Awaited<ReturnType<typeof preparePulseAuthority>> | undefined;
  try {
    if (existing.status === 'pending' && executable) prepared = await preparePulseAuthority(ctx);
    return await getOrgTransactionDb(ctx.db).transaction(async (tx) => {
      const [organization] = await tx.execute<{ kind: string; status: string }>(
        sql`select kind,status from organizations where id=${ctx.tenantId}::uuid for share`,
      );
      if (!organization || organization.kind !== 'personal' || organization.status !== 'active')
        throw error(404, 'Not found');
      const currentCapabilities = await resolveFreshCapabilitiesInTransaction(
        tx,
        ctx.tenantId,
        ctx.profileId!,
      );
      if (!currentCapabilities.capabilities.can('pulse', 'edit'))
        throw error(403, 'Pulse decision not permitted');
      const authority = prepared
        ? await resolvePulseAuthorityTx(tx, ctx, prepared.config)
        : undefined;
      const [bookkeeping] = await tx.execute<{ role: string }>(
        sql`select current_setting('role') as role`,
      );
      return withOrgCoreTransaction(ctx, tx, async (domain) => {
        const row = await lockedProposal(domain, ctx, id);
        checkRevision(row, expectedRevision);
        const decision = action === 'approve' ? 'approved' : 'dismissed';
        if (row.status !== 'pending') {
          const dispatch = await dispatchFor(domain, ctx, row);
          if (
            row.status === decision &&
            row.decidedBy === ctx.profileId &&
            (!executable ||
              (dispatch &&
                dispatch.actorProfileId === ctx.profileId &&
                dispatch.payloadHash === pulseHash(row.payload.args)))
          )
            return proposalReceipt(row, dispatch);
          conflict();
        }
        if (pulseHash(row.payload) !== snapshotHash) conflict();
        if (
          executable &&
          (!prepared ||
            !authority ||
            authority.authorityHash !== prepared.authority.authorityHash ||
            !prepared.connection.isConnected() ||
            authority.validUntil <= Date.now() ||
            !args)
        )
          throw error(409, 'authority_changed');
        const [decided] = await domain
          .update(pulseProposals)
          .set({
            status: decision,
            decidedBy: ctx.profileId,
            decidedAt: new Date(),
            ...(executable ? { ownerProfileId: ctx.profileId } : {}),
          })
          .where(eq(pulseProposals.id, row.id))
          .returning();
        if (!decided) throw new Error('Decision write missing');
        if (!executable || !authority || !args) return proposalReceipt(decided);
        const dispatchId = crypto.randomUUID();
        // Restore the caller's bookkeeping role for the global queue, then return to owner RLS.
        const [scope] = await domain.execute<{ role: string }>(
          sql`select current_setting('role') as role`,
        );
        if (!bookkeeping) throw new Error('Bookkeeping role unavailable');
        await domain.execute(sql`select set_config('role', ${bookkeeping.role}, true)`);
        const jobId = await enqueueJobInTransaction(tx, {
          tenantId: ctx.tenantId,
          userId: ctx.profileId,
          type: 'pulse_dispatch',
          refId: dispatchId,
        });
        await domain.execute(sql`select set_config('role', ${scope?.role ?? 'app_ledger'}, true)`);
        const [dispatch] = await domain
          .insert(pulseDispatches)
          .values({
            id: dispatchId,
            orgId: ctx.tenantId,
            proposalId: row.id,
            proposalRevision: row.revision,
            actorProfileId: ctx.profileId!,
            gatewayId: authority.gatewayId,
            channel: authority.channel,
            agentId: authority.agentId,
            originSessionKey: authority.originSessionKey,
            actionKind: row.kind,
            payload: canonicalJson(args),
            payloadHash: pulseHash(args),
            toolSchemaRevision: PULSE_TOOL_SCHEMA_REVISION,
            authoritySnapshotHash: authority.authorityHash,
            gatewayQualificationRevision: authority.qualificationRevision,
            bgJobId: jobId,
          })
          .returning();
        return proposalReceipt(decided, dispatch);
      });
    });
  } finally {
    prepared?.connection.close();
  }
}

export async function editPulseProposal(
  ctx: CoreCtx,
  id: string,
  args: Record<string, unknown>,
  expectedRevision: number,
) {
  if (!ctx.profileId) throw error(401, 'profile required');
  return getOrgTransactionDb(ctx.db).transaction(async (bookkeeping) => {
    const [org] = await bookkeeping.execute<{ kind: string; status: string }>(
      sql`select kind,status from organizations where id=${ctx.tenantId}::uuid for share`,
    );
    if (!org || org.kind !== 'personal' || org.status !== 'active') throw error(404, 'Not found');
    const currentCapabilities = await resolveFreshCapabilitiesInTransaction(
      bookkeeping,
      ctx.tenantId,
      ctx.profileId!,
    );
    if (!currentCapabilities.capabilities.can('pulse', 'edit'))
      throw error(403, 'Pulse edit not permitted');
    return withOrgCoreTransaction(ctx, bookkeeping, async (tx) => {
      const row = await lockedProposal(tx, ctx, id);
      if (row.status !== 'pending' || row.internalRunId) conflict();
      checkRevision(row, expectedRevision);
      const validated = actionArgs(row.kind, args);
      const [updated] = await tx
        .update(pulseProposals)
        .set({ payload: { ...row.payload, args: validated }, revision: row.revision + 1 })
        .where(eq(pulseProposals.id, id))
        .returning();
      return updated;
    });
  });
}

/** Job locks precede domain locks. Existing admission evidence is retained on revocation. */
export async function cancelPulseForOwnerTx(
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
        eq(bgJobs.type, 'pulse_dispatch'),
        inArray(bgJobs.status, ['queued', 'running']),
      ),
    )
    .orderBy(bgJobs.id)
    .for('update');
  await withOrgCoreTransaction(scope, tx, async (domain) => {
    await domain
      .update(pulseDispatches)
      .set({ state: 'canceled', nextAttemptAt: null, safeReason: reason, updatedAt: new Date() })
      .where(
        and(
          eq(pulseDispatches.orgId, scope.tenantId),
          eq(pulseDispatches.actorProfileId, scope.profileId),
          eq(pulseDispatches.state, 'queued'),
        ),
      );
    await domain
      .update(pulseDispatches)
      .set({
        state: 'indeterminate',
        nextAttemptAt: null,
        safeReason: 'authority_revoked_after_admission',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(pulseDispatches.orgId, scope.tenantId),
          eq(pulseDispatches.actorProfileId, scope.profileId),
          eq(pulseDispatches.state, 'admitted'),
        ),
      );
  });
  if (jobs.length)
    await tx
      .update(bgJobs)
      .set({
        status: 'cancelled',
        leaseUntil: null,
        finishedAt: Date.now(),
        updatedAt: Date.now(),
        leaseGeneration: sql`${bgJobs.leaseGeneration}+1`,
      })
      .where(
        inArray(
          bgJobs.id,
          jobs.map((job) => job.id),
        ),
      );
}
export async function cancelPulseForOwner(ctx: CoreCtx) {
  if (!ctx.profileId) return;
  const scope = { tenantId: ctx.tenantId, profileId: ctx.profileId };
  return getOrgTransactionDb(ctx.db).transaction((tx) => cancelPulseForOwnerTx(tx, scope));
}

/** Irreversible, scoped retention. Hashes and admission/receipt identifiers survive. */
export async function redactExpiredPulsePayloadsTx(
  tx: CoreTx,
  scope: { tenantId: string; profileId: string },
): Promise<number> {
  const expired = await tx
    .select({ jobId: pulseDispatches.bgJobId })
    .from(pulseDispatches)
    .where(
      and(
        eq(pulseDispatches.orgId, scope.tenantId),
        eq(pulseDispatches.actorProfileId, scope.profileId),
        sql`${pulseDispatches.createdAt}<now()-interval '30 days'`,
        sql`${pulseDispatches.payload} is not null`,
      ),
    )
    .orderBy(pulseDispatches.bgJobId)
    .limit(20);
  const ids = expired.map((row) => row.jobId);
  if (!ids.length) return 0;
  await tx.select().from(bgJobs).where(inArray(bgJobs.id, ids)).orderBy(bgJobs.id).for('update');
  await withOrgCoreTransaction(scope, tx, async (domain) => {
    await domain
      .update(pulseDispatches)
      .set({
        state: 'canceled',
        nextAttemptAt: null,
        safeReason: 'payload_unavailable',
        updatedAt: new Date(),
      })
      .where(
        and(
          inArray(pulseDispatches.bgJobId, ids),
          eq(pulseDispatches.orgId, scope.tenantId),
          eq(pulseDispatches.actorProfileId, scope.profileId),
          eq(pulseDispatches.state, 'queued'),
        ),
      );
    await domain
      .update(pulseDispatches)
      .set({ state: 'indeterminate', safeReason: 'payload_unavailable', updatedAt: new Date() })
      .where(
        and(
          inArray(pulseDispatches.bgJobId, ids),
          eq(pulseDispatches.orgId, scope.tenantId),
          eq(pulseDispatches.actorProfileId, scope.profileId),
          eq(pulseDispatches.state, 'admitted'),
        ),
      );
  });
  await tx
    .update(bgJobs)
    .set({
      status: 'cancelled',
      leaseUntil: null,
      leaseGeneration: sql`${bgJobs.leaseGeneration}+1`,
      updatedAt: Date.now(),
    })
    .where(and(inArray(bgJobs.id, ids), inArray(bgJobs.status, ['queued', 'running'])));
  // Deliberately outside app_ledger: only the trusted bookkeeping identity can redact.
  const rows = await tx
    .update(pulseDispatches)
    .set({ payload: null, payloadRedactedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        inArray(pulseDispatches.bgJobId, ids),
        eq(pulseDispatches.orgId, scope.tenantId),
        eq(pulseDispatches.actorProfileId, scope.profileId),
        sql`${pulseDispatches.createdAt}<now()-interval '30 days'`,
        sql`${pulseDispatches.payload} is not null`,
      ),
    )
    .returning({ id: pulseDispatches.id });
  return rows.length;
}
