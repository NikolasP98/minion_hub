import { untrack } from 'svelte';

/** Space (px) a page holds in the bottom-right corner, so the floating
 *  assistant launcher stays clear of a page's own floating button. */
export const cornerReserve = $state({ bottom: 0 });

/** Reserve `px` of the corner; call the returned function to give it back.
 *  Browser-only (call it from an effect): it writes shared state. */
export function reserveCorner(px: number): () => void {
  // Untracked read: called from an effect, a tracked `+=` would re-run that effect forever.
  cornerReserve.bottom = untrack(() => cornerReserve.bottom) + px;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    cornerReserve.bottom = Math.max(0, untrack(() => cornerReserve.bottom) - px);
  };
}
