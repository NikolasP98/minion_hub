<script lang="ts">
  import type { PageData } from './$types';
  import { goto, invalidate } from '$app/navigation';
  import * as m from '$lib/paraglide/messages';
  import { createHotkey } from '$lib/hotkeys';
  import { Package, ArrowLeft, ExternalLink } from 'lucide-svelte';
  import { PageHeader, Button, Toggle } from '$lib/components/ui';
  import { canAct } from '$lib/access/can.svelte';
  import { UOM_PRESETS, gaugeMax, type UomConvertible } from '$lib/components/stock/stock-ui';
  import { MAX_MARKERS } from '$lib/components/stock/stock-svg';
  import ConsumptionGauge from '$lib/components/stock/ConsumptionGauge.svelte';
  import UnitDiagram from '$lib/components/stock/UnitDiagram.svelte';
  import ShapePicker from '$lib/components/stock/ShapePicker.svelte';

  let { data }: { data: PageData } = $props();
  // ponytail: backend contract fields (consumptionUom/unitsPerStockUom/subunitsPerStockUom/
  // diagramEnabled) are landing via a parallel migration — intersect optionally so this
  // page compiles against the contract before the columns exist server-side.
  type ItemUom = PageData['item'] & Partial<UomConvertible> & { diagramEnabled?: boolean; unitSvg?: string | null; subunitSvg?: string | null };
  const item = $derived(data.item as ItemUom);

  let editing = $state(false);
  let editName = $state('');
  let editReorderLevel = $state('');
  let editReorderQty = $state('');
  let editUom = $state('');
  let editConsumptionUom = $state('');
  let editUnitsPerStockUom = $state('');
  let editSubunitsPerStockUom = $state('');
  let editDiagramEnabled = $state(false);
  let editUnitSvg = $state<string | null>(null);
  let editSubunitSvg = $state<string | null>(null);
  let busy = $state(false);
  let err = $state<string | null>(null);

  function startEdit() {
    editName = item.name;
    editReorderLevel = item.reorderLevel ?? '';
    editReorderQty = item.reorderQty ?? '';
    editUom = item.uom;
    editConsumptionUom = item.consumptionUom ?? '';
    editUnitsPerStockUom = item.unitsPerStockUom != null ? String(item.unitsPerStockUom) : '';
    editSubunitsPerStockUom = item.subunitsPerStockUom != null ? String(item.subunitsPerStockUom) : '';
    editDiagramEnabled = item.diagramEnabled ?? false;
    editUnitSvg = item.unitSvg ?? null;
    editSubunitSvg = item.subunitSvg ?? null;
    err = null;
    editing = true;
  }

  // Caption preview computed live from the edit-form fields (not yet-saved item).
  const captionUom = $derived<UomConvertible>({
    uom: editUom,
    consumptionUom: editConsumptionUom || null,
    unitsPerStockUom: editUnitsPerStockUom !== '' ? Number(editUnitsPerStockUom) : null,
    subunitsPerStockUom: editSubunitsPerStockUom !== '' ? Number(editSubunitsPerStockUom) : null,
  });
  const uomCaption = $derived.by(() => {
    if (!captionUom.consumptionUom || !captionUom.unitsPerStockUom) return null;
    const units = captionUom.unitsPerStockUom;
    const subunits = captionUom.subunitsPerStockUom;
    if (subunits) {
      const perSubunit = Number(units) / Number(subunits);
      return m.stock_uom_caption_subunits({ uom: captionUom.uom, units, consumptionUom: captionUom.consumptionUom, subunits, perSubunit });
    }
    return m.stock_uom_caption_simple({ uom: captionUom.uom, units, consumptionUom: captionUom.consumptionUom });
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
  const diagramFill = $derived(fracSubunits > 0 ? fracSubunits : wholeUnits > 0 ? subunitsCount : 0);
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
          uom: editUom,
          consumptionUom: editConsumptionUom || null,
          unitsPerStockUom: editUnitsPerStockUom !== '' ? Number(editUnitsPerStockUom) : null,
          subunitsPerStockUom: editSubunitsPerStockUom !== '' ? Number(editSubunitsPerStockUom) : null,
          diagramEnabled: editDiagramEnabled,
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

  const fmt = (n: string | number) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

  // [ / ] prev/next through the ordered item list (clamped at the ends —
  // simpler than wraparound). Off while editing so a stray bracket keystroke
  // can't navigate away from unsaved changes.
  const itemIndex = $derived(data.itemIds.indexOf(item.id));
  createHotkey('[', () => {
    if (itemIndex > 0) goto(`/stock/items/${data.itemIds[itemIndex - 1]}`);
  }, () => ({
    enabled: !editing,
    meta: { name: m.shortcuts_stockPrevItem() },
  }));
  createHotkey(']', () => {
    if (itemIndex >= 0 && itemIndex < data.itemIds.length - 1) goto(`/stock/items/${data.itemIds[itemIndex + 1]}`);
  }, () => ({
    enabled: !editing,
    meta: { name: m.shortcuts_stockNextItem() },
  }));
</script>

<svelte:head><title>{item.name} — {m.nav_stock()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
  <PageHeader title={item.name} subtitle={item.code}>
    {#snippet leading()}<Package size={16} class="text-accent shrink-0" />{/snippet}
    {#snippet actions()}
      <Button variant="outline" size="sm" onclick={() => history.back()}><ArrowLeft size={14} /> {m.common_back()}</Button>
      {#if !editing}
        <Button
          variant="outline"
          size="sm"
          onclick={startEdit}
          disabled={!canAct('stock', 'edit')}
          title={canAct('stock', 'edit') ? undefined : m.no_permission()}
        >{m.common_edit()}</Button>
      {/if}
    {/snippet}
  </PageHeader>

  <div class="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4">
    <div class="card">
      {#if editing}
        <div class="flex flex-col gap-3 max-w-md">
          <label class="fld"><span>{m.stock_field_name()}</span><input class="inp" bind:value={editName} /></label>
          <label class="fld"><span>{m.stock_col_reorder_level()}</span><input class="inp" type="number" min="0" step="0.01" bind:value={editReorderLevel} /></label>
          <label class="fld"><span>{m.stock_col_reorder_qty()}</span><input class="inp" type="number" min="0" step="0.01" bind:value={editReorderQty} /></label>

          <div class="uom-section">
            <div class="card-h">{m.stock_uom_section_title()}</div>
            <div class="uom-grid">
              <label class="fld">
                <span>{m.stock_field_stock_uom()}</span>
                <input class="inp" list="uom-presets" bind:value={editUom} />
              </label>
              <label class="fld">
                <span>{m.stock_field_consumption_uom()}</span>
                <input class="inp" list="uom-presets" bind:value={editConsumptionUom} />
              </label>
              <label class="fld">
                <span>{m.stock_field_units_per_stock_uom()}</span>
                <input class="inp" type="number" min="0" step="0.01" placeholder={m.stock_field_units_per_stock_uom_hint()} bind:value={editUnitsPerStockUom} />
              </label>
              <label class="fld">
                <span>{m.stock_field_subunits_per_stock_uom()}</span>
                <input class="inp" type="number" min="0" step="1" placeholder={m.stock_field_subunits_per_stock_uom_hint()} bind:value={editSubunitsPerStockUom} />
              </label>
            </div>
            <datalist id="uom-presets">
              {#each UOM_PRESETS as preset (preset)}<option value={preset}></option>{/each}
            </datalist>
            <Toggle bind:checked={editDiagramEnabled} size="sm" label={m.stock_field_diagram_enabled()} description={m.stock_field_diagram_enabled_hint()} />
            {#if uomCaption}<p class="uom-caption">{uomCaption}</p>{/if}
            {#if editGaugeMax > 0}
              <ShapePicker kind="vessel" bind:value={editSubunitSvg} label={m.stock_field_subunit_svg()} />
            {/if}
            {#if editSubunits >= 1}
              <ShapePicker kind="container" bind:value={editUnitSvg} label={m.stock_field_unit_svg()} />
            {/if}
            {#if editGaugeMax > 0}
              <div class="pack-row">
                {#if editSubunits >= 1 && editSubunits <= MAX_MARKERS}
                  <UnitDiagram shape={editUnitSvg} count={editSubunits} filled={editSubunits} />
                {/if}
                <ConsumptionGauge readonly max={editGaugeMax} value={editGaugeMax} unit={editConsumptionUom} shape={editSubunitSvg} />
              </div>
            {/if}
          </div>

          {#if err}<p class="err-msg">{err}</p>{/if}
          <div class="flex gap-2">
            <Button variant="primary" size="sm" onclick={save} disabled={busy}>{m.common_save()}</Button>
            <Button variant="outline" size="sm" onclick={() => (editing = false)}>{m.common_cancel()}</Button>
          </div>
        </div>
      {:else}
        <dl class="meta-grid">
          <dt>{m.stock_col_uom()}</dt><dd>{item.uom}</dd>
          <dt>{m.stock_col_group()}</dt><dd>{item.itemGroup ?? '—'}</dd>
          <dt>{m.stock_col_reorder_level()}</dt><dd>{item.reorderLevel ?? '—'}</dd>
          <dt>{m.stock_col_reorder_qty()}</dt><dd>{item.reorderQty ?? '—'}</dd>
          {#if item.consumptionUom}
            <dt>{m.stock_field_consumption_uom()}</dt><dd>{item.consumptionUom}</dd>
          {/if}
          {#if displayGaugeMax > 0}
            <dt>{m.stock_field_diagram_enabled()}</dt><dd>{item.diagramEnabled ? m.common_yes() : m.common_no()}</dd>
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
            <ConsumptionGauge readonly max={displayGaugeMax} value={displayGaugeMax} unit={item.consumptionUom ?? item.uom} shape={item.subunitSvg} />
            {#if subunitsCount >= 1}
              <span class="pack-caption">{m.stock_packaging_per_subunit({ qty: fmt(displayGaugeMax), unit: item.consumptionUom ?? item.uom })}</span>
            {/if}
          </div>
          <div class="pack-sums">
            <span class="pack-chip">{m.stock_packaging_on_hand({ qty: fmt(totalQty), uom: item.uom })}</span>
            {#if subunitsCount >= 1}
              <span class="pack-chip">{m.stock_packaging_subunits({ count: fmt(totalQty * subunitsCount) })}</span>
            {/if}
            {#if unitsPerUom > 0 && item.consumptionUom}
              <span class="pack-chip">{m.stock_packaging_consumption({ qty: fmt(totalQty * unitsPerUom), unit: item.consumptionUom })}</span>
            {/if}
          </div>
        </div>
      </div>
    {/if}

    <div class="card">
      <div class="card-h">{m.stock_item_bins_title()}</div>
      {#if data.bins.length === 0}
        <p class="t-caption">{m.stock_bins_empty()}</p>
      {:else}
        <table class="mini-table">
          <thead><tr><th>{m.stock_col_warehouse()}</th><th class="num">{m.stock_col_qty()}</th><th class="num">{m.stock_col_valuation_rate()}</th><th class="num">{m.stock_col_value()}</th></tr></thead>
          <tbody>
            {#each data.bins as b (b.warehouseId)}
              <tr>
                <td>{b.warehouseName}</td>
                <td class="num">{fmt(b.qty)}</td>
                <td class="num">{fmt(b.valuationRate)}</td>
                <td class="num">{fmt(Number(b.qty) * Number(b.valuationRate))}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>

    <div class="card">
      <div class="card-h">{m.stock_item_ledger_title()}</div>
      {#if data.ledger.length === 0}
        <p class="t-caption">{m.stock_ledger_empty()}</p>
      {:else}
        <table class="mini-table">
          <thead>
            <tr>
              <th>{m.stock_col_posted_at()}</th>
              <th>{m.stock_col_warehouse()}</th>
              <th class="num">{m.stock_col_delta()}</th>
              <th class="num">{m.stock_col_qty_after()}</th>
              <th class="num">{m.stock_col_valuation_rate()}</th>
            </tr>
          </thead>
          <tbody>
            {#each data.ledger as l (l.id)}
              <tr>
                <td class="t-caption">{new Date(l.postedAt).toLocaleString()}</td>
                <td>{l.warehouseName}</td>
                <td class="num" class:in={Number(l.qtyDelta) > 0} class:out={Number(l.qtyDelta) < 0}>
                  {Number(l.qtyDelta) > 0 ? '+' : ''}{fmt(l.qtyDelta)}
                </td>
                <td class="num">{fmt(l.qtyAfter)}</td>
                <td class="num">{fmt(l.valuationRate)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>

    <div class="card">
      <div class="card-h">{m.stock_item_consumed_by_title()}</div>
      {#if data.consumedBy.length === 0}
        <p class="t-caption">{m.stock_item_consumed_by_empty()}</p>
      {:else}
        <table class="mini-table">
          <thead><tr><th>{m.stock_col_product()}</th><th class="num">{m.stock_consumption_col_qty_per_unit()}</th><th>{m.stock_field_note()}</th></tr></thead>
          <tbody>
            {#each data.consumedBy as c (c.id)}
              <tr>
                <td>{c.productCode} — {c.productName}</td>
                <td class="num">{fmt(c.qtyPerUnit)}</td>
                <td class="t-caption">{c.note ?? '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        <a class="consumed-link" href="/stock/consumption">{m.stock_item_manage_consumption()} <ExternalLink size={12} /></a>
      {/if}
    </div>
  </div>
</div>

<style>
  .card { border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); padding: 0.85rem 1rem; }
  .card-h { font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: var(--color-muted-foreground); margin-bottom: 0.7rem; }
  .meta-grid { display: grid; grid-template-columns: max-content 1fr; gap: 0.35rem 1rem; font-size: 0.86rem; }
  .meta-grid dt { color: var(--color-muted-foreground); }
  .fld { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.78rem; color: var(--color-muted-foreground); }
  .inp { height: 1.75rem; padding: 0 0.5rem; font-size: 0.82rem; border-radius: var(--radius-sm); background: var(--color-bg3); border: 1px solid var(--hairline); color: var(--color-foreground); }
  .err-msg { font-size: 0.8rem; color: var(--color-destructive); }
  .uom-section { display: flex; flex-direction: column; gap: 0.6rem; padding-top: 0.6rem; border-top: 1px solid var(--hairline); }
  .uom-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
  .uom-caption { font-size: 0.78rem; color: var(--color-accent); font-style: italic; }
  .pack-row { display: flex; align-items: flex-end; gap: 1.5rem; flex-wrap: wrap; }
  .pack-block { display: flex; flex-direction: column; align-items: center; gap: 0.35rem; }
  .pack-caption { font-size: 0.7rem; color: var(--color-muted-foreground); text-align: center; }
  .pack-sums { display: flex; flex-direction: column; gap: 0.35rem; align-self: center; }
  .pack-chip { font-size: 0.8rem; padding: 0.2rem 0.55rem; border: 1px solid var(--hairline); border-radius: var(--radius-sm); background: var(--color-bg3); width: fit-content; font-variant-numeric: tabular-nums; }
  .mini-table { width: 100%; font-size: 0.82rem; border-collapse: collapse; }
  .mini-table th { text-align: left; font-weight: 500; color: var(--color-muted-foreground); padding: 0.3rem 0.5rem; border-bottom: 1px solid var(--hairline); }
  .mini-table td { padding: 0.3rem 0.5rem; border-bottom: 1px solid var(--hairline); }
  .mini-table .num { text-align: right; font-variant-numeric: tabular-nums; }
  .mini-table .in { color: var(--color-success, var(--color-emerald)); }
  .mini-table .out { color: var(--color-destructive); }
  .consumed-link { display: inline-flex; align-items: center; gap: 0.3rem; margin-top: 0.6rem; font-size: 0.78rem; color: var(--color-accent); }
  .consumed-link:hover { text-decoration: underline; }
</style>
