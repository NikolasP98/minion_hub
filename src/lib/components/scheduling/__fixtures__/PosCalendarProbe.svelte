<script lang="ts" module>
  /** Stand-in for `BookingCalendar` in the POS page tests (spec 126): renders each booking's `chips` and
   *  `actions` snippets exactly as the real hover card does, exposes the context-menu opener and records the
   *  `invoices` prop, so what is under test is the PAGE's money/Charge/stock plumbing. */
  export const CALENDAR_DROP_MIME = 'application/x-minion-calendar-drop';
  export interface CalendarAnchor {
    firstDay: string;
    scrollTop: number;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Button } from '$lib/components/ui';
  type B = { id: string; groupId?: string | null; [key: string]: unknown };
  let {
    bookings = [],
    invoices,
    chips,
    actions,
    oncontextmenu,
    onrange,
  }: {
    bookings?: B[];
    invoices?: unknown[];
    chips?: Snippet<[B]>;
    actions?: Snippet<[B]>;
    onrange?: (first: string, last: string) => void;
    oncontextmenu?: (box: { members: B[]; lead: B }, at: { x: number; y: number }) => void;
    [key: string]: unknown;
  } = $props();
  /** The page asks the calendar for its display submenu; the probe has none. */
  export function displayMenu() {
    return null;
  }
  export function pickDisplay() {
    return false;
  }
</script>

<Button variant="ghost" data-range onclick={() => onrange?.('2026-12-01', '2026-12-07')}
  >range</Button
>
<div data-probe data-invoices={invoices === undefined ? 'none' : String(invoices.length)}>
  {#each bookings as b (b.id)}
    <div data-b={b.id}>
      {#if chips}{@render chips(b)}{/if}
      {#if actions}{@render actions(b)}{/if}
      <Button
        variant="ghost"
        data-ctx={b.id}
        onclick={() =>
          oncontextmenu?.(
            {
              members: b.groupId ? bookings.filter((x) => x.groupId === b.groupId) : [b],
              lead: b,
            },
            { x: 1, y: 1 },
          )}>menu</Button
      >
    </div>
  {/each}
</div>
