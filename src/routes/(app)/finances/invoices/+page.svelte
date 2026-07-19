<script lang="ts">
  import type { PageData } from './$types';
  import { goto } from '$lib/navigation';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import { FileText, ExternalLink } from 'lucide-svelte';
  import { PageHeader, Button } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import ScopeBanner from '$lib/components/crm/ScopeBanner.svelte';
  import DataTable from '$lib/components/data-table/DataTable.svelte';
  import type { DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import { formatMoney } from '$lib/utils/format';

  let { data }: { data: PageData } = $props();
  const invoices = $derived(data.invoices);
  type Row = (typeof invoices)[number];

  // Status filter seeds from the URL so the finances dashboard KPIs can deep-link
  // a pre-filtered view (?status=void). discounted=1 handled as a toolbar chip.
  const qp = page.url.searchParams;
  let discountedOnly = $state(qp.get('discounted') === '1');
  const filtered = $derived(
    discountedOnly ? invoices.filter((inv) => Number(inv.discount) > 0) : invoices,
  );

  const numOf = (s: string | null) => {
    const n = Number(s);
    return Number.isFinite(n) ? n : -Infinity;
  };
  const dateOf = (d: Date | null) => (d ? new Date(d).getTime() : -Infinity);
  const labelOf = (r: Row) => r.number ?? r.documentId ?? '';

  function fmtDate(d: Date | null) {
    return d ? new Date(d).toLocaleDateString() : '—';
  }
  function fmtMoney(v: string | null) {
    return formatMoney(v);
  }
  // Cross-report nav: jump to the CRM contact this invoice's client maps to.
  function toContact(e: Event, id: string) {
    e.stopPropagation();
    void goto(`/crm/${id}`);
  }

  const statusOptions = $derived.by(() => {
    const s = new Set<string>();
    for (const inv of invoices) if (inv.status) s.add(inv.status);
    return [...s].sort().map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }));
  });

  const columns: DataColumn<Row>[] = [
    {
      key: 'number',
      label: m.fin_col_number(),
      accessor: labelOf,
      cellClass: 'font-medium',
      sortFn: (a, b) => labelOf(a).localeCompare(labelOf(b), undefined, { numeric: true }),
    },
    {
      key: 'issued',
      label: m.fin_col_issued_at(),
      custom: true,
      accessor: (r) => r.issuedAt,
      sortFn: (a, b) => dateOf(a.issuedAt) - dateOf(b.issuedAt),
      exportValue: (r) => (r.issuedAt ? new Date(r.issuedAt).toISOString().slice(0, 10) : ''),
    },
    { key: 'client', label: m.fin_col_client(), custom: true, accessor: (r) => r.clientName ?? '' },
    { key: 'dni', label: m.fin_col_dni(), custom: true, accessor: (r) => r.clientDocNumber ?? '' },
    {
      key: 'total',
      label: m.fin_col_total(),
      align: 'right',
      custom: true,
      accessor: (r) => numOf(r.total),
      exportValue: (r) => numOf(r.total),
    },
    {
      key: 'status',
      label: m.fin_col_status(),
      custom: true,
      accessor: (r) => r.status ?? '',
      filter: { options: () => statusOptions },
    },
  ];
</script>

<svelte:head><title>{m.fin_invoices_title()}</title></svelte:head>

<PageShell archetype="collection" scroll="region" labelledBy="finances-invoices-title">
  <PageHeader
    titleId="finances-invoices-title"
    title={m.fin_invoices_title()}
    subtitle={m.fin_invoices_subtitle()}
  >
    {#snippet leading()}<FileText size={16} class="text-accent shrink-0" />{/snippet}
  </PageHeader>

  <DataTable
    class="flex-1 min-h-0"
    {columns}
    data={filtered}
    getRowId={(r) => r.id}
    searchPlaceholder={m.fin_invoices_search()}
    searchFields={(r) => `${labelOf(r)} ${r.clientName ?? ''} ${r.clientDocNumber ?? ''}`}
    initialSort={{ key: 'issued', dir: 'desc' }}
    exportable
    exportName="invoices"
    selectable
    storageKey="finances-invoices"
    onRowClick={(r) => goto(`/finances/invoices/${r.id}`)}
    emptyMessage={m.fin_invoices_empty()}
  >
    {#snippet cell(r: Row, col: DataColumn<Row>)}
      {#if col.key === 'issued'}
        <span class="t-caption">{fmtDate(r.issuedAt)}</span>
      {:else if col.key === 'client'}
        {#if r.crmContactId}
          <Button
            variant="ghost"
            size="sm"
            class="invoice-link-cell truncate max-w-[20rem]"
            title={r.clientName ?? ''}
            onclick={(e) => toContact(e, r.crmContactId!)}
          >
            <span class="truncate">{r.clientName ?? '—'}</span>
            <ExternalLink size={11} class="link-ico" />
          </Button>
        {:else}
          <span class="truncate block max-w-[20rem]">{r.clientName ?? '—'}</span>
        {/if}
      {:else if col.key === 'dni'}
        {#if r.crmContactId && r.clientDocNumber}
          <Button
            variant="ghost"
            size="sm"
            class="invoice-link-cell t-caption"
            onclick={(e) => toContact(e, r.crmContactId!)}>{r.clientDocNumber}</Button
          >
        {:else}
          <span class="t-caption">{r.clientDocNumber ?? '—'}</span>
        {/if}
      {:else if col.key === 'total'}
        <span class="tabular-nums">{fmtMoney(r.total)}</span>
      {:else if col.key === 'status'}
        <span class="status-pill" data-status={r.status ?? ''}>{r.status ?? '—'}</span>
      {/if}
    {/snippet}
    {#snippet toolbar()}
      {#if discountedOnly}
        <Button
          variant="outline"
          size="sm"
          class="finance-filter-chip"
          aria-label={`${m.fin_kpi_discount_rate()}: remove filter`}
          onclick={() => (discountedOnly = false)}
        >
          {m.fin_kpi_discount_rate()}<span class="chip-x">×</span>
        </Button>
      {/if}
      {#if data.contactName}<ScopeBanner
          name={data.contactName}
          contactId={data.contactId}
          noun="invoices"
        />{/if}
    {/snippet}
  </DataTable>
</PageShell>

<style>
  :global(.finance-filter-chip) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1, 4px);
    height: 1.6rem;
    padding: 0 var(--space-2);
    font-size: var(--font-size-caption, 12px);
    cursor: pointer;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-accent);
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
  .chip-x {
    font-size: var(--font-size-page-title, 18px);
    line-height: 1;
    opacity: 0.8;
  }
  :global(.invoice-link-cell) {
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    gap: var(--space-1, 4px);
    max-width: 100%;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    border-radius: var(--radius-sm);
  }
  /* Button wraps slotted children in an inner justify-center inline-flex row;
     left-align it too so the name reads from the left (not centered). */
  :global(.invoice-link-cell > span) {
    justify-content: flex-start;
    min-width: 0;
  }
  :global(.invoice-link-cell:hover) {
    color: var(--color-accent);
    text-decoration: underline;
  }
  :global(.invoice-link-cell .link-ico) {
    opacity: 0;
    flex-shrink: 0;
    transition: opacity var(--duration-fast);
  }
  :global(.invoice-link-cell:hover .link-ico) {
    opacity: 0.7;
  }
  .status-pill {
    display: inline-block;
    padding: var(--space-0-5, 2px) var(--space-2, 8px);
    border-radius: var(--radius-full);
    font-size: var(--font-size-caption, 12px);
    font-weight: 500;
    text-transform: capitalize;
    background: color-mix(in srgb, var(--color-muted-foreground) 15%, transparent);
    color: var(--color-muted-foreground);
  }
  .status-pill[data-status='paid'] {
    background: color-mix(in srgb, var(--color-success) 15%, transparent);
    color: var(--color-success);
  }
  .status-pill[data-status='partial'] {
    background: color-mix(in srgb, var(--color-warning) 15%, transparent);
    color: var(--color-warning);
  }
  .status-pill[data-status='void'] {
    background: color-mix(in srgb, var(--color-destructive) 12%, transparent);
    color: var(--color-destructive);
  }
</style>
