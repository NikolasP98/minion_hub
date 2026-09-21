<script lang="ts">
  import type { PageData } from './$types';
  import { goto, invalidate } from '$lib/navigation';
  import * as m from '$lib/paraglide/messages';
  import { formatMoney } from '$lib/utils/format';
  import { createHotkey } from '$lib/hotkeys';
  import { Package, ArrowLeft } from 'lucide-svelte';
  import { PageHeader, Button, Toggle, Input, SegmentedControl } from '$lib/components/ui';
  import { FormFieldset } from '$lib/components/ui/foundations';
  import { canAct } from '$lib/access/can.svelte';
  import { UOM_PRESETS, gaugeMax, type UomConvertible } from '$lib/components/stock/stock-ui';
  import { MAX_MARKERS } from '$lib/components/stock/stock-svg';
  import ConsumptionGauge from '$lib/components/stock/ConsumptionGauge.svelte';
  import UnitDiagram from '$lib/components/stock/UnitDiagram.svelte';
  import ShapePicker from '$lib/components/stock/ShapePicker.svelte';
  import PartyPicker from '$lib/components/crm/PartyPicker.svelte';
  import { AttachmentButton, AttachmentList } from '$lib/components/attachments';
  import TagsField from '$lib/components/tags/TagsField.svelte';
  import TagChip from '$lib/components/tags/TagChip.svelte';
  import { toastError } from '$lib/state/ui/toast.svelte';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';

  let { data }: { data: PageData } = $props();

  type BinRow = PageData['bins'][number];
  type ConsumedByRow = PageData['consumedBy'][number];
  type LedgerRow = PageData['ledger'][number];
  let attachmentsRefreshKey = $state(0);
  // ponytail: backend contract fields (consumptionUom/unitsPerStockUom/subunitsPerStockUom/
  // diagramEnabled) are landing via a parallel migration — intersect optionally so this
  // page compiles against the contract before the columns exist server-side.
  type ItemUom = PageData['item'] &
    Partial<UomConvertible> & {
      diagramEnabled?: boolean;
      unitSvg?: string | null;
      subunitSvg?: string | null;
    };
  const item = $derived(data.item as ItemUom);

  // Tags save on every change (no Save step): the field is its own form.
  async function saveTags(ids: string[]) {
    const res = await fetch(`/api/tags/item/${item.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tagIds: ids }),
    });
    if (!res.ok) toastError(m.tags_create_failed());
    await invalidate('stock:item-detail');
  }

  let editing = $state(false);
  let editName = $state('');
  let editReorderLevel = $state('');
  let editReorderQty = $state('');
  let editMoq = $state('');
  let editSupplierPartyId = $state<string | null>(null);
  let editUom = $state('');
  let editConsumptionUom = $state('');
  let editUnitsPerStockUom = $state('');
  let editSubunitsPerStockUom = $state('');
  let editDiagramEnabled = $state(false);
  let editUnitSvg = $state<string | null>(null);
  let editSubunitSvg = $state<string | null>(null);
  let busy = $state(false);
  let err = $state<string | null>(null);

  /**
   * How this item is broken down between the ORDER tier and the USAGE tier.
   * Derived from the row on open; it only decides which inputs render (and what
   * `save()` sends) — it is never stored.
   *   nested → 1 caja = 10 vials × 50 ml   (both tiers)
   *   bulk   → 1 caja = 500 ml             (no sub-units)
   *   none   → no conversion at all        (e.g. a 'sesión')
   */
  type PackagingMode = 'nested' | 'bulk' | 'none';
  let mode = $state<PackagingMode>('none');
  /** Content per sub-unit (e.g. 50 ml per vial). NEVER stored — the canonical
   *  column is the TOTAL (unitsPerStockUom); this is the number users actually
   *  think in, so they type it and the total is computed. */
  let editPerSubunit = $state('');

  function modeOf(i: {
    consumptionUom?: string | null;
    unitsPerStockUom?: number | string | null;
    subunitsPerStockUom?: number | string | null;
  }): PackagingMode {
    if (!i.consumptionUom || !Number(i.unitsPerStockUom)) return 'none';
    return Number(i.subunitsPerStockUom) > 0 ? 'nested' : 'bulk';
  }
  const round4 = (n: number) => Math.round(n * 10000) / 10000;

  function startEdit() {
    editName = item.name;
    editReorderLevel = item.reorderLevel ?? '';
    editReorderQty = item.reorderQty ?? '';
    editMoq = item.moq ?? '';
    editSupplierPartyId = item.defaultSupplierPartyId ?? null;
    editUom = item.uom;
    editConsumptionUom = item.consumptionUom ?? '';
    editUnitsPerStockUom = item.unitsPerStockUom != null ? String(item.unitsPerStockUom) : '';
    editSubunitsPerStockUom =
      item.subunitsPerStockUom != null ? String(item.subunitsPerStockUom) : '';
    editDiagramEnabled = item.diagramEnabled ?? false;
    editUnitSvg = item.unitSvg ?? null;
    editSubunitSvg = item.subunitSvg ?? null;
    mode = modeOf(item);
    // Seed the per-sub-unit figure from the stored total. Display only — left
    // untouched it is never written back, so a repeating decimal (500/3) can't
    // drift the exact stored total.
    const s = Number(item.subunitsPerStockUom) || 0;
    const t = Number(item.unitsPerStockUom) || 0;
    editPerSubunit = s > 0 && t > 0 ? String(round4(t / s)) : '';
    err = null;
    editing = true;
  }

  // ── The three tiers, linked by one equation: total = subunits × perSubunit.
  // ponytail: a symmetric 2-way link, not a 3-way "pin the last two edited" —
  // edit either factor and the total recomputes; edit the total and the
  // per-sub-unit figure does. Nothing is read-only, no pinning state.
  function syncFromFactors() {
    const s = Number(editSubunitsPerStockUom);
    const p = Number(editPerSubunit);
    if (s > 0 && p > 0) editUnitsPerStockUom = String(round4(s * p));
  }
  function syncFromTotal() {
    const s = Number(editSubunitsPerStockUom);
    const t = Number(editUnitsPerStockUom);
    if (s > 0 && t > 0) editPerSubunit = String(round4(t / s));
  }

  /** Sub-unit counts must be whole — markerGrid() and the on-hand split below
   *  both assume it. */
  const subunitsError = $derived(
    mode === 'nested' &&
      editSubunitsPerStockUom !== '' &&
      !Number.isInteger(Number(editSubunitsPerStockUom))
      ? m.stock_uom_err_subunits_integer()
      : undefined,
  );

  // Caption preview computed live from the edit-form fields (not yet-saved item).
  const captionUom = $derived<UomConvertible>({
    uom: editUom,
    consumptionUom: editConsumptionUom || null,
    unitsPerStockUom: editUnitsPerStockUom !== '' ? Number(editUnitsPerStockUom) : null,
    subunitsPerStockUom: editSubunitsPerStockUom !== '' ? Number(editSubunitsPerStockUom) : null,
  });
  // Live, self-verifying conversion sentence: "1 caja = 10 × 50 ml = 500 ml".
  // Replaces the old italic caption — it now sits directly under the numbers
  // it explains, so the config proves itself as you type.
  const qty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  const previewUom = $derived(editUom || m.stock_uom_order_unit_generic());
  const previewComplete = $derived(
    mode !== 'none' &&
      !!editConsumptionUom &&
      Number(editUnitsPerStockUom) > 0 &&
      (mode === 'bulk' || Number(editSubunitsPerStockUom) > 0),
  );
  const uomPreview = $derived.by(() => {
    if (!previewComplete) return m.stock_uom_preview_pending();
    const total = qty(Number(editUnitsPerStockUom));
    if (mode === 'bulk')
      return m.stock_uom_preview_bulk({ uom: previewUom, total, usageUom: editConsumptionUom });
    return m.stock_uom_preview_nested({
      uom: previewUom,
      subunits: qty(Number(editSubunitsPerStockUom)),
      perSubunit: qty(Number(editPerSubunit)),
      usageUom: editConsumptionUom,
      total,
    });
  });
  const displayGaugeMax = $derived(gaugeMax(item));
  const editGaugeMax = $derived(gaugeMax(captionUom));
  const editSubunits = $derived(Number(editSubunitsPerStockUom) || 0);

  // ── Packaging visuals (view mode) ─────────────────────────────────────────
  // On-hand across all bins, in stock uom. The unit diagram shows the OPEN
  // (fractional) unit's remaining subunits; whole units are the ×N caption.
  const totalQty = $derived(data.bins.reduce((s, b) => s + Number(b.qty), 0));
  const subunitsCount = $derived(Number(item.subunitsPerStockUom) || 0);
  const unitsPerUom = $derived(Number(item.unitsPerStockUom) || 0);
  const wholeUnits = $derived(Math.floor(totalQty + 1e-9));
  const fracSubunits = $derived(subunitsCount > 0 ? (totalQty - wholeUnits) * subunitsCount : 0);
  // No open (fractional) unit → draw a sealed full unit rather than an empty one.
  const diagramFill = $derived(
    fracSubunits > 0 ? fracSubunits : wholeUnits > 0 ? subunitsCount : 0,
  );
  const showUnitDiagram = $derived(subunitsCount >= 1 && subunitsCount <= MAX_MARKERS);

  async function save() {
    busy = true;
    err = null;
    try {
      const res = await fetch(`/api/stock/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: editName,
          reorderLevel: editReorderLevel !== '' ? Number(editReorderLevel) : null,
          reorderQty: editReorderQty !== '' ? Number(editReorderQty) : null,
          moq: editMoq !== '' ? Number(editMoq) : null,
          defaultSupplierPartyId: editSupplierPartyId,
          uom: editUom,
          // The mode decides what a conversion even means for this item:
          // 'none' clears it outright, 'bulk' has no sub-unit tier.
          consumptionUom: mode === 'none' ? null : editConsumptionUom || null,
          unitsPerStockUom:
            mode === 'none' || editUnitsPerStockUom === '' ? null : Number(editUnitsPerStockUom),
          subunitsPerStockUom:
            mode === 'nested' && editSubunitsPerStockUom !== ''
              ? Number(editSubunitsPerStockUom)
              : null,
          diagramEnabled: mode === 'none' ? false : editDiagramEnabled,
          unitSvg: editUnitSvg,
          subunitSvg: editSubunitSvg,
        }),
      });
      if (res.ok) {
        editing = false;
        await invalidate('stock:item-detail');
      } else {
        err = m.stock_item_save_failed();
      }
    } finally {
      busy = false;
    }
  }

  const fmt = (n: string | number) =>
    Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
  // Money vs quantity: `fmt` stays unit-less for qty; money gets its symbol.
  const fmtMoney = (n: string | number) => formatMoney(Number(n));

  const binColumns: DataColumn<BinRow>[] = [
    { key: 'warehouse', label: m.stock_col_warehouse(), accessor: (b) => b.warehouseName },
    {
      key: 'qty',
      label: m.stock_col_qty(),
      align: 'right',
      numeric: true,
      custom: true,
      accessor: (b) => Number(b.qty),
    },
    {
      key: 'valuationRate',
      label: m.stock_col_valuation_rate(),
      align: 'right',
      numeric: true,
      custom: true,
      accessor: (b) => Number(b.valuationRate),
    },
    {
      key: 'value',
      label: m.stock_col_value(),
      align: 'right',
      numeric: true,
      custom: true,
      accessor: (b) => Number(b.qty) * Number(b.valuationRate),
    },
  ];

  const consumedByColumns: DataColumn<ConsumedByRow>[] = [
    {
      key: 'product',
      label: m.stock_col_product(),
      custom: true,
      accessor: (c) => `${c.productCode} — ${c.productName}`,
    },
    {
      key: 'qtyPerUnit',
      label: m.stock_consumption_col_qty_per_unit(),
      align: 'right',
      numeric: true,
      custom: true,
      accessor: (c) => Number(c.qtyPerUnit),
    },
    { key: 'note', label: m.stock_field_note(), custom: true, accessor: (c) => c.note ?? '—' },
  ];

  const ledgerColumns: DataColumn<LedgerRow>[] = [
    {
      key: 'postedAt',
      label: m.stock_col_posted_at(),
      sortable: false,
      custom: true,
      accessor: (l) => l.postedAt,
    },
    {
      key: 'warehouse',
      label: m.stock_col_warehouse(),
      sortable: false,
      accessor: (l) => l.warehouseName,
    },
    {
      key: 'delta',
      label: m.stock_col_delta(),
      align: 'right',
      numeric: true,
      sortable: false,
      custom: true,
      accessor: (l) => Number(l.qtyDelta),
    },
    {
      key: 'qtyAfter',
      label: m.stock_col_qty_after(),
      align: 'right',
      numeric: true,
      sortable: false,
      custom: true,
      accessor: (l) => Number(l.qtyAfter),
    },
    {
      key: 'valuationRate',
      label: m.stock_col_valuation_rate(),
      align: 'right',
      numeric: true,
      sortable: false,
      custom: true,
      accessor: (l) => Number(l.valuationRate),
    },
  ];

  // [ / ] prev/next through the ordered item list (clamped at the ends —
  // simpler than wraparound). Off while editing so a stray bracket keystroke
  // can't navigate away from unsaved changes.
  const itemIndex = $derived(data.itemIds.indexOf(item.id));
  createHotkey(
    '[',
    () => {
      if (itemIndex > 0) goto(`/stock/items/${data.itemIds[itemIndex - 1]}`);
    },
    () => ({
      enabled: !editing,
      meta: { name: m.shortcuts_stockPrevItem() },
    }),
  );
  createHotkey(
    ']',
    () => {
      if (itemIndex >= 0 && itemIndex < data.itemIds.length - 1)
        goto(`/stock/items/${data.itemIds[itemIndex + 1]}`);
    },
    () => ({
      enabled: !editing,
      meta: { name: m.shortcuts_stockNextItem() },
    }),
  );
</script>

<svelte:head><title>{item.name} — {m.nav_stock()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0 flex-1 min-w-0">
  <PageHeader title={item.name} subtitle={item.code}>
    {#snippet leading()}<Package size={16} class="text-accent shrink-0" />{/snippet}
    {#snippet actions()}
      <Button variant="outline" size="sm" onclick={() => history.back()}
        ><ArrowLeft size={14} /> {m.common_back()}</Button
      >
      {#if !editing}
        <Button
          variant="outline"
          size="sm"
          onclick={startEdit}
          disabled={!canAct('stock', 'edit')}
          title={canAct('stock', 'edit') ? undefined : m.no_permission()}>{m.common_edit()}</Button
        >
      {/if}
    {/snippet}
  </PageHeader>

  <div class="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4">
    <div class="card">
      {#if editing}
        <div class="flex flex-col gap-3 max-w-md">
          <Input size="sm" label={m.stock_field_name()} bind:value={editName} />
          <Input
            size="sm"
            type="number"
            min="0"
            step="0.01"
            label={m.stock_col_reorder_level()}
            bind:value={editReorderLevel}
          />
          <Input
            size="sm"
            type="number"
            min="0"
            step="0.01"
            label={m.stock_col_reorder_qty()}
            bind:value={editReorderQty}
          />

          <!-- Supply side (#12): the stock module owns procurement facts. -->
          <Input
            size="sm"
            type="number"
            min="0"
            step="any"
            label={m.stock_col_moq()}
            helper={m.stock_moq_hint({ uom: editUom || m.stock_uom_order_unit_generic() })}
            bind:value={editMoq}
          />
          <PartyPicker
            bind:value={editSupplierPartyId}
            label={m.stock_field_default_supplier()}
            initialName={item.defaultSupplierName ?? ''}
          />
          <p class="t-caption stage-hint">{m.stock_field_default_supplier_hint()}</p>

          <div class="uom-section">
            <div class="card-h">{m.stock_uom_section_title()}</div>

            <FormFieldset legend={m.stock_uom_mode_legend()} helper={m.stock_uom_mode_hint()}>
              <SegmentedControl
                aria-label={m.stock_uom_mode_legend()}
                bind:value={mode}
                items={[
                  { value: 'nested', label: m.stock_uom_mode_nested() },
                  { value: 'bulk', label: m.stock_uom_mode_bulk() },
                  { value: 'none', label: m.stock_uom_mode_none() },
                ]}
              />
            </FormFieldset>

            <!-- Tier nouns: what you BUY vs what you CONSUME -->
            <div class="uom-grid">
              <Input
                size="sm"
                list="uom-presets"
                label={m.stock_uom_order_unit()}
                helper={m.stock_uom_order_unit_hint()}
                bind:value={editUom}
              />
              {#if mode !== 'none'}
                <Input
                  size="sm"
                  list="uom-presets"
                  label={m.stock_uom_usage_unit()}
                  helper={m.stock_uom_usage_unit_hint()}
                  bind:value={editConsumptionUom}
                />
              {/if}
            </div>
            <datalist id="uom-presets">
              {#each UOM_PRESETS as preset (preset)}<option value={preset}></option>{/each}
            </datalist>

            <!-- The numbers. Labels interpolate the live uom so each input
                 states its own tier: "Sub-units per caja", "Total per caja". -->
            {#if mode !== 'none'}
              <div class="tier-grid">
                {#if mode === 'nested'}
                  <Input
                    size="sm"
                    type="number"
                    min="1"
                    step="1"
                    label={m.stock_uom_subunit_count({ uom: previewUom })}
                    helper={m.stock_uom_subunit_count_hint({ uom: previewUom })}
                    error={subunitsError}
                    bind:value={editSubunitsPerStockUom}
                    oninput={syncFromFactors}
                  />
                  <Input
                    size="sm"
                    type="number"
                    min="0"
                    step="any"
                    inputmode="decimal"
                    label={m.stock_uom_content_per_subunit()}
                    helper={m.stock_uom_content_per_subunit_hint()}
                    bind:value={editPerSubunit}
                    oninput={syncFromFactors}
                  >
                    {#snippet trailing()}<span class="adorn">{editConsumptionUom}</span>{/snippet}
                  </Input>
                {/if}
                <Input
                  size="sm"
                  type="number"
                  min="0"
                  step="any"
                  inputmode="decimal"
                  label={m.stock_uom_total_per_order_unit({ uom: previewUom })}
                  helper={mode === 'nested'
                    ? m.stock_uom_total_hint_derived()
                    : m.stock_uom_total_hint({ uom: previewUom })}
                  bind:value={editUnitsPerStockUom}
                  oninput={syncFromTotal}
                >
                  {#snippet trailing()}<span class="adorn">{editConsumptionUom}</span>{/snippet}
                </Input>
              </div>

              <p class="uom-preview" class:ok={previewComplete} aria-live="polite">{uomPreview}</p>
            {/if}

            {#if mode !== 'none'}
              <Toggle
                bind:checked={editDiagramEnabled}
                size="sm"
                disabled={editGaugeMax <= 0}
                label={m.stock_field_diagram_enabled()}
                description={editGaugeMax > 0
                  ? m.stock_field_diagram_enabled_hint()
                  : m.stock_uom_err_diagram_needs_conversion()}
              />
            {/if}

            <!-- Box shape = what you see when ORDERING; vessel = what you see
                 AFTER the service, to adjust what was actually used. -->
            {#if mode === 'nested' && editSubunits >= 1}
              <div class="shape-block">
                <ShapePicker
                  kind="container"
                  bind:value={editUnitSvg}
                  label={m.stock_field_unit_svg()}
                />
                <p class="t-caption stage-hint">{m.stock_uom_shape_order_hint()}</p>
              </div>
            {/if}
            {#if editGaugeMax > 0}
              <div class="shape-block">
                <ShapePicker
                  kind="vessel"
                  bind:value={editSubunitSvg}
                  label={m.stock_field_subunit_svg()}
                />
                <p class="t-caption stage-hint">{m.stock_uom_shape_usage_hint()}</p>
              </div>
            {/if}

            {#if editGaugeMax > 0}
              <div class="pack-row">
                {#if mode === 'nested' && editSubunits >= 1 && editSubunits <= MAX_MARKERS}
                  <div class="pack-block">
                    <UnitDiagram shape={editUnitSvg} count={editSubunits} filled={editSubunits} />
                    <span class="pack-caption">{m.stock_uom_stage_order()}</span>
                  </div>
                {/if}
                <div class="pack-block">
                  <ConsumptionGauge
                    readonly
                    max={editGaugeMax}
                    value={editGaugeMax}
                    unit={editConsumptionUom}
                    shape={editSubunitSvg}
                  />
                  <span class="pack-caption">{m.stock_uom_stage_usage()}</span>
                </div>
              </div>
            {/if}
          </div>

          {#if err}<p class="err-msg">{err}</p>{/if}
          <div class="flex gap-2">
            <Button variant="primary" size="sm" onclick={save} disabled={busy || !!subunitsError}
              >{m.common_save()}</Button
            >
            <Button variant="outline" size="sm" onclick={() => (editing = false)}
              >{m.common_cancel()}</Button
            >
          </div>
        </div>
      {:else}
        <dl class="meta-grid">
          <dt>{m.stock_col_uom()}</dt>
          <dd>{item.uom}</dd>
          <dt>{m.stock_col_group()}</dt>
          <dd>{item.itemGroup ?? '—'}</dd>
          <dt>{m.stock_col_reorder_level()}</dt>
          <dd>{item.reorderLevel ?? '—'}</dd>
          <dt>{m.stock_col_reorder_qty()}</dt>
          <dd>{item.reorderQty ?? '—'}</dd>
          <dt>{m.stock_col_moq()}</dt>
          <dd>{item.moq ?? '—'}</dd>
          <dt>{m.stock_field_default_supplier()}</dt>
          <dd>{item.defaultSupplierName ?? '—'}</dd>
          <dt>{m.stock_col_last_restock_cost()}</dt>
          <dd>
            {#if item.lastRestockCost != null}
              {fmtMoney(item.lastRestockCost)}
              {#if item.lastSupplierName}<span class="t-caption stage-hint"
                  >· {item.lastSupplierName}</span
                >{/if}
            {:else}—{/if}
          </dd>
          {#if item.consumptionUom}
            <dt>{m.stock_field_consumption_uom()}</dt>
            <dd>{item.consumptionUom}</dd>
          {/if}
          {#if displayGaugeMax > 0}
            <dt>{m.stock_field_diagram_enabled()}</dt>
            <dd>{item.diagramEnabled ? m.common_yes() : m.common_no()}</dd>
          {/if}
        </dl>
      {/if}
    </div>

    {#if !editing && displayGaugeMax > 0}
      <div class="card">
        <div class="card-h">{m.stock_packaging_title()}</div>
        <div class="pack-row">
          {#if showUnitDiagram}
            <div class="pack-block">
              <UnitDiagram shape={item.unitSvg} count={subunitsCount} filled={diagramFill} />
              <span class="pack-caption">
                {m.stock_packaging_full_units({ count: wholeUnits })}
                {#if fracSubunits > 0}&nbsp;+ {fmt(fracSubunits)}/{fmt(subunitsCount)}{/if}
              </span>
            </div>
          {/if}
          <div class="pack-block">
            <ConsumptionGauge
              readonly
              max={displayGaugeMax}
              value={displayGaugeMax}
              unit={item.consumptionUom ?? item.uom}
              shape={item.subunitSvg}
            />
            {#if subunitsCount >= 1}
              <span class="pack-caption"
                >{m.stock_packaging_per_subunit({
                  qty: fmt(displayGaugeMax),
                  unit: item.consumptionUom ?? item.uom,
                })}</span
              >
            {/if}
          </div>
          <div class="pack-sums">
            <span class="pack-chip"
              >{m.stock_packaging_on_hand({ qty: fmt(totalQty), uom: item.uom })}</span
            >
            {#if subunitsCount >= 1}
              <span class="pack-chip"
                >{m.stock_packaging_subunits({ count: fmt(totalQty * subunitsCount) })}</span
              >
            {/if}
            {#if unitsPerUom > 0 && item.consumptionUom}
              <span class="pack-chip"
                >{m.stock_packaging_consumption({
                  qty: fmt(totalQty * unitsPerUom),
                  unit: item.consumptionUom,
                })}</span
              >
            {/if}
          </div>
        </div>
      </div>
    {/if}

    <div class="card">
      <div class="card-h">{m.tags_label()}</div>
      <TagsField
        scope="stock"
        allTags={data.allTags}
        value={data.tags.map((t) => t.id)}
        onchange={saveTags}
        disabled={!canAct('stock', 'edit')}
      />
      {#if data.inheritedTags.length}
        <p class="t-caption mt-2">{m.tags_from_ingredients()}</p>
        <div class="tag-chips">
          {#each data.inheritedTags as t (t.id)}
            <TagChip size="sm" name={t.name} color={t.color} dashed origin="ingredient" />
          {/each}
        </div>
      {/if}
    </div>

    <div class="card">
      <div class="card-h">{m.stock_item_bins_title()}</div>
      {#if data.bins.length === 0}
        <p class="t-caption">{m.stock_bins_empty()}</p>
      {:else}
        <DataTable
          variant="plain"
          data={data.bins}
          columns={binColumns}
          getRowId={(b) => b.warehouseId}
        >
          {#snippet cell(row: BinRow, col: DataColumn<BinRow>)}
            {#if col.key === 'qty'}
              <span class="tabular-nums">{fmt(row.qty)}</span>
            {:else if col.key === 'valuationRate'}
              <span class="tabular-nums">{fmtMoney(row.valuationRate)}</span>
            {:else if col.key === 'value'}
              <span class="tabular-nums"
                >{fmtMoney(Number(row.qty) * Number(row.valuationRate))}</span
              >
            {/if}
          {/snippet}
        </DataTable>
      {/if}
    </div>

    <div class="card">
      <div class="card-h">{m.stock_item_consumed_by_title()}</div>
      {#if data.consumedBy.length === 0}
        <p class="t-caption">{m.stock_item_consumed_by_empty()}</p>
      {:else}
        <DataTable
          variant="plain"
          data={data.consumedBy}
          columns={consumedByColumns}
          getRowId={(c) => c.id}
        >
          {#snippet cell(row: ConsumedByRow, col: DataColumn<ConsumedByRow>)}
            {#if col.key === 'product'}
              {row.productCode} — {row.productName}
            {:else if col.key === 'qtyPerUnit'}
              <span class="tabular-nums">{fmt(row.qtyPerUnit)}</span>
            {:else if col.key === 'note'}
              <span class="t-caption">{row.note ?? '—'}</span>
            {/if}
          {/snippet}
        </DataTable>
      {/if}
    </div>
    <div class="card">
      <div class="card-h">{m.stock_item_ledger_title()}</div>
      {#if data.ledger.length === 0}
        <p class="t-caption">{m.stock_ledger_empty()}</p>
      {:else}
        <DataTable
          variant="plain"
          data={data.ledger}
          columns={ledgerColumns}
          getRowId={(l) => String(l.id)}
        >
          {#snippet cell(row: LedgerRow, col: DataColumn<LedgerRow>)}
            {#if col.key === 'postedAt'}
              <span class="t-caption">{new Date(row.postedAt).toLocaleString()}</span>
            {:else if col.key === 'delta'}
              <span
                class="tabular-nums"
                class:delta-in={Number(row.qtyDelta) > 0}
                class:delta-out={Number(row.qtyDelta) < 0}
              >
                {Number(row.qtyDelta) > 0 ? '+' : ''}{fmt(row.qtyDelta)}
              </span>
            {:else if col.key === 'qtyAfter'}
              <span class="tabular-nums">{fmt(row.qtyAfter)}</span>
            {:else if col.key === 'valuationRate'}
              <span class="tabular-nums">{fmtMoney(row.valuationRate)}</span>
            {/if}
          {/snippet}
        </DataTable>
      {/if}
    </div>
    <div class="card">
      <div class="card-h flex items-center justify-between gap-2">
        <span>{m.attachments_title()}</span>
        <AttachmentButton
          objectType="stk_item"
          objectId={item.id}
          size="sm"
          disabled={!canAct('stock', 'edit')}
          onuploaded={() => (attachmentsRefreshKey += 1)}
        />
      </div>
      <AttachmentList objectType="stk_item" objectId={item.id} refreshKey={attachmentsRefreshKey} />
    </div>
  </div>
</div>

<style>
  .tag-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-top: var(--space-1);
  }
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
  }
  .meta-grid dt {
    color: var(--color-muted-foreground);
  }
  .err-msg {
    font-size: var(--font-size-body);
    color: var(--color-danger-fg);
  }
  .uom-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--hairline);
    container-type: inline-size;
    container-name: uomcfg;
  }
  .uom-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }
  /* The three tiers share one row so their relationship reads left→right. */
  .tier-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
  }
  /* Named container — Svelte prunes anonymous @container rules. */
  @container uomcfg (max-width: 36rem) {
    .uom-grid,
    .tier-grid {
      grid-template-columns: 1fr;
    }
  }
  /* Self-verifying conversion sentence; accent only once complete. */
  .uom-preview {
    font-size: var(--font-size-body);
    font-variant-numeric: tabular-nums;
    color: var(--color-text-tertiary);
    background: var(--color-surface-2);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
  }
  .uom-preview.ok {
    color: var(--color-accent);
  }
  .adorn {
    color: var(--color-text-tertiary);
    font-size: var(--font-size-caption);
  }
  .shape-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .stage-hint {
    color: var(--color-text-tertiary);
  }
  .pack-row {
    display: flex;
    align-items: flex-end;
    gap: var(--space-6);
    flex-wrap: wrap;
  }
  .pack-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
  }
  .pack-caption {
    font-size: var(--font-size-caption);
    color: var(--color-muted-foreground);
    text-align: center;
  }
  .pack-sums {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-self: center;
  }
  .pack-chip {
    font-size: var(--font-size-body);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    background: var(--color-bg3);
    width: fit-content;
    font-variant-numeric: tabular-nums;
  }
  .delta-in {
    color: var(--color-success, var(--color-emerald));
  }
  .delta-out {
    color: var(--color-destructive);
  }
</style>
