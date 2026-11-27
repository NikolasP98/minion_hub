<script lang="ts">
  import type { PageData as LoadedPageData } from './$types';
  import type { Granted } from '$lib/permissions';
  import { page } from '$app/state';
  import { goto } from '$lib/navigation';
  import * as m from '$lib/paraglide/messages';
  import { appLocale } from '$lib/utils/format';
  import { mulDecimal } from '$lib/components/stock/decimal';
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
  import type { ComponentProps } from 'svelte';
  import { entryTypeLabel } from '$lib/components/stock/entry-type-label';
  import { ENTRY_TYPES } from '$lib/stock/entry-legs';
  import type { DataColumn } from '$lib/components/data-table/DataTable.svelte';

  type PageData = Granted<LoadedPageData['stock']>;
  let { data }: { data: PageData } = $props();
  const mv = $derived(data.movements);
  const isFull = $derived(mv.projection === 'full');
  const canSort = $derived(mv.projection !== 'identity_only');
  /** One uniform row for the three wire variants: omitted fields are simply absent (never zero). */
  type FullRow = Extract<PageData['movements'], { projection: 'full' }>['rows'][number];
  type Row = { entryId: string; entryHref: string } & Partial<FullRow>;
  const entries = $derived(mv.rows as Row[]);
  const itemDict = $derived(mv.projection === 'full' ? mv.itemsById : {});
  const whDict = $derived(mv.projection === 'full' ? mv.warehousesById : {});
  type Line = FullRow['lines'][number];

  // Page-local view state (search/sort/filters/advanced) lives HERE so it survives
  // Older/Newest navigation; selection/expansion reset per raw page, everything resets on scope change.
  let search = $state('');
  let sort = $state<{ key: string; dir: 'asc' | 'desc' }[]>([{ key: 'created', dir: 'desc' }]);
  let filters = $state<NonNullable<ComponentProps<typeof DataTable>['filters']>>({});
  let advanced = $state<ComponentProps<typeof DataTable>['advanced']>(null);
  let selectedIds = $state(new Set<string>());
  let expanded = $state(new Set<string>());
  let scopeKey = '';
  let pageKey = '';
  $effect(() => {
    const k = `${page.data.activeOrgId ?? ''}:${page.data.user?.id ?? ''}:${data.partyFilter ?? ''}`;
    if (scopeKey && k !== scopeKey) {
      search = '';
      sort = [{ key: 'created', dir: 'desc' }];
      filters = {};
      advanced = null;
    }
    scopeKey = k;
  });
  $effect(() => {
    const k = `${mv.nextCursor ?? ''}:${entries[0]?.entryId ?? ''}:${entries.length}`;
    if (pageKey && k !== pageKey) {
      selectedIds = new Set();
      expanded = new Set();
    }
    pageKey = k;
  });
  const hasCursor = $derived(page.url.searchParams.has('cursor'));
  const pageHref = (cursor: string | null) => {
    const sp = new URLSearchParams(page.url.searchParams);
    if (cursor) sp.set('cursor', cursor);
    else sp.delete('cursor');
    const qs = sp.toString();
    return `${page.url.pathname}${qs ? `?${qs}` : ''}`;
  };

  const unavailable = () => m.stock_mv_unavailable_value();
  const itemLabel = (id: string) => {
    const it = itemDict[id];
    return it
      ? it.code
        ? `${it.code} · ${it.name}`
        : (it.name ?? id.slice(0, 8))
      : id.slice(0, 8);
  };
  /** Raw stored strings, no locale grouping or rounding (valuation denomination is unverified). */
  const qtyText = (l: Line) => `${l.qty}${l.uom ? ` ${l.uom}` : ` · ${m.stock_mv_unit_none()}`}`;
  /** Calculated stock scalar: exact decimal product or null. Never 0, never a currency. */
  const amountOf = (l: Line): string | null => (l.rate == null ? null : mulDecimal(l.qty, l.rate));
  const itemsText = (e: Row) => {
    if (!e.itemSummary) return unavailable();
    const first = e.itemSummary.first;
    if (!first) return '—';
    const name = first.code
      ? `${first.code} · ${first.name ?? ''}`
      : (first.name ?? first.itemId.slice(0, 8));
    const single = e.lines?.length === 1 ? ` · ${qtyText(e.lines[0])}` : '';
    const more = e.itemSummary.additionalItemCount
      ? ` ${m.stock_mv_items_more({ count: e.itemSummary.additionalItemCount })}`
      : '';
    return `${name}${single}${more}`;
  };
  const lineDetailsJson = (e: Row) =>
    JSON.stringify(
      (e.lines ?? []).map((l) => ({
        lineNo: l.lineNo,
        itemCode: itemDict[l.itemId]?.code ?? null,
        itemName: itemDict[l.itemId]?.name ?? null,
        qty: l.qty,
        uom: l.uom,
        rate: l.rate,
        calculatedAmount: amountOf(l),
        fromWarehouse: l.fromWarehouseId ? (whDict[l.fromWarehouseId] ?? null) : null,
        toWarehouse: l.toWarehouseId ? (whDict[l.toWarehouseId] ?? null) : null,
      })),
    );
  /** The expanded entry's lines: a nested `plain` table. No money formatter, no footer aggregates. */
  const lineColumns: DataColumn<Line>[] = [
    {
      key: 'item',
      label: m.stock_col_item(),
      fill: true,
      custom: true,
      accessor: (l) => itemLabel(l.itemId),
    },
    { key: 'qty', label: m.stock_col_qty(), align: 'right', width: 140, accessor: qtyText },
    {
      key: 'rate',
      label: m.stock_field_rate(),
      align: 'right',
      width: 112,
      accessor: (l) => l.rate ?? '—',
    },
    {
      key: 'amount',
      label: m.stock_col_amount(),
      align: 'right',
      width: 120,
      accessor: (l) => amountOf(l) ?? '—',
    },
    {
      key: 'warehouse',
      label: m.stock_col_warehouse(),
      width: 180,
      accessor: (l) => warehouseSpan(l.fromWarehouseId, l.toWarehouseId, whDict),
    },
  ];

  const statusLabel = (s: string | undefined) =>
    s === undefined
      ? unavailable()
      : s === 'draft'
        ? m.stock_status_draft()
        : s === 'submitted'
          ? m.stock_status_submitted()
          : m.stock_status_cancelled();
  const typeLabel = (t: string | undefined) =>
    t === undefined ? unavailable() : (entryTypeLabel(t) ?? t);
  const idLabel = (e: Row) => e.humanId ?? e.entryId.slice(0, 8);
  const documentKindLabel = (k: EntryDocumentKind) =>
    k === 'ticket'
      ? m.stock_document_ticket()
      : k === 'invoice'
        ? m.stock_document_invoice()
        : k === 'purchase'
          ? m.stock_document_purchase()
          : m.stock_document_booking();

  const docLabel = (e: Row) => {
    const d = e.document;
    if (d) {
      if (d.label) return d.kind === 'ticket' ? `#${d.label}` : d.label;
      const short = (d.href.match(/[0-9a-f]{8}-[0-9a-f-]{27}/i)?.[0] ?? '').slice(0, 8);
      return m.stock_mv_source_fallback({ kind: documentKindLabel(d.kind), short });
    }
    return e.sourceState === 'denied'
      ? m.stock_mv_state_denied()
      : e.sourceState === 'unavailable'
        ? unavailable()
        : '';
  };
  const partyText = (e: Row) =>
    e.partyState === 'denied'
      ? m.stock_mv_state_denied()
      : e.partyState === 'unavailable'
        ? unavailable()
        : (e.partyName ?? '');
  const dateOnly = (v: string | null | undefined) => (v ? v.slice(0, 10) : '');

  const columns = $derived.by((): DataColumn<Row>[] => [
    {
      key: 'type',
      label: m.stock_col_type(),
      custom: true,
      sortable: canSort,
      accessor: (e) => typeLabel(e.type),
      filter: {
        options: () =>
          ENTRY_TYPES.map((v) => ({
            value: v,
            label: typeLabel(v),
          })),
        match: (e) => e.type ?? '',
      },
    },
    {
      key: 'items',
      label: m.stock_col_items(),
      sortable: false,
      width: 260,
      accessor: itemsText,
      exportValue: itemsText,
    },
    {
      key: 'status',
      label: m.stock_col_status(),
      custom: true,
      sortable: canSort,
      accessor: (e) => statusLabel(e.status),
      filter: {
        options: () =>
          ['draft', 'submitted', 'cancelled'].map((v) => ({ value: v, label: statusLabel(v) })),
        match: (e) => e.status ?? '',
      },
    },
    {
      key: 'party',
      label: m.stock_col_party(),
      sortable: isFull,
      accessor: partyText,
      cellClass: 't-caption',
    },
    {
      key: 'document',
      label: m.stock_col_document(),
      custom: true,
      sortable: isFull,
      width: 200,
      accessor: docLabel,
      exportValue: docLabel,
    },
    {
      key: 'attachments',
      label: m.stock_col_attachments(),
      align: 'right',
      width: 96,
      custom: true,
      sortable: canSort,
      accessor: (e) => e.attachmentCount ?? 0,
      exportValue: (e) => (e.attachmentCount == null ? '' : String(e.attachmentCount)),
    },
    {
      key: 'warehouse',
      label: m.stock_col_warehouse(),
      width: 180,
      sortable: canSort,
      accessor: (e) => warehouseSpan(e.firstFromWarehouseId, e.firstToWarehouseId, whDict),
    },
    {
      key: 'lines',
      label: m.stock_col_lines(),
      align: 'right',
      width: 88,
      numeric: true,
      sortable: canSort,
      accessor: (e) => e.lineCount ?? '',
    },
    ...(isFull
      ? [
          {
            key: 'lineDetails',
            label: m.stock_mv_lines_export(),
            defaultHidden: true,
            exportDefault: true,
            sortable: false,
            accessor: lineDetailsJson,
            exportValue: lineDetailsJson,
          } satisfies DataColumn<Row>,
        ]
      : []),
    {
      key: 'note',
      label: m.stock_field_note(),
      cellClass: 't-caption',
      defaultHidden: true,
      sortable: isFull,
      accessor: (e) => e.note ?? '',
    },
    {
      key: 'posted',
      label: m.stock_col_posted_at(),
      align: 'right',
      custom: true,
      sortable: canSort,
      accessor: (e) => e.postedAt ?? '',
      sortFn: (a, b) =>
        (a.postedAt ? new Date(a.postedAt).getTime() : 0) -
        (b.postedAt ? new Date(b.postedAt).getTime() : 0),
      exportValue: (e) => dateOnly(e.postedAt),
    },
    {
      key: 'created',
      label: m.stock_col_created(),
      align: 'right',
      custom: true,
      sortable: canSort,
      accessor: (e) => e.createdAt ?? '',
      sortFn: (a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime(),
      exportValue: (e) => dateOnly(e.createdAt),
    },
  ]);
</script>

<svelte:head><title>{m.stock_entries_title()} — {m.nav_stock()}</title></svelte:head>

<!-- `?party=` is a PAGE filter (it re-runs the server load), so it rides in the
     core chip bar through `chips` rather than a hand-rolled toolbar chip. -->
{#snippet partyChip()}
  <Chip onRemove={() => goto('/stock/entries')}>
    {m.stock_col_party()}: {entries.find((e) => e.partyName)?.partyName ?? unavailable()}
  </Chip>
{/snippet}

<div class="stock-entries-page flex flex-col h-full min-h-0 flex-1 min-w-0">
  <PageHeader
    documentTitle={false}
    title={m.stock_entries_title()}
    subtitle={m.stock_entries_subtitle()}
  >
    {#snippet leading()}<ArrowLeftRight
        size={iconSizes.md}
        class="text-accent shrink-0"
      />{/snippet}
  </PageHeader>

  {#if entries.length === 0 && hasCursor}
    <!-- An empty raw page reached with a cursor (e.g. a draft was deleted): keep Newest reachable. -->
    <EmptyState
      icon={ArrowLeftRight}
      title={m.stock_mv_page_empty()}
      description={m.stock_mv_page_empty_hint()}
    >
      {#snippet action()}
        <Button variant="outline" size="sm" href={pageHref(null)}>{m.stock_mv_newest()}</Button>
      {/snippet}
    </EmptyState>
  {:else if entries.length === 0 && data.partyFilter}
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
    <p class="scope-note t-caption" data-testid="movements-scope-note">
      {m.stock_mv_scope_notice()}
      {#if !isFull}{m.stock_mv_unavailable()}{/if}
    </p>
    <DataTable
      ariaLabel={m.stock_nav_entries()}
      class="flex-1 min-h-0"
      tableId="stock.entries"
      idColumn={{ value: (e) => idLabel(e) }}
      titleColumn={{ key: 'type', href: (e) => e.entryHref }}
      {columns}
      data={entries}
      getRowId={(e) => e.entryId}
      bind:search
      bind:sort
      bind:filters
      bind:advanced
      bind:selectedIds
      bind:expanded
      isExpandable={(e) => isFull && !!e.lines?.length}
      customProperties={{
        bundle: data.customProperties,
        recordId: (entry) => entry.entryId,
        scopeKey: `${page.data.activeOrgId ?? ''}:stock.entries`,
      }}
      searchFields={(e) =>
        `${idLabel(e)} ${typeLabel(e.type)} ${statusLabel(e.status)} ${partyText(e)} ${e.itemSearchText ?? ''}`}
      exportable={isFull}
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
            { value: 'exchange', label: m.stock_type_exchange() },
          ]
        : undefined}
      onAddSelect={(t) => goto(`/stock/entries/new?type=${t}`)}
      addDisabled={!canAct('stock', 'create')}
      emptyMessage={m.stock_mv_page_no_match()}
      chips={data.partyFilter ? partyChip : undefined}
    >
      {#snippet expandedContent(e: Row)}
        <div class="lines">
          {#if !e.lines || e.lines.length === 0}
            <div class="lines-msg">{m.stock_entries_empty()}</div>
          {:else}
            <p class="lines-msg">{m.stock_mv_valuation_unverified()}</p>
            <DataTable
              ariaLabel={m.stock_entry_lines_title()}
              variant="plain"
              class="lines-tbl"
              data={e.lines}
              columns={lineColumns}
              getRowId={(l) => l.lineId}
            >
              {#snippet cell(l: Line, col: DataColumn<Line>)}
                {#if col.key === 'item'}
                  <PeekLink href={`/stock/items/${l.itemId}`} tableId="stock.items">
                    {itemLabel(l.itemId)}
                  </PeekLink>
                {/if}
              {/snippet}
            </DataTable>
          {/if}
        </div>
      {/snippet}
      {#snippet cell(e: Row, col: DataColumn<Row>)}
        {#if col.key === 'type'}
          {#if e.type}
            <EntryTypeBadge type={e.type} label={typeLabel(e.type)} />
          {:else}
            <span class="t-caption">{unavailable()}</span>
          {/if}
        {:else if col.key === 'status'}
          {#if e.status}
            {@const sv = entryStatusVariant(e.status)}
            <Badge variant={sv.variant} value={sv.value}>{statusLabel(e.status)}</Badge>
          {:else}
            <span class="t-caption">{unavailable()}</span>
          {/if}
        {:else if col.key === 'document'}
          {#if e.document}
            <span class="doc-cell">
              <Badge variant="neutral" size="sm">{documentKindLabel(e.document.kind)}</Badge>
              <PeekLink href={e.document.href} mode="modal" class="doc-link">
                {docLabel(e)}
              </PeekLink>
            </span>
          {:else if docLabel(e)}
            <span class="t-caption">{docLabel(e)}</span>
          {:else if e.sourceState === undefined}
            <span class="t-caption">{unavailable()}</span>
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
          {#if e.attachmentCount === undefined}
            <span class="t-caption">{unavailable()}</span>
          {:else if e.attachmentCount > 0}
            <span class="attach-cell">
              <PeekLink href={e.entryHref} mode="modal" class="attach-link">
                <Paperclip size={iconSizes.sm} />
                {e.attachmentCount}
              </PeekLink>
            </span>
          {:else}
            <span class="t-caption">—</span>
          {/if}
        {:else if col.key === 'created'}
          <span class="t-caption"
            >{e.createdAt
              ? new Date(e.createdAt).toLocaleDateString(appLocale())
              : unavailable()}</span
          >
        {:else if col.key === 'posted'}
          <span class="t-caption"
            >{e.postedAt ? new Date(e.postedAt).toLocaleDateString(appLocale()) : '—'}</span
          >
        {/if}
      {/snippet}
    </DataTable>
    {#if hasCursor || mv.nextCursor}
      <nav class="mv-nav" aria-label={m.stock_mv_pager_label()}>
        {#if hasCursor}
          <Button variant="outline" size="sm" href={pageHref(null)}>{m.stock_mv_newest()}</Button>
        {/if}
        {#if mv.nextCursor}
          <Button variant="outline" size="sm" href={pageHref(mv.nextCursor)}>
            {m.stock_mv_older()}
          </Button>
        {/if}
      </nav>
    {/if}
  {/if}
</div>

<style>
  .scope-note {
    padding: var(--space-1) var(--space-4);
    color: var(--color-muted-foreground);
  }
  .mv-nav {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
  }
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
