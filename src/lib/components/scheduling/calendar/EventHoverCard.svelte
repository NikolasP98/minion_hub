<script lang="ts">
  // ONE floating hover card instance, shared by every event on the calendar —
  // SchedulingCalendar anchors it to `info.el` on eventMouseEnter and clears it
  // on eventMouseLeave. (Pass 1 wrapped each chip in its own Zag Tooltip; the
  // library renders chips as raw HTML via `eventContent`, so there's no Svelte
  // element per chip to attach a Tooltip trigger to — one positioned card is
  // simpler and cheaper than mounting N tooltip instances.)
  import { Chip } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { hhmm } from './calendar.svelte';
  import type { CalEvent, CalKind } from './types';

  let {
    event,
    kind,
    anchor,
    showInheritedTags = true,
  }: {
    event: CalEvent | null;
    kind: CalKind | undefined;
    anchor: HTMLElement | null;
    /** When false, contact/product-inherited tags are omitted (own tags always show). */
    showInheritedTags?: boolean;
  } = $props();

  let pos = $state<{ top: number; left: number; above: boolean } | null>(null);
  $effect(() => {
    if (!anchor || !event) {
      pos = null;
      return;
    }
    const r = anchor.getBoundingClientRect();
    const above = r.top > window.innerHeight / 2;
    pos = {
      top: above ? r.top - 6 : r.bottom + 6,
      left: Math.min(r.left, window.innerWidth - 336),
      above,
    };
  });

  const durationMin = $derived(
    event ? Math.round((Date.parse(event.end) - Date.parse(event.start)) / 60_000) : 0,
  );
  const durationLabel = $derived(
    durationMin >= 60
      ? `${Math.floor(durationMin / 60)}h${durationMin % 60 ? ` ${durationMin % 60}m` : ''}`
      : `${durationMin}m`,
  );
  const statusLabel: Record<string, string> = {
    accepted: m.sched_cal_status_accepted(),
    pending: m.sched_cal_status_pending(),
    completed: m.sched_cal_status_completed(),
    cancelled: m.sched_cal_status_cancelled(),
    no_show: m.sched_cal_status_no_show(),
  };
</script>

{#if event && pos}
  <div
    class="hc"
    class:above={pos.above}
    style:top="{pos.top}px"
    style:left="{pos.left}px"
    style:z-index="var(--layer-popover)"
  >
    <div class="hc-row hc-time">
      <span>{hhmm(event.start)}–{hhmm(event.end)}</span>
      <span class="hc-dim">· {durationLabel}</span>
    </div>
    {#if kind}
      <div class="hc-row">
        <span class="hc-dot" style:background={kind.color}></span>
        <span>{kind.name}</span>
      </div>
    {/if}
    <div class="hc-row">
      <span class="hc-label">{m.sched_cal_service()}</span><span>{event.eventTypeTitle}</span>
    </div>
    {#if event.attendeeName}
      <div class="hc-row">
        <span class="hc-label">{m.sched_cal_client()}</span><span>{event.attendeeName}</span>
      </div>
    {/if}
    {#if showInheritedTags && event.contactTags.length}
      <div class="hc-tags">
        <span class="hc-tags-origin">{m.calendar_tag_origin_contact()}</span>
        {#each event.contactTags as t (t.id)}
          <Chip
            ><span class="hc-tag-dot" style:background={t.color ?? 'var(--color-accent)'}
            ></span>{t.name}</Chip
          >
        {/each}
      </div>
    {/if}
    {#if event.tags.length}
      <div class="hc-tags">
        <span class="hc-tags-origin">{m.calendar_tag_origin_own()}</span>
        {#each event.tags as t (t.id)}
          <Chip
            ><span class="hc-tag-dot" style:background={t.color ?? 'var(--color-accent)'}
            ></span>{t.name}</Chip
          >
        {/each}
      </div>
    {/if}
    <div class="hc-row">
      <span class="hc-label">{m.sched_cal_staff_one()}</span><span>{event.resourceName}</span>
    </div>
    {#if event.productName}
      <div class="hc-row">
        <span class="hc-label">{m.sched_cal_product()}</span><span>{event.productName}</span>
      </div>
    {/if}
    {#if showInheritedTags && event.productTags.length}
      <div class="hc-tags">
        <span class="hc-tags-origin">{m.calendar_tag_origin_service()}</span>
        {#each event.productTags as t (t.id)}
          <Chip
            ><span class="hc-tag-dot" style:background={t.color ?? 'var(--color-accent)'}
            ></span>{t.name}</Chip
          >
        {/each}
      </div>
    {/if}
    <div class="hc-row">
      <span class="hc-label">{m.sched_cal_status()}</span><span
        >{statusLabel[event.status] ?? event.status}</span
      >
    </div>
    {#if event.notes}<div class="hc-row hc-notes">{event.notes}</div>{/if}
    <div class="hc-links">
      <a class="hc-link" href="/scheduling/bookings?focus={event.id}"
        >{m.sched_cal_open_booking()}</a
      >
      <a class="hc-link" href="/scheduling/bookings/{event.id}/edit">{m.sched_edit_booking()}</a>
    </div>
  </div>
{/if}

<style>
  .hc {
    position: fixed;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 14rem;
    max-width: 20rem;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-2);
    pointer-events: none;
  }
  .hc.above {
    transform: translateY(-100%);
  }
  .hc-row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-wrap: wrap;
  }
  .hc-time {
    font-weight: 600;
  }
  .hc-dim {
    color: var(--color-text-secondary);
  }
  .hc-label {
    color: var(--color-text-secondary);
    min-width: 4rem;
  }
  .hc-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
  }
  .hc-tag-dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    display: inline-block;
  }
  .hc-tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
  }
  .hc-tags-origin {
    font-size: var(--font-size-telemetry);
    color: var(--color-text-secondary);
  }
  .hc-notes {
    color: var(--color-text-secondary);
    font-style: italic;
  }
  .hc-links {
    display: flex;
    gap: var(--space-3);
  }
  .hc-link {
    margin-top: var(--space-1);
    color: var(--color-accent);
    font-weight: 500;
    pointer-events: auto;
  }
  .hc-link:hover {
    text-decoration: underline;
  }
</style>
