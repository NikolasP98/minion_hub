import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { withOrgCoreTransaction } from '$server/db/with-org-core';
import {
  pulseDigestAdmission as admission,
  pulseDigestSources as sources,
} from '$server/db/pg-schema/pulse-digest';
import { assertDigestAuthorityTx } from './pulse-digest.authority';
import {
  digestDatabase,
  digestScope,
  ensureDigestNamespaceTx,
  queueDigestSnapshotTx,
  reconcileDigestPolicyTx,
  cancelDigestForOwnerTx,
} from './pulse-digest.store';
import { collectDigestSources } from './pulse-digest.sources';
import { verifyDigestDependencies, type DigestPolicy } from './pulse-digest.policy';
import type { DigestTransport } from './pulse-digest.fetch';
import { pulseHash } from './pulse-action-contract';
/** Called only with a frozen trusted policy. No source or queue scope from an HTTP caller. */
export async function collectDueDigest(
  policy: DigestPolicy,
  deadline: number,
  transport?: DigestTransport,
): Promise<{ outcome: string; runId?: string }> {
  if (deadline - performance.now() <= 0) return { outcome: 'deadline' };
  const db = digestDatabase();
  const scope = digestScope(policy);
  const owner = randomUUID();
  const where = and(
    eq(admission.orgId, policy.tenantId),
    eq(admission.ownerProfileId, policy.ownerProfileId),
    eq(admission.budgetNamespace, policy.budgetNamespace),
  );
  const claim = await db.transaction(async (tx) => {
    await reconcileDigestPolicyTx(tx, policy);
    const ns = await ensureDigestNamespaceTx(tx, policy);
    if (
      ns.nextPollAt.getTime() > Date.now() ||
      (ns.collectionLeaseUntil && ns.collectionLeaseUntil.getTime() > Date.now())
    )
      return null;
    return withOrgCoreTransaction(scope, tx, async (domain) => {
      const [claimed] = await domain
        .update(admission)
        .set({
          collectionOwner: owner,
          collectionGeneration: ns.collectionGeneration + 1,
          collectionLeaseUntil: new Date(Date.now() + 30000),
          updatedAt: new Date(),
        })
        .where(where)
        .returning();
      const checkpoints = await domain
        .select()
        .from(sources)
        .where(
          and(
            eq(sources.orgId, scope.tenantId),
            eq(sources.ownerProfileId, scope.profileId),
            eq(sources.policyRevision, policy.revision),
          ),
        );
      return {
        generation: claimed.collectionGeneration,
        checkpoints: checkpoints.map((c) => ({
          sourceId: c.sourceId,
          revision: c.revision,
          contentHash: c.contentHash,
          etag: c.etag,
          lastModified: c.lastModified,
          evidence: c.evidence,
        })),
      };
    });
  });
  if (!claim) return { outcome: 'not_due' };
  let outcome = 'failed';
  let runId: string | undefined;
  try {
    await verifyDigestDependencies(policy);
    const snapshot = await collectDigestSources(
      policy,
      claim.checkpoints,
      {
        signal: AbortSignal.timeout(Math.max(1, Math.ceil(deadline - performance.now()))),
        deadline: Math.min(deadline, performance.now() + 15000),
      },
      transport,
    );
    await db.transaction(async (tx) => {
      await assertDigestAuthorityTx(tx, policy);
      await withOrgCoreTransaction(scope, tx, async (domain) => {
        const [ns] = await domain.select().from(admission).where(where).for('update');
        if (
          !ns ||
          ns.collectionOwner !== owner ||
          ns.collectionGeneration !== claim.generation ||
          !ns.collectionLeaseUntil ||
          ns.collectionLeaseUntil.getTime() <= Date.now() ||
          ns.policyHash !== pulseHash(policy) ||
          performance.now() >= deadline
        )
          throw new Error('digest_collection_stale');
      });
      const queued = await queueDigestSnapshotTx(tx, policy, snapshot);
      runId = queued?.runId;
      outcome = queued ? (queued.existing ? 'duplicate' : 'queued') : 'busy';
      await withOrgCoreTransaction(scope, tx, async (domain) => {
        await domain
          .update(admission)
          .set({
            collectionOwner: null,
            collectionLeaseUntil: null,
            nextPollAt: new Date(Date.now() + 900000),
            lastCollectionOutcome: outcome,
            lastCollectionAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              where,
              eq(admission.collectionOwner, owner),
              eq(admission.collectionGeneration, claim.generation),
            ),
          );
      });
    });
  } catch {
    // A stale claim may not mutate its successor's cadence, even on failure.
    await db.transaction(async (tx) => {
      try {
        await assertDigestAuthorityTx(tx, policy);
      } catch {
        await cancelDigestForOwnerTx(tx, scope, 'collection_authority_revoked');
        return;
      }
      await withOrgCoreTransaction(scope, tx, async (domain) => {
        await domain
          .update(admission)
          .set({
            collectionOwner: null,
            collectionLeaseUntil: null,
            nextPollAt: new Date(Date.now() + 300000),
            lastCollectionOutcome: 'failed',
            lastCollectionAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              where,
              eq(admission.collectionOwner, owner),
              eq(admission.collectionGeneration, claim.generation),
              sql`${admission.collectionLeaseUntil}>clock_timestamp()`,
            ),
          );
      });
    });
  }
  return { outcome, ...(runId ? { runId } : {}) };
}
