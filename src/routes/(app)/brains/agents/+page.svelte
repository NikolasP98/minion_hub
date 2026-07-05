<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate, goto } from '$app/navigation';
  import { Bot } from 'lucide-svelte';
  import { Badge, Button, PageHeader } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { canAct } from '$lib/access/can.svelte';
  import DataTable from '$lib/components/data-table/DataTable.svelte';
  import type { DataColumn } from '$lib/components/data-table/DataTable.svelte';

  let { data }: { data: PageData } = $props();
  type Row = (typeof data.brains)[number];

  const canManage = $derived(canAct('brains', 'manage'));
  let busyId = $state<string | null>(null);

  async function toggle(brainId: string, hasAgent: boolean) {
    if (hasAgent && !confirm(m.brains_agent_confirm_disable())) return;
    busyId = brainId;
    try {
      await fetch(`/api/brains/${encodeURIComponent(brainId)}/agent`, { method: hasAgent ? 'DELETE' : 'POST' });
      await invalidate('brains:list');
    } finally {
      busyId = null;
    }
  }

  const columns = $derived<DataColumn<Row>[]>([
    { key: 'name', label: m.brains_doc_title(), custom: true, accessor: (r) => r.name ?? '', cellClass: 'font-medium' },
    {
      key: 'status',
      label: m.brains_agents_col_status(),
      custom: true,
      accessor: (r) => (r.agentId ? m.brains_agent_status_active() : m.brains_agent_status_none()),
      filter: {
        options: () => [
          { value: 'active', label: m.brains_agent_status_active() },
          { value: 'none', label: m.brains_agent_status_none() },
        ],
        match: (r) => (r.agentId ? 'active' : 'none'),
      },
    },
    { key: 'agentId', label: m.brains_agents_col_agent(), custom: true, accessor: (r) => r.agentId ?? '', cellClass: 'text-muted' },
    ...(canManage ? [{ key: 'actions', label: '', custom: true, align: 'right' as const, sortable: false, exportable: false, hideable: false }] : []),
  ]);
</script>

<svelte:head><title>{m.brains_nav_agents()} · {m.nav_brains()}</title></svelte:head>

<div class="flex h-full flex-col overflow-hidden">
  <PageHeader title={m.brains_nav_agents()} subtitle={m.brains_agents_page_subtitle()}>
    {#snippet leading()}
      <Bot size={16} class="text-accent shrink-0" />
    {/snippet}
  </PageHeader>

  <DataTable
    class="flex-1 min-h-0"
    {columns}
    data={data.brains}
    getRowId={(r) => r.id}
    searchFields={(r) => `${r.name ?? ''} ${r.agentId ?? ''}`}
    initialSort={{ key: 'name', dir: 'asc' }}
    exportable
    exportName="brains-agents"
    selectable
    storageKey="brains-agents"
    onRowClick={(r) => goto(`/brains/${r.id}`)}
    emptyMessage={m.brains_empty_desc()}
  >
    {#snippet cell(r: Row, col: DataColumn<Row>)}
      {#if col.key === 'name'}
        <a href={`/brains/${r.id}`} class="text-accent hover:underline" onclick={(e) => e.stopPropagation()}>{r.name}</a>
      {:else if col.key === 'status'}
        {#if r.agentId}
          <Badge variant="semantic" value="success" size="sm">{m.brains_agent_status_active()}</Badge>
        {:else}
          <Badge variant="neutral" size="sm">{m.brains_agent_status_none()}</Badge>
        {/if}
      {:else if col.key === 'agentId'}
        <span class="text-muted">{r.agentId ?? '—'}</span>
      {:else if col.key === 'actions'}
        {#if r.agentId}
          <Button variant="danger" size="sm" loading={busyId === r.id} onclick={(e) => { e.stopPropagation(); toggle(r.id, true); }}>
            {m.brains_agent_disable()}
          </Button>
        {:else}
          <Button variant="primary" size="sm" loading={busyId === r.id} onclick={(e) => { e.stopPropagation(); toggle(r.id, false); }}>
            {m.brains_agent_enable()}
          </Button>
        {/if}
      {/if}
    {/snippet}
  </DataTable>

  <p class="px-6 py-3 text-xs text-muted">
    <a href="/agents?archetype=brain" class="text-accent hover:underline">{m.brains_agents_view_roster()}</a>
  </p>
</div>
