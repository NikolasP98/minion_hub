<script lang="ts">
  import type { PageData } from './$types';
  import { goto } from '$lib/navigation';
  import * as m from '$lib/paraglide/messages';
  import { ArrowLeftRight, Check, ArrowLeft, Trash2 } from 'lucide-svelte';
  import { PageHeader, Button, Combobox } from '$lib/components/ui';
  import PartyPicker from '$lib/components/crm/PartyPicker.svelte';

  let { data }: { data: PageData } = $props();

  type EntryType = 'receipt' | 'issue' | 'transfer' | 'adjustment';
  type Step = 'type' | 'lines' | 'review';

  let step = $state<Step>('type');
  let type = $state<EntryType>('receipt');
  let partyId = $state<string | null>(null);
  let note = $state('');

  type Line = {
    itemId: string;
    qty: string;
    rate: string;
    fromWarehouseId: string;
    toWarehouseId: string;
  };
  let lines = $state<Line[]>([]);

  // ── Line draft form (shape depends on the chosen type) ─────────────────────
  let draftItemId = $state('');
  let draftQty = $state('');
  let draftRate = $state('');
  let draftFromWarehouseId = $state('');
  let draftToWarehouseId = $state('');

  const needsFrom = $derived(type === 'issue' || type === 'transfer' || type === 'adjustment');
  const needsTo = $derived(type === 'receipt' || type === 'transfer' || type === 'adjustment');
  const needsRate = $derived(type === 'receipt');

  const itemById = $derived(new Map(data.items.map((i) => [i.id, i])));
  const warehouseById = $derived(new Map(data.warehouses.map((w) => [w.id, w])));

  function itemLabel(id: string): string {
    const it = itemById.get(id);
    return it ? `${it.code} — ${it.name}` : id;
  }
  function warehouseLabel(id: string): string {
    return warehouseById.get(id)?.name ?? id;
  }

  const draftValid = $derived(
    draftItemId !== '' &&
      Number(draftQty) > 0 &&
      (!needsFrom || draftFromWarehouseId !== '') &&
      (!needsTo || draftToWarehouseId !== '') &&
      (type !== 'adjustment' || (draftFromWarehouseId !== '') !== (draftToWarehouseId !== '')) && // exactly one
      (!needsRate || draftRate !== ''),
  );

  function addLine() {
    if (!draftValid) return;
    lines = [
      ...lines,
      {
        itemId: draftItemId,
        qty: draftQty,
        rate: draftRate,
        fromWarehouseId: needsFrom ? draftFromWarehouseId : '',
        toWarehouseId: needsTo ? draftToWarehouseId : '',
      },
    ];
    draftItemId = '';
    draftQty = '';
    draftRate = '';
    draftFromWarehouseId = '';
    draftToWarehouseId = '';
  }
  function removeLine(i: number) {
    lines = lines.filter((_, idx) => idx !== i);
  }

  function payload() {
    return {
      type,
      partyId,
      note: note || null,
      lines: lines.map((l) => ({
        itemId: l.itemId,
        qty: Number(l.qty),
        rate: l.rate !== '' ? Number(l.rate) : null,
        fromWarehouseId: l.fromWarehouseId || null,
        toWarehouseId: l.toWarehouseId || null,
      })),
    };
  }

  let busy = $state(false);
  let err = $state<string | null>(null);

  async function errMessage(res: Response): Promise<string> {
    try {
      const body = await res.json();
      return body?.message ?? m.stock_create_failed();
    } catch {
      return m.stock_create_failed();
    }
  }

  async function saveDraft() {
    busy = true;
    err = null;
    try {
      const res = await fetch('/api/stock/entries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload()),
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

  async function saveAndSubmit() {
    busy = true;
    err = null;
    try {
      const createRes = await fetch('/api/stock/entries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      if (!createRes.ok) {
        err = await errMessage(createRes);
        return;
      }
      const entry = await createRes.json();
      const submitRes = await fetch(`/api/stock/entries/${entry.id}/submit`, { method: 'POST' });
      if (!submitRes.ok) {
        err = await errMessage(submitRes);
        // Draft was created even though submit failed — send them to it so the
        // error isn't a dead end.
        await goto(`/stock/entries/${entry.id}`);
        return;
      }
      await goto(`/stock/entries/${entry.id}`);
    } finally {
      busy = false;
    }
  }

  const steps: Array<{ k: Step; label: string }> = [
    { k: 'type', label: m.stock_step_type() },
    { k: 'lines', label: m.stock_step_lines() },
    { k: 'review', label: m.stock_step_review() },
  ];
  const currentIdx = $derived(steps.findIndex((s) => s.k === step));
</script>

<svelte:head><title>{m.stock_new_entry_title()} — {m.nav_stock()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0 flex-1 min-w-0">
  <PageHeader title={m.stock_new_entry_title()}>
    {#snippet leading()}<ArrowLeftRight size={16} class="text-accent shrink-0" />{/snippet}
  </PageHeader>

  <div class="flex-1 min-h-0 overflow-auto p-4">
    <div class="w-full max-w-2xl mx-auto flex flex-col gap-4">
      <div class="stepper">
        {#each steps as s, i (s.k)}
          <div class="step" class:active={i === currentIdx} class:done={i < currentIdx}>
            <span class="dot">{#if i < currentIdx}<Check size={12} />{:else}{i + 1}{/if}</span>
            <span>{s.label}</span>
          </div>
        {/each}
      </div>

      {#if step === 'type'}
        <div class="card flex flex-col gap-3">
          <p class="t-caption">{m.stock_step_type_hint()}</p>
          <div class="type-grid">
            {#each ['receipt', 'issue', 'transfer', 'adjustment'] as t (t)}
              <Button
                variant="ghost"
                class="type-btn {type === t ? 'active' : ''}"
                onclick={() => (type = t as EntryType)}
              >
                {t === 'receipt' ? m.stock_type_receipt() : t === 'issue' ? m.stock_type_issue() : t === 'transfer' ? m.stock_type_transfer() : m.stock_type_adjustment()}
              </Button>
            {/each}
          </div>
          <PartyPicker bind:value={partyId} label={m.stock_field_party()} />
          <label class="fld">
            <span>{m.stock_field_note()}</span>
            <textarea class="inp" rows="2" bind:value={note}></textarea>
          </label>
          <div class="flex justify-end">
            <Button variant="primary" size="sm" onclick={() => (step = 'lines')}>{m.stock_next()}</Button>
          </div>
        </div>
      {:else if step === 'lines'}
        <div class="card flex flex-col gap-3">
          <div class="line-form">
            <Combobox
              id="stock-line-item"
              items={data.items}
              itemToValue={(i) => i.id}
              itemToString={(i) => `${i.code} — ${i.name}`}
              placeholder={m.stock_field_item()}
              bind:value={draftItemId}
            />
            <input class="inp" type="number" min="0" step="0.01" placeholder={m.stock_field_qty()} bind:value={draftQty} />
            {#if needsRate}
              <input class="inp" type="number" min="0" step="0.01" placeholder={m.stock_field_rate()} bind:value={draftRate} />
            {/if}
            {#if needsFrom}
              <Combobox
                id="stock-line-from"
                items={data.warehouses}
                itemToValue={(w) => w.id}
                itemToString={(w) => w.name}
                placeholder={m.stock_field_from_warehouse()}
                bind:value={draftFromWarehouseId}
              />
            {/if}
            {#if needsTo}
              <Combobox
                id="stock-line-to"
                items={data.warehouses}
                itemToValue={(w) => w.id}
                itemToString={(w) => w.name}
                placeholder={m.stock_field_to_warehouse()}
                bind:value={draftToWarehouseId}
              />
            {/if}
            <Button variant="outline" size="sm" onclick={addLine} disabled={!draftValid}>{m.stock_add_line()}</Button>
          </div>

          {#if lines.length === 0}
            <p class="t-caption">{m.stock_lines_empty()}</p>
          {:else}
            <table class="mini-table">
              <thead>
                <tr>
                  <th>{m.stock_field_item()}</th>
                  <th class="num">{m.stock_field_qty()}</th>
                  <th>{m.stock_field_from_warehouse()}</th>
                  <th>{m.stock_field_to_warehouse()}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {#each lines as l, i (i)}
                  <tr>
                    <td>{itemLabel(l.itemId)}</td>
                    <td class="num">{l.qty}</td>
                    <td>{l.fromWarehouseId ? warehouseLabel(l.fromWarehouseId) : '—'}</td>
                    <td>{l.toWarehouseId ? warehouseLabel(l.toWarehouseId) : '—'}</td>
                    <td><Button variant="ghost" class="rm-btn" onclick={() => removeLine(i)}><Trash2 size={13} /></Button></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}

          <div class="flex justify-between">
            <Button variant="outline" size="sm" onclick={() => (step = 'type')}><ArrowLeft size={14} /> {m.common_back()}</Button>
            <Button variant="primary" size="sm" onclick={() => (step = 'review')} disabled={lines.length === 0}>{m.stock_next()}</Button>
          </div>
        </div>
      {:else}
        <div class="card flex flex-col gap-3">
          <div class="card-h">{m.stock_review_title()}</div>
          <dl class="meta-grid">
            <dt>{m.stock_step_type()}</dt><dd>{type}</dd>
            <dt>{m.stock_field_party()}</dt><dd>{partyId ?? '—'}</dd>
          </dl>
          <table class="mini-table">
            <thead>
              <tr>
                <th>{m.stock_field_item()}</th>
                <th class="num">{m.stock_field_qty()}</th>
                <th>{m.stock_field_from_warehouse()}</th>
                <th>{m.stock_field_to_warehouse()}</th>
              </tr>
            </thead>
            <tbody>
              {#each lines as l (l.itemId + l.fromWarehouseId + l.toWarehouseId)}
                <tr>
                  <td>{itemLabel(l.itemId)}</td>
                  <td class="num">{l.qty}</td>
                  <td>{l.fromWarehouseId ? warehouseLabel(l.fromWarehouseId) : '—'}</td>
                  <td>{l.toWarehouseId ? warehouseLabel(l.toWarehouseId) : '—'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          {#if err}<p class="err-msg">{err}</p>{/if}
          <div class="flex justify-between">
            <Button variant="outline" size="sm" onclick={() => (step = 'lines')}><ArrowLeft size={14} /> {m.common_back()}</Button>
            <div class="flex gap-2">
              <Button variant="outline" size="sm" onclick={saveDraft} disabled={busy}>{m.stock_save_draft()}</Button>
              <Button variant="primary" size="sm" onclick={saveAndSubmit} disabled={busy}>{m.stock_submit()}</Button>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .stepper { display: flex; gap: var(--space-4); align-items: center; }
  .step { display: flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-body); color: var(--color-muted-foreground); }
  .step.active { color: var(--color-foreground); font-weight: 600; }
  .step.done { color: var(--color-accent); }
  .dot { display: inline-flex; align-items: center; justify-content: center; width: 1.3rem; height: 1.3rem; border-radius: var(--radius-full); border: 1px solid var(--hairline); font-size: var(--font-size-caption); }
  .step.active .dot { border-color: var(--color-accent); color: var(--color-accent); }
  .step.done .dot { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-text-primary); }
  .card { border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); padding: var(--space-4); }
  .card-h { font-size: var(--font-size-body); font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: var(--color-muted-foreground); }
  .type-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-2); }
  .type-grid :global(.type-btn) { padding: var(--space-2); border-radius: var(--radius-md); border: 1px solid var(--hairline); background: transparent; cursor: pointer; color: var(--color-foreground); }
  .type-grid :global(.type-btn.active) { border-color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 12%, transparent); color: var(--color-accent); }
  .fld { display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--font-size-body); color: var(--color-muted-foreground); }
  .inp { min-height: 2rem; padding: var(--space-2) var(--space-2); font-size: var(--font-size-body); border-radius: var(--radius-sm); background: var(--color-bg3); border: 1px solid var(--hairline); color: var(--color-foreground); font-family: inherit; }
  .line-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: var(--space-2); align-items: end; }
  .mini-table { width: 100%; font-size: var(--font-size-body); border-collapse: collapse; }
  .mini-table th { text-align: left; font-weight: 500; color: var(--color-muted-foreground); padding: var(--space-1) var(--space-2); border-bottom: 1px solid var(--hairline); }
  .mini-table td { padding: var(--space-1) var(--space-2); border-bottom: 1px solid var(--hairline); }
  .mini-table .num { text-align: right; font-variant-numeric: tabular-nums; }
  .mini-table :global(.rm-btn) { background: none; border: none; color: var(--color-muted-foreground); cursor: pointer; }
  .mini-table :global(.rm-btn):hover { color: var(--color-destructive); }
  .meta-grid { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-2) var(--space-4); font-size: var(--font-size-body); }
  .meta-grid dt { color: var(--color-muted-foreground); }
  .err-msg { font-size: var(--font-size-body); color: var(--color-destructive); }
</style>
