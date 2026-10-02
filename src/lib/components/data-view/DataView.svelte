<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { DataViewKind } from './data-view';
  export type { DataViewKind };
</script>

<script lang="ts">
  /**
   * The view HOST: owns which views a page offers and which one is active,
   * and hands the switcher back to the page as a snippet parameter so each
   * view can place it where its own toolbar lives (the calendar's toolbar,
   * a table's chrome, a bar above a board). It renders no data itself — the
   * page renders the active view inside `children`. One switcher, one
   * persistence contract, however many renderers.
   */
  import { CalendarDays, Kanban, LayoutGrid, Table2 } from 'lucide-svelte';
  import SegmentedControl, { type SegmentItem } from '$lib/components/ui/SegmentedControl.svelte';
  import * as m from '$lib/paraglide/messages';

  let {
    views,
    value,
    onchange,
    children,
  }: {
    /** The views this page offers, in switcher order. One = no switcher. */
    views: readonly DataViewKind[];
    /** The active view; the page owns it (URL, preference, state). */
    value: DataViewKind;
    onchange: (view: DataViewKind) => void;
    children: Snippet<[{ switcher: Snippet; view: DataViewKind }]>;
  } = $props();

  const LABEL: Record<DataViewKind, () => string> = {
    calendar: m.data_view_calendar,
    table: m.data_view_table,
    board: m.data_view_board,
    gallery: m.data_view_gallery,
  };
  const ICON = { calendar: CalendarDays, table: Table2, board: Kanban, gallery: LayoutGrid };
  const items = $derived<SegmentItem[]>(
    views.map((v) => ({ value: v, label: LABEL[v](), icon: ICON[v] })),
  );
  const active = $derived(views.includes(value) ? value : views[0]);
</script>

{#snippet switcher()}
  {#if views.length > 1}
    <SegmentedControl
      {items}
      value={active}
      iconOnly
      aria-label={m.data_view_switch_label()}
      onValueChange={(v) => onchange(v as DataViewKind)}
    />
  {/if}
{/snippet}

{@render children({ switcher, view: active })}
