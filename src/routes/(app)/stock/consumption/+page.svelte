<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import * as m from '$lib/paraglide/messages';
  import { Boxes, Search, Trash2, Plus } from 'lucide-svelte';
  import { PageHeader, Button, Combobox, EmptyState } from '$lib/components/ui';
  import { canAct } from '$lib/access/can.svelte';

  let { data }: { data: PageData } = $props();
  const products = $derived(data.products);
  const items = $derived(data.items);
  const consumption = $derived(data.consumption);

  let query = $state('');
  let selectedProductId = $state<string | null>(null);

  const filteredProducts = $derived(
    products.filter((p) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q);
    }),
  );
  const selectedProduct = $derived(products.find((p) => p.id === selectedProductId) ?? null);
  const mappings = $derived(consumption.filter((c) => c.finProductId === selectedProductId));

  function selectProduct(id: string) {
    selectedProductId = id;
    cancelEdit();
    draftItemId = '';
    draftQty = '';
    draftNote = '';
    addErr = null;
  }

  async function errMessage(res: Response): Promise<string> {
    try {
      const body = await res.json();
      return body?.message ?? m.stock_consumption_save_failed();
    } catch {
      return m.stock_consumption_save_failed();
    }
  }

  // ── Add mapping ──────────────────────────────────────────────────────────
  let draftItemId = $state('');
  let draftQty = $state('');
  let draftNote = $state('');
  let addBusy = $state(false);
  let addErr = $state<string | null>(null);

  const canAddDraft = $derived(draftItemId !== '' && Number(draftQty) > 0);

  async function addMapping() {
    if (!selectedProductId || !canAddDraft) return;
    addBusy = true;
    addErr = null;
    try {
      const res = await fetch('/api/stock/consumption', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          finProductId: selectedProductId,
          itemId: draftItemId,
          qtyPerUnit: Number(draftQty),
          note: draftNote || null,
        }),
      });
      if (res.ok) {
        draftItemId = '';
        draftQty = '';
        draftNote = '';
        await invalidate('stock:consumption');
      } else {
        addErr = await errMessage(res);
      }
    } finally {
      addBusy = false;
    }
  }

  // ── Edit / delete mapping ────────────────────────────────────────────────
  let editingId = $state<string | null>(null);
  let editQty = $state('');
  let editNote = $state('');
  let editBusy = $state(false);
  let editErr = $state<string | null>(null);

  function startEdit(c: (typeof consumption)[number]) {
    editingId = c.id;
    editQty = String(c.qtyPerUnit);
    editNote = c.note ?? '';
    editErr = null;
  }
  function cancelEdit() {
    editingId = null;
    editErr = null;
  }
  async function saveEdit(id: string) {
    if (Number(editQty) <= 0) return;
    editBusy = true;
    editErr = null;
    try {
      const res = await fetch(`/api/stock/consumption/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ qtyPerUnit: Number(editQty), note: editNote || null }),
      });
      if (res.ok) {
        editingId = null;
        await invalidate('stock:consumption');
      } else {
        editErr = await errMessage(res);
      }
    } finally {
      editBusy = false;
    }
  }

  async function removeMapping(id: string) {
    if (!confirm(m.stock_consumption_confirm_delete())) return;
    const res = await fetch(`/api/stock/consumption/${id}`, { method: 'DELETE' });
    if (res.ok) await invalidate('stock:consumption');
  }
</script>

<svelte:head><title>{m.stock_consumption_title()} — {m.nav_stock()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
  <PageHeader title={m.stock_consumption_title()} subtitle={m.stock_consumption_subtitle()}>
    {#snippet leading()}<Boxes size={16} class="text-accent shrink-0" />{/snippet}
  </PageHeader>

  <div class="flex-1 min-h-0 flex overflow-hidden">
    <aside class="left-pane">
      <div class="search-fld">
        <Search size={13} class="search-ico" />
        <input class="search-inp" placeholder={m.stock_consumption_search()} bind:value={query} />
      </div>
      {#if filteredProducts.length === 0}
        <p class="t-caption px-3 py-4">{m.stock_consumption_no_products()}</p>
      {:else}
        <ul class="product-list">
          {#each filteredProducts as p (p.id)}
            <li>
              <button class="product-btn" class:active={p.id === selectedProductId} onclick={() => selectProduct(p.id)}>
                <span class="product-name">{p.name}</span>
                <span class="product-code">{p.code}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </aside>

    <section class="right-pane">
      {#if !selectedProduct}
        <EmptyState icon={Boxes} title={m.stock_consumption_pick_title()} description={m.stock_consumption_pick_body()} />
      {:else}
        <div class="right-head">
          <h2 class="t-heading">{selectedProduct.name}</h2>
          <span class="t-caption">{selectedProduct.code}</span>
        </div>

        <div class="card">
          <div class="line-form">
            <Combobox
              id="consumption-item"
              items={items}
              itemToValue={(i) => i.id}
              itemToString={(i) => `${i.code} — ${i.name}`}
              placeholder={m.stock_field_item()}
              bind:value={draftItemId}
            />
            <input class="inp" type="number" min="0" step="0.01" placeholder={m.stock_field_qty()} bind:value={draftQty} />
            <input class="inp" placeholder={m.stock_field_note()} bind:value={draftNote} />
            <Button
              variant="outline"
              size="sm"
              onclick={addMapping}
              disabled={addBusy || !canAct('stock', 'edit') || !canAddDraft}
              title={canAct('stock', 'edit') ? undefined : m.no_permission()}
            >
              <Plus size={14} /> {m.stock_add_line()}
            </Button>
          </div>
          {#if addErr}<p class="err-msg">{addErr}</p>{/if}
        </div>

        {#if mappings.length === 0}
          <p class="t-caption">{m.stock_consumption_empty()}</p>
        {:else}
          <table class="mini-table">
            <thead>
              <tr>
                <th>{m.stock_field_item()}</th>
                <th>{m.stock_col_uom()}</th>
                <th class="num">{m.stock_consumption_col_qty_per_unit()}</th>
                <th>{m.stock_field_note()}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {#each mappings as c (c.id)}
                {@const editing = editingId === c.id}
                <tr>
                  <td>{c.itemCode} — {c.itemName}</td>
                  <td class="t-caption">{c.uom}</td>
                  <td class="num">
                    {#if editing}
                      <input class="inp w-20 text-right" type="number" min="0" step="0.01" bind:value={editQty} />
                    {:else}
                      {c.qtyPerUnit}
                    {/if}
                  </td>
                  <td class="t-caption">
                    {#if editing}
                      <input class="inp w-full" bind:value={editNote} />
                    {:else}
                      {c.note ?? '—'}
                    {/if}
                  </td>
                  <td>
                    {#if editing}
                      <div class="flex gap-1 justify-end">
                        <button class="act-btn act-save" onclick={() => saveEdit(c.id)} disabled={editBusy}>✓</button>
                        <button class="act-btn act-cancel" onclick={cancelEdit}>✗</button>
                      </div>
                      {#if editErr}<p class="err-msg text-xs">{editErr}</p>{/if}
                    {:else}
                      <div class="flex gap-1 justify-end">
                        <button
                          class="act-btn act-edit"
                          onclick={() => startEdit(c)}
                          disabled={!canAct('stock', 'edit')}
                          title={canAct('stock', 'edit') ? undefined : m.no_permission()}
                        >✎</button>
                        <button
                          class="act-btn act-cancel"
                          onclick={() => removeMapping(c.id)}
                          disabled={!canAct('stock', 'edit')}
                          title={canAct('stock', 'edit') ? undefined : m.no_permission()}
                        ><Trash2 size={12} /></button>
                      </div>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      {/if}
    </section>
  </div>
</div>

<style>
  .left-pane {
    width: 18rem;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--hairline);
    overflow: hidden;
  }
  .search-fld { display: flex; align-items: center; gap: 0.4rem; padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--hairline); }
  .search-fld :global(.search-ico) { color: var(--color-muted-foreground); flex-shrink: 0; }
  .search-inp { flex: 1; min-width: 0; background: transparent; border: none; outline: none; font-size: 0.82rem; color: var(--color-foreground); }
  .product-list { overflow-y: auto; flex: 1; min-height: 0; }
  .product-btn {
    display: flex; flex-direction: column; gap: 0.05rem; width: 100%; text-align: left;
    padding: 0.5rem 0.75rem; border: none; border-bottom: 1px solid var(--hairline);
    background: transparent; cursor: pointer; color: var(--color-foreground);
  }
  .product-btn:hover { background: rgba(255, 255, 255, 0.03); }
  .product-btn.active { background: color-mix(in srgb, var(--color-accent) 10%, transparent); border-left: 2px solid var(--color-accent); }
  .product-name { font-size: 0.84rem; font-weight: 500; }
  .product-code { font-size: 0.7rem; color: var(--color-muted-foreground); font-family: var(--font-mono, monospace); }

  .right-pane { flex: 1; min-width: 0; overflow: auto; padding: 1rem; display: flex; flex-direction: column; gap: 1rem; }
  .right-head { display: flex; align-items: baseline; gap: 0.6rem; }

  .card { border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); padding: 0.85rem 1rem; }
  .line-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: 0.5rem; align-items: end; }
  .inp { height: 1.75rem; padding: 0 0.5rem; font-size: 0.82rem; border-radius: var(--radius-sm); background: var(--color-bg3); border: 1px solid var(--hairline); color: var(--color-foreground); font-family: inherit; }

  .mini-table { width: 100%; font-size: 0.82rem; border-collapse: collapse; }
  .mini-table th { text-align: left; font-weight: 500; color: var(--color-muted-foreground); padding: 0.3rem 0.5rem; border-bottom: 1px solid var(--hairline); }
  .mini-table td { padding: 0.3rem 0.5rem; border-bottom: 1px solid var(--hairline); }
  .mini-table .num { text-align: right; font-variant-numeric: tabular-nums; }

  .act-btn { display: inline-flex; align-items: center; justify-content: center; width: 1.5rem; height: 1.5rem; border-radius: var(--radius-sm); font-size: 0.78rem; border: 1px solid var(--hairline); background: transparent; cursor: pointer; color: var(--color-muted-foreground); }
  .act-btn:hover { background: rgba(255, 255, 255, 0.06); color: var(--color-foreground); }
  .act-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .act-save { color: var(--color-accent); }
  .act-cancel { color: var(--color-muted-foreground); }
  .act-edit { opacity: 0.6; }
  .err-msg { font-size: 0.8rem; color: var(--color-destructive); }
</style>
