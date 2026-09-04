<script lang="ts">
  // One person's day track; mirrors the header scroller's offset (no scrollbar
  // of its own). Each day is a grid cell with fixed lanes — leave on top,
  // bookings below — so a multi-day leave reads as one continuous bar and the
  // lanes stay aligned across consecutive days. A filled cell gets ONE tooltip
  // listing everything in it; empty cells get none.
  import { Tooltip, Badge } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { DAY_PX, type Timeline } from './timeline.svelte';

  let {
    tl,
    employeeId,
    resourceId,
    color,
  }: { tl: Timeline; employeeId: string; resourceId: string | null; color: string } = $props();

  const STATUS_LABEL = {
    pending: m.team_leave_pending,
    approved: m.team_leave_approved,
    rejected: m.team_leave_rejected,
    cancelled: m.team_leave_cancelled,
  } as const;
  const hhmm = (iso: string) =>
    new Date(iso).toLocaleTimeString(tl.locale, { hour: '2-digit', minute: '2-digit' });
</script>

<div class="tl-row" onwheel={(e) => tl.wheel(e)}>
  <div
    class="track"
    style:width="{tl.count * DAY_PX}px"
    style:transform="translateX(-{tl.offset}px)"
  >
    {#each tl.days as d (d.key)}
      {@const lv = tl.leaveAt(employeeId, d.key)}
      {@const bk = tl.bookingsAt(resourceId, d.key)}
      <div class="d" class:today={d.today} class:off={d.off || !!d.holiday} class:ms={d.monthStart}>
        {#if lv || bk.length}
          <Tooltip placement="top">
            {#snippet content()}
              <div class="tip">
                {#if lv}
                  <div class="tip-row">
                    <Badge
                      variant="semantic"
                      value={lv.status === 'approved' ? 'success' : 'warning'}
                      size="sm"
                      dot
                    >
                      {STATUS_LABEL[lv.status]()}
                    </Badge>
                    <span>{tl.leaveTypeName(lv.request.leaveTypeId)}</span>
                    <span class="tabular-nums dim">
                      {lv.request.fromDate}{lv.request.toDate !== lv.request.fromDate
                        ? ` → ${lv.request.toDate}`
                        : ''}
                    </span>
                  </div>
                {/if}
                {#each bk as b (b.id)}
                  <div class="tip-row">
                    <span class="tabular-nums dim">{hhmm(b.start)}</span>
                    <span>{tl.eventTitle(b.eventTypeId)}</span>
                    {#if b.attendeeName}<span class="dim">· {b.attendeeName}</span>{/if}
                  </div>
                {/each}
              </div>
            {/snippet}
            <div class="lanes">
              <span
                class="lane lv {lv?.status ?? ''}"
                class:on={!!lv}
                class:first={lv?.first}
                class:last={lv?.last}
              ></span>
              <span class="lane bk" class:on={bk.length > 0} style:--c={color}>
                {#if bk.length}{bk.length}{/if}
              </span>
            </div>
          </Tooltip>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .tl-row {
    width: 100%;
    overflow: hidden;
  }
  .track {
    display: flex;
    will-change: transform;
  }
  /* One bordered cell per day — the grid the eye tracks allocations on. */
  .d {
    flex: 0 0 auto;
    width: 2.5rem;
    height: 2.5rem;
    box-sizing: border-box;
    border-right: 1px solid var(--color-border);
    background: var(--color-surface-1);
  }
  .d.ms {
    border-left: 1px solid var(--color-border-strong);
  }
  .d.off {
    background: var(--color-surface-2);
  }
  .d.today {
    background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  }
  /* The Tooltip's trigger span wraps the lanes; both fill the cell so hover = the cell. */
  .d > :global(span) {
    display: block;
    width: 100%;
    height: 100%;
  }
  .lanes {
    display: grid;
    grid-template-rows: 1fr 1fr;
    gap: var(--space-0-5);
    height: 100%;
    padding: var(--space-0-5) 0;
    box-sizing: border-box;
  }
  .lane {
    display: block;
    min-height: 0;
  }
  /* Leave lane: continuous across days; rounded + inset only at the true ends. */
  .lv.on {
    background: var(--color-success-fg);
  }
  .lv.on.pending {
    background: var(--color-warning-fg);
    opacity: 0.7;
  }
  .lv.first {
    border-top-left-radius: var(--radius-full);
    border-bottom-left-radius: var(--radius-full);
    margin-left: var(--space-1);
  }
  .lv.last {
    border-top-right-radius: var(--radius-full);
    border-bottom-right-radius: var(--radius-full);
    margin-right: var(--space-1);
  }
  /* Bookings lane: count pill in the person's colour. */
  .bk.on {
    justify-self: center;
    min-width: 1.25rem;
    padding: 0 var(--space-1);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--c) 18%, transparent);
    color: var(--c);
    font-size: var(--font-size-telemetry);
    font-weight: 600;
    text-align: center;
    line-height: 1rem;
    font-variant-numeric: tabular-nums;
  }
  .tip {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-width: 18rem;
  }
  .tip-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-caption);
  }
  .dim {
    color: var(--color-text-secondary);
  }
</style>
