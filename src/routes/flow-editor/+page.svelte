<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import Topbar from '$lib/components/Topbar.svelte';
  import { GitBranch, Plus, Trash2, Clock } from 'lucide-svelte';

  type FlowMeta = {
    id: string;
    name: string;
    nodeCount: number;
    createdAt: number;
    updatedAt: number;
  };

  let flows = $state<FlowMeta[]>([]);
  let loading = $state(true);
  let creating = $state(false);

  onMount(async () => {
    await loadFlows();
  });

  async function loadFlows() {
    loading = true;
    try {
      const res = await fetch('/api/flows');
      if (res.ok) {
        const data = await res.json();
        flows = data.flows;
      }
    } finally {
      loading = false;
    }
  }

  async function handleCreate() {
    creating = true;
    try {
      const name = `Flow ${new Date().toLocaleDateString()}`;
      const res = await fetch('/api/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const { id } = await res.json();
        goto(`/flow-editor/${id}`);
      }
    } finally {
      creating = false;
    }
  }

  async function handleDelete(e: MouseEvent, id: string) {
    e.stopPropagation();
    await fetch(`/api/flows/${id}`, { method: 'DELETE' });
    flows = flows.filter((f) => f.id !== id);
  }

  function formatDate(ts: number) {
    return new Date(ts).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
</script>

<div class="flex flex-col h-screen bg-bg overflow-hidden">
  <Topbar />

  <div class="flex-1 overflow-y-auto p-6">
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div class="flex items-center gap-2">
        <GitBranch size={16} class="text-muted" />
        <h1 class="font-mono text-sm uppercase tracking-widest text-muted">Flow Editor</h1>
      </div>
      <button
        onclick={handleCreate}
        disabled={creating}
        class="flex items-center gap-1.5 h-7 px-3 text-[10px] font-mono uppercase tracking-wider rounded border border-border text-muted hover:bg-bg3 hover:text-foreground transition-colors disabled:opacity-50"
      >
        <Plus size={12} />
        New Flow
      </button>
    </div>

    <!-- Content -->
    {#if loading}
      <p class="text-muted text-xs font-mono">Loading…</p>
    {:else if flows.length === 0}
      <div class="flex flex-col items-center justify-center py-24 gap-4">
        <GitBranch size={40} class="text-muted/30" />
        <p class="text-muted text-sm font-mono italic">No flows yet</p>
        <button
          onclick={handleCreate}
          class="flex items-center gap-1.5 h-8 px-4 text-xs font-mono rounded border border-border text-muted hover:bg-bg3 hover:text-foreground transition-colors"
        >
          <Plus size={12} />
          Create your first flow
        </button>
      </div>
    {:else}
      <div class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
        {#each flows as flow (flow.id)}
          <div
            role="button"
            tabindex="0"
            onclick={() => goto(`/flow-editor/${flow.id}`)}
            onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && goto(`/flow-editor/${flow.id}`)}
            class="group rounded-xl border border-border bg-bg2 overflow-hidden cursor-pointer hover:border-accent/50 transition-all shadow-sm hover:shadow-md"
          >
            <!-- Preview area -->
            <div class="aspect-video bg-bg3/50 flex items-center justify-center relative">
              <GitBranch size={32} class="text-muted/20 group-hover:text-muted/30 transition-colors" />
              <div class="absolute bottom-2 right-2 text-[10px] font-mono text-muted/50">
                {flow.nodeCount} node{flow.nodeCount !== 1 ? 's' : ''}
              </div>
            </div>

            <!-- Footer -->
            <div class="px-4 py-3 flex items-center justify-between">
              <div class="min-w-0">
                <div class="text-sm font-semibold text-foreground truncate">{flow.name}</div>
                <div class="flex items-center gap-1 text-[10px] text-muted mt-0.5">
                  <Clock size={10} />
                  {formatDate(flow.updatedAt)}
                </div>
              </div>

              <button
                onclick={(e) => handleDelete(e, flow.id)}
                class="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded text-muted hover:text-red-400 hover:bg-bg3"
                title="Delete flow"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
