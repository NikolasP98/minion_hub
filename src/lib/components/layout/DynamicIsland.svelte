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

<!--
  Top-right "notch" (md+). Carved flush into the corner (top-0 right-0) with a
  rounded bottom-left so page content wraps around its lower-left curve — not a
  floating overlay. Every page top row reserves --notch-clearance so nothing
  collides. Mobile actions live in the topbar.
-->
<div
  class="hidden md:flex fixed top-0 right-0 z-50 items-center gap-1 h-12 pt-1 pl-2.5 pr-3 rounded-bl-[18px]
         bg-bg2/80 backdrop-blur-xl border-b border-l border-[var(--elevation-3-border)] shadow-md
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
