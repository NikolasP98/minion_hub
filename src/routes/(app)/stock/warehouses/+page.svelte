<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import * as m from '$lib/paraglide/messages';
  import { Warehouse as WarehouseIcon, Plus } from 'lucide-svelte';
  import { PageHeader, Button, Modal } from '$lib/components/ui';
  import { canAct } from '$lib/access/can.svelte';
  import { buildWarehouseTree } from '$lib/components/stock/stock-ui';

  let { data }: { data: PageData } = $props();
  const tree = $derived(buildWarehouseTree(data.warehouses));

  let formOpen = $state(false);
  let formParentId = $state<string | null>(null);
  let formName = $state('');
  let busy = $state(false);
  let err = $state<string | null>(null);

  function openNew(parentId: string | null) {
    formParentId = parentId;
    formName = '';
    err = null;
    formOpen = true;
  }

  async function save() {
    busy = true;
    err = null;
    try {
      const res = await fetch('/api/stock/warehouses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: formName, parentId: formParentId }),
      });
      if (res.ok) {
        formOpen = false;
        await invalidate('stock:warehouses');
      } else {
        err = res.status === 409 ? m.stock_warehouse_cycle_error() : m.stock_warehouse_save_failed();
      }
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>{m.stock_warehouses_title()} — {m.nav_stock()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
  <PageHeader title={m.stock_warehouses_title()} subtitle={m.stock_warehouses_subtitle()}>
    {#snippet leading()}<WarehouseIcon size={16} class="text-accent shrink-0" />{/snippet}
    {#snippet actions()}
      <Button
        variant="primary"
        size="sm"
        onclick={() => openNew(null)}
        disabled={!canAct('stock', 'create')}
        title={canAct('stock', 'create') ? undefined : m.no_permission()}
      >
        <Plus size={14} /> {m.stock_new_warehouse()}
      </Button>
    {/snippet}
  </PageHeader>

  <div class="flex-1 min-h-0 overflow-auto p-4">
    {#if tree.length === 0}
      <div class="flex flex-col items-center justify-center h-full gap-2 p-8 text-center">
        <WarehouseIcon size={32} class="text-muted-foreground" />
        <p class="t-caption">{m.stock_warehouses_empty()}</p>
      </div>
    {:else}
      <ul class="tree">
        {#each tree as w (w.id)}
          <li class="row" style="padding-left: {w.depth * 1.5}rem">
            <span class="name">{w.name}</span>
            <button
              class="add-child"
              onclick={() => openNew(w.id)}
              disabled={!canAct('stock', 'create')}
              title={canAct('stock', 'create') ? m.stock_add_child() : m.no_permission()}
            >
              <Plus size={12} /> {m.stock_add_child()}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<Modal bind:open={formOpen} title={m.stock_new_warehouse()}>
  <div class="flex flex-col gap-3">
    <label class="fld">
      <span>{m.stock_field_warehouse_name()}</span>
      <input class="inp" bind:value={formName} />
    </label>
    {#if err}<p class="err-msg">{err}</p>{/if}
  </div>
  {#snippet footer()}
    <Button variant="outline" size="sm" onclick={() => (formOpen = false)}>{m.common_cancel()}</Button>
    <Button variant="primary" size="sm" onclick={save} disabled={busy || !formName.trim()}>{m.stock_create()}</Button>
  {/snippet}
</Modal>

<style>
  .tree { display: flex; flex-direction: column; gap: 0.15rem; max-width: 36rem; }
  .row { display: flex; align-items: center; gap: 0.5rem; padding-top: 0.4rem; padding-bottom: 0.4rem; border-bottom: 1px solid var(--hairline); }
  .name { flex: 1; font-size: 0.9rem; }
  .add-child { display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.72rem; color: var(--color-muted-foreground); background: transparent; border: 1px solid var(--hairline); border-radius: var(--radius-sm); padding: 0.15rem 0.5rem; cursor: pointer; }
  .add-child:hover { color: var(--color-foreground); background: rgba(255, 255, 255, 0.05); }
  .add-child:disabled { opacity: 0.5; cursor: not-allowed; }
  .fld { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.78rem; color: var(--color-muted-foreground); }
  .inp { height: 1.75rem; padding: 0 0.5rem; font-size: 0.82rem; border-radius: var(--radius-sm); background: var(--color-bg3); border: 1px solid var(--hairline); color: var(--color-foreground); }
  .err-msg { font-size: 0.8rem; color: var(--color-destructive); }
</style>
