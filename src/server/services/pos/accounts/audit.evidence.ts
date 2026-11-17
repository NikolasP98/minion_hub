import { createHash } from 'node:crypto';

/**
 * Pure admission of the owner-approved external evidence manifest (contracts/evidence-and-proposals.md).
 * No DB/network. Syntax, wrong-subject and unknown-kind failures are `EvidenceInputError` (exit 2);
 * contradictory but valid assertions are reported as `conflictSubjects`, never resolved by recency.
 */
export class EvidenceInputError extends Error {
  constructor(readonly code: string) {
    super(`evidence input refused: ${code}`);
    this.name = 'EvidenceInputError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const QTY = /^(?=.{1,19}$)\d+(\.\d{1,4})?$/;
const MONEY = /^\d+(\.\d{1,2})?$/;
const STATUSES = new Set(['accepted', 'pending', 'completed', 'cancelled', 'rejected', 'no_show']);
const KINDS = [
  'identity_binding',
  'service_delivery',
  'historical_charge',
  'settlement_allocation',
  'unused_reservation',
  'stale_lifecycle',
  'stock_ownership_clearance',
] as const;
export type AssertionKind = (typeof KINDS)[number];

export interface ScopeEvidenceRef {
  sha256: string;
  approvedAssertionIds: string[];
}
export interface EvidenceAssertion {
  assertionId: string;
  subject: { kind: 'booking' | 'paid_unscheduled_line'; id: string };
  kind: AssertionKind;
  values: Record<string, unknown>;
  documentIds: string[];
  verifiedByProfileId: string;
  verifiedAt: string;
}
export interface EvidenceManifest {
  schemaVersion: 1;
  orgId: string;
  approvalRef: string;
  documents: { documentId: string; sha256: string; privateRef: string }[];
  assertions: EvidenceAssertion[];
}
export interface AdmissionContext {
  orgId: string;
  approvalRef: string;
  /** The executing owner principal: every verifier must equal it. */
  actorProfileId: string;
  /** Fresh organization_members.role from the report snapshot. */
  membershipRole: string | null;
  runStart: string;
  /** Snapshot lookups (same-org, in U). */
  bookingStatus(id: string): string | null;
  lineKnown(id: string): boolean;
}
export interface AdmittedEvidence {
  assertions: EvidenceAssertion[];
  /** SHA-256 of canonical admitted content including document hashes (never private paths). */
  assertionsHash: string;
  documentHashes: string[];
}
export interface BookingEvidenceFacts {
  delivery: boolean;
  validUnused: boolean;
  validStale: boolean;
  staleNoChange: boolean;
  historicalCharge: boolean;
  evidenceConflict: boolean;
}

const fail = (code: string): never => {
  throw new EvidenceInputError(code);
};
const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (o: Record<string, unknown>, keys: readonly string[]) => {
  if (Object.keys(o).length !== keys.length || keys.some((k) => !(k in o)))
    fail('unknown_or_missing_key');
};
const uuid = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : fail('invalid_uuid'));
const instant = (v: unknown, max: string) => {
  if (typeof v !== 'string' || !ISO.test(v) || Number.isNaN(Date.parse(v))) fail('invalid_instant');
  if (Date.parse(v as string) > Date.parse(max)) fail('instant_after_allowed_time');
  return v as string;
};
const qty = (v: unknown) =>
  typeof v === 'string' && QTY.test(v) && Number(v) > 0 ? v : fail('invalid_quantity');
const money = (v: unknown) =>
  typeof v === 'string' && MONEY.test(v) && Number(v) > 0 ? v : fail('invalid_amount');

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObj(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Per-kind exact `values` keys and value syntax; wrong subject kinds are input failures. */
function validateValues(a: EvidenceAssertion, runStart: string): void {
  const v = a.values;
  if (!isObj(v)) fail('invalid_values');
  switch (a.kind) {
    case 'identity_binding': {
      const keys = Object.keys(v);
      if (
        !keys.includes('clientKey') ||
        keys.some((k) => !['clientKey', 'ticketLineId', 'bookingMemberId'].includes(k))
      )
        fail('unknown_or_missing_key');
      if (typeof v.clientKey !== 'string' || !/^(party|contact):[0-9a-f-]{36}$/.test(v.clientKey))
        fail('invalid_client_key');
      if ('ticketLineId' in v) uuid(v.ticketLineId);
      if ('bookingMemberId' in v) uuid(v.bookingMemberId);
      return;
    }
    case 'service_delivery':
      exactKeys(v, ['bookingMemberId', 'productId', 'quantity', 'deliveredAt']);
      uuid(v.bookingMemberId);
      uuid(v.productId);
      qty(v.quantity);
      instant(v.deliveredAt, a.verifiedAt);
      return;
    case 'historical_charge':
      exactKeys(v, ['bookingMemberId', 'productId', 'quantity', 'amount', 'currency', 'agreedAt']);
      uuid(v.bookingMemberId);
      uuid(v.productId);
      qty(v.quantity);
      money(v.amount);
      instant(v.agreedAt, a.verifiedAt);
      if (typeof v.currency !== 'string' || !/^[A-Z]{3}$/.test(v.currency))
        fail('invalid_currency');
      return;
    case 'settlement_allocation': {
      exactKeys(v, [
        'ticketLineId',
        'bookingMemberId',
        'productId',
        'quantity',
        'amount',
        'currency',
        'paymentIds',
        'complete',
      ]);
      uuid(v.ticketLineId);
      uuid(v.bookingMemberId);
      uuid(v.productId);
      qty(v.quantity);
      money(v.amount);
      const ids = v.paymentIds;
      if (
        !Array.isArray(ids) ||
        ids.length < 1 ||
        ids.length > 20 ||
        new Set(ids).size !== ids.length
      )
        fail('invalid_payment_ids');
      (ids as unknown[]).forEach(uuid);
      if (v.complete !== true) fail('settlement_not_complete');
      return;
    }
    case 'unused_reservation':
      exactKeys(v, ['bookingMemberId', 'used', 'asOf']);
      uuid(v.bookingMemberId);
      instant(v.asOf, a.verifiedAt);
      if (v.used !== false) fail('unused_must_be_false');
      if (a.subject.kind !== 'booking' || a.subject.id !== v.bookingMemberId)
        fail('wrong_subject_kind');
      return;
    case 'stale_lifecycle':
      exactKeys(v, ['bookingMemberId', 'observedStatus', 'claimedStatus', 'asOf']);
      uuid(v.bookingMemberId);
      instant(v.asOf, a.verifiedAt);
      if (!STATUSES.has(v.observedStatus as string) || !STATUSES.has(v.claimedStatus as string))
        fail('unknown_status');
      if (a.subject.kind !== 'booking' || a.subject.id !== v.bookingMemberId)
        fail('wrong_subject_kind');
      return;
    case 'stock_ownership_clearance':
      exactKeys(v, ['ticketLineId', 'bookingMemberId', 'stockEffects', 'sourceFingerprint']);
      uuid(v.ticketLineId);
      uuid(v.bookingMemberId);
      if (v.stockEffects !== 'none' && v.stockEffects !== 'already_accounted')
        fail('invalid_stock_effects');
      if (typeof v.sourceFingerprint !== 'string' || !SHA.test(v.sourceFingerprint))
        fail('invalid_fingerprint');
      return;
  }
}

export function admitEvidence(
  raw: unknown,
  fileBytes: string,
  scope: ScopeEvidenceRef,
  ctx: AdmissionContext,
): AdmittedEvidence {
  // Evidence-bearing runs need the ACTUAL owner membership; a capable non-owner is refused.
  if (ctx.membershipRole !== 'owner') fail('owner_required_for_evidence');
  if (createHash('sha256').update(fileBytes).digest('hex') !== scope.sha256)
    fail('evidence_hash_mismatch');
  if (!isObj(raw)) fail('invalid_manifest');
  const m = raw as unknown as EvidenceManifest;
  exactKeys(raw, ['schemaVersion', 'orgId', 'approvalRef', 'documents', 'assertions']);
  if (m.schemaVersion !== 1 || m.orgId !== ctx.orgId || m.approvalRef !== ctx.approvalRef)
    fail('manifest_scope_mismatch');
  if (
    !Array.isArray(m.documents) ||
    !Array.isArray(m.assertions) ||
    m.documents.length > 1000 ||
    m.assertions.length > 1000
  )
    fail('manifest_limits');
  const docs = new Map<string, string>();
  for (const d of m.documents) {
    if (!isObj(d)) fail('invalid_document');
    exactKeys(d, ['documentId', 'sha256', 'privateRef']);
    uuid(d.documentId);
    if (
      !SHA.test(d.sha256) ||
      typeof d.privateRef !== 'string' ||
      d.privateRef.trim().length < 1 ||
      d.privateRef.length > 256
    )
      fail('invalid_document');
    if (docs.has(d.documentId)) fail('duplicate_document');
    docs.set(d.documentId, d.sha256);
  }
  const ids = new Set<string>();
  const approved = new Set(scope.approvedAssertionIds);
  for (const a of m.assertions) {
    if (!isObj(a)) fail('invalid_assertion');
    exactKeys(a, [
      'assertionId',
      'subject',
      'kind',
      'values',
      'documentIds',
      'verifiedByProfileId',
      'verifiedAt',
    ]);
    uuid(a.assertionId);
    if (ids.has(a.assertionId)) fail('duplicate_assertion');
    ids.add(a.assertionId);
    if (!(KINDS as readonly string[]).includes(a.kind)) fail('unknown_kind');
    if (!isObj(a.subject)) fail('invalid_subject');
    exactKeys(a.subject, ['kind', 'id']);
    if (a.subject.kind !== 'booking' && a.subject.kind !== 'paid_unscheduled_line')
      fail('invalid_subject');
    uuid(a.subject.id);
    if (a.verifiedByProfileId !== ctx.actorProfileId) fail('verifier_is_not_the_executing_owner');
    instant(a.verifiedAt, ctx.runStart);
    if (
      !Array.isArray(a.documentIds) ||
      a.documentIds.length < 1 ||
      a.documentIds.length > 10 ||
      new Set(a.documentIds).size !== a.documentIds.length ||
      a.documentIds.some((id) => !docs.has(id))
    )
      fail('invalid_document_ids');
    const known =
      a.subject.kind === 'booking'
        ? ctx.bookingStatus(a.subject.id) !== null
        : ctx.lineKnown(a.subject.id);
    if (!known) fail('subject_not_in_scope');
    validateValues(a, ctx.runStart);
  }
  for (const id of approved) if (!ids.has(id)) fail('approved_assertion_missing');
  const admitted = m.assertions
    .filter((a) => approved.has(a.assertionId))
    .sort((a, b) => (a.assertionId < b.assertionId ? -1 : 1));
  const documentHashes = [
    ...new Set(admitted.flatMap((a) => a.documentIds.map((d) => docs.get(d)!))),
  ].sort();
  const assertionsHash = createHash('sha256')
    .update(
      canonical(
        admitted.map((a) => ({
          ...a,
          documentIds: undefined,
          documentHashes: a.documentIds.map((d) => docs.get(d)!).sort(),
        })),
      ),
    )
    .digest('hex');
  return { assertions: admitted, assertionsHash, documentHashes };
}

/** Per-booking facts feeding classifyBooking; contradictory valid assertions set evidenceConflict. */
export function bookingEvidenceFacts(
  admitted: AdmittedEvidence,
  bookingId: string,
  actualStatus: string,
): BookingEvidenceFacts {
  const mine = admitted.assertions.filter(
    (a) => a.subject.kind === 'booking' && a.subject.id === bookingId,
  );
  const of = (k: AssertionKind) => mine.filter((a) => a.kind === k);
  const delivery = of('service_delivery');
  const unused = of('unused_reservation');
  const stale = of('stale_lifecycle');
  const charges = of('historical_charge');
  const distinct = (xs: EvidenceAssertion[], pick: (a: EvidenceAssertion) => unknown) =>
    new Set(xs.map((a) => canonical(pick(a)))).size > 1;
  const strip = (a: EvidenceAssertion) => {
    const {
      bookingMemberId: _b,
      deliveredAt: _d,
      agreedAt: _g,
      asOf: _o,
      ...rest
    } = a.values as Record<string, unknown>;
    return rest;
  };
  let conflict =
    (delivery.length > 0 && unused.length > 0) ||
    distinct(delivery, strip) ||
    distinct(charges, strip) ||
    stale.some((a) => a.values.observedStatus !== actualStatus) ||
    distinct(stale, (a) => a.values.claimedStatus);
  const validStale = !conflict && stale.some((a) => a.values.claimedStatus !== actualStatus);
  const staleNoChange = !conflict && stale.some((a) => a.values.claimedStatus === actualStatus);
  conflict = conflict || false;
  return {
    delivery: delivery.length > 0 && !conflict,
    validUnused: unused.length > 0 && delivery.length === 0 && !conflict,
    validStale,
    staleNoChange,
    historicalCharge: charges.length > 0 && !conflict,
    evidenceConflict: conflict,
  };
}
