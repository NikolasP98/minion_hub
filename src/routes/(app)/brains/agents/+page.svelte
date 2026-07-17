<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate, goto } from '$lib/navigation';
  import { Bot } from 'lucide-svelte';
  import { Badge, Button, PageHeader } from '$lib/components/ui';
  import AsyncBoundary from '$lib/components/ui/foundations/AsyncBoundary.svelte';
  import PageBody from '$lib/components/ui/foundations/PageBody.svelte';
  import PageShell from '$lib/components/ui/foundations/PageShell.svelte';
  import * as m from '$lib/paraglide/messages';
  import { canAct } from '$lib/access/can.svelte';
  import DataTable from '$lib/components/data-table/DataTable.svelte';
  import type { DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import { jsonMutation, mutationErrorMessage } from '$lib/api/json-mutation';

  let { data }: { data: PageData } = $props();
  type Row = (typeof data.brains)[number];

  const canManage = $derived(canAct('brains', 'manage'));
  let busyId = $state<string | null>(null);
  let operationError = $state<string | null>(null);

  async function toggle(brainId: string, hasAgent: boolean) {
    if (hasAgent && !confirm(m.brains_agent_confirm_disable())) return;
    busyId = brainId;
    operationError = null;
    try {
      await jsonMutation({
        input: `/api/brains/${encodeURIComponent(brainId)}/agent`,
        init: { method: hasAgent ? 'DELETE' : 'POST' },
      });
      await invalidate('brains:list');
    } catch (error) {
      operationError = mutationErrorMessage(error, m.common_error());
    } finally {
      busyId = null;
    }
  }

  const columns = $derived<DataColumn<Row>[]>([
    {
      key: 'name',
      label: m.brains_doc_title(),
      custom: true,
      accessor: (r) => r.name ?? '',
      cellClass: 'font-medium',
    },
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
    {
      key: 'agentId',
      label: m.brains_agents_col_agent(),
      custom: true,
      accessor: (r) => r.agentId ?? '',
      cellClass: 'text-muted',
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            label: '',
            custom: true,
            align: 'right' as const,
            sortable: false,
            exportable: false,
            hideable: false,
          },
        ]
      : []),
  ]);
</script>

<svelte:head><title>{m.brains_nav_agents()} · {m.nav_brains()}</title></svelte:head>

<PageShell archetype="collection" scroll="none">
  <PageHeader title={m.brains_nav_agents()} subtitle={m.brains_agents_page_subtitle()}>
    {#snippet leading()}
      <Bot size={16} class="text-accent shrink-0" />
    {/snippet}
  </PageHeader>

  {#if operationError}
    <p class="mutation-error" role="alert">{operationError}</p>
  {/if}

  <PageBody padding="none" scroll="none">
    <AsyncBoundary
      state={data.brains.length === 0
        ? { kind: 'empty', title: m.brains_empty_title(), description: m.brains_empty_desc() }
        : { kind: 'ready' }}
      class="table-boundary"
    >
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
            <a href={`/brains/${r.id}`} class="record-link" onclick={(e) => e.stopPropagation()}
              >{r.name}</a
            >
          {:else if col.key === 'status'}
            {#if r.agentId}
              <Badge variant="semantic" value="success" size="sm"
                >{m.brains_agent_status_active()}</Badge
              >
            {:else}
              <Badge variant="neutral" size="sm">{m.brains_agent_status_none()}</Badge>
            {/if}
          {:else if col.key === 'agentId'}
            <span class="record-id">{r.agentId ?? '—'}</span>
          {:else if col.key === 'actions'}
            {#if r.agentId}
              <Button
                variant="danger"
                size="sm"
                loading={busyId === r.id}
                onclick={(e) => {
                  e.stopPropagation();
                  toggle(r.id, true);
                }}
              >
                {m.brains_agent_disable()}
              </Button>
            {:else}
              <Button
                variant="primary"
                size="sm"
                loading={busyId === r.id}
                onclick={(e) => {
                  e.stopPropagation();
                  toggle(r.id, false);
                }}
              >
                {m.brains_agent_enable()}
              </Button>
            {/if}
          {/if}
        {/snippet}
      </DataTable>
    </AsyncBoundary>
  </PageBody>

  <p class="roster-link">
    <a href="/agents?archetype=brain">{m.brains_agents_view_roster()}</a>
  </p>
</PageShell>

<style>
  :global(.table-boundary) {
    display: flex;
    height: 100%;
    min-height: 0;
    flex-direction: column;
  }

  .mutation-error {
    margin: var(--space-3) var(--space-page-gutter) 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-danger-border);
    border-radius: var(--radius-md);
    color: var(--color-danger-fg);
    background: var(--color-danger-surface);
    font-size: var(--font-size-caption);
  }

  .record-link,
  .roster-link a {
    color: var(--color-accent);
    text-decoration: none;
  }

  .record-link:hover,
  .roster-link a:hover {
    text-decoration: underline;
  }

  .record-id,
  .roster-link {
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
  }

  .roster-link {
    padding: var(--space-3) var(--space-page-gutter);
    border-top: 1px solid var(--color-border-subtle);
  }
</style>
