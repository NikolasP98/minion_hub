<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import * as m from '$lib/paraglide/messages';
  import {
    Warehouse as WarehouseIcon,
    Plus,
    Star,
    Pencil,
    Archive as ArchiveIcon,
    RotateCcw,
    MoreVertical,
  } from 'lucide-svelte';
  import { PageHeader, Button, Badge, Modal, Dropdown } from '$lib/components/ui';
  import type { DropdownItem } from '$lib/components/ui';
  import { ConfirmDialog } from '$lib/components/ui/foundations';
  import { canAct } from '$lib/access/can.svelte';
  import { buildWarehouseTree, type WarehouseTreeRow } from '$lib/components/stock/stock-ui';
  import { registerForm } from '$lib/assistant/forms';
  import { WAREHOUSE_FORM } from '$lib/assistant/catalog';

  let { data }: { data: PageData } = $props();
  const tree = $derived(buildWarehouseTree(data.warehouses));

  // Top-level banner for row actions that aren't inside a dialog (set-default,
  // restore) — the modal/ConfirmDialog-scoped actions surface their own error.
  let rowErr = $state<string | null>(null);

  // svelte-ignore state_referenced_locally
  let formOpen = $state(data.openNew ?? false);
  // ?new=1 while already on the page (assistant deep link): load re-runs, the seed does not.
  $effect(() => {
    if (data.openNew) formOpen = true;
  });
  let formParentId = $state<string | null>(null);
  let formName = $state('');
  let busy = $state(false);
  let err = $state<string | null>(null);

  // Assistant fill tool — registered only while the create modal is open.
  $effect(() => {
    if (!formOpen) return;
    return registerForm({
      def: WAREHOUSE_FORM,
      get: () => ({ name: formName }),
      set: (v) => {
        if (v.name != null) formName = String(v.name);
        return {};
      },
    });
  });

  function openNew(parentId: string | null) {
    formParentId = parentId;
    formName = '';
    err = null;
    formOpen = true;
  }

  let settingDefaultId = $state<string | null>(null);

  async function setDefault(id: string) {
    settingDefaultId = id;
    rowErr = null;
    try {
      const res = await fetch(`/api/stock/warehouses/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isDefault: true }),
      });
      if (res.ok) await invalidate('stock:warehouses');
      else rowErr = m.stock_warehouse_save_failed();
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
        err =
          res.status === 409 ? m.stock_warehouse_cycle_error() : m.stock_warehouse_save_failed();
      }
    } finally {
      busy = false;
    }
  }

  // ── Rename ──────────────────────────────────────────────────────────────
  let renameOpen = $state(false);
  let renameId = $state<string | null>(null);
  let renameName = $state('');
  let renameBusy = $state(false);
  let renameErr = $state<string | null>(null);

  function openRename(w: WarehouseTreeRow) {
    renameId = w.id;
    renameName = w.name;
    renameErr = null;
    renameOpen = true;
  }

  async function saveRename() {
    if (!renameId) return;
    renameBusy = true;
    renameErr = null;
    try {
      const res = await fetch(`/api/stock/warehouses/${renameId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: renameName }),
      });
      if (res.ok) {
        renameOpen = false;
        await invalidate('stock:warehouses');
      } else {
        renameErr =
          res.status === 409 ? m.stock_warehouse_cycle_error() : m.stock_warehouse_save_failed();
      }
    } finally {
      renameBusy = false;
    }
  }

  // ── Archive / restore ──────────────────────────────────────────────────
  let archiveTarget = $state<WarehouseTreeRow | null>(null);
  let archiveFailureMessage = $state(m.stock_wh_archive_failed());

  function openArchive(w: WarehouseTreeRow) {
    archiveTarget = w;
    archiveFailureMessage = m.stock_wh_archive_failed();
  }

  function archiveErrorMessage(code: string | undefined): string | undefined {
    if (code === 'default_warehouse') return m.stock_wh_archive_err_default();
    if (code === 'has_stock') return m.stock_wh_archive_err_stock();
    if (code === 'has_children') return m.stock_wh_archive_err_children();
    return undefined;
  }

  async function confirmArchive() {
    if (!archiveTarget) return;
    const res = await fetch(`/api/stock/warehouses/${archiveTarget.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    });
    if (res.ok) {
      await invalidate('stock:warehouses');
      return;
    }
    const body = await res.json().catch(() => undefined);
    archiveFailureMessage =
      archiveErrorMessage(body?.code) ?? body?.message ?? m.stock_wh_archive_failed();
    throw new Error('archive failed');
  }

  let restoringId = $state<string | null>(null);

  async function restore(id: string) {
    restoringId = id;
    rowErr = null;
    try {
      const res = await fetch(`/api/stock/warehouses/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archived: false }),
      });
      if (res.ok) await invalidate('stock:warehouses');
      else rowErr = m.stock_warehouse_save_failed();
    } finally {
      restoringId = null;
    }
  }

  // ── Per-row kebab menu ──────────────────────────────────────────────────
  function menuItems(w: WarehouseTreeRow): DropdownItem[] {
    const items: DropdownItem[] = [];
    if (w.archivedAt) {
      if (canAct('stock', 'edit'))
        items.push({ value: 'restore', label: m.stock_wh_restore(), icon: RotateCcw });
      return items;
    }
    if (!w.isDefault && canAct('stock', 'edit'))
      items.push({ value: 'set-default', label: m.stock_wh_set_default(), icon: Star });
    if (canAct('stock', 'create'))
      items.push({ value: 'add-sub', label: m.stock_add_child(), icon: Plus });
    if (canAct('stock', 'edit'))
      items.push({ value: 'rename', label: m.stock_wh_rename(), icon: Pencil });
    if (canAct('stock', 'edit')) {
      if (items.length) items.push({ value: 'd', label: '', divider: true });
      items.push({
        value: 'archive',
        label: m.stock_wh_archive(),
        icon: ArchiveIcon,
        danger: true,
      });
    }
    return items;
  }

  function onRowAction(w: WarehouseTreeRow, value: string) {
    if (value === 'set-default') setDefault(w.id);
    else if (value === 'add-sub') openNew(w.id);
    else if (value === 'rename') openRename(w);
    else if (value === 'archive') openArchive(w);
    else if (value === 'restore') restore(w.id);
  }
</script>

<svelte:head><title>{m.stock_warehouses_title()} — {m.nav_stock()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0 flex-1 min-w-0">
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
        <Plus size={14} />
        {m.stock_new_warehouse()}
      </Button>
    {/snippet}
  </PageHeader>

  <div class="flex-1 min-h-0 overflow-auto p-4">
    {#if rowErr}<p class="err-msg">{rowErr}</p>{/if}
    {#if tree.length === 0}
      <div class="flex flex-col items-center justify-center h-full gap-2 p-8 text-center">
        <WarehouseIcon size={32} class="text-muted-foreground" />
        <p class="t-caption">{m.stock_warehouses_empty()}</p>
      </div>
    {:else}
      <ul class="tree">
        {#each tree as w (w.id)}
          <li class="row" class:archived={!!w.archivedAt} style={`--tree-depth:${w.depth}`}>
            <span class="name">{w.name}</span>
            {#if w.archivedAt}
              <Badge variant="neutral" size="sm">{m.stock_wh_archived_badge()}</Badge>
            {:else if w.isDefault}
              <span class="default-badge"
                ><Star size={12} fill="currentColor" /> {m.stock_wh_default()}</span
              >
            {/if}
            {#if restoringId === w.id || settingDefaultId === w.id}
              <span class="t-caption busy-label">{m.common_loading()}</span>
            {:else if menuItems(w).length}
              <Dropdown items={menuItems(w)} onSelect={(v) => onRowAction(w, v)} placement="left">
                {#snippet trigger()}
                  <span class="icon-btn" aria-label={m.stock_wh_actions()}
                    ><MoreVertical size={16} /></span
                  >
                {/snippet}
              </Dropdown>
            {/if}
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
      <input class="inp" bind:value={formName} data-assist="warehouse.name" />
    </label>
    {#if err}<p class="err-msg">{err}</p>{/if}
  </div>
  {#snippet footer()}
    <Button variant="outline" size="sm" onclick={() => (formOpen = false)}
      >{m.common_cancel()}</Button
    >
    <Button
      variant="primary"
      size="sm"
      onclick={save}
      disabled={busy || !formName.trim()}
      data-assist="warehouse.submit">{m.stock_create()}</Button
    >
  {/snippet}
</Modal>

<Modal bind:open={renameOpen} title={m.stock_wh_rename()}>
  <div class="flex flex-col gap-3">
    <label class="fld">
      <span>{m.stock_field_warehouse_name()}</span>
      <input class="inp" bind:value={renameName} />
    </label>
    {#if renameErr}<p class="err-msg">{renameErr}</p>{/if}
  </div>
  {#snippet footer()}
    <Button variant="outline" size="sm" onclick={() => (renameOpen = false)}
      >{m.common_cancel()}</Button
    >
    <Button
      variant="primary"
      size="sm"
      onclick={saveRename}
      disabled={renameBusy || !renameName.trim()}
    >
      {m.common_save()}
    </Button>
  {/snippet}
</Modal>

{#if archiveTarget}
  <ConfirmDialog
    open={true}
    title={m.stock_wh_archive_title()}
    message={m.stock_wh_archive_message({ name: archiveTarget.name })}
    failureMessage={archiveFailureMessage}
    confirmLabel={m.stock_wh_archive()}
    tone="danger"
    onconfirm={confirmArchive}
    onclose={() => (archiveTarget = null)}
  />
{/if}

<style>
  .tree {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-width: 36rem;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-top: var(--space-2);
    padding-bottom: var(--space-2);
    padding-left: calc(var(--tree-depth, 0) * var(--space-6));
    border-bottom: 1px solid var(--hairline);
  }
  .row.archived {
    color: var(--color-text-tertiary);
  }
  .name {
    flex: 1;
    font-size: var(--font-size-page-title);
  }
  .row.archived .name {
    color: var(--color-text-tertiary);
  }
  .default-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-caption);
    color: var(--color-warning, var(--color-warning-fg));
  }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--color-muted-foreground);
    border-radius: var(--radius-sm);
    padding: var(--space-1);
  }
  .icon-btn:hover {
    background: var(--hairline);
  }
  .busy-label {
    color: var(--color-text-tertiary);
    padding: 0 var(--space-2);
  }
  .fld {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--font-size-body);
    color: var(--color-muted-foreground);
  }
  .inp {
    height: 1.75rem;
    padding: 0 var(--space-2);
    font-size: var(--font-size-body);
    border-radius: var(--radius-sm);
    background: var(--color-bg3);
    border: 1px solid var(--hairline);
    color: var(--color-foreground);
  }
  .err-msg {
    font-size: var(--font-size-body);
    color: var(--color-destructive);
  }
</style>
