<script lang="ts">
  /**
   * ONE composition list per catalog entry (spec 2026-10-10 catalog-service-
   * unification, Slice 2): "the catalog is a recipe book". A service is
   * composed of products and/or services; a product of products only.
   *
   * Storage is unchanged — the editor only picks the write path by parent
   * kind × child kind:
   *   service child                    → fin_product_components (PUT replace-set,
   *                                      `/api/pos/sellables/[id]/components`) +
   *                                      the package validity window
   *   product child, service parent    → stk_consumption (PATCH replace-set,
   *                                      `/api/pos/sellables/[id]` `consumption`)
   *   product child, product parent    → stock BOM (`/api/stock/items/[id]/components`)
   * A product child is a stock item: every catalog product is one, and insumos
   * that are not sold are still what a procedure consumes.
   */
  import { Trash2, ListFilter } from 'lucide-svelte';
  import {
    Badge,
    Button,
    Input,
    Picker,
    Spinner,
    iconSizes,
    type PickerColumn,
  } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { formatMoney } from '$lib/utils/format';
  import { toastError } from '$lib/state/ui/toast.svelte';
  import { candidatesFor, writePathFor, type Candidate, type Kind } from './composition';

  interface Sellable {
    productId: string;
    code: string;
    name: string;
    unitPrice: number | null;
    kind: 'product' | 'service' | 'bundle';
    active: boolean;
    itemId: string | null;
  }
  interface StockItem {
    id: string;
    code: string;
    name: string;
    uom: string;
  }
  interface Props {
    /** The entry being composed. */
    sellable: Pick<Sellable, 'productId' | 'kind' | 'itemId'>;
    /** The whole catalog — service candidates. */
    sellables: Sellable[];
    /** Non-archived stock items — product candidates. */
    stockItems: StockItem[];
    stockEnabled: boolean;
    canEdit: boolean;
    onChanged: () => void;
  }

  let { sellable, sellables, stockItems, stockEnabled, canEdit, onChanged }: Props = $props();

  const parentKind = $derived<Kind>(sellable.kind === 'product' ? 'product' : 'service');

  /** One row of the list, whichever table it came from. */
  type Row = {
    id: string;
    kind: Kind;
    name: string;
    detail: string;
    qty: number;
    /** Storage handle: product id (service child), item id (consumption or BOM). */
    ref: string;
    /** BOM edge id — only a product-parent child carries one. */
    edgeId?: string;
  };

  let serviceRows = $state<{ childProductId: string; qty: number }[]>([]);
  let consumptionRows = $state<{ itemId: string; qtyPerUnit: number; note: string | null }[]>([]);
  let bomRows = $state<{ id: string; childItemId: string; qty: number }[]>([]);
  let validity = $state('');
  let loading = $state(true);
  let busy = $state(false);
  let pickerOpen = $state(false);

  const productById = $derived(new Map(sellables.map((s) => [s.productId, s])));
  const itemById = $derived(new Map(stockItems.map((i) => [i.id, i])));

  const rows = $derived.by<Row[]>(() => {
    const out: Row[] = [];
    for (const r of serviceRows) {
      const p = productById.get(r.childProductId);
      out.push({
        id: `p:${r.childProductId}`,
        kind: 'service',
        name: p?.name ?? r.childProductId,
        detail: p?.unitPrice != null ? formatMoney(p.unitPrice) : '',
        qty: r.qty,
        ref: r.childProductId,
      });
    }
    const items = parentKind === 'service' ? consumptionRows : [];
    for (const r of items) {
      const i = itemById.get(r.itemId);
      out.push({
        id: `i:${r.itemId}`,
        kind: 'product',
        name: i?.name ?? r.itemId,
        detail: i?.uom ?? '',
        qty: r.qtyPerUnit,
        ref: r.itemId,
      });
    }
    if (parentKind === 'product')
      for (const r of bomRows) {
        const i = itemById.get(r.childItemId);
        out.push({
          id: `i:${r.childItemId}`,
          kind: 'product',
          name: i?.name ?? r.childItemId,
          detail: i?.uom ?? '',
          qty: r.qty,
          ref: r.childItemId,
          edgeId: r.id,
        });
      }
    return out;
  });
  const picked = $derived(new Set(rows.map((r) => r.id)));
  const hasServiceChild = $derived(serviceRows.length > 0);
  /** A product composes through its stock item's BOM; without one there is no node to hang children off. */
  const productNeedsItem = $derived(parentKind === 'product' && !sellable.itemId);

  const candidates = $derived(
    candidatesFor(
      { productId: sellable.productId, kind: parentKind, itemId: sellable.itemId },
      sellables,
      stockItems,
      { stockEnabled, formatMoney },
    ),
  );

  const kindLabel = (k: Kind) =>
    k === 'product' ? m.pos_catalog_kind_product() : m.pos_catalog_kind_service();
  const kindTone = (k: Kind) => (k === 'product' ? 'accent' : 'info');

  const pickerColumns: PickerColumn<Candidate>[] = [
    { key: 'kind', label: m.pos_catalog_col_kind(), value: (c) => kindLabel(c.kind), priority: 5 },
    {
      key: 'code',
      label: m.stock_col_code(),
      value: (c) => c.code,
      searchable: true,
      priority: 10,
    },
    {
      key: 'name',
      label: m.stock_col_name(),
      value: (c) => c.name,
      emphasis: 'primary',
      searchable: true,
      priority: 20,
    },
    {
      key: 'detail',
      label: m.pos_sell_price(),
      value: (c) => c.detail,
      align: 'right',
      priority: 30,
    },
  ];

  $effect(() => {
    const id = sellable.productId;
    const itemId = sellable.itemId;
    const kind = parentKind;
    loading = true;
    void (async () => {
      try {
        const [pkg, cons, bom] = await Promise.all([
          kind === 'service'
            ? fetch(`/api/pos/sellables/${id}/components`).then((r) => (r.ok ? r.json() : null))
            : Promise.resolve(null),
          kind === 'service' && stockEnabled
            ? fetch(`/api/stock/consumption?finProductId=${id}`).then((r) => (r.ok ? r.json() : []))
            : Promise.resolve([]),
          kind === 'product' && itemId && stockEnabled
            ? fetch(`/api/stock/items/${itemId}/components`).then((r) => (r.ok ? r.json() : null))
            : Promise.resolve(null),
        ]);
        serviceRows = (pkg?.components ?? []).map(
          (c: { childProductId: string; qty: number | string }) => ({
            childProductId: c.childProductId,
            qty: Number(c.qty),
          }),
        );
        validity = pkg?.packageValidityDays == null ? '' : String(pkg.packageValidityDays);
        consumptionRows = (Array.isArray(cons) ? cons : []).map(
          (c: { itemId: string; qtyPerUnit: number | string; note?: string | null }) => ({
            itemId: c.itemId,
            qtyPerUnit: Number(c.qtyPerUnit),
            note: c.note ?? null,
          }),
        );
        bomRows = (bom?.components ?? []).map(
          (c: { id: string; childItemId: string; qty: number | string }) => ({
            id: c.id,
            childItemId: c.childItemId,
            qty: Number(c.qty),
          }),
        );
      } catch {
        serviceRows = [];
        consumptionRows = [];
        bomRows = [];
      } finally {
        loading = false;
      }
    })();
  });

  async function failed(res: Response): Promise<void> {
    const d = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    toastError(
      d.code === 'component_cycle' ? m.pos_recipe_cycle() : (d.error ?? m.data_table_save_failed()),
    );
  }

  // ── Writes: each one replaces or edits exactly the table the row lives in ──
  async function writeServices(next: typeof serviceRows, days?: number | null) {
    const res = await fetch(`/api/pos/sellables/${sellable.productId}/components`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        components: next.map((r, i) => ({ ...r, lineNo: i })),
        ...(days !== undefined ? { packageValidityDays: days } : {}),
      }),
    });
    if (!res.ok) return failed(res);
    serviceRows = next;
    onChanged();
  }
  async function writeConsumption(next: typeof consumptionRows) {
    const res = await fetch(`/api/pos/sellables/${sellable.productId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ consumption: next }),
    });
    if (!res.ok) return failed(res);
    consumptionRows = next;
    onChanged();
  }
  async function addBom(childItemId: string, qty: number) {
    const res = await fetch(`/api/stock/items/${sellable.itemId}/components`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ childItemId, qty }),
    });
    if (!res.ok) return failed(res);
    const j = (await res.json()) as { component: { id: string } };
    bomRows = [
      ...bomRows.filter((r) => r.childItemId !== childItemId),
      { id: j.component.id, childItemId, qty },
    ];
    onChanged();
  }
  async function removeBom(edgeId: string) {
    const res = await fetch(`/api/stock/items/${sellable.itemId}/components`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ componentId: edgeId }),
    });
    if (!res.ok) return failed(res);
    bomRows = bomRows.filter((r) => r.id !== edgeId);
    onChanged();
  }

  async function run(work: () => Promise<void>) {
    busy = true;
    try {
      await work();
    } finally {
      busy = false;
    }
  }

  function add(c: Candidate) {
    if (picked.has(c.id)) return;
    void run(async () => {
      switch (writePathFor(parentKind, c.kind)) {
        case 'package':
          return writeServices([...serviceRows, { childProductId: c.ref, qty: 1 }]);
        case 'consumption':
          return writeConsumption([
            ...consumptionRows,
            { itemId: c.ref, qtyPerUnit: 1, note: null },
          ]);
        case 'bom':
          return addBom(c.ref, 1);
      }
    });
  }

  function setQty(row: Row, raw: string) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || n === row.qty) return;
    void run(async () => {
      switch (writePathFor(parentKind, row.kind)) {
        case 'package':
          return writeServices(
            serviceRows.map((r) => (r.childProductId === row.ref ? { ...r, qty: n } : r)),
          );
        case 'consumption':
          return writeConsumption(
            consumptionRows.map((r) => (r.itemId === row.ref ? { ...r, qtyPerUnit: n } : r)),
          );
        case 'bom':
          return addBom(row.ref, n); // the BOM POST is an upsert on (parent, child)
      }
    });
  }

  function remove(row: Row) {
    void run(async () => {
      switch (writePathFor(parentKind, row.kind)) {
        case 'package':
          return writeServices(serviceRows.filter((r) => r.childProductId !== row.ref));
        case 'consumption':
          return writeConsumption(consumptionRows.filter((r) => r.itemId !== row.ref));
        case 'bom':
          if (row.edgeId) return removeBom(row.edgeId);
      }
    });
  }

  function saveValidity() {
    const days = String(validity ?? '').trim() === '' ? null : Math.floor(Number(validity));
    void run(() => writeServices(serviceRows, days && days > 0 ? days : null));
  }
</script>

<div class="comp">
  <p class="t-caption head">
    {m.pos_comp_title()}
    {#if hasServiceChild}<Badge variant="semantic" value="brand" size="sm"
        >{m.pos_catalog_kind_bundle()}</Badge
      >{/if}
  </p>

  {#if loading}
    <Spinner />
  {:else}
    {#if rows.length === 0}
      <p class="t-caption dim">
        {productNeedsItem
          ? m.pos_recipe_needs_item()
          : parentKind === 'product'
            ? m.pos_comp_empty_product()
            : m.pos_comp_empty_service()}
      </p>
    {:else}
      <ul class="rows">
        {#each rows as r (r.id)}
          <li class="row">
            <Badge variant="semantic" value={kindTone(r.kind)} size="sm">{kindLabel(r.kind)}</Badge>
            <Input
              size="sm"
              class="w-20"
              type="number"
              min="0"
              step="any"
              aria-label={m.pos_catalog_qty_per_unit()}
              value={String(r.qty)}
              disabled={!canEdit || busy}
              onchange={(e: Event) => setQty(r, (e.currentTarget as HTMLInputElement).value)}
            />
            <span class="t-caption unit"
              >{r.kind === 'service' ? m.pos_pkg_sessions_per() : r.detail}</span
            >
            <span class="name">{r.name}</span>
            {#if r.kind === 'service' && r.detail}<span class="t-caption dim">{r.detail}</span>{/if}
            {#if canEdit}
              <Button
                variant="ghost"
                size="sm"
                aria-label={m.common_remove()}
                disabled={busy}
                onclick={() => remove(r)}
              >
                <Trash2 size={iconSizes.xs} />
              </Button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if canEdit && !productNeedsItem}
      <div class="add">
        <Button variant="outline" size="sm" disabled={busy} onclick={() => (pickerOpen = true)}>
          <ListFilter size={iconSizes.sm} aria-hidden="true" />
          <span>{m.pos_comp_add()}</span>
        </Button>
        {#if hasServiceChild}
          <label class="fld t-caption">
            {m.pos_pkg_validity()}
            <Input
              size="sm"
              class="w-24"
              type="number"
              min="1"
              step="1"
              placeholder={m.pos_pkg_validity_none()}
              bind:value={validity}
              disabled={busy}
              onchange={saveValidity}
            />
          </label>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<Picker
  bind:open={pickerOpen}
  title={m.pos_comp_add()}
  subtitle={parentKind === 'product' ? m.pos_comp_empty_product() : m.pos_comp_empty_service()}
  columns={pickerColumns}
  rows={candidates}
  getRowId={(c) => c.id}
  onPick={add}
  selectionMode="multiple"
  duplicatePolicy="prevent"
  pickedIds={picked}
  storageKey="pos-composition"
/>

<style>
  .comp {
    padding: var(--space-2) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-tertiary);
  }
  .dim {
    color: var(--color-text-tertiary);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .unit {
    color: var(--color-text-secondary);
    white-space: nowrap;
  }
  .name {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .add {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .fld {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-text-secondary);
  }
</style>
