<script lang="ts">
  import type { PageData } from './$types';
  import { goto, invalidate } from '$lib/navigation';
  import * as m from '$lib/paraglide/messages';
  import { formatMoney } from '$lib/utils/format';
  import { createHotkey } from '$lib/hotkeys';
  import { Package, ArrowLeft, ArrowRight, Tally5 } from 'lucide-svelte';
  import { PageHeader, Button, Toggle, Input } from '$lib/components/ui';
  import { canAct } from '$lib/access/can.svelte';
  import { UOM_PRESETS, type UomConvertible } from '$lib/components/stock/stock-ui';
  import { vesselShape, VESSEL_VIEWBOX } from '$lib/components/stock/stock-svg';
  import {
    packagingFacts,
    packagingMode,
    round4,
    type PackagingMode,
  } from '$lib/components/stock/packaging-preview';
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

  /** Which inputs render and what `save()` sends — derived on open, never
   *  stored (see packaging-preview.ts). */
  let mode = $state<PackagingMode>('count');
  /** Content per piece (e.g. 50 ml per vial). NEVER stored — the canonical
   *  column is the TOTAL (unitsPerStockUom); this is the number users actually
   *  think in, so they type it and the total is computed. */
  let editPerPiece = $state('');
  /** Pieces mode: type the per-package total instead of the per-piece figure. */
  let typeTotal = $state(false);

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
    mode = packagingMode(item);
    typeTotal = false;
    // Seed the per-piece figure from the stored total. Display only — left
    // untouched it is never written back, so a repeating decimal (500/3) can't
    // drift the exact stored total.
    const s = Number(item.subunitsPerStockUom) || 0;
    const t = Number(item.unitsPerStockUom) || 0;
    editPerPiece = s > 0 && t > 0 ? String(round4(t / s)) : '';
    err = null;
    editing = true;
  }

  // ── The three tiers, linked by one equation: total = pieces × perPiece.
  // ponytail: a symmetric 2-way link — edit either factor and the total
  // recomputes; edit the total and the per-piece figure does.
  function syncFromFactors() {
    const s = Number(editSubunitsPerStockUom);
    const p = Number(editPerPiece);
    if (s > 0 && p > 0) editUnitsPerStockUom = String(round4(s * p));
  }
  function syncFromTotal() {
    const s = Number(editSubunitsPerStockUom);
    const t = Number(editUnitsPerStockUom);
    if (s > 0 && t > 0) editPerPiece = String(round4(t / s));
  }

  /** Piece counts must be whole — markerGrid() and the on-hand split assume it. */
  const piecesError = $derived(
    mode === 'pieces' &&
      editSubunitsPerStockUom !== '' &&
      !Number.isInteger(Number(editSubunitsPerStockUom))
      ? m.stock_uom_err_subunits_integer()
      : undefined,
  );

  // Live conversion computed from the edit-form fields (not the saved item):
  // the same object `save()` will persist, so every preview is self-verifying.
  const draftUom = $derived<UomConvertible>({
    uom: editUom,
    consumptionUom: mode === 'count' ? null : editConsumptionUom || null,
    unitsPerStockUom:
      mode === 'count' || editUnitsPerStockUom === '' ? null : Number(editUnitsPerStockUom),
    subunitsPerStockUom:
      mode === 'pieces' && editSubunitsPerStockUom !== '' ? Number(editSubunitsPerStockUom) : null,
  });
  const qty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  const previewUom = $derived(editUom || m.stock_uom_order_unit_generic());
  const editPieces = $derived(Math.floor(Number(editSubunitsPerStockUom)) || 0);
  const draftComplete = $derived(packagingMode(draftUom) === mode && mode !== 'count');
  const equation = $derived.by(() => {
    if (mode === 'count') return m.stock_pk_mode_count();
    if (!draftComplete) return m.stock_uom_preview_pending();
    const total = qty(Number(editUnitsPerStockUom));
    if (mode === 'bulk')
      return m.stock_uom_preview_bulk({ uom: previewUom, total, usageUom: editConsumptionUom });
    return m.stock_uom_preview_nested({
      uom: previewUom,
      subunits: qty(editPieces),
      perSubunit: qty(Number(editPerPiece)),
      usageUom: editConsumptionUom,
      total,
    });
  });

  // ── Packaging facts: the saved item (view mode) or the draft (edit mode),
  // translated across tiers using the on-hand total the page already loads.
  const totalQty = $derived(data.bins.reduce((s, b) => s + Number(b.qty), 0));
  const savedFacts = $derived(packagingFacts(item, totalQty));
  const draftFacts = $derived(packagingFacts(draftUom, totalQty));
  const bottle = vesselShape('bottle');

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
          consumptionUom: draftUom.consumptionUom,
          unitsPerStockUom: draftUom.unitsPerStockUom,
          subunitsPerStockUom: draftUom.subunitsPerStockUom,
          diagramEnabled: mode === 'count' ? false : editDiagramEnabled,
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

  {#snippet packagingCard(
    u: UomConvertible,
    unitSvg: string | null,
    subunitSvg: string | null,
    title: string,
  )}
    {@const f = packagingFacts(u, totalQty)}
    {@const usage = u.consumptionUom ?? u.uom}
    <div class="card">
      <div class="card-h">{title}</div>
      <div class="pack-row">
        {#if f.drawable}
          <div class="pack-block">
            <UnitDiagram shape={unitSvg} count={f.pieces} filled={f.diagramFill} />
            <span class="pack-caption">
              {m.stock_packaging_full_units({ count: f.wholePackages })}
              {#if f.openPieces > 0}&nbsp;+ {fmt(f.openPieces)}/{fmt(f.pieces)}{/if}
            </span>
          </div>
        {/if}
        <div class="pack-block">
          <ConsumptionGauge
            readonly
            max={f.gaugeMax}
            value={f.gaugeMax}
            unit={usage}
            shape={subunitSvg}
          />
          {#if f.pieces >= 1}
            <span class="pack-caption"
              >{m.stock_packaging_per_subunit({ qty: fmt(f.gaugeMax), unit: usage })}</span
            >
          {/if}
        </div>
        <div class="pack-sums">
          <span class="pack-chip"
            >{m.stock_packaging_on_hand({ qty: fmt(totalQty), uom: u.uom })}</span
          >
          {#if f.pieces >= 1}
            <span class="pack-chip"
              >{m.stock_packaging_subunits({ count: fmt(f.onHandPieces) })}</span
            >
          {/if}
          {#if f.perPackage > 0 && u.consumptionUom}
            <span class="pack-chip"
              >{m.stock_packaging_consumption({
                qty: fmt(f.onHandUsage),
                unit: u.consumptionUom,
              })}</span
            >
          {/if}
        </div>
      </div>
    </div>
  {/snippet}

  {#snippet bottleIcon(cls: string)}
    <svg viewBox={`0 0 ${VESSEL_VIEWBOX.w} ${VESSEL_VIEWBOX.h}`} class={cls} aria-hidden="true">
      <path d={bottle.body} class="ico-body" />
    </svg>
  {/snippet}

  <div class="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4 edit-wrap">
    {#if editing}
      <div class="edit-layout">
        <div class="edit-main">
          <div class="card">
            <div class="card-h">{m.stock_pk_basics_title()}</div>
            <div class="field-grid">
              <div class="span-2">
                <Input size="sm" label={m.stock_field_name()} bind:value={editName} />
              </div>
              <Input
                size="sm"
                type="number"
                min="0"
                step="0.01"
                label={m.stock_col_reorder_level()}
                bind:value={editReorderLevel}
              >
                {#snippet trailing()}<span class="adorn">{previewUom}</span>{/snippet}
              </Input>
              <Input
                size="sm"
                type="number"
                min="0"
                step="0.01"
                label={m.stock_col_reorder_qty()}
                bind:value={editReorderQty}
              >
                {#snippet trailing()}<span class="adorn">{previewUom}</span>{/snippet}
              </Input>
            </div>
          </div>

          <!-- Supply side (#12): the stock module owns procurement facts. -->
          <div class="card">
            <div class="card-h">{m.stock_pk_supply_title()}</div>
            <div class="field-grid">
              <Input
                size="sm"
                type="number"
                min="0"
                step="any"
                label={m.stock_col_moq()}
                helper={m.stock_moq_hint({ uom: previewUom })}
                bind:value={editMoq}
              >
                {#snippet trailing()}<span class="adorn">{previewUom}</span>{/snippet}
              </Input>
              <div>
                <PartyPicker
                  bind:value={editSupplierPartyId}
                  label={m.stock_field_default_supplier()}
                  initialName={item.defaultSupplierName ?? ''}
                />
                <p class="t-caption stage-hint">{m.stock_field_default_supplier_hint()}</p>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-h">{m.stock_uom_section_title()}</div>

            <!-- Packaging mode as a picture choice: the shape of the answer is
                 what people recognise, not the words "nested"/"bulk". -->
            <div class="mode-cards" role="group" aria-label={m.stock_pk_mode_legend()}>
              <Button
                type="button"
                aria-pressed={mode === 'pieces'}
                class="mode-card {mode === 'pieces' ? 'selected' : ''}"
                onclick={() => (mode = 'pieces')}
              >
                <UnitDiagram count={6} filled={6} class="mode-svg" />
                <span class="mode-title">{m.stock_pk_mode_pieces()}</span>
                <span class="mode-eg">{m.stock_pk_mode_pieces_eg()}</span>
              </Button>
              <Button
                type="button"
                aria-pressed={mode === 'bulk'}
                class="mode-card {mode === 'bulk' ? 'selected' : ''}"
                onclick={() => (mode = 'bulk')}
              >
                {@render bottleIcon('mode-svg tall')}
                <span class="mode-title">{m.stock_pk_mode_bulk()}</span>
                <span class="mode-eg">{m.stock_pk_mode_bulk_eg()}</span>
              </Button>
              <Button
                type="button"
                aria-pressed={mode === 'count'}
                class="mode-card {mode === 'count' ? 'selected' : ''}"
                onclick={() => (mode = 'count')}
              >
                <span class="mode-svg count"><Tally5 /></span>
                <span class="mode-title">{m.stock_pk_mode_count()}</span>
                <span class="mode-eg">{m.stock_pk_mode_count_eg()}</span>
              </Button>
            </div>

            <datalist id="uom-presets">
              {#each UOM_PRESETS as preset (preset)}<option value={preset}></option>{/each}
            </datalist>

            <!-- The supply chain as numbered steps, each proving itself with
                 its own preview: buy → open → use. -->
            <ol class="steps">
              <li class="step">
                <div class="step-body">
                  <div class="step-head">
                    <span class="step-n">1</span>
                    <span class="step-title">{m.stock_pk_step1_title()}</span>
                  </div>
                  <p class="t-caption stage-hint">
                    {mode === 'count' ? m.stock_pk_package_count_hint() : m.stock_pk_step1_hint()}
                  </p>
                  <Input
                    size="sm"
                    list="uom-presets"
                    label={m.stock_pk_package()}
                    placeholder={m.stock_pk_package_ph()}
                    bind:value={editUom}
                  />
                  {#if mode === 'pieces'}
                    <ShapePicker
                      kind="container"
                      bind:value={editUnitSvg}
                      label={m.stock_pk_package_shape()}
                    />
                  {/if}
                </div>
                <div class="step-preview">
                  {#if mode === 'pieces'}
                    <UnitDiagram shape={editUnitSvg} count={0} />
                  {:else if mode === 'bulk'}
                    {@render bottleIcon('step-bottle')}
                  {:else}
                    <span class="step-count"><Tally5 /></span>
                  {/if}
                  <span class="pack-caption">1 {previewUom}</span>
                </div>
              </li>

              {#if mode === 'pieces'}
                <li class="step">
                  <div class="step-body">
                    <div class="step-head">
                      <span class="step-n">2</span>
                      <span class="step-title">{m.stock_pk_step2_title()}</span>
                    </div>
                    <p class="t-caption stage-hint">{m.stock_pk_step2_hint({ uom: previewUom })}</p>
                    <Input
                      size="sm"
                      type="number"
                      min="1"
                      step="1"
                      label={m.stock_pk_pieces_per({ uom: previewUom })}
                      error={piecesError}
                      bind:value={editSubunitsPerStockUom}
                      oninput={typeTotal ? syncFromTotal : syncFromFactors}
                    />
                    <ShapePicker
                      kind="vessel"
                      bind:value={editSubunitSvg}
                      label={m.stock_pk_piece_shape()}
                    />
                  </div>
                  <div class="step-preview">
                    {#if draftFacts.drawable}
                      <UnitDiagram shape={editUnitSvg} count={editPieces} filled={editPieces} />
                      <span class="pack-caption"
                        >{m.stock_pk_fact_pieces({ qty: String(editPieces) })}</span
                      >
                    {:else if editPieces > 0}
                      <UnitDiagram shape={editUnitSvg} count={0} />
                      <span class="pack-caption">{m.stock_pk_too_many({ count: editPieces })}</span>
                    {:else}
                      <UnitDiagram shape={editUnitSvg} count={0} />
                      <span class="pack-caption">?</span>
                    {/if}
                  </div>
                </li>
              {/if}

              {#if mode !== 'count'}
                <li class="step">
                  <div class="step-body">
                    <div class="step-head">
                      <span class="step-n">{mode === 'pieces' ? 3 : 2}</span>
                      <span class="step-title">{m.stock_pk_step3_title()}</span>
                    </div>
                    <p class="t-caption stage-hint">{m.stock_pk_step3_hint()}</p>
                    <div class="field-grid">
                      <Input
                        size="sm"
                        list="uom-presets"
                        label={m.stock_pk_usage_unit()}
                        placeholder={m.stock_pk_usage_unit_ph()}
                        bind:value={editConsumptionUom}
                      />
                      {#if mode === 'bulk' || typeTotal}
                        <Input
                          size="sm"
                          type="number"
                          min="0"
                          step="any"
                          inputmode="decimal"
                          label={m.stock_pk_per_package({ uom: previewUom })}
                          bind:value={editUnitsPerStockUom}
                          oninput={syncFromTotal}
                        >
                          {#snippet trailing()}<span class="adorn">{editConsumptionUom}</span
                            >{/snippet}
                        </Input>
                      {:else}
                        <Input
                          size="sm"
                          type="number"
                          min="0"
                          step="any"
                          inputmode="decimal"
                          label={m.stock_pk_per_piece()}
                          bind:value={editPerPiece}
                          oninput={syncFromFactors}
                        >
                          {#snippet trailing()}<span class="adorn">{editConsumptionUom}</span
                            >{/snippet}
                        </Input>
                      {/if}
                    </div>
                    {#if mode === 'pieces'}
                      <p class="total-line" class:ok={draftComplete}>
                        {#if draftComplete}
                          {m.stock_pk_total_line({
                            uom: previewUom,
                            total: qty(Number(editUnitsPerStockUom)),
                            usageUom: editConsumptionUom,
                          })}
                        {:else}
                          {m.stock_uom_preview_pending()}
                        {/if}
                        <Button
                          variant="ghost"
                          size="xs"
                          class="link-btn"
                          onclick={() => (typeTotal = !typeTotal)}
                          >{typeTotal
                            ? m.stock_pk_edit_per_piece()
                            : m.stock_pk_edit_total()}</Button
                        >
                      </p>
                    {/if}
                    <Toggle
                      bind:checked={editDiagramEnabled}
                      size="sm"
                      disabled={draftFacts.gaugeMax <= 0}
                      label={m.stock_field_diagram_enabled()}
                      description={draftFacts.gaugeMax > 0
                        ? m.stock_field_diagram_enabled_hint()
                        : m.stock_uom_err_diagram_needs_conversion()}
                    />
                  </div>
                  <div class="step-preview">
                    <ConsumptionGauge
                      readonly
                      max={draftFacts.gaugeMax}
                      value={draftFacts.gaugeMax}
                      unit={editConsumptionUom}
                      shape={editSubunitSvg}
                    />
                  </div>
                </li>
              {/if}
            </ol>
          </div>
        </div>

        <!-- Live preview rail: the whole chain, plus what today's stock means
             in every tier — the numbers a buyer and a practitioner each read. -->
        <aside class="edit-rail">
          <div class="card rail-card">
            <div class="card-h">{m.stock_pk_preview_title()}</div>
            {#if draftComplete}
              <div class="rail-visual">
                {#if mode === 'pieces' && draftFacts.drawable}
                  <UnitDiagram
                    shape={editUnitSvg}
                    count={editPieces}
                    filled={editPieces}
                    class="rail-diagram"
                  />
                  <ArrowRight class="rail-arrow" />
                {/if}
                <ConsumptionGauge
                  readonly
                  max={draftFacts.gaugeMax}
                  value={draftFacts.gaugeMax}
                  unit={editConsumptionUom}
                  shape={editSubunitSvg}
                />
              </div>
            {/if}
            <p class="uom-preview" class:ok={draftComplete || mode === 'count'} aria-live="polite">
              {equation}
            </p>
            <dl class="facts">
              <dt>{m.stock_pk_fact_on_hand()}</dt>
              <dd>
                {fmt(totalQty)}
                {previewUom}
                {#if draftFacts.pieces > 0}
                  <span class="fact-sub"
                    >= {m.stock_pk_fact_pieces({ qty: fmt(draftFacts.onHandPieces) })}</span
                  >
                {/if}
                {#if draftFacts.perPackage > 0 && editConsumptionUom}
                  <span class="fact-sub">= {fmt(draftFacts.onHandUsage)} {editConsumptionUom}</span>
                {/if}
              </dd>
              <dt>{m.stock_pk_fact_reorder()}</dt>
              <dd>
                {#if editReorderLevel !== ''}
                  {fmt(editReorderLevel)}
                  {previewUom}
                  {#if draftFacts.perPackage > 0 && editConsumptionUom}
                    <span class="fact-sub"
                      >= {fmt(Number(editReorderLevel) * draftFacts.perPackage)}
                      {editConsumptionUom}</span
                    >
                  {/if}
                {:else}{m.stock_pk_fact_none()}{/if}
              </dd>
              <dt>{m.stock_pk_fact_moq()}</dt>
              <dd>
                {#if editMoq !== ''}
                  {fmt(editMoq)}
                  {previewUom}
                  {#if draftFacts.pieces > 0}
                    <span class="fact-sub"
                      >= {m.stock_pk_fact_pieces({
                        qty: fmt(Number(editMoq) * draftFacts.pieces),
                      })}</span
                    >
                  {/if}
                {:else}{m.stock_pk_fact_none()}{/if}
              </dd>
            </dl>
            <ul class="where">
              {#if mode === 'pieces'}
                <li>
                  <span class="where-k">{m.stock_uom_stage_order()}</span>
                  {m.stock_pk_where_package()}
                </li>
              {/if}
              {#if mode !== 'count'}
                <li>
                  <span class="where-k">{m.stock_uom_stage_usage()}</span>
                  {editDiagramEnabled ? m.stock_pk_where_piece() : m.stock_pk_where_piece_off()}
                </li>
              {/if}
            </ul>
          </div>
        </aside>
      </div>

      <!-- Consolidated preview: the very card the item page shows after Save. -->
      {#if draftComplete}
        {@render packagingCard(draftUom, editUnitSvg, editSubunitSvg, m.stock_pk_summary_title())}
      {/if}

      {#if err}<p class="err-msg">{err}</p>{/if}
      <div class="flex gap-2">
        <Button variant="primary" size="sm" onclick={save} disabled={busy || !!piecesError}
          >{m.common_save()}</Button
        >
        <Button variant="outline" size="sm" onclick={() => (editing = false)}
          >{m.common_cancel()}</Button
        >
      </div>
    {:else}
      <div class="card">
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
          {#if savedFacts.gaugeMax > 0}
            <dt>{m.stock_field_diagram_enabled()}</dt>
            <dd>{item.diagramEnabled ? m.common_yes() : m.common_no()}</dd>
          {/if}
        </dl>
      </div>

      {#if savedFacts.gaugeMax > 0}
        {@render packagingCard(
          item,
          item.unitSvg ?? null,
          item.subunitSvg ?? null,
          m.stock_packaging_title(),
        )}
      {/if}
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
  /* ── Edit layout: form + sticky preview rail (stacks when narrow) ───── */
  .edit-wrap {
    container-type: inline-size;
    container-name: itemedit;
  }
  .edit-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
    align-items: start;
  }
  .edit-main {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
  }
  @container itemedit (min-width: 56rem) {
    .edit-layout {
      grid-template-columns: minmax(0, 1fr) 18rem;
    }
    .edit-rail {
      position: sticky;
      top: 0;
    }
  }
  .field-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .field-grid .span-2 {
    grid-column: 1 / -1;
  }
  @container itemedit (max-width: 36rem) {
    .field-grid {
      grid-template-columns: 1fr;
    }
  }
  .adorn {
    color: var(--color-text-tertiary);
    font-size: var(--font-size-caption);
  }
  .stage-hint {
    color: var(--color-text-tertiary);
  }
  /* ── Packaging mode cards (radio) ─────────────────────────────────── */
  .mode-cards {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }
  @container itemedit (max-width: 36rem) {
    .mode-cards {
      grid-template-columns: 1fr;
    }
  }
  /* Button slot trap: the primitive's inner row <span> needs its own rule. */
  .mode-cards :global(.mode-card) {
    height: auto;
    padding: var(--space-3);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    text-align: left;
    white-space: normal;
  }
  .mode-cards :global(.mode-card > span) {
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    gap: var(--space-1);
  }
  .mode-cards :global(.mode-card:hover) {
    border-color: var(--color-border-strong);
  }
  .mode-cards :global(.mode-card.selected) {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 10%, var(--color-surface-2));
  }
  .mode-cards :global(.mode-card.selected .mode-title) {
    color: var(--color-accent);
  }
  .mode-cards :global(.mode-svg) {
    width: 2.75rem;
    height: 2.5rem;
    margin-bottom: var(--space-1);
  }
  .mode-cards :global(.mode-svg.tall) {
    width: 1.25rem;
  }
  .mode-cards :global(.mode-svg.count) {
    display: inline-flex;
    align-items: center;
    color: var(--color-text-secondary);
  }
  .mode-cards :global(.mode-svg.count svg) {
    width: 1.75rem;
    height: 1.75rem;
  }
  .mode-title {
    font-weight: var(--font-weight-medium);
    color: var(--color-text-primary);
  }
  .mode-eg {
    font-size: var(--font-size-caption);
    color: var(--color-text-tertiary);
  }
  .ico-body {
    fill: color-mix(in srgb, var(--color-accent) 25%, var(--color-surface-3));
    stroke: var(--color-text-secondary);
    stroke-width: 3;
  }
  /* ── Steps: fields on the left, that step's own preview on the right ── */
  .steps {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .step {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 8rem;
    gap: var(--space-4);
    padding-top: var(--space-4);
    border-top: 1px solid var(--hairline);
  }
  @container itemedit (max-width: 36rem) {
    .step {
      grid-template-columns: 1fr;
    }
  }
  .step-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }
  .step-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .step-n {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: var(--radius-full);
    background: var(--color-accent);
    color: var(--color-on-accent);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-medium);
  }
  .step-title {
    font-weight: var(--font-weight-medium);
    color: var(--color-text-primary);
  }
  .step-body > .stage-hint {
    margin-top: calc(-1 * var(--space-2));
  }
  .step-preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    min-height: 8rem;
  }
  .step-preview :global(.step-bottle) {
    width: 2.75rem;
    height: 6rem;
  }
  .step-count {
    color: var(--color-text-secondary);
  }
  .step-count :global(svg) {
    width: 2.25rem;
    height: 2.25rem;
  }
  .total-line {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
    font-size: var(--font-size-body);
    font-variant-numeric: tabular-nums;
    color: var(--color-text-tertiary);
  }
  .total-line.ok {
    color: var(--color-text-primary);
  }
  .total-line :global(.link-btn) {
    height: auto;
    min-height: 0;
    padding: 0;
    color: var(--color-accent);
  }
  /* ── Preview rail ─────────────────────────────────────────────────── */
  .rail-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .rail-visual {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
  }
  .rail-visual :global(.rail-diagram) {
    width: 5.5rem;
  }
  .rail-visual :global(.rail-arrow) {
    width: 0.875rem;
    height: 0.875rem;
    color: var(--color-text-tertiary);
    flex-shrink: 0;
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
  .facts {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--space-1) var(--space-3);
    margin: 0;
    font-size: var(--font-size-caption);
  }
  .facts dt {
    color: var(--color-text-tertiary);
  }
  .facts dd {
    margin: 0;
    display: flex;
    flex-direction: column;
    font-variant-numeric: tabular-nums;
    color: var(--color-text-primary);
  }
  .fact-sub {
    color: var(--color-text-secondary);
  }
  .where {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--font-size-caption);
    color: var(--color-text-tertiary);
  }
  .where-k {
    display: inline-block;
    margin-right: var(--space-1);
    padding: 0 var(--space-1);
    border-radius: var(--radius-xs);
    background: var(--color-surface-3);
    color: var(--color-text-secondary);
  }
  /* ── Packaging card (view mode + consolidated summary) ────────────── */
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
