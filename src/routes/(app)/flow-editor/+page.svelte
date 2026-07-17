<script lang="ts">
  import { goto } from '$lib/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { Plus, Workflow } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import FlowGroupSection from '$lib/components/flow-editor/FlowGroupSection.svelte';
  import MasterFlowsSection from '$lib/components/flow-editor/MasterFlowsSection.svelte';
  import { sendRequest } from '$lib/services/gateway.svelte';
  import { sortGroups, type FlowGroupMeta } from '$lib/flows/groups';
  import { SvelteMap } from 'svelte/reactivity';
  import { Button, PageHeader } from '$lib/components/ui';
  import AsyncBoundary from '$lib/components/ui/foundations/AsyncBoundary.svelte';
  import PageBody from '$lib/components/ui/foundations/PageBody.svelte';
  import PageShell from '$lib/components/ui/foundations/PageShell.svelte';
  import { fetchJson } from '$lib/api/fetch-json';

  type FlowMeta = {
    id: string;
    name: string;
    nodeCount: number;
    createdAt: number;
    updatedAt: number;
    pluginId?: string | null;
    groupId?: string | null;
  };
  type Template = { id: string; name: string; nodes: unknown[]; edges: unknown[] };
  type FlowPluginGroup = {
    pluginId: string;
    displayName: string;
    enabled: boolean;
    templates: Template[];
  };

  let flows = $state<FlowMeta[]>([]);
  let groups = $state<FlowGroupMeta[]>([]);
  let pluginTemplates = $state<Record<string, Template[]>>({});
  let loading = $state(true);
  let createError = $state<string | null>(null);
  let loadError = $state<string | null>(null);

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
    loadError = null;
    try {
      const [flowResult, groupResult] = await Promise.all([
        fetchJson<{ flows: FlowMeta[] }>('/api/flows'),
        fetchJson<{ groups: FlowGroupMeta[] }>('/api/flow-groups'),
      ]);
      flows = flowResult.flows;
      groups = groupResult.groups;
    } catch (error) {
      loadError = error instanceof Error ? error.message : m.common_error();
    } finally {
      loading = false;
    }
  }

  async function reconcile() {
    try {
      const res = (await sendRequest('flows.templates.list', {})) as {
        plugins?: FlowPluginGroup[];
        templates?: {
          pluginId: string;
          id: string;
          name: string;
          nodes: unknown[];
          edges: unknown[];
        }[];
      } | null;
      let plugins: FlowPluginGroup[] = res?.plugins ?? [];
      if (plugins.length === 0 && res?.templates?.length) {
        const byPlugin = new SvelteMap<string, Template[]>();
        for (const t of res.templates) {
          const arr = byPlugin.get(t.pluginId) ?? [];
          arr.push({ id: t.id, name: t.name, nodes: t.nodes, edges: t.edges });
          byPlugin.set(t.pluginId, arr);
        }
        plugins = [...byPlugin].map(([pluginId, templates]) => ({
          pluginId,
          displayName: pluginId,
          enabled: true,
          templates,
        }));
      }
      pluginTemplates = Object.fromEntries(plugins.map((p) => [p.pluginId, p.templates]));
      const out = await fetchJson<{
        groupsCreated?: number;
        flowsSeeded?: number;
        flowsReassigned?: number;
        groupsReleased?: number;
        groupsUpdated?: number;
      }>('/api/flows/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plugins }),
      });
      if (
        out.groupsCreated ||
        out.flowsSeeded ||
        out.flowsReassigned ||
        out.groupsReleased ||
        out.groupsUpdated
      ) {
        await loadAll();
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
      const result = await fetchJson<{ id: string }>('/api/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, groupId }),
      });
      goto(`/flow-editor/${result.id}`);
    } catch (e) {
      createError = e instanceof Error ? e.message : m.common_error();
    }
  }

  async function handleDeleteFlow(flow: { id: string }) {
    createError = null;
    try {
      await fetchJson(`/api/flows/${flow.id}`, { method: 'DELETE' });
      flows = flows.filter((candidate) => candidate.id !== flow.id);
    } catch (error) {
      createError = error instanceof Error ? error.message : m.common_error();
    }
  }

  async function handleNewGroup() {
    const name = prompt(m.flow_groupNamePrompt());
    if (!name) return;
    createError = null;
    try {
      await fetchJson('/api/flow-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      await loadAll();
    } catch (error) {
      createError = error instanceof Error ? error.message : m.common_error();
    }
  }

  async function handleRenameGroup(group: FlowGroupMeta) {
    const name = prompt(m.flow_groupNamePrompt(), group.name);
    if (!name) return;
    createError = null;
    try {
      await fetchJson(`/api/flow-groups/${group.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      await loadAll();
    } catch (error) {
      createError = error instanceof Error ? error.message : m.common_error();
    }
  }

  async function handleDeleteGroup(group: FlowGroupMeta) {
    createError = null;
    try {
      await fetchJson(`/api/flow-groups/${group.id}`, { method: 'DELETE' });
      await loadAll();
    } catch (error) {
      createError = error instanceof Error ? error.message : m.common_error();
    }
  }
</script>

<PageShell archetype="collection" scroll="none">
  <PageHeader title={m.flow_title()} subtitle={m.flow_canvasLabel()}>
    {#snippet leading()}<Workflow size={16} aria-hidden="true" />{/snippet}
    {#snippet primaryActions()}
      <Button variant="primary" size="sm" onclick={() => handleCreate(null)}>
        {#snippet icon()}<Plus size={14} aria-hidden="true" />{/snippet}
        {m.flow_newFlow()}
      </Button>
    {/snippet}
    {#snippet secondaryActions()}
      <Button variant="secondary" size="sm" onclick={handleNewGroup}>
        {#snippet icon()}<Plus size={14} aria-hidden="true" />{/snippet}
        {m.flow_newGroup()}
      </Button>
    {/snippet}
  </PageHeader>

  <PageBody width="content" scroll="region">
    {#if createError}
      <p class="operation-error" role="alert">{createError}</p>
    {/if}

    <MasterFlowsSection />

    <AsyncBoundary
      state={loading
        ? { kind: 'loading' }
        : loadError
          ? { kind: 'error', title: m.common_error(), description: loadError, retry: loadAll }
          : flows.length === 0 && groups.length === 0
            ? { kind: 'empty', title: m.flow_noFlows(), description: m.flow_createFirst() }
            : { kind: 'ready' }}
    >
      {#snippet emptyAction()}
        <Button variant="primary" size="sm" onclick={() => handleCreate(null)}
          >{m.flow_newFlow()}</Button
        >
      {/snippet}
      <FlowGroupSection
        title={m.flow_myFlows()}
        kind="my"
        flows={ungrouped}
        onNewBlank={() => handleCreate(null)}
        onDeleteFlow={handleDeleteFlow}
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
    </AsyncBoundary>
  </PageBody>
</PageShell>

<style>
  .operation-error {
    margin-bottom: var(--space-4);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-danger-border);
    border-radius: var(--radius-md);
    color: var(--color-danger-fg);
    background: var(--color-danger-surface);
    font-family: var(--font-family-mono);
    font-size: var(--font-size-mono);
    line-height: var(--line-height-compact);
  }
</style>
