/**
 * Where the ONE global busy indicator renders (spec 038). `icon-ring` swaps the
 * sidebar's module icon for the house Spinner while busy; `divider-bar` turns
 * the hairline under the org line into an indeterminate accent sweep. Density
 * pattern: SSR-loaded with the `/api/me/preferences` bundle, a pick wins
 * in-session and is PUT immediately.
 */
import { page } from '$app/state';
import { syncPreferenceToServerImmediately } from './preference-sync.svelte';

export type LoadingIndicatorPlacement = 'icon-ring' | 'divider-bar';
export const LOADING_INDICATOR_PLACEMENTS: readonly LoadingIndicatorPlacement[] = [
  'icon-ring',
  'divider-bar',
];
export const DEFAULT_LOADING_INDICATOR: LoadingIndicatorPlacement = 'icon-ring';

/** Anything but the exact server shape `{ version: 1, placement }` is the default. */
export function decodeLoadingIndicator(value: unknown): LoadingIndicatorPlacement {
  const v = value as { version?: unknown; placement?: unknown } | null | undefined;
  return v?.version === 1 && v.placement === 'divider-bar'
    ? 'divider-bar'
    : DEFAULT_LOADING_INDICATOR;
}

let picked = $state<LoadingIndicatorPlacement | null>(null);

export const loadingIndicator = {
  get placement(): LoadingIndicatorPlacement {
    if (picked) return picked;
    const data = page.data as { preferences?: { preferences?: Record<string, unknown> } };
    return decodeLoadingIndicator(data?.preferences?.preferences?.loadingIndicator);
  },
  set(placement: LoadingIndicatorPlacement) {
    picked = placement;
    syncPreferenceToServerImmediately('loadingIndicator', { version: 1, placement });
  },
};
