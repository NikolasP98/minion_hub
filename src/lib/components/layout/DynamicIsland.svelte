<script lang="ts">
  import ProfileMenu from './ProfileMenu.svelte';
  import NotificationsPopup from './NotificationsPopup.svelte';
  import ConnectionStatusIndicator from './ConnectionStatusIndicator.svelte';
  import { Search, Bug, Bell } from 'lucide-svelte';
  import { togglePalette } from '$lib/state/ui/command-palette.svelte';
  import { captureSnapshot, bugReporter } from '$lib/state/ui/bug-reporter.svelte';
  import { notifications, refreshNotifications } from '$lib/state/features/notifications.svelte';
  import { ui } from '$lib/state/ui/ui.svelte';
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import { Button } from '$lib/components/ui';
  import {
    setRevealIntent,
    shouldExpandIsland,
    settleRevealTransition,
    type RevealGate,
  } from './dynamic-island-reveal';

  let notificationsOpen = $state(false);
  let statusPopoverOpen = $state(false);
  let pointerInside = $state(false);
  let focusInside = $state(false);
  let reveal = $state<RevealGate>({ intent: false, complete: false });
  const expanded = $derived(
    shouldExpandIsland(pointerInside, focusInside, statusPopoverOpen, notificationsOpen),
  );

  $effect(() => {
    if (reveal.intent === expanded && reveal.complete === expanded) return;

    const next = setRevealIntent(
      reveal,
      expanded,
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
    if (next.intent !== reveal.intent || next.complete !== reveal.complete) reveal = next;
  });

  function onIslandMouseEnter() {
    pointerInside = true;
  }

  function onIslandMouseLeave() {
    pointerInside = false;
  }

  function onIslandFocusIn() {
    focusInside = true;
  }

  function onIslandFocusOut(event: FocusEvent) {
    const island = event.currentTarget as HTMLElement;
    focusInside = event.relatedTarget instanceof Node && island.contains(event.relatedTarget);
  }

  function onRevealTransitionEnd(event: TransitionEvent) {
    if (event.target !== event.currentTarget || event.propertyName !== 'grid-template-columns')
      return;
    reveal = settleRevealTransition(reveal);
  }

  onMount(() => {
    refreshNotifications();
    const interval = setInterval(refreshNotifications, 60_000);
    return () => clearInterval(interval);
  });
</script>

{#snippet bell()}
  <div class="relative">
    <Button
      variant="ghost"
      size="xs"
      type="button"
      onclick={() => (notificationsOpen = !notificationsOpen)}
      class="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-bg3 transition-colors duration-[150ms] relative"
      aria-label="{notifications.badgeCount} notifications"
      title="Notifications"
      aria-expanded={notificationsOpen}
    >
      <Bell size={14} />
      {#if notifications.hasPending}
        <span
          class="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full bg-destructive text-[length:var(--font-size-telemetry)] font-bold text-accent-foreground leading-none"
        >
          {notifications.badgeCount > 99 ? '99+' : notifications.badgeCount}
        </span>
      {/if}
    </Button>
    <NotificationsPopup bind:open={notificationsOpen} />
  </div>
{/snippet}

<!-- Collapsed at rest to just search + avatar (+ bell when a notification is
     pending). Hover / keyboard focus reveals the rest, left→right:
     bug · notif · search · avatar. -->
<div
  class="island group hidden md:flex fixed top-[env(safe-area-inset-top,0px)] right-[env(safe-area-inset-right,0px)] z-[var(--layer-navigation,20)] items-center gap-0.5 h-9 pl-2 pr-2 rounded-bl-[var(--radius-xl)]
         bg-bg2/85 backdrop-blur-xl border-b border-l border-[var(--elevation-3-border)] shadow-sm
         transition-[box-shadow,border-color] duration-[var(--duration-normal)] ease-[var(--ease-standard)]"
  role="group"
  aria-label={m.topbar_quickActions()}
  class:expanded
  onmouseenter={onIslandMouseEnter}
  onmouseleave={onIslandMouseLeave}
  onfocusin={onIslandFocusIn}
  onfocusout={onIslandFocusOut}
>
  <!-- Connection status dot — always visible at the far left. Hovering it opens
       the status popover (uptime / reconnecting / error detail) to its left. -->
  <div class="ml-1 mr-0.5">
    <ConnectionStatusIndicator popoverEnabled={reveal.complete} bind:open={statusPopoverOpen} />
  </div>

  <!-- Hover-revealed cluster: bug and (when nothing is pending) the bell. -->
  <div class="ci" ontransitionend={onRevealTransitionEnd}>
    <!-- `overflow: hidden` (needed for the 0fr collapse animation) clips the
         notifications popup, which renders as an absolutely positioned child
         of this cluster — lift it while the popup is open. -->
    <div
      class="ci-inner flex items-center gap-0.5"
      class:popup-open={ui.dropdownOpen || notificationsOpen}
    >
      <div class="w-px h-4 bg-[var(--hairline)] mx-0.5"></div>

      <Button
        variant="ghost"
        size="xs"
        onclick={() => captureSnapshot()}
        disabled={bugReporter.phase === 'capturing'}
        class="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-bg3 transition-colors duration-[150ms] disabled:opacity-50 disabled:cursor-wait"
        aria-label={m.bug_reportButton()}
        title={m.bug_reportButton()}
      >
        <Bug size={15} />
      </Button>

      {#if !notifications.hasPending}{@render bell()}{/if}
    </div>
  </div>

  <!-- Pending notification stays visible at rest. -->
  {#if notifications.hasPending}{@render bell()}{/if}

  <Button
    variant="ghost"
    size="xs"
    type="button"
    onclick={() => togglePalette()}
    class="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-bg3 transition-colors duration-[150ms]"
    aria-label="Open command palette (⌘K)"
    title="Search · ⌘K"
  >
    <Search size={14} />
  </Button>

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
      grid-template-columns var(--duration-normal) var(--ease-standard),
      opacity var(--duration-fast) var(--ease-standard);
  }
  .island.expanded .ci {
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
