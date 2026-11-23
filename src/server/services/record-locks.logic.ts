/**
 * Pure rules of the record lock policy (spec 140): which rules lock a record. No database, no clock
 * reads (callers pass `now`). The month rule IS spec 124's `evaluateReceiptPeriod`, so the default
 * policy cannot drift from today's behaviour.
 */
import type { LockHit, LockPolicy } from '$lib/types/record-locks';
import { instantDateKey, parseDateKey } from '$lib/time/zoned';
import { CorrectionError, evaluateReceiptPeriod, monthInZone } from './stock-corrections.logic';

/** No `org_lock_policy` row = month close only (FR-006). */
export const DEFAULT_LOCK_POLICY: LockPolicy = {
  month: true,
  days: null,
  sunat: false,
  webhook: false,
};

/** An active (not lifted) external lock, as the evaluator needs it. */
export interface ExternalLockInput {
  id: string;
  label: string;
  recordType: string | null;
  /** 'YYYY-MM-DD', inclusive. */
  upTo: string | null;
  recordId: string | null;
  createdAt: Date;
}

export interface EvaluateInput {
  policy: LockPolicy;
  /** null = no finance settings row -> `policy_unverified`, as today. */
  settingsTimezone: string | null;
  now: Date;
  recordType: 'stock_receipt';
  /** The record's own date: the month rule keeps using it (research R4). */
  postedAt: Date;
  /** The first receipt of the replacement chain: the `days` and `webhook` rules use its date. */
  firstPostedAt: Date;
  /** Ids of the record and every receipt it replaced. */
  chainIds: readonly string[];
  lockedPeriods: ReadonlySet<string>;
  /** Only consulted while `policy.webhook` is on. */
  externalLocks: readonly ExternalLockInput[];
}

const dayNumber = (key: string): number => {
  const p = parseDateKey(key);
  return p ? Date.UTC(p.year, p.month - 1, p.day) / 86_400_000 : NaN;
};

/** Every hit that applies. Throws `policy_unverified` (no finance settings) exactly like `evaluateReceiptPeriod`. */
export function evaluateRecordLock(input: EvaluateInput): LockHit[] {
  const tz = input.settingsTimezone;
  const hits: LockHit[] = [];

  if (input.policy.month) {
    try {
      evaluateReceiptPeriod({
        settingsTimezone: tz,
        originalPostedAt: input.postedAt,
        now: input.now,
        lockedPeriods: input.lockedPeriods,
      });
    } catch (e) {
      if (!(e instanceof CorrectionError) || e.code !== 'period_locked') throw e;
      const original = monthInZone(input.postedAt, tz as string);
      const current = monthInZone(input.now, tz as string);
      if (input.lockedPeriods.has(original) && original !== current)
        hits.push({ rule: 'month', kind: 'month', unlockable: true, period: original });
      if (input.lockedPeriods.has(current))
        hits.push({ rule: 'month', kind: 'month_current', unlockable: false, period: current });
    }
  } else if (!tz) {
    throw new CorrectionError('finance settings are not configured', 'policy_unverified');
  }
  // Month rule off: the timezone check above still ran, so an org without settings is refused as today.
  const zone = tz as string;
  const firstKey = instantDateKey(input.firstPostedAt, zone);

  if (input.policy.days != null) {
    const age = dayNumber(instantDateKey(input.now, zone)) - dayNumber(firstKey);
    if (age > input.policy.days)
      hits.push({ rule: 'days', kind: 'days', unlockable: true, days: input.policy.days });
  }

  if (input.policy.webhook) {
    const chain = new Set(input.chainIds);
    for (const l of input.externalLocks) {
      if (l.recordType && l.recordType !== input.recordType) continue;
      const base = { rule: 'webhook' as const, unlockable: true, label: l.label, lockId: l.id };
      if (l.upTo && l.upTo >= firstKey)
        hits.push({
          ...base,
          kind: 'webhook_date',
          upTo: l.upTo,
          lockedAt: l.createdAt.toISOString(),
        });
      else if (l.recordId && chain.has(l.recordId))
        hits.push({ ...base, kind: 'webhook_record', lockedAt: l.createdAt.toISOString() });
    }
  }
  return hits;
}

/** `locked = hits.some(!unlockable) || (hits.length > 0 && !activeUnlock)` (data-model.md). */
export const isLocked = (hits: readonly LockHit[], unlockActive: boolean): boolean =>
  hits.some((h) => !h.unlockable) || (hits.length > 0 && !unlockActive);

/** The stored `org_lock_policy` row as the policy the evaluator uses. */
export function policyFromRow(row: {
  monthEnabled: boolean;
  daysEnabled: boolean;
  days: number | null;
  sunatEnabled: boolean;
  webhookEnabled: boolean;
}): LockPolicy {
  return {
    month: row.monthEnabled,
    days: row.daysEnabled ? row.days : null,
    sunat: row.sunatEnabled,
    webhook: row.webhookEnabled,
  };
}

const POLICY_KEYS = ['month', 'days', 'sunat', 'webhook'] as const;

/** Strict request parser: exactly the four keys, `days` an integer 1-3650 or null. */
export function parsePolicyInput(raw: unknown): LockPolicy {
  const bad = (m: string) => new CorrectionError(`invalid lock policy: ${m}`, 'invalid_request');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('not an object');
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o))
    if (!(POLICY_KEYS as readonly string[]).includes(k)) throw bad(`unknown key ${k}`);
  for (const k of ['month', 'sunat', 'webhook'] as const)
    if (typeof o[k] !== 'boolean') throw bad(`${k} must be a boolean`);
  const days = o.days ?? null;
  if (
    days !== null &&
    !(Number.isInteger(days) && (days as number) >= 1 && (days as number) <= 3650)
  )
    throw bad('days must be an integer from 1 to 3650, or null');
  return {
    month: o.month as boolean,
    days: days as number | null,
    sunat: o.sunat as boolean,
    webhook: o.webhook as boolean,
  };
}
