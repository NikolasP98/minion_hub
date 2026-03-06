<script lang="ts">
  let { active = 'list' }: { active?: string } = $props();

  const views = [
    { id: 'list', label: 'List', enabled: true },
    { id: 'tree', label: 'Tree', enabled: false },
    { id: 'timeline', label: 'Timeline', enabled: false },
  ];
</script>

<div class="shrink-0 px-3 py-2 border-t border-border">
  <div class="text-[9px] text-muted/40 uppercase tracking-wider mb-1.5 font-semibold">View</div>
  <div class="flex gap-1.5">
    {#each views as view (view.id)}
      {#if view.enabled}
        <button
          type="button"
          class="text-[10px] px-2 py-1 rounded transition-colors
            {active === view.id
            ? 'bg-accent/20 text-accent font-medium'
            : 'text-muted hover:text-foreground hover:bg-white/[0.04]'}"
        >
          {view.label}
        </button>
      {:else}
        <span
          class="text-[10px] px-2 py-1 rounded text-muted/30 cursor-default"
          title="Coming soon"
        >
          {view.label}
          <span class="text-[8px] ml-0.5 opacity-50">soon</span>
        </span>
      {/if}
    {/each}
  </div>
</div>
