<script lang="ts">
  import type { PageData } from './$types';
  import { goto } from '$lib/navigation';
  import * as m from '$lib/paraglide/messages';
  import { formatMoney } from '$lib/utils/format';
  import { ArrowLeftRight, Paperclip } from 'lucide-svelte';
  import {
    PageHeader,
    Badge,
    Button,
    Chip,
    EmptyState,
    Tooltip,
    iconSizes,
  } from '$lib/components/ui';
  import { canAct } from '$lib/access/can.svelte';
  import { entryStatusVariant } from '$lib/components/stock/stock-ui';
  import { warehouseSpan, type EntryDocumentKind } from '$lib/components/stock/entry-document';
  import EntryTypeBadge from '$lib/components/stock/EntryTypeBadge.svelte';
  import PeekLink from '$lib/records/PeekLink.svelte';
  import DataTable from '$lib/components/data-table/DataTable.svelte';
  import type { DataColumn } from '$lib/components/data-table/DataTable.svelte';

  let { data }: { data: PageData } = $props();
  const entries = $derived(data.entries);
  type Row = (typeof entries)[number];

  // Lazy per-entry line items (loaded on expand). Memoize the fetch so `{#await}`
  // resolves once and re-renders don't refetch.
  type Line = {
    itemId: string;
    qty: string | number;
    uom: string | null;
    rate: string | number | null;
    lineNo: number;
    fromWarehouseId: string | null;
    toWarehouseId: string | null;
  };
  const linePromises = new Map<string, Promise<Line[]>>();
  function entryLines(id: string): Promise<Line[]> {
    let p = linePromises.get(id);
    if (!p) {
      p = fetch(`/api/stock/entries/${id}`)
        .then((r) => (r.ok ? r.json() : { lines: [] }))
        .then((d) => (d.lines ?? []) as Line[])
        .catch(() => []);
      linePromises.set(id, p);
    }
    return p;
  }
  const itemLabel = (id: string) => {
    const it = data.itemsById[id];
    return it ? (it.code ? `${it.code} · ${it.name}` : it.name) : id.slice(0, 8);
  };
  const fmtNum = (v: string | number | null) => (v == null ? '—' : Number(v).toLocaleString());
  const amountOf = (l: Line) => (l.rate == null ? null : Number(l.qty) * Number(l.rate));
  /** The expanded entry's lines — a nested `plain` table, not hand-rolled markup,
   *  so the lines inherit column widths, resize and the shared cell rhythm. */
  const lineColumns: DataColumn<Line>[] = [
    {
      key: 'item',
      label: m.stock_col_item(),
      fill: true,
      custom: true,
      accessor: (l) => itemLabel(l.itemId),
    },
    {
      key: 'qty',
      label: m.stock_col_qty(),
      align: 'right',
      width: 112,
      accessor: (l) => `${fmtNum(l.qty)}${l.uom ? ` ${l.uom}` : ''}`,
    },
    {
      key: 'rate',
      label: m.stock_field_rate(),
      align: 'right',
      width: 112,
      accessor: (l) => (l.rate == null ? '—' : formatMoney(l.rate)),
    },
    {
      key: 'amount',
      label: m.stock_col_amount(),
      align: 'right',
      width: 120,
      money: true,
      custom: true,
      accessor: (l) => amountOf(l) ?? 0,
    },
    {
      key: 'warehouse',
      label: m.stock_col_warehouse(),
      width: 180,
      accessor: (l) => warehouseSpan(l.fromWarehouseId, l.toWarehouseId, data.warehousesById),
    },
  ];

  const statusLabel = (s: string) =>
    s === 'draft'
      ? m.stock_status_draft()
      : s === 'submitted'
        ? m.stock_status_submitted()
        : m.stock_status_cancelled();
  const typeLabel = (t: string) =>
    t === 'receipt'
      ? m.stock_type_receipt()
      : t === 'issue'
        ? m.stock_type_issue()
        : t === 'transfer'
          ? m.stock_type_transfer()
          : m.stock_type_adjustment();
  const idLabel = (e: Row) => e.humanId ?? e.id.slice(0, 8);
  const documentKindLabel = (k: EntryDocumentKind) =>
    k === 'ticket'
      ? m.stock_document_ticket()
      : k === 'invoice'
        ? m.stock_document_invoice()
        : k === 'purchase'
          ? m.stock_document_purchase()
          : m.stock_document_booking();

  const columns: DataColumn<Row>[] = [
    {
      key: 'type',
      label: m.stock_col_type(),
      custom: true,
      accessor: (e) => typeLabel(e.type),
      filter: {
        options: () =>
          ['receipt', 'issue', 'transfer', 'adjustment'].map((v) => ({
            value: v,
            label: typeLabel(v),
          })),
        match: (e) => e.type,
      },
    },
    {
      key: 'status',
      label: m.stock_col_status(),
      custom: true,
      accessor: (e) => statusLabel(e.status),
      filter: {
        options: () =>
          ['draft', 'submitted', 'cancelled'].map((v) => ({ value: v, label: statusLabel(v) })),
        match: (e) => e.status,
      },
    },
    {
      key: 'party',
      label: m.stock_col_party(),
      accessor: (e) => e.partyName ?? '',
      cellClass: 't-caption',
    },
    {
      key: 'document',
      label: m.stock_col_document(),
      custom: true,
      width: 200,
      accessor: (e) => e.document?.label ?? '',
      exportValue: (e) => e.document?.label ?? '',
    },
    {
      key: 'attachments',
      label: m.stock_col_attachments(),
      align: 'right',
      width: 96,
      custom: true,
      accessor: (e) => e.attachmentCount,
      exportValue: (e) => String(e.attachmentCount),
    },
    {
      key: 'warehouse',
      label: m.stock_col_warehouse(),
      width: 180,
      accessor: (e) =>
        warehouseSpan(e.firstFromWarehouseId, e.firstToWarehouseId, data.warehousesById),
    },
    {
      key: 'lines',
      label: m.stock_col_lines(),
      align: 'right',
      width: 88,
      numeric: true,
      accessor: (e) => e.lineCount,
    },
    {
      key: 'note',
      label: m.stock_field_note(),
      cellClass: 't-caption',
      defaultHidden: true,
      accessor: (e) => e.note ?? '',
    },
    {
      key: 'posted',
      label: m.stock_col_posted_at(),
      align: 'right',
      custom: true,
      accessor: (e) => e.postedAt,
      sortFn: (a, b) =>
        (a.postedAt ? new Date(a.postedAt).getTime() : 0) -
        (b.postedAt ? new Date(b.postedAt).getTime() : 0),
      exportValue: (e) => (e.postedAt ? new Date(e.postedAt).toISOString().slice(0, 10) : ''),
    },
    {
      key: 'created',
      label: m.stock_col_created(),
      align: 'right',
      custom: true,
      accessor: (e) => e.createdAt,
      sortFn: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      exportValue: (e) => new Date(e.createdAt).toISOString().slice(0, 10),
    },
  ];
</script>

<svelte:head><title>{m.stock_entries_title()} — {m.nav_stock()}</title></svelte:head>

<!-- `?party=` is a PAGE filter (it re-runs the server load), so it rides in the
     core chip bar through `chips` rather than a hand-rolled toolbar chip. -->
{#snippet partyChip()}
  <Chip onRemove={() => goto('/stock/entries')}>
    {m.stock_col_party()}: {data.entries[0]?.partyName ?? data.partyFilter}
  </Chip>
{/snippet}

<div class="stock-entries-page flex flex-col h-full min-h-0 flex-1 min-w-0">
  <PageHeader title={m.stock_entries_title()} subtitle={m.stock_entries_subtitle()}>
    {#snippet leading()}<ArrowLeftRight size={16} class="text-accent shrink-0" />{/snippet}
  </PageHeader>

  {#if entries.length === 0 && data.partyFilter}
    <EmptyState
      icon={ArrowLeftRight}
      title={m.stock_entries_empty()}
      description={m.stock_entries_empty_filtered_hint()}
    >
      {#snippet action()}
        <Button variant="outline" size="sm" onclick={() => goto('/stock/entries')}>
          {m.a11y3_clearFilter()}
        </Button>
      {/snippet}
    </EmptyState>
  {:else if entries.length === 0}
    <EmptyState
      icon={ArrowLeftRight}
      title={m.stock_entries_empty()}
      description={m.stock_entries_empty_hint()}
    >
      {#snippet action()}
        <Button
          variant="primary"
          size="sm"
          href="/stock/entries/new"
          disabled={!canAct('stock', 'create')}
          title={canAct('stock', 'create') ? undefined : m.no_permission()}
        >
          {m.stock_new_entry()}
        </Button>
      {/snippet}
    </EmptyState>
  {:else}
    <DataTable
      class="flex-1 min-h-0"
      tableId="stock.entries"
      idColumn={{ value: (e) => e.humanId ?? e.id.slice(0, 8) }}
      titleColumn={{ key: 'type', href: (e) => `/stock/entries/${e.id}` }}
      {columns}
      data={entries}
      getRowId={(e) => e.id}
      customProperties={{
        bundle: data.customProperties,
        recordId: (entry) => entry.id,
        scopeKey: `${data.activeOrgId ?? ''}:stock.entries`,
      }}
      searchFields={(e) =>
        `${idLabel(e)} ${typeLabel(e.type)} ${statusLabel(e.status)} ${e.partyName ?? ''}`}
      initialSort={{ key: 'created', dir: 'desc' }}
      exportable
      exportName="stock-entries"
      selectable
      storageKey="stock-entries"
      addLabel={m.stock_new_entry()}
      addMenu={canAct('stock', 'create')
        ? [
            { value: 'receipt', label: m.stock_type_receipt() },
            { value: 'issue', label: m.stock_type_issue() },
            // Transfer needs somewhere to transfer TO — hidden entirely with a
            // single warehouse (spec 2026-08-23 §S6 logic-gating).
            ...(data.warehouseCount > 1
              ? [{ value: 'transfer', label: m.stock_type_transfer() }]
              : []),
            { value: 'adjustment', label: m.stock_type_adjustment() },
          ]
        : undefined}
      onAddSelect={(t) => goto(`/stock/entries/new?type=${t}`)}
      addDisabled={!canAct('stock', 'create')}
      emptyMessage={m.stock_entries_empty()}
      chips={data.partyFilter ? partyChip : undefined}
    >
      {#snippet expandedContent(e: Row)}
        <div class="lines">
          {#await entryLines(e.id)}
            <div class="lines-msg">…</div>
          {:then lines}
            {#if lines.length === 0}
              <div class="lines-msg">{m.stock_entries_empty()}</div>
            {:else}
              <DataTable
                variant="plain"
                class="lines-tbl"
                data={lines}
                columns={lineColumns}
                getRowId={(l) => `${l.itemId}:${l.lineNo}`}
                footer
              >
                {#snippet cell(l: Line, col: DataColumn<Line>)}
                  {#if col.key === 'item'}
                    <PeekLink href={`/stock/items/${l.itemId}`} tableId="stock.items">
                      {itemLabel(l.itemId)}
                    </PeekLink>
                  {:else if col.key === 'amount'}
                    {@const amount = amountOf(l)}
                    {amount == null ? '—' : formatMoney(amount)}
                  {/if}
                {/snippet}
              </DataTable>
            {/if}
          {/await}
        </div>
      {/snippet}
      {#snippet cell(e: Row, col: DataColumn<Row>)}
        {#if col.key === 'type'}
          <EntryTypeBadge type={e.type} label={typeLabel(e.type)} />
        {:else if col.key === 'status'}
          {@const sv = entryStatusVariant(e.status)}
          <Badge variant={sv.variant} value={sv.value}>{statusLabel(e.status)}</Badge>
        {:else if col.key === 'document'}
          {#if e.document}
            <span class="doc-cell">
              <Badge variant="neutral" size="sm">{documentKindLabel(e.document.kind)}</Badge>
              <PeekLink href={e.document.href} mode="modal" class="doc-link">
                {e.document.label}
              </PeekLink>
            </span>
          {:else if e.type === 'receipt'}
            <!-- No provider invoice was picked for this receipt (optional field,
                 or the receipt predates the picker) — its supplier invoice, if
                 any, lives only in the entry's attachments. -->
            <Tooltip label={m.stock_document_receipt_hint()}>
              <span class="t-caption">—</span>
            </Tooltip>
          {:else}
            <span class="t-caption">—</span>
          {/if}
        {:else if col.key === 'attachments'}
          {#if e.attachmentCount > 0}
            <span class="attach-cell">
              <PeekLink href={`/stock/entries/${e.id}`} mode="modal" class="attach-link">
                <Paperclip size={iconSizes.sm} />
                {e.attachmentCount}
              </PeekLink>
            </span>
          {:else}
            <span class="t-caption">—</span>
          {/if}
        {:else if col.key === 'created'}
          <span class="t-caption">{new Date(e.createdAt).toLocaleDateString()}</span>
        {:else if col.key === 'posted'}
          <span class="t-caption"
            >{e.postedAt ? new Date(e.postedAt).toLocaleDateString() : '—'}</span
          >
        {/if}
      {/snippet}
    </DataTable>
  {/if}
</div>

<style>
  .lines {
    padding: var(--space-2) var(--space-4) var(--space-2) var(--space-12);
  }
  .lines-msg {
    font-size: var(--font-size-body);
    color: var(--color-muted-foreground);
    padding: var(--space-2) 0;
  }
  .stock-entries-page :global(.lines-tbl) {
    max-width: 52rem;
  }
  .doc-cell {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .doc-cell :global(.doc-link) {
    color: var(--color-accent);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .doc-cell :global(.doc-link:hover) {
    text-decoration: underline;
  }
  .attach-cell {
    display: inline-flex;
    justify-content: flex-end;
  }
  .attach-cell :global(.attach-link) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-text-secondary);
    text-decoration: none;
    font-variant-numeric: tabular-nums;
  }
  .attach-cell :global(.attach-link:hover) {
    color: var(--color-accent);
  }
</style>
