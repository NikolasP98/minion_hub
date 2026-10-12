<script lang="ts">
  import { invalidate } from '$app/navigation';
  import WeekHoursEditor from './WeekHoursEditor.svelte';
  import SaveIndicator from '$lib/records/SaveIndicator.svelte';
  import { createSaveStatus } from '$lib/records/save-status.svelte';
  import { createAutosave } from '$lib/records/autosave.svelte';
  import * as m from '$lib/paraglide/messages';
  import { jsonMutation } from '$lib/api/json-mutation';
  import { ApiError } from '$lib/api/fetch-json';

  interface Rule {
    days: number[];
    startTime: string;
    endTime: string;
    date: string | null;
  }
  interface Schedule {
    scheduleId: string;
    timezone: string;
    /** Stale-write token sent back as `expectedUpdatedAt`. */
    updatedAt?: string | Date;
    rules: Rule[];
  }
  let { resourceId, schedule }: { resourceId: string; schedule: Schedule | null } = $props();

  interface DayState {
    enabled: boolean;
    start: string;
    end: string;
  }

  // Build a weekly model (one row per weekday) from the recurring rules.
  function buildWeek(s: Schedule | null): DayState[] {
    const week: DayState[] = Array.from({ length: 7 }, () => ({
      enabled: false,
      start: '09:00',
      end: '17:00',
    }));
    for (const r of s?.rules ?? []) {
      if (r.date != null) continue; // overrides not edited here (MVP)
      for (const d of r.days) {
        if (d >= 0 && d <= 6) week[d] = { enabled: true, start: r.startTime, end: r.endTime };
      }
    }
    return week;
  }

  // WeekHoursEditor mutates day entries IN PLACE (bind:checked/bind:value on
  // each `{#each}` item), so it needs a real $state array to bind — the
  // autosave below only ever sees snapshots copied out of it.
  // svelte-ignore state_referenced_locally
  let week = $state<DayState[]>(buildWeek(schedule));

  // autosave (policy O): the endpoint PUTs the whole recurring-rules grid in
  // one call (no per-cell PATCH), so one autosave wraps the whole week —
  // every toggle/time edit commits immediately (debounceMs 0).
  const status = createSaveStatus();
  const weekAutosave = createAutosave<DayState[]>({
    committed: () => buildWeek(schedule),
    save: async (w) => {
      const rules = w
        .map((d, i) => ({ enabled: d.enabled, day: i, start: d.start, end: d.end }))
        .filter((d) => d.enabled)
        .map((d) => ({ days: [d.day], startTime: d.start, endTime: d.end, date: null }));
      try {
        await jsonMutation({
          input: `/api/scheduling/resources/${resourceId}/availability`,
          init: {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              timezone: schedule?.timezone,
              rules,
              expectedUpdatedAt: schedule?.updatedAt,
            }),
          },
          onSuccess: async () => {
            await invalidate('scheduling:data');
          },
        });
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          // Someone else saved this grid meanwhile: show theirs (visible rollback).
          await invalidate('scheduling:data');
          week = buildWeek(schedule);
          throw new Error(m.asyncAction_conflict());
        }
        throw e;
      }
    },
    status,
    debounceMs: 0,
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  // Deep-reads `week` (every day's every field) so the effect reruns on a
  // nested toggle/time edit, not just a reassignment of the array itself.
  $effect(() => {
    weekAutosave.set(JSON.parse(JSON.stringify(week)));
  });
</script>

<div class="avail">
  <div class="flex items-center gap-2 mb-2">
    <div class="t-label">{m.sched_availability_title()}</div>
    <SaveIndicator status={status.status} message={status.message} onRetry={status.retry} />
  </div>
  <WeekHoursEditor bind:week />
</div>

<style>
  .avail {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
</style>
