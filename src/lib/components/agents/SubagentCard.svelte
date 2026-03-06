<script lang="ts">
  import {
    type SubagentSession,
    resolveStatus,
    formatDuration,
  } from '$lib/state/features/subagent-data.svelte';

  let {
    session,
    selected = false,
    onclick,
  }: {
    session: SubagentSession;
    selected?: boolean;
    onclick: () => void;
  } = $props();

  const status = $derived(resolveStatus(session));

  const statusColor: Record<string, string> = {
    running: 'bg-yellow-400',
    completed: 'bg-emerald-400',
    failed: 'bg-red-400',
    unknown: 'bg-zinc-500',
  };

  const depthLabel = $derived(
    session.spawnDepth != null ? `depth ${session.spawnDepth}` : null
  );

  const tokenDisplay = $derived(() => {
    if (session.totalTokens) return `${(session.totalTokens / 1000).toFixed(1)}k tok`;
    if (session.inputTokens || session.outputTokens) {
      const inp = session.inputTokens ?? 0;
      const out = session.outputTokens ?? 0;
      return `${((inp + out) / 1000).toFixed(1)}k tok`;
    }
    return null;
  });
</script>

<button
  type="button"
  class="flex flex-col gap-1 w-full py-2.5 px-3 bg-transparent border-0
    border-b border-b-white/[0.04] border-l-3 border-l-transparent text-foreground
    cursor-pointer text-left transition-colors duration-100 hover:bg-white/[0.03]
    {selected ? '!bg-bg3 !border-l-accent' : ''}"
  {onclick}
>
  <!-- Row 1: status + label -->
  <div class="flex items-center gap-2">
    <span class="w-2 h-2 rounded-full shrink-0 {statusColor[status] ?? statusColor.unknown}"></span>
    <span class="text-[12px] font-medium truncate flex-1">
      {session.label || session.displayName || session.key.split(':').pop() || 'Unnamed'}
    </span>
    {#if status === 'running'}
      <span class="text-[10px] text-yellow-400 font-mono animate-pulse">running</span>
    {/if}
  </div>

  <!-- Row 2: model + depth -->
  <div class="flex items-center gap-2 pl-4">
    <span class="text-[10px] text-muted truncate">
      {session.model ?? 'unknown model'}
    </span>
    {#if depthLabel}
      <span class="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.06] text-muted font-mono">
        {depthLabel}
      </span>
    {/if}
  </div>

  <!-- Row 3: duration + tokens + parent -->
  <div class="flex items-center gap-2 pl-4 text-[10px] text-muted/60">
    <span>{formatDuration(session)}</span>
    {#if tokenDisplay()}
      <span class="opacity-60">&middot;</span>
      <span>{tokenDisplay()}</span>
    {/if}
    {#if session.spawnedBy && session.spawnDepth && session.spawnDepth >= 2}
      <span class="opacity-60">&middot;</span>
      <span class="truncate">from {session.spawnedBy.split(':').pop()}</span>
    {/if}
  </div>
</button>
