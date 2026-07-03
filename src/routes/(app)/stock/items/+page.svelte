<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate, goto } from '$app/navigation';
  import * as m from '$lib/paraglide/messages';
  import { Package, Plus } from 'lucide-svelte';
  import { PageHeader, Button, Modal } from '$lib/components/ui';
  import { canAct } from '$lib/access/can.svelte';

  let { data }: { data: PageData } = $props();
  const items = $derived(data.items);

  // ── Inline edit (reorder level / qty / group) ───────────────────────────
  let editingId = $state<string | null>(null);
  let editName = $state('');
  let editGroup = $state('');
  let editReorderLevel = $state('');
  let editReorderQty = $state('');
  let editBusy = $state(false);
  let editErr = $state<string | null>(null);

  function startEdit(it: (typeof items)[number]) {
    editingId = it.id;
    editName = it.name;
    editGroup = it.itemGroup ?? '';
    editReorderLevel = it.reorderLevel ?? '';
    editReorderQty = it.reorderQty ?? '';
    editErr = null;
  }
  function cancelEdit() {
    editingId = null;
    editErr = null;
  }
  async function saveEdit(id: string) {
    editBusy = true;
    editErr = null;
    try {
      const res = await fetch(`/api/stock/items/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: editName,
          itemGroup: editGroup || null,
          reorderLevel: editReorderLevel !== '' ? Number(editReorderLevel) : null,
          reorderQty: editReorderQty !== '' ? Number(editReorderQty) : null,
        }),
      });
      if (res.ok) {
        editingId = null;
        await invalidate('stock:items');
      } else {
        editErr = m.stock_item_save_failed();
      }
    } finally {
      editBusy = false;
    }
  }

  // ── Create ───────────────────────────────────────────────────────────────
  let createOpen = $state(false);
  let newCode = $state('');
  let newName = $state('');
  let newUom = $state('unit');
  let createBusy = $state(false);
  let createErr = $state<string | null>(null);

  async function createItem() {
    createBusy = true;
    createErr = null;
    try {
      const res = await fetch('/api/stock/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: newCode, name: newName, uom: newUom || 'unit' }),
      });
      if (res.ok) {
        const item = await res.json();
        createOpen = false;
        newCode = '';
        newName = '';
        newUom = 'unit';
        await invalidate('stock:items');
        await goto(`/stock/items/${item.id}`);
      } else {
        createErr = m.stock_item_save_failed();
      }
    } finally {
      createBusy = false;
    }
  }
</script>

<svelte:head><title>{m.stock_items_title()} — {m.nav_stock()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
  <PageHeader title={m.stock_items_title()} subtitle={m.stock_items_subtitle()}>
    {#snippet leading()}<Package size={16} class="text-accent shrink-0" />{/snippet}
    {#snippet actions()}
      <Button
        variant="primary"
        size="sm"
        onclick={() => (createOpen = true)}
        disabled={!canAct('stock', 'create')}
        title={canAct('stock', 'create') ? undefined : m.no_permission()}
      >
        <Plus size={14} /> {m.stock_new_item()}
      </Button>
    {/snippet}
  </PageHeader>

  <div class="flex-1 min-h-0 overflow-auto">
    {#if items.length === 0}
      <div class="flex flex-col items-center justify-center h-full gap-2 p-8 text-center">
        <Package size={32} class="text-muted-foreground" />
        <p class="t-caption">{m.stock_items_empty()}</p>
      </div>
    {:else}
      <table class="w-full text-sm border-collapse">
        <thead class="sticky top-0 bg-bg/95 backdrop-blur z-20">
          <tr class="text-left t-caption border-b border-[var(--hairline)]">
            <th class="px-4 py-2 font-medium">{m.stock_col_code()}</th>
            <th class="px-3 py-2 font-medium">{m.stock_col_name()}</th>
            <th class="px-3 py-2 font-medium">{m.stock_col_group()}</th>
            <th class="px-3 py-2 font-medium">{m.stock_col_uom()}</th>
            <th class="px-3 py-2 font-medium text-right">{m.stock_col_reorder_level()}</th>
            <th class="px-3 py-2 font-medium text-right">{m.stock_col_reorder_qty()}</th>
            <th class="px-3 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {#each items as it (it.id)}
            {@const editing = editingId === it.id}
            <tr class="border-b border-[var(--hairline)] hover:bg-white/[0.03] transition-colors">
              <td class="px-4 py-2 font-mono text-xs">
                <a href="/stock/items/{it.id}" class="hover:underline">{it.code}</a>
              </td>
              <td class="px-3 py-2 max-w-[16rem]">
                {#if editing}
                  <input class="inp w-full" bind:value={editName} />
                {:else}
                  <span class="truncate block">{it.name}</span>
                {/if}
              </td>
              <td class="px-3 py-2 t-caption">
                {#if editing}
                  <input class="inp w-full" bind:value={editGroup} />
                {:else}
                  {it.itemGroup ?? '—'}
                {/if}
              </td>
              <td class="px-3 py-2 t-caption">{it.uom}</td>
              <td class="px-3 py-2 text-right tabular-nums">
                {#if editing}
                  <input class="inp w-20 text-right" type="number" min="0" step="0.01" bind:value={editReorderLevel} />
                {:else}
                  {it.reorderLevel ?? '—'}
                {/if}
              </td>
              <td class="px-3 py-2 text-right tabular-nums">
                {#if editing}
                  <input class="inp w-20 text-right" type="number" min="0" step="0.01" bind:value={editReorderQty} />
                {:else}
                  {it.reorderQty ?? '—'}
                {/if}
              </td>
              <td class="px-3 py-2">
                {#if editing}
                  <div class="flex gap-1 justify-end">
                    <button class="act-btn act-save" onclick={() => saveEdit(it.id)} disabled={editBusy}>✓</button>
                    <button class="act-btn act-cancel" onclick={cancelEdit}>✗</button>
                  </div>
                  {#if editErr}<p class="err-msg text-xs">{editErr}</p>{/if}
                {:else}
                  <button
                    class="act-btn act-edit"
                    onclick={() => startEdit(it)}
                    disabled={!canAct('stock', 'edit')}
                    title={canAct('stock', 'edit') ? undefined : m.no_permission()}
                  >✎</button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>

<Modal bind:open={createOpen} title={m.stock_create_item_title()}>
  <div class="flex flex-col gap-3">
    <label class="fld">
      <span>{m.stock_field_code()}</span>
      <input class="inp" bind:value={newCode} />
    </label>
    <label class="fld">
      <span>{m.stock_field_name()}</span>
      <input class="inp" bind:value={newName} />
    </label>
    <label class="fld">
      <span>{m.stock_field_uom()}</span>
      <input class="inp" bind:value={newUom} />
    </label>
    {#if createErr}<p class="err-msg text-xs">{createErr}</p>{/if}
  </div>
  {#snippet footer()}
    <Button variant="outline" size="sm" onclick={() => (createOpen = false)}>{m.common_cancel()}</Button>
    <Button variant="primary" size="sm" onclick={createItem} disabled={createBusy || !newCode.trim() || !newName.trim()}>
      {m.stock_create()}
    </Button>
  {/snippet}
</Modal>

<style>
  .inp { height: 1.75rem; padding: 0 0.5rem; font-size: 0.82rem; border-radius: var(--radius-sm); background: var(--color-bg3); border: 1px solid var(--hairline); color: var(--color-foreground); }
  .fld { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.78rem; color: var(--color-muted-foreground); }
  .act-btn { display: inline-flex; align-items: center; justify-content: center; width: 1.5rem; height: 1.5rem; border-radius: var(--radius-sm); font-size: 0.78rem; border: 1px solid var(--hairline); background: transparent; cursor: pointer; color: var(--color-muted-foreground); }
  .act-btn:hover { background: rgba(255, 255, 255, 0.06); color: var(--color-foreground); }
  .act-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .act-save { color: var(--color-accent); }
  .act-cancel { color: var(--color-muted-foreground); }
  .act-edit { opacity: 0.6; }
  .err-msg { font-size: 0.8rem; color: var(--color-destructive); }
</style>
