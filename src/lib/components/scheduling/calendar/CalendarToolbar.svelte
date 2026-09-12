<script lang="ts">
  // All view state lives in the URL (?view, ?date, ?staff, ?kind) — this toolbar
  // only ever calls `goto`, it never owns local view state.
  import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-svelte';
  import { goto } from '$lib/navigation';
  import {
    Button,
    SegmentedControl,
    Select,
    MultiSelectFilter,
    Toggle,
    iconSizes,
  } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { addDays, ymd } from './calendar.svelte';
  import type { CalendarView, CalKind } from './types';

  let {
    view,
    day,
    resources,
    kinds,
    staff,
    kindId,
    title = '',
    cal,
    showInheritedTags,
    onShowInheritedTagsChange,
  }: {
    view: CalendarView;
    day: string;
    resources: { id: string; name: string; color: string | null }[];
    kinds: CalKind[];
    staff: string[];
    kindId: string | null;
    /** The library's own range title (from `datesSet`) — preferred over `prettyDay` once set. */
    title?: string;
    /** The live calendar instance — prev/next/today/date-picker drive it directly
     *  for an instant move, on top of the `?date=` URL update that keeps state in sync. */
    cal?: { prev(): void; next(): void; gotoDate(d: string): void };
    showInheritedTags: boolean;
    onShowInheritedTagsChange: (next: boolean) => void;
  } = $props();

  const viewItems = $derived([
    { value: 'day', label: m.sched_cal_view_day() },
    { value: 'week', label: m.sched_cal_view_week() },
    { value: 'month', label: m.sched_cal_view_month() },
    { value: 'agenda', label: m.sched_cal_view_agenda() },
  ]);
  const staffOptions = $derived(
    resources.map((r) => ({ value: r.id, label: r.name, color: r.color ?? undefined })),
  );
  const staffSet = $derived(new Set(staff));
  const kindOptions = $derived([
    { value: '', label: m.sched_cal_all_kinds() },
    ...kinds.map((k) => ({ value: k.id, label: k.name })),
  ]);

  function navigate(next: {
    view?: string;
    date?: string;
    staff?: string[];
    kind?: string | null;
  }) {
    const params = new URLSearchParams();
    params.set('view', next.view ?? view);
    params.set('date', next.date ?? day);
    const s = next.staff ?? staff;
    if (s.length) params.set('staff', s.join(','));
    const k = next.kind === undefined ? kindId : next.kind;
    if (k) params.set('kind', k);
    goto(`?${params}`, { keepFocus: true, noScroll: true });
  }

  function shift(delta: number) {
    const d = new Date(`${day}T00:00:00`);
    if (view === 'day') d.setDate(d.getDate() + delta);
    else if (view === 'week') d.setDate(d.getDate() + delta * 7);
    else if (view === 'month') d.setMonth(d.getMonth() + delta);
    else d.setDate(d.getDate() + delta * 30);
    const next = ymd(d);
    cal?.gotoDate(next);
    navigate({ date: next });
  }
  function goToday() {
    const next = ymd(new Date());
    cal?.gotoDate(next);
    navigate({ date: next });
  }

  let dateInput: HTMLInputElement | undefined = $state();
  // Some browsers lack showPicker(); fall back to rendering the native input
  // visibly so the user still gets a picker instead of a dead click.
  const pickerSupported =
    typeof HTMLInputElement !== 'undefined' && 'showPicker' in HTMLInputElement.prototype;
  function openPicker() {
    if (pickerSupported) dateInput?.showPicker();
    else dateInput?.focus();
  }
  function onDateChange(e: Event) {
    const val = (e.currentTarget as HTMLInputElement).value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      cal?.gotoDate(val);
      navigate({ date: val });
    }
  }

  const prettyDay = $derived(
    new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
      weekday: view === 'day' ? 'long' : undefined,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
  );
  const dateLabel = $derived(title || prettyDay);
</script>

<div class="cal-toolbar">
  <div class="cal-nav">
    <Button
      variant="ghost"
      size="sm"
      shape="icon"
      onclick={() => shift(-1)}
      aria-label={m.sched_prev()}><ChevronLeft size={iconSizes.md} /></Button
    >
    <div class="cal-date-wrap">
      <Button variant="ghost" size="sm" onclick={openPicker}>
        <CalendarDays size={iconSizes.sm} class="shrink-0 text-muted-foreground" />
        <span class="t-title">{dateLabel}</span>
      </Button>
      <input
        bind:this={dateInput}
        type="date"
        class="cal-date-input"
        class:visible={!pickerSupported}
        tabindex={pickerSupported ? -1 : 0}
        value={day}
        onchange={onDateChange}
        aria-label={m.sched_cal_pick_date()}
      />
    </div>
    <Button
      variant="ghost"
      size="sm"
      shape="icon"
      onclick={() => shift(1)}
      aria-label={m.sched_next()}><ChevronRight size={iconSizes.md} /></Button
    >
    <Button size="sm" variant="ghost" onclick={goToday}>{m.sched_today()}</Button>
  </div>
  <div class="cal-filters">
    <MultiSelectFilter
      class="cal-staff-filter"
      label={m.sched_cal_staff()}
      options={staffOptions}
      selected={staffSet}
      onToggle={(v) => {
        const next = new Set(staffSet);
        if (next.has(v)) next.delete(v);
        else next.add(v);
        navigate({ staff: [...next] });
      }}
      onClear={() => navigate({ staff: [] })}
      allLabel={m.sched_cal_all_staff()}
    />
    <Select
      aria-label={m.sched_kind_label()}
      size="sm"
      value={kindId ?? ''}
      options={kindOptions}
      onchange={(v) => navigate({ kind: v ? String(v) : null })}
    />
    <SegmentedControl
      items={viewItems}
      value={view}
      aria-label={m.sched_cal_view()}
      onValueChange={(v) => navigate({ view: v })}
    />
    <Toggle
      size="sm"
      checked={showInheritedTags}
      label={m.sched_cal_show_linked_tags()}
      onchange={onShowInheritedTagsChange}
    />
  </div>
</div>

<style>
  .cal-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
  }
  .cal-nav {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .cal-filters {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .cal-date-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  .cal-date-input {
    position: absolute;
    inset: 0;
    opacity: 0;
    pointer-events: none;
    width: 100%;
    height: 100%;
    cursor: pointer;
  }
  .cal-date-input.visible {
    position: static;
    opacity: 1;
    pointer-events: auto;
    width: auto;
    height: auto;
  }
  @media (max-width: 767.98px), (pointer: coarse) {
    .cal-toolbar :global(button),
    .cal-toolbar :global(select),
    .cal-date-input.visible {
      min-width: var(--control-height-touch);
      min-height: var(--control-height-touch);
    }
    .cal-nav {
      display: grid;
      grid-template-columns:
        var(--control-height-touch) minmax(0, 1fr) var(--control-height-touch)
        max-content;
      width: 100%;
      min-width: 0;
    }
    .cal-date-wrap {
      min-width: 0;
    }
    .cal-date-wrap :global(button) {
      width: 100%;
      height: auto;
      white-space: normal;
    }
    .cal-date-wrap :global(button > span) {
      min-width: 0;
    }
    .cal-date-wrap :global(.t-title) {
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .cal-toolbar :global(.cal-staff-filter > span),
    .cal-toolbar :global(.cal-staff-filter [aria-haspopup='listbox']) {
      min-height: var(--control-height-touch);
    }
  }
</style>
