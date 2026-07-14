<script lang="ts">
  import { Button } from '$lib/components/ui';
import { goto } from '$app/navigation';
  import { Workflow, ChevronDown, ChevronRight, BookOpen } from 'lucide-svelte';
  import { MASTER_FLOWS } from '$lib/flows/master-flows';

  let collapsed = $state(false);

  function open(id: string) {
    goto(`/flow-editor/master/${id}`);
  }
</script>

<section class="mb-6">
  <header class="flex items-center justify-between mb-2">
    <Button variant="ghost"
      type="button"
      class="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-muted hover:text-foreground"
      onclick={() => (collapsed = !collapsed)}
    >
      {#if collapsed}<ChevronRight size={12} />{:else}<ChevronDown size={12} />{/if}
      <BookOpen size={12} class="text-accent" />
      <span class="text-foreground">Master Flows</span>
      <span class="text-muted/50">({MASTER_FLOWS.length})</span>
    </Button>
    <span class="hidden sm:block text-[length:var(--font-size-telemetry)] font-mono text-muted/60 tracking-wide">
      standard gateway behaviors · read-only
    </span>
  </header>

  {#if !collapsed}
    <div class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
      {#each MASTER_FLOWS as flow (flow.id)}
        <div
          role="button"
          tabindex="0"
          onclick={() => open(flow.id)}
          onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && open(flow.id)}
          class="group rounded-xl border border-accent/40 ring-1 ring-accent/15 bg-bg2 overflow-hidden cursor-pointer transition-all shadow-sm hover:shadow-md hover:border-accent/60"
        >
          <div class="aspect-video bg-gradient-to-br from-accent/[0.07] to-transparent flex items-center justify-center relative">
            <Workflow size={32} class="text-accent/30 group-hover:text-accent/50 transition-colors" />
            <div class="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-accent/15 text-accent text-[length:var(--font-size-telemetry)] font-mono uppercase tracking-wider ring-1 ring-accent/20">
              <BookOpen size={9} /> master
            </div>
            <div class="absolute bottom-2 right-2 text-[length:var(--font-size-telemetry)] font-mono text-muted/50">
              {flow.nodes.length} steps
            </div>
          </div>
          <div class="px-4 py-3">
            <div class="text-sm font-semibold text-foreground truncate">{flow.name}</div>
            <p class="text-[length:var(--font-size-caption)] text-muted mt-1 leading-snug line-clamp-2">{flow.description}</p>
            {#if flow.tags?.length}
              <div class="flex flex-wrap gap-1 mt-2">
                {#each flow.tags as tag (tag)}
                  <span class="px-1.5 py-0.5 rounded bg-bg3 text-muted text-[length:var(--font-size-telemetry)] font-mono">{tag}</span>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</section>
