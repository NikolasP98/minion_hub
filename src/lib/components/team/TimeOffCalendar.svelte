<script lang="ts" module>
  export type CalendarView = 'month' | 'week' | 'agenda';
</script>

<script lang="ts">
  // Notion-style month / week / agenda views over leave + holidays, rendered by
  // @event-calendar/core (Svelte). Our own toolbar drives it (view + date live
  // in the options object); the vendor CSS is re-skinned with semantic tokens.
  import { Calendar, DayGrid, List } from '@event-calendar/core';
  import '@event-calendar/core/index.css';
  import { ChevronLeft, ChevronRight } from 'lucide-svelte';
  import { Button, SegmentedControl, iconSizes } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { languageTag } from '$lib/paraglide/runtime';
  import { addDays } from './timeline.svelte';
  import type { TeamHoliday, TeamLeaveRequest } from './types';

  let {
    requests,
    holidays,
    weeklyOff,
    employeeName,
    typeName,
    view = $bindable('month'),
    onEventClick,
  }: {
    requests: TeamLeaveRequest[];
    holidays: TeamHoliday[];
    weeklyOff: number[];
    employeeName: (id: string) => string;
    typeName: (id: string) => string;
    view?: CalendarView;
    /** `leave:<id>` or `holiday:<id>`. */
    onEventClick: (id: string) => void;
  } = $props();

  const VIEW_ID: Record<CalendarView, string> = {
    month: 'dayGridMonth',
    week: 'dayGridWeek',
    agenda: 'listMonth',
  };
  const viewItems = $derived([
    { value: 'month', label: m.team_cal_month() },
    { value: 'week', label: m.team_cal_week() },
    { value: 'agenda', label: m.team_cal_agenda() },
  ]);

  let title = $state('');
  let range = $state<{ start: string; end: string } | null>(null);

  // Leave + holidays as all-day events; weekly offs as background shading for the visible range.
  const events = $derived.by(() => {
    const out: Record<string, unknown>[] = [];
    for (const h of holidays) {
      if (!h.enabled) continue;
      out.push({
        id: `holiday:${h.id}`,
        allDay: true,
        start: h.date,
        end: addDays(h.date, 1),
        title: h.name,
        classNames: ['ev-holiday'],
      });
    }
    for (const r of requests) {
      if (r.status === 'rejected' || r.status === 'cancelled') continue;
      out.push({
        id: `leave:${r.id}`,
        allDay: true,
        start: r.fromDate,
        end: addDays(r.toDate, 1),
        title: `${employeeName(r.employeeId)} · ${typeName(r.leaveTypeId)}`,
        classNames: [`ev-${r.status}`],
      });
    }
    if (range && weeklyOff.length) {
      const off = new Set(weeklyOff);
      for (let k = range.start; k < range.end; k = addDays(k, 1)) {
        if (off.has(new Date(`${k}T00:00:00`).getDay()))
          out.push({
            id: `off:${k}`,
            allDay: true,
            start: k,
            end: addDays(k, 1),
            display: 'background',
          });
      }
    }
    return out;
  });

  const key = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  let options = $state<Record<string, unknown>>({
    view: VIEW_ID[view],
    headerToolbar: { start: '', center: '', end: '' },
    firstDay: 1,
    locale: languageTag(),
    height: 'auto',
    dayMaxEvents: true,
    editable: false,
    events: [],
    datesSet: (info: { start: Date; end: Date; view: { title: string } }) => {
      title = info.view.title;
      range = { start: key(info.start), end: key(info.end) };
    },
    eventClick: (info: { event: { id: string | number } }) => {
      const id = String(info.event.id);
      if (!id.startsWith('off:')) onEventClick(id);
    },
  });
  $effect(() => {
    options.events = events;
  });
  $effect(() => {
    options.view = VIEW_ID[view];
  });
  $effect(() => {
    options.locale = languageTag();
  });

  // The component instance exposes the imperative API (prev/next/gotoDate); its
  // declared type is the legacy SvelteComponent shell, so narrow at the call site.
  type CalApi = { prev(): void; next(): void; gotoDate(d: Date): void };
  let calendar = $state<unknown>(null);
  const api = () => calendar as CalApi | null;
</script>

<div class="toc">
  <div class="toolbar">
    <div class="nav">
      <Button variant="ghost" size="xs" shape="icon" aria-label="‹" onclick={() => api()?.prev()}>
        <ChevronLeft size={iconSizes.sm} aria-hidden="true" />
      </Button>
      <Button variant="outline" size="xs" onclick={() => api()?.gotoDate(new Date())}
        >{m.team_cal_today()}</Button
      >
      <Button variant="ghost" size="xs" shape="icon" aria-label="›" onclick={() => api()?.next()}>
        <ChevronRight size={iconSizes.sm} aria-hidden="true" />
      </Button>
      <span class="t-title title">{title}</span>
    </div>
    <SegmentedControl items={viewItems} bind:value={view} aria-label={m.team_cal_view()} />
  </div>
  <div class="cal" class:agenda={view === 'agenda'}>
    <Calendar bind:this={calendar} plugins={[DayGrid, List]} {options} />
  </div>
  <div class="legend t-caption">
    <span class="lg lg-approved">{m.team_leave_approved()}</span>
    <span class="lg lg-pending">{m.team_leave_pending()}</span>
    <span class="lg lg-holiday">{m.team_holiday()}</span>
    <span class="lg lg-off">{m.team_weekly_off()}</span>
  </div>
</div>

<style>
  .toc {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .nav {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }
  .title {
    margin-left: var(--space-2);
    text-transform: capitalize;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    color: var(--color-text-secondary);
  }
  .lg::before {
    content: '';
    display: inline-block;
    width: 0.625rem;
    height: 0.625rem;
    border-radius: var(--radius-xs);
    margin-right: var(--space-1);
    vertical-align: -1px;
  }
  .lg-approved::before {
    background: var(--color-success-fg);
  }
  .lg-pending::before {
    background: var(--color-warning-fg);
  }
  .lg-holiday::before {
    background: var(--color-info-fg);
  }
  .lg-off::before {
    background: var(--color-surface-3);
    border: 1px solid var(--color-border);
  }

  /* Third-party render surface: event-calendar declares its --ec-* hooks ON `.ec`,
     so the semantic-token mapping must live on the same element to win. */
  .cal {
    min-width: 0;
  }
  .cal :global(.ec) {
    color-scheme: inherit;
    --ec-color-50: var(--color-surface-1);
    --ec-color-100: var(--color-surface-2);
    --ec-color-200: var(--color-surface-3);
    --ec-color-300: var(--color-border);
    --ec-color-400: var(--color-border-strong);
    --ec-bg-color: transparent;
    --ec-border-color: var(--color-border);
    --ec-text-color: var(--color-text-primary);
    --ec-today-bg-color: color-mix(in srgb, var(--color-accent) 10%, transparent);
    --ec-highlight-color: color-mix(in srgb, var(--color-accent) 16%, transparent);
    --ec-event-bg-color: var(--color-accent);
    --ec-event-text-color: var(--color-on-accent);
    --ec-bg-event-color: var(--color-surface-3);
    --ec-bg-event-opacity: 1;
    --ec-popup-bg-color: var(--color-overlay);
    --ec-button-bg-color: var(--color-surface-2);
    --ec-button-border-color: var(--color-border);
    --ec-button-text-color: var(--color-text-primary);
    --ec-button-active-bg-color: var(--color-accent);
    --ec-button-active-border-color: var(--color-accent);
    --ec-button-active-text-color: var(--color-on-accent);
    --ec-now-indicator-color: var(--color-danger-fg);
    --ec-last-line-color: var(--color-border);
    font: inherit;
    font-size: var(--font-size-caption);
  }
  /* Month cells tall enough for two all-day bars before "+N more". */
  .cal :global(.ec-day-grid .ec-day) {
    min-height: 5.5rem;
  }
  .cal.agenda :global(.ec-day-grid .ec-day) {
    min-height: 0;
  }
  .cal :global(.ec-day-head),
  .cal :global(.ec-list .ec-day-head) {
    color: var(--color-text-secondary);
  }
  .cal :global(.ec-day.ec-other-month .ec-day-head) {
    color: var(--color-text-disabled);
  }
  .cal :global(.ec-event) {
    border-radius: var(--radius-xs);
    font-size: var(--font-size-caption);
  }
  .cal :global(.ec-event.ev-approved) {
    background: var(--color-success-surface);
    color: var(--color-success-fg);
    border-left: 2px solid var(--color-success-fg);
  }
  .cal :global(.ec-event.ev-pending) {
    background: var(--color-warning-surface);
    color: var(--color-warning-fg);
    border-left: 2px dashed var(--color-warning-fg);
  }
  .cal :global(.ec-event.ev-holiday) {
    background: var(--color-info-surface);
    color: var(--color-info-fg);
    border-left: 2px solid var(--color-info-fg);
  }
  .cal :global(.ec-popup) {
    border: 1px solid var(--color-border);
    box-shadow: var(--shadow-overlay);
    border-radius: var(--radius-md);
  }
  .cal :global(.ec-list .ec-event) {
    background: var(--color-surface-2);
    color: var(--color-text-primary);
  }
  .cal :global(.ec-no-events) {
    color: var(--color-text-secondary);
  }
</style>
