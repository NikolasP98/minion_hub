import { onMount, untrack } from 'svelte';
import { page } from '$app/state';
import { preferenceOwner } from '$lib/state/ui/scoped-preference.svelte';
import { useViewMemory } from './view-context';
import { viewKey } from './view-memory';
/** Opt-in for transient filters and panel identifiers. The page still owns
 * state, fetches fresh records and applies its ordinary permission checks. */
export function rememberView<T>(name: string, capture: () => T, restore: (saved: T) => void): void {
  const memory = useViewMemory();
  let owner = preferenceOwner();
  const defaults = $state.snapshot(untrack(capture));
  $effect.pre(() => {
    const next = preferenceOwner();
    if (next === owner) return;
    owner = next;
    untrack(() => restore(structuredClone(defaults) as T));
  });
  onMount(() => {
    if (!memory) return;
    const key = () => `view:${viewKey(page.url)}:${name}`;
    const saved = memory.read<T>(owner, key());
    if (saved !== undefined) restore(saved);
    return memory.register(() => {
      if (preferenceOwner() !== owner) return;
      memory.write(owner, key(), $state.snapshot(capture()));
    });
  });
}
