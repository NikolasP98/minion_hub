<script lang="ts">
  import { Trash2, Bookmark, BookmarkCheck } from 'lucide-svelte';
  import { Button, iconSizes } from '$lib/components/ui';
  import { ConfirmDialog } from '$lib/components/ui/foundations';
  import { saveToLibrary } from '$lib/sandbox/library';
  import type { PageValue } from '$lib/sandbox/blocks/schema';
  import type { SandboxElementRecord, SandboxHost } from '$lib/sandbox/host.svelte';
  import * as m from '$lib/paraglide/messages';
  import DateFilter from './filters/DateFilter.svelte';
  import PickFilter from './filters/PickFilter.svelte';

  /**
   * The filter bar (spec 150 FR-001): every filter of the page in saved order,
   * outside the grid. Each keeps the same two actions every element has (save
   * to library, remove); changing a filter is done by asking the assistant
   * until the Connections view (S4).
   */
  interface Props {
    /** Filter elements only, already in display order. */
    filters: SandboxElementRecord[];
    host: SandboxHost;
    /** What a control shows (unsettled change first). */
    read: (name: string) => PageValue | null;
    onchange: (name: string, value: PageValue | null) => void;
  }

  let { filters, host, read, onchange }: Props = $props();

  let removing = $state<SandboxElementRecord | null>(null);
  let confirming = $state(false);
  let savedId = $state<string | null>(null);

  async function keep(element: SandboxElementRecord) {
    await saveToLibrary(element);
    savedId = element.id;
    setTimeout(() => (savedId = null), 1500);
  }
</script>

{#if filters.length > 0}
  <section class="bar" aria-label={m.sandbox_filter_bar_label()}>
    {#each filters as element (element.id)}
      {@const spec = element.spec}
      {#if spec?.type === 'filter'}
        <div class="item">
          {#if spec.control === 'date_range'}
            <DateFilter
              label={element.title}
              value={read(spec.var)}
              onchange={(value) => onchange(spec.var, value)}
            />
          {:else if spec.options}
            <PickFilter
              id={element.id}
              label={element.title}
              control={spec.control}
              options={spec.options}
              value={read(spec.var)}
              onchange={(value) => onchange(spec.var, value)}
            />
          {/if}
          <Button
            variant="ghost"
            size="sm"
            title={savedId === element.id
              ? m.sandbox_saved_to_library()
              : m.sandbox_save_to_library()}
            aria-label={m.sandbox_save_to_library()}
            onclick={() => keep(element)}
          >
            {#if savedId === element.id}<BookmarkCheck size={iconSizes.sm} />{:else}<Bookmark
                size={iconSizes.sm}
              />{/if}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={m.sandbox_filter_remove()}
            title={m.sandbox_filter_remove()}
            onclick={() => {
              removing = element;
              confirming = true;
            }}
          >
            <Trash2 size={iconSizes.sm} />
          </Button>
        </div>
      {/if}
    {/each}
  </section>
{/if}

<ConfirmDialog
  bind:open={confirming}
  tone="danger"
  title={m.sandbox_filter_remove()}
  message={removing?.title ?? ''}
  failureMessage={m.sandbox_remove_failed()}
  onconfirm={() => (removing ? host.remove(removing.id) : undefined)}
/>

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-6);
    margin-bottom: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
  }
  .item {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
</style>
