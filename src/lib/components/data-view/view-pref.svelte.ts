/**
 * ONE per-viewer view preference (active view, board axis, collapsed flag…)
 * backed by `localStorage`: whitelist-parsed on read, written on `set`, and a
 * fallback whenever storage is missing, blocked or holds a stale value — the
 * same contract as `scheduling/kit/calendar-prefs.svelte.ts`. Read once,
 * synchronously, so SSR renders the fallback and the client its saved choice.
 */
export interface ViewPref<K extends string> {
  readonly value: K;
  set(value: K): void;
}

export function createViewPref<K extends string>(
  key: string,
  allowed: readonly K[],
  fallback: K,
): ViewPref<K> {
  let value = $state<K>(fallback);
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(key);
      if ((allowed as readonly string[]).includes(raw ?? '')) value = raw as K;
    }
  } catch {
    /* per-viewer convenience only */
  }
  return {
    get value() {
      return value;
    },
    set(next: K) {
      value = next;
      try {
        localStorage.setItem(key, next);
      } catch {
        /* per-viewer convenience only */
      }
    },
  };
}
