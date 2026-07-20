<script lang="ts">
  import { Button, SegmentedControl } from '$lib/components/ui';
  import type { SegmentItem } from '$lib/components/ui/SegmentedControl.svelte';
  import { hostsState, selectChannel } from '$lib/state/features/hosts.svelte';
  import { ui } from '$lib/state/ui/ui.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { isAdmin } from '$lib/state/features/user.svelte';
  import { wsConnect, wsDisconnect } from '$lib/services/gateway.svelte';
  import * as m from '$lib/paraglide/messages';

  // This is a BUILD picker, not a host picker (spec 2026-07-19 §D1). It renders
  // the CHANNEL — DEV | PRD — because the instance behind a channel is resolved
  // server-side by the lease and is none of the user's business. The host name
  // is exactly the identity that must stop being surfaced: two routes to one
  // service once presented as two instances and cost a day of debugging.
  //
  // `align` was the dropdown anchor edge; the dropdown is gone (the segmented
  // control sits inline) but the prop is kept so callers don't need editing.
  // `dot` renders the leading status dot — the DynamicIsland surfaces its own
  // ConnectionStatusIndicator and hides this one to avoid doubling up.
  let { align: _align = 'left', dot = true }: { align?: 'left' | 'right'; dot?: boolean } =
    $props();

  const connected = $derived(conn.connected);
  // Gateway plumbing is admin-only: regular users never pick a channel — the
  // org's assignment decides. The control renders nothing for non-admins.
  const canSwitch = $derived(isAdmin.value);

  const channels = $derived(hostsState.channels);
  const active = $derived(hostsState.activeChannel);
  const activeEndpoint = $derived(channels.find((c) => c.channel === active) ?? null);

  // Three-state dot (matches ConnectionStatusIndicator): green connected,
  // amber connecting, red disconnected/error.
  const dotClass = $derived(
    connected
      ? 'bg-success shadow-[var(--shadow-status-glow)]'
      : conn.connecting
        ? 'bg-warning shadow-[var(--shadow-status-glow)] animate-pulse'
        : 'bg-destructive shadow-[var(--shadow-status-glow)] animate-pulse',
  );

  const items = $derived<SegmentItem[]>(
    channels.map((c) => ({
      value: c.channel,
      label: c.channel.toUpperCase(),
      // An unhealthy channel stays SELECTABLE — the user may well be switching
      // to it precisely to see what is wrong. It just says so.
      title: c.healthy === false ? m.hosts_channelUnavailable({ channel: c.channel }) : undefined,
    })),
  );

  function onChannel(next: string) {
    if (next === active) return;
    if (!selectChannel(next as 'dev' | 'prd')) return;
    wsDisconnect();
    void wsConnect();
  }
</script>

{#if canSwitch && channels.length > 0}
  <div class="pill">
    {#if dot}
      <span class="dot {dotClass}" aria-hidden="true"></span>
    {/if}
    {#if channels.length > 1}
      <!-- Governed control for a small mutually-exclusive choice; never a row of
           primary/ghost Buttons. -->
      <SegmentedControl
        {items}
        value={active ?? items[0]?.value}
        aria-label={m.hosts_buildChannel()}
        onValueChange={onChannel}
      />
    {:else}
      <!-- One channel (FACES) ⇒ nothing to pick, so no control — just the label. -->
      <span class="solo t-label">{channels[0].channel.toUpperCase()}</span>
    {/if}
    {#if activeEndpoint?.healthy === false}
      <!-- §F4: never present a silent partial recovery. If the lease moved, the
           org's WhatsApp pairing did NOT move with it. -->
      <span class="warn t-caption" title={m.hosts_channelStateNotMoved()}>
        {m.hosts_channelUnavailable({ channel: activeEndpoint.channel })}
      </span>
    {/if}
  </div>
{:else if canSwitch}
  <!-- No gateway reachable by this org at all — the add-a-gateway affordance. -->
  <div class="pill">
    {#if dot}
      <span class="dot bg-warning shadow-[var(--shadow-status-glow)] animate-pulse"></span>
    {/if}
    <Button variant="ghost" size="sm" type="button" onclick={() => (ui.overlayOpen = true)}>
      {m.hosts_addHost()}
    </Button>
  </div>
{/if}

<style>
  .pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    white-space: nowrap;
    user-select: none;
  }
  .dot {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    flex-shrink: 0;
    transition: background-color var(--duration-fast) var(--ease-standard);
  }
  .solo {
    color: var(--color-text-secondary);
    letter-spacing: 0.06em;
  }
  .warn {
    color: var(--color-warning-fg);
  }
</style>
