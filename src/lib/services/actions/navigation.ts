import { defineAction } from './definition';
import type { ActionHandle, ActionRuntime } from './runtime.svelte';

/** SvelteKit owns the read and cancellation; observe completion without changing it. */
export const navigationAction = defineAction({
  id: 'navigation.load',
  policy: 'read',
  visibility: 'foreground',
  execute: (complete: Promise<void>) => complete,
});

/** Replace before cancelling so continuous navigation never resets the busy delay. */
export function createNavigationTracker(actions: ActionRuntime) {
  let current: Promise<void> | null = null;
  let handle: ActionHandle<void> | undefined;
  return {
    sync(complete: Promise<void> | null) {
      if (complete === current && (!handle || actions.get(handle.id))) return;
      current = complete;
      const previous = handle;
      // Attach immediately, even if runtime disposal prevents execution starting.
      if (complete) void complete.catch(() => {});
      handle = complete ? actions.start(navigationAction, complete) : undefined;
      previous?.cancel();
    },
    dispose() {
      handle?.cancel();
      handle = undefined;
      current = null;
    },
  };
}
