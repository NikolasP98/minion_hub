<script lang="ts">
  import type { PageData } from './$types';
  import * as m from '$lib/paraglide/messages';
  import { Package } from 'lucide-svelte';
  import { PageHeader, Button } from '$lib/components/ui';
  import { PageShell } from '$lib/components/ui/foundations';
  import DataTable from '$lib/components/data-table/DataTable.svelte';
  import type { DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import { formatMoney } from '$lib/utils/format';

  let { data }: { data: PageData } = $props();
  const products = $derived(data.products);
  const coverage = $derived(data.coverage);

  type Row = (typeof products)[number];
  type Node = Row['composition'][number];

  // ── READ-ONLY BY DESIGN ──────────────────────────────────────────────────
  // Products and their recipes are managed in POS (/pos/catalog); raw
  // materials in stock (/stock/items). Finances shows what was SOLD and how it
  // decomposes — no editing, no import, no create.

  const columns: DataColumn<Row>[] = [
    {
      key: 'code',
      label: m.fin_col_code(),
      accessor: (p) => p.code,
      cellClass: 'font-mono text-xs',
    },
    { key: 'name', label: m.fin_col_name(), accessor: (p) => p.name, custom: true },
    {
      key: 'category',
      label: m.fin_col_category(),
      accessor: (p) => p.category ?? '',
    },
    {
      key: 'unitPrice',
      money: true,
      label: m.fin_col_ref_price(),
      align: 'right',
      custom: true,
      accessor: (p) => p.unitPrice,
      exportValue: (p) => p.unitPrice ?? '',
    },
    {
      key: 'active',
      label: m.fin_col_active(),
      align: 'center',
      custom: true,
      accessor: (p) => p.active,
      exportValue: (p) => (p.active ? 1 : 0),
    },
    { key: 'billed', label: m.fin_col_billed(), align: 'right', accessor: (p) => p.billed },
    {
      key: 'revenue',
      money: true,
      label: m.fin_col_revenue(),
      align: 'right',
      custom: true,
      accessor: (p) => p.revenue,
      exportValue: (p) => Number(p.revenue),
    },
    {
      key: 'cost',
      money: true,
      label: m.fin_col_cost(),
      align: 'right',
      custom: true,
      accessor: (p) => p.cost,
      exportValue: (p) => p.cost ?? '',
    },
    {
      key: 'margin',
      money: true,
      label: m.fin_col_margin(),
      align: 'right',
      custom: true,
      accessor: (p) => p.margin,
      exportValue: (p) => p.margin ?? '',
    },
  ];

</script>

<svelte:head><title>{m.fin_products_title()}</title></svelte:head>

<PageShell archetype="collection" scroll="region" labelledBy="finances-products-title">
  <PageHeader
    titleId="finances-products-title"
    title={m.fin_products_title()}
    subtitle={m.fin_products_subtitle()}
  >
    {#snippet leading()}<Package size={16} class="text-accent shrink-0" />{/snippet}
  </PageHeader>

  {#if coverage.billedNotInCatalog > 0}
    <div class="coverage-banner">
      <span>{m.fin_products_coverage({ n: coverage.billedNotInCatalog })}</span>
      <a class="manage-link" href="/pos/catalog">{m.fin_products_manage_in_pos()}</a>
    </div>
  {/if}

  <DataTable
    class="flex-1 min-h-0"
    {columns}
    data={products}
    getRowId={(p) => p.id}
    searchPlaceholder={m.data_table_search()}
    exportable
    exportName="products"
    storageKey="finances-products"
    emptyMessage={m.fin_products_empty()}
    {expandedContent}
  >
    {#snippet cell(p: Row, col: DataColumn<Row>)}
      {#if col.key === 'name'}
        <span class="truncate block max-w-[16rem]">{p.name}</span>
      {:else if col.key === 'unitPrice'}
        <span class="tabular-nums">{p.unitPrice != null ? formatMoney(p.unitPrice) : '—'}</span>
      {:else if col.key === 'active'}
        <span class={p.active ? 'badge-active' : 'badge-inactive'}>{p.active ? '✓' : '✗'}</span>
      {:else if col.key === 'revenue'}
        <span class="tabular-nums font-medium">{formatMoney(p.revenue)}</span>
      {:else if col.key === 'cost'}
        {#if p.costMasked}
          <span class="muted">•••</span>
        {:else if p.cost == null}
          <span class="muted">—</span>
        {:else}
          <span class="tabular-nums" title={p.partial ? m.fin_cost_partial_hint() : undefined}>
            {formatMoney(p.cost)}{#if p.partial}<span class="partial-mark">*</span>{/if}
          </span>
        {/if}
      {:else if col.key === 'margin'}
        {#if p.costMasked}
          <span class="muted">•••</span>
        {:else if p.margin == null}
          <span class="muted">—</span>
        {:else}
          <span class="tabular-nums font-medium" class:margin-pos={p.margin >= 0} class:margin-neg={p.margin < 0}>
            {formatMoney(p.margin)}{#if p.marginPct != null}<span class="t-caption pct">{p.marginPct}%</span>{/if}
          </span>
        {/if}
      {/if}
    {/snippet}
  </DataTable>
</PageShell>


<!-- Recursive composition: "their relationships to items, recursively".
     A self-recursive snippet renders arbitrary depth; qty is PER PARENT, so a
     nested row reads "2 x mash" inside "1 x plate" rather than a pre-multiplied
     total. Read-only — editing lives in POS. -->
{#snippet branch(nodes: Node[], depth: number)}
  <ul class="tree" style:--depth={depth}>
    {#each nodes as n (n.itemId)}
      <li>
        <span class="tree-row">
          <span class="tree-qty tabular-nums">{n.qty}</span>
          <span class="tree-uom">{n.uom}</span>
          <span class="tree-name">{n.name}</span>
          <span class="tree-code">{n.code}</span>
          {#if !n.isStockItem}<span class="tree-tag">{m.fin_products_tree_recipe()}</span>{/if}
        </span>
        {#if n.children.length}{@render branch(n.children, depth + 1)}{/if}
      </li>
    {/each}
  </ul>
{/snippet}

{#snippet expandedContent(p: Row)}
  {#if p.composition.length}
    <div class="tree-wrap">
      <p class="t-caption tree-head">{m.fin_products_tree_title()}</p>
      {@render branch(p.composition, 0)}
    </div>
  {:else}
    <p class="t-caption tree-empty">{m.fin_products_tree_empty()}</p>
  {/if}
{/snippet}

<style>
  .muted {
    color: var(--color-text-tertiary);
  }
  .margin-pos {
    color: var(--color-success-fg);
  }
  .margin-neg {
    color: var(--color-danger-fg);
  }
  .partial-mark {
    color: var(--color-warning-fg);
    margin-left: var(--space-0-5);
  }
  .pct {
    color: var(--color-text-tertiary);
    margin-left: var(--space-1);
  }
  .manage-link {
    color: var(--color-accent);
  }
  .manage-link:hover {
    text-decoration: underline;
  }
  .tree-wrap {
    padding: var(--space-2) var(--space-4);
  }
  .tree-head {
    color: var(--color-text-tertiary);
    margin-bottom: var(--space-1);
  }
  .tree-empty {
    padding: var(--space-2) var(--space-4);
    color: var(--color-text-tertiary);
  }
  .tree {
    list-style: none;
    margin: 0;
    padding-left: calc(var(--depth, 0) * var(--space-3));
  }
  .tree .tree {
    padding-left: var(--space-4);
    border-left: 1px solid var(--hairline);
    margin-left: var(--space-2);
  }
  .tree-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: var(--space-0-5) 0;
    font-size: var(--font-size-body);
  }
  .tree-qty {
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .tree-uom {
    color: var(--color-text-tertiary);
  }
  .tree-name {
    color: var(--color-text-primary);
  }
  .tree-code {
    font-family: var(--font-mono, monospace);
    font-size: var(--font-size-caption);
    color: var(--color-text-tertiary);
  }
  .tree-tag {
    font-size: var(--font-size-caption);
    color: var(--color-info-fg);
  }
  .badge-active {
    display: inline-block;
    font-size: var(--font-size-caption, 12px);
    color: var(--color-success, var(--color-emerald));
  }
  .badge-inactive {
    display: inline-block;
    font-size: var(--font-size-caption, 12px);
    color: var(--color-muted-foreground);
  }
  .coverage-banner {
    display: flex;
    align-items: center;
    gap: var(--space-3, 12px);
    padding: var(--space-2, 8px) var(--space-4, 16px);
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    border-bottom: 1px solid var(--hairline);
    font-size: var(--font-size-body, 14px);
    color: var(--color-muted-foreground);
  }
</style>
