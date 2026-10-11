<script lang="ts">
  /**
   * Desktop utility cluster — status dot · bug · notifications · ⌘K · env ·
   * profile — pinned at the bottom of the sidebar (owner 2026-09-17: "remove
   * the top-right profile notch. Move its contents into the bottom of the
   * sidemenu"). Replaces DynamicIsland; the mobile Topbar keeps its own copy.
   * In the collapsed rail the cluster stacks vertically.
   */
  import { onMount } from 'svelte';
  import { Search, Bug, Bell } from 'lucide-svelte';
  import { Button, Spinner, iconSizes } from '$lib/components/ui';
  import { tryUseActions } from '$lib/services/actions/context';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import * as m from '$lib/paraglide/messages';
  import ProfileMenu from './ProfileMenu.svelte';
  import EnvBadge from './EnvBadge.svelte';
  import NotificationsPopup from './NotificationsPopup.svelte';
  import ConnectionStatusIndicator from './ConnectionStatusIndicator.svelte';
  import { togglePalette } from '$lib/state/ui/command-palette.svelte';
  import { captureSnapshot, bugReporter } from '$lib/state/ui/bug-reporter.svelte';
  import {
    notifications,
    subscribeNotificationsPolling,
  } from '$lib/state/features/notifications.svelte';

  let { collapsed = false }: { collapsed?: boolean } = $props();
  let notificationsOpen = $state(false);
  let statusOpen = $state(false);
  // THE global busy signal (owner 2026-10-10: one subtle spinner, in the
  // sidemenu). Fed by the action runtime (navigation + registered actions)
  // and the gateway reconnect; GlobalActivity already owns the live region,
  // so this one stays aria-hidden. The slot is always reserved — no layout shift.
  const actions = tryUseActions();
  const busy = $derived(Boolean(actions?.indicatorVisible || conn.connecting));

  onMount(() => subscribeNotificationsPolling());

  const iconBtn =
    'flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-bg3 transition-colors duration-[150ms]';
</script>

<div
  class="utilities flex items-center gap-0.5 {collapsed ? 'flex-col py-1' : 'flex-row px-1'}"
  role="group"
  aria-label={m.topbar_quickActions()}
>
  <ConnectionStatusIndicator bind:open={statusOpen} panel="above" />
  <span class="busy-slot {iconBtn}" class:busy aria-hidden="true">
    <Spinner size="xs" />
  </span>

  <Button
    variant="ghost"
    size="xs"
    onclick={() => captureSnapshot()}
    disabled={bugReporter.phase === 'capturing'}
    class="{iconBtn} disabled:opacity-50 disabled:cursor-wait"
    aria-label={m.bug_reportButton()}
    title={m.bug_reportButton()}
  >
    <Bug size={iconSizes.sm} />
  </Button>

  <NotificationsPopup bind:open={notificationsOpen} placement="right">
    {#snippet trigger()}
      <span
        class="{iconBtn} relative"
        aria-label="{notifications.badgeCount} notifications"
        title="Notifications"
      >
        <Bell size={iconSizes.sm} />
        {#if notifications.hasPending}
          <span
            class="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full bg-destructive text-[length:var(--font-size-telemetry)] font-bold text-accent-foreground leading-none"
          >
            {notifications.badgeCount > 99 ? '99+' : notifications.badgeCount}
          </span>
        {/if}
      </span>
    {/snippet}
  </NotificationsPopup>

  <Button
    variant="ghost"
    size="xs"
    type="button"
    onclick={() => togglePalette()}
    class={iconBtn}
    aria-label="Open command palette (⌘K)"
    title="Search · ⌘K"
  >
    <Search size={iconSizes.sm} />
  </Button>

  {#if !collapsed}
    <span class="ml-auto flex items-center gap-1">
      <EnvBadge />
      <ProfileMenu placement="right" />
    </span>
  {:else}
    <ProfileMenu placement="right" />
  {/if}
</div>

<style>
  .busy-slot {
    color: var(--color-text-tertiary);
    opacity: 0;
    transition: opacity var(--duration-normal) var(--ease-standard);
  }
  .busy-slot.busy {
    opacity: 1;
  }
</style>
