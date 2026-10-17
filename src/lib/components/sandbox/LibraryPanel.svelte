<script lang="ts">
  import { onMount } from 'svelte';
  import { Plus, Globe, Lock, Trash2, Library } from 'lucide-svelte';
  import { Button, iconSizes } from '$lib/components/ui';
  import {
    componentCopy,
    DRAG_MIME,
    LIBRARY_CHANGED_EVENT,
    listLibrary,
    removeFromLibrary,
    setPublished,
    type ComponentCopy,
    type LibraryComponent,
  } from '$lib/sandbox/library';
  import * as m from '$lib/paraglide/messages';

  let { onadd }: { onadd: (c: ComponentCopy) => void } = $props();

  let items = $state<LibraryComponent[]>([]);
  let error = $state<string | null>(null);

  async function refresh() {
    try {
      items = await listLibrary();
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : m.sandbox_library_empty();
    }
  }

  onMount(() => {
    void refresh();
    const onChanged = () => void refresh();
    window.addEventListener(LIBRARY_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(LIBRARY_CHANGED_EVENT, onChanged);
  });

  function dragStart(e: DragEvent, c: LibraryComponent) {
    if (!e.dataTransfer) return;
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(componentCopy(c)));
    e.dataTransfer.effectAllowed = 'copy';
  }
</script>

<aside class="lib" aria-label={m.sandbox_library_title()}>
  <header class="lib-head">
    <Library size={iconSizes.sm} class="shrink-0 text-accent" />
    <h3 class="t-label">{m.sandbox_library_title()}</h3>
    <span class="lib-hint">{m.sandbox_library_drag_hint()}</span>
  </header>
  {#if error}
    <p class="lib-empty">{error}</p>
  {:else if items.length === 0}
    <p class="lib-empty">{m.sandbox_library_empty()}</p>
  {:else}
    <ul class="lib-list">
      {#each items as c (c.id)}
        <li class="lib-item" draggable="true" ondragstart={(e) => dragStart(e, c)}>
          <div class="lib-meta">
            <span class="lib-title">{c.title}</span>
            <span class="lib-sub">
              {c.w}×{c.h} · {c.published ? m.sandbox_library_published() : m.sandbox_library_mine()}
            </span>
          </div>
          <div class="lib-actions">
            <Button
              variant="ghost"
              size="sm"
              title={m.sandbox_library_add()}
              aria-label={m.sandbox_library_add()}
              onclick={() => onadd(componentCopy(c))}
            >
              <Plus size={iconSizes.sm} />
            </Button>
            {#if c.mine}
              <Button
                variant="ghost"
                size="sm"
                title={c.published ? m.sandbox_library_unpublish() : m.sandbox_library_publish()}
                aria-label={c.published
                  ? m.sandbox_library_unpublish()
                  : m.sandbox_library_publish()}
                onclick={() => setPublished(c.id, !c.published)}
              >
                {#if c.published}<Lock size={iconSizes.sm} />{:else}<Globe
                    size={iconSizes.sm}
                  />{/if}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                title={m.sandbox_library_delete()}
                aria-label={m.sandbox_library_delete()}
                onclick={() => removeFromLibrary(c.id)}
              >
                <Trash2 size={iconSizes.sm} />
              </Button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</aside>

<style>
  .lib {
    margin-bottom: var(--space-card);
    padding: var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
  }
  .lib-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  .lib-hint,
  .lib-empty {
    font-size: var(--font-size-caption);
    color: var(--color-muted-foreground);
  }
  .lib-empty {
    margin: 0;
  }
  .lib-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .lib-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2) var(--space-1) var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    cursor: grab;
  }
  .lib-meta {
    display: flex;
    min-width: 0;
    flex-direction: column;
  }
  .lib-title {
    overflow: hidden;
    max-width: 16rem;
    font-size: var(--font-size-label);
    color: var(--color-foreground);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lib-sub {
    font-size: var(--font-size-caption);
    color: var(--color-muted-foreground);
  }
  .lib-actions {
    display: flex;
    align-items: center;
  }
</style>
