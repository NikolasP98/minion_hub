<script lang="ts">
  import { Button } from '$lib/components/ui';
import {
    type SubagentSession,
    resolveStatus,
    formatDuration,
  } from '$lib/state/features/subagent-data.svelte';
  import * as m from '$lib/paraglide/messages';

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
    running: 'bg-[var(--color-warning-surface)]',
    completed: 'bg-[var(--color-success-surface)]',
    failed: 'bg-[var(--color-danger-surface)]',
    unknown: 'bg-[var(--color-surface-2)]',
  };

  const depthLabel = $derived(
    session.spawnDepth != null ? m.subagent_depth({ depth: session.spawnDepth }) : null
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

<Button variant="ghost"
  type="button"
  class="flex flex-col gap-1 w-full py-2.5 px-3 bg-transparent border-0
    border-b border-b-white/[0.04] border-l-3 border-l-transparent text-foreground
    cursor-pointer text-left transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-text-primary)]/[0.03]
    {selected ? '!bg-bg3 !border-l-accent' : ''}"
  {onclick}
>
  <!-- Row 1: status + label -->
  <div class="flex items-center gap-2">
    <span class="w-2 h-2 rounded-full shrink-0 {statusColor[status] ?? statusColor.unknown}"></span>
    <span class="text-[length:var(--font-size-caption)] font-medium truncate flex-1">
      {session.label || session.displayName || session.key.split(':').pop() || m.subagent_unnamed()}
    </span>
    {#if status === 'running'}
      <span class="text-[length:var(--font-size-telemetry)] text-[var(--color-warning-fg)] font-mono animate-pulse">{m.subagent_running()}</span>
    {/if}
  </div>

  <!-- Row 2: model + depth -->
  <div class="flex items-center gap-2 pl-4">
    <span class="text-[length:var(--font-size-telemetry)] text-muted truncate">
      {session.model ?? m.subagent_unknownModel()}
    </span>
    {#if depthLabel}
      <span class="text-[length:var(--font-size-telemetry)] px-1.5 py-0.5 rounded bg-[var(--color-text-primary)]/[0.06] text-muted font-mono">
        {depthLabel}
      </span>
    {/if}
  </div>

  <!-- Row 3: duration + tokens + parent -->
  <div class="flex items-center gap-2 pl-4 text-[length:var(--font-size-telemetry)] text-muted-strong">
    <span>{formatDuration(session)}</span>
    {#if tokenDisplay()}
      <span class="opacity-60">&middot;</span>
      <span>{tokenDisplay()}</span>
    {/if}
    {#if session.spawnedBy && session.spawnDepth && session.spawnDepth >= 2}
      <span class="opacity-60">&middot;</span>
      <span class="truncate">{m.subagent_from({ name: session.spawnedBy.split(':').pop() ?? '' })}</span>
    {/if}
  </div>
</Button>
