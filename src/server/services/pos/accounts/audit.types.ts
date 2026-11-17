/**
 * F7 audit DTOs (minion-meta spec 128), schemaVersion 1. Plain types only: no DB/network/app-alias
 * imports. TODO(handoff): classification/evidence/proposal DTOs (T015-T022) are not defined yet.
 */

/** Credential-free binding of an approved operator target (database identity + auth project/url). */
export type QualifiedOperatorTarget = Readonly<{
  databaseIdentity: string;
  authProject: string;
  authUrl: string;
}>;

/** `YYYY-MM-DD` real Gregorian date. Lower bound inclusive, upper bound exclusive, local midnight in the accounting timezone. */
export interface AuditInterval {
  after: string | null;
  before: string | null;
}

export interface AuditScope {
  orgId: string;
  /** Owner-approved IANA timezone; must equal fin_settings.timezone in the same snapshot. */
  accountingTimezone: string;
  /** U: the owner-approved interval. */
  approved: AuditInterval;
  /** C: optional narrower cohort inside U. */
  cohort: AuditInterval;
}

export type AuditSubjectKind = 'booking' | 'paid_unscheduled_line';

/** Raw facts of one subject in U; classification is added by T015+. */
export interface AuditSubject {
  schemaVersion: 1;
  kind: AuditSubjectKind;
  id: string;
  /** Canonical client key (`party:<uuid>` | `contact:<uuid>`) or null when the row has no identity. */
  clientKey: string | null;
  /** Booking status or parent ticket status. */
  status: string;
  /** Booking start_time or parent ticket submitted_at (ISO, UTC). */
  occurredAt: string;
  inCohort: boolean;
  /** Which canonical readers count this subject. */
  counted: { badge: boolean; list: boolean };
}

export type AuditControlName = 'badgePaidLines' | 'unbilledBookings' | 'listPendingLines';

export interface AuditControl {
  count: number;
  cohortCount: number;
  complementCount: number;
  /** First 100 ids in ascending id order. */
  sampleIds: string[];
  /** SHA-256 of the ascending ids joined by "\n". */
  idsSha256: string;
}

export type AuditResidualControl = 'badge_not_list' | 'list_not_badge';

/** One subject where the badge and the list disagree; streamed, never accumulated beyond the 100-id sample. */
export interface ResidualRecord {
  schemaVersion: 1;
  control: AuditResidualControl;
  subjectKind: AuditSubjectKind;
  id: string;
  inCohort: boolean;
  /** identity_required: counted by the badge only (no identity). legacy_voided: counted by the list only. */
  reasonCode: 'identity_required' | 'legacy_voided';
}

export interface AuditSummary {
  schemaVersion: 1;
  orgId: string;
  coverage: 'organization_all_date' | 'approved_scope';
  accountingTimezone: string;
  approved: AuditInterval;
  cohort: AuditInterval;
  subjectCount: number;
  cohortSubjectCount: number;
  controls: Record<AuditControlName, AuditControl>;
  /** badge = badgePaidLines + unbilledBookings; list = listPendingLines + unbilledBookings. */
  totals: { badge: number; list: number };
  residualCounts: Record<AuditResidualControl, number>;
}

/** Awaited sinks: a rejection aborts the run (exit 3, incomplete staging). */
export interface AuditSink {
  writeSubject(subject: AuditSubject): Promise<void>;
  writeResidual(residual: ResidualRecord): Promise<void>;
}

/** Admission refusals (exit 2) versus incomplete runs (exit 3). */
export class AuditAdmissionError extends Error {
  constructor(readonly code: string) {
    super(`audit admission refused: ${code}`);
    this.name = 'AuditAdmissionError';
  }
}
export class AuditIncompleteError extends Error {
  constructor(readonly code: string) {
    super(`audit incomplete: ${code}`);
    this.name = 'AuditIncompleteError';
  }
}
