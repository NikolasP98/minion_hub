/**
 * Optimistic toggle/value cell — `TeamSettingsView`'s pattern, generalised.
 *
 * `TeamSettingsView:173–177` pairs `createOptimistic<boolean>()` with a
 * `Toggle` inside a `cell` snippet: the control shows the intended value while
 * the PATCH is in flight, then the committed one — the new server value on
 * success (nothing visibly moves) or the old one on failure (a visible
 * revert). This wraps that in a row-keyed API so any cell can do it in three
 * calls instead of re-deriving the key plumbing.
 *
 * ```svelte
 * const enabled = createOptimisticCell<Row, boolean>({
 *   getRowId: (r) => r.id,
 *   save: (r, v) => patch(`/api/…/${r.id}`, { enabled: v }),
 *   onError: () => toast.error(m.save_failed()),
 * });
 * …
 * <Toggle checked={enabled.value(row, row.enabled)}
 *         pending={enabled.pending(row.id)}
 *         onchange={(v) => enabled.set(row, v)} />
 * ```
 *
 * `save` REJECTS to signal failure (that is what a `fetchJson`-style helper
 * already does); the overlay is dropped either way, so the committed value
 * takes back over with no extra bookkeeping. `onError` gets the thrown value.
 */
import { createOptimistic } from '$lib/utils/optimistic';

export type OptimisticCellOptions<T, V> = {
  /** Stable row id — the same one the table's `getRowId` returns. */
  getRowId: (row: T) => string;
  save: (row: T, value: V) => Promise<void>;
  onError?: (error: unknown) => void;
};

export interface OptimisticCell<T, V> {
  /** The value to render: the in-flight one while saving, else `current`. */
  value(row: T, current: V): V;
  set(row: T, next: V): Promise<void>;
  pending(rowId: string): boolean;
}

export function createOptimisticCell<T, V>(
  opts: OptimisticCellOptions<T, V>,
): OptimisticCell<T, V> {
  const overlay = createOptimistic<V>();
  return {
    value: (row, current) => overlay.get(opts.getRowId(row), current),
    pending: (rowId) => overlay.isPending(rowId),
    async set(row, next) {
      let error: unknown;
      const ok = await overlay.run(opts.getRowId(row), next, async () => {
        try {
          await opts.save(row, next);
          return true;
        } catch (e) {
          error = e;
          return false;
        }
      });
      if (!ok) opts.onError?.(error);
    },
  };
}
