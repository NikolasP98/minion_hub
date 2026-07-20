<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { Plus, Trash2, CornerDownRight } from 'lucide-svelte';
  import { Button, Input, Select, iconSizes } from '$lib/components/ui';
  import { toastError } from '$lib/state/ui/toast.svelte';

  interface ItemLike {
    id: string;
    code: string;
    name: string;
    uom: string;
    isStockItem?: boolean;
  }
  interface Edge {
    parentItemId: string;
    childItemId: string;
    qty: number;
  }

  interface Props {
    /** The item whose recipe this is — a sellable's backing stk_item. */
    itemId: string;
    items: ItemLike[];
    /** The WHOLE org graph: nesting display and the cycle filter both need it. */
    edges: Edge[];
    canEdit: boolean;
    onChanged: () => void;
  }

  let { itemId, items, edges, canEdit, onChanged }: Props = $props();

  const itemById = $derived(new Map(items.map((i) => [i.id, i])));
  const byParent = $derived.by(() => {
    const map = new Map<string, Edge[]>();
    for (const e of edges) {
      const list = map.get(e.parentItemId) ?? [];
      list.push(e);
      map.set(e.parentItemId, list);
    }
    return map;
  });

  const children = $derived(byParent.get(itemId) ?? []);

  /**
   * Mirrors the server's wouldCreateComponentCycle so the picker never offers a
   * child that the API would reject: adding parent→child loops iff `child` can
   * already reach `parent`.
   */
  function reaches(from: string, target: string): boolean {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const cur = stack.pop() as string;
      if (cur === target) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const e of byParent.get(cur) ?? []) stack.push(e.childItemId);
    }
    return false;
  }

  const alreadyUsed = $derived(new Set(children.map((c) => c.childItemId)));
  const candidates = $derived(items.filter((i) => i.id !== itemId && !alreadyUsed.has(i.id) && !reaches(i.id, itemId)));

  /** Depth of the subtree under an item — surfaces nesting at a glance. */
  function depthOf(id: string, guard: Set<string> = new Set()): number {
    if (guard.has(id)) return 0;
    guard.add(id);
    let deepest = 0;
    for (const e of byParent.get(id) ?? []) deepest = Math.max(deepest, 1 + depthOf(e.childItemId, guard));
    guard.delete(id);
    return deepest;
  }

  let newChildId = $state('');
  let newQty = $state('');
  let busy = $state(false);

  async function addComponent() {
    if (!newChildId || !(Number(newQty) > 0)) return;
    busy = true;
    try {
      const res = await fetch(`/api/stock/items/${itemId}/components`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ childItemId: newChildId, qty: Number(newQty) }),
      });
      if (res.ok) {
        newChildId = '';
        newQty = '';
        onChanged();
      } else {
        const d = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
        toastError(d.code === 'component_cycle' ? m.pos_recipe_cycle() : (d.error ?? m.data_table_save_failed()));
      }
    } finally {
      busy = false;
    }
  }

  async function removeComponent(childItemId: string) {
    // The delete endpoint keys on the edge id; find it from the loaded rows.
    const res = await fetch(`/api/stock/items/${itemId}/components`, { method: 'GET' });
    if (!res.ok) return toastError(m.data_table_save_failed());
    const { components } = (await res.json()) as { components: Array<{ id: string; childItemId: string }> };
    const edge = components.find((c) => c.childItemId === childItemId);
    if (!edge) return onChanged();
    const del = await fetch(`/api/stock/items/${itemId}/components`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ componentId: edge.id }),
    });
    if (del.ok) onChanged();
    else toastError(m.data_table_save_failed());
  }
</script>

<!-- Recursive read-out of the sub-tree; the EDITOR only mutates this item's
     direct children, deeper levels are edited from their own row. -->
{#snippet subtree(id: string, depth: number)}
  {#each byParent.get(id) ?? [] as e (e.childItemId)}
    <div class="sub" style:--d={depth}>
      <CornerDownRight size={iconSizes.xs} class="sub-icon" />
      <span class="tabular-nums sub-qty">{e.qty}</span>
      <span class="sub-name">{itemById.get(e.childItemId)?.name ?? e.childItemId}</span>
    </div>
    {@render subtree(e.childItemId, depth + 1)}
  {/each}
{/snippet}

<div class="recipe">
  <p class="t-caption head">
    {m.pos_recipe_title()}
    {#if depthOf(itemId) > 1}<span class="depth">{m.pos_recipe_depth({ n: depthOf(itemId) })}</span>{/if}
  </p>

  {#if children.length === 0}
    <p class="t-caption empty">{m.pos_recipe_empty()}</p>
  {:else}
    <ul class="rows">
      {#each children as c (c.childItemId)}
        {@const child = itemById.get(c.childItemId)}
        <li>
          <div class="row">
            <span class="tabular-nums qty">{c.qty}</span>
            <span class="uom">{child?.uom ?? ''}</span>
            <span class="name">{child?.name ?? c.childItemId}</span>
            {#if (byParent.get(c.childItemId) ?? []).length}
              <span class="tag">{m.pos_recipe_is_recipe()}</span>
            {/if}
            {#if canEdit}
              <Button
                variant="ghost"
                size="sm"
                onclick={() => removeComponent(c.childItemId)}
                aria-label={m.common_remove()}><Trash2 size={iconSizes.xs} /></Button
              >
            {/if}
          </div>
          {@render subtree(c.childItemId, 1)}
        </li>
      {/each}
    </ul>
  {/if}

  {#if canEdit}
    <div class="add">
      <Select fieldClass="min-w-0 flex-1" bind:value={newChildId}>
        <option value="">{m.pos_recipe_pick_child()}…</option>
        {#each candidates as i (i.id)}
          <option value={i.id}>{i.code} — {i.name}</option>
        {/each}
      </Select>
      <Input size="sm" class="w-24" type="number" min="0" step="any" placeholder={m.pos_catalog_qty_per_unit()} bind:value={newQty} />
      <Button variant="outline" size="sm" onclick={addComponent} disabled={busy || !newChildId || !(Number(newQty) > 0)}>
        <Plus size={iconSizes.xs} />
        {m.common_add()}
      </Button>
    </div>
  {/if}
</div>

<style>
  .recipe {
    padding: var(--space-2) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .head {
    color: var(--color-text-tertiary);
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .depth {
    color: var(--color-info-fg);
  }
  .empty {
    color: var(--color-text-tertiary);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-body);
  }
  .qty {
    font-weight: 600;
  }
  .uom,
  .sub-qty {
    color: var(--color-text-tertiary);
  }
  .tag {
    font-size: var(--font-size-caption);
    color: var(--color-info-fg);
  }
  .sub {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
    padding-left: calc(var(--d, 1) * var(--space-4));
  }
  .recipe :global(.sub-icon) {
    color: var(--color-text-tertiary);
  }
  .add {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
</style>
