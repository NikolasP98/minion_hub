<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { GitBranch, Plus, Trash2, Clock, BookOpen } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import BuilderHub from '$lib/components/builder/BuilderHub.svelte';
  import { sendRequest } from '$lib/services/gateway.svelte';

  // Flows list lives here; Skills are authored through the same flow surface.
  let view = $state<'flows' | 'skills'>('flows');

  type FlowMeta = {
    id: string;
    name: string;
    nodeCount: number;
    createdAt: number;
    updatedAt: number;
  };

  // Flows shipped by enabled plugins (e.g. the alert-watcher pipeline), surfaced
  // from the gateway's flows.templates.list and auto-installed into this user's
  // flow list on first visit after the plugin is enabled.
  type FlowTemplate = {
    pluginId: string;
    id: string;
    name: string;
    description?: string;
    nodes: unknown[];
    edges: unknown[];
  };

  let flows = $state<FlowMeta[]>([]);
  let loading = $state(true);
  let creating = $state(false);
  let createError = $state<string | null>(null);

  onMount(async () => {
    await loadFlows();
    // Auto-install any plugin-shipped flows this user hasn't installed yet, then
    // refresh the list if new ones landed. Idempotent + deletion-safe server-side.
    await syncPluginFlows();
  });

  async function syncPluginFlows() {
    try {
      const res = (await sendRequest('flows.templates.list', {})) as
        | { templates?: FlowTemplate[] }
        | null;
      const templates = res?.templates ?? [];
      if (templates.length === 0) return;
      const syncRes = await fetch('/api/flows/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templates }),
      });
      if (syncRes.ok) {
        const { count } = await syncRes.json();
        if (count > 0) await loadFlows();
      }
    } catch {
      // Gateway not connected yet (or no plugin flows) — they'll sync next visit.
    }
  }

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
    createError = null;
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
      } else {
        const text = await res.text();
        createError = `Error ${res.status}: ${text}`;
      }
    } catch (e) {
      createError = e instanceof Error ? e.message : 'Unknown error';
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

  <div class="flex flex-col flex-1 min-h-0">
    <!-- Header: Flows / Skills view toggle -->
    <div class="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
      <div class="flex items-center gap-1 p-0.5 rounded-lg border border-border bg-bg2">
        <button
          type="button"
          onclick={() => (view = 'flows')}
          class="flex items-center gap-1.5 h-7 px-3 text-[10px] font-mono uppercase tracking-wider rounded transition-colors {view === 'flows' ? 'bg-accent/[0.12] text-accent' : 'text-muted hover:text-foreground'}"
        >
          <GitBranch size={12} />
          {m.flow_title()}
        </button>
        <button
          type="button"
          onclick={() => (view = 'skills')}
          class="flex items-center gap-1.5 h-7 px-3 text-[10px] font-mono uppercase tracking-wider rounded transition-colors {view === 'skills' ? 'bg-accent/[0.12] text-accent' : 'text-muted hover:text-foreground'}"
        >
          <BookOpen size={12} />
          Skills
        </button>
      </div>
      {#if view === 'flows'}
        <button
          onclick={handleCreate}
          disabled={creating}
          class="flex items-center gap-1.5 h-7 px-3 text-[10px] font-mono uppercase tracking-wider rounded border border-border text-muted hover:bg-bg3 hover:text-foreground transition-colors disabled:opacity-50"
        >
          <Plus size={12} />
          {m.flow_newFlow()}
        </button>
      {/if}
    </div>

    {#if view === 'flows'}
      <div class="flex-1 overflow-y-auto px-6 pb-6">

    {#if createError}
      <div class="mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400 font-mono">
        {createError}
      </div>
    {/if}

    <!-- Content -->
    {#if loading}
      <p class="text-muted text-xs font-mono">{m.common_loading()}</p>
    {:else if flows.length === 0}
      <div class="flex flex-col items-center justify-center py-24 gap-4">
        <GitBranch size={40} class="text-muted/30" />
        <p class="text-muted text-sm font-mono italic">{m.flow_noFlows()}</p>
        <button
          onclick={handleCreate}
          class="flex items-center gap-1.5 h-8 px-4 text-xs font-mono rounded border border-border text-muted hover:bg-bg3 hover:text-foreground transition-colors"
        >
          <Plus size={12} />
          {m.flow_createFirst()}
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
                {flow.nodeCount === 1 ? m.flow_nodeCount({ count: flow.nodeCount }) : m.flow_nodeCountPlural({ count: flow.nodeCount })}
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
                title={m.flow_deleteFlow()}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
      </div>
    {:else}
      <BuilderHub only="skills" />
    {/if}
  </div>
