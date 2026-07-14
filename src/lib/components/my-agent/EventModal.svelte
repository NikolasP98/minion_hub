<script lang="ts">
  import { Button } from '$lib/components/ui';

  import * as m from '$lib/paraglide/messages';
  import Modal from '$lib/components/ui/Modal.svelte';
  import {
    Calendar,
    Clock,
    MapPin,
    Repeat,
    ExternalLink,
    Check,
    HelpCircle,
    X,
    Pencil,
    Trash2,
    Sparkles,
  } from 'lucide-svelte';
  import type { CalendarItem } from '$lib/services/my-agent-rpc';

  interface Props {
    item: CalendarItem | null;
    open?: boolean;
    onclose?: () => void;
    /**
     * Hand a well-formed request to the agent (which holds gws calendar tools).
     * Used for RSVP / edit / cancel until one-click gateway RPCs land (Phase 2).
     */
    onask?: (prompt: string) => void;
  }

  let { item, open = $bindable(false), onclose, onask }: Props = $props();

  const title = $derived(item?.title?.trim() || '(untitled event)');

  const start = $derived(item ? new Date(item.startsAt) : null);
  const end = $derived(item ? new Date(item.endsAt) : null);

  const whenLabel = $derived.by(() => {
    if (!start || Number.isNaN(start.getTime())) return '';
    const dateStr = start.toLocaleDateString([], {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    if (item?.isAllDay) return `${dateStr} · All day`;
    const startTime = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const endTime =
      end && !Number.isNaN(end.getTime())
        ? end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : '';
    return endTime ? `${dateStr} · ${startTime} – ${endTime}` : `${dateStr} · ${startTime}`;
  });

  const rsvp = $derived(item?.responseStatus ?? null);
  const rsvpLabel = $derived.by(() => {
    switch (rsvp) {
      case 'accepted':
        return m.event_repliedGoing();
      case 'declined':
        return m.event_repliedDeclined();
      case 'tentative':
        return m.event_repliedMaybe();
      case 'needsAction':
        return m.event_awaitingRsvp();
      default:
        return null;
    }
  });

  function ask(prompt: string) {
    onask?.(prompt);
    open = false;
    onclose?.();
  }

  function openInGoogle() {
    if (item?.htmlLink) window.open(item.htmlLink, '_blank', 'noopener');
  }
</script>

<Modal bind:open {title} size="md" {onclose}>
  {#snippet header()}
    <div class="hdr">
      <h2 class="hdr-title" {title}>{title}</h2>
      {#if item?.htmlLink}
        <Button
          type="button"
          class="hdr-open"
          onclick={openInGoogle}
          title={m.event_openInGoogleCalendar()}
          aria-label={m.event_openInGoogleCalendar()}
        >
          <ExternalLink size={14} />
        </Button>
      {/if}
    </div>
  {/snippet}

  {#if item}
    <div class="body">
      <div class="row">
        <Calendar size={15} class="ic" />
        <span class="val">{whenLabel}</span>
      </div>

      {#if item.recurring}
        <div class="row">
          <Repeat size={15} class="ic" />
          <span class="val muted">{m.event_repeatingEvent()}</span>
        </div>
      {/if}

      {#if item.location}
        <div class="row">
          <MapPin size={15} class="ic" />
          <span class="val">{item.location}</span>
        </div>
      {/if}

      <div class="row">
        <Clock size={15} class="ic" />
        <span class="val muted">{item.sourceEmail}</span>
      </div>

      {#if rsvpLabel}
        <div class="rsvp-state">{rsvpLabel}</div>
      {/if}

      <!-- RSVP — handed to the agent (gws attendee-patch) until a direct RPC lands. -->
      <div class="section">
        <span class="section-label">{m.event_rsvp()}</span>
        <div class="btn-row">
          <Button
            type="button"
            class="chip yes {rsvp === 'accepted' ? 'active' : ''}"
            onclick={() =>
              ask(`RSVP "Yes / Going" to my calendar event "${title}" (${whenLabel}).`)}
          >
            <Check size={14} />
            {m.event_going()}
          </Button>
          <Button
            type="button"
            class="chip maybe {rsvp === 'tentative' ? 'active' : ''}"
            onclick={() =>
              ask(`RSVP "Maybe / Tentative" to my calendar event "${title}" (${whenLabel}).`)}
          >
            <HelpCircle size={14} />
            {m.event_maybe()}
          </Button>
          <Button
            type="button"
            class="chip no {rsvp === 'declined' ? 'active' : ''}"
            onclick={() =>
              ask(`RSVP "No / Decline" to my calendar event "${title}" (${whenLabel}).`)}
          >
            <X size={14} />
            {m.event_decline()}
          </Button>
        </div>
      </div>
    </div>
  {/if}

  {#snippet footer()}
    <div class="footer-actions">
      <Button
        type="button"
        class="icon-act"
        onclick={() =>
          ask(`Edit my calendar event "${title}" (${whenLabel}). Ask me what to change.`)}
        title={m.event_editEvent()}
        aria-label={m.event_editEvent()}
      >
        <Pencil size={16} />
      </Button>
      <Button
        type="button"
        class="icon-act danger"
        onclick={() =>
          ask(`Cancel my calendar event "${title}" (${whenLabel}). Confirm with me first.`)}
        title={m.event_cancelEvent()}
        aria-label={m.event_cancelEvent()}
      >
        <Trash2 size={16} />
      </Button>
    </div>
    <Button
      type="button"
      class="act primary"
      onclick={() =>
        ask(`Tell me about my event "${title}" (${whenLabel}) and what I should prepare.`)}
    >
      <Sparkles size={14} />
      {m.event_askAgent()}
    </Button>
  {/snippet}
</Modal>

<style>
  /* Header (corner Open icon) */
  .hdr {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .hdr-title {
    flex: 1;
    min-width: 0;
    font-size: var(--font-size-body);
    font-weight: 650;
    color: var(--color-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.hdr-open) {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: var(--radius-md, 6px);
    border: none;
    background: transparent;
    color: var(--color-muted-foreground);
    cursor: pointer;
    opacity: 0.55;
    transition:
      opacity var(--duration-fast) ease,
      background var(--duration-fast) ease,
      color var(--duration-fast) ease;
  }
  :global(.hdr-open):hover {
    opacity: 1;
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-body);
    color: var(--color-foreground);
  }
  .row :global(.ic) {
    flex-shrink: 0;
    color: var(--color-muted-foreground);
  }
  .val.muted,
  .muted {
    color: var(--color-muted);
  }
  .rsvp-state {
    font-size: var(--font-size-caption);
    color: var(--color-muted);
    padding: var(--space-0-5) 0;
  }
  .section {
    margin-top: var(--space-1);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .section-label {
    font-size: var(--font-size-caption);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-muted-foreground);
  }
  .btn-row {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  :global(.chip) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-body);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-foreground);
    cursor: pointer;
    transition:
      background var(--duration-fast) ease,
      border-color var(--duration-fast) ease;
  }
  :global(.chip):hover {
    background: color-mix(in srgb, var(--color-foreground) 5%, transparent);
  }
  :global(.chip.yes.active) {
    border-color: var(--color-success);
    color: var(--color-success);
    background: color-mix(in srgb, var(--color-success) 12%, transparent);
  }
  :global(.chip.maybe.active) {
    border-color: var(--color-warning);
    color: var(--color-warning);
    background: color-mix(in srgb, var(--color-warning) 12%, transparent);
  }
  :global(.chip.no.active) {
    border-color: var(--color-brand);
    color: var(--color-brand);
    background: color-mix(in srgb, var(--color-brand) 12%, transparent);
  }

  /* Icon footer cluster (left-aligned) */
  .footer-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-right: auto;
  }
  :global(.icon-act) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: var(--radius-md, 8px);
    border: 1px solid transparent;
    background: transparent;
    color: var(--color-muted-foreground);
    cursor: pointer;
    transition:
      background var(--duration-fast) ease,
      color var(--duration-fast) ease,
      border-color var(--duration-fast) ease;
  }
  :global(.icon-act):hover {
    color: var(--color-foreground);
    background: color-mix(in srgb, var(--color-foreground) 7%, transparent);
    border-color: var(--color-border);
  }
  :global(.icon-act.danger):hover {
    color: var(--color-brand);
    background: color-mix(in srgb, var(--color-brand) 12%, transparent);
    border-color: color-mix(in srgb, var(--color-brand) 40%, transparent);
  }

  :global(.act) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-body);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--theme-radius, 6px);
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-foreground);
    cursor: pointer;
    transition:
      background var(--duration-fast) ease,
      border-color var(--duration-fast) ease;
  }
  :global(.act):hover {
    background: color-mix(in srgb, var(--color-foreground) 5%, transparent);
  }
  :global(.act.primary) {
    border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
    color: var(--color-accent);
  }
  :global(.act.primary):hover {
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
</style>
