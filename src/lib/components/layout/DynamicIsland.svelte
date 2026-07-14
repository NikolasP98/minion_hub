<script lang="ts">
  import ProfileMenu from './ProfileMenu.svelte';
  import NotificationsPopup from './NotificationsPopup.svelte';
  import ConnectionStatusIndicator from './ConnectionStatusIndicator.svelte';
  import HostPill from '../hosts/HostPill.svelte';
  import { Search, Bug, Bell } from 'lucide-svelte';
  import { togglePalette } from '$lib/state/ui/command-palette.svelte';
  import { captureSnapshot, bugReporter } from '$lib/state/ui/bug-reporter.svelte';
  import { notifications, refreshNotifications } from '$lib/state/features/notifications.svelte';
  import { ui } from '$lib/state/ui/ui.svelte';
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';

  let notificationsOpen = $state(false);

  onMount(() => {
    refreshNotifications();
    const interval = setInterval(refreshNotifications, 60_000);
    return () => clearInterval(interval);
  });
</script>

{#snippet bell()}
  <div class="relative">
    <button
      type="button"
      onclick={() => (notificationsOpen = !notificationsOpen)}
      class="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors duration-[150ms] relative"
      aria-label="{notifications.badgeCount} notifications"
      title="Notifications"
      aria-expanded={notificationsOpen}
    >
      <Bell size={14} />
      {#if notifications.hasPending}
        <span
          class="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full bg-red-500 text-[9px] font-bold text-white leading-none"
        >
          {notifications.badgeCount > 99 ? '99+' : notifications.badgeCount}
        </span>
      {/if}
    </button>
    <NotificationsPopup bind:open={notificationsOpen} />
  </div>
{/snippet}

<!-- Collapsed at rest to just search + avatar (+ bell when a notification is
     pending). Hover / keyboard focus reveals the rest, left→right:
     host · bug · notif · search · avatar. -->
<div
  class="island group hidden md:flex fixed top-[env(safe-area-inset-top,0px)] right-[env(safe-area-inset-right,0px)] z-[var(--layer-navigation,20)] items-center gap-0.5 h-9 pl-2 pr-2 rounded-bl-[var(--radius-xl)]
         bg-bg2/85 backdrop-blur-xl border-b border-l border-[var(--elevation-3-border)] shadow-sm
         transition-[box-shadow,border-color] duration-[200ms] ease-[cubic-bezier(0.2,0,0,1)]"
  aria-label="Quick actions"
>
  <!-- Connection status dot — always visible at the far left. Hovering it opens
       the status popover (uptime / reconnecting / error detail) to its left. -->
  <div class="ml-1 mr-0.5">
    <ConnectionStatusIndicator />
  </div>

  <!-- Hover-revealed cluster: host pill, bug, and (when nothing is pending) the bell. -->
  <div class="ci">
    <!-- `overflow: hidden` (needed for the 0fr collapse animation) clips the
         host dropdown / notifications popup, which render as absolutely
         positioned children of this cluster — lift it while a popup is open. -->
    <div
      class="ci-inner flex items-center gap-0.5"
      class:popup-open={ui.dropdownOpen || notificationsOpen}
    >
      <HostPill align="right" dot={false} />

      <div class="w-px h-4 bg-[var(--hairline)] mx-0.5"></div>

      <button
        onclick={() => captureSnapshot()}
        disabled={bugReporter.phase === 'capturing'}
        class="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors duration-[150ms] disabled:opacity-50 disabled:cursor-wait"
        aria-label={m.bug_reportButton()}
        title={m.bug_reportButton()}
      >
        <Bug size={15} />
      </button>

      {#if !notifications.hasPending}{@render bell()}{/if}
    </div>
  </div>

  <!-- Pending notification stays visible at rest. -->
  {#if notifications.hasPending}{@render bell()}{/if}

  <button
    type="button"
    onclick={() => togglePalette()}
    class="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors duration-[150ms]"
    aria-label="Open command palette (⌘K)"
    title="Search · ⌘K"
  >
    <Search size={14} />
  </button>

  <div class="w-px h-4 bg-[var(--hairline)] mx-0.5"></div>

  <div class="flex items-center">
    <ProfileMenu />
  </div>
</div>

<style>
  /* 0fr → 1fr collapse: fully removes width when hidden, animates smoothly. */
  .ci {
    display: grid;
    grid-template-columns: 0fr;
    opacity: 0;
    transition:
      grid-template-columns 220ms cubic-bezier(0.2, 0, 0, 1),
      opacity 160ms ease;
  }
  .island:hover .ci,
  .island:focus-within .ci {
    grid-template-columns: 1fr;
    opacity: 1;
  }
  .ci-inner {
    overflow: hidden;
    min-width: 0;
  }
  .ci-inner.popup-open {
    overflow: visible;
  }
</style>
