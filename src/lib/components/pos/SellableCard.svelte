<script lang="ts">
  /**
   * The body of a sellable card — title, then one `label · value` row per
   * configured field, in the viewer's order. Rendered inside the host's
   * card-shaped Button (till gallery, catalog board), so this component owns
   * no box: the host decides whether rows align through a subgrid (gallery)
   * or simply stack (board). A field with nothing to show still renders its
   * row as "—" so every card in a band keeps the same rows.
   */
  import { Badge } from '$lib/components/ui';
  import { formatMoney } from '$lib/utils/format';
  import { catalogGroupLabel } from '$lib/catalog/taxonomy';
  import { stockTone, type SellableCardField } from '$lib/pos/sellable-card-fields';
  import * as m from '$lib/paraglide/messages';

  let {
    row,
    fields,
    hideEmpty = false,
  }: {
    row: {
      name: string;
      code: string;
      unitPrice: number | null;
      kind: 'product' | 'service' | 'bundle';
      stockQty: number | null;
      category: string | null;
      active: boolean;
      taxonomy: { zone: string | null; line: string | null };
      tags?: ReadonlyArray<{ name: string }>;
      inheritedTags?: ReadonlyArray<{ name: string }>;
    };
    /** Visible fields in render order (`createCardFields(...).visible`). */
    fields: readonly SellableCardField[];
    /** Skip rows with nothing to show. The gallery keeps them (its subgrid
     *  needs every card on the same rows); a stacked board does not. */
    hideEmpty?: boolean;
  } = $props();

  function kindLabel(kind: typeof row.kind): string {
    if (kind === 'bundle') return m.pos_catalog_kind_bundle();
    return kind === 'product' ? m.pos_catalog_kind_product() : m.pos_catalog_kind_service();
  }
  // 'brand', not a categorical hue — same map as the catalog table cell.
  function kindTone(kind: typeof row.kind): 'accent' | 'info' | 'brand' {
    if (kind === 'bundle') return 'brand';
    return kind === 'product' ? 'accent' : 'info';
  }
  const tagNames = $derived(
    [...(row.tags ?? []), ...(row.inheritedTags ?? [])].map((t) => t.name).join(', '),
  );
  const EMPTY: Record<SellableCardField, () => boolean> = {
    price: () => row.unitPrice == null,
    kind: () => false,
    stock: () => row.stockQty == null,
    code: () => !row.code,
    category: () => !row.category,
    zone: () => !row.taxonomy.zone,
    line: () => !row.taxonomy.line,
    tags: () => !tagNames,
    active: () => false,
  };
  const shown = $derived(hideEmpty ? fields.filter((f) => !EMPTY[f]()) : fields);
</script>

<span class="sc-title">{row.name}</span>
{#each shown as field (field)}
  <span class="sc-row" data-field={field}>
    {#if field === 'price'}
      <span class="sc-v sc-num">{row.unitPrice != null ? formatMoney(row.unitPrice) : '—'}</span>
    {:else if field === 'kind'}
      <span class="sc-v"
        ><Badge variant="semantic" value={kindTone(row.kind)} size="sm">{kindLabel(row.kind)}</Badge
        ></span
      >
    {:else if field === 'stock'}
      <span class="sc-v">
        {#if row.stockQty != null}
          <Badge variant="semantic" value={stockTone(row.stockQty)} size="sm">{row.stockQty}</Badge>
        {:else}
          <span class="sc-dim">—</span>
        {/if}
      </span>
    {:else if field === 'code'}
      <span class="sc-v sc-mono">{row.code}</span>
    {:else if field === 'category'}
      <span class="sc-v">{row.category ?? '—'}</span>
    {:else if field === 'zone'}
      <span class="sc-v"
        >{row.taxonomy.zone ? catalogGroupLabel('zone', row.taxonomy.zone) : '—'}</span
      >
    {:else if field === 'line'}
      <span class="sc-v"
        >{row.taxonomy.line ? catalogGroupLabel('line', row.taxonomy.line) : '—'}</span
      >
    {:else if field === 'tags'}
      <span class="sc-v">{tagNames || '—'}</span>
    {:else if field === 'active'}
      <span class="sc-v">
        {#if row.active}
          <Badge variant="semantic" value="success" size="sm">{m.fin_col_active()}</Badge>
        {:else}
          <Badge variant="semantic" value="warning" size="sm">{m.pos_catalog_inactive()}</Badge>
        {/if}
      </span>
    {/if}
  </span>
{/each}

<style>
  .sc-title {
    /* The host Button is `whitespace-nowrap`; a sellable name wraps inside
       the card instead of widening the grid track. */
    font-size: var(--font-size-label);
    color: var(--color-text-primary);
    white-space: normal;
    overflow-wrap: anywhere;
    min-width: 0;
    align-self: start;
  }
  .sc-row {
    display: flex;
    align-items: center;
    min-width: 0;
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    white-space: normal;
    align-self: start;
  }
  .sc-v {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .sc-num {
    font-variant-numeric: tabular-nums;
    color: var(--color-text-primary);
  }
  .sc-mono {
    font-family: var(--font-mono);
    color: var(--color-text-tertiary);
  }
  .sc-dim {
    color: var(--color-text-tertiary);
  }
</style>
