<script lang="ts">
  import HostPill from './HostPill.svelte';
  import { conn } from '$lib/state/connection.svelte';
</script>

<header class="shrink-0 relative z-100 bg-bg/95 backdrop-blur-sm border-b border-border px-4.5 py-2.5 flex items-center gap-2.5">
  <HostPill />

  <div
    class="w-2.5 h-2.5 rounded-full shrink-0 transition-all duration-300"
    class:bg-success={conn.connected}
    class:shadow-[0_0_8px_var(--color-success)]={conn.connected}
    class:bg-warning={conn.connecting}
    class:shadow-[0_0_8px_var(--color-warning)]={conn.connecting}
    class:animate-[led-pulse_1s_infinite]={conn.connecting}
    class:bg-muted-foreground={!conn.connected && !conn.connecting}
    class:shadow-[0_0_4px_var(--color-muted-foreground)]={!conn.connected && !conn.connecting}
  ></div>
  <span class="text-xs text-muted whitespace-nowrap">{conn.statusText}</span>

  <div class="ml-auto mr-auto flex items-center select-none leading-none" aria-label="Minion Hub">
    <span class="bg-brand-pink text-black font-black text-[15px] tracking-wide px-2.5 py-0.5 rounded-l-md uppercase">MINION</span>
    <span class="text-white font-bold text-[15px] px-2 py-0.5">hub</span>
  </div>

  <a href="/reliability" class="text-xs text-muted no-underline px-3 py-1 rounded-full border border-border transition-all duration-150 hover:bg-bg3 hover:text-foreground">Reliability</a>
  <a href="/sessions" class="text-xs text-muted no-underline px-3 py-1 rounded-full border border-border transition-all duration-150 hover:bg-bg3 hover:text-foreground">Sessions</a>
  <a href="/settings" class="text-xs text-muted no-underline px-3 py-1 rounded-full border border-border transition-all duration-150 hover:bg-bg3 hover:text-foreground">Settings</a>
</header>
