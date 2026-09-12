<script lang="ts">
  /**
   * Reusable tag picker for the org-wide tag registry (`crm_tags`, spec
   * minion-meta specs/2026-09-08-hub-scheduling-calendar-views-tags-spec.md
   * §3.3). Modelled on the tag block in
   * `src/routes/(app)/crm/[contactId]/+page.svelte`. Only manages the
   * selected id list — the caller PUTs `/api/tags/[kind]/[id]` after its own
   * save.
   */
  import { Plus } from 'lucide-svelte';
  import { Select, Button, iconSizes } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { CRM_TAG_COLORS } from '$lib/components/crm/tag-colors';
  import type { CalTag } from '$lib/components/scheduling/calendar/types';
  import TagChip from './TagChip.svelte';

  let {
    allTags,
    value = $bindable([]),
    disabled = false,
  }: {
    /** Every tag defined for the org. */
    allTags: CalTag[];
    /** Selected tag ids (bindable). */
    value?: string[];
    disabled?: boolean;
  } = $props();

  // A tag created inline isn't in the `allTags` prop until the parent's next
  // server load — keep it locally so its chip renders immediately.
  let created = $state<CalTag[]>([]);
  const tags = $derived([
    ...allTags,
    ...created.filter((t) => !allTags.some((a) => a.id === t.id)),
  ]);
  const byId = $derived(new Map(tags.map((t) => [t.id, t])));
  const selected = $derived(value.map((id) => byId.get(id)).filter((t): t is CalTag => !!t));
  const available = $derived(tags.filter((t) => !value.includes(t.id)));

  let adding = $state(false);
  let newName = $state('');
  let busy = $state(false);

  function addExisting(id: string) {
    if (!id || value.includes(id)) return;
    value = [...value, id];
  }
  function remove(id: string) {
    value = value.filter((v) => v !== id);
  }
  function cancelNew() {
    adding = false;
    newName = '';
  }
  async function createTag() {
    const name = newName.trim();
    if (!name || busy) return;
    busy = true;
    try {
      const color = CRM_TAG_COLORS[tags.length % CRM_TAG_COLORS.length];
      const res = await fetch('/api/crm/tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, color }),
      });
      if (res.ok) {
        const { tag } = (await res.json()) as { tag: CalTag };
        created = [...created, tag];
        value = [...value, tag.id];
        cancelNew();
      }
    } finally {
      busy = false;
    }
  }
</script>

<div class="tags-field">
  {#each selected as t (t.id)}
    <TagChip name={t.name} color={t.color} onremove={disabled ? undefined : () => remove(t.id)} />
  {/each}
  {#if !disabled}
    {#if available.length > 0}
      <Select class="add-select" value="" disabled={busy} onchange={(v) => addExisting(String(v))}>
        <option value="">{m.tags_add()}</option>
        {#each available as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
      </Select>
    {/if}
    {#if adding}
      <span class="new-tag">
        <input
          class="txt"
          placeholder={m.tags_new_placeholder()}
          bind:value={newName}
          disabled={busy}
          onkeydown={(e) => e.key === 'Enter' && createTag()}
        />
        <Button size="sm" onclick={createTag} disabled={busy || !newName.trim()}
          >{m.common_add()}</Button
        >
        <Button variant="ghost" size="sm" onclick={cancelNew}>{m.common_cancel()}</Button>
      </span>
    {:else}
      <Button variant="outline" size="sm" onclick={() => (adding = true)} disabled={busy}>
        <Plus size={iconSizes.xs} />{m.tags_new()}
      </Button>
    {/if}
  {/if}
</div>

<style>
  .tags-field {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  .tags-field :global(.add-select) {
    height: 1.6rem;
    font-size: var(--font-size-caption, 12px);
    border-radius: var(--radius-full);
    background: var(--color-surface-2);
    border: 1px dashed var(--hairline);
    padding: 0 var(--space-2);
  }
  .new-tag {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }
  .txt {
    height: 1.6rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: 0 var(--space-2);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-size: var(--font-size-caption, 12px);
    width: 9rem;
  }
</style>
