<script lang="ts" module>
  /** Stand-in for `BookingCalendar` in page-plumbing tests (HC-016B): renders
   *  the `anchor` prop it receives, reports a fixed anchor as it unmounts
   *  (the renderer's own contract: `onanchor` fires on settle and destroy),
   *  and exposes the `ondate` callback as a button. The pages also import
   *  these names from the real module. */
  export const CALENDAR_DROP_MIME = 'application/x-minion-calendar-drop';
  export interface CalendarAnchor {
    firstDay: string;
    scrollTop: number;
  }
  export const PROBE_ANCHOR: CalendarAnchor = { firstDay: '2026-09-09', scrollTop: 300 };
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Button } from '$lib/components/ui';
  let {
    anchor,
    onanchor,
    ondate,
  }: {
    anchor?: CalendarAnchor;
    onanchor?: (a: CalendarAnchor) => void;
    ondate: (date: string, opts?: { silent?: boolean }) => void;
    [key: string]: unknown;
  } = $props();
  onDestroy(() => onanchor?.(PROBE_ANCHOR));
</script>

<div data-probe data-anchor={JSON.stringify(anchor ?? null)}>
  <Button variant="ghost" data-probe-ondate onclick={() => ondate('2026-09-15')}>ondate</Button>
</div>
