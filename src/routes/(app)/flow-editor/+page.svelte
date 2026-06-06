<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { GitBranch, Plus, BookOpen } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import BuilderHub from '$lib/components/builder/BuilderHub.svelte';
  import FlowGroupSection from '$lib/components/flow-editor/FlowGroupSection.svelte';
  import MasterFlowsSection from '$lib/components/flow-editor/MasterFlowsSection.svelte';
  import { sendRequest } from '$lib/services/gateway.svelte';
  import { sortGroups, type FlowGroupMeta } from '$lib/flows/groups';
  import { SvelteMap } from 'svelte/reactivity';

  let view = $state<'flows' | 'skills'>('flows');

  type FlowMeta = { id: string; name: string; nodeCount: number; createdAt: number; updatedAt: number; pluginId?: string | null; groupId?: string | null };
  type Template = { id: string; name: string; nodes: unknown[]; edges: unknown[] };
  type FlowPluginGroup = { pluginId: string; displayName: string; enabled: boolean; templates: Template[] };

  let flows = $state<FlowMeta[]>([]);
  let groups = $state<FlowGroupMeta[]>([]);
  let pluginTemplates = $state<Record<string, Template[]>>({});
  let loading = $state(true);
  let createError = $state<string | null>(null);

  onMount(async () => {
    await loadAll();
    await reconcile();
  });

  // Refresh the flow list when the active org changes (org switcher). Flows are
  // org-scoped, so a switch must re-fetch — invalidateAll() re-runs load fns but
  // this page loads client-side, so it'd otherwise show the previous org's list.
  // Seeded from the initial active org so the first effect run is a no-op (onMount
  // owns the initial load); subsequent changes trigger a reload.
  let activeOrgId = $state((page.data as { activeOrgId?: string | null }).activeOrgId ?? null);
  $effect(() => {
    const org = (page.data as { activeOrgId?: string | null }).activeOrgId ?? null;
    if (org !== activeOrgId) {
      activeOrgId = org;
      loadAll();
      reconcile();
    }
  });

  async function loadAll() {
    loading = true;
    try {
      const [fRes, gRes] = await Promise.all([fetch('/api/flows'), fetch('/api/flow-groups')]);
      if (fRes.ok) flows = (await fRes.json()).flows;
      if (gRes.ok) groups = (await gRes.json()).groups;
    } finally {
      loading = false;
    }
  }

  async function reconcile() {
    try {
      const res = (await sendRequest('flows.templates.list', {})) as
        | { plugins?: FlowPluginGroup[]; templates?: { pluginId: string; id: string; name: string; nodes: unknown[]; edges: unknown[] }[] }
        | null;
      let plugins: FlowPluginGroup[] = res?.plugins ?? [];
      if (plugins.length === 0 && res?.templates?.length) {
        const byPlugin = new SvelteMap<string, Template[]>();
        for (const t of res.templates) {
          const arr = byPlugin.get(t.pluginId) ?? [];
          arr.push({ id: t.id, name: t.name, nodes: t.nodes, edges: t.edges });
          byPlugin.set(t.pluginId, arr);
        }
        plugins = [...byPlugin].map(([pluginId, templates]) => ({ pluginId, displayName: pluginId, enabled: true, templates }));
      }
      pluginTemplates = Object.fromEntries(plugins.map((p) => [p.pluginId, p.templates]));
      const syncRes = await fetch('/api/flows/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plugins }),
      });
      if (syncRes.ok) {
        const out = await syncRes.json();
        if (out.groupsCreated || out.flowsSeeded || out.flowsReassigned || out.groupsReleased || out.groupsUpdated) {
          await loadAll();
        }
      }
    } catch {
      // gateway not connected yet — reconcile next visit
    }
  }

  const ungrouped = $derived(flows.filter((f) => !f.groupId));
  const orderedGroups = $derived(sortGroups(groups));
  function flowsIn(groupId: string) {
    return flows.filter((f) => f.groupId === groupId);
  }

  async function handleCreate(groupId: string | null) {
    createError = null;
    try {
      const name = `Flow ${new Date().toLocaleDateString()}`;
      const res = await fetch('/api/flows', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, groupId }),
      });
      if (res.ok) {
        const { id } = await res.json();
        goto(`/flow-editor/${id}`);
      } else {
        createError = `Error ${res.status}: ${await res.text()}`;
      }
    } catch (e) {
      createError = e instanceof Error ? e.message : 'Unknown error';
    }
  }

  function handleDeleteFlow(flow: { id: string }) {
    fetch(`/api/flows/${flow.id}`, { method: 'DELETE' }).then((res) => {
      if (res.ok) flows = flows.filter((f) => f.id !== flow.id);
    });
  }

  async function handleNewGroup() {
    const name = prompt(m.flow_groupNamePrompt());
    if (!name) return;
    const res = await fetch('/api/flow-groups', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    if (res.ok) await loadAll();
  }

  async function handleRenameGroup(group: FlowGroupMeta) {
    const name = prompt(m.flow_groupNamePrompt(), group.name);
    if (!name) return;
    const res = await fetch(`/api/flow-groups/${group.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    if (res.ok) await loadAll();
  }

  async function handleDeleteGroup(group: FlowGroupMeta) {
    const res = await fetch(`/api/flow-groups/${group.id}`, { method: 'DELETE' });
    if (res.ok) await loadAll();
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
    </div>

    {#if view === 'flows'}
      <div class="flex-1 overflow-y-auto px-6 pb-6">
        {#if createError}
          <div class="mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400 font-mono">{createError}</div>
        {/if}

        <div class="flex items-center justify-end mb-4">
          <button onclick={handleNewGroup} class="flex items-center gap-1.5 h-7 px-3 text-[10px] font-mono uppercase tracking-wider rounded border border-border text-muted hover:bg-bg3 hover:text-foreground transition-colors">
            <Plus size={12} /> {m.flow_newGroup()}
          </button>
        </div>

        <MasterFlowsSection />

        {#if loading}
          <p class="text-muted text-xs font-mono">{m.common_loading()}</p>
        {:else}
          <FlowGroupSection
            title={m.flow_myFlows()} kind="my" flows={ungrouped}
            onNewBlank={() => handleCreate(null)} onDeleteFlow={handleDeleteFlow}
          />
          {#each orderedGroups as group (group.id)}
            <FlowGroupSection
              title={group.name}
              kind={group.pluginId ? 'plugin' : 'user'}
              pluginId={group.pluginId}
              groupId={group.id}
              disabled={group.disabled}
              flows={flowsIn(group.id)}
              templates={group.pluginId ? (pluginTemplates[group.pluginId] ?? []) : []}
              onNewBlank={group.pluginId ? undefined : () => handleCreate(group.id)}
              onDeleteFlow={handleDeleteFlow}
              onRenameGroup={() => handleRenameGroup(group)}
              onDeleteGroup={() => handleDeleteGroup(group)}
              onChanged={loadAll}
            />
          {/each}
        {/if}
      </div>
    {:else}
      <BuilderHub only="skills" />
    {/if}
  </div>
