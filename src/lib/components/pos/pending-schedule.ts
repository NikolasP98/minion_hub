/** Which active event types sell a pending ticket line's product — shared by
 *  the tray's drag-onto-calendar and click-to-pick gestures (`/pos/appointments`
 *  `+page.svelte`). Exactly one match → book straight through the ticket
 *  schedule endpoint; zero or more than one → fall back to the create tray,
 *  prefilled with the customer (always) and the service (only when exactly
 *  one match exists — otherwise the picker has nothing unambiguous to show). */
export function matchEventTypes<T extends { active: boolean; productId: string | null }>(
  line: { finProductId: string | null },
  eventTypes: T[],
): T[] {
  if (!line.finProductId) return [];
  return eventTypes.filter((e) => e.active && e.productId === line.finProductId);
}
