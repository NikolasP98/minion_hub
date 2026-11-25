/**
 * Record lock policy reads (spec 140 S1). `recordLockFor` is the one function that decides whether a
 * record is locked and returns every rule that applies; it never throws for a locked record (the
 * caller decides the refusal). It runs in the caller's transaction and takes no lock of its own.
 */
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { instantDateKey } from '$lib/time/zoned';
import type { CoreCtx } from '$server/auth/core-ctx';
import { OperatorAuthorityError } from '$server/auth/active-operator-principal';
import { getOrgTransactionDb } from '$server/db/pg-client';
import { withOrgCore, withOrgCoreTransaction, type CoreTx } from '$server/db/with-org-core';
import { stkEntries } from '$server/db/pg-schema/stock';
import { isUniqueViolation } from './pos/db-errors';
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
  HookError,
  parsePolicyInput,
  policyFromRow,
  type ExternalLockInput,
  type HookBody,
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

/** True once the org saved its own lock rules (otherwise the default applies). */
export async function hasLockPolicyRow(tx: CoreTx, orgId: string): Promise<boolean> {
  return (await readPolicy(tx, orgId)).hasRow;
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

/** The newest unused, unexpired owner unlock granted on this very receipt: a replacement needs its own (data-model "Active unlock"). */
async function activeUnlock(
  tx: CoreTx,
  orgId: string,
  recordId: string,
  now: Date,
): Promise<{
  unlock: NonNullable<RecordLockResult['unlock']>;
  granted: LockHit[];
} | null> {
  const [row] = await tx
    .select({
      id: orgLockEvents.id,
      expiresAt: orgLockEvents.expiresAt,
      actorName: orgLockEvents.actorName,
      rules: orgLockEvents.rules,
    })
    .from(orgLockEvents)
    .where(
      and(
        eq(orgLockEvents.orgId, orgId),
        eq(orgLockEvents.action, 'unlock'),
        eq(orgLockEvents.recordType, 'stock_receipt'),
        eq(orgLockEvents.recordId, recordId),
        gt(orgLockEvents.expiresAt, now),
        sql`not exists (select 1 from org_lock_events u
          where u.org_id = ${orgLockEvents.orgId} and u.action = 'unlock_used' and u.ref_event_id = ${orgLockEvents.id})`,
      ),
    )
    .orderBy(desc(orgLockEvents.occurredAt))
    .limit(1);
  return row?.expiresAt
    ? {
        unlock: {
          eventId: row.id,
          expiresAt: row.expiresAt.toISOString(),
          grantedByName: row.actorName,
        },
        granted: (row.rules ?? []) as LockHit[],
      }
    : null;
}

/** Identity of a hit for matching an unlock to what the owner saw: rule kind, the webhook lock, the month. */
const hitKey = (h: LockHit) => `${h.kind}|${h.lockId ?? ''}|${h.period ?? ''}`;

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
  // Every rule reads the first receipt's date or the chain's posting history (the month rule included: a
  // chain longer than the cap would otherwise escape a month closed after the corrections), so a partial
  // chain is refused whichever rule is on.
  const chainUnverified =
    (policy.month || policy.days !== null || policy.webhook) &&
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
  // The unlock is read only for a record some rule locks, so an unlocked record costs no extra read.
  // An unlock is bound to the hits it was granted for: a hit that appeared after the grant (a new
  // webhook lock) or was never shown to the owner keeps the record locked until a new unlock.
  const found = rules.length ? await activeUnlock(tx, orgId, record.id, now) : null;
  const grantedKeys = new Set((found?.granted ?? []).map(hitKey));
  const covers = found !== null && rules.every((h) => grantedKeys.has(hitKey(h)));
  const unlock = covers ? found.unlock : null;
  return {
    locked: isLocked(rules, covers),
    unlockOutdated: found !== null && !covers,
    rules,
    unlock,
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
  // A page hint only (writes re-check with assertOwnerInTx): an inactive principal or a removed member reads as
  // "not owner" instead of failing the page.
  return readOwner(ctx).catch((e: unknown) => {
    console.warn(
      '[record-locks] owner read failed; treating as not owner',
      (e as { code?: string })?.code ?? e,
    );
    return false;
  });
}

async function readOwner(ctx: CoreCtx): Promise<boolean> {
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

const ruleKinds = (rules: LockEventInput['rules']) =>
  ((rules ?? []) as Array<{ kind?: string }>)
    .map((h) => h.kind ?? '')
    .sort()
    .join(',');

/** One audit row in its own short transaction (refusals: the refused transaction cannot hold it). */
export async function logLockEvent(
  ctx: CoreCtx,
  e: LockEventInput,
  /** Skip the row when the same actor, action, record, `detail.code` and rule kinds were logged within this many ms. */
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
            // A rule that newly applies within the window is a different refusal and gets its own row.
            sql`(select coalesce(string_agg(r->>'kind', ',' order by r->>'kind'), '')
              from jsonb_array_elements(${orgLockEvents.rules}) r) = ${ruleKinds(e.rules)}`,
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

// ── S3: owner one-shot unlock ────────────────────────────────────────────────────────────

/** An unlock lasts this long unless a correction uses it first (research R5; not configurable). */
export const UNLOCK_TTL_MS = 24 * 60 * 60 * 1000;
const REASON_MAX = 1000;

export interface UnlockInput {
  recordType: 'stock_receipt';
  recordId: string;
  reason: string;
}

/** Strict request parser for the unlock route. */
export function parseUnlockInput(raw: unknown): UnlockInput {
  const bad = (m: string) => new CorrectionError(m, 'invalid_request');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('se esperaba un objeto');
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o))
    if (!['recordType', 'recordId', 'reason'].includes(k)) throw bad(`campo desconocido ${k}`);
  if (o.recordType !== 'stock_receipt') throw bad('recordType debe ser stock_receipt');
  if (typeof o.recordId !== 'string' || !UUID_RE.test(o.recordId)) throw bad('recordId inválido');
  const reason = typeof o.reason === 'string' ? o.reason.trim() : '';
  if (!reason || reason.length > REASON_MAX)
    throw bad('el motivo es obligatorio (1 a 1000 caracteres)');
  return { recordType: 'stock_receipt', recordId: o.recordId, reason };
}

/**
 * Owner only. Unlocks one locked receipt for one correction, valid 24 hours, with a required reason.
 * A second grant while one is active returns the active one and writes nothing.
 */
export async function grantUnlock(
  ctx: CoreCtx,
  raw: unknown,
  actor: LockActor,
  opts: { now?: Date } = {},
): Promise<{ eventId: string; expiresAt: string; created: boolean }> {
  const input = parseUnlockInput(raw);
  const now = opts.now ?? new Date();
  return withOrgCore(ctx, async (tx) => {
    await assertOwnerInTx(tx, ctx);
    const [entry] = await tx
      .select({ id: stkEntries.id, postedAt: stkEntries.postedAt })
      .from(stkEntries)
      .where(
        and(
          eq(stkEntries.id, input.recordId),
          eq(stkEntries.orgId, ctx.tenantId),
          eq(stkEntries.type, 'receipt'),
          eq(stkEntries.status, 'submitted'),
        ),
      );
    if (!entry?.postedAt) throw new CorrectionError('receipt not found', 'not_found');
    const lock = await recordLockFor(
      tx,
      ctx.tenantId,
      { type: 'stock_receipt', id: entry.id, postedAt: entry.postedAt },
      { now },
    );
    if (!lock.rules.length) throw new CorrectionError('record is not locked', 'not_locked');
    // A closed current month is a property of the month: only reopening it helps (R5).
    if (lock.rules.some((h) => !h.unlockable))
      throw new CorrectionError('the current month is closed', 'not_unlockable', {
        locks: lock.rules,
      });
    if (lock.unlock)
      return { eventId: lock.unlock.eventId, expiresAt: lock.unlock.expiresAt, created: false };
    const expiresAt = new Date(now.getTime() + UNLOCK_TTL_MS);
    const eventId = await logLockEventInTx(tx, ctx.tenantId, {
      action: 'unlock',
      recordType: input.recordType,
      recordId: entry.id,
      rules: lock.rules,
      actor,
      reason: input.reason,
      expiresAt,
    });
    return { eventId, expiresAt: expiresAt.toISOString(), created: true };
  });
}

/**
 * Called by `applyStockCorrection` after the correction row, in the same transaction: writes
 * `unlock_used` for the unlock the plan relied on. The unique index makes a second use fail, which
 * rolls the correction back (the unlock stays usable only if nothing else consumed it).
 */
export async function consumeUnlockInTx(
  tx: CoreTx,
  orgId: string,
  use: {
    eventId: string;
    recordId: string;
    correctionId?: string;
    rules: LockHit[];
    detail?: Record<string, unknown>;
  },
  actor: LockActor,
): Promise<void> {
  try {
    await logLockEventInTx(tx, orgId, {
      action: 'unlock_used',
      recordType: 'stock_receipt',
      recordId: use.recordId,
      rules: use.rules,
      actor,
      refEventId: use.eventId,
      detail: use.detail ?? { correctionId: use.correctionId },
    });
  } catch (e) {
    const cause = (e as { cause?: unknown } | null)?.cause;
    if (isUniqueViolation(e) || isUniqueViolation(cause))
      throw new CorrectionError('the unlock was already used', 'record_locked', {
        locks: use.rules,
      });
    throw e;
  }
}

// ── S4: external locks (webhook) and the owner's lift ────────────────────────────────────

/** The calling API key, as the audit actor and the `lifted_by` of a lift. */
export interface HookKey {
  id: string;
  name: string;
}

export type HookResult =
  | {
      action: 'lock';
      created: number;
      existing: number;
      unknown: string[];
      locks: Array<{ id: string; label: string; upTo?: string }>;
    }
  | { action: 'lift'; lifted: number };

const keyActor = (key: HookKey): LockActor => ({ kind: 'api_key', id: key.id, name: key.name });
const typeKey = (t: HookBody['recordType']) => t ?? null;

/**
 * The webhook's one entry point. Refused with `webhook_rule_off` while the organization has not
 * enabled "Por webhook" (storing locks that do nothing would mislead the caller). Idempotent by
 * natural key: the same lock twice answers `created: 0` and writes no second event.
 */
export async function applyExternalLock(
  ctx: CoreCtx,
  key: HookKey,
  body: HookBody,
  opts: { now?: Date } = {},
): Promise<HookResult> {
  const now = opts.now ?? new Date();
  return withOrgCore(ctx, async (tx) => {
    const { policy } = await readPolicy(tx, ctx.tenantId);
    if (!policy.webhook) throw new HookError('webhook_rule_off');
    return body.action === 'lock'
      ? lockExternal(tx, ctx.tenantId, key, body, now)
      : liftExternal(tx, ctx.tenantId, key, body);
  });
}

// TODO(handoff): (spec 140 S4) idempotency relies on `ON CONFLICT DO NOTHING` against the two partial unique indexes of
// org_record_locks; it is unit-tested with a fake transaction only. No native-Postgres case, and the migration + seed were not
// applied here (`bun run qa:reset`). Run both once on the qa stack before relying on it.
async function lockExternal(
  tx: CoreTx,
  orgId: string,
  key: HookKey,
  body: HookBody,
  now: Date,
): Promise<HookResult> {
  const label = body.label as string;
  const base = { orgId, source: 'webhook', label, apiKeyId: key.id, actorName: key.name };

  if (body.upTo) {
    const [settings] = await tx
      .select({ timezone: finSettings.timezone })
      .from(finSettings)
      .where(eq(finSettings.orgId, orgId));
    // shortcut: an organization with no finance settings row is judged in UTC here (its records are refused as unverifiable anyway).
    if (body.upTo > instantDateKey(now, settings?.timezone ?? 'UTC'))
      throw new HookError('invalid_request', 'upTo cannot be in the future');
    const [made] = await tx
      .insert(orgRecordLocks)
      .values({ ...base, recordType: typeKey(body.recordType), upTo: body.upTo })
      .onConflictDoNothing()
      .returning({ id: orgRecordLocks.id });
    const [lock] = made
      ? [made]
      : await tx
          .select({ id: orgRecordLocks.id })
          .from(orgRecordLocks)
          .where(
            and(
              eq(orgRecordLocks.orgId, orgId),
              eq(orgRecordLocks.label, label),
              eq(orgRecordLocks.upTo, body.upTo),
              body.recordType
                ? eq(orgRecordLocks.recordType, body.recordType)
                : isNull(orgRecordLocks.recordType),
              isNull(orgRecordLocks.liftedAt),
            ),
          );
    if (made)
      await logLockEventInTx(tx, orgId, {
        action: 'lock',
        recordType: typeKey(body.recordType),
        actor: keyActor(key),
        detail: { lockId: made.id, label, upTo: body.upTo },
      });
    return {
      action: 'lock',
      created: made ? 1 : 0,
      existing: made ? 0 : 1,
      unknown: [],
      locks: lock ? [{ id: lock.id, label, upTo: body.upTo }] : [],
    };
  }

  const ids = body.ids as string[];
  const known = await tx
    .select({ id: stkEntries.id })
    .from(stkEntries)
    .where(and(eq(stkEntries.orgId, orgId), inArray(stkEntries.id, ids)));
  const knownIds = new Set(known.map((k) => k.id));
  const unknown = ids.filter((i) => !knownIds.has(i));
  const wanted = ids.filter((i) => knownIds.has(i));
  const made = wanted.length
    ? await tx
        .insert(orgRecordLocks)
        .values(wanted.map((recordId) => ({ ...base, recordType: 'stock_receipt', recordId })))
        .onConflictDoNothing()
        .returning({ id: orgRecordLocks.id, recordId: orgRecordLocks.recordId })
    : [];
  if (made.length)
    await tx.insert(orgLockEvents).values(
      made.map((l) => ({
        orgId,
        action: 'lock',
        recordType: 'stock_receipt',
        recordId: l.recordId,
        rules: [],
        actorKind: 'api_key',
        actorId: key.id,
        actorName: key.name,
        detail: { lockId: l.id, label },
      })),
    );
  const active = wanted.length
    ? await tx
        .select({ id: orgRecordLocks.id })
        .from(orgRecordLocks)
        .where(
          and(
            eq(orgRecordLocks.orgId, orgId),
            eq(orgRecordLocks.recordType, 'stock_receipt'),
            inArray(orgRecordLocks.recordId, wanted),
            isNull(orgRecordLocks.liftedAt),
          ),
        )
    : [];
  return {
    action: 'lock',
    created: made.length,
    existing: wanted.length - made.length,
    unknown,
    locks: active.map((l) => ({ id: l.id, label })),
  };
}

async function liftExternal(
  tx: CoreTx,
  orgId: string,
  key: HookKey,
  body: HookBody,
): Promise<HookResult> {
  const target = body.upTo
    ? and(
        eq(orgRecordLocks.upTo, body.upTo),
        eq(orgRecordLocks.label, body.label as string),
        body.recordType
          ? eq(orgRecordLocks.recordType, body.recordType)
          : isNull(orgRecordLocks.recordType),
      )
    : and(
        eq(orgRecordLocks.recordType, 'stock_receipt'),
        inArray(orgRecordLocks.recordId, body.ids as string[]),
        body.label ? eq(orgRecordLocks.label, body.label) : undefined,
      );
  const lifted = await tx
    .update(orgRecordLocks)
    .set({ liftedAt: new Date(), liftedByKind: 'api_key', liftedBy: key.id })
    .where(
      and(
        eq(orgRecordLocks.orgId, orgId),
        eq(orgRecordLocks.source, 'webhook'),
        isNull(orgRecordLocks.liftedAt),
        target,
      ),
    )
    .returning({
      id: orgRecordLocks.id,
      label: orgRecordLocks.label,
      upTo: orgRecordLocks.upTo,
      recordType: orgRecordLocks.recordType,
      recordId: orgRecordLocks.recordId,
    });
  if (lifted.length)
    await tx.insert(orgLockEvents).values(
      lifted.map((l) => ({
        orgId,
        action: 'lift',
        recordType: l.recordType,
        recordId: l.recordId,
        rules: [],
        actorKind: 'api_key',
        actorId: key.id,
        actorName: key.name,
        detail: { lockId: l.id, label: l.label, upTo: l.upTo },
      })),
    );
  return { action: 'lift', lifted: lifted.length };
}

/** An external lock as the settings page lists it. */
export interface ExternalLockRow {
  id: string;
  label: string;
  /** 'YYYY-MM-DD' when the lock is "everything up to a date". */
  upTo: string | null;
  recordId: string | null;
  recordLabel: string | null;
  actorName: string | null;
  createdAt: string;
}

/** Active external locks, newest first (lifted ones stay only in the audit list). */
export async function listExternalLocks(ctx: CoreCtx): Promise<ExternalLockRow[]> {
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select({ l: orgRecordLocks, recordLabel: stkEntries.humanId })
      .from(orgRecordLocks)
      .leftJoin(
        stkEntries,
        and(eq(stkEntries.id, orgRecordLocks.recordId), eq(stkEntries.orgId, orgRecordLocks.orgId)),
      )
      .where(and(eq(orgRecordLocks.orgId, ctx.tenantId), isNull(orgRecordLocks.liftedAt)))
      .orderBy(desc(orgRecordLocks.createdAt)),
  );
  return rows.map(({ l, recordLabel }) => ({
    id: l.id,
    label: l.label,
    upTo: l.upTo,
    recordId: l.recordId,
    recordLabel: recordLabel ?? null,
    actorName: l.actorName,
    createdAt: l.createdAt.toISOString(),
  }));
}

/** Owner only. Lifts one external lock with a required reason; an already lifted lock answers `lifted: false`. */
export async function liftLock(
  ctx: CoreCtx,
  lockId: string,
  rawReason: unknown,
  actor: LockActor,
): Promise<{ lifted: boolean }> {
  const reason = typeof rawReason === 'string' ? rawReason.trim() : '';
  if (!reason || reason.length > REASON_MAX)
    throw new CorrectionError('el motivo es obligatorio (1 a 1000 caracteres)', 'invalid_request');
  if (!UUID_RE.test(lockId)) throw new CorrectionError('lock not found', 'not_found');
  return withOrgCore(ctx, async (tx) => {
    const profileId = await assertOwnerInTx(tx, ctx);
    const [row] = await tx
      .select()
      .from(orgRecordLocks)
      .where(and(eq(orgRecordLocks.id, lockId), eq(orgRecordLocks.orgId, ctx.tenantId)));
    if (!row) throw new CorrectionError('lock not found', 'not_found');
    if (row.liftedAt) return { lifted: false };
    const [done] = await tx
      .update(orgRecordLocks)
      .set({
        liftedAt: new Date(),
        liftedByKind: 'person',
        liftedBy: profileId,
        liftReason: reason,
      })
      .where(and(eq(orgRecordLocks.id, lockId), isNull(orgRecordLocks.liftedAt)))
      .returning({ id: orgRecordLocks.id });
    if (!done) return { lifted: false };
    await logLockEventInTx(tx, ctx.tenantId, {
      action: 'lift',
      recordType: row.recordType,
      recordId: row.recordId,
      actor,
      reason,
      detail: { lockId, label: row.label, upTo: row.upTo },
    });
    return { lifted: true };
  });
}
