/**
 * Cross-device preference sync — debounced writes to server. Initial load
 * comes from the canonical (app)/+layout.server.ts bundle via page.data;
 * localStorage remains the fast cache; server is source of truth.
 */
import { userState } from '$lib/state/features/user.svelte';
import { page } from '$app/state';
import { createKeyedDebouncer } from '$lib/pacer/index.svelte';

const DEBOUNCE_MS = 1_000;

async function putPreference(section: string, value: unknown) {
  try {
    await fetch(`/api/me/preferences/${section}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
  } catch {
    // Silent fail — localStorage is the fallback
  }
}

const prefDebouncer = createKeyedDebouncer<(value: unknown) => void>(
  (section) => (value: unknown) => putPreference(section, value),
  { wait: DEBOUNCE_MS },
);

/** True while applying server values — suppresses re-syncing back to server */
let applying = false;

export function setApplying(value: boolean) {
  applying = value;
}

/**
 * Debounced PUT of a single preference section to the server.
 * No-op when no user is logged in or when applying server values.
 */
export function syncPreferenceToServer(section: string, value: unknown) {
  if (applying || !userState.user) return;
  prefDebouncer.run(section, value);
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

  const data = page.data as { preferences?: { preferences?: Record<string, unknown> } } | undefined;
  const serverPrefs: Record<string, unknown> = data?.preferences?.preferences ?? {};

  // Lazy-import state modules to avoid circular deps
  const { theme } = await import('./theme.svelte');
  const { crtConfig } = await import('./crt-config.svelte');
  const { bgPattern } = await import('./bg-pattern.svelte');
  const { sparklineStyle } = await import('./sparkline-style.svelte');
  const { logoState } = await import('./logo.svelte');
  const { locale } = await import('./locale.svelte');

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
      // Push local value to server (not debounced — one-time seed)
      try {
        await fetch(`/api/me/preferences/${section}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: getValue() }),
        });
      } catch {
        // Silent fail
      }
    }
  }
}
