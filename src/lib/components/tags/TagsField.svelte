<script lang="ts">
  /**
   * Notion-style multi-select over ONE scope's tag registry: the selected tags
   * sit as removable chips and a "+" pill opens `TagOptionList` (search, toggle,
   * create-on-the-spot, rename/recolour/delete). Only manages the selected id
   * list — the caller PUTs `/api/tags/[kind]/[id]` after its own save (or on
   * every change, via `onchange`).
   */
  import { Plus } from 'lucide-svelte';
  import { Popover, iconSizes } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import type { CalTag } from '$lib/components/scheduling/calendar/types';
  import type { TagScope } from '$lib/tags/scope';
  import TagChip from './TagChip.svelte';
  import TagOptionList from './TagOptionList.svelte';

  let {
    scope,
    allTags,
    value = $bindable([]),
    disabled = false,
    selectionDisabled = false,
    onchange,
    onregistrychange,
  }: {
    /** The ONE category these tags belong to — `allTags` must be that scope's list. */
    scope: TagScope;
    /** Every tag defined for the org in `scope`. */
    allTags: CalTag[];
    /** Selected tag ids (bindable). */
    value?: string[];
    disabled?: boolean;
    /** Leave the open picker mounted during persistence while preventing a
     * second selection change. */
    selectionDisabled?: boolean;
    /** Fires after every selection change with the new id list. */
    onchange?: (ids: string[]) => void;
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
  let open = $state(false);
  const selectedSet = $derived(new Set(value));
  const selected = $derived(
    value.map((id) => tags.find((t) => t.id === id)).filter((t): t is CalTag => !!t),
  );

  function set(ids: string[]) {
    value = ids;
    onchange?.(ids);
  }
  function toggle(id: string) {
    if (selectionDisabled) return;
    set(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
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

<div class="tags-field">
  {#each selected as t (t.id)}
    <TagChip name={t.name} color={t.color} onremove={disabled ? undefined : () => toggle(t.id)} />
  {/each}
  {#if !disabled}
    <Popover bind:open placement="bottom">
      {#snippet trigger()}
        <span class="add-pill">
          <Plus size={iconSizes.xs} />{selected.length ? '' : m.tags_add()}
        </span>
      {/snippet}
      <TagOptionList
        {scope}
        {tags}
        selected={selectedSet}
        disabled={selectionDisabled}
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
