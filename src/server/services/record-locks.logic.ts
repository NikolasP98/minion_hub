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
    // A replacement is dated today, so judging it by its own date would reopen a closed-month purchase for good
    // after one unlock (spec 140 R4): the month of the chain's first receipt keeps locking it.
    const first = monthInZone(input.firstPostedAt, tz as string);
    if (input.lockedPeriods.has(first) && !hits.some((h) => h.period === first))
      hits.push({ rule: 'month', kind: 'month', unlockable: true, period: first });
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
const DAYS_MESSAGE =
  'Los días deben ser un número entre 1 y 3650. Corrige el valor y guarda de nuevo.';

/** Strict request parser (contracts/api.md): `month`, `days` (integer 1-3650 or null, required) and `webhook`; `sunat` is accepted only as false until S5. */
export function parsePolicyInput(raw: unknown): LockPolicy {
  const bad = (m: string) => new CorrectionError(m, 'invalid_policy');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw bad('Política inválida: se esperaba un objeto.');
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o))
    if (!(POLICY_KEYS as readonly string[]).includes(k))
      throw bad(`Política inválida: campo desconocido ${k}.`);
  for (const k of ['month', 'webhook'] as const)
    if (typeof o[k] !== 'boolean') throw bad(`Política inválida: ${k} debe ser verdadero o falso.`);
  if (o.sunat !== undefined && o.sunat !== false)
    throw bad('Política inválida: la regla SUNAT aún no está disponible.');
  if (!('days' in o)) throw bad(DAYS_MESSAGE);
  const days = o.days;
  if (
    days !== null &&
    !(Number.isInteger(days) && (days as number) >= 1 && (days as number) <= 3650)
  )
    throw bad(DAYS_MESSAGE);
  return {
    month: o.month as boolean,
    days: days as number | null,
    sunat: false,
    webhook: o.webhook as boolean,
  };
}

// ── S4: the webhook ──────────────────────────────────────────────────────────────────────

export type HookErrorCode =
  'unauthorized' | 'scope_required' | 'invalid_request' | 'webhook_rule_off' | 'too_many';

const HOOK_STATUS: Record<HookErrorCode, number> = {
  unauthorized: 401,
  scope_required: 403,
  invalid_request: 400,
  webhook_rule_off: 409,
  too_many: 429,
};

/** Every refusal names its next step (contracts/api.md). English only: the caller is a machine. */
const HOOK_NEXT: Record<HookErrorCode, string> = {
  unauthorized: 'Send "Authorization: Bearer mk_…" with a valid, active API key.',
  scope_required: "Create an API key with the 'locks' scope in Settings → Developers.",
  invalid_request:
    'Send { "action": "lock" | "lift", "label", and exactly one of "upTo" (YYYY-MM-DD) or "ids" with "recordType": "stock_receipt" }.',
  webhook_rule_off: "Enable 'Por webhook' in Settings → Record locks, then call again.",
  too_many: 'Wait a minute and call again (60 calls per minute per key).',
};

export class HookError extends Error {
  readonly status: number;
  readonly next: string;
  constructor(
    readonly code: HookErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'HookError';
    this.status = HOOK_STATUS[code];
    this.next = HOOK_NEXT[code];
  }
}

export interface HookBody {
  action: 'lock' | 'lift';
  /** 1-60 characters; required for `lock` and for a `lift` by date. */
  label: string | null;
  recordType: 'stock_receipt' | null;
  /** 'YYYY-MM-DD', inclusive. Exactly one of `upTo` and `ids` is set. */
  upTo: string | null;
  ids: string[] | null;
}

const HOOK_KEYS = ['action', 'label', 'upTo', 'recordType', 'ids'];
const HOOK_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const HOOK_LABEL_MAX = 60;
export const HOOK_IDS_MAX = 200;

/**
 * TODO(handoff): (spec 140 tasks T050) `ids` are hub uuids of stock entries only; there is no lookup by document number (STE-…).
 * Strict request parser for `POST /api/hooks/record-locks`; every failure is a 400 that names the rule it broke. */
export function parseHookBody(raw: unknown): HookBody {
  const bad = (m: string) => new HookError('invalid_request', m);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('body must be an object');
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!HOOK_KEYS.includes(k)) throw bad(`unknown key ${k}`);
  if (o.action !== 'lock' && o.action !== 'lift') throw bad('action must be "lock" or "lift"');
  if (o.recordType !== undefined && o.recordType !== 'stock_receipt')
    throw bad('recordType must be "stock_receipt"');
  if ((o.upTo === undefined) === (o.ids === undefined))
    throw bad('send exactly one of "upTo" or "ids"');

  let label: string | null = null;
  if (o.label !== undefined) {
    const t = typeof o.label === 'string' ? o.label.trim() : '';
    if (!t || t.length > HOOK_LABEL_MAX) throw bad(`label must be 1-${HOOK_LABEL_MAX} characters`);
    label = t;
  }
  let upTo: string | null = null;
  let ids: string[] | null = null;
  if (o.upTo !== undefined) {
    // parseDateKey rejects anything but a real calendar date in YYYY-MM-DD form.
    if (typeof o.upTo !== 'string' || !parseDateKey(o.upTo))
      throw bad('upTo must be a calendar date YYYY-MM-DD');
    upTo = o.upTo;
  } else {
    if (o.recordType === undefined) throw bad('ids need "recordType": "stock_receipt"');
    if (
      !Array.isArray(o.ids) ||
      o.ids.length < 1 ||
      o.ids.length > HOOK_IDS_MAX ||
      !o.ids.every((i) => typeof i === 'string' && HOOK_UUID_RE.test(i))
    )
      throw bad(`ids must hold 1-${HOOK_IDS_MAX} uuids`);
    ids = [...new Set((o.ids as string[]).map((i) => i.toLowerCase()))];
  }
  // A lock always has a label; a lift by date names the lock it lifts by label.
  if (!label && (o.action === 'lock' || upTo)) throw bad('label is required');
  return {
    action: o.action,
    label,
    recordType: o.recordType === 'stock_receipt' ? 'stock_receipt' : null,
    upTo,
    ids,
  };
}
