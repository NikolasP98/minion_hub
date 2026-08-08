/**
 * The software-factory gate ladder — Product → Architecture → Program Design →
 * Vertical Slices — DERIVED from GitHub state, never stored in the hub.
 *
 * The whole point of the workflow is that decisions are made before the code
 * exists and are visible to everyone. A hub-local approval flag would be a
 * second source of truth that `gh pr view` cannot see, so there is none: a
 * gate's state is a function of (PR files, PR labels, PR reviews), and the
 * decision the hub posts is a real GitHub review.
 *
 * Pure: no I/O, no dates from the clock. See
 * specs/2026-08-07-projects-github-repos-and-factory-gates-spec.md §4.3.
 */

export const GATE_IDS = ['product', 'architecture', 'program-design', 'slices'] as const;
export type GateId = (typeof GATE_IDS)[number];

export type GateState = 'pending' | 'in_progress' | 'approved' | 'changes_requested';

/** The doc whose presence in a PR's changed files proves the gate was reached. */
const GATE_DOC: Record<GateId, string> = {
  product: '01-product.md',
  architecture: '02-architecture.md',
  'program-design': '03-program-design.md',
  slices: '04-slices.md',
};

export type GateReview = {
  /** GitHub review state: APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED | PENDING */
  state: string;
  /** ISO timestamp; only the ORDER matters, never the value. */
  submittedAt: string | null;
};

export type GateInput = {
  /** Paths of the files the PR changes. */
  files: readonly string[];
  /** PR labels — `gate:<id>:approved` pins a gate regardless of inference. */
  labels: readonly string[];
  /** All reviews on the PR, any order. */
  reviews: readonly GateReview[];
};

export type GateLadder = {
  gates: Record<GateId, GateState>;
  /** The gate a decision would land on, or null when nothing is in flight. */
  currentGate: GateId | null;
};

/** A plan doc counts only under `docs/plans/`, so an unrelated `04-slices.md`
 *  elsewhere in the tree can't fake a gate. */
function reachedGates(files: readonly string[]): Set<GateId> {
  const reached = new Set<GateId>();
  for (const file of files) {
    const path = file.replace(/^\/+/, '');
    if (!path.startsWith('docs/plans/')) continue;
    for (const id of GATE_IDS) {
      if (path.endsWith(`/${GATE_DOC[id]}`)) reached.add(id);
    }
  }
  return reached;
}

/** Latest non-advisory review wins. COMMENTED/PENDING/DISMISSED say nothing
 *  about approval, so they never override an earlier decision. */
function latestDecision(reviews: readonly GateReview[]): 'approved' | 'changes_requested' | null {
  let best: { at: string; state: 'approved' | 'changes_requested' } | null = null;
  for (const review of reviews) {
    const state =
      review.state === 'APPROVED'
        ? 'approved'
        : review.state === 'CHANGES_REQUESTED'
          ? 'changes_requested'
          : null;
    if (!state) continue;
    const at = review.submittedAt ?? '';
    if (!best || at >= best.at) best = { at, state };
  }
  return best?.state ?? null;
}

export function gateApprovedLabel(id: GateId): string {
  return `gate:${id}:approved`;
}

export function nextGate(id: GateId): GateId | null {
  const i = GATE_IDS.indexOf(id);
  return i >= 0 && i < GATE_IDS.length - 1 ? GATE_IDS[i + 1] : null;
}

export function deriveGates(input: GateInput): GateLadder {
  const labelled = new Set(GATE_IDS.filter((id) => input.labels.includes(gateApprovedLabel(id))));
  const reached = reachedGates(input.files);

  // A PR that carries no plan docs at all is still real work — treat it as a
  // slices-only PR rather than showing four empty chips.
  const highestReached =
    [...GATE_IDS].reverse().find((id) => reached.has(id) || labelled.has(id)) ??
    (input.files.length ? 'slices' : null);

  const gates = Object.fromEntries(GATE_IDS.map((id) => [id, 'pending'])) as Record<
    GateId,
    GateState
  >;
  if (!highestReached) return { gates, currentGate: null };

  const currentIndex = GATE_IDS.indexOf(highestReached);
  const decision = latestDecision(input.reviews);

  for (const id of GATE_IDS) {
    const i = GATE_IDS.indexOf(id);
    if (labelled.has(id)) gates[id] = 'approved';
    else if (i < currentIndex) gates[id] = 'approved';
    else if (i > currentIndex) gates[id] = 'pending';
    else gates[id] = decision ?? 'in_progress';
  }

  // An explicitly-approved current gate is done; the decision moves on.
  const currentGate =
    gates[highestReached] === 'approved' ? nextGate(highestReached) : highestReached;
  return { gates, currentGate };
}
