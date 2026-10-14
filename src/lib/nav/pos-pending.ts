import { page } from '$app/state';
import { notifications } from '$lib/state/features/notifications.svelte';

/**
 * The POS Accounts badge count, for every surface that renders the POS nav.
 *
 * Two sources, in this order:
 *  1. `page.data.posPendingWork` — `/pos/+layout.server.ts`. Authoritative and
 *     immediate inside /pos: it re-runs on `invalidate('pos:pending')`, so
 *     scheduling a pending line updates the badge on the spot.
 *  2. the app-wide shell-counts poll — everywhere else, where that layout does
 *     not run at all. Without it the badge silently vanished the moment you
 *     left /pos while the sidebar still showed the POS module (owner
 *     2026-10-14: "the sidemenu looks weird, its missing items").
 *
 * `undefined` means "nothing to show" — the caller renders no badge. A real 0
 * is also no badge, which is what `getAreaItems` already does.
 */
export function posPendingWork(): number | undefined {
  const fromLayout = (page.data as { posPendingWork?: number }).posPendingWork;
  if (typeof fromLayout === 'number') return fromLayout;
  return notifications.posPendingWork ?? undefined;
}
