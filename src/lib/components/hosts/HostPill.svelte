<script lang="ts">
  import { Button } from '$lib/components/ui';
  import HostDropdown from './HostDropdown.svelte';
  import { getActiveHost } from '$lib/state/features/hosts.svelte';
  import { ui } from '$lib/state/ui/ui.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { isAdmin } from '$lib/state/features/user.svelte';
  import * as m from '$lib/paraglide/messages';

  // `align` controls which edge the switcher dropdown anchors to — the notch
  // lives at the top-right so it opens right-aligned; the mobile topbar is
  // left-aligned.
  // `dot` renders the leading status dot. The DynamicIsland surfaces its own
  // ConnectionStatusIndicator dot at the far left, so it hides this one to
  // avoid doubling up. The uptime / reconnecting / error DETAIL now lives in
  // that indicator's hover popover — the picker itself no longer tooltips.
  let { align = 'left', dot = true }: { align?: 'left' | 'right'; dot?: boolean } = $props();

  const activeHost = $derived(getActiveHost());
  const connected = $derived(conn.connected);
  // Gateway plumbing is admin-only: regular users never pick (or even see)
  // which instance they're on — org assignment / the balancer decides.
  // The pill renders nothing for non-admins.
  const canSwitch = $derived(isAdmin.value);

  // Three-state dot (matches ConnectionStatusIndicator): green connected,
  // amber connecting, red disconnected/error.
  const dotClass = $derived(
    connected
      ? 'bg-success shadow-[var(--shadow-status-glow)]'
      : conn.connecting
        ? 'bg-warning shadow-[var(--shadow-status-glow)] animate-pulse'
        : 'bg-destructive shadow-[var(--shadow-status-glow)] animate-pulse',
  );

  const label = $derived(
    activeHost
      ? `${activeHost.name} · ${connected ? 'Connected' : conn.connecting ? 'Reconnecting' : 'Disconnected'}`
      : 'No server connected',
  );

  function handlePillClick(e: MouseEvent) {
    e.stopPropagation();
    if (!canSwitch) return;
    if (!activeHost) {
      ui.overlayOpen = true;
    } else {
      ui.dropdownOpen = !ui.dropdownOpen;
    }
  }
</script>

<svelte:document
  onclick={() => {
    ui.dropdownOpen = false;
  }}
/>

{#if canSwitch}
  <Button
    variant="ghost"
    type="button"
    class="relative flex items-center gap-1.5 h-6 px-1.5 max-w-[160px] rounded-[var(--radius-sm)] text-[length:var(--font-size-caption)] font-medium transition-colors whitespace-nowrap select-none {canSwitch
      ? 'cursor-pointer'
      : 'cursor-default'} {!activeHost ? 'text-accent' : 'text-muted-foreground'} {canSwitch
      ? !activeHost
        ? 'hover:bg-foreground/[0.05]'
        : 'hover:text-foreground hover:bg-foreground/[0.04]'
      : ''}"
    onclick={handlePillClick}
    aria-label={label}
    aria-haspopup={canSwitch && activeHost ? 'menu' : undefined}
  >
    {#if activeHost}
      {#if dot}
        <span class="w-1.5 h-1.5 rounded-full shrink-0 transition-colors {dotClass}"></span>
      {/if}
      <span class="flex-1 overflow-hidden text-ellipsis text-left">{activeHost.name}</span>
      {#if canSwitch}
        <span class="opacity-40 text-[length:var(--font-size-telemetry)] shrink-0">▾</span>
      {/if}
    {:else}
      {#if dot}
        <span
          class="w-1.5 h-1.5 rounded-full shrink-0 bg-warning shadow-[var(--shadow-status-glow)] animate-pulse"
        ></span>
      {/if}
      <span>{canSwitch ? m.hosts_addHost() : 'No server'}</span>
    {/if}

    {#if ui.dropdownOpen && activeHost && canSwitch}
      <HostDropdown {align} />
    {/if}
  </Button>
{/if}
