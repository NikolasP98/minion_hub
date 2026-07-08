<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import { PackagePlus } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { PageHeader, Card, Button, Select, Combobox, EmptyState } from '$lib/components/ui';
  import PartyPicker from '$lib/components/crm/PartyPicker.svelte';
  import { canAct } from '$lib/access/can.svelte';
  import { toastAsync } from '$lib/state/ui/toast.svelte';
  import { formatMoney } from '$lib/utils/format';

  let { data }: { data: PageData } = $props();

  const warehouseOptions = $derived(data.warehouses.map((w) => ({ value: w.id, label: w.name })));

  let itemId = $state('');
  let qty = $state('');
  let rate = $state('');
  let partyId = $state<string | null>(null);
  // svelte-ignore state_referenced_locally -- seed once from the load's default/first warehouse, then user-editable
  let warehouseId = $state(data.defaultWarehouseId ?? data.warehouses[0]?.id ?? '');
  let note = $state('');

  let busy = $state(false);
  let err = $state<string | null>(null);
  // Set when the draft entry was created but /submit failed — the draft isn't
  // lost, so point the user at it instead of leaving the error a dead end.
  let draftBanner = $state<{ id: string; message: string } | null>(null);

  const canSubmit = $derived(itemId !== '' && Number(qty) > 0 && rate !== '' && Number(rate) > 0 && warehouseId !== '');
  const canEdit = canAct('stock', 'edit'); // stock write API is centrally gated on stock:edit (not pos:*) — see hooks.server.ts apiWriteCapability

  async function errMessage(res: Response): Promise<string> {
    try {
      const body = await res.json();
      return body?.message ?? `Failed (${res.status})`;
    } catch {
      return `Failed (${res.status})`;
    }
  }

  async function submitReceipt() {
    if (!canSubmit || busy) return;
    busy = true;
    err = null;
    draftBanner = null;
    try {
      await toastAsync(
        (async () => {
          const createRes = await fetch('/api/stock/entries', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              type: 'receipt',
              partyId,
              note: note || null,
              lines: [{ itemId, qty: Number(qty), rate: Number(rate), toWarehouseId: warehouseId }],
            }),
          });
          if (!createRes.ok) throw new Error(await errMessage(createRes));
          const entry = (await createRes.json()) as { id: string; humanId: string | null };

          const submitRes = await fetch(`/api/stock/entries/${entry.id}/submit`, { method: 'POST' });
          if (!submitRes.ok) {
            const draftErr = new Error(await errMessage(submitRes)) as Error & { draftId?: string };
            draftErr.draftId = entry.id;
            throw draftErr;
          }
          return entry;
        })(),
        {
          loading: `${m.pos_refill_submit()}…`,
          getOutcome: (entry) => ({ type: 'success', title: m.pos_refill_success({ humanId: entry.humanId ?? '—' }) }),
          onError: (e) => {
            const draftId = (e as (Error & { draftId?: string }) | undefined)?.draftId;
            if (draftId) draftBanner = { id: draftId, message: e instanceof Error ? e.message : String(e) };
            return { title: m.pos_refill_submit(), description: e instanceof Error ? e.message : String(e) };
          },
        },
      );
      itemId = '';
      qty = '';
      rate = '';
      partyId = null;
      note = '';
      await invalidate('pos:refills');
    } catch {
      // toastAsync already surfaced the failure (+ draftBanner set above if applicable)
    } finally {
      busy = false;
    }
  }

  function fmtDate(d: string | Date): string {
    return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
</script>

<svelte:head><title>{m.pos_refill_title()} — {m.nav_pos()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
  <PageHeader title={m.pos_refill_title()}>
    {#snippet leading()}<PackagePlus size={16} class="text-accent shrink-0" />{/snippet}
  </PageHeader>

  <div class="flex-1 min-h-0 overflow-auto p-4">
    <div class="w-full max-w-2xl mx-auto flex flex-col gap-4">
      {#if draftBanner}
        <div class="banner">
          <span>{draftBanner.message}</span>
          <a href={`/stock/entries/${draftBanner.id}`}>{m.pos_sell_view_entry()}</a>
        </div>
      {/if}

      <Card>
        <div class="form">
          <Combobox
            id="refill-item"
            items={data.items}
            itemToValue={(i) => i.id}
            itemToString={(i) => `${i.code} — ${i.name}`}
            placeholder={m.stock_field_item()}
            bind:value={itemId}
          />
          <div class="row">
            <label class="fld">
              <span>{m.stock_field_qty()}</span>
              <input class="inp" type="number" min="0" step="0.01" bind:value={qty} />
            </label>
            <label class="fld">
              <span>{m.stock_field_rate()}</span>
              <input class="inp" type="number" min="0" step="0.01" bind:value={rate} />
            </label>
          </div>
          <p class="hint">{m.pos_refill_cost_hint()}</p>

          <PartyPicker bind:value={partyId} label={m.pos_refill_supplier()} types="company,person" />

          <Select bind:value={warehouseId} options={warehouseOptions} label={m.stock_field_to_warehouse()} />

          <label class="fld">
            <span>{m.stock_field_note()}</span>
            <textarea class="inp" rows="2" bind:value={note}></textarea>
          </label>

          {#if err}<p class="err-msg">{err}</p>{/if}

          <div class="flex justify-end">
            <Button variant="primary" size="sm" disabled={!canSubmit || !canEdit || busy} loading={busy} onclick={submitReceipt}>
              {m.pos_refill_submit()}
            </Button>
          </div>
        </div>
      </Card>

      <div class="flex flex-col gap-2">
        <h2 class="section-h">{m.pos_refill_recent()}</h2>
        {#if data.recent.length === 0}
          <EmptyState title={m.common_noMatches()} compact />
        {:else}
          <div class="recent-list">
            {#each data.recent as r (r.id)}
              <a class="recent-row" href={`/stock/entries/${r.id}`}>
                <span class="rid">{r.humanId ?? r.id.slice(0, 8)}</span>
                <span class="ritem">{r.firstItemName ?? '—'}{r.lineCount > 1 ? ` +${r.lineCount - 1}` : ''}</span>
                <span class="rqty">{r.totalQty}</span>
                <span class="rval">{formatMoney(r.value)}</span>
                <span class="rdate">{fmtDate(r.createdAt)}</span>
              </a>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
  }
  .fld {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.78rem;
    color: var(--color-muted-foreground);
  }
  .inp {
    min-height: 2rem;
    padding: 0.4rem 0.5rem;
    font-size: 0.82rem;
    border-radius: var(--radius-sm);
    background: var(--color-bg3);
    border: 1px solid var(--hairline);
    color: var(--color-foreground);
    font-family: inherit;
  }
  .hint {
    font-size: 0.72rem;
    color: var(--color-muted-foreground);
    margin-top: -0.4rem;
  }
  .err-msg {
    font-size: 0.8rem;
    color: var(--color-destructive);
  }
  .banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.5rem 0.6rem;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, #f59e0b 14%, transparent);
    color: #f59e0b;
    font-size: 0.78rem;
  }
  .banner a {
    color: inherit;
    text-decoration: underline;
    white-space: nowrap;
  }
  .section-h {
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-muted-foreground);
  }
  .recent-list {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .recent-row {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    font-size: 0.8rem;
    color: var(--color-foreground);
    text-decoration: none;
  }
  .recent-row:hover {
    border-color: var(--color-accent);
  }
  .rid {
    font-variant-numeric: tabular-nums;
    min-width: 6rem;
  }
  .ritem {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-muted-foreground);
  }
  .rqty {
    font-variant-numeric: tabular-nums;
    min-width: 3rem;
    text-align: right;
  }
  .rval {
    font-variant-numeric: tabular-nums;
    min-width: 4.5rem;
    text-align: right;
  }
  .rdate {
    color: var(--color-muted-foreground);
    min-width: 9rem;
    text-align: right;
  }
</style>
