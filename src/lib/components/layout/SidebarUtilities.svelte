<script lang="ts">
  import { useDropRegistry } from '$lib/shell/drop-context.svelte';
  import { Upload } from 'lucide-svelte';
  const dropRegistry = useDropRegistry();
  /**
   * Desktop utility cluster — status dot · upload · bug · notifications · ⌘K —
   * above the brand and account controls (owner 2026-09-17: "remove
   * the top-right profile notch. Move its contents into the bottom of the
   * sidemenu"). Replaces DynamicIsland; the mobile Topbar keeps its own copy.
   * In the collapsed rail the cluster stacks vertically.
   */
  import { onMount, type Snippet } from 'svelte';
  import { Search, Bug, Bell } from 'lucide-svelte';
  import { Button, Tooltip, iconSizes } from '$lib/components/ui';
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

  let { collapsed = false, brand }: { collapsed?: boolean; brand?: Snippet } = $props();
  let notificationsOpen = $state(false);
  let statusOpen = $state(false);

  onMount(() => subscribeNotificationsPolling());
</script>

<div class="sidebar-utilities" class:is-collapsed={collapsed}>
  <div class="utility-grid" role="group" aria-label={m.topbar_quickActions()}>
    <div class="utility-cell">
      <ConnectionStatusIndicator bind:open={statusOpen} panel="above" comfortable />
    </div>
    <div class="utility-cell">
      <Tooltip label={m.shell_drop_title()} placement="top">
        <Button
          variant="ghost"
          size="md"
          shape="icon"
          class="footer-tool"
          aria-label={m.shell_drop_title()}
          onclick={() => {
            if (dropRegistry) dropRegistry.open = true;
          }}><Upload size={iconSizes.md} /></Button
        >
      </Tooltip>
    </div>
    <div class="utility-cell">
      <Tooltip label={m.bug_reportButton()} placement="top">
        <Button
          variant="ghost"
          size="md"
          shape="icon"
          class="footer-tool"
          onclick={() => captureSnapshot()}
          disabled={bugReporter.phase === 'capturing'}
          aria-label={m.bug_reportButton()}
        >
          <Bug size={iconSizes.md} />
        </Button>
      </Tooltip>
    </div>
    <div class="utility-cell">
      <NotificationsPopup bind:open={notificationsOpen} placement="right">
        {#snippet trigger()}
          <span
            class="footer-tool notification-trigger"
            aria-label={m.design_notifications_count({ count: notifications.badgeCount })}
          >
            <Bell size={iconSizes.md} />
            {#if notifications.hasPending}
              <span class="notification-count t-telemetry" aria-hidden="true">
                {notifications.badgeCount > 99 ? '99+' : notifications.badgeCount}
              </span>
            {/if}
          </span>
        {/snippet}
      </NotificationsPopup>
    </div>
    <div class="utility-cell">
      <Tooltip label={m.shortcuts_commandPaletteName()} placement="top">
        <Button
          variant="ghost"
          size="md"
          shape="icon"
          class="footer-tool"
          onclick={() => togglePalette()}
          aria-label={m.shortcuts_commandPaletteDesc()}
        >
          <Search size={iconSizes.md} />
        </Button>
      </Tooltip>
    </div>
  </div>

  <div class="account-row">
    {#if !collapsed && brand}
      <div class="footer-brand">{@render brand()}</div>
    {/if}
    <div class="account-controls">
      <EnvBadge />
      <ProfileMenu placement="right" />
    </div>
  </div>
</div>

<style>
  .sidebar-utilities {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: var(--space-2);
  }
  .utility-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: var(--space-1);
    min-width: 0;
  }
  .utility-cell {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    min-height: var(--control-height-md);
  }
  .utility-cell :global(.footer-tool) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--control-height-md);
    height: var(--control-height-md);
    padding: 0;
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
  }
  .utility-cell :global(.footer-tool:hover) {
    background: var(--color-surface-2);
    color: var(--color-text-primary);
  }
  .notification-trigger {
    position: relative;
  }
  .notification-count {
    position: absolute;
    inset-block-start: 0;
    inset-inline-end: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: var(--space-4);
    height: var(--space-4);
    padding-inline: var(--space-0-5);
    border: 1px solid var(--color-danger-border);
    border-radius: var(--radius-full);
    background: var(--color-danger-surface);
    color: var(--color-danger-fg);
    font-weight: var(--font-weight-semibold);
    line-height: var(--line-height-compact);
    pointer-events: none;
  }
  .account-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-width: 0;
    min-height: var(--control-height-touch);
    gap: var(--space-2);
  }
  .footer-brand {
    flex: 1;
    min-width: 0;
  }
  .account-controls {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-3);
    padding-inline: var(--space-1);
  }
  .is-collapsed .utility-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .is-collapsed .account-row,
  .is-collapsed .account-controls {
    flex-direction: column;
    justify-content: center;
  }
  .is-collapsed .account-controls {
    gap: var(--space-2);
    padding-block: var(--space-1);
    padding-inline: 0;
  }
  @media (pointer: coarse) {
    .utility-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .utility-cell {
      min-height: var(--control-height-touch);
    }
    .utility-cell :global(.footer-tool) {
      width: var(--control-height-touch);
      height: var(--control-height-touch);
    }
  }
</style>
