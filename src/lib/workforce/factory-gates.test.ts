import { describe, it, expect } from 'vitest';
import { deriveGates, gateApprovedLabel, nextGate, GATE_IDS } from './factory-gates';

const plan = (doc: string) => `docs/plans/repo-linking/${doc}`;
const review = (state: string, submittedAt: string) => ({ state, submittedAt });

describe('deriveGates', () => {
  it('is all-pending with nothing to go on', () => {
    const { gates, currentGate } = deriveGates({ files: [], labels: [], reviews: [] });
    expect(currentGate).toBeNull();
    expect(Object.values(gates)).toEqual(['pending', 'pending', 'pending', 'pending']);
  });

  it('infers the current gate from the highest plan doc in the PR', () => {
    const { gates, currentGate } = deriveGates({
      files: [plan('01-product.md'), plan('02-architecture.md')],
      labels: [],
      reviews: [],
    });
    expect(currentGate).toBe('architecture');
    expect(gates.product).toBe('approved'); // below the current gate
    expect(gates.architecture).toBe('in_progress');
    expect(gates['program-design']).toBe('pending');
    expect(gates.slices).toBe('pending');
  });

  it('only counts plan docs under docs/plans/', () => {
    const { currentGate } = deriveGates({
      files: ['src/lib/04-slices.md', 'notes/02-architecture.md'],
      labels: [],
      reviews: [],
    });
    // Not plan docs → falls back to a code-only PR.
    expect(currentGate).toBe('slices');
  });

  it('treats a PR with no plan docs as slices-only', () => {
    const { gates, currentGate } = deriveGates({
      files: ['src/routes/x/+page.svelte'],
      labels: [],
      reviews: [],
    });
    expect(currentGate).toBe('slices');
    expect(gates.product).toBe('approved');
    expect(gates.slices).toBe('in_progress');
  });

  it('applies the latest decisive review to the current gate', () => {
    const { gates } = deriveGates({
      files: [plan('03-program-design.md')],
      labels: [],
      reviews: [review('CHANGES_REQUESTED', '2026-08-01T10:00:00Z')],
    });
    expect(gates['program-design']).toBe('changes_requested');
  });

  it('lets a newer approval supersede older requested changes', () => {
    const { gates, currentGate } = deriveGates({
      files: [plan('02-architecture.md')],
      labels: [],
      reviews: [
        review('CHANGES_REQUESTED', '2026-08-01T10:00:00Z'),
        review('APPROVED', '2026-08-02T10:00:00Z'),
      ],
    });
    expect(gates.architecture).toBe('approved');
    // Approved current gate → the decision moves to the next one.
    expect(currentGate).toBe('program-design');
  });

  it('ignores COMMENTED and DISMISSED reviews', () => {
    const { gates } = deriveGates({
      files: [plan('01-product.md')],
      labels: [],
      reviews: [
        review('APPROVED', '2026-08-01T10:00:00Z'),
        review('COMMENTED', '2026-08-03T10:00:00Z'),
        review('DISMISSED', '2026-08-04T10:00:00Z'),
      ],
    });
    expect(gates.product).toBe('approved');
  });

  it('lets an explicit gate label beat doc inference', () => {
    const { gates } = deriveGates({
      files: [plan('01-product.md')],
      labels: [gateApprovedLabel('slices')],
      reviews: [],
    });
    expect(gates.slices).toBe('approved');
    // slices is now the highest reached gate, so product sits below it.
    expect(gates.product).toBe('approved');
  });

  it('does not let a stale review mark an unreached gate', () => {
    const { gates } = deriveGates({
      files: [plan('01-product.md')],
      labels: [],
      reviews: [review('APPROVED', '2026-08-01T10:00:00Z')],
    });
    expect(gates.architecture).toBe('pending');
    expect(gates.slices).toBe('pending');
  });
});

describe('nextGate', () => {
  it('walks the ladder and stops at the end', () => {
    expect(nextGate('product')).toBe('architecture');
    expect(nextGate('program-design')).toBe('slices');
    expect(nextGate('slices')).toBeNull();
  });

  it('covers every gate id', () => {
    expect(GATE_IDS.filter((id) => nextGate(id) !== null)).toHaveLength(GATE_IDS.length - 1);
  });
});
