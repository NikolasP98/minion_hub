<script lang="ts">
  import { Check, MoreHorizontal, Plus, Trash2 } from 'lucide-svelte';
  import { Button, Input, Popover, Spinner, iconSizes } from '$lib/components/ui';
  import TagChip from '$lib/components/tags/TagChip.svelte';
  import * as m from '$lib/paraglide/messages';
  import { PRODUCT_CATEGORY_COLORS, type ProductCategoryColor } from '$lib/catalog/categories';
  import { tryUseActions } from '$lib/services/actions/context';
  import type { CommandContext } from '$lib/services/actions/definition';

  export type ProductCategoryOption = { id: string; name: string; color: ProductCategoryColor };
  let {
    value,
    categories,
    canEdit,
    onsave,
    onregistrychange,
  }: {
    value: string | null;
    categories: ProductCategoryOption[];
    canEdit: boolean;
    onsave: (value: string | null) => Promise<boolean>;
    onregistrychange: (
      categories: ProductCategoryOption[],
      change?: { from: string; to: string | null },
    ) => void;
  } = $props();

  let open = $state(false),
    busy = $state(false),
    failed = $state(false);
  let uncertain = $state(false);
  let confirmDeleteId = $state<string | null>(null);
  let query = $state(''),
    editingId = $state<string | null>(null),
    editName = $state('');
  let editColor = $state<ProductCategoryColor>(PRODUCT_CATEGORY_COLORS[0]);
  const actions = tryUseActions();
  const selected = $derived(categories.find((category) => category.name === value));
  const filtered = $derived(
    query.trim()
      ? categories.filter((category) =>
          category.name.toLowerCase().includes(query.trim().toLowerCase()),
        )
      : categories,
  );

  async function api(method: string, path: string, body?: unknown, context?: CommandContext) {
    const response = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: context?.signal,
    });
    if (!response.ok) throw new Error(String(response.status));
    return response.status === 204 ? null : response.json();
  }
  async function mutate<T>(work: (context?: CommandContext) => Promise<T>): Promise<T> {
    if (!actions) {
      try {
        return await work();
      } catch (error) {
        uncertain = error instanceof TypeError;
        throw error;
      }
    }
    const outcome = await actions.runCommand<T>('catalog.category.manage', async (context) => {
      try {
        const result = await context.attempt('catalog.category.request', () => work(context));
        if (!context.isCurrent()) return { status: 'unknown' };
        context.acknowledge();
        return { status: 'succeeded', value: result };
      } catch (error) {
        return { status: error instanceof TypeError ? 'unknown' : 'failed', error };
      }
    });
    if (outcome.status !== 'succeeded') {
      uncertain = outcome.status === 'unknown';
      throw outcome.error ?? new Error(outcome.status);
    }
    uncertain = false;
    return outcome.value;
  }
  async function reconcileCategories(): Promise<ProductCategoryOption[] | null> {
    try {
      const response = await fetch('/api/pos/categories');
      if (!response.ok) return null;
      const body = (await response.json()) as { categories: ProductCategoryOption[] };
      onregistrychange(body.categories);
      uncertain = false;
      return body.categories;
    } catch {
      return null;
    }
  }
  async function reconcileBeforeMutation(): Promise<boolean> {
    return !uncertain || (await reconcileCategories()) !== null;
  }
  async function choose(next: string | null) {
    if (busy || next === value) {
      open = false;
      return;
    }
    busy = true;
    failed = false;
    try {
      if (await onsave(next)) open = false;
      else {
        await reconcileCategories();
        failed = true;
      }
    } catch {
      await reconcileCategories();
      failed = true;
    } finally {
      busy = false;
    }
  }
  async function create() {
    const name = query.trim();
    if (!name || busy) return;
    if (!(await reconcileBeforeMutation())) return;
    busy = true;
    failed = false;
    try {
      const { category } = (await mutate((context) =>
        api('POST', '/api/pos/categories', { name, color: editColor }, context),
      )) as { category: ProductCategoryOption };
      onregistrychange([...categories, category]);
      query = '';
      busy = false;
      await choose(category.name);
    } catch {
      const reconciled = await reconcileCategories();
      const created = reconciled?.find((category) => category.name === name);
      if (created) {
        query = '';
        busy = false;
        await choose(created.name);
        return;
      }
      failed = true;
      busy = false;
    }
  }
  function edit(category: ProductCategoryOption) {
    editingId = category.id;
    editName = category.name;
    editColor = category.color;
  }
  async function update(category: ProductCategoryOption) {
    const name = editName.trim();
    if (!name || busy) return;
    if (!(await reconcileBeforeMutation())) return;
    busy = true;
    failed = false;
    try {
      const result = (await mutate((context) =>
        api('PATCH', `/api/pos/categories/${category.id}`, { name, color: editColor }, context),
      )) as { category: ProductCategoryOption };
      onregistrychange(
        categories.map((item) => (item.id === category.id ? result.category : item)),
        { from: category.name, to: result.category.name },
      );
      editingId = null;
    } catch {
      const reconciled = await reconcileCategories();
      const current = reconciled?.find((item) => item.id === category.id);
      if (current?.name === name && current.color === editColor) {
        onregistrychange(reconciled!, { from: category.name, to: current.name });
        editingId = null;
        return;
      }
      failed = true;
    } finally {
      busy = false;
    }
  }
  async function remove(category: ProductCategoryOption) {
    if (busy) return;
    if (!(await reconcileBeforeMutation())) return;
    busy = true;
    failed = false;
    try {
      await mutate((context) =>
        api('DELETE', `/api/pos/categories/${category.id}`, undefined, context),
      );
      onregistrychange(
        categories.filter((item) => item.id !== category.id),
        { from: category.name, to: null },
      );
      editingId = null;
      confirmDeleteId = null;
    } catch {
      const reconciled = await reconcileCategories();
      if (reconciled && !reconciled.some((item) => item.id === category.id)) {
        onregistrychange(reconciled, { from: category.name, to: null });
        editingId = null;
        confirmDeleteId = null;
        return;
      }
      failed = true;
    } finally {
      busy = false;
    }
  }
</script>

<div class="category-cell">
  <Popover bind:open placement="bottom" disabled={!canEdit}>
    {#snippet trigger()}
      {#if selected}<TagChip size="sm" name={selected.name} color={selected.color} />
      {:else if value}<TagChip size="sm" name={value} dashed title={m.pos_category_legacy()} />
      {:else}<span class="empty">{m.pos_category_empty()}</span>{/if}
    {/snippet}
    <div class="category-panel">
      <Input
        size="sm"
        bind:value={query}
        placeholder={m.pos_category_search()}
        disabled={busy}
        onkeydown={(event: KeyboardEvent) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            const exact = categories.find(
              (category) => category.name.toLowerCase() === query.trim().toLowerCase(),
            );
            if (exact) void choose(exact.name);
            else void create();
          }
        }}
      />
      <Button
        variant="ghost"
        size="xs"
        class="category-row"
        onclick={() => choose(null)}
        disabled={busy}
      >
        <span class="mark"
          >{#if !value}<Check size={iconSizes.xs} />{/if}</span
        >{m.pos_category_empty()}
      </Button>
      {#each filtered as category (category.id)}
        <div class="option">
          <Button
            variant="ghost"
            size="xs"
            class="category-row"
            onclick={() => choose(category.name)}
            disabled={busy}
          >
            <span class="mark"
              >{#if value === category.name}<Check size={iconSizes.xs} />{/if}</span
            >
            <TagChip size="sm" name={category.name} color={category.color} />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            shape="icon"
            aria-label={m.tags_options()}
            disabled={busy}
            onclick={() => edit(category)}
          >
            <MoreHorizontal size={iconSizes.xs} />
          </Button>
        </div>
        {#if editingId === category.id}
          <div class="editor">
            <Input size="sm" bind:value={editName} disabled={busy} />
            <div class="colors">
              {#each PRODUCT_CATEGORY_COLORS as color}
                <Button
                  variant="ghost"
                  size="xs"
                  shape="icon"
                  class={`color-choice ${editColor === color ? 'chosen' : ''}`}
                  style="--c:{color}"
                  aria-label={m.pos_category_color_choice()}
                  onclick={() => (editColor = color)}
                />
              {/each}
            </div>
            {#if confirmDeleteId === category.id}
              <p class="t-caption consequence">{m.pos_category_delete_consequence()}</p>
              <div class="actions">
                <Button variant="danger" size="xs" onclick={() => remove(category)}
                  >{m.common_delete()}</Button
                >
                <Button variant="ghost" size="xs" onclick={() => (confirmDeleteId = null)}
                  >{m.common_cancel()}</Button
                >
              </div>
            {:else}
              <div class="actions">
                <Button variant="ghost" size="xs" onclick={() => (confirmDeleteId = category.id)}
                  ><Trash2 size={iconSizes.xs} />{m.common_delete()}</Button
                >
                <Button size="xs" onclick={() => update(category)}>{m.common_save()}</Button>
              </div>
            {/if}
          </div>
        {/if}
      {/each}
      {#if query.trim() && !categories.some((category) => category.name.toLowerCase() === query
              .trim()
              .toLowerCase())}
        <Button variant="ghost" size="xs" class="category-row" onclick={create} disabled={busy}>
          <Plus size={iconSizes.xs} />{m.tags_create_named({ name: query.trim() })}
        </Button>
      {/if}
      {#if failed}<p class="t-caption error">{m.data_table_save_failed()}</p>{/if}
    </div>
  </Popover>
  {#if busy}<Spinner size="xs" label={m.misc_saving()} />{/if}
</div>

<style>
  .category-cell,
  .option,
  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .category-panel {
    min-width: 15rem;
    max-width: 20rem;
    padding: var(--space-2);
  }
  .option :global(.category-row),
  .category-panel :global(.category-row) {
    flex: 1;
    justify-content: flex-start;
  }
  .mark {
    width: 1rem;
    display: inline-grid;
    place-items: center;
  }
  .empty {
    color: var(--color-text-tertiary);
  }
  .editor {
    padding: var(--space-2);
    background: var(--color-surface-2);
    border-radius: var(--radius-md);
  }
  .colors {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin: var(--space-2) 0;
  }
  .colors :global(.color-choice) {
    background: var(--c);
    border: 1px solid transparent;
  }
  .colors :global(button.chosen) {
    border-color: var(--color-text-primary);
  }
  .actions {
    justify-content: flex-end;
  }
  .error {
    color: var(--color-danger-fg);
  }
  .consequence {
    color: var(--color-text-secondary);
    white-space: normal;
    overflow-wrap: anywhere;
  }
</style>
