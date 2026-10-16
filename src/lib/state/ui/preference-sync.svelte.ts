/** Owner-fenced preference synchronization. A lost acknowledgement requires a read before another write. */
import { userState } from '$lib/state/features/user.svelte';
import { page } from '$app/state';
import { SvelteMap } from 'svelte/reactivity';
import { preferenceOwner } from './scoped-preference.svelte';

export type PreferenceSyncState =
  'idle' | 'saving' | 'saved' | 'error' | 'unknown' | 'checked' | 'local-only';
const states = new SvelteMap<string, PreferenceSyncState>();
const reconciled = new SvelteMap<string, unknown>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const revisions = new Map<string, number>();
const pending = new Map<string, Promise<void>>();
const keyFor = (owner: string, section: string) => JSON.stringify([owner, section]);
let applying = false;
export function setApplying(value: boolean) {
  applying = value;
}
export function preferenceSyncState(section: string): PreferenceSyncState {
  const owner = preferenceOwner();
  return owner ? (states.get(keyFor(owner, section)) ?? 'idle') : 'local-only';
}
export function reconciledPreference(section: string): unknown {
  const owner = preferenceOwner();
  return owner ? reconciled.get(keyFor(owner, section)) : undefined;
}
async function putPreference(
  section: string,
  value: unknown,
  owner: string,
  revision: number,
  keepalive = false,
) {
  const key = keyFor(owner, section);
  if (preferenceOwner() !== owner) {
    states.set(key, 'local-only');
    return;
  }
  if (revisions.get(key) !== revision || states.get(key) === 'unknown') return;
  states.set(key, 'saving');
  try {
    const response = await fetch(`/api/me/preferences/${encodeURIComponent(section)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
      keepalive,
    });
    // Results remain attached to the original owner; current-scope UI reads its own key.
    // An uncertain earlier write blocks even a queued newer revision.
    if (response.status >= 500) states.set(key, 'unknown');
    else if (revisions.get(key) === revision) states.set(key, response.ok ? 'saved' : 'error');
  } catch {
    states.set(key, 'unknown');
  }
}
function enqueue(section: string, value: unknown, immediate: boolean) {
  if (applying || !userState.user) return;
  const owner = preferenceOwner();
  if (!owner) return;
  const key = keyFor(owner, section);
  if (states.get(key) === 'unknown') return;
  const snapshot = JSON.parse(JSON.stringify(value)) as unknown;
  const revision = (revisions.get(key) ?? 0) + 1;
  revisions.set(key, revision);
  clearTimeout(timers.get(key));
  states.set(key, 'saving');
  const run = () => {
    timers.delete(key);
    const next = (pending.get(key) ?? Promise.resolve()).then(() =>
      putPreference(section, snapshot, owner, revision, immediate),
    );
    pending.set(key, next);
    void next.finally(() => {
      if (pending.get(key) === next) pending.delete(key);
    });
  };
  if (immediate) run();
  else timers.set(key, setTimeout(run, 1000));
}
export function syncPreferenceToServer(section: string, value: unknown) {
  enqueue(section, value, false);
}
export function syncPreferenceToServerImmediately(section: string, value: unknown) {
  enqueue(section, value, true);
}
/** Read-only recovery. Does not assert that an uncertain write succeeded or replay it. */
export async function reconcilePreference(section: string): Promise<boolean> {
  const owner = preferenceOwner();
  if (!owner) return false;
  const key = keyFor(owner, section);
  try {
    const response = await fetch('/api/me/preferences');
    if (!response.ok) return false;
    const body: unknown = await response.json();
    if (
      !body ||
      typeof body !== 'object' ||
      !('preferences' in body) ||
      !body.preferences ||
      typeof body.preferences !== 'object' ||
      Array.isArray(body.preferences)
    )
      return false;
    if (owner !== preferenceOwner()) return false;
    reconciled.set(key, (body.preferences as Record<string, unknown>)[section]);
    states.set(key, 'checked');
    return true;
  } catch {
    return false;
  }
}

/**
 * Read preferences from the (app)/+layout.server.ts bundle (via page.data),
 * apply them to each state module, then push any sections missing on the
 * server (first-device seeding).
 *
 * Synchronous up to the dynamic state-module imports — the fetch on mount
 * is gone; data is already hydrated by the time this runs.
 */
export async function loadAndApplyServerPreferences() {
  if (!userState.user) return;
  const owner = preferenceOwner();

  const data = page.data as { preferences?: { preferences?: Record<string, unknown> } } | undefined;
  const serverPrefs: Record<string, unknown> = data?.preferences?.preferences ?? {};

  // Lazy-import state modules to avoid circular deps
  const { theme } = await import('./theme.svelte');
  const { crtConfig } = await import('./crt-config.svelte');
  const { bgPattern } = await import('./bg-pattern.svelte');
  const { sparklineStyle } = await import('./sparkline-style.svelte');
  const { logoState } = await import('./logo.svelte');
  const { locale } = await import('./locale.svelte');

  if (owner !== preferenceOwner()) return;
  applying = true;
  try {
    // Apply server values to each module that has data
    if (serverPrefs.theme)
      theme.applyFromServer(serverPrefs.theme as { presetId: string; accentId: string });
    if (serverPrefs.crt) crtConfig.applyFromServer(serverPrefs.crt as Record<string, unknown>);
    if (serverPrefs.bgPattern)
      bgPattern.applyFromServer(
        serverPrefs.bgPattern as { pattern: string; opacity: number; size: number },
      );
    if (serverPrefs.sparklineStyle)
      sparklineStyle.applyFromServer(serverPrefs.sparklineStyle as { style: string });
    if (serverPrefs.logo) logoState.applyFromServer(serverPrefs.logo as { presetId: string });
    if (serverPrefs.locale) locale.applyFromServer(serverPrefs.locale as { tag: string });
  } finally {
    applying = false;
  }

  // Push any sections missing on the server (first-device seeding)
  const localSections: Record<string, () => unknown> = {
    theme: () => ({ presetId: theme.presetId, accentId: theme.accentId }),
    crt: () => ({
      bloom: crtConfig.bloom,
      scan: crtConfig.scan,
      matrix: crtConfig.matrix,
      subpixel: crtConfig.subpixel,
      phosphorDots: crtConfig.phosphorDots,
      rgbFringe: crtConfig.rgbFringe,
      warmAmbient: crtConfig.warmAmbient,
      vignette: crtConfig.vignette,
      glass: crtConfig.glass,
      flicker: crtConfig.flicker,
    }),
    bgPattern: () => ({
      pattern: bgPattern.pattern,
      opacity: bgPattern.opacity,
      size: bgPattern.size,
    }),
    sparklineStyle: () => ({ style: sparklineStyle.current }),
    logo: () => ({ presetId: logoState.presetId }),
    locale: () => ({ tag: locale.current }),
  };

  for (const [section, getValue] of Object.entries(localSections)) {
    if (!(section in serverPrefs)) {
      if (owner !== preferenceOwner()) return;
      syncPreferenceToServer(section, getValue());
    }
  }
}
