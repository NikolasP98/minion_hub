<script lang="ts">
  import * as m from '$lib/paraglide/messages';

  export type ViewMode = 'list' | 'tree' | 'timeline';

  let {
    active = 'list' as ViewMode,
    onchange
  }: {
    active?: ViewMode;
    onchange?: (view: ViewMode) => void;
  } = $props();

  const views = $derived<{ id: ViewMode; label: string }[]>([
    { id: 'list', label: m.subagent_viewList() },
    { id: 'tree', label: m.subagent_viewTree() },
    { id: 'timeline', label: m.subagent_viewTimeline() },
  ]);
</script>

<div class="shrink-0 px-3 py-2 border-t border-border">
  <div class="text-[9px] text-muted/40 uppercase tracking-wider mb-1.5 font-semibold">{m.subagent_view()}</div>
  <div class="flex gap-1.5">
    {#each views as view (view.id)}
      <button
        type="button"
        class="text-[10px] px-2 py-1 rounded transition-colors cursor-pointer border-0 bg-transparent
          {active === view.id
          ? 'bg-accent/20 text-accent font-medium'
          : 'text-muted hover:text-foreground hover:bg-white/[0.04]'}"
        onclick={() => onchange?.(view.id)}
      >
        {view.label}
      </button>
    {/each}
  </div>
</div>
