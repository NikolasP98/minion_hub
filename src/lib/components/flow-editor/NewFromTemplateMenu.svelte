<script lang="ts">
  import { Button } from '$lib/components/ui';
import { goto } from '$app/navigation';
  import { Plus, ChevronDown } from 'lucide-svelte';

  type Template = { id: string; name: string; nodes: unknown[]; edges: unknown[] };
  let {
    pluginId,
    groupId,
    templates,
    disabled = false,
    onCreated,
  }: {
    pluginId: string;
    groupId: string;
    templates: Template[];
    disabled?: boolean;
    onCreated?: () => void;
  } = $props();

  let open = $state(false);
  let busy = $state(false);

  async function instantiate(t: Template) {
    if (busy) return;
    busy = true;
    open = false;
    try {
      const res = await fetch('/api/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: t.name,
          nodes: t.nodes,
          edges: t.edges,
          groupId,
          pluginId,
          templateId: t.id,
        }),
      });
      if (res.ok) {
        const { id } = await res.json();
        onCreated?.();
        goto(`/flow-editor/${id}`);
      }
    } finally {
      busy = false;
    }
  }
</script>

<div class="relative">
  <Button variant="ghost"
    type="button"
    {disabled}
    onclick={(e) => { e.stopPropagation(); open = !open; }}
    class="flex items-center gap-1 h-7 px-2.5 text-[length:var(--font-size-telemetry)] font-mono uppercase tracking-wider rounded border border-border text-muted hover:bg-bg3 hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
  >
    <Plus size={12} /> New from template <ChevronDown size={11} />
  </Button>
  {#if open && !disabled}
    <div class="absolute right-0 top-8 z-[var(--layer-dropdown)] min-w-52 rounded-lg border border-border bg-bg2 shadow-lg py-1">
      {#each templates as t (t.id)}
        <Button variant="ghost"
          type="button"
          onclick={(e) => { e.stopPropagation(); instantiate(t); }}
          class="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-bg3 transition-colors"
        >
          {t.name}
        </Button>
      {:else}
        <div class="px-3 py-1.5 text-xs text-muted italic">No templates</div>
      {/each}
    </div>
  {/if}
</div>
