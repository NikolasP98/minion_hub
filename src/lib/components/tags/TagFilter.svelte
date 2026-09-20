<script lang="ts">
  /**
   * Toolbar tag filter for calendars (tables use the DataTable column filter):
   * the same Notion-style `TagOptionList` with an "All" row on top, so tags can
   * be filtered, created, renamed, recoloured or deleted from the very same
   * popover. Empty selection = no filtering.
   */
  import { Tag as TagIcon, Check } from 'lucide-svelte';
  import { Button, Popover, iconSizes } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import type { CalTag } from '$lib/components/scheduling/calendar/types';
  import type { TagScope } from '$lib/tags/scope';
  import TagOptionList from './TagOptionList.svelte';

  let {
    scope,
    tags: allTags,
    selected,
    onselect,
    ontagschange,
    label = m.tags_label(),
  }: {
    /** Scope whose tags the list creates/edits. */
    scope: TagScope;
    tags: CalTag[];
    /** Empty = all. */
    selected: Set<string>;
    onselect: (next: Set<string>) => void;
    /** A tag was created/renamed/deleted — host reloads its data (e.g. `invalidate`). */
    ontagschange?: () => void | Promise<void>;
    label?: string;
  } = $props();

  let tags = $state<CalTag[]>([]);
  $effect(() => {
    tags = allTags;
  });
  let open = $state(false);
  const active = $derived(selected.size > 0);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onselect(next);
  }
</script>

<Popover bind:open placement="bottom-end">
  {#snippet trigger()}
    <span class="tf-trigger" class:active>
      <TagIcon size={iconSizes.sm} />
      <span>{label}</span>
      {#if active}<span class="badge">{selected.size}</span>{/if}
    </span>
  {/snippet}
  <TagOptionList
    {scope}
    {tags}
    {selected}
    ontoggle={toggle}
    oncreate={(t) => {
      tags = [...tags, t];
      void ontagschange?.();
    }}
    onupdate={(t) => {
      tags = tags.map((x) => (x.id === t.id ? t : x));
      void ontagschange?.();
    }}
    ondelete={(id) => {
      tags = tags.filter((x) => x.id !== id);
      if (selected.has(id)) onselect(new Set([...selected].filter((s) => s !== id)));
      void ontagschange?.();
    }}
  >
    {#snippet header()}
      <Button
        variant="ghost"
        size="xs"
        class="row"
        role="option"
        aria-selected={!active}
        onclick={() => onselect(new Set())}
      >
        <span class="box" class:on={!active}
          >{#if !active}<Check size={iconSizes.xs} />{/if}</span
        >
        <span>{m.crm_filter_all()}</span>
      </Button>
    {/snippet}
  </TagOptionList>
</Popover>

<style>
  .tf-trigger {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    height: var(--control-height-sm);
    padding: 0 var(--space-2);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
  }
  .tf-trigger:hover {
    color: var(--color-text-primary);
  }
  .tf-trigger.active {
    color: var(--color-accent);
    border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }
  .badge {
    min-width: 1.1rem;
    padding: 0 var(--space-1);
    border-radius: var(--radius-full);
    background: var(--color-accent);
    color: var(--color-on-accent);
    font-size: var(--font-size-telemetry);
    text-align: center;
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
</style>
