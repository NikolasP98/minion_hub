<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import * as m from '$lib/paraglide/messages';
  import { Warehouse as WarehouseIcon, Plus, Star } from 'lucide-svelte';
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

  let settingDefaultId = $state<string | null>(null);

  async function setDefault(id: string) {
    settingDefaultId = id;
    err = null;
    try {
      const res = await fetch(`/api/stock/warehouses/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isDefault: true }),
      });
      if (res.ok) await invalidate('stock:warehouses');
      else err = m.stock_warehouse_save_failed();
    } finally {
      settingDefaultId = null;
    }
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
          <li class="row" style={`--tree-depth:${w.depth}`}>
            <span class="name">{w.name}</span>
            {#if w.isDefault}
              <span class="default-badge"><Star size={12} fill="currentColor" /> {m.stock_wh_default()}</span>
            {:else}
              <Button variant="ghost"
                class="add-child"
                onclick={() => setDefault(w.id)}
                disabled={!canAct('stock', 'edit') || settingDefaultId === w.id}
                title={canAct('stock', 'edit') ? m.stock_wh_set_default() : m.no_permission()}
              >
                <Star size={12} /> {m.stock_wh_set_default()}
              </Button>
            {/if}
            <Button variant="ghost"
              class="add-child"
              onclick={() => openNew(w.id)}
              disabled={!canAct('stock', 'create')}
              title={canAct('stock', 'create') ? m.stock_add_child() : m.no_permission()}
            >
              <Plus size={12} /> {m.stock_add_child()}
            </Button>
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
  .tree { display: flex; flex-direction: column; gap: var(--space-1); max-width: 36rem; }
  .row { display: flex; align-items: center; gap: var(--space-2); padding-top: var(--space-2); padding-bottom: var(--space-2); padding-left: calc(var(--tree-depth, 0) * var(--space-6)); border-bottom: 1px solid var(--hairline); }
  .name { flex: 1; font-size: var(--font-size-page-title); }
  .tree :global(.add-child) { display: inline-flex; align-items: center; gap: var(--space-1); font-size: var(--font-size-caption); color: var(--color-muted-foreground); background: transparent; border: 1px solid var(--hairline); border-radius: var(--radius-sm); padding: var(--space-1) var(--space-2); cursor: pointer; }
  .tree :global(.add-child):hover { color: var(--color-foreground); background: color-mix(in srgb, var(--color-text-primary) 5%, transparent); }
  .tree :global(.add-child):disabled { opacity: 0.5; cursor: not-allowed; }
  .default-badge { display: inline-flex; align-items: center; gap: var(--space-1); font-size: var(--font-size-caption); color: var(--color-warning, var(--color-warning-fg)); }
  .fld { display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--font-size-body); color: var(--color-muted-foreground); }
  .inp { height: 1.75rem; padding: 0 var(--space-2); font-size: var(--font-size-body); border-radius: var(--radius-sm); background: var(--color-bg3); border: 1px solid var(--hairline); color: var(--color-foreground); }
  .err-msg { font-size: var(--font-size-body); color: var(--color-destructive); }
</style>
