<script lang="ts">
  import ProfileMenu from './ProfileMenu.svelte';
  import { Search, Bug } from 'lucide-svelte';
  import { togglePalette } from '$lib/state/ui/command-palette.svelte';
  import { captureSnapshot, bugReporter } from '$lib/state/ui/bug-reporter.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import * as m from '$lib/paraglide/messages';

  // Live connection status — the ambient "is it alive?" signal.
  const connected = $derived(conn.connected);
</script>

<!-- Floating action island (md+). Mobile actions live in the topbar. -->
<div
  class="hidden md:flex fixed top-2.5 right-3 z-50 items-center gap-1 h-10 pl-1.5 pr-1 rounded-full
         bg-bg2/80 backdrop-blur-xl border border-[var(--elevation-3-border)] shadow-lg
         transition-[box-shadow,border-color] duration-[200ms] ease-[cubic-bezier(0.2,0,0,1)]"
  aria-label="Quick actions"
>
  <!-- Live gateway status dot -->
  <span
    class="flex items-center justify-center w-7 h-7"
    title={connected ? 'Gateway connected' : 'Gateway disconnected'}
  >
    <span
      class="w-2 h-2 rounded-full transition-colors duration-[250ms] {connected
        ? 'bg-success shadow-[0_0_6px_var(--color-success)]'
        : 'bg-warning shadow-[0_0_6px_var(--color-warning)] animate-pulse'}"
      aria-hidden="true"
    ></span>
    <span class="sr-only">{connected ? 'Gateway connected' : 'Gateway disconnected'}</span>
  </span>

  <!-- Command palette -->
  <button
    type="button"
    onclick={() => togglePalette()}
    class="inline-flex items-center gap-1.5 h-8 pl-2 pr-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors duration-[150ms]"
    aria-label="Open command palette"
    title="Command palette"
  >
    <Search size={14} />
    <kbd class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg3 border border-[var(--hairline)] leading-none">⌘K</kbd>
  </button>

  <!-- Bug report -->
  <button
    onclick={() => captureSnapshot()}
    disabled={bugReporter.phase === 'capturing'}
    class="flex items-center justify-center w-8 h-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors duration-[150ms] disabled:opacity-50 disabled:cursor-wait"
    aria-label={m.bug_reportButton()}
    title={m.bug_reportButton()}
  >
    <Bug size={16} />
  </button>

  <div class="w-px h-5 bg-[var(--hairline)] mx-0.5"></div>

  <!-- Profile -->
  <div class="flex items-center">
    <ProfileMenu />
  </div>
</div>
