<script lang="ts">
  import ProfileMenu from './ProfileMenu.svelte';
  import { Search, Bug, Bell } from 'lucide-svelte';
  import { togglePalette } from '$lib/state/ui/command-palette.svelte';
  import { captureSnapshot, bugReporter } from '$lib/state/ui/bug-reporter.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { notificationState } from '$lib/state/features/notifications.svelte';
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';

  const connected = $derived(conn.connected);

  onMount(() => {
    notificationState.refresh();
    // Poll every 60 seconds
    const interval = setInterval(() => notificationState.refresh(), 60_000);
    return () => clearInterval(interval);
  });
</script>

<div
  class="hidden md:flex fixed top-0 right-0 z-50 items-center gap-0.5 h-9 pl-2 pr-2 rounded-bl-[14px]
         bg-bg2/85 backdrop-blur-xl border-b border-l border-[var(--elevation-3-border)] shadow-sm
         transition-[box-shadow,border-color] duration-[200ms] ease-[cubic-bezier(0.2,0,0,1)]"
  aria-label="Quick actions"
>
  <span
    class="flex items-center justify-center w-5 h-7"
    title={connected ? 'Gateway connected' : 'Gateway disconnected'}
  >
    <span
      class="w-1.5 h-1.5 rounded-full transition-colors duration-[250ms] {connected
        ? 'bg-success shadow-[0_0_5px_var(--color-success)]'
        : 'bg-warning shadow-[0_0_5px_var(--color-warning)] animate-pulse'}"
      aria-hidden="true"
    ></span>
    <span class="sr-only">{connected ? 'Gateway connected' : 'Gateway disconnected'}</span>
  </span>

  <button
    type="button"
    onclick={() => togglePalette()}
    class="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors duration-[150ms]"
    aria-label="Open command palette (⌘K)"
    title="Search · ⌘K"
  >
    <Search size={14} />
  </button>

  <!-- Notification bell -->
  <a
    href="/settings/team"
    class="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors duration-[150ms] relative"
    aria-label="{notificationState.pendingCount} pending access requests"
    title="Access requests"
  >
    <Bell size={14} />
    {#if notificationState.hasPending}
      <span
        class="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full bg-red-500 text-[9px] font-bold text-white leading-none"
      >
        {notificationState.pendingCount > 99 ? '99+' : notificationState.pendingCount}
      </span>
    {/if}
  </a>

  <button
    onclick={() => captureSnapshot()}
    disabled={bugReporter.phase === 'capturing'}
    class="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors duration-[150ms] disabled:opacity-50 disabled:cursor-wait"
    aria-label={m.bug_reportButton()}
    title={m.bug_reportButton()}
  >
    <Bug size={15} />
  </button>

  <div class="w-px h-4 bg-[var(--hairline)] mx-0.5"></div>

  <div class="flex items-center">
    <ProfileMenu />
  </div>
</div>
