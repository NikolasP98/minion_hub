import { describe, expect, it } from 'vitest';
import { drawableGrants } from './drawable-grants';

function grant(id: string, status: string, expiresAt: string | null = null) {
  return { grant: { id, expiresAt }, status };
}

describe('drawableGrants', () => {
  it('keeps only active grants', () => {
    const out = drawableGrants([
      grant('a', 'active'),
      grant('b', 'exhausted'),
      grant('c', 'expired'),
      grant('d', 'cancelled'),
    ]);
    expect(out.map((g) => g.grant.id)).toEqual(['a']);
  });

  it('sorts active grants by soonest expiry first', () => {
    const out = drawableGrants([
      grant('later', 'active', '2027-01-01'),
      grant('sooner', 'active', '2026-06-01'),
      grant('no-expiry', 'active', null),
    ]);
    expect(out.map((g) => g.grant.id)).toEqual(['sooner', 'later', 'no-expiry']);
  });

  it('returns nothing for an empty or all-inactive list', () => {
    expect(drawableGrants([])).toEqual([]);
    expect(drawableGrants([grant('x', 'exhausted')])).toEqual([]);
  });
});
