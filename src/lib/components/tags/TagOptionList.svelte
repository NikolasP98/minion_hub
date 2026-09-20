<script lang="ts">
  /**
   * Notion-style tag option list — the shared body of `TagsField` (multi-select
   * on an entity) and `TagFilter` (calendar filter). One search box that
   * filters the scope's tags and offers "Create “…”" for a new name; every
   * row toggles on click and carries a ⋯ menu to rename, recolour or delete
   * the tag (a delete removes it everywhere it is applied). All mutations hit
   * `/api/tags*` and are reported up through `oncreate`/`onupdate`/`ondelete`
   * so the host keeps its own list in sync without a reload.
   */
  import { tick } from 'svelte';
  import { Check, MoreHorizontal, Plus, Trash2 } from 'lucide-svelte';
  import { Button, Input, iconSizes } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { CRM_TAG_COLORS } from '$lib/components/crm/tag-colors';
  import type { CalTag } from '$lib/components/scheduling/calendar/types';
  import type { TagScope } from '$lib/tags/scope';
  import TagChip from './TagChip.svelte';

  let {
    scope,
    tags,
    selected,
    ontoggle,
    oncreate,
    onupdate,
    ondelete,
    allowCreate = true,
    allowEdit = true,
    header,
  }: {
    scope: TagScope;
    tags: CalTag[];
    selected: Set<string>;
    ontoggle: (id: string) => void;
    oncreate?: (tag: CalTag) => void;
    onupdate?: (tag: CalTag) => void;
    ondelete?: (id: string) => void;
    allowCreate?: boolean;
    allowEdit?: boolean;
    /** Optional row rendered above the list (e.g. the filter's "All"). */
    header?: import('svelte').Snippet;
  } = $props();

  const HINT: Record<TagScope, () => string> = {
    crm: m.tags_scope_hint_crm,
    stock: m.tags_scope_hint_stock,
    catalog: m.tags_scope_hint_catalog,
    event: m.tags_scope_hint_event,
  };

  let query = $state('');
  let busy = $state(false);
  let err = $state<string | null>(null);
  let editingId = $state<string | null>(null);
  let editName = $state('');
  let editColor = $state<string | null>(null);
  let confirmDelete = $state(false);
  let searchEl = $state<HTMLInputElement | null>(null);

  const q = $derived(query.trim().toLowerCase());
  const filtered = $derived(q ? tags.filter((t) => t.name.toLowerCase().includes(q)) : tags);
  const exact = $derived(tags.find((t) => t.name.trim().toLowerCase() === q) ?? null);
  const canCreate = $derived(allowCreate && q.length > 0 && !exact);

  $effect(() => {
    // Focus the search on mount (the popover just opened).
    void tick().then(() => searchEl?.focus());
  });

  async function api(method: string, path: string, body?: unknown) {
    const res = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(j?.message ?? `${res.status}`);
    }
    return res.status === 204 ? null : res.json();
  }

  async function create() {
    const name = query.trim();
    if (!name || busy || !allowCreate) return;
    busy = true;
    err = null;
    try {
      const color = CRM_TAG_COLORS[tags.length % CRM_TAG_COLORS.length];
      const { tag } = (await api('POST', '/api/tags', { scope, name, color })) as { tag: CalTag };
      oncreate?.(tag);
      ontoggle(tag.id);
      query = '';
    } catch (e) {
      err = e instanceof Error && e.message !== '400' ? e.message : m.tags_create_failed();
    } finally {
      busy = false;
    }
  }

  function onSearchKey(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (exact) ontoggle(exact.id);
    else void create();
  }

  function openEdit(t: CalTag) {
    editingId = t.id;
    editName = t.name;
    editColor = t.color;
    confirmDelete = false;
    err = null;
  }
  function closeEdit() {
    editingId = null;
    confirmDelete = false;
  }

  async function saveEdit(t: CalTag) {
    const name = editName.trim();
    if (!name || busy) return;
    if (name === t.name && editColor === t.color) return closeEdit();
    busy = true;
    err = null;
    try {
      const { tag } = (await api('PATCH', `/api/tags/${t.id}`, {
        ...(name !== t.name ? { name } : {}),
        ...(editColor !== t.color ? { color: editColor } : {}),
      })) as { tag: CalTag };
      onupdate?.(tag);
      closeEdit();
    } catch {
      err = m.tags_create_failed();
    } finally {
      busy = false;
    }
  }

  async function pickColor(t: CalTag, color: string) {
    editColor = color;
    if (busy) return;
    busy = true;
    try {
      const { tag } = (await api('PATCH', `/api/tags/${t.id}`, { color })) as { tag: CalTag };
      onupdate?.(tag);
    } catch {
      err = m.tags_create_failed();
    } finally {
      busy = false;
    }
  }

  async function remove(t: CalTag) {
    if (busy) return;
    busy = true;
    err = null;
    try {
      await api('DELETE', `/api/tags/${t.id}`);
      ondelete?.(t.id);
      closeEdit();
    } catch {
      err = m.tags_delete_failed();
    } finally {
      busy = false;
    }
  }
</script>

<div class="tol" role="listbox" aria-multiselectable="true" aria-label={m.tags_label()}>
  <!-- svelte-ignore a11y_autofocus -- the popover just opened on the user's click -->
  <input
    class="search"
    bind:this={searchEl}
    bind:value={query}
    placeholder={allowCreate ? m.tags_search_placeholder() : m.tags_label()}
    onkeydown={onSearchKey}
    disabled={busy}
  />
  {#if header}{@render header()}{/if}
  <div class="rows">
    {#each filtered as t (t.id)}
      <div class="opt" class:editing={editingId === t.id}>
        <Button
          variant="ghost"
          size="xs"
          class="row"
          role="option"
          aria-selected={selected.has(t.id)}
          onclick={() => ontoggle(t.id)}
        >
          <span class="box" class:on={selected.has(t.id)}>
            {#if selected.has(t.id)}<Check size={iconSizes.xs} />{/if}
          </span>
          <TagChip size="sm" name={t.name} color={t.color} origin={t.origin} />
        </Button>
        {#if allowEdit}
          <Button
            variant="ghost"
            size="xs"
            shape="icon"
            class="more"
            aria-label={m.tags_options()}
            aria-expanded={editingId === t.id}
            onclick={() => (editingId === t.id ? closeEdit() : openEdit(t))}
          >
            <MoreHorizontal size={iconSizes.xs} />
          </Button>
        {/if}
      </div>
      {#if editingId === t.id}
        <div class="editor">
          <Input
            size="sm"
            bind:value={editName}
            placeholder={m.tags_rename()}
            disabled={busy}
            onkeydown={(e: KeyboardEvent) => {
              if (e.key === 'Enter') void saveEdit(t);
              if (e.key === 'Escape') closeEdit();
            }}
          />
          <div class="swatches" role="radiogroup" aria-label={m.crm_tag_color()}>
            {#each CRM_TAG_COLORS as c (c)}
              <Button
                variant="ghost"
                size="xs"
                shape="icon"
                class="swatch {editColor === c ? 'sel' : ''}"
                role="radio"
                aria-checked={editColor === c}
                aria-label={c}
                style="--c: {c}"
                disabled={busy}
                onclick={() => pickColor(t, c)}
              ></Button>
            {/each}
          </div>
          <div class="editor-actions">
            {#if confirmDelete}
              <span class="t-caption">{m.tags_delete_confirm()}</span>
              <Button variant="danger" size="xs" disabled={busy} onclick={() => remove(t)}>
                {m.common_delete()}
              </Button>
              <Button variant="ghost" size="xs" onclick={() => (confirmDelete = false)}>
                {m.common_cancel()}
              </Button>
            {:else}
              <Button
                variant="ghost"
                size="xs"
                class="del"
                disabled={busy}
                onclick={() => (confirmDelete = true)}
              >
                <Trash2 size={iconSizes.xs} />{m.common_delete()}
              </Button>
              <span class="grow"></span>
              <Button size="xs" disabled={busy || !editName.trim()} onclick={() => saveEdit(t)}>
                {m.common_save()}
              </Button>
            {/if}
          </div>
        </div>
      {/if}
    {/each}
    {#if canCreate}
      <Button variant="ghost" size="xs" class="row create" disabled={busy} onclick={create}>
        <Plus size={iconSizes.xs} />
        <span class="lbl">{m.tags_create_named({ name: query.trim() })}</span>
      </Button>
    {:else if filtered.length === 0}
      <p class="t-caption empty">{q ? m.tags_no_match() : m.tags_none()}</p>
    {/if}
  </div>
  {#if err}<p class="t-caption err">{err}</p>{/if}
  <p class="t-caption hint">{HINT[scope]()}</p>
</div>

<style>
  .tol {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 15rem;
    max-width: 20rem;
  }
  .search {
    height: var(--control-height-sm);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: 0 var(--space-2);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-size: var(--font-size-caption);
    width: 100%;
  }
  .search:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus);
  }
  .rows {
    display: flex;
    flex-direction: column;
    max-height: 50vh;
    overflow-y: auto;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: var(--space-0-5);
  }
  .tol :global(.row) {
    flex: 1;
    justify-content: flex-start;
    min-width: 0;
  }
  .tol :global(.row > span) {
    gap: var(--space-2);
    justify-content: flex-start;
    width: 100%;
  }
  .opt :global(.more) {
    color: var(--color-text-tertiary);
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease-standard);
  }
  .opt:hover :global(.more),
  .opt:focus-within :global(.more),
  .opt.editing :global(.more) {
    opacity: 1;
  }
  @media (hover: none) {
    .opt :global(.more) {
      opacity: 1;
    }
  }
  .box {
    display: inline-grid;
    place-items: center;
    width: 1rem;
    height: 1rem;
    box-sizing: border-box;
    border-radius: var(--radius-xs);
    border: 1px solid var(--color-border-strong);
    background: var(--color-surface-2);
    color: var(--color-on-accent);
    flex-shrink: 0;
  }
  .box.on {
    background: var(--color-accent);
    border-color: var(--color-accent);
  }
  .tol :global(.row.create) {
    justify-content: flex-start;
    color: var(--color-accent);
  }
  .tol :global(.row.create > span) {
    gap: var(--space-2);
    justify-content: flex-start;
  }
  .lbl {
    color: inherit;
  }
  .editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
    margin: 0 0 var(--space-1);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .swatches :global(.swatch) {
    width: 1.1rem;
    height: 1.1rem;
    min-height: 0;
    padding: 0;
    border-radius: var(--radius-full);
    background: var(--c);
    border: 2px solid transparent;
  }
  .swatches :global(.swatch:hover) {
    background: var(--c);
  }
  .swatches :global(.swatch.sel) {
    border-color: var(--color-text-primary);
  }
  .editor-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .grow {
    flex: 1;
  }
  .editor :global(.del) {
    color: var(--color-danger-fg);
  }
  .empty,
  .hint {
    color: var(--color-text-secondary);
    padding: var(--space-1) var(--space-1) 0;
  }
  .err {
    color: var(--color-danger-fg);
    padding: 0 var(--space-1);
  }
</style>
