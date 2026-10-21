import { preferenceOwner } from '$lib/state/ui/scoped-preference.svelte';
import { SvelteMap } from 'svelte/reactivity';

/**
 * Optimistic value overlay for controls whose committed value comes from
 * page-load data and is mutated by fetch + `invalidate()`.
 *
 * The control reads `get(key, committed)`: while a mutation is in flight it
 * returns the intended value, afterwards the committed one — which is the
 * new server value on success (so nothing visibly changes) or the unchanged
 * old value on failure (a visible revert). `isPending(key)` drives the
 * control's pending state. The overlay is cleared only after `commit`
 * settles, so an `await invalidate()` inside `commit` never flashes stale
 * data — that flash was the /pos/catalog "toggle → snap back → toggle" bug.
 */
export function createOptimistic<V>() {
  const pending = new SvelteMap<string, V>();
  const revisions = new Map<string, number>();
  let sequence = 0;
  let owner: string | null | undefined;
  function reconcileOwner() {
    const next = preferenceOwner();
    if (next === owner) return;
    owner = next;
    pending.clear();
    revisions.clear();
  }
  return {
    get(key: string, committed: V): V {
      // Reads run inside derived/template computations. Retire the previous
      // owner's overlay without mutating reactive state from that computation.
      const hasOverlay = pending.has(key);
      return hasOverlay && preferenceOwner() === owner ? (pending.get(key) as V) : committed;
    },
    isPending(key: string): boolean {
      const hasOverlay = pending.has(key);
      return hasOverlay && preferenceOwner() === owner;
    },
    /**
     * Show `value` for `key` until `commit` settles. `commit` resolves to
     * whether the server accepted the change (a throw counts as rejected);
     * the caller toasts on `false`.
     */
    async run(key: string, value: V, commit: () => Promise<boolean>): Promise<boolean> {
      reconcileOwner();
      const revision = ++sequence;
      revisions.set(key, revision);
      pending.set(key, value);
      try {
        return await commit();
      } catch {
        return false;
      } finally {
        if (revisions.get(key) === revision) {
          pending.delete(key);
          revisions.delete(key);
        }
      }
    },
  };
}
