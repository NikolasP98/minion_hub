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

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Back-to-back wall slots (`HH:MM`) for a whole tray group dropped at
 *  `startMinutes`: each service starts where the previous one ends, in tray
 *  order. Slots that would run past midnight are NOT returned, so the caller
 *  reports the overflow instead of booking a service onto a day the operator
 *  never pointed at (the result can be shorter than `durations`). */
export function sequentialSlots(startMinutes: number, durations: number[]): string[] {
  const slots: string[] = [];
  let at = startMinutes;
  for (const minutes of durations) {
    if (at >= 24 * 60) break;
    slots.push(`${pad2(Math.floor(at / 60))}:${pad2(at % 60)}`);
    at += minutes;
  }
  return slots;
}
