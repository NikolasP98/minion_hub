import { createScopedPreference } from '$lib/state/ui/scoped-preference.svelte';
export interface ViewPref<K extends string> {
  readonly value: K;
  set(value: K): void;
}
export function createViewPref<K extends string>(
  key: string,
  allowed: readonly K[],
  fallback: K,
): ViewPref<K> {
  const pref = createScopedPreference(
    key,
    () => fallback,
    (value) =>
      typeof value === 'string' && allowed.includes(value as K) ? (value as K) : fallback,
  );
  return {
    get value() {
      return pref.value;
    },
    set(next) {
      if (allowed.includes(next)) pref.set(next);
    },
  };
}
