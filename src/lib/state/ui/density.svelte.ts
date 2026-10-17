/**
 * Shell density preference (spec 013 A). `compact` IS today's shell —
 * `(app)/+layout.svelte` mounted `<AppViewport density="compact">` and DataTable
 * rows default to `normal` (44px) — so a user who never chooses sees no change.
 * `comfortable` = AppViewport comfortable (44px active controls) + DataTable
 * `comfortable` (52px rows). The value is SSR-loaded with the rest of the
 * `/api/me/preferences` bundle (`(app)/+layout.server.ts`), so the shell
 * renders the right density on the first paint; a pick in this session wins
 * until the next load returns it from the server.
 */
import { page } from '$app/state';
import type { Density as TableDensity } from '$lib/components/data-table/DataTable.svelte';
import { syncPreferenceToServerImmediately } from './preference-sync.svelte';

export type DensityMode = 'compact' | 'comfortable';
export const DENSITY_MODES: readonly DensityMode[] = ['compact', 'comfortable'];

/** Anything but the exact server shape `{ version: 1, mode: 'comfortable' }` is today's compact. */
export function decodeDensity(value: unknown): DensityMode {
  const v = value as { version?: unknown; mode?: unknown } | null | undefined;
  return v?.version === 1 && v.mode === 'comfortable' ? 'comfortable' : 'compact';
}

/** DataTable row preset for a shell density: compact keeps today's `normal` 44px rows. */
export function tableDensityFor(mode: DensityMode): TableDensity {
  return mode === 'comfortable' ? 'comfortable' : 'normal';
}

let picked = $state<DensityMode | null>(null);

export const density = {
  get mode(): DensityMode {
    if (picked) return picked;
    const data = page.data as { preferences?: { preferences?: Record<string, unknown> } };
    return decodeDensity(data?.preferences?.preferences?.density);
  },
  set(mode: DensityMode) {
    picked = mode;
    syncPreferenceToServerImmediately('density', { version: 1, mode });
  },
};
