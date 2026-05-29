<script lang="ts">
  import { flowEditorState, clearLogs } from '$lib/state/features/flow-editor.svelte';
  import { X, Trash2 } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  let logContainer = $state<HTMLDivElement | null>(null);

  // Auto-scroll to bottom when new logs arrive
  $effect(() => {
    const _ = flowEditorState.consoleLogs.length;
    if (logContainer) {
      logContainer.scrollTop = logContainer.scrollHeight;
    }
  });

  const levelClass: Record<string, string> = {
    info: 'text-blue-400',
    warn: 'text-amber-400',
    error: 'text-red-400',
    debug: 'text-muted/60',
  };

  // Node-lifecycle chip color by kind.
  const kindClass: Record<string, string> = {
    'node-start': 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
    'node-end': 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
    'node-error': 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30',
  };

  function clip(s: string, n = 400) {
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function formatTime(ts: number) {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }
</script>

<div class="shrink-0 h-44 border-t border-border bg-bg flex flex-col overflow-hidden">
  <!-- Header -->
  <div class="flex items-center justify-between px-3 py-1.5 border-b border-border bg-bg2 shrink-0">
    <div class="flex items-center gap-2">
      <span class="text-[10px] font-semibold text-muted uppercase tracking-widest font-mono">{m.flow_console()}</span>
      {#if flowEditorState.consoleLogs.length > 0}
        <span class="text-[9px] font-mono text-muted/50 bg-bg3 px-1.5 py-0.5 rounded">
          {flowEditorState.consoleLogs.length}
        </span>
      {/if}
    </div>
    <div class="flex items-center gap-1">
      <button
        onclick={clearLogs}
        class="flex items-center justify-center w-5 h-5 rounded text-muted/60 hover:text-foreground hover:bg-bg3 transition-colors"
        title={m.flow_clearLogs()}
      >
        <Trash2 size={11} />
      </button>
      <button
        onclick={() => (flowEditorState.consoleOpen = false)}
        class="flex items-center justify-center w-5 h-5 rounded text-muted/60 hover:text-foreground hover:bg-bg3 transition-colors"
        title={m.flow_closeConsole()}
      >
        <X size={11} />
      </button>
    </div>
  </div>

  <!-- Log lines -->
  <div
    bind:this={logContainer}
    class="flex-1 overflow-y-auto px-3 py-2 space-y-0.5 font-mono"
  >
    {#if flowEditorState.consoleLogs.length === 0}
      <p class="text-[11px] text-muted/40 italic">{m.flow_noOutput()}</p>
    {:else}
      {#each flowEditorState.consoleLogs as entry (entry.id)}
        <div class="flex items-start gap-2 text-[11px] leading-5">
          <span class="text-muted/40 shrink-0 select-none">{formatTime(entry.timestamp)}</span>
          {#if entry.kind && entry.kind.startsWith('node-') && entry.nodeLabel}
            <span
              class="shrink-0 select-none px-1.5 rounded text-[10px] font-medium {kindClass[entry.kind] ??
                'bg-bg3 text-muted'}"
            >
              {entry.nodeLabel}
            </span>
          {:else}
            <span
              class="shrink-0 select-none {levelClass[entry.level] ?? 'text-foreground'} uppercase w-12"
            >
              [{entry.level}]
            </span>
            {#if entry.nodeId}
              <span class="shrink-0 text-accent/70 bg-accent/10 px-1 rounded text-[10px]">{entry.nodeId}</span>
            {/if}
          {/if}
          <span class="text-foreground/80 break-all">{entry.message}</span>
        </div>
        <!-- I/O detail for completed nodes -->
        {#if entry.kind === 'node-end' && (entry.input || entry.output)}
          <div class="ml-16 mb-1 space-y-0.5">
            {#if entry.input}
              <div class="flex gap-1.5 text-[10px] leading-4">
                <span class="shrink-0 text-muted/50 select-none">in →</span>
                <span class="text-muted/80 break-all whitespace-pre-wrap">{clip(entry.input)}</span>
              </div>
            {/if}
            {#if entry.output}
              <div class="flex gap-1.5 text-[10px] leading-4">
                <span class="shrink-0 text-emerald-400/60 select-none">out ←</span>
                <span class="text-foreground/70 break-all whitespace-pre-wrap">{clip(entry.output)}</span>
              </div>
            {/if}
          </div>
        {/if}
      {/each}
    {/if}
  </div>
</div>
