<script lang="ts">
  import { Plug } from 'lucide-svelte';
  import { invalidate } from '$lib/navigation';
  import * as m from '$lib/paraglide/messages';
  import { Button, Card, EmptyState } from '$lib/components/ui';
  import { ConfirmDialog } from '$lib/components/ui/foundations';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import { jsonMutation } from '$lib/api/json-mutation';
  import { formatDate } from '$lib/utils/format';
  import { toastSuccess } from '$lib/state/ui/toast.svelte';
  import type { McpConnectionRow } from '$lib/types/mcp-connections';

  // `showPerson` is off on a person's own account page, where every row is theirs.
  let {
    connections,
    showPerson = true,
  }: { connections: McpConnectionRow[]; showPerson?: boolean } = $props();

  const when = (iso: string | null) =>
    iso
      ? formatDate(iso, { dateStyle: 'medium', timeStyle: 'short' })
      : m.settings_developers_never();

  // ── End a connection ─────────────────────────────────────────────────────
  let ending = $state<McpConnectionRow | null>(null);
  let endOpen = $state(false);

  function askEnd(row: McpConnectionRow) {
    ending = row;
    endOpen = true;
  }

  async function end() {
    if (!ending) return;
    await jsonMutation({
      input: `/api/settings/mcp-connections/${encodeURIComponent(ending.id)}`,
      init: { method: 'DELETE' },
      onSuccess: async () => {
        await Promise.all([invalidate('settings:developers'), invalidate('app:security')]);
      },
    });
    toastSuccess(m.settings_mcp_disconnected_toast());
  }

  const allColumns: DataColumn<McpConnectionRow>[] = [
    { key: 'appName', label: m.settings_mcp_col_app(), accessor: (r) => r.appName, fill: true },
    {
      key: 'personName',
      label: m.settings_mcp_col_person(),
      accessor: (r) => r.personName ?? '—',
      width: 200,
    },
    {
      key: 'approvedAt',
      label: m.settings_mcp_col_approved(),
      accessor: (r) => r.approvedAt,
      custom: true,
      width: 170,
    },
    {
      key: 'lastUsedAt',
      label: m.settings_developers_col_last_used(),
      accessor: (r) => r.lastUsedAt ?? '',
      custom: true,
      width: 170,
    },
    {
      key: 'actions',
      label: '',
      accessor: () => '',
      custom: true,
      sortable: false,
      width: 140,
    },
  ];
  const columns = $derived(
    showPerson ? allColumns : allColumns.filter((c) => c.key !== 'personName'),
  );
</script>

{#snippet approvedCell(r: McpConnectionRow)}{when(r.approvedAt)}{/snippet}
{#snippet lastUsedCell(r: McpConnectionRow)}{when(r.lastUsedAt)}{/snippet}
{#snippet actionCell(r: McpConnectionRow)}
  <Button variant="ghost" size="xs" onclick={() => askEnd(r)}>
    {m.settings_mcp_disconnect()}
  </Button>
{/snippet}
{#snippet tableEmpty()}
  <EmptyState
    icon={Plug}
    title={m.settings_mcp_empty_title()}
    description={m.settings_mcp_empty_desc()}
    compact
  />
{/snippet}

<section class="section" aria-labelledby="mcp-connections-title">
  <h2 id="mcp-connections-title" class="t-title">{m.settings_mcp_title()}</h2>
  <p class="t-body muted">{m.settings_mcp_hint()}</p>
  <Card padding="none">
    <DataTable
      ariaLabel={m.settings_mcp_title()}
      variant="plain"
      data={connections}
      {columns}
      getRowId={(r) => r.id}
      empty={tableEmpty}
      cells={{ approvedAt: approvedCell, lastUsedAt: lastUsedCell, actions: actionCell }}
    />
  </Card>
</section>

<ConfirmDialog
  bind:open={endOpen}
  title={m.settings_mcp_disconnect_title({ name: ending?.appName ?? '' })}
  message={m.settings_mcp_disconnect_message()}
  confirmLabel={m.settings_mcp_disconnect()}
  failureMessage={m.settings_mcp_disconnect_failed()}
  tone="danger"
  onconfirm={end}
/>

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-top: var(--space-section);
  }
  .muted {
    margin: 0;
    color: var(--color-text-secondary);
  }
</style>
