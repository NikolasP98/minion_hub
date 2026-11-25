/** Record lock policy (spec 140): one organization policy decides when a past record stops being editable. */

export type LockRule = 'month' | 'days' | 'sunat' | 'webhook' | 'chain';
export type LockHitKind =
  | 'month'
  | 'month_current'
  | 'days'
  | 'sunat'
  | 'webhook_date'
  | 'webhook_record'
  | 'chain_unverified';

export interface LockHit {
  rule: LockRule;
  kind: LockHitKind;
  /** False only for `month_current`: a closed current month is a property of the month, not the record. */
  unlockable: boolean;
  /** Month hits: 'YYYY-MM'. */
  period?: string;
  /** Days hit: the organization's X. */
  days?: number;
  /** Webhook hits. */
  label?: string;
  /** `webhook_date`: 'YYYY-MM-DD'. */
  upTo?: string;
  /** Webhook hits: when the lock was set (ISO). */
  lockedAt?: string;
  lockId?: string;
}

export interface LockPolicy {
  month: boolean;
  /** null = the days rule is off. */
  days: number | null;
  sunat: boolean;
  webhook: boolean;
}

export type LockableRecord = { type: 'stock_receipt'; id: string; postedAt: Date };

export interface RecordLockResult {
  /** Hits remain after an active unlock is applied. */
  locked: boolean;
  /** Every rule that applies, unlock or not. */
  rules: LockHit[];
  unlock: { eventId: string; expiresAt: string; grantedByName: string | null } | null;
}

export type LockEventAction =
  'lock' | 'lift' | 'unlock' | 'unlock_used' | 'refused' | 'policy_changed';

export interface LockEventRow {
  id: string;
  action: LockEventAction;
  recordType: string | null;
  recordId: string | null;
  rules: LockHit[];
  actorKind: 'person' | 'api_key' | 'system';
  actorId: string | null;
  actorName: string | null;
  reason: string | null;
  detail: Record<string, unknown>;
  refEventId: string | null;
  expiresAt: string | null;
  occurredAt: string;
  /** The record's human id (e.g. STE-2026-00559) when it still resolves; null otherwise. */
  recordLabel: string | null;
}

/** Who did it: a person (profile), an API key or the system. */
export interface LockActor {
  kind: 'person' | 'api_key' | 'system';
  id: string | null;
  name: string | null;
}
