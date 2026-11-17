import { createHash } from 'node:crypto';
import { uuidv5 } from '../../../utils/uuid-v5';
import type {
  AuditControl,
  AuditInterval,
  BookingFacts,
  Classification,
  GlobalFacts,
  LineFacts,
  LinkIntent,
  NextAction,
  PrimaryClassification,
  RepairProposal,
} from './audit.types';

const SAMPLE = 100;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Real Gregorian date check (rejects 2026-02-30 and locale strings). */
export function isRealDate(value: string): boolean {
  const m = DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** Validates one interval: real dates, after < before when both finite. Throws a credential-free message. */
export function assertInterval(interval: AuditInterval, label: string): void {
  for (const bound of [interval.after, interval.before]) {
    if (bound !== null && !isRealDate(bound)) throw new Error(`${label}: invalid date`);
  }
  if (interval.after !== null && interval.before !== null && interval.after >= interval.before) {
    throw new Error(`${label}: empty or inverted interval`);
  }
}

/** True when `inner` lies inside `outer` (null = unbounded). Widening is refused by the caller, never clamped. */
export function intervalContained(inner: AuditInterval, outer: AuditInterval): boolean {
  const lowerOk = outer.after === null || (inner.after !== null && inner.after >= outer.after);
  const upperOk = outer.before === null || (inner.before !== null && inner.before <= outer.before);
  return lowerOk && upperOk;
}

/** Streaming control accumulator: ids must arrive in ascending order; keeps a 100-id sample and a running hash. */
export class ControlAccumulator {
  private count = 0;
  private cohort = 0;
  private sample: string[] = [];
  private hash = createHash('sha256');
  private last: string | null = null;

  add(id: string, inCohort: boolean): void {
    if (this.last !== null && id <= this.last)
      throw new Error('control ids must be strictly ascending');
    this.last = id;
    this.hash.update(this.count === 0 ? id : `\n${id}`);
    this.count += 1;
    if (inCohort) this.cohort += 1;
    if (this.sample.length < SAMPLE) this.sample.push(id);
  }

  finish(): AuditControl {
    return {
      count: this.count,
      cohortCount: this.cohort,
      complementCount: this.count - this.cohort,
      sampleIds: this.sample,
      idsSha256: this.hash.digest('hex'),
    };
  }
}

// ---- Exhaustive ordered classification (contracts/evidence-and-proposals.md) --------------------

const uniqueSorted = (codes: readonly string[]) => [...new Set(codes)].sort();
const result = (
  primaryClassification: PrimaryClassification,
  recommendedNextAction: NextAction,
  reasonCodes: readonly string[],
  uncertainty: readonly string[],
): Classification => ({
  primaryClassification,
  recommendedNextAction,
  reasonCodes: uniqueSorted(reasonCodes),
  uncertainty: uniqueSorted(uncertainty),
});

const BOOKING_STATUSES = new Set([
  'accepted',
  'pending',
  'completed',
  'cancelled',
  'rejected',
  'no_show',
]);
const INACTIVE_BOOKING = new Set(['cancelled', 'rejected', 'no_show']);

/** Global checks run before either table; the first failing check wins. */
function globalCheck(facts: GlobalFacts, statusKnown: boolean): Classification | null {
  if (!statusKnown || facts.sourceCorrupt)
    return result('unresolved', 'review', ['source_corrupt'], ['source_corrupt']);
  if (facts.identity === 'unresolved')
    return result('unresolved', 'review', ['identity_unresolved'], ['identity_unresolved']);
  if (facts.identity === 'conflict')
    return result('unresolved', 'review', ['identity_conflict'], ['identity_conflict']);
  if (facts.evidenceConflict) {
    return result(
      'unresolved',
      'review',
      ['external_evidence_conflict'],
      ['external_evidence_conflict'],
    );
  }
  return null;
}

export function classifyBooking(facts: BookingFacts): Classification {
  const blocked = globalCheck(facts, BOOKING_STATUSES.has(facts.status));
  if (blocked) return blocked;
  // Attested facets are retained on every branch without changing it.
  const facets = [
    ...(facts.validUnused ? ['unused_reservation_attested'] : []),
    ...(facts.validStale ? ['stale_lifecycle_attested'] : []),
    ...(facts.staleNoChange ? ['stale_assertion_no_change'] : []),
  ];
  const H = facts.historicalCharge;
  const differs = H && facts.currentCatalogFree ? ['current_catalog_price_differs'] : [];

  // B1
  if (INACTIVE_BOOKING.has(facts.status)) {
    return result(
      'inactive',
      'none',
      ['inactive_booking', ...(H ? ['historical_charge_on_inactive'] : []), ...facets],
      H ? ['historical_charge_unresolved'] : [],
    );
  }
  if (H) {
    const closure = facts.closure;
    // B2: finite U never reaches a positive label (all-date closure is forbidden there).
    if (closure.shape === 'B' && !facts.finiteScope) {
      const proposed = facts.proposalEligible;
      return result(
        'paid-but-unlinked candidate',
        proposed ? 'propose_link' : 'review',
        [
          'historical_charge_fully_settled',
          'stored_one_line_ticket_fully_settled',
          ...(proposed ? [] : ['proposal_not_eligible']),
          ...differs,
          ...facets,
        ],
        proposed ? [] : facts.proposalBlockers,
      );
    }
    // B3
    if (closure.shape === 'A' && !facts.finiteScope && facts.delivery) {
      return result(
        'genuine-debt candidate',
        'normal_collection_review',
        ['historical_unpaid_charge', 'no_stored_settlement', ...differs, ...facets],
        [],
      );
    }
    // B4
    const missing = [
      ...closure.blockers,
      ...(facts.finiteScope ? ['settlement_scope_incomplete'] : []),
      ...(closure.shape === 'A' && !facts.delivery ? ['service_delivery_unverified'] : []),
    ];
    return result(
      'unresolved',
      'review',
      ['historical_charge_unresolved', ...missing, ...differs, ...facets],
      missing,
    );
  }
  // B5
  if (facts.currentCatalogFree)
    return result(
      'free',
      'none',
      ['current_catalog_free', ...facets],
      ['historical_charge_unverified'],
    );
  // B6
  if (facts.validUnused)
    return result('unused-reservation candidate', 'review', facets, [
      'historical_charge_unverified',
    ]);
  // B7
  if (facts.validStale)
    return result('stale-lifecycle candidate', 'review', facets, ['historical_charge_unverified']);
  // B8
  const missing = [
    'historical_charge_unverified',
    ...(facts.currentPriceKnown ? [] : ['current_price_unknown']),
    ...(facts.delivery ? [] : ['service_delivery_unverified']),
  ];
  return result('unresolved', 'review', [...missing, ...facets], missing);
}

export function classifyLine(facts: LineFacts): Classification {
  const blocked = globalCheck(
    facts,
    ['submitted', 'void', 'voided', 'draft'].includes(facts.ticketStatus),
  );
  if (blocked) return blocked;
  // L1
  if (facts.ticketStatus === 'void' || facts.ticketStatus === 'voided')
    return result('inactive', 'none', ['inactive_ticket'], []);
  // L2 (finite U can never prove an empty closure)
  if (facts.zeroValueNoMoney && !facts.finiteScope)
    return result('free', 'none', ['zero_value_service_line'], []);
  // L3
  if (facts.closure.shape === 'B' && !facts.finiteScope) {
    const proposed = facts.proposalEligible;
    return result(
      'paid-but-unlinked candidate',
      proposed ? 'propose_link' : 'review',
      ['stored_one_line_ticket_fully_settled', ...(proposed ? [] : ['proposal_not_eligible'])],
      proposed
        ? []
        : facts.proposalBlockers.length
          ? facts.proposalBlockers
          : ['missing_pair_evidence'],
    );
  }
  // L4
  const missing = [
    ...facts.closure.blockers,
    ...(facts.finiteScope ? ['settlement_scope_incomplete'] : []),
    'payment_settlement_unverified',
  ];
  return result('unresolved', 'review', missing, missing);
}

// ---- Stable approval identity (T020) ------------------------------------------------------------

/** Fixed audit namespace (contracts/evidence-and-proposals.md). */
export const AUDIT_PROPOSAL_NAMESPACE = 'd0c65690-658b-5b7e-b470-b6beb074168f';

function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortedKeys(v)]),
    );
  }
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new Error('non-finite number in intent');
  return value;
}

/** Canonical UTF-8 JSON of an intent: set-like evidence arrays sorted and deduped, keys sorted, no whitespace. */
export function canonicalIntentJson(intent: LinkIntent): string {
  const normalized: LinkIntent = {
    ...intent,
    evidence: {
      ...intent.evidence,
      assertionIds: [...new Set(intent.evidence.assertionIds)].sort(),
      documentHashes: [...new Set(intent.evidence.documentHashes)].sort(),
    },
  };
  return JSON.stringify(sortedKeys(normalized));
}

export const proposalHashOf = (intent: LinkIntent) =>
  createHash('sha256').update(canonicalIntentJson(intent), 'utf8').digest('hex');
export const proposalIdOf = (proposalHash: string) =>
  uuidv5(proposalHash, AUDIT_PROPOSAL_NAMESPACE);

/** Run metadata wraps, never enters, the hashed intent. */
export function buildProposal(
  intent: LinkIntent,
  run: { runId: string; observedAt: string },
  evidenceFileRefs: readonly string[] = [],
): RepairProposal {
  const proposalHash = proposalHashOf(intent);
  return {
    proposalId: proposalIdOf(proposalHash),
    runId: run.runId,
    observedAt: run.observedAt,
    proposalHash,
    status: 'pending_owner_approval',
    intent,
    evidenceFileRefs: [...evidenceFileRefs].sort(),
  };
}

/** Sort `(ticketLineId, bookingMemberId, proposalHash)`; the same UUID with a different hash is a fatal integrity conflict. */
export function sortProposals(proposals: readonly RepairProposal[]): RepairProposal[] {
  const byId = new Map<string, string>();
  for (const p of proposals) {
    const seen = byId.get(p.proposalId);
    if (seen !== undefined && seen !== p.proposalHash)
      throw new Error('proposal id collision with a different hash');
    byId.set(p.proposalId, p.proposalHash);
  }
  const key = (p: RepairProposal) => [
    p.intent.pair.ticketLineId,
    p.intent.pair.bookingMemberId,
    p.proposalHash,
  ];
  return [...proposals].sort((a, b) => {
    const [ka, kb] = [key(a), key(b)];
    for (let i = 0; i < 3; i += 1) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
    return 0;
  });
}
