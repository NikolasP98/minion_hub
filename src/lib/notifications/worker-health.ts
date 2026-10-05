export const NOTIFICATION_HEALTH_UNAVAILABLE = 'notification_health_unavailable' as const;

export const NOTIFICATION_HEALTH_MAX_BYTES = 64 * 1024;
export const NOTIFICATION_HEALTH_TIMEOUT_MS = 15_000;

export type NotificationHealthState =
  | 'runnable'
  | 'stale'
  | 'absent'
  | 'catalog_invalid'
  | 'catalog_mismatch'
  | 'projection_unavailable'
  | 'build_unavailable'
  | 'startup_failed';

export type NotificationAdmissionCode = Exclude<
  NotificationHealthState,
  'runnable' | 'stale' | 'absent'
>;

export type NotificationFailureCode =
  'deadline' | 'statement_timeout' | 'lock_timeout' | 'database_unavailable' | 'projection_failed';

export type NotificationResult = 'completed' | 'failed' | 'unsupported' | 'empty';

export interface NotificationHealthAge {
  readonly ageMs: number | null;
  readonly futureTimestamp: boolean;
}

export interface NotificationQueueHealth {
  readonly count: number;
  readonly lowerBound: boolean;
  readonly oldest: NotificationHealthAge;
}

export interface NotificationWorkerIdentity {
  readonly buildSha: string;
  readonly catalogRevision: string;
  readonly catalogSha256: string;
  readonly projectorRevision: string;
  readonly projectorSha256: string;
}

export interface NotificationAdmissionObservation {
  readonly checked: NotificationHealthAge;
  readonly code: NotificationAdmissionCode;
  readonly buildSha: string | null;
  readonly artifactSha256: string | null;
  readonly catalogRevision: string | null;
  readonly catalogSha256: string | null;
  readonly projectorRevision: string | null;
  readonly projectorSha256: string | null;
}

export interface NotificationWorkerHealth {
  readonly checkedAt: string;
  readonly state: NotificationHealthState;
  readonly worker: {
    readonly heartbeat: NotificationHealthAge;
    readonly identity: NotificationWorkerIdentity | null;
    readonly admission: NotificationAdmissionObservation | null;
  };
  readonly organization: {
    readonly lastCompleted: NotificationHealthAge;
    readonly lastSuccess: NotificationHealthAge;
    readonly failureStreak: 0 | 1 | 2 | 3 | 4;
    readonly lastFailureCode: NotificationFailureCode | null;
    readonly lastResult: NotificationResult | null;
  };
  readonly queue: {
    readonly pending: NotificationQueueHealth;
    readonly processing: NotificationQueueHealth;
    readonly unsupportedCatalogPending: boolean;
  };
}

export type NotificationHealthSeed = {
  readonly actorId: string;
  readonly orgId: string;
} & (
  | { readonly status: 'ready'; readonly value: NotificationWorkerHealth }
  | { readonly status: 'unavailable' }
);

const HEALTH_STATES = new Set<NotificationHealthState>([
  'runnable',
  'stale',
  'absent',
  'catalog_invalid',
  'catalog_mismatch',
  'projection_unavailable',
  'build_unavailable',
  'startup_failed',
]);
const ADMISSION_CODES = new Set<NotificationAdmissionCode>([
  'catalog_invalid',
  'catalog_mismatch',
  'projection_unavailable',
  'build_unavailable',
  'startup_failed',
]);
const FAILURE_CODES = new Set<NotificationFailureCode>([
  'deadline',
  'statement_timeout',
  'lock_timeout',
  'database_unavailable',
  'projection_failed',
]);
const RESULTS = new Set<NotificationResult>(['completed', 'failed', 'unsupported', 'empty']);
const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const REVISION = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,63}$/;

function exactRecord(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid notification health response');
  }
  const value = raw as Record<string, unknown>;
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw new Error('Invalid notification health response');
  }
  return value;
}

function enumValue<T extends string>(raw: unknown, values: ReadonlySet<T>): T {
  if (typeof raw !== 'string' || !values.has(raw as T)) {
    throw new Error('Invalid notification health response');
  }
  return raw as T;
}

function nullablePattern(raw: unknown, pattern: RegExp): string | null {
  if (raw === null) return null;
  if (typeof raw !== 'string' || !pattern.test(raw)) {
    throw new Error('Invalid notification health response');
  }
  return raw;
}

function requiredPattern(raw: unknown, pattern: RegExp): string {
  const value = nullablePattern(raw, pattern);
  if (value === null) throw new Error('Invalid notification health response');
  return value;
}

function decodeAge(raw: unknown): NotificationHealthAge {
  const value = exactRecord(raw, ['ageMs', 'futureTimestamp']);
  if (typeof value.futureTimestamp !== 'boolean') {
    throw new Error('Invalid notification health response');
  }
  if (value.ageMs !== null) {
    if (
      typeof value.ageMs !== 'number' ||
      !Number.isSafeInteger(value.ageMs) ||
      value.ageMs < 0 ||
      value.futureTimestamp
    ) {
      throw new Error('Invalid notification health response');
    }
  }
  return { ageMs: value.ageMs as number | null, futureTimestamp: value.futureTimestamp };
}

function decodeQueue(raw: unknown): NotificationQueueHealth {
  const value = exactRecord(raw, ['count', 'lowerBound', 'oldest']);
  if (
    typeof value.count !== 'number' ||
    !Number.isInteger(value.count) ||
    value.count < 0 ||
    value.count > 5000 ||
    typeof value.lowerBound !== 'boolean' ||
    (value.lowerBound && value.count !== 5000)
  ) {
    throw new Error('Invalid notification health response');
  }
  return {
    count: value.count,
    lowerBound: value.lowerBound,
    oldest: decodeAge(value.oldest),
  };
}

function decodeIdentity(raw: unknown): NotificationWorkerIdentity {
  const value = exactRecord(raw, [
    'buildSha',
    'catalogRevision',
    'catalogSha256',
    'projectorRevision',
    'projectorSha256',
  ]);
  return {
    buildSha: requiredPattern(value.buildSha, SHA40),
    catalogRevision: requiredPattern(value.catalogRevision, REVISION),
    catalogSha256: requiredPattern(value.catalogSha256, SHA256),
    projectorRevision: requiredPattern(value.projectorRevision, REVISION),
    projectorSha256: requiredPattern(value.projectorSha256, SHA256),
  };
}

function decodeAdmission(raw: unknown): NotificationAdmissionObservation {
  const value = exactRecord(raw, [
    'checked',
    'code',
    'buildSha',
    'artifactSha256',
    'catalogRevision',
    'catalogSha256',
    'projectorRevision',
    'projectorSha256',
  ]);
  return {
    checked: decodeAge(value.checked),
    code: enumValue(value.code, ADMISSION_CODES),
    buildSha: nullablePattern(value.buildSha, SHA40),
    artifactSha256: nullablePattern(value.artifactSha256, SHA256),
    catalogRevision: nullablePattern(value.catalogRevision, REVISION),
    catalogSha256: nullablePattern(value.catalogSha256, SHA256),
    projectorRevision: nullablePattern(value.projectorRevision, REVISION),
    projectorSha256: nullablePattern(value.projectorSha256, SHA256),
  };
}

export function decodeNotificationWorkerHealth(raw: unknown): NotificationWorkerHealth {
  const value = exactRecord(raw, ['checkedAt', 'state', 'worker', 'organization', 'queue']);
  if (
    typeof value.checkedAt !== 'string' ||
    value.checkedAt.length > 40 ||
    !Number.isFinite(Date.parse(value.checkedAt))
  ) {
    throw new Error('Invalid notification health response');
  }
  const worker = exactRecord(value.worker, ['heartbeat', 'identity', 'admission']);
  const organization = exactRecord(value.organization, [
    'lastCompleted',
    'lastSuccess',
    'failureStreak',
    'lastFailureCode',
    'lastResult',
  ]);
  const queue = exactRecord(value.queue, ['pending', 'processing', 'unsupportedCatalogPending']);
  if (
    typeof organization.failureStreak !== 'number' ||
    !Number.isInteger(organization.failureStreak) ||
    organization.failureStreak < 0 ||
    organization.failureStreak > 4 ||
    typeof queue.unsupportedCatalogPending !== 'boolean'
  ) {
    throw new Error('Invalid notification health response');
  }
  const lastFailureCode =
    organization.lastFailureCode === null
      ? null
      : enumValue(organization.lastFailureCode, FAILURE_CODES);
  if ((organization.failureStreak === 0) !== (lastFailureCode === null)) {
    throw new Error('Invalid notification health response');
  }
  return {
    checkedAt: value.checkedAt,
    state: enumValue(value.state, HEALTH_STATES),
    worker: {
      heartbeat: decodeAge(worker.heartbeat),
      identity: worker.identity === null ? null : decodeIdentity(worker.identity),
      admission: worker.admission === null ? null : decodeAdmission(worker.admission),
    },
    organization: {
      lastCompleted: decodeAge(organization.lastCompleted),
      lastSuccess: decodeAge(organization.lastSuccess),
      failureStreak: organization.failureStreak as 0 | 1 | 2 | 3 | 4,
      lastFailureCode,
      lastResult:
        organization.lastResult === null ? null : enumValue(organization.lastResult, RESULTS),
    },
    queue: {
      pending: decodeQueue(queue.pending),
      processing: decodeQueue(queue.processing),
      unsupportedCatalogPending: queue.unsupportedCatalogPending,
    },
  };
}
