<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import * as m from '$lib/paraglide/messages';
  import { formatMoney } from '$lib/utils/format';
  import { ArrowLeftRight, ArrowLeft } from 'lucide-svelte';
  import { PageHeader, Button, Badge, Modal } from '$lib/components/ui';
  import { canAct } from '$lib/access/can.svelte';
  import { entryStatusVariant } from '$lib/components/stock/stock-ui';
  import { AttachmentButton, AttachmentList } from '$lib/components/attachments';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';

  let { data }: { data: PageData } = $props();
  type LineRow = PageData['lines'][number];
  const entry = $derived(data.entry);
  const statusV = $derived(entryStatusVariant(entry.status));
  const statusLabel = $derived(
    entry.status === 'draft'
      ? m.stock_status_draft()
      : entry.status === 'submitted'
        ? m.stock_status_submitted()
        : m.stock_status_cancelled(),
  );
  const typeLabel = $derived(
    entry.type === 'receipt'
      ? m.stock_type_receipt()
      : entry.type === 'issue'
        ? m.stock_type_issue()
        : entry.type === 'transfer'
          ? m.stock_type_transfer()
          : m.stock_type_adjustment(),
  );

  let busy = $state(false);
  let err = $state<string | null>(null);
  let confirmCancelOpen = $state(false);
  let attachmentsRefreshKey = $state(0);

  async function errMessage(res: Response): Promise<string> {
    try {
      const body = await res.json();
      return body?.message ?? m.stock_submit_failed();
    } catch {
      return m.stock_submit_failed();
    }
  }

  async function submitEntry() {
    busy = true;
    err = null;
    try {
      const res = await fetch(`/api/stock/entries/${entry.id}/submit`, { method: 'POST' });
      if (res.ok) await invalidate('stock:entry-detail');
      else err = await errMessage(res);
    } finally {
      busy = false;
    }
  }

  const lineColumns: DataColumn<LineRow>[] = [
    { key: 'item', label: m.stock_field_item(), accessor: (l) => l.itemLabel },
    {
      key: 'qty',
      label: m.stock_field_qty(),
      align: 'right',
      numeric: true,
      custom: true,
      accessor: (l) => Number(l.qty),
    },
    {
      key: 'rate',
      label: m.stock_field_rate(),
      align: 'right',
      numeric: true,
      custom: true,
      accessor: (l) => (l.rate != null ? Number(l.rate) : null),
    },
    {
      key: 'fromWarehouse',
      label: m.stock_field_from_warehouse(),
      accessor: (l) => l.fromWarehouseName ?? '—',
    },
    {
      key: 'toWarehouse',
      label: m.stock_field_to_warehouse(),
      accessor: (l) => l.toWarehouseName ?? '—',
    },
  ];

  async function cancelEntry() {
    busy = true;
    err = null;
    try {
      const res = await fetch(`/api/stock/entries/${entry.id}/cancel`, { method: 'POST' });
      confirmCancelOpen = false;
      if (res.ok) await invalidate('stock:entry-detail');
      else err = await errMessage(res);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>{entry.humanId ?? entry.id} — {m.nav_stock()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0 flex-1 min-w-0">
  <PageHeader title={entry.humanId ?? entry.id.slice(0, 8)} subtitle={typeLabel}>
    {#snippet leading()}<ArrowLeftRight size={16} class="text-accent shrink-0" />{/snippet}
    {#snippet actions()}
      <Button variant="outline" size="sm" onclick={() => history.back()}
        ><ArrowLeft size={14} /> {m.common_back()}</Button
      >
      {#if entry.status === 'draft'}
        <Button
          variant="primary"
          size="sm"
          onclick={submitEntry}
          disabled={busy || !canAct('stock', 'edit')}
          title={canAct('stock', 'edit') ? undefined : m.no_permission()}>{m.stock_submit()}</Button
        >
      {:else if entry.status === 'submitted'}
        <Button
          variant="outline"
          size="sm"
          onclick={() => (confirmCancelOpen = true)}
          disabled={busy || !canAct('stock', 'manage')}
          title={canAct('stock', 'manage') ? undefined : m.no_permission()}
          >{m.stock_cancel_entry()}</Button
        >
      {/if}
    {/snippet}
  </PageHeader>

  <div class="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4">
    {#if err}<p class="err-msg">{err}</p>{/if}
    <div class="card">
      <dl class="meta-grid">
        <dt>{m.stock_col_status()}</dt>
        <dd><Badge variant={statusV.variant} value={statusV.value}>{statusLabel}</Badge></dd>
        <dt>{m.stock_col_party()}</dt>
        <dd>{data.partyName ?? m.stock_no_party()}</dd>
        <dt>{m.stock_field_note()}</dt>
        <dd>{entry.note ?? '—'}</dd>
        <dt>{m.stock_col_created()}</dt>
        <dd>{new Date(entry.createdAt).toLocaleString()}</dd>
        {#if entry.postedAt}<dt>{m.stock_col_posted_at()}</dt>
          <dd>{new Date(entry.postedAt).toLocaleString()}</dd>{/if}
      </dl>
    </div>

    <div class="card">
      <div class="card-h">{m.stock_entry_lines_title()}</div>
      <DataTable variant="plain" data={data.lines} columns={lineColumns} getRowId={(l) => l.id}>
        {#snippet cell(row: LineRow, col: DataColumn<LineRow>)}
          {#if col.key === 'qty'}
            <span class="tabular-nums">{Number(row.qty).toLocaleString()}</span>
          {:else if col.key === 'rate'}
            <span class="tabular-nums">{row.rate != null ? formatMoney(row.rate) : '—'}</span>
          {/if}
        {/snippet}
      </DataTable>
    </div>

    <div class="card">
      <div class="card-h flex items-center justify-between gap-2">
        <span>{m.attachments_title()}</span>
        <AttachmentButton
          objectType="stk_entry"
          objectId={entry.id}
          size="sm"
          hint="tooltip"
          disabled={!canAct('stock', 'edit')}
          onuploaded={() => (attachmentsRefreshKey += 1)}
        />
      </div>
      <AttachmentList
        objectType="stk_entry"
        objectId={entry.id}
        refreshKey={attachmentsRefreshKey}
      />
    </div>
  </div>
</div>

<Modal bind:open={confirmCancelOpen} title={m.stock_confirm_cancel_title()}>
  <p>{m.stock_confirm_cancel_body()}</p>
  {#snippet footer()}
    <Button variant="outline" size="sm" onclick={() => (confirmCancelOpen = false)}
      >{m.common_cancel()}</Button
    >
    <Button variant="primary" size="sm" onclick={cancelEntry} disabled={busy}
      >{m.common_confirm()}</Button
    >
  {/snippet}
</Modal>

<style>
  .card {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    padding: var(--space-3) var(--space-4);
  }
  .card-h {
    font-size: var(--font-size-body);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-muted-foreground);
    margin-bottom: var(--space-3);
  }
  .meta-grid {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-2) var(--space-4);
    font-size: var(--font-size-body);
    align-items: center;
  }
  .meta-grid dt {
    color: var(--color-muted-foreground);
  }
  .err-msg {
    font-size: var(--font-size-body);
    color: var(--color-destructive);
  }
</style>
