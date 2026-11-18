import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  admitEvidence,
  bookingEvidenceFacts,
  EvidenceInputError,
  type AdmissionContext,
} from './audit.evidence';

const ORG = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const BOOKING = '33333333-3333-4333-8333-333333333333';
const PRODUCT = '44444444-4444-4444-8444-444444444444';
const DOC = '55555555-5555-4555-8555-555555555555';
const RUN = '2026-11-17T12:00:00.000Z';
const ctx = (over: Partial<AdmissionContext> = {}): AdmissionContext => ({
  orgId: ORG,
  approvalRef: 'ap-1',
  actorProfileId: ACTOR,
  membershipRole: 'owner',
  runStart: RUN,
  bookingStatus: (id) => (id === BOOKING ? 'accepted' : null),
  lineKnown: () => false,
  ...over,
});
const assertion = (
  kind: string,
  values: Record<string, unknown>,
  over: Record<string, unknown> = {},
) => ({
  assertionId: randomUUID(),
  subject: { kind: 'booking', id: BOOKING },
  kind,
  values,
  documentIds: [DOC],
  verifiedByProfileId: ACTOR,
  verifiedAt: '2026-11-16T00:00:00.000Z',
  ...over,
});
const delivery = () =>
  assertion('service_delivery', {
    bookingMemberId: BOOKING,
    productId: PRODUCT,
    quantity: '1',
    deliveredAt: '2026-05-10T15:00:00.000Z',
  });
const unused = () =>
  assertion('unused_reservation', {
    bookingMemberId: BOOKING,
    used: false,
    asOf: '2026-11-01T00:00:00.000Z',
  });
const stale = (observed: string, claimed: string) =>
  assertion('stale_lifecycle', {
    bookingMemberId: BOOKING,
    observedStatus: observed,
    claimedStatus: claimed,
    asOf: '2026-11-01T00:00:00.000Z',
  });
const charge = (amount = '100.00') =>
  assertion('historical_charge', {
    bookingMemberId: BOOKING,
    productId: PRODUCT,
    quantity: '1',
    amount,
    currency: 'PEN',
    agreedAt: '2026-05-01T00:00:00.000Z',
  });

function admit(assertions: ReturnType<typeof assertion>[], c = ctx(), approveAll = true) {
  const manifest = {
    schemaVersion: 1,
    orgId: ORG,
    approvalRef: 'ap-1',
    documents: [{ documentId: DOC, sha256: 'a'.repeat(64), privateRef: 'vault/doc1' }],
    assertions,
  };
  const bytes = JSON.stringify(manifest);
  return admitEvidence(
    manifest,
    bytes,
    {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      approvedAssertionIds: approveAll ? assertions.map((a) => a.assertionId) : [],
    },
    c,
  );
}
const refused = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(EvidenceInputError);
    expect((e as EvidenceInputError).code).toBe(code);
    return;
  }
  throw new Error('expected refusal');
};

describe('admitEvidence (exit-2 input failures)', () => {
  it('admits an approved matched manifest and hashes content without private paths', () => {
    const a = admit([delivery(), charge()]);
    expect(a.assertions).toHaveLength(2);
    expect(a.documentHashes).toEqual(['a'.repeat(64)]);
    expect(a.assertionsHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('requires the actual owner membership, not a capable non-owner', () => {
    refused(
      () => admit([delivery()], ctx({ membershipRole: 'admin' })),
      'owner_required_for_evidence',
    );
    refused(
      () => admit([delivery()], ctx({ membershipRole: null })),
      'owner_required_for_evidence',
    );
  });
  it('refuses a hash mismatch, another verifier, a future instant, an unapproved-missing id and an unknown subject', () => {
    const d = delivery();
    const manifest = {
      schemaVersion: 1,
      orgId: ORG,
      approvalRef: 'ap-1',
      documents: [{ documentId: DOC, sha256: 'a'.repeat(64), privateRef: 'r' }],
      assertions: [d],
    };
    refused(
      () =>
        admitEvidence(
          manifest,
          'tampered',
          { sha256: 'b'.repeat(64), approvedAssertionIds: [d.assertionId] },
          ctx(),
        ),
      'evidence_hash_mismatch',
    );
    refused(
      () => admit([assertion('service_delivery', d.values, { verifiedByProfileId: randomUUID() })]),
      'verifier_is_not_the_executing_owner',
    );
    refused(
      () =>
        admit([
          assertion('service_delivery', d.values, { verifiedAt: '2027-01-01T00:00:00.000Z' }),
        ]),
      'instant_after_allowed_time',
    );
    // An approved id absent from the manifest is refused.
    const manifest2 = {
      schemaVersion: 1,
      orgId: ORG,
      approvalRef: 'ap-1',
      documents: [{ documentId: DOC, sha256: 'a'.repeat(64), privateRef: 'r' }],
      assertions: [d],
    };
    const bytes2 = JSON.stringify(manifest2);
    refused(
      () =>
        admitEvidence(
          manifest,
          bytes2,
          {
            sha256: createHash('sha256').update(bytes2).digest('hex'),
            approvedAssertionIds: [d.assertionId, randomUUID()],
          },
          ctx(),
        ),
      'approved_assertion_missing',
    );
  });
  it('refuses unknown kinds, extra keys, wrong subject kinds (V16) and unknown statuses (V12)', () => {
    refused(() => admit([assertion('mystery', {})]), 'unknown_kind');
    refused(
      () => admit([assertion('service_delivery', { ...delivery().values, extra: 1 })]),
      'unknown_or_missing_key',
    );
    refused(
      () =>
        admit(
          [
            assertion(
              'unused_reservation',
              { bookingMemberId: BOOKING, used: false, asOf: '2026-11-01T00:00:00.000Z' },
              { subject: { kind: 'paid_unscheduled_line', id: randomUUID() } },
            ),
          ],
          ctx({ lineKnown: () => true }),
        ),
      'wrong_subject_kind',
    );
    refused(() => admit([stale('accepted', 'bogus')]), 'unknown_status');
    refused(() => admit([charge('0')]), 'invalid_amount');
  });
});

describe('bookingEvidenceFacts', () => {
  const facts = (as: ReturnType<typeof assertion>[], status = 'accepted') =>
    bookingEvidenceFacts(admit(as), BOOKING, status);
  it('V9 unused only, stale only and both are nonconflicting', () => {
    expect(facts([unused()])).toMatchObject({
      validUnused: true,
      validStale: false,
      evidenceConflict: false,
    });
    expect(facts([stale('accepted', 'completed')])).toMatchObject({
      validStale: true,
      evidenceConflict: false,
    });
    expect(facts([unused(), stale('accepted', 'completed')])).toMatchObject({
      validUnused: true,
      validStale: true,
    });
  });
  it('V10 delivery plus unused, or an observed status that differs from the snapshot, is a conflict', () => {
    expect(facts([delivery(), unused()]).evidenceConflict).toBe(true);
    expect(facts([stale('completed', 'cancelled')]).evidenceConflict).toBe(true);
  });
  it('V11 observed == claimed == snapshot is no-change, not stale', () => {
    expect(facts([stale('accepted', 'accepted')])).toMatchObject({
      validStale: false,
      staleNoChange: true,
      evidenceConflict: false,
    });
  });
  it('contradictory historical charges are a conflict, never "newest wins"', () => {
    expect(facts([charge('100.00'), charge('120.00')]).evidenceConflict).toBe(true);
    expect(facts([charge('100.00')])).toMatchObject({
      historicalCharge: true,
      evidenceConflict: false,
    });
  });
});
