export type BrainSearchEmptyReason =
  | 'empty_query'
  | 'no_canonical_candidates'
  | 'relevance_policy_filtered_all';

export type BrainSearchEmptyState = 'generic' | 'no-canonical' | 'policy-filtered';

export function brainSearchEmptyState(
  reason: BrainSearchEmptyReason | null | undefined,
): BrainSearchEmptyState {
  if (reason === 'relevance_policy_filtered_all') return 'policy-filtered';
  if (reason === 'no_canonical_candidates') return 'no-canonical';
  return 'generic';
}

export interface BrainSearchRequestIdentity {
  brainId: string;
  generation: number;
}

export function isCurrentBrainSearchRequest(
  request: BrainSearchRequestIdentity,
  currentBrainId: string,
  currentGeneration: number,
): boolean {
  return request.brainId === currentBrainId && request.generation === currentGeneration;
}
