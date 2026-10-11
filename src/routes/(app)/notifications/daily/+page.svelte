<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import type { PageData } from './$types';
  import { CalendarDays } from 'lucide-svelte';
  import { PageHeader, iconSizes } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';

  let { data }: { data: PageData } = $props();
  const view = $derived(data.view);

  function fmtTime(iso: string): string {
    return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
</script>

<PageShell archetype="collection" scroll="page" labelledBy="daily-feed-title">
  <PageHeader titleId="daily-feed-title" title={m.inbox_daily_title()} subtitle={view.date}>
    {#snippet leading()}<CalendarDays size={iconSizes.md} class="shrink-0 text-accent" />{/snippet}
  </PageHeader>

  <PageBody width="content">
    <section class="daily-section">
      <h2>{m.inbox_dailyAppointments()}</h2>
      {#if view.appointmentsByStaff.length === 0}
        <p class="daily-empty">{m.inbox_dailyNoAppointments()}</p>
      {:else}
        {#each view.appointmentsByStaff as staff (staff.staffId ?? staff.staffName)}
          <div class="daily-staff-block">
            <strong>{staff.staffName}</strong>
            <ul>
              {#each staff.appointments as appt (appt.id)}
                <li>
                  {fmtTime(appt.startTime)}–{fmtTime(appt.endTime)} · {appt.title ?? appt.status}
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      {/if}
    </section>

    <section class="daily-section">
      <h2>{m.inbox_dailySales()}</h2>
      <p>
        {#if view.yesterdaySales.total}{view.yesterdaySales.total} ·
        {/if}{view.yesterdaySales.count}
      </p>
    </section>

    <section class="daily-section">
      <h2>{m.inbox_dailyPending()}</h2>
      {#if view.pending.unscheduledPaidServices.length === 0 && view.pending.completedUnpaidVisits.length === 0 && view.pending.openShifts.length === 0}
        <p class="daily-empty">{m.inbox_dailyNoData()}</p>
      {:else}
        {#if view.pending.unscheduledPaidServices.length > 0}
          <div class="daily-pending-group">
            <strong>{m.inbox_dailyUnscheduled()}</strong>
            <ul>
              {#each view.pending.unscheduledPaidServices as line (line.lineId)}
                <li>{line.description}</li>
              {/each}
            </ul>
          </div>
        {/if}
        {#if view.pending.completedUnpaidVisits.length > 0}
          <div class="daily-pending-group">
            <strong>{m.inbox_dailyUnpaidVisits()}</strong>
            <ul>
              {#each view.pending.completedUnpaidVisits as visit (visit.bookingId)}
                <li>{fmtTime(visit.endTime)}</li>
              {/each}
            </ul>
          </div>
        {/if}
        {#if view.pending.openShifts.length > 0}
          <div class="daily-pending-group">
            <strong>{m.inbox_dailyOpenShifts()}</strong>
            <ul>
              {#each view.pending.openShifts as shift (shift.shiftId)}
                <li>{fmtTime(shift.openedAt)}</li>
              {/each}
            </ul>
          </div>
        {/if}
      {/if}
    </section>
  </PageBody>
</PageShell>

<style>
  .daily-section {
    display: grid;
    gap: var(--space-2, 8px);
    margin-bottom: var(--space-6, 24px);
  }
  .daily-section h2 {
    font-size: var(--font-size-body, 14px);
    font-weight: var(--font-weight-semibold, 600);
    color: var(--color-text-primary, var(--color-foreground));
  }
  .daily-empty,
  .daily-staff-block,
  .daily-pending-group {
    color: var(--color-text-tertiary, var(--color-muted-foreground));
    font-size: var(--font-size-caption, 12px);
  }
  .daily-staff-block strong,
  .daily-pending-group strong {
    color: var(--color-text-primary, var(--color-foreground));
  }
</style>
