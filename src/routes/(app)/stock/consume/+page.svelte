<script lang="ts">
  import type { PageData } from './$types';
  import { goto } from '$app/navigation';
  import * as m from '$lib/paraglide/messages';
  import { Boxes, Check, Trash2 } from 'lucide-svelte';
  import { PageHeader, Button, Combobox } from '$lib/components/ui';
  import PartyPicker from '$lib/components/crm/PartyPicker.svelte';
  import ConsumptionGauge from '$lib/components/stock/ConsumptionGauge.svelte';
  import { gaugeMax } from '$lib/components/stock/stock-ui';
  import { canAct } from '$lib/access/can.svelte';

  let { data }: { data: PageData } = $props();

  // Server preview lines already carry every UOM field the gauge needs.
  type PreviewLine = {
    itemId: string;
    itemName: string;
    itemCode: string;
    uom: string;
    qty: number;
    available: number;
    qtyConsumption: number;
    consumptionUom: string | null;
    unitsPerStockUom: number | null;
    subunitsPerStockUom: number | null;
    diagramEnabled: boolean;
  };

  let serviceId = $state('');
  let quantity = $state('1');
  let warehouseId = $state('');
  let partyId = $state<string | null>(null);
  let note = $state('');

  let lines = $state<PreviewLine[]>([]);
  let hasMapping = $state(true);
  let previewed = $state(false);
  let previewBusy = $state(false);
  let busy = $state(false);
  let err = $state<string | null>(null);

  const canCreate = $derived(canAct('stock', 'create'));
  const qtyNum = $derived(Number(quantity) > 0 ? Number(quantity) : 1);
  const canPreview = $derived(serviceId !== '' && warehouseId !== '' && !previewBusy);
  const fmtQty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });

  function lineGaugeMax(l: PreviewLine): number {
    return l.diagramEnabled ? gaugeMax({ uom: l.uom, unitsPerStockUom: l.unitsPerStockUom, subunitsPerStockUom: l.subunitsPerStockUom }) : 0;
  }
  // Drag/keyboard on the gauge edits the CONSUMPTION qty; the stock-uom qty
  // follows via the server-owned conversion factor (units_per_stock_uom).
  function setLineConsumption(l: PreviewLine, qtyConsumption: number) {
    l.qtyConsumption = qtyConsumption;
    if (l.unitsPerStockUom) l.qty = qtyConsumption / Number(l.unitsPerStockUom);
  }
  function removeLine(i: number) {
    lines = lines.filter((_, idx) => idx !== i);
  }

  async function errMessage(res: Response): Promise<string> {
    try {
      const body = await res.json();
      return body?.message ?? m.stock_create_failed();
    } catch {
      return m.stock_create_failed();
    }
  }

  async function preview() {
    if (!canPreview) return;
    previewBusy = true;
    err = null;
    try {
      const res = await fetch('/api/stock/entries/from-service', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ finProductId: serviceId, quantity: qtyNum, warehouseId, preview: true }),
      });
      if (res.ok) {
        const { preview } = await res.json();
        lines = preview.lines;
        hasMapping = preview.hasMapping;
        previewed = true;
      } else {
        err = await errMessage(res);
      }
    } finally {
      previewBusy = false;
    }
  }

  function payload(submit: boolean) {
    return {
      finProductId: serviceId,
      quantity: qtyNum,
      warehouseId,
      partyId,
      note: note || null,
      submit,
      lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty, qtyConsumption: l.qtyConsumption ?? null })),
    };
  }

  async function save(submit: boolean) {
    if (!lines.length) return;
    busy = true;
    err = null;
    try {
      const res = await fetch('/api/stock/entries/from-service', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload(submit)),
      });
      if (res.ok) {
        const entry = await res.json();
        await goto(`/stock/entries/${entry.id}`);
      } else {
        err = await errMessage(res);
      }
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>{m.stock_consume_title()} — {m.nav_stock()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
  <PageHeader title={m.stock_consume_title()}>
    {#snippet leading()}<Boxes size={16} class="text-accent shrink-0" />{/snippet}
  </PageHeader>

  <div class="flex-1 min-h-0 overflow-auto p-4">
    <div class="w-full max-w-2xl mx-auto flex flex-col gap-4">
      <p class="t-caption">{m.stock_consume_hint()}</p>

      <div class="card flex flex-col gap-3">
        <label class="fld">
          <span>{m.stock_consume_service()}</span>
          <Combobox
            id="consume-service"
            items={data.services}
            itemToValue={(s) => s.id}
            itemToString={(s) => (s.code ? `${s.code} — ${s.name}` : s.name)}
            placeholder={m.stock_consume_service_ph()}
            bind:value={serviceId}
          />
        </label>

        <div class="grid grid-cols-2 gap-3">
          <label class="fld">
            <span>{m.stock_consume_quantity()}</span>
            <input class="inp" type="number" min="1" step="1" bind:value={quantity} />
          </label>
          <label class="fld">
            <span>{m.stock_field_warehouse()}</span>
            <Combobox
              id="consume-warehouse"
              items={data.warehouses}
              itemToValue={(w) => w.id}
              itemToString={(w) => w.name}
              placeholder={m.stock_field_warehouse()}
              bind:value={warehouseId}
            />
          </label>
        </div>

        <PartyPicker bind:value={partyId} label={m.stock_consume_customer()} types="person,company" />

        <label class="fld">
          <span>{m.stock_consume_notes()}</span>
          <textarea class="inp" rows="2" placeholder={m.stock_consume_notes_ph()} bind:value={note}></textarea>
        </label>

        <div class="flex justify-end">
          <Button variant="outline" size="sm" onclick={preview} disabled={!canPreview}>{m.stock_consume_preview()}</Button>
        </div>
      </div>

      {#if previewed}
        <div class="card flex flex-col gap-3">
          <div class="card-h">{m.stock_consume_consumed()}</div>

          {#if !hasMapping}
            <p class="t-caption">{m.stock_consume_no_mapping()}</p>
          {:else if lines.length === 0}
            <p class="t-caption">{m.stock_lines_empty()}</p>
          {:else}
            <div class="lines">
              {#each lines as l, i (l.itemId)}
                {@const gMax = lineGaugeMax(l)}
                <div class="line">
                  <div class="line-main">
                    <div class="line-id">
                      <span class="line-name">{l.itemName}</span>
                      <span class="line-code">{l.itemCode}</span>
                    </div>
                    <div class="line-qty">
                      <input
                        class="inp qty-inp"
                        type="number"
                        min="0"
                        step="0.0001"
                        value={l.qtyConsumption ?? l.qty}
                        oninput={(e) => setLineConsumption(l, Number((e.currentTarget as HTMLInputElement).value))}
                      />
                      <span class="qty-uom">{l.consumptionUom ?? l.uom}</span>
                      <button class="rm-btn" title={m.common_remove()} onclick={() => removeLine(i)}><Trash2 size={13} /></button>
                    </div>
                  </div>
                  {#if gMax > 0}
                    <div class="gauge-wrap">
                      <ConsumptionGauge
                        max={gMax}
                        unit={l.consumptionUom ?? l.uom}
                        bind:value={() => l.qtyConsumption ?? 0, (v) => setLineConsumption(l, v)}
                      />
                      <span class="gauge-cap">
                        {m.stock_consume_stock_qty({ qty: fmtQty(l.qty), uom: l.uom })}
                      </span>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}

          {#if err}<p class="err-msg">{err}</p>{/if}
          {#if lines.length > 0}
            <div class="flex justify-end gap-2">
              <Button variant="outline" size="sm" onclick={() => save(false)} disabled={busy || !canCreate} title={canCreate ? undefined : m.no_permission()}>{m.stock_save_draft()}</Button>
              <Button variant="primary" size="sm" onclick={() => save(true)} disabled={busy || !canCreate} title={canCreate ? undefined : m.no_permission()}>
                <Check size={14} /> {m.stock_submit()}
              </Button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .card { border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); padding: var(--space-4); }
  .card-h { font-size: var(--font-size-body); font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: var(--color-muted-foreground); }
  .fld { display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--font-size-body); color: var(--color-muted-foreground); }
  .inp { min-height: 2rem; padding: var(--space-2) var(--space-2); font-size: var(--font-size-body); border-radius: var(--radius-sm); background: var(--color-bg3); border: 1px solid var(--hairline); color: var(--color-foreground); font-family: inherit; }
  .lines { display: flex; flex-direction: column; gap: var(--space-3); }
  .line { display: flex; gap: var(--space-4); align-items: flex-start; justify-content: space-between; padding: var(--space-2); border: 1px solid var(--hairline); border-radius: var(--radius-md); }
  .line-main { flex: 1; display: flex; flex-direction: column; gap: var(--space-2); }
  .line-id { display: flex; flex-direction: column; }
  .line-name { font-size: var(--font-size-page-title); color: var(--color-foreground); }
  .line-code { font-size: var(--font-size-caption); color: var(--color-muted-foreground); font-variant-numeric: tabular-nums; }
  .line-qty { display: flex; align-items: center; gap: var(--space-2); }
  .qty-inp { width: 6rem; text-align: right; font-variant-numeric: tabular-nums; }
  .qty-uom { font-size: var(--font-size-body); color: var(--color-muted-foreground); }
  .rm-btn { background: none; border: none; color: var(--color-muted-foreground); cursor: pointer; }
  .rm-btn:hover { color: var(--color-destructive); }
  .gauge-wrap { display: flex; flex-direction: column; align-items: center; gap: var(--space-1); }
  .gauge-cap { font-size: var(--font-size-caption); color: var(--color-muted-foreground); text-align: center; }
  .err-msg { font-size: var(--font-size-body); color: var(--color-destructive); }
</style>
