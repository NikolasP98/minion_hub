<script lang="ts">
  // Opened by SchedulingCalendar on eventDrop/eventResize (the library has
  // already moved the chip optimistically). Save PATCHes the reschedule;
  // Cancel/409/dismiss all call `revert()` to snap the chip back.
  import Dialog from '$lib/components/ui/foundations/Dialog.svelte';
  import { Button } from '$lib/components/ui';
  import { fetchJson, ApiError } from '$lib/api/fetch-json';
  import { toastError } from '$lib/state/ui';
  import * as m from '$lib/paraglide/messages';
  import { hhmm } from './calendar.svelte';
  import type { CalEvent } from './types';

  let {
    open = $bindable(false),
    event,
    oldStart,
    oldEnd,
    newStart,
    newEnd,
    newResourceId,
    resources,
    revert,
    onSaved,
  }: {
    open?: boolean;
    event: CalEvent | null;
    oldStart: string;
    oldEnd: string;
    newStart: string;
    newEnd: string;
    /** Set only when the drop moved the event to a different resource. */
    newResourceId: string | null;
    resources: { id: string; name: string; color: string | null }[];
    /** Snaps the chip back to its pre-drag position/size. */
    revert: () => void;
    /** Called after a successful PATCH — apply the confirmed values to the store. */
    onSaved: (id: string, patch: Partial<CalEvent>) => void;
  } = $props();

  let saving = $state(false);
  // Guards against double-reverting: `close()` after a successful Save must
  // not also snap the (now-correct) chip back via the Dialog's onclose.
  let handled = false;

  const newResource = $derived(
    newResourceId ? resources.find((r) => r.id === newResourceId) : null,
  );
  const dateLabel = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const rangeLabel = (start: string, end: string) =>
    `${dateLabel(start)} ${hhmm(start)}–${hhmm(end)}`;

  function close() {
    open = false;
  }
  function cancel() {
    handled = true;
    revert();
    close();
  }
  function onDialogClose() {
    if (!handled) revert();
    handled = false;
  }

  async function save() {
    if (!event || saving) return;
    saving = true;
    try {
      const { booking } = await fetchJson<{ ok: boolean; booking: { id: string } | null }>(
        `/api/scheduling/bookings/${event.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            start: newStart,
            end: newEnd,
            ...(newResourceId ? { resourceId: newResourceId } : {}),
          }),
        },
      );
      if (!booking) throw new Error('booking not found after reschedule');
      handled = true;
      onSaved(booking.id, {
        start: newStart,
        end: newEnd,
        ...(newResource
          ? {
              resourceId: newResource.id,
              resourceName: newResource.name,
              resourceColor: newResource.color,
            }
          : {}),
      });
      close();
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'conflict') {
        toastError(m.sched_cal_move_conflict(), e.message);
      } else {
        toastError(m.sched_cal_move_error());
      }
      handled = true;
      revert();
      close();
    } finally {
      saving = false;
    }
  }
</script>

<Dialog bind:open title={m.sched_cal_move_title()} size="sm" onclose={onDialogClose}>
  {#if event}
    <div class="mv">
      <div class="mv-row">
        <span class="mv-label">{m.sched_cal_service()}</span><span>{event.eventTypeTitle}</span>
      </div>
      {#if event.attendeeName}
        <div class="mv-row">
          <span class="mv-label">{m.sched_cal_client()}</span><span>{event.attendeeName}</span>
        </div>
      {/if}
      <div class="mv-row mv-time">
        <span class="mv-old">{rangeLabel(oldStart, oldEnd)}</span>
        <span class="mv-arrow">→</span>
        <span class="mv-new">{rangeLabel(newStart, newEnd)}</span>
      </div>
      {#if newResource}
        <div class="mv-row mv-time">
          <span class="mv-old">{event.resourceName}</span>
          <span class="mv-arrow">→</span>
          <span class="mv-new">{newResource.name}</span>
        </div>
      {/if}
    </div>
  {/if}
  {#snippet footer()}
    <Button variant="ghost" size="sm" disabled={saving} onclick={cancel}>{m.sched_cancel()}</Button>
    <Button variant="primary" size="sm" loading={saving} onclick={save}
      >{m.sched_cal_move_save()}</Button
    >
  {/snippet}
</Dialog>

<style>
  .mv {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .mv-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .mv-label {
    color: var(--color-text-secondary);
    min-width: 5rem;
  }
  .mv-time {
    font-variant-numeric: tabular-nums;
  }
  .mv-old {
    color: var(--color-text-secondary);
    text-decoration: line-through;
  }
  .mv-new {
    color: var(--color-accent);
    font-weight: 600;
  }
  .mv-arrow {
    color: var(--color-text-secondary);
  }
</style>
