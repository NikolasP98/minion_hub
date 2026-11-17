/**
 * Durable pointer to a correction the browser has sent (spec 124, browser-recovery.md). It holds only
 * the minimal identity needed to ask the server what happened after a lost response or a reload: no
 * reason, no amounts, no customer data. The server stays the authority; storage is not a write lock.
 * Pure helpers plus an explicit Storage adapter; nothing here imports server code.
 */
export type CorrectionSourceType = 'pos_ticket_line' | 'stock_receipt';
export type PendingCorrectionV1 = {
  schemaVersion: 1;
  orgId: string;
  profileId: string;
  sourceType: CorrectionSourceType;
  sourceId: string;
  operationKey: string;
  previewHash: string;
  payloadHash: string;
};
export type PendingCorrectionScope = Pick<
  PendingCorrectionV1,
  'orgId' | 'profileId' | 'sourceType' | 'sourceId'
>;
/** What `dismissAppliedPendingCorrection` needs from a status answer. */
export type PendingStatus = {
  outcome: string;
  receipt?: { operationKey?: string; sourceId?: string } | null;
};

/** The one fixed refusal for every storage problem: the caller must block confirmation, never fall back to memory. */
export class RecoveryStorageUnavailable extends Error {
  readonly code = 'recovery_storage_unavailable';
  constructor() {
    super('recovery-storage-unavailable');
  }
}

const PREFIX = 'minion:stock-correction:pending:v1:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const MAX_RECORD_BYTES = 1024;
const MAX_RECORDS = 20;
const MAX_TOTAL_BYTES = 20480;
const MAX_KEYS_INSPECTED = 4096;
const FIELDS = [
  'schemaVersion',
  'orgId',
  'profileId',
  'sourceType',
  'sourceId',
  'operationKey',
  'previewHash',
  'payloadHash',
] as const;
const bytes = (s: string) => new TextEncoder().encode(s).length;

export function decodePendingCorrectionV1(value: unknown): PendingCorrectionV1 {
  const fail = (): never => {
    throw new RecoveryStorageUnavailable();
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== FIELDS.length || !FIELDS.every((k) => k in o)) return fail();
  const uuid = (k: string) =>
    typeof o[k] === 'string' && UUID.test(o[k] as string) ? true : fail();
  const sha = (k: string) => (typeof o[k] === 'string' && SHA.test(o[k] as string) ? true : fail());
  if (o.schemaVersion !== 1) fail();
  if (o.sourceType !== 'pos_ticket_line' && o.sourceType !== 'stock_receipt') fail();
  for (const k of ['orgId', 'profileId', 'sourceId', 'operationKey']) uuid(k);
  for (const k of ['previewHash', 'payloadHash']) sha(k);
  return value as PendingCorrectionV1;
}

const scopePrefix = (s: PendingCorrectionScope) =>
  `${PREFIX}${s.orgId}:${s.profileId}:${s.sourceType}:${s.sourceId}:`;

export function pendingCorrectionKey(v: PendingCorrectionV1): string {
  return `${scopePrefix(v)}${v.operationKey}:${v.payloadHash}`;
}

/** Fixed field order, compact: identical identities always produce identical bytes. */
const serialize = (v: PendingCorrectionV1) =>
  JSON.stringify(Object.fromEntries(FIELDS.map((k) => [k, v[k]])));

function allKeys(storage: Storage): string[] {
  if (storage.length > MAX_KEYS_INSPECTED) throw new RecoveryStorageUnavailable();
  const out: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const k = storage.key(i);
    if (k?.startsWith(PREFIX)) out.push(k);
  }
  return out;
}

function guarded<T>(fn: () => T): T {
  try {
    return fn();
  } catch {
    throw new RecoveryStorageUnavailable();
  }
}

/** Save and read back BEFORE any mutation request. A different record under the same key refuses. */
export function persistPendingCorrection(storage: Storage, value: PendingCorrectionV1): void {
  guarded(() => {
    const record = decodePendingCorrectionV1(value);
    const key = pendingCorrectionKey(record);
    const text = serialize(record);
    if (bytes(text) > MAX_RECORD_BYTES) throw new RecoveryStorageUnavailable();
    const existing = storage.getItem(key);
    if (existing !== null) {
      if (existing !== text) throw new RecoveryStorageUnavailable();
      return;
    }
    const mine = `${PREFIX}${record.orgId}:${record.profileId}:`;
    let total = bytes(text);
    let count = 1;
    for (const k of allKeys(storage)) {
      if (!k.startsWith(mine)) continue;
      const raw = storage.getItem(k);
      if (raw === null) continue;
      count += 1;
      total += bytes(raw);
    }
    if (count > MAX_RECORDS || total > MAX_TOTAL_BYTES) throw new RecoveryStorageUnavailable();
    storage.setItem(key, text);
    const back = storage.getItem(key);
    if (back !== text) throw new RecoveryStorageUnavailable();
    decodePendingCorrectionV1(JSON.parse(back));
  });
}

/** Every pointer of this org/profile/source. A malformed matching record refuses; it is never deleted or skipped. */
export function readPendingCorrections(
  storage: Storage,
  scope: PendingCorrectionScope,
): PendingCorrectionV1[] {
  return guarded(() => {
    const prefix = scopePrefix(scope);
    const out: PendingCorrectionV1[] = [];
    for (const k of allKeys(storage)) {
      if (!k.startsWith(prefix)) continue;
      const raw = storage.getItem(k);
      if (raw === null) continue;
      const v = decodePendingCorrectionV1(JSON.parse(raw));
      if (
        pendingCorrectionKey(v) !== k ||
        serialize(v) !== raw ||
        v.orgId !== scope.orgId ||
        v.profileId !== scope.profileId
      )
        throw new RecoveryStorageUnavailable();
      out.push(v);
    }
    return out;
  });
}

/** Removes exactly this pointer, and only after an applied receipt for this key and source. Never changes stock. */
export function dismissAppliedPendingCorrection(
  storage: Storage,
  value: PendingCorrectionV1,
  status: PendingStatus,
): void {
  guarded(() => {
    const record = decodePendingCorrectionV1(value);
    if (
      status.outcome !== 'applied' ||
      status.receipt?.operationKey !== record.operationKey ||
      status.receipt?.sourceId !== record.sourceId
    )
      throw new RecoveryStorageUnavailable();
    storage.removeItem(pendingCorrectionKey(record));
  });
}

/** Clears a pointer for a typed refusal of THIS mount's own original request (the caller proves that; storage cannot). */
export function clearRefusedPendingCorrection(storage: Storage, value: PendingCorrectionV1): void {
  guarded(() => storage.removeItem(pendingCorrectionKey(decodePendingCorrectionV1(value))));
}
