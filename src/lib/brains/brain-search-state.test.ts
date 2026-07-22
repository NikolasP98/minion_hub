import { describe, expect, it } from 'vitest';
import { brainSearchEmptyState, isCurrentBrainSearchRequest } from './brain-search-state';

describe('brain search UI state policy', () => {
  it('distinguishes relevance-policy rejection and missing canonical evidence', () => {
    expect(brainSearchEmptyState('relevance_policy_filtered_all')).toBe('policy-filtered');
    expect(brainSearchEmptyState('no_canonical_candidates')).toBe('no-canonical');
    expect(brainSearchEmptyState(null)).toBe('generic');
  });

  it('rejects a response when either its brain or request generation is stale', () => {
    const request = { brainId: 'brain-a', generation: 4 };

    expect(isCurrentBrainSearchRequest(request, 'brain-a', 4)).toBe(true);
    expect(isCurrentBrainSearchRequest(request, 'brain-b', 4)).toBe(false);
    expect(isCurrentBrainSearchRequest(request, 'brain-a', 5)).toBe(false);
  });
});
