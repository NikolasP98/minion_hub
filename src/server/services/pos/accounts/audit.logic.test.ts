import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  assertInterval,
  buildProposal,
  canonicalIntentJson,
  proposalHashOf,
  proposalIdOf,
  sortProposals,
  classifyBooking,
  classifyLine,
  ControlAccumulator,
  intervalContained,
  isRealDate,
} from './audit.logic';
import type { BookingFacts, ClosureFacts, GlobalFacts, LineFacts, LinkIntent } from './audit.types';

describe('audit dates and intervals', () => {
  it.each([
    ['2026-02-28', true],
    ['2024-02-29', true],
    ['2026-02-30', false],
    ['2026-13-01', false],
    ['01/02/2026', false],
    ['2026-2-1', false],
  ])('isRealDate(%s)=%s', (value, expected) => expect(isRealDate(value)).toBe(expected));

  it('rejects equal or inverted finite bounds and impossible dates', () => {
    expect(() => assertInterval({ after: '2026-05-01', before: '2026-05-01' }, 'u')).toThrow();
    expect(() => assertInterval({ after: '2026-05-02', before: '2026-05-01' }, 'u')).toThrow();
    expect(() => assertInterval({ after: '2026-02-30', before: null }, 'u')).toThrow();
    expect(() => assertInterval({ after: '2026-05-01', before: '2026-05-02' }, 'u')).not.toThrow();
    expect(() => assertInterval({ after: null, before: null }, 'u')).not.toThrow();
  });

  it('allows a same-day cohort [D, D+1) and refuses widening', () => {
    const approved = { after: '2026-05-01', before: '2026-06-01' };
    expect(intervalContained({ after: '2026-05-10', before: '2026-05-11' }, approved)).toBe(true);
    expect(intervalContained({ after: '2026-04-30', before: '2026-05-11' }, approved)).toBe(false);
    expect(intervalContained({ after: null, before: '2026-05-11' }, approved)).toBe(false);
    expect(intervalContained({ after: '2026-05-10', before: null }, approved)).toBe(false);
    expect(intervalContained({ after: null, before: null }, { after: null, before: null })).toBe(
      true,
    );
    expect(
      intervalContained({ after: '2026-05-10', before: null }, { after: null, before: null }),
    ).toBe(true);
  });
});

describe('ControlAccumulator', () => {
  it('counts rows, splits cohort and complement, samples 100 ids and hashes in order', () => {
    const ids = Array.from({ length: 150 }, (_, i) => `id-${String(i).padStart(4, '0')}`);
    const acc = new ControlAccumulator();
    ids.forEach((id, i) => acc.add(id, i % 3 === 0));
    const control = acc.finish();
    expect(control.count).toBe(150);
    expect(control.cohortCount).toBe(50);
    expect(control.complementCount).toBe(100);
    expect(control.sampleIds).toEqual(ids.slice(0, 100));
    expect(control.idsSha256).toBe(createHash('sha256').update(ids.join('\n')).digest('hex'));
  });

  it('hashes an empty control as the empty digest and rejects unordered input', () => {
    expect(new ControlAccumulator().finish().idsSha256).toBe(
      createHash('sha256').update('').digest('hex'),
    );
    const acc = new ControlAccumulator();
    acc.add('b', true);
    expect(() => acc.add('a', true)).toThrow(/ascending/);
    expect(() => acc.add('b', true)).toThrow(/ascending/);
  });
});

const base: GlobalFacts = {
  sourceCorrupt: false,
  identity: 'ok',
  evidenceConflict: false,
  finiteScope: false,
  closure: { shape: 'none', blockers: [] },
  proposalEligible: false,
  proposalBlockers: [],
};
const booking = (over: Partial<BookingFacts> = {}): BookingFacts => ({
  ...base,
  status: 'accepted',
  historicalCharge: false,
  currentCatalogFree: false,
  currentPriceKnown: true,
  delivery: false,
  validUnused: false,
  validStale: false,
  staleNoChange: false,
  ...over,
});
const line = (over: Partial<LineFacts> = {}): LineFacts => ({
  ...base,
  ticketStatus: 'submitted',
  zeroValueNoMoney: false,
  ...over,
});
const A: ClosureFacts = { shape: 'A', blockers: [] };
const B: ClosureFacts = { shape: 'B', blockers: [] };

describe('classifyBooking (ordered table B1-B8, vectors V1-V11)', () => {
  it('V1 genuine debt despite a current-free catalog price', () => {
    expect(
      classifyBooking(
        booking({ historicalCharge: true, currentCatalogFree: true, delivery: true, closure: A }),
      ),
    ).toEqual({
      primaryClassification: 'genuine-debt candidate',
      recommendedNextAction: 'normal_collection_review',
      reasonCodes: [
        'current_catalog_price_differs',
        'historical_unpaid_charge',
        'no_stored_settlement',
      ],
      uncertainty: [],
    });
  });
  it('V2 missing delivery is unresolved with service_delivery_unverified', () => {
    const c = classifyBooking(booking({ historicalCharge: true, closure: A }));
    expect(c.primaryClassification).toBe('unresolved');
    expect(c.reasonCodes).toEqual(['historical_charge_unresolved', 'service_delivery_unverified']);
  });
  it('V3 shape B is paid-but-unlinked; the envelope decides propose_link versus review', () => {
    const review = classifyBooking(
      booking({ historicalCharge: true, closure: B, proposalBlockers: ['missing_pair_evidence'] }),
    );
    expect(review).toMatchObject({
      primaryClassification: 'paid-but-unlinked candidate',
      recommendedNextAction: 'review',
      uncertainty: ['missing_pair_evidence'],
    });
    expect(review.reasonCodes).toContain('proposal_not_eligible');
    const proposed = classifyBooking(
      booking({ historicalCharge: true, closure: B, proposalEligible: true }),
    );
    expect(proposed).toMatchObject({ recommendedNextAction: 'propose_link', uncertainty: [] });
  });
  it('V4 finite U never reaches a positive label', () => {
    const c = classifyBooking(
      booking({ historicalCharge: true, delivery: true, closure: A, finiteScope: true }),
    );
    expect(c.primaryClassification).toBe('unresolved');
    expect(c.reasonCodes).toContain('settlement_scope_incomplete');
  });
  it('V5 each unsupported closure stays unresolved with its blocker', () => {
    for (const blocker of [
      'partial_or_excess_settlement_unsupported',
      'refund_or_correction_unsupported',
      'wallet_allocation_unsupported',
      'invoice_settlement_unsupported',
    ]) {
      const c = classifyBooking(
        booking({
          historicalCharge: true,
          delivery: true,
          closure: { shape: 'none', blockers: [blocker] },
        }),
      );
      expect(c).toMatchObject({
        primaryClassification: 'unresolved',
        recommendedNextAction: 'review',
      });
      expect(c.reasonCodes).toContain(blocker);
    }
  });
  it('V6 evidence-free current-free booking is free', () => {
    expect(classifyBooking(booking({ currentCatalogFree: true }))).toMatchObject({
      primaryClassification: 'free',
      recommendedNextAction: 'none',
      reasonCodes: ['current_catalog_free'],
      uncertainty: ['historical_charge_unverified'],
    });
  });
  it('V7 current-free with H and unsupported closure is B4, not free', () => {
    expect(
      classifyBooking(booking({ historicalCharge: true, currentCatalogFree: true }))
        .primaryClassification,
    ).toBe('unresolved');
  });
  it('V8 inactive wins over free/history; a global conflict wins over inactive', () => {
    const c = classifyBooking(
      booking({ status: 'cancelled', historicalCharge: true, currentCatalogFree: true }),
    );
    expect(c).toMatchObject({
      primaryClassification: 'inactive',
      recommendedNextAction: 'none',
      uncertainty: ['historical_charge_unresolved'],
    });
    expect(c.reasonCodes).toEqual(['historical_charge_on_inactive', 'inactive_booking']);
    expect(
      classifyBooking(booking({ status: 'cancelled', evidenceConflict: true })).reasonCodes,
    ).toEqual(['external_evidence_conflict']);
  });
  it('V9 unused, stale and both', () => {
    expect(classifyBooking(booking({ validUnused: true })).primaryClassification).toBe(
      'unused-reservation candidate',
    );
    expect(classifyBooking(booking({ validStale: true })).primaryClassification).toBe(
      'stale-lifecycle candidate',
    );
    const both = classifyBooking(booking({ validUnused: true, validStale: true }));
    expect(both.primaryClassification).toBe('unused-reservation candidate');
    expect(both.reasonCodes).toEqual(['stale_lifecycle_attested', 'unused_reservation_attested']);
  });
  it('V10/V11 conflicts are global; observed==claimed is B8 with stale_assertion_no_change', () => {
    expect(
      classifyBooking(booking({ evidenceConflict: true, validUnused: true })).reasonCodes,
    ).toEqual(['external_evidence_conflict']);
    const c = classifyBooking(booking({ staleNoChange: true }));
    expect(c.primaryClassification).toBe('unresolved');
    expect(c.reasonCodes).toContain('stale_assertion_no_change');
  });
  it('B8 reports unknown price and unverified delivery; unknown status and identity are global', () => {
    expect(classifyBooking(booking({ currentPriceKnown: false })).reasonCodes).toEqual([
      'current_price_unknown',
      'historical_charge_unverified',
      'service_delivery_unverified',
    ]);
    expect(classifyBooking(booking({ status: 'weird' })).reasonCodes).toEqual(['source_corrupt']);
    expect(classifyBooking(booking({ identity: 'unresolved' })).reasonCodes).toEqual([
      'identity_unresolved',
    ]);
    expect(classifyBooking(booking({ identity: 'conflict' })).reasonCodes).toEqual([
      'identity_conflict',
    ]);
  });
  it('funding facets block A/B through the closure blocker', () => {
    const c = classifyBooking(
      booking({
        historicalCharge: true,
        delivery: true,
        closure: { shape: 'none', blockers: ['funding_allocation_unsupported'] },
      }),
    );
    expect(c.reasonCodes).toContain('funding_allocation_unsupported');
  });
});

describe('classifyLine (ordered table L1-L4, vectors V13-V15)', () => {
  it('V15 void and legacy voided are inactive; known-zero is free; finite U cannot prove zero', () => {
    expect(classifyLine(line({ ticketStatus: 'voided' }))).toMatchObject({
      primaryClassification: 'inactive',
      recommendedNextAction: 'none',
    });
    expect(classifyLine(line({ ticketStatus: 'void' })).reasonCodes).toEqual(['inactive_ticket']);
    expect(classifyLine(line({ zeroValueNoMoney: true })).primaryClassification).toBe('free');
    expect(
      classifyLine(line({ zeroValueNoMoney: true, finiteScope: true })).primaryClassification,
    ).toBe('unresolved');
  });
  it('V13 complete shape B is review without the envelope and propose_link with it', () => {
    expect(classifyLine(line({ closure: B }))).toMatchObject({
      recommendedNextAction: 'review',
      uncertainty: ['missing_pair_evidence'],
    });
    expect(classifyLine(line({ closure: B, proposalEligible: true }))).toMatchObject({
      recommendedNextAction: 'propose_link',
      uncertainty: [],
    });
  });
  it('V14 everything else is L4; a partial payment is never a debt; identity conflict wins', () => {
    const c = classifyLine(
      line({ closure: { shape: 'none', blockers: ['partial_or_excess_settlement_unsupported'] } }),
    );
    expect(c).toMatchObject({
      primaryClassification: 'unresolved',
      recommendedNextAction: 'review',
    });
    expect(c.reasonCodes).toEqual([
      'partial_or_excess_settlement_unsupported',
      'payment_settlement_unverified',
    ]);
    expect(classifyLine(line({ closure: B, identity: 'conflict' })).reasonCodes).toEqual([
      'identity_conflict',
    ]);
  });
});

const intent = (over: Partial<LinkIntent> = {}): LinkIntent => ({
  schemaVersion: 1,
  orgId: '11111111-1111-4111-8111-111111111111',
  sourceGitSha: 'c'.repeat(40),
  pair: {
    ticketLineId: 'aaaaaaaa-0000-4000-8000-000000000001',
    bookingMemberId: 'bbbbbbbb-0000-4000-8000-000000000001',
  },
  before: {
    ticket: {
      id: 't',
      status: 'submitted',
      submittedAt: '2026-05-10T15:00:00.000Z',
      currency: 'PEN',
      total: '10000',
      invoiceProviderRef: null,
    },
    line: {
      id: 'l',
      ticketId: 't',
      bookingId: null,
      productId: 'p',
      quantity: '1.0000',
      total: '10000',
      planId: null,
      redemptionId: null,
    },
    booking: {
      id: 'b',
      updatedAt: '2026-05-10T15:00:00.000Z',
      status: 'accepted',
      productId: 'p',
      startTime: '2026-05-10T15:00:00.000Z',
      invoiceId: null,
      grantId: null,
      planId: null,
    },
    identityKey: 'party:x',
    sourceFingerprint: 'f'.repeat(64),
  },
  evidence: {
    assertionIds: ['2', '1', '1'],
    documentHashes: ['b', 'a'],
    assertionsHash: 'h'.repeat(64),
  },
  change: { field: 'pos_ticket_lines.booking_id', from: null, to: 'b' },
  effects: {
    paidUnscheduledDelta: -1,
    unbilledBookingDelta: -1,
    paymentMinorDelta: '0',
    stockQuantityDelta: '0',
    lifecycleChanges: [],
    wallet: { before: [], after: [], ledgerRowsDelta: 0 },
    accountDisplay: {
      before: {
        pendingScheduling: 1,
        pendingInvoice: 1,
        logicalRowPresent: true,
        posCurrency: 'PEN',
        displayBalanceMinor: '0',
      },
      after: {
        pendingScheduling: 0,
        pendingInvoice: 0,
        logicalRowPresent: false,
        posCurrency: 'PEN',
        displayBalanceMinor: '0',
      },
      visibleCappedRow: null,
      visibilityReason: 'not_predicted_limit_or_sort',
    },
  },
  accountControlSha256: 'a'.repeat(64),
  blockers: [],
  ...over,
});

describe('proposal identity', () => {
  it('sorts keys recursively and dedupes/sorts set-like evidence arrays', () => {
    const json = canonicalIntentJson(intent());
    expect(json).not.toMatch(/\s/);
    expect(json.indexOf('"accountControlSha256"')).toBeLessThan(json.indexOf('"blockers"'));
    expect(json).toContain('"assertionIds":["1","2"]');
    expect(json).toContain('"documentHashes":["a","b"]');
  });
  it('two fresh runs with different run metadata give equal bytes, hash and UUID', () => {
    const a = buildProposal(intent(), { runId: 'r1', observedAt: '2026-11-17T00:00:00.000Z' }, [
      '/p/z',
      '/p/a',
    ]);
    const b = buildProposal(intent(), { runId: 'r2', observedAt: '2027-01-01T00:00:00.000Z' });
    expect(a.proposalHash).toBe(b.proposalHash);
    expect(a.proposalId).toBe(b.proposalId);
    expect(a.proposalId).toBe(proposalIdOf(a.proposalHash));
    expect(a.status).toBe('pending_owner_approval');
    expect(a.evidenceFileRefs).toEqual(['/p/a', '/p/z']);
  });
  it('a changed business fact or evidence changes the identity; reordered evidence does not', () => {
    const base = proposalHashOf(intent());
    expect(
      proposalHashOf(
        intent({
          evidence: {
            assertionIds: ['1', '2'],
            documentHashes: ['a', 'b'],
            assertionsHash: 'h'.repeat(64),
          },
        }),
      ),
    ).toBe(base);
    expect(proposalHashOf(intent({ accountControlSha256: 'b'.repeat(64) }))).not.toBe(base);
    expect(
      proposalHashOf(
        intent({
          evidence: {
            assertionIds: ['1'],
            documentHashes: ['a', 'b'],
            assertionsHash: 'h'.repeat(64),
          },
        }),
      ),
    ).not.toBe(base);
  });
  it('sorts by (line, member, hash) and refuses a UUID collision with a different hash', () => {
    const p1 = buildProposal(intent({ pair: { ticketLineId: 'b', bookingMemberId: 'x' } }), {
      runId: 'r',
      observedAt: 'o',
    });
    const p2 = buildProposal(intent({ pair: { ticketLineId: 'a', bookingMemberId: 'x' } }), {
      runId: 'r',
      observedAt: 'o',
    });
    expect(sortProposals([p1, p2]).map((p) => p.intent.pair.ticketLineId)).toEqual(['a', 'b']);
    expect(() => sortProposals([p1, { ...p1, proposalHash: 'different' }])).toThrow(/collision/);
  });
});
