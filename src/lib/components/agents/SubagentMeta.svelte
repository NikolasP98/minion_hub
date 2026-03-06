<script lang="ts">
  import type { SubagentSession } from '$lib/state/features/subagent-data.svelte';

  let { session }: { session: SubagentSession } = $props();

  const entries = $derived(
    Object.entries(session)
      .filter(([, v]) => v != null && v !== '')
      .sort(([a], [b]) => a.localeCompare(b))
  );
</script>

<div class="flex-1 min-h-0 overflow-y-auto p-4 scrollbar-thin scrollbar-color-border">
  <h3 class="text-[11px] font-semibold text-muted uppercase tracking-wider mb-3">
    Session Metadata
  </h3>
  <div class="flex flex-col gap-1.5">
    {#each entries as [key, value] (key)}
      <div class="flex gap-3 text-[11px] py-1 border-b border-white/[0.04]">
        <span class="text-muted font-mono w-36 shrink-0 truncate">{key}</span>
        <span class="text-foreground font-mono break-all">
          {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
        </span>
      </div>
    {/each}
  </div>
</div>
