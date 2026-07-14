<script lang="ts">
  import { Button } from '$lib/components/ui';

  import * as m from '$lib/paraglide/messages';
  import { Search, Smile, Shapes, X } from 'lucide-svelte';
  import { EMOJI_SET, ICON_SET } from './note-icons';

  let {
    onpick,
    onclose,
    current = '',
  }: { onpick: (value: string) => void; onclose: () => void; current?: string } = $props();

  let tab = $state<'emoji' | 'icons'>('emoji');
  let query = $state('');

  const q = $derived(query.trim().toLowerCase());
  const emojis = $derived(
    q ? EMOJI_SET.filter((e) => e.keywords.includes(q) || e.char.includes(q)) : EMOJI_SET,
  );
  const icons = $derived(
    q
      ? ICON_SET.filter((e) => e.keywords.includes(q) || e.name.toLowerCase().includes(q))
      : ICON_SET,
  );

  function pick(value: string) {
    onpick(value);
    onclose();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="ip"
  onmousedown={(e) => e.stopPropagation()}
  role="dialog"
  tabindex="-1"
  aria-label={m.iconPicker_pickIcon()}
>
  <div class="ip-head">
    <div class="ip-tabs" role="tablist">
      <Button
        type="button"
        role="tab"
        class="ip-tab {tab === 'emoji' ? 'on' : ''}"
        aria-selected={tab === 'emoji'}
        onclick={() => (tab = 'emoji')}
      >
        <Smile size={14} />
        {m.iconPicker_emoji()}
      </Button>
      <Button
        type="button"
        role="tab"
        class="ip-tab {tab === 'icons' ? 'on' : ''}"
        aria-selected={tab === 'icons'}
        onclick={() => (tab = 'icons')}
      >
        <Shapes size={14} />
        {m.iconPicker_icons()}
      </Button>
    </div>
    <Button
      type="button"
      class="ip-close"
      title={m.common_close()}
      aria-label={m.common_close()}
      onclick={onclose}><X size={14} /></Button
    >
  </div>

  <div class="ip-search">
    <Search size={13} />
    <!-- svelte-ignore a11y_autofocus -->
    <input
      type="text"
      placeholder={m.iconPicker_search()}
      bind:value={query}
      aria-label={m.iconPicker_searchIcons()}
      autofocus
    />
    {#if current}
      <Button type="button" class="ip-clear" onclick={() => pick('')}
        >{m.iconPicker_remove()}</Button
      >
    {/if}
  </div>

  <div class="ip-grid" role="listbox">
    {#if tab === 'emoji'}
      {#each emojis as e (e.char)}
        <Button
          type="button"
          class="ip-cell emoji {current === e.char ? 'sel' : ''}"
          title={e.keywords}
          onclick={() => pick(e.char)}>{e.char}</Button
        >
      {/each}
      {#if emojis.length === 0}<p class="ip-empty">{m.common_noMatches()}</p>{/if}
    {:else}
      {#each icons as ic (ic.name)}
        {@const Comp = ic.comp}
        <Button
          type="button"
          class="ip-cell {current === `lucide:${ic.name}` ? 'sel' : ''}"
          title={ic.name}
          onclick={() => pick(`lucide:${ic.name}`)}
        >
          <Comp size={18} />
        </Button>
      {/each}
      {#if icons.length === 0}<p class="ip-empty">{m.common_noMatches()}</p>{/if}
    {/if}
  </div>
</div>

<style>
  .ip {
    width: 280px;
    max-width: 88vw;
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-xl);
    background: var(--color-bg2);
    border: 1px solid var(--color-border);
    box-shadow: var(--shadow-overlay);
    overflow: hidden;
  }
  .ip-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-2) var(--space-1);
  }
  .ip-tabs {
    display: flex;
    gap: var(--space-0-5);
  }
  :global(.ip-tab) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    font-size: var(--font-size-caption);
    font-family: inherit;
    border-radius: var(--radius-lg);
    cursor: pointer;
    color: color-mix(in srgb, var(--color-foreground) 55%, transparent);
    background: transparent;
    border: none;
    transition:
      color var(--duration-fast) ease,
      background var(--duration-fast) ease;
  }
  :global(.ip-tab):hover {
    color: var(--color-foreground);
  }
  :global(.ip-tab.on) {
    color: var(--color-foreground);
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
  }
  :global(.ip-close) {
    display: inline-flex;
    padding: var(--space-1);
    border-radius: var(--radius-md);
    cursor: pointer;
    background: transparent;
    border: none;
    color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
  }
  :global(.ip-close):hover {
    color: var(--color-foreground);
    background: color-mix(in srgb, var(--color-foreground) 8%, transparent);
  }
  .ip-search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-1) var(--space-2) var(--space-2);
    padding: var(--space-2) var(--space-2);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--color-foreground) 5%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-foreground) 8%, transparent);
    color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
  }
  .ip-search input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    font-family: inherit;
    font-size: var(--font-size-caption);
    color: color-mix(in srgb, var(--color-foreground) 90%, transparent);
  }
  :global(.ip-clear) {
    font-size: var(--font-size-caption);
    font-family: inherit;
    padding: var(--space-0-5) var(--space-1);
    border-radius: var(--radius-md);
    cursor: pointer;
    color: color-mix(in srgb, var(--color-foreground) 55%, transparent);
    background: transparent;
    border: 1px solid var(--color-border);
  }
  :global(.ip-clear):hover {
    color: var(--color-foreground);
  }
  .ip-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: var(--space-0-5);
    padding: 0 8px 10px;
    max-height: 240px;
    overflow-y: auto;
    scrollbar-width: thin;
  }
  :global(.ip-cell) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    border-radius: var(--radius-lg);
    cursor: pointer;
    background: transparent;
    border: none;
    color: color-mix(in srgb, var(--color-foreground) 80%, transparent);
    transition: background var(--duration-instant) ease;
  }
  :global(.ip-cell.emoji) {
    font-size: var(--font-size-display);
    line-height: 1;
  }
  :global(.ip-cell):hover {
    background: color-mix(in srgb, var(--color-foreground) 10%, transparent);
  }
  :global(.ip-cell.sel) {
    background: color-mix(in srgb, var(--color-accent) 28%, transparent);
  }
  .ip-empty {
    grid-column: 1 / -1;
    text-align: center;
    font-size: var(--font-size-caption);
    color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
    padding: var(--space-4) 0;
    margin: 0;
  }
</style>
