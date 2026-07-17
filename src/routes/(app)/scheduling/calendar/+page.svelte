<script lang="ts">
  import type { PageData } from './$types';
  import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-svelte';
  import { goto } from '$lib/navigation';
  import { PageHeader, Button, EmptyState } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';

  let { data }: { data: PageData } = $props();

  // Day window shown on the grid.
  const START_HOUR = 7;
  const END_HOUR = 21;
  const HOURS = $derived(
    Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i),
  );
  const PX_PER_HOUR = 56;

  const eventTitle = (id: string) => data.eventTypes.find((e) => e.id === id)?.title ?? '';

  // LOCAL calendar date (not UTC) — toISOString() would roll a late-evening
  // negative-UTC-offset day forward (e.g. 22:40 Sun in Lima is Mon in UTC).
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  function shiftDay(delta: number) {
    const d = new Date(`${data.day}T00:00:00`);
    d.setDate(d.getDate() + delta);
    goto(`?date=${ymd(d)}`, { keepFocus: true, noScroll: true });
  }
  function goToday() {
    goto(`?date=${ymd(new Date())}`, { keepFocus: true, noScroll: true });
  }

  /** Vertical offset + height (px) for a booking within the day grid. */
  function box(start: string, end: string): { top: number; height: number } {
    const s = new Date(start);
    const e = new Date(end);
    const startMin = s.getHours() * 60 + s.getMinutes();
    const endMin = e.getHours() * 60 + e.getMinutes();
    const top = ((startMin - START_HOUR * 60) / 60) * PX_PER_HOUR;
    const height = Math.max(16, ((endMin - startMin) / 60) * PX_PER_HOUR);
    return { top, height };
  }
  function hhmm(iso: string): string {
    return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  const bookingsFor = (resourceId: string) =>
    data.bookings.filter((b) => b.resourceId === resourceId);

  const prettyDay = $derived(
    new Date(`${data.day}T00:00:00`).toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }),
  );
</script>

<svelte:head><title>{m.sched_calendar_title()} · {m.nav_scheduling()}</title></svelte:head>

<PageShell
  archetype="collection"
  scroll="region"
  labelledBy="scheduling-calendar-title"
  class="scheduling-calendar-surface"
>
  <PageHeader
    titleId="scheduling-calendar-title"
    title={m.sched_calendar_title()}
    subtitle={m.sched_calendar_subtitle()}
  >
    {#snippet leading()}
      <CalendarDays size={16} class="text-accent shrink-0" />
    {/snippet}
  </PageHeader>

  <!-- Centered date nav: the date sits in a fixed-width slot so the chevrons
	     and Today button never shift as the selected date's label changes. -->
  <div class="cal-nav">
    <Button
      variant="ghost"
      size="sm"
      class="nav-btn"
      onclick={() => shiftDay(-1)}
      aria-label={m.sched_prev()}><ChevronLeft size={18} /></Button
    >
    <div class="cal-date">{prettyDay}</div>
    <Button
      variant="ghost"
      size="sm"
      class="nav-btn"
      onclick={() => shiftDay(1)}
      aria-label={m.sched_next()}><ChevronRight size={18} /></Button
    >
    <div class="cal-today">
      <Button size="sm" variant="ghost" onclick={goToday}>{m.sched_today()}</Button>
    </div>
  </div>

  <PageBody padding="compact" scroll="region">
    {#if data.resources.length === 0}
      <EmptyState title={m.sched_empty_resources()} />
    {:else}
      <div class="cal" style="--ph:{PX_PER_HOUR}px">
        <!-- Time axis -->
        <div class="axis">
          <div class="col-head"></div>
          {#each HOURS as h (h)}
            <div class="hour-label" style="height:{PX_PER_HOUR}px">
              {String(h).padStart(2, '0')}:00
            </div>
          {/each}
        </div>
        <!-- Resource columns -->
        <div class="cols">
          {#each data.resources as r (r.id)}
            <div class="col">
              <div class="col-head" title={r.name}>
                <span class="dot" style="background:{r.color ?? 'var(--color-accent)'}"></span>
                <span class="truncate">{r.name}</span>
              </div>
              <div class="track" style="height:{HOURS.length * PX_PER_HOUR}px">
                {#each HOURS as h (h)}
                  <div class="gridline" style="top:{(h - START_HOUR) * PX_PER_HOUR}px"></div>
                {/each}
                {#each bookingsFor(r.id) as b (b.id)}
                  {@const pos = box(b.start, b.end)}
                  <div
                    class="evt {b.status}"
                    style="top:{pos.top}px;height:{pos.height}px;border-color:{r.color ??
                      'var(--color-accent)'}"
                    title="{hhmm(b.start)} {eventTitle(b.eventTypeId)} · {b.attendeeName ?? ''}"
                  >
                    <div class="evt-t">{hhmm(b.start)}</div>
                    <div class="evt-s truncate">{eventTitle(b.eventTypeId)}</div>
                    <div class="evt-a truncate">{b.attendeeName ?? ''}</div>
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </PageBody>
</PageShell>

<style>
  .cal {
    display: flex;
    min-width: min-content;
  }
  .axis {
    flex-shrink: 0;
    width: 52px;
  }
  .hour-label {
    font-size: var(--font-size-caption, 12px);
    color: var(--color-muted-foreground);
    text-align: right;
    padding-right: var(--space-2, 8px);
    transform: translateY(-6px);
  }
  .cols {
    display: flex;
    flex: 1;
    gap: 1px;
  }
  .col {
    flex: 1;
    min-width: 120px;
  }
  .col-head {
    height: 32px;
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    font-size: var(--font-size-body, 14px);
    font-weight: 500;
    padding: 0 var(--space-2);
    border-bottom: 1px solid var(--hairline);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
  }
  .track {
    position: relative;
    border-left: 1px solid var(--hairline);
  }
  .gridline {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px solid var(--hairline);
    opacity: 0.5;
  }
  .evt {
    position: absolute;
    left: 3px;
    right: 3px;
    background: var(--color-card);
    border-left: 3px solid var(--color-accent);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-elevation-2);
    padding: var(--space-0-5, 2px) var(--space-2, 8px);
    overflow: hidden;
    font-size: var(--font-size-caption, 12px);
  }
  .evt.cancelled,
  .evt.no_show {
    opacity: 0.45;
    text-decoration: line-through;
  }
  .evt-t {
    font-weight: 600;
  }
  .evt-s {
    color: var(--color-muted-foreground);
  }
  .evt-a {
    color: var(--color-muted-foreground);
  }
  .cal-nav {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2, 8px);
    padding: var(--space-2, 8px) var(--space-4, 16px);
  }
  /* Today floats at the right edge so the prev/date/next group stays centered. */
  .cal-today {
    position: absolute;
    right: 1rem;
    top: 50%;
    transform: translateY(-50%);
  }
  .cal-date {
    /* Fixed slot so the flanking chevrons don't move when the date changes. */
    min-width: 14rem;
    text-align: center;
    font-weight: 600;
    font-size: var(--font-size-page-title, 18px);
  }
  .nav-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-1, 4px);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    color: var(--color-foreground, inherit);
  }
  .nav-btn:hover {
    background: var(--hairline);
    border-color: var(--color-accent);
  }
</style>
