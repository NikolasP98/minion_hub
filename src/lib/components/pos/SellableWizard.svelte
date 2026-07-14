<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { Plus, Trash2 } from 'lucide-svelte';
  import { Modal, Button, Toggle } from '$lib/components/ui';
  import { toastAsync } from '$lib/state/ui/toast.svelte';

  // Narrow local shapes (mirrors server types) — avoids importing $server/*
  // runtime modules into a client component (same convention as ShiftBanner.svelte).
  interface StockItemLike {
    id: string;
    code: string;
    name: string;
    uom: string;
  }
  interface ConsumptionLike {
    finProductId: string;
    itemId: string;
    qtyPerUnit: number;
  }
  export interface SellableLike {
    productId: string;
    code: string;
    name: string;
    category: string | null;
    unitPrice: number | null;
    active: boolean;
    kind: 'product' | 'service';
    itemId: string | null;
  }

  interface Props {
    /** Bindable open state. */
    open?: boolean;
    stockEnabled: boolean;
    stockItems: StockItemLike[];
    /** Existing categories across the catalog — feeds the free-entry datalist. */
    categories: string[];
    /** Existing consumption mappings across the catalog — filtered to the
     *  edited product for prefill (see ★ note below). */
    consumption: ConsumptionLike[];
    /** null = create mode; a row = edit mode, prefilled from it. */
    editing?: SellableLike | null;
    /** Called after a successful save — caller invalidates the page load. */
    onSaved: () => void;
  }

  let { open = $bindable(false), stockEnabled, stockItems, categories, consumption, editing = null, onSaved }: Props = $props();

  // ── Server's slugifyCode (pos.service.ts) mirrored client-side — that
  // module is $server/*-only and can't be imported into a client component. ──
  function slugify(name: string): string {
    return name
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  let name = $state('');
  let code = $state('');
  let codeTouched = $state(false);
  let category = $state('');
  let unitPrice = $state('');
  let kind = $state<'product' | 'service'>('service');
  let trackStock = $state(false);
  let uom = $state('unit');
  let rows = $state<{ itemId: string; qtyPerUnit: string }[]>([]);
  let busy = $state(false);

  // Seed (or reset) the form whenever the wizard opens, from `editing` when
  // present. ★ Prefill for consumption mappings comes from the page's own
  // `consumption` list (already loaded org-wide for /stock/consumption) —
  // trivially available here, so edit mode filters it by productId rather
  // than starting empty.
  $effect(() => {
    if (!open) return;
    const e = editing;
    name = e?.name ?? '';
    code = e?.code ?? '';
    codeTouched = !!e; // edit mode: never auto-overwrite an existing code
    category = e?.category ?? '';
    unitPrice = e?.unitPrice != null ? String(e.unitPrice) : '';
    kind = e?.kind ?? 'service';
    trackStock = e?.itemId != null;
    uom = (e?.itemId ? stockItems.find((i) => i.id === e.itemId)?.uom : undefined) ?? 'unit';
    rows = e
      ? consumption.filter((c) => c.finProductId === e.productId).map((c) => ({ itemId: c.itemId, qtyPerUnit: String(c.qtyPerUnit) }))
      : [];
  });

  // Auto-suggest the code from the name until the user edits it manually.
  $effect(() => {
    if (codeTouched) return;
    code = slugify(name);
  });

  function usedElsewhere(idx: number): Set<string> {
    return new Set(rows.filter((_, i) => i !== idx).map((r) => r.itemId));
  }
  function optionsFor(idx: number): StockItemLike[] {
    const used = usedElsewhere(idx);
    return stockItems.filter((i) => !used.has(i.id));
  }
  function addRow() {
    const used = new Set(rows.map((r) => r.itemId));
    const next = stockItems.find((i) => !used.has(i.id));
    if (!next) return; // every stock item already mapped
    rows = [...rows, { itemId: next.id, qtyPerUnit: '' }];
  }
  function removeRow(idx: number) {
    rows = rows.filter((_, i) => i !== idx);
  }

  const canSubmit = $derived(name.trim() !== '' && code.trim() !== '' && !busy);

  async function submit() {
    if (!canSubmit) return;
    busy = true;
    const payload: Record<string, unknown> = {
      name: name.trim(),
      code: code.trim(),
      category: category.trim() || null,
      unitPrice: unitPrice.trim() === '' ? null : Number(unitPrice),
    };
    // kind/trackStock/uom are creation-only — updateSellable ignores them on PATCH.
    if (!editing) {
      payload.kind = kind;
      if (kind === 'product' && stockEnabled) {
        payload.trackStock = trackStock;
        if (trackStock) payload.uom = uom.trim() || 'unit';
      }
    }
    if (kind === 'service' && stockEnabled) {
      payload.consumption = rows.filter((r) => r.itemId && Number(r.qtyPerUnit) > 0).map((r) => ({ itemId: r.itemId, qtyPerUnit: Number(r.qtyPerUnit) }));
    }

    const url = editing ? `/api/pos/sellables/${editing.productId}` : '/api/pos/sellables';
    const method = editing ? 'PATCH' : 'POST';

    try {
      await toastAsync(
        (async () => {
          const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
          if (!res.ok) {
            const d = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
            throw new Error(d.code === 'code_taken' ? m.pos_catalog_code_taken() : (d.error ?? `Failed (${res.status})`));
          }
        })(),
        {
          loading: `${m.common_save()}…`,
          getOutcome: () => ({ type: 'success', title: m.common_save() }),
          onError: (err) => ({ title: m.data_table_save_failed(), description: err instanceof Error ? err.message : String(err) }),
        },
      );
      open = false;
      onSaved();
    } catch {
      // already toasted
    } finally {
      busy = false;
    }
  }
</script>

<Modal bind:open title={editing ? m.pos_catalog_edit() : m.pos_catalog_new()}>
  <div class="flex flex-col gap-3">
    <label class="fld">
      <span>{m.stock_field_name()}</span>
      <input class="inp" bind:value={name} />
    </label>
    <label class="fld">
      <span>{m.stock_field_code()}</span>
      <input class="inp font-mono" bind:value={code} oninput={() => (codeTouched = true)} />
    </label>
    <label class="fld">
      <span>{m.fin_col_category()}</span>
      <input class="inp" bind:value={category} list="pos-catalog-categories" />
      <datalist id="pos-catalog-categories">
        {#each categories as c (c)}<option value={c}></option>{/each}
      </datalist>
    </label>
    <label class="fld">
      <span>{m.pos_sell_price()}</span>
      <input class="inp" type="number" min="0" step="0.01" bind:value={unitPrice} />
    </label>

    {#if editing}
      <!-- updateSellable ignores kind/trackStock/uom on PATCH — showing live
           controls here would silently no-op, so they're creation-only. -->
      <p class="t-caption">{m.pos_catalog_kind_locked()}</p>
    {:else}
      <div class="fld">
        <span>{m.pos_catalog_kind_product()} / {m.pos_catalog_kind_service()}</span>
        <div class="kind-toggle">
          <button type="button" class="kind-btn" class:active={kind === 'service'} onclick={() => (kind = 'service')}>{m.pos_catalog_kind_service()}</button>
          <button type="button" class="kind-btn" class:active={kind === 'product'} onclick={() => (kind = 'product')}>{m.pos_catalog_kind_product()}</button>
        </div>
      </div>

      {#if kind === 'product' && stockEnabled}
        <Toggle bind:checked={trackStock} label={m.pos_catalog_track_stock()} />
        {#if trackStock}
          <label class="fld">
            <span>{m.stock_field_uom()}</span>
            <input class="inp" bind:value={uom} />
          </label>
        {/if}
      {/if}
    {/if}

    {#if kind === 'service' && stockEnabled}
      <div class="fld">
        <span>{m.pos_catalog_consumption()}</span>
        <div class="consumption-rows">
          {#each rows as row, idx (idx)}
            <div class="consumption-row">
              <select class="inp flex-1" bind:value={row.itemId}>
                {#each optionsFor(idx) as item (item.id)}
                  <option value={item.id}>{item.code} — {item.name}</option>
                {/each}
              </select>
              <input class="inp w-24" type="number" min="0" step="0.01" placeholder={m.pos_catalog_qty_per_unit()} bind:value={row.qtyPerUnit} />
              <button type="button" class="act-btn" onclick={() => removeRow(idx)} aria-label={m.common_remove()}><Trash2 size={12} /></button>
            </div>
          {/each}
          <Button variant="outline" size="sm" onclick={addRow} disabled={rows.length >= stockItems.length}>
            <Plus size={13} /> {m.common_add()}
          </Button>
        </div>
      </div>
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="outline" size="sm" onclick={() => (open = false)}>{m.common_cancel()}</Button>
    <Button variant="primary" size="sm" onclick={submit} disabled={!canSubmit}>{m.common_save()}</Button>
  {/snippet}
</Modal>

<style>
  .inp { height: 1.75rem; padding: 0 0.5rem; font-size: 0.82rem; border-radius: var(--radius-sm); background: var(--color-bg3); border: 1px solid var(--hairline); color: var(--color-foreground); font-family: inherit; }
  .fld { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.78rem; color: var(--color-muted-foreground); }
  .kind-toggle { display: flex; gap: 0.4rem; }
  .kind-btn { flex: 1; padding: 0.35rem 0.6rem; font-size: 0.8rem; border-radius: var(--radius-sm); border: 1px solid var(--hairline); background: var(--color-bg3); color: var(--color-muted-foreground); cursor: pointer; }
  .kind-btn.active { background: color-mix(in srgb, var(--color-accent) 15%, transparent); border-color: var(--color-accent); color: var(--color-foreground); }
  .consumption-rows { display: flex; flex-direction: column; gap: 0.4rem; }
  .consumption-row { display: flex; gap: 0.4rem; align-items: center; }
  .act-btn { display: inline-flex; align-items: center; justify-content: center; width: 1.75rem; height: 1.75rem; border-radius: var(--radius-sm); border: 1px solid var(--hairline); background: transparent; cursor: pointer; color: var(--color-muted-foreground); }
  .act-btn:hover { background: rgba(255, 255, 255, 0.06); color: var(--color-foreground); }
</style>
