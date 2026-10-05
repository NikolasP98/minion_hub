import { UUID_PATTERN } from '$lib/notifications/fields';

export type RuntimeIdentity = Readonly<{
  ownerId: string;
  buildSha: string;
  catalogRevision: string;
  catalogSha256: string;
  projectorRevision: string;
  projectorSha256: string;
}>;
export type RuntimeLease = RuntimeIdentity & Readonly<{ generation: string; expiresAt: string }>;
export type OrganizationLease = Readonly<{
  organizationId: string;
  ownerId: string;
  generation: string;
  expiresAt: string;
  hardDeadline: string;
  /** Process-local conservative deadline captured before the database claim query. */
  hardDeadlineMonotonic: number;
}>;
export const ADMISSION_FAILURES = [
  'catalog_invalid',
  'catalog_mismatch',
  'projection_unavailable',
  'build_unavailable',
  'startup_failed',
] as const;
export type AdmissionFailure = (typeof ADMISSION_FAILURES)[number];
export type AdmissionObservation = Readonly<{
  ownerId: string;
  code: AdmissionFailure;
  buildSha: string | null;
  artifactSha256: string | null;
  catalogRevision: string | null;
  catalogSha256: string | null;
  projectorRevision: string | null;
  projectorSha256: string | null;
}>;
export const ORG_FAILURES = [
  'deadline',
  'statement_timeout',
  'lock_timeout',
  'database_unavailable',
  'projection_failed',
] as const;
export type OrganizationFailure = (typeof ORG_FAILURES)[number];
export type OrganizationResult =
  | Readonly<{ result: 'completed' | 'empty' | 'unsupported' }>
  | Readonly<{ result: 'failed'; reason: OrganizationFailure }>;

export function assertRuntimeIdentity(value: RuntimeIdentity): void {
  if (
    !UUID_PATTERN.test(value.ownerId) ||
    !/^[a-f0-9]{40}$/.test(value.buildSha) ||
    !/^[a-f0-9]{64}$/.test(value.catalogSha256) ||
    !/^[a-f0-9]{64}$/.test(value.projectorSha256) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:+-]{0,63}$/.test(value.catalogRevision) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:+-]{0,63}$/.test(value.projectorRevision)
  ) {
    throw new Error('Invalid notification runtime identity');
  }
}
export function assertGeneration(value: string): void {
  if (!/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n)
    throw new Error('Invalid notification lease generation');
}
export function assertRuntimeLease(value: RuntimeLease): void {
  assertRuntimeIdentity(value);
  assertGeneration(value.generation);
}
export function assertOrganizationLease(value: OrganizationLease, runtime: RuntimeLease): void {
  assertRuntimeLease(runtime);
  if (!UUID_PATTERN.test(value.organizationId) || value.ownerId !== runtime.ownerId)
    throw new Error('Invalid notification organization lease');
  assertGeneration(value.generation);
}

/** Durable state is never reset or guessed when its schema/counter is unavailable. */
export class NotificationSchedulerUnavailable extends Error {
  readonly code = 'notification_scheduler_unavailable';
  constructor(readonly reason: 'state_missing' | 'generation_exhausted' | 'state_invalid') {
    super('Notification scheduler state is unavailable');
    this.name = 'NotificationSchedulerUnavailable';
  }
}
export function assertGenerationCanAdvance(value: string): void {
  if (!/^(0|[1-9][0-9]{0,18})$/.test(value))
    throw new NotificationSchedulerUnavailable('state_invalid');
  if (BigInt(value) >= 9223372036854775807n)
    throw new NotificationSchedulerUnavailable('generation_exhausted');
}
