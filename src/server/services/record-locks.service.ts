/**
 * Record lock policy reads (spec 140 S1). `recordLockFor` is the one function that decides whether a
 * record is locked and returns every rule that applies; it never throws for a locked record (the
 * caller decides the refusal). It runs in the caller's transaction and takes no lock of its own.
 *
 * TODO(handoff): (S3, tasks T029) the active-unlock read and `consumeUnlockInTx` are not built, so
 * `unlock` is always null here. See specs/140-record-lock-policy/tasks.md in the meta repo.
 */
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { OperatorAuthorityError } from '$server/auth/active-operator-principal';
import { getOrgTransactionDb } from '$server/db/pg-client';
import { withOrgCore, withOrgCoreTransaction, type CoreTx } from '$server/db/with-org-core';
import { stkEntries } from '$server/db/pg-schema/stock';
import { finSettings } from '$server/db/pg-finance-schema';
import { posPeriodLocks } from '$server/db/pg-pos-schema';
import {
  orgLockEvents,
  orgLockPolicy,
  orgRecordLocks,
} from '$server/db/pg-org-integrations-schema';
import type {
  LockActor,
  LockEventAction,
  LockEventRow,
  LockHit,
  LockableRecord,
  LockPolicy,
  RecordLockResult,
} from '$lib/types/record-locks';
import {
  DEFAULT_LOCK_POLICY,
  evaluateRecordLock,
  isLocked,
  parsePolicyInput,
  policyFromRow,
  type ExternalLockInput,
} from './record-locks.logic';
import {
  CorrectionError,
  evaluateReceiptPeriod,
  type ReceiptPeriodEvaluation,
} from './stock-corrections.logic';
import {
  resolveFreshCapabilitiesReadOnlyInTransaction,
  resolveFreshOperatorCapabilitiesForWriteInTransaction,
} from './rbac.service';

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

/** The refusal a locked receipt gets (corrections and cancel share it); the hits ride along so the route can name the rules. */
export function lockRefusalError(lock: RecordLockResult): CorrectionError {
  // Month-only refusals keep today's code and text.
  if (lock.rules.every((h) => h.rule === 'month'))
    return new CorrectionError(
      `period ${lock.rules.map((h) => h.period as string).sort()[0]} is locked`,
      'period_locked',
      { locks: lock.rules },
    );
  return new CorrectionError(
    lock.rules.some((h) => h.kind === 'chain_unverified')
      ? 'record is locked: its replacement history could not be verified; ask an owner'
      : 'record is locked',
    'record_locked',
    { locks: lock.rules },
  );
}

// ── S2: policy, audit ────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The signed-in person as the audit actor (a non-uuid profile id is stored as null). */
export const personActor = (ctx: CoreCtx, name: string | null): LockActor => ({
  kind: 'person',
  id: ctx.profileId && UUID_RE.test(ctx.profileId) ? ctx.profileId : null,
  name,
});

/** Owner check inside the caller's write transaction (membership role, same read as spec 124's `owner_required`). */
export async function assertOwnerInTx(tx: CoreTx, ctx: CoreCtx): Promise<string> {
  if (!ctx.profileId || !UUID_RE.test(ctx.profileId))
    throw new CorrectionError('an authenticated profile is required', 'forbidden');
  try {
    const caps = await resolveFreshOperatorCapabilitiesForWriteInTransaction(
      tx,
      ctx.tenantId,
      ctx.profileId,
    );
    if (caps.membershipRole !== 'owner')
      throw new CorrectionError('only an owner can change record locks', 'owner_required');
  } catch (e) {
    if (e instanceof OperatorAuthorityError) {
      if (e.code === 'operator_principal_inactive' || e.code === 'operator_scope_invalid')
        throw new CorrectionError('not allowed', 'forbidden');
      throw new CorrectionError('authority is unavailable, try again', 'unavailable');
    }
    throw e;
  }
  return ctx.profileId;
}

/** Page-load wrappers: keep the tenant transaction inside the service (dataset-read ratchet, spec 039). */
export const getLockPolicyFor = (ctx: CoreCtx) =>
  withOrgCore(ctx, (tx) => getLockPolicy(tx, ctx.tenantId));
export const recordLockForCtx = (ctx: CoreCtx, record: LockableRecord) =>
  withOrgCore(ctx, (tx) => recordLockFor(tx, ctx.tenantId, record));

/** Page hint only (the writes check again): is the signed-in person an owner of the organization? */
export async function isOrgOwner(ctx: CoreCtx): Promise<boolean> {
  if (!ctx.profileId || !UUID_RE.test(ctx.profileId)) return false;
  // The nonlocking authority bridge requires a READ ONLY REPEATABLE READ snapshot.
  return getOrgTransactionDb(ctx.db).transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
    return withOrgCoreTransaction(
      ctx,
      tx as unknown as CoreTx,
      async (t) =>
        (
          await resolveFreshCapabilitiesReadOnlyInTransaction(
            t,
            ctx.tenantId,
            ctx.profileId as string,
          )
        ).membershipRole === 'owner',
    );
  });
}

export interface LockEventInput {
  action: LockEventAction;
  recordType?: string | null;
  recordId?: string | null;
  rules?: LockHit[] | Record<string, unknown>[];
  actor: LockActor;
  reason?: string | null;
  detail?: Record<string, unknown>;
  refEventId?: string | null;
  expiresAt?: Date | null;
}

/** Insert one audit row inside the caller's transaction. */
export async function logLockEventInTx(tx: CoreTx, orgId: string, e: LockEventInput) {
  const [row] = await tx
    .insert(orgLockEvents)
    .values({
      orgId,
      action: e.action,
      recordType: e.recordType ?? null,
      recordId: e.recordId ?? null,
      rules: e.rules ?? [],
      actorKind: e.actor.kind,
      actorId: e.actor.id,
      actorName: e.actor.name,
      reason: e.reason ?? null,
      detail: e.detail ?? {},
      refEventId: e.refEventId ?? null,
      expiresAt: e.expiresAt ?? null,
    })
    .returning({ id: orgLockEvents.id });
  return row!.id;
}

/** One audit row in its own short transaction (refusals: the refused transaction cannot hold it). */
export async function logLockEvent(
  ctx: CoreCtx,
  e: LockEventInput,
  /** Skip the row when the same actor, action, record and `detail.code` was logged within this many ms. */
  opts: { dedupeMs?: number } = {},
): Promise<void> {
  await withOrgCore(ctx, async (tx) => {
    if (opts.dedupeMs) {
      const [dup] = await tx
        .select({ id: orgLockEvents.id })
        .from(orgLockEvents)
        .where(
          and(
            eq(orgLockEvents.orgId, ctx.tenantId),
            eq(orgLockEvents.action, e.action),
            e.recordId ? eq(orgLockEvents.recordId, e.recordId) : isNull(orgLockEvents.recordId),
            eq(orgLockEvents.actorKind, e.actor.kind),
            e.actor.id ? eq(orgLockEvents.actorId, e.actor.id) : isNull(orgLockEvents.actorId),
            sql`${orgLockEvents.detail}->>'code' is not distinct from ${String(e.detail?.code ?? '')}`,
            sql`${orgLockEvents.occurredAt} > now() - make_interval(secs => ${opts.dedupeMs / 1000})`,
          ),
        )
        .limit(1);
      if (dup) return;
    }
    await logLockEventInTx(tx, ctx.tenantId, e);
  });
}

/** Owner only. Saving the same values writes nothing; a change writes one `policy_changed` event with before and after. */
export async function setLockPolicy(
  ctx: CoreCtx,
  raw: unknown,
  actor: LockActor,
): Promise<LockPolicy> {
  const next = parsePolicyInput(raw);
  return withOrgCore(ctx, async (tx) => {
    const profileId = await assertOwnerInTx(tx, ctx);
    const { policy: before } = await readPolicy(tx, ctx.tenantId);
    // `sunat` stays as stored: parsePolicyInput only accepts false until S5.
    const after: LockPolicy = { ...next, sunat: before.sunat };
    // Same values (also when no row exists yet: the default stays implicit) -> nothing to write.
    if (JSON.stringify(before) === JSON.stringify(after)) return before;
    const values = {
      monthEnabled: after.month,
      daysEnabled: after.days !== null,
      days: after.days,
      sunatEnabled: after.sunat,
      webhookEnabled: after.webhook,
      updatedBy: profileId,
      updatedAt: new Date(),
    };
    await tx
      .insert(orgLockPolicy)
      .values({ orgId: ctx.tenantId, ...values })
      .onConflictDoUpdate({ target: orgLockPolicy.orgId, set: values });
    await logLockEventInTx(tx, ctx.tenantId, {
      action: 'policy_changed',
      actor,
      detail: { before, after },
    });
    return after;
  });
}

const EVENT_DEFAULT = 100;
const EVENT_MAX = 500;

/** Newest first; `before` is the `occurredAt` of the last row already shown. */
export async function listLockEvents(
  ctx: CoreCtx,
  opts: { before?: string | null; limit?: number } = {},
): Promise<LockEventRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? EVENT_DEFAULT, 1), EVENT_MAX);
  const before = opts.before ? new Date(opts.before) : null;
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select({ e: orgLockEvents, label: stkEntries.humanId })
      .from(orgLockEvents)
      .leftJoin(
        stkEntries,
        and(
          eq(orgLockEvents.recordType, sql`'stock_receipt'`),
          eq(stkEntries.id, orgLockEvents.recordId),
          eq(stkEntries.orgId, orgLockEvents.orgId),
        ),
      )
      .where(
        and(
          eq(orgLockEvents.orgId, ctx.tenantId),
          before && !Number.isNaN(before.getTime())
            ? lt(orgLockEvents.occurredAt, before)
            : undefined,
        ),
      )
      .orderBy(desc(orgLockEvents.occurredAt))
      .limit(limit),
  );
  return rows.map(({ e, label }) => ({
    id: e.id,
    action: e.action as LockEventAction,
    recordType: e.recordType,
    recordId: e.recordId,
    rules: (e.rules ?? []) as LockHit[],
    actorKind: e.actorKind as LockEventRow['actorKind'],
    actorId: e.actorId,
    actorName: e.actorName,
    reason: e.reason,
    detail: (e.detail ?? {}) as Record<string, unknown>,
    refEventId: e.refEventId,
    expiresAt: e.expiresAt ? e.expiresAt.toISOString() : null,
    occurredAt: e.occurredAt.toISOString(),
    recordLabel: label ?? null,
  }));
}
