<script lang="ts">
  import { Select } from '$lib/components/ui';

  import * as m from '$lib/paraglide/messages';
  import { Plus, Trash2 } from 'lucide-svelte';
  import { Modal, Button, SegmentedControl, Input } from '$lib/components/ui';
  import { toastAsync } from '$lib/state/ui/toast.svelte';
  import {
    CODE_MAX,
    CODE_PATTERN,
    codeError,
    normalizeCode,
    uniqueCodeFrom,
    type CodeError,
  } from '$lib/catalog/code';

  // Narrow local shapes (mirrors server types) — avoids importing $server/*
  // runtime modules into a client component (same convention as ShiftBanner.svelte).
  interface StockItemLike {
    id: string;
    code: string;
    name: string;
    uom: string;
    /** Set ⇒ already published as a sellable, so it can't be published again
     *  (enforced by the stk_items_org_fin_product_uniq partial index). */
    finProductId?: string | null;
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
    /** Mirrors SellableRow.kind. The wizard does not CREATE bundles (that is
     *  the bundle editor's job); it must merely not choke on editing one. */
    kind: 'product' | 'service' | 'bundle';
    itemId: string | null;
  }

  interface Props {
    /** Bindable open state. */
    open?: boolean;
    stockEnabled: boolean;
    stockItems: StockItemLike[];
    /** Existing categories across the catalog — feeds the free-entry datalist. */
    categories: string[];
    /** Every code already in use, so the auto-suggestion never proposes a
     *  collision the server would then reject with `code_taken`. */
    takenCodes?: string[];
    /** Existing consumption mappings across the catalog — filtered to the
     *  edited product for prefill (see ★ note below). */
    consumption: ConsumptionLike[];
    /** null = create mode; a row = edit mode, prefilled from it. */
    editing?: SellableLike | null;
    /** Called after a successful save — caller invalidates the page load. */
    onSaved: () => void;
  }

  let {
    open = $bindable(false),
    stockEnabled,
    stockItems,
    categories,
    takenCodes = [],
    consumption,
    editing = null,
    onSaved,
  }: Props = $props();

  // Code format is now ONE shared rail ($lib/catalog/code.ts), imported by both
  // this component and pos.service.ts. It used to be a hand-copied mirror of the
  // server's slugifyCode, and the two had drifted — which is how `CMSVP` and
  // `CM-SVP` both ended up in the catalog as separate products.
  const CODE_ERR_MSG: Record<CodeError, () => string> = {
    empty: m.catalog_code_err_empty,
    too_short: m.catalog_code_err_too_short,
    too_long: m.catalog_code_err_too_long,
    charset: m.catalog_code_err_charset,
  };

  let name = $state('');
  let code = $state('');
  let codeTouched = $state(false);
  let category = $state('');
  let unitPrice = $state('');
  /**
   * What backs this sellable. Replaces the old kind+trackStock pair:
   *   service       → no stock item at all
   *   new-item      → create a fresh tracked stk_item (was kind=product+trackStock)
   *   existing-item → publish an EXISTING raw material (task #10)
   * `kind` is derived from it — the server derives it again from the item link.
   */
  type Source = 'service' | 'new-item' | 'existing-item';
  let source = $state<Source>('service');
  let existingItemId = $state('');
  let uom = $state('unit');
  const kind = $derived<'product' | 'service'>(source === 'service' ? 'service' : 'product');
  /** Only items not already published can be linked. */
  const availableItems = $derived(stockItems.filter((i) => !i.finProductId));
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
    // `source` is creation-only (hidden in edit mode), so edit just resets it.
    source = 'service';
    existingItemId = '';
    uom = (e?.itemId ? stockItems.find((i) => i.id === e.itemId)?.uom : undefined) ?? 'unit';
    rows = e
      ? consumption
          .filter((c) => c.finProductId === e.productId)
          .map((c) => ({ itemId: c.itemId, qtyPerUnit: String(c.qtyPerUnit) }))
      : [];
  });

  // Auto-suggest the code from the name until the user edits it manually.
  $effect(() => {
    if (codeTouched) return;
    code = uniqueCodeFrom(name, takenCodes);
  });

  // Blank while the user is still typing the first character — an "at least 2
  // characters" error on an empty field the user just opened is noise, not help.
  const codeErr = $derived(codeTouched && code !== '' ? codeError(code) : null);

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

  const canSubmit = $derived(
    name.trim() !== '' &&
      // Format is a hard gate, not a warning: a malformed code that reaches the
      // server becomes a permanent business key (see $lib/catalog/code.ts).
      codeError(code) === null &&
      !busy &&
      // publishing an existing item requires one to be picked
      !(!editing && source === 'existing-item' && !existingItemId),
  );

  async function submit() {
    if (!canSubmit) return;
    busy = true;
    const payload: Record<string, unknown> = {
      name: name.trim(),
      code: code.trim(),
      category: category.trim() || null,
      unitPrice: unitPrice.trim() === '' ? null : Number(unitPrice),
    };
    // kind/trackStock/uom/itemId are creation-only — updateSellable ignores
    // them on PATCH.
    if (!editing) {
      payload.kind = kind;
      if (stockEnabled) {
        if (source === 'new-item') {
          payload.trackStock = true;
          payload.uom = uom.trim() || 'unit';
        } else if (source === 'existing-item') {
          payload.itemId = existingItemId;
        }
      }
    }
    // Recipes are NOT service-only: a product-kind sellable may carry one too
    // (resolveIssueLines gives an authored recipe precedence over the 1:1
    // bridge). createSellable/updateSellable already accepted this for any
    // kind — only this form was gating it.
    if (stockEnabled) {
      payload.consumption = rows
        .filter((r) => r.itemId && Number(r.qtyPerUnit) > 0)
        .map((r) => ({ itemId: r.itemId, qtyPerUnit: Number(r.qtyPerUnit) }));
    }

    const url = editing ? `/api/pos/sellables/${editing.productId}` : '/api/pos/sellables';
    const method = editing ? 'PATCH' : 'POST';

    try {
      await toastAsync(
        (async () => {
          const res = await fetch(url, {
            method,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            const d = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
            throw new Error(
              d.code === 'code_taken'
                ? m.pos_catalog_code_taken()
                : (d.error ?? `Failed (${res.status})`),
            );
          }
        })(),
        {
          loading: `${m.common_save()}…`,
          getOutcome: () => ({ type: 'success', title: m.common_save() }),
          onError: (err) => ({
            title: m.data_table_save_failed(),
            description: err instanceof Error ? err.message : String(err),
          }),
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
    <Input size="sm" label={m.stock_field_name()} bind:value={name} />
    <Input
      size="sm"
      inputClass="font-mono uppercase"
      label={m.stock_field_code()}
      helper={m.catalog_code_helper()}
      error={codeErr ? CODE_ERR_MSG[codeErr]() : undefined}
      value={code}
      maxlength={CODE_MAX}
      pattern={CODE_PATTERN}
      autocapitalize="characters"
      spellcheck="false"
      oninput={(e) => {
        codeTouched = true;
        // Normalize in place so a pasted "CM-SVP" visibly becomes "CMSV"
        // instead of being silently rejected only on submit. Writing back to
        // the DOM value keeps the caret sane when nothing was stripped.
        const el = e.currentTarget as HTMLInputElement;
        code = normalizeCode(el.value);
        if (el.value !== code) el.value = code;
      }}
    />
    <Input
      size="sm"
      label={m.fin_col_category()}
      list="pos-catalog-categories"
      bind:value={category}
    />
    <datalist id="pos-catalog-categories">
      {#each categories as c (c)}<option value={c}></option>{/each}
    </datalist>
    <Input
      size="sm"
      type="number"
      min="0"
      step="0.01"
      label={m.pos_sell_price()}
      bind:value={unitPrice}
    />

    {#if editing}
      <!-- updateSellable ignores kind/trackStock/uom on PATCH — showing live
           controls here would silently no-op, so they're creation-only. -->
      <p class="t-caption">{m.pos_catalog_kind_locked()}</p>
    {:else}
      <div class="fld">
        <span>{m.pos_catalog_source()}</span>
        <SegmentedControl
          aria-label={m.pos_catalog_source()}
          bind:value={source}
          items={[
            { value: 'service', label: m.pos_catalog_kind_service() },
            ...(stockEnabled
              ? [
                  { value: 'new-item', label: m.pos_catalog_source_new_item() },
                  {
                    value: 'existing-item',
                    label: m.pos_catalog_source_existing_item(),
                    disabled: availableItems.length === 0,
                    title:
                      availableItems.length === 0 ? m.pos_catalog_no_unlinked_items() : undefined,
                  },
                ]
              : []),
          ]}
        />
      </div>

      {#if source === 'new-item' && stockEnabled}
        <Input size="sm" label={m.stock_field_uom()} bind:value={uom} />
      {:else if source === 'existing-item' && stockEnabled}
        <label class="fld">
          <span>{m.pos_catalog_pick_item()}</span>
          <Select fieldClass="min-w-0" bind:value={existingItemId}>
            <option value="">{m.pos_catalog_pick_item()}…</option>
            {#each availableItems as item (item.id)}
              <option value={item.id}>{item.code} — {item.name}</option>
            {/each}
          </Select>
        </label>
      {/if}
    {/if}

    {#if stockEnabled}
      <div class="fld">
        <span>{m.pos_catalog_consumption()}</span>
        <div class="consumption-rows">
          {#each rows as row, idx (idx)}
            <div class="consumption-row">
              <Select fieldClass="min-w-0 flex-1" bind:value={row.itemId}>
                {#each optionsFor(idx) as item (item.id)}
                  <option value={item.id}>{item.code} — {item.name}</option>
                {/each}
              </Select>
              <Input
                size="sm"
                class="w-24"
                type="number"
                min="0"
                step="0.01"
                placeholder={m.pos_catalog_qty_per_unit()}
                bind:value={row.qtyPerUnit}
              />
              <Button
                type="button"
                class="act-btn"
                onclick={() => removeRow(idx)}
                aria-label={m.common_remove()}><Trash2 size={12} /></Button
              >
            </div>
          {/each}
          <Button
            variant="outline"
            size="sm"
            onclick={addRow}
            disabled={rows.length >= stockItems.length}
          >
            <Plus size={13} />
            {m.common_add()}
          </Button>
        </div>
      </div>
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="outline" size="sm" onclick={() => (open = false)}>{m.common_cancel()}</Button>
    <Button variant="primary" size="sm" onclick={submit} disabled={!canSubmit}
      >{m.common_save()}</Button
    >
  {/snippet}
</Modal>

<style>
  /* `.fld` survives only for the two grouping wrappers (consumption rows,
     existing-item picker) that aren't a single Input. */
  .fld {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
  }
  .consumption-rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .consumption-row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  .consumption-row :global(.act-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--hairline);
    background: transparent;
    cursor: pointer;
    color: var(--color-muted-foreground);
  }
  .consumption-row :global(.act-btn):hover {
    background: color-mix(in srgb, var(--color-foreground) 6%, transparent);
    color: var(--color-foreground);
  }
</style>
