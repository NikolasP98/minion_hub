<script lang="ts">
  /**
   * Notion-style multi-select over ONE scope's tag registry: the selected tags
   * sit as removable chips and a "+" pill opens `TagOptionList` (search, toggle,
   * create-on-the-spot, rename/recolour/delete). Only manages the selected id
   * list — the caller PUTs `/api/tags/[kind]/[id]` after its own save (or on
   * every change, via `onchange`).
   */
  import { onDestroy } from 'svelte';
  import { ApiError } from '$lib/api/fetch-json';
  import { preferenceOwner } from '$lib/state/ui/scoped-preference.svelte';
  import { toastError } from '$lib/state/ui/toast.svelte';
  import { Spinner } from '$lib/components/ui';
  import { Plus } from 'lucide-svelte';
  import { Popover, iconSizes } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import type { CalTag } from '$lib/components/scheduling/calendar/types';
  import type { TagScope } from '$lib/tags/scope';
  import TagChip from './TagChip.svelte';
  import TagOptionList from './TagOptionList.svelte';

  let {
    scope,
    scopeKey,
    allTags,
    value = $bindable([]),
    disabled = false,
    selectionDisabled = false,
    showAdd = true,
    open = $bindable(false),
    onchange,
    onregistrychange,
  }: {
    /** The ONE category these tags belong to — `allTags` must be that scope's list. */
    scope: TagScope;
    /** Record identity for an async selection handler; retires late replies. */
    scopeKey?: string;
    /** Every tag defined for the org in `scope`. */
    allTags: CalTag[];
    /** Selected tag ids (bindable). */
    value?: string[];
    disabled?: boolean;
    /** Leave the open picker mounted during persistence while preventing a
     * second selection change. */
    selectionDisabled?: boolean;
    /** Field mode (default): a visible "+ Add tag" trigger and removable (×)
     *  chips. Table mode (`false`): no trigger, no ×, the picker's `open`
     *  state is driven by the caller instead (DataTable's cell selection). */
    showAdd?: boolean;
    /** Picker open state — bindable so a table cell can open/close it
     *  externally when `showAdd` is false. */
    open?: boolean;
    /** Fires after intent is visible. Return the write/refresh promise for
     * pending feedback; false or a rejected 4xx rolls back. Unknown outcomes
     * retain the draft with a message and are never automatically replayed. */
    onchange?: (ids: string[]) => void | boolean | Promise<unknown>;
    /** Promotes registry mutations out of this field so sibling rows and
     * filters never keep a stale local-only overlay. */
    onregistrychange?: (tags: CalTag[]) => void;
  } = $props();

  // Local registry overlay: tags created/renamed/deleted from the option list
  // show immediately; it resyncs whenever the parent hands down a fresh list.
  let tags = $state<CalTag[]>([]);
  $effect(() => {
    tags = allTags;
  });
  const selectedSet = $derived(new Set(value));
  const selected = $derived(
    value.map((id) => tags.find((t) => t.id === id)).filter((t): t is CalTag => !!t),
  );

  let pending = $state(false);
  let revision = 0;
  let disposed = false;
  const identity = () => JSON.stringify([preferenceOwner(), scope, scopeKey]);
  let activeIdentity = identity();
  $effect.pre(() => {
    const next = identity();
    if (next === activeIdentity) return;
    activeIdentity = next;
    revision += 1;
    pending = false;
  });
  onDestroy(() => {
    disposed = true;
    revision += 1;
  });
  async function set(ids: string[]) {
    if (pending || selectionDisabled) return;
    const previous = [...value];
    const ownRevision = ++revision;
    const owner = identity();
    const current = () => !disposed && ownRevision === revision && identity() === owner;
    value = ids;
    try {
      const result = onchange?.(ids);
      if (result && typeof result === 'object' && 'then' in result) pending = true;
      const accepted = await result;
      if (current() && accepted === false) {
        value = previous;
        toastError(m.data_table_save_failed());
      }
    } catch (error) {
      if (!current()) return;
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        value = previous;
        toastError(error.message);
      } else {
        // A lost response is not a rejection. Preserve the visible draft and
        // never replay a write just because its acknowledgement was lost.
        toastError(m.asyncAction_unknown());
      }
    } finally {
      if (current()) pending = false;
    }
  }
  function toggle(id: string) {
    if (selectionDisabled) return;
    void set(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }
  function setTags(next: CalTag[]) {
    tags = next;
    onregistrychange?.(next);
  }
  async function reconcileRegistry(): Promise<CalTag[]> {
    const response = await fetch(`/api/tags?scope=${scope}`);
    if (!response.ok) throw new Error(String(response.status));
    const next = ((await response.json()) as { tags: CalTag[] }).tags;
    setTags(next);
    return next;
  }
</script>

<div class="tags-field" aria-busy={pending || undefined}>
  {#if pending}<Spinner size="xs" />{/if}
  {#each selected as t (t.id)}
    <TagChip
      name={t.name}
      color={t.color}
      onremove={disabled || !showAdd ? undefined : () => toggle(t.id)}
    />
  {/each}
  {#if !disabled}
    <Popover bind:open placement="bottom">
      {#snippet trigger()}
        {#if showAdd}
          <span class="add-pill">
            <Plus size={iconSizes.xs} />{selected.length ? '' : m.tags_add()}
          </span>
        {/if}
      {/snippet}
      <TagOptionList
        {scope}
        {tags}
        selected={selectedSet}
        disabled={selectionDisabled || pending}
        ontoggle={toggle}
        onreconcile={reconcileRegistry}
        oncreate={(t) => setTags([...tags, t])}
        onupdate={(t) => setTags(tags.map((x) => (x.id === t.id ? t : x)))}
        ondelete={(id) => {
          setTags(tags.filter((x) => x.id !== id));
          if (value.includes(id)) set(value.filter((v) => v !== id));
        }}
      />
    </Popover>
  {/if}
</div>

<style>
  .tags-field {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
    min-width: 0;
    max-width: 100%;
  }
  .add-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-height: 1.6rem;
    padding: 0 var(--space-2);
    border-radius: var(--radius-full);
    border: 1px dashed var(--color-border-strong);
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
    transition: color var(--duration-fast) var(--ease-standard);
  }
  .add-pill:hover {
    color: var(--color-accent);
    border-color: var(--color-accent);
  }
</style>
