<script lang="ts">
  import { untrack } from 'svelte';
  import { invalidate } from '$app/navigation';
  import WeekHoursEditor from './WeekHoursEditor.svelte';
  import SaveIndicator from '$lib/records/SaveIndicator.svelte';
  import { createSaveStatus, saveAndRefresh } from '$lib/records/save-status.svelte';
  import { createAutosave } from '$lib/records/autosave.svelte';
  import * as m from '$lib/paraglide/messages';
  import { fetchJson } from '$lib/api/fetch-json';

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
    scope: () => resourceId,
    prepare: (w, isCurrent) => {
      const id = resourceId;
      const timezone = schedule?.timezone;
      const rules = w.flatMap((d, day) =>
        d.enabled ? [{ days: [day], startTime: d.start, endTime: d.end, date: null }] : [],
      );
      return async () => {
        // Read at dispatch: a queued edit must carry the token its predecessor produced.
        const expectedUpdatedAt = schedule?.updatedAt;
        await saveAndRefresh(
          () =>
            fetchJson(`/api/scheduling/resources/${id}/availability`, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ timezone, rules, expectedUpdatedAt }),
            }),
          () => invalidate('scheduling:data'),
          isCurrent,
        );
      };
    },
    status,
    debounceMs: 0,
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });

  // Deep-reads `week` (every day's every field) so the effect reruns on a
  // nested toggle/time edit, not just a reassignment of the array itself.
  // svelte-ignore state_referenced_locally
  let weekOwner = resourceId;
  $effect(() => {
    if (weekOwner !== resourceId) {
      weekOwner = resourceId;
      week = buildWeek(schedule);
      weekAutosave.cancel();
    } else {
      const snapshot = JSON.parse(JSON.stringify(week));
      untrack(() => weekAutosave.set(snapshot));
    }
  });
</script>

<div class="avail">
  <div class="flex items-center gap-2 mb-2">
    <div class="t-label">{m.sched_availability_title()}</div>
    <SaveIndicator
      status={status.status}
      message={status.message}
      onRetry={status.retry}
      onReview={() => invalidate('scheduling:data')}
    />
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
