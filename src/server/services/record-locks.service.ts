/**
 * Record lock policy reads (spec 140 S1). `recordLockFor` is the one function that decides whether a
 * record is locked and returns every rule that applies; it never throws for a locked record (the
 * caller decides the refusal). It runs in the caller's transaction and takes no lock of its own.
 *
 * TODO(handoff): (S3, tasks T029) the active-unlock read and `consumeUnlockInTx` are not built, so
 * `unlock` is always null here. See specs/140-record-lock-policy/tasks.md in the meta repo.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { CoreTx } from '$server/db/with-org-core';
import { finSettings } from '$server/db/pg-finance-schema';
import { posPeriodLocks } from '$server/db/pg-pos-schema';
import { orgLockPolicy, orgRecordLocks } from '$server/db/pg-org-integrations-schema';
import type { LockableRecord, LockPolicy, RecordLockResult } from '$lib/types/record-locks';
import {
  DEFAULT_LOCK_POLICY,
  evaluateRecordLock,
  isLocked,
  policyFromRow,
  type ExternalLockInput,
} from './record-locks.logic';
import { evaluateReceiptPeriod, type ReceiptPeriodEvaluation } from './stock-corrections.logic';

/** Replacement chains are followed at most this far back (research R4). */
const CHAIN_CAP = 20;

/** What the correction plan needs besides the verdict, so it reads each table once. */
export interface RecordLockEvidence {
  /** Spec 124's evaluation (today's `period`). */
  period: ReceiptPeriodEvaluation;
  /** Every `pos_period_locks` period of the org. */
  lockedPeriods: string[];
  /** False = the org never saved a policy: the default applies and the preview hash stays as before. */
  hasPolicyRow: boolean;
  policy: LockPolicy;
  /** Ids of the external locks that were consulted (empty while the webhook rule is off). */
  externalLockIds: string[];
}

async function readPolicy(tx: CoreTx, orgId: string) {
  const [row] = await tx.select().from(orgLockPolicy).where(eq(orgLockPolicy.orgId, orgId));
  return row
    ? { policy: policyFromRow(row), hasRow: true }
    : { policy: DEFAULT_LOCK_POLICY, hasRow: false };
}

/** No row -> the default policy (month close only). */
export async function getLockPolicy(tx: CoreTx, orgId: string): Promise<LockPolicy> {
  return (await readPolicy(tx, orgId)).policy;
}

/** The record, then each receipt it replaced, oldest last (`receipt_replace` and `receipt_chain` corrections). */
async function receiptChain(tx: CoreTx, orgId: string, id: string) {
  const res = (await tx.execute(sql`
    with recursive chain(id, depth) as (
      select ${id}::uuid, 0
      union all
      select c.source_entry_id, ch.depth + 1
      from stk_corrections c join chain ch on c.replacement_entry_id = ch.id
      where c.org_id = ${orgId} and c.kind in ('receipt_replace', 'receipt_chain')
        and c.source_entry_id is not null and ch.depth < ${CHAIN_CAP}
    )
    select chain.id::text as id, e.posted_at as posted_at
    from chain join stk_entries e on e.id = chain.id and e.org_id = ${orgId}
    order by chain.depth`)) as unknown as Array<{ id: string; posted_at: Date | string | null }>;
  return res;
}

export async function recordLockFor(
  tx: CoreTx,
  orgId: string,
  record: LockableRecord,
  opts: { now?: Date } = {},
): Promise<RecordLockResult & RecordLockEvidence> {
  const now = opts.now ?? new Date();
  const { policy, hasRow } = await readPolicy(tx, orgId);
  const [settings] = await tx
    .select({ timezone: finSettings.timezone })
    .from(finSettings)
    .where(eq(finSettings.orgId, orgId));
  const periodRows = await tx
    .select({ period: posPeriodLocks.period })
    .from(posPeriodLocks)
    .where(eq(posPeriodLocks.orgId, orgId));
  const lockedPeriods = periodRows.map((r) => r.period);

  const chain = await receiptChain(tx, orgId, record.id);
  const chainIds = chain.length ? chain.map((c) => c.id) : [record.id];
  const firstRaw = chain.length ? chain[chain.length - 1]!.posted_at : null;
  const firstPostedAt = firstRaw ? new Date(firstRaw) : record.postedAt;
  // The walk is capped (one row past the cap means it may have stopped early) and the oldest receipt
  // must have a date: otherwise the age cannot be verified, so fail closed instead of judging a partial chain.
  // Only the days and webhook rules read the first receipt's date, so only they can be misled by a
  // partial chain; with neither on (every org without a policy row) the answer stays exactly today's.
  const chainUnverified =
    (policy.days !== null || policy.webhook) &&
    (chain.length > CHAIN_CAP || (chain.length > 0 && !firstRaw));

  // External locks are only read while the webhook rule is on: with it off they cannot change the answer.
  const externalRows = policy.webhook
    ? await tx
        .select()
        .from(orgRecordLocks)
        .where(and(eq(orgRecordLocks.orgId, orgId), isNull(orgRecordLocks.liftedAt)))
    : [];
  const externalLocks: ExternalLockInput[] = externalRows.map((r) => ({
    id: r.id,
    label: r.label,
    recordType: r.recordType,
    upTo: r.upTo,
    recordId: r.recordId,
    createdAt: r.createdAt,
  }));

  const rules = evaluateRecordLock({
    policy,
    settingsTimezone: settings?.timezone ?? null,
    now,
    recordType: record.type,
    postedAt: record.postedAt,
    firstPostedAt,
    chainIds,
    lockedPeriods: new Set(lockedPeriods),
    externalLocks,
  });
  if (chainUnverified) rules.push({ rule: 'chain', kind: 'chain_unverified', unlockable: true });
  // Pure and already known not to throw (the verdict above verified the timezone); with no locked
  // periods it returns today's evaluation object for the preview hash.
  const period = evaluateReceiptPeriod({
    settingsTimezone: settings?.timezone ?? null,
    originalPostedAt: record.postedAt,
    now,
    lockedPeriods: new Set(),
  });
  return {
    locked: isLocked(rules, false),
    rules,
    unlock: null,
    period,
    lockedPeriods,
    hasPolicyRow: hasRow,
    policy,
    externalLockIds: rules.flatMap((h) => h.lockId ?? []).sort(),
  };
}
