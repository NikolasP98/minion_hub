<script lang="ts">
  import { Button } from '$lib/components/ui';

  import * as m from '$lib/paraglide/messages';
  import {
    addTodoItem,
    setTodoItemText,
    toggleTodoItem,
    deleteTodoItem,
    addBlockTodoItem,
    setBlockTodoItemText,
    toggleBlockTodoItem,
    deleteBlockTodoItem,
    type AgentNote,
  } from '$lib/state/features/agent-notes.svelte';
  import type { TodoBlock } from '$lib/types/notes';
  import { fetchAutocomplete } from '$lib/state/features/notes-autocomplete';
  import { Plus, X, Sparkles } from 'lucide-svelte';

  // When `block` is set the checklist is an embedded note block; otherwise it is a
  // legacy standalone todo record (operates on note.items).
  let {
    note,
    block,
    large = false,
  }: { note: AgentNote; block?: TodoBlock; large?: boolean } = $props();

  const items = $derived(block ? block.items : note.items);

  // Op wrappers — route to block-scoped or legacy state mutations.
  const addItem = (text = '') =>
    block ? addBlockTodoItem(note.id, block.id, text) : addTodoItem(note.id, text);
  const setItemText = (itemId: string, text: string) =>
    block
      ? setBlockTodoItemText(note.id, block.id, itemId, text)
      : setTodoItemText(note.id, itemId, text);
  const toggleItem = (itemId: string) =>
    block ? toggleBlockTodoItem(note.id, block.id, itemId) : toggleTodoItem(note.id, itemId);
  const deleteItem = (itemId: string) =>
    block ? deleteBlockTodoItem(note.id, block.id, itemId) : deleteTodoItem(note.id, itemId);

  // Container that scopes item-input focus (per block, or the whole note card).
  const rootId = $derived(block ? `todoblock-${block.id}` : `note-${note.id}`);

  // AI suggest: dimmed ghost rows. Accept all with Tab, or click a row (or
  // "Add all") to accept with the mouse.
  let ghost = $state<string[]>([]);
  let busy = $state(false);
  let err = $state('');
  let inflight: AbortController | null = null;

  function focusItem(index: number) {
    queueMicrotask(() => {
      const root = document.getElementById(rootId);
      const inputs = root?.querySelectorAll<HTMLInputElement>('.todo-text');
      inputs?.[index]?.focus();
    });
  }

  function clearGhost() {
    inflight?.abort();
    inflight = null;
    ghost = [];
  }

  function acceptGhost() {
    for (const text of ghost) addItem(text);
    ghost = [];
  }

  // Accept a single suggested row (click), removing it from the ghost set.
  function acceptOne(index: number) {
    const text = ghost[index];
    if (text === undefined) return;
    addItem(text);
    ghost = ghost.filter((_, i) => i !== index);
  }

  async function requestSuggest() {
    const context = [note.title, ...items.map((i) => i.text)].filter(Boolean).join('\n');
    inflight?.abort();
    inflight = new AbortController();
    const signal = inflight.signal;
    busy = true;
    err = '';
    try {
      const res = await fetchAutocomplete({ kind: 'todo', context }, signal);
      if (!signal.aborted && 'items' in res) {
        ghost = res.items;
        if (res.items.length === 0) err = m.note_noSuggestionsRight();
      }
    } catch {
      if (!signal.aborted) err = m.note_couldNotSuggest();
    } finally {
      busy = false;
    }
  }

  function onItemKey(e: KeyboardEvent, itemIndex: number) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (itemIndex === items.length - 1) addItem();
      focusItem(itemIndex + 1);
    } else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      if (ghost.length) acceptGhost();
      else void requestSuggest();
    } else if (e.key === 'Escape' && ghost.length) {
      clearGhost();
    }
  }
</script>

<ul class="todo-list" class:large id={block ? rootId : undefined}>
  {#each items as item, i (item.id)}
    <li class="todo-item" class:done={item.done}>
      <Button
        type="button"
        class="check {item.done ? 'checked' : ''}"
        title={item.done ? m.note_markNotDone() : m.note_markDone()}
        aria-label={m.note_toggleItem()}
        onclick={() => toggleItem(item.id)}
      ></Button>
      <input
        class="todo-text"
        placeholder={m.note_listItem()}
        value={item.text}
        oninput={(e) => setItemText(item.id, e.currentTarget.value)}
        onkeydown={(e) => onItemKey(e, i)}
        aria-label={m.note_listItem()}
      />
      <Button
        type="button"
        class="item-del"
        title={m.common_remove()}
        aria-label={m.common_remove()}
        onclick={() => deleteItem(item.id)}
      >
        <X size={12} />
      </Button>
    </li>
  {/each}

  {#each ghost as g, gi (gi)}
    <li class="todo-item ghost">
      <span class="check ghost-check"></span>
      <Button
        type="button"
        class="todo-text ghost-text"
        title={m.note_addThisItem()}
        onclick={() => acceptOne(gi)}>{g}</Button
      >
    </li>
  {/each}

  <li class="todo-add">
    <Button type="button" class="add-item" onclick={() => addItem()}>
      <Plus size={12} />
      {m.note_addItem()}
    </Button>
    {#if ghost.length}
      <span class="ghost-actions">
        <Button type="button" class="add-item suggest" onclick={acceptGhost}>
          <Sparkles size={11} />
          {m.note_addAllSuggestions({ count: ghost.length })}
        </Button>
        <Button type="button" class="add-item" onclick={clearGhost}
          >{m.note_dismissSuggestions()}</Button
        >
      </span>
    {:else}
      <Button
        type="button"
        class="add-item suggest"
        title={m.note_suggestItemsTitle()}
        disabled={busy}
        onclick={() => void requestSuggest()}
      >
        <Sparkles size={11} />
        {busy ? m.note_suggestThinking() : err ? m.common_retry() : m.note_suggest()}
      </Button>
    {/if}
  </li>

  {#if err && !ghost.length}
    <li class="todo-err" role="alert">{err}</li>
  {/if}
</ul>

<style>
  .todo-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .todo-list.large {
    gap: var(--space-2);
    font-size: var(--font-size-body);
  }
  .todo-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  :global(.check) {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    border-radius: var(--radius-md);
    border: 1.5px solid color-mix(in srgb, var(--color-foreground) 30%, transparent);
    background: transparent;
    cursor: pointer;
    position: relative;
    transition:
      border-color var(--duration-fast) ease,
      background var(--duration-fast) ease;
  }
  .large :global(.check) {
    width: 19px;
    height: 19px;
  }
  :global(.check):hover {
    border-color: color-mix(in srgb, var(--color-foreground) 60%, transparent);
  }
  :global(.check.checked) {
    background: var(--color-accent);
    border-color: var(--color-accent);
  }
  :global(.check.checked)::after {
    content: '';
    position: absolute;
    left: 4.5px;
    top: 1.5px;
    width: 4px;
    height: 8px;
    border: solid var(--color-bg2);
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }
  :global(.todo-text) {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: color-mix(in srgb, var(--color-foreground) 85%, transparent);
    font-size: var(--font-size-caption);
    font-family: inherit;
    padding: var(--space-0-5) 0;
  }
  .large :global(.todo-text) {
    font-size: var(--font-size-body);
  }
  :global(.todo-text)::placeholder {
    color: color-mix(in srgb, var(--color-foreground) 28%, transparent);
  }
  .todo-item.done :global(.todo-text) {
    text-decoration: line-through;
    color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
  }
  .todo-item.ghost :global(.ghost-text) {
    flex: 1;
    min-width: 0;
    text-align: left;
    background: transparent;
    border: none;
    font-family: inherit;
    cursor: pointer;
    color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
    font-style: italic;
    padding: var(--space-0-5) 0;
    transition: color var(--duration-fast) ease;
  }
  .todo-item.ghost :global(.ghost-text):hover {
    color: color-mix(in srgb, var(--color-purple) 95%, transparent);
  }
  .ghost-check {
    border-style: dashed;
    border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
    cursor: default;
  }
  :global(.item-del) {
    flex-shrink: 0;
    display: inline-flex;
    padding: var(--space-0-5);
    border-radius: var(--radius-md);
    cursor: pointer;
    background: transparent;
    border: none;
    color: color-mix(in srgb, var(--color-foreground) 25%, transparent);
    opacity: 0;
    transition:
      opacity var(--duration-fast) ease,
      color var(--duration-fast) ease;
  }
  .todo-item:hover :global(.item-del) {
    opacity: 1;
  }
  :global(.item-del):hover {
    color: var(--color-accent);
  }
  .todo-add {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  :global(.add-item) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-0-5) var(--space-1);
    font-size: var(--font-size-caption);
    border-radius: var(--radius-md);
    cursor: pointer;
    background: transparent;
    border: none;
    color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
    transition: color var(--duration-fast) ease;
  }
  :global(.add-item):hover:not(:disabled) {
    color: color-mix(in srgb, var(--color-foreground) 75%, transparent);
  }
  :global(.add-item):global(.suggest) {
    color: color-mix(in srgb, var(--color-purple) 70%, transparent);
  }
  :global(.add-item):global(.suggest):hover:not(:disabled) {
    color: var(--color-purple);
  }
  :global(.add-item):disabled {
    opacity: 0.6;
    cursor: default;
  }
  .ghost-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }
  .todo-err {
    font-size: var(--font-size-caption);
    color: var(--color-accent);
    padding: var(--space-0-5) 0;
  }
</style>
