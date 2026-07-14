<script lang="ts">
  import type { PageData } from './$types';
  import { goto } from '$app/navigation';
  import * as m from '$lib/paraglide/messages';
  import { ArrowLeftRight, X } from 'lucide-svelte';
  import { PageHeader, Badge, Button } from '$lib/components/ui';
  import { canAct } from '$lib/access/can.svelte';
  import { entryStatusVariant } from '$lib/components/stock/stock-ui';
  import DataTable from '$lib/components/data-table/DataTable.svelte';
  import type { DataColumn } from '$lib/components/data-table/DataTable.svelte';

  let { data }: { data: PageData } = $props();
  const entries = $derived(data.entries);
  type Row = (typeof entries)[number];

  // Lazy per-entry line items (loaded on expand). Memoize the fetch so `{#await}`
  // resolves once and re-renders don't refetch.
  type Line = { itemId: string; qty: string | number; uom: string | null; rate: string | number | null; lineNo: number };
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

  const statusLabel = (s: string) => (s === 'draft' ? m.stock_status_draft() : s === 'submitted' ? m.stock_status_submitted() : m.stock_status_cancelled());
  const typeLabel = (t: string) =>
    t === 'receipt' ? m.stock_type_receipt() : t === 'issue' ? m.stock_type_issue() : t === 'transfer' ? m.stock_type_transfer() : m.stock_type_adjustment();
  const idLabel = (e: Row) => e.humanId ?? e.id.slice(0, 8);

  const columns: DataColumn<Row>[] = [
    { key: 'id', label: m.stock_col_id(), accessor: idLabel, cellClass: 'font-mono text-xs' },
    {
      key: 'type', label: m.stock_col_type(), accessor: (e) => typeLabel(e.type),
      filter: { options: () => ['receipt', 'issue', 'transfer', 'adjustment'].map((v) => ({ value: v, label: typeLabel(v) })), match: (e) => e.type },
    },
    {
      key: 'status', label: m.stock_col_status(), custom: true, accessor: (e) => statusLabel(e.status),
      filter: { options: () => ['draft', 'submitted', 'cancelled'].map((v) => ({ value: v, label: statusLabel(v) })), match: (e) => e.status },
    },
    { key: 'party', label: m.stock_col_party(), accessor: (e) => e.partyName ?? '', cellClass: 't-caption' },
    { key: 'created', label: m.stock_col_created(), align: 'right', custom: true, accessor: (e) => e.createdAt, sortFn: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(), exportValue: (e) => new Date(e.createdAt).toISOString().slice(0, 10) },
  ];
</script>

<svelte:head><title>{m.stock_entries_title()} — {m.nav_stock()}</title></svelte:head>

<div class="stock-entries-page flex flex-col h-full min-h-0">
  <PageHeader title={m.stock_entries_title()} subtitle={m.stock_entries_subtitle()}>
    {#snippet leading()}<ArrowLeftRight size={16} class="text-accent shrink-0" />{/snippet}
  </PageHeader>

  <DataTable
    class="flex-1 min-h-0"
    {columns}
    data={entries}
    getRowId={(e) => e.id}
    searchFields={(e) => `${idLabel(e)} ${typeLabel(e.type)} ${statusLabel(e.status)} ${e.partyName ?? ''}`}
    initialSort={{ key: 'created', dir: 'desc' }}
    exportable
    exportName="stock-entries"
    selectable
    storageKey="stock-entries"
    addLabel={m.stock_new_entry()}
    onAdd={() => goto('/stock/entries/new')}
    addDisabled={!canAct('stock', 'create')}
    onRowClick={(e) => goto(`/stock/entries/${e.id}`)}
    emptyMessage={m.stock_entries_empty()}
  >
    {#snippet expandedContent(e: Row)}
      <div class="lines">
        {#await entryLines(e.id)}
          <div class="lines-msg">…</div>
        {:then lines}
          {#if lines.length === 0}
            <div class="lines-msg">{m.stock_entries_empty()}</div>
          {:else}
            <table class="lines-tbl">
              <tbody>
                {#each lines as ln (ln.itemId + ':' + ln.lineNo)}
                  <tr>
                    <td class="li-item">{itemLabel(ln.itemId)}</td>
                    <td class="li-num">{fmtNum(ln.qty)}{ln.uom ? ` ${ln.uom}` : ''}</td>
                    <td class="li-num">{fmtNum(ln.rate)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        {/await}
      </div>
    {/snippet}
    {#snippet cell(e: Row, col: DataColumn<Row>)}
      {#if col.key === 'status'}
        {@const sv = entryStatusVariant(e.status)}
        <Badge variant={sv.variant} value={sv.value}>{statusLabel(e.status)}</Badge>
      {:else if col.key === 'created'}
        <span class="t-caption">{new Date(e.createdAt).toLocaleDateString()}</span>
      {/if}
    {/snippet}
    {#snippet toolbar()}
      {#if data.partyFilter}
        <Button variant="ghost" class="chip" onclick={() => goto('/stock/entries')}>
          {m.stock_col_party()}: {data.entries[0]?.partyName ?? data.partyFilter} <X size={11} />
        </Button>
      {/if}
    {/snippet}
  </DataTable>
</div>

<style>
  .stock-entries-page :global(.chip) { display: inline-flex; align-items: center; gap: var(--space-1); height: 1.8rem; padding: 0 var(--space-2); font-size: var(--font-size-body); border-radius: var(--radius-full); border: 1px solid var(--color-accent); color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 12%, transparent); cursor: pointer; }
  .lines { padding: var(--space-2) var(--space-4) var(--space-2) var(--space-12); }
  .lines-msg { font-size: var(--font-size-body); color: var(--color-muted-foreground); padding: var(--space-2) 0; }
  .lines-tbl { width: 100%; max-width: 40rem; border-collapse: collapse; }
  .lines-tbl td { padding: var(--space-1) var(--space-2); font-size: var(--font-size-body); border-bottom: 1px solid color-mix(in srgb, var(--hairline) 60%, transparent); }
  .lines-tbl tr:last-child td { border-bottom: none; }
  .li-item { color: var(--color-foreground); }
  .li-num { text-align: right; font-variant-numeric: tabular-nums; color: var(--color-muted-foreground); white-space: nowrap; width: 8rem; }
</style>
