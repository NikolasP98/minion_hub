import type { AsyncBoundaryState } from '$lib/components/ui/foundations';
import type { AsyncResourceStatus } from '$lib/state/async.svelte';

export interface ReliabilityReadBoundaryCopy {
  readonly failedTitle: string;
  readonly unavailableTitle: string;
  readonly failedDescription: string;
  readonly unavailableDescription: string;
  readonly unsupportedDescription: string;
}

/** Map a resource state without hiding retained data after a refresh failure. */
export function reliabilityReadBoundary(
  status: AsyncResourceStatus,
  hasData: boolean,
  retry: () => void,
  copy: ReliabilityReadBoundaryCopy,
): AsyncBoundaryState | null {
  if (status === 'loading' && !hasData) return { kind: 'loading' };
  if (status === 'failed') {
    return {
      kind: 'error',
      title: copy.failedTitle,
      description: copy.failedDescription,
      retry,
    };
  }
  if (status === 'unsupported') {
    return {
      kind: 'unavailable',
      title: copy.unavailableTitle,
      description: copy.unsupportedDescription,
    };
  }
  if (status === 'unavailable') {
    return {
      kind: 'unavailable',
      title: copy.unavailableTitle,
      description: copy.unavailableDescription,
      retry,
    };
  }
  return hasData ? null : { kind: 'ready' };
}
