import { page } from '$app/state';
import { untrack } from 'svelte';

export function preferenceOwner(): string | null {
  const actor: unknown = page.data.user?.id;
  const org: unknown = page.data.activeOrgId;
  return typeof actor === 'string' && actor && typeof org === 'string' && org
    ? JSON.stringify([actor, org])
    : null;
}
export function preferenceKey(namespace: string, owner = preferenceOwner()): string | null {
  return owner ? `minion:preferences:v1:${owner}:${namespace}` : null;
}
/** Missing identity is memory-only. Unattributable legacy keys are never imported. */
export function createScopedPreference<T>(
  namespace: string,
  fallback: () => T,
  decode: (value: unknown) => T,
) {
  const owner = $derived(preferenceOwner());
  function read(scope: string | null): T {
    try {
      const key = preferenceKey(namespace, scope);
      const raw = key && typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
      return raw ? decode(JSON.parse(raw)) : fallback();
    } catch {
      return fallback();
    }
  }
  let loadedOwner = $state(untrack(() => owner));
  let value = $state<T>(untrack(() => read(owner)));
  let persisted = $state(true);
  const current = $derived(owner === loadedOwner ? value : read(owner));
  return {
    get value() {
      return current;
    },
    get persisted() {
      return owner === loadedOwner ? persisted : true;
    },
    set(next: T) {
      const scope = untrack(() => owner);
      loadedOwner = scope;
      value = next;
      const key = preferenceKey(namespace, scope);
      try {
        if (!key || typeof localStorage === 'undefined') {
          persisted = false;
          return;
        }
        localStorage.setItem(key, JSON.stringify(next));
        persisted = true;
      } catch {
        persisted = false;
      }
    },
    clear() {
      const scope = untrack(() => owner);
      loadedOwner = scope;
      value = untrack(fallback);
      try {
        const key = preferenceKey(namespace, scope);
        if (key) localStorage.removeItem(key);
        persisted = true;
      } catch {
        persisted = false;
      }
    },
  };
}
