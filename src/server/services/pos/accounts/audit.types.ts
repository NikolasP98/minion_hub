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

// ---- Classification (T015/T016) ----------------------------------------------------------------
export type PrimaryClassification =
  | 'inactive'
  | 'free'
  | 'paid-but-unlinked candidate'
  | 'genuine-debt candidate'
  | 'unused-reservation candidate'
  | 'stale-lifecycle candidate'
  | 'unresolved';
export type NextAction = 'none' | 'review' | 'propose_link' | 'normal_collection_review';

export interface Classification {
  primaryClassification: PrimaryClassification;
  recommendedNextAction: NextAction;
  /** Sorted distinct. */
  reasonCodes: string[];
  /** Sorted distinct. */
  uncertainty: string[];
}

/** Result of the (pure) financial closure for one subject: which supported shape was proven, or why not. */
export interface ClosureFacts {
  /** A: complete all-date closure with no stored settlement. B: exactly one fully settled ordinary one-line ticket. */
  shape: 'A' | 'B' | 'none';
  /** Closed blocker codes when shape is 'none' (e.g. partial_or_excess_settlement_unsupported). */
  blockers: string[];
}

/** Shared global-check inputs (unknown source, identity, contradictory evidence). */
export interface GlobalFacts {
  sourceCorrupt: boolean;
  identity: 'ok' | 'unresolved' | 'conflict';
  evidenceConflict: boolean;
  /** Finite approved interval: no all-date closure, so no positive financial label. */
  finiteScope: boolean;
  closure: ClosureFacts;
  /** The exact full pair envelope qualifies (owner, C membership, evidence, stock clearance). */
  proposalEligible: boolean;
  /** Blocker codes when proposalEligible is false. */
  proposalBlockers: string[];
}

export interface BookingFacts extends GlobalFacts {
  status: string;
  /** Admitted positive historical_charge. */
  historicalCharge: boolean;
  /** Current resolved active catalog price is exactly 0. */
  currentCatalogFree: boolean;
  currentPriceKnown: boolean;
  /** Admitted matching service_delivery. */
  delivery: boolean;
  validUnused: boolean;
  validStale: boolean;
  /** Stale assertion whose observed equals claimed status. */
  staleNoChange: boolean;
}

export interface LineFacts extends GlobalFacts {
  ticketStatus: string;
  /** Stored line total is exactly 0, parent is a submitted one-line service ticket with total 0 and a proven-empty no-money closure. */
  zeroValueNoMoney: boolean;
}

// ---- Proposals (T019/T020): immutable intent, hashed; envelope fields never enter the hash ------
export interface AuditCurrencyBalanceMinor {
  currency: string;
  balanceMinor: string;
}
export interface AccountControlValue {
  pendingScheduling: number;
  pendingInvoice: number;
  logicalRowPresent: boolean;
  posCurrency: string;
  displayBalanceMinor: string;
}
export interface LinkIntent {
  schemaVersion: 1;
  orgId: string;
  sourceGitSha: string;
  pair: { ticketLineId: string; bookingMemberId: string };
  before: {
    ticket: {
      id: string;
      status: string;
      submittedAt: string;
      currency: string;
      total: string;
      invoiceProviderRef: string | null;
    };
    line: {
      id: string;
      ticketId: string;
      bookingId: string | null;
      productId: string | null;
      quantity: string;
      total: string;
      planId: string | null;
      redemptionId: string | null;
    };
    booking: {
      id: string;
      updatedAt: string;
      status: string;
      productId: string | null;
      startTime: string;
      invoiceId: string | null;
      grantId: string | null;
      planId: string | null;
    };
    identityKey: string;
    sourceFingerprint: string;
  };
  evidence: { assertionIds: string[]; documentHashes: string[]; assertionsHash: string };
  change: { field: 'pos_ticket_lines.booking_id'; from: null; to: string };
  effects: {
    paidUnscheduledDelta: -1;
    unbilledBookingDelta: -1 | 0;
    paymentMinorDelta: '0';
    stockQuantityDelta: '0';
    lifecycleChanges: [];
    wallet: {
      before: AuditCurrencyBalanceMinor[];
      after: AuditCurrencyBalanceMinor[];
      ledgerRowsDelta: 0;
    };
    accountDisplay: {
      before: AccountControlValue;
      after: AccountControlValue;
      visibleCappedRow: null;
      visibilityReason: 'not_predicted_limit_or_sort';
    };
  };
  accountControlSha256: string;
  blockers: [];
}
export interface RepairProposal {
  proposalId: string;
  runId: string;
  observedAt: string;
  proposalHash: string;
  status: 'pending_owner_approval';
  intent: LinkIntent;
  evidenceFileRefs: string[];
}

// ---- Invoice linkage closure (T017, contracts/invoice-linkage.md) -------------------------------
export interface AuditInvoiceRef {
  invoiceId: string;
  provider: string;
  providerRef: string;
  status: string | null;
  shadowed: boolean;
}
export interface BookingInvoiceLink {
  bookingId: string;
  /** Explicit booking->invoice id; non-null even when the target is missing. */
  explicitInvoiceId: string | null;
  explicitResolved: boolean;
  /** Direct same-org ticket lines that reference this booking (live, void and voided kept). */
  ticketLineIds: string[];
  /** Tickets of those lines carrying a nonempty invoice_provider_ref, with every exact byte-equal match. */
  providerMatches: { ticketId: string; providerRef: string; matches: AuditInvoiceRef[] }[];
}
export interface TicketInvoiceLink {
  ticketId: string;
  providerRef: string | null;
  matches: AuditInvoiceRef[];
  /** none | one_nonshadowed (via ticket_provider_ref) | ambiguous (several, or only shadowed) | unresolved (ref set, no match). */
  state: 'none' | 'one_nonshadowed' | 'ambiguous' | 'unresolved';
}
