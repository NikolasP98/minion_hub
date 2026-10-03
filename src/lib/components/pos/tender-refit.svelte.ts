import { untrack } from 'svelte';
import { fitTendersToTotal, type TenderLike } from './checkout-money';

interface TenderRefitOptions<T extends TenderLike> {
  /** The only reactive input: changing the cart total may re-fit old tenders. */
  targetMinor: () => bigint | null;
  /** Read under `untrack` so typing into a tender never rewrites that draft. */
  payments: () => readonly T[];
  replace: (payments: readonly T[]) => void;
}

/**
 * Keep persisted pay-step tenders within a newly changed cart total. Payment
 * edits are deliberately not dependencies: an excessive manual entry remains
 * visible and blocked until the cashier corrects it.
 */
export function createTenderRefitCoordinator<T extends TenderLike>(
  options: TenderRefitOptions<T>,
): void {
  $effect(() => {
    const target = options.targetMinor();
    if (target == null) return;
    untrack(() => {
      const current = options.payments();
      const fitted = fitTendersToTotal(current, target);
      if (fitted !== current) options.replace(fitted);
    });
  });
}
