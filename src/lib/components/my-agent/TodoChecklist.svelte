<script lang="ts">
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
		type AgentNote
	} from '$lib/state/features/agent-notes.svelte';
	import type { TodoBlock } from '$lib/types/notes';
	import { fetchAutocomplete } from '$lib/state/features/notes-autocomplete';
	import { Plus, X, Sparkles } from 'lucide-svelte';

	// When `block` is set the checklist is an embedded note block; otherwise it is a
	// legacy standalone todo record (operates on note.items).
	let { note, block, large = false }: { note: AgentNote; block?: TodoBlock; large?: boolean } =
		$props();

	const items = $derived(block ? block.items : note.items);

	// Op wrappers — route to block-scoped or legacy state mutations.
	const addItem = (text = '') =>
		block ? addBlockTodoItem(note.id, block.id, text) : addTodoItem(note.id, text);
	const setItemText = (itemId: string, text: string) =>
		block ? setBlockTodoItemText(note.id, block.id, itemId, text) : setTodoItemText(note.id, itemId, text);
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
			<button
				type="button"
				class="check"
				class:checked={item.done}
				title={item.done ? m.note_markNotDone() : m.note_markDone()}
				aria-label={m.note_toggleItem()}
				onclick={() => toggleItem(item.id)}
			></button>
			<input
				class="todo-text"
				placeholder={m.note_listItem()}
				value={item.text}
				oninput={(e) => setItemText(item.id, e.currentTarget.value)}
				onkeydown={(e) => onItemKey(e, i)}
				aria-label={m.note_listItem()}
			/>
			<button
				type="button"
				class="item-del"
				title={m.common_remove()}
				aria-label={m.common_remove()}
				onclick={() => deleteItem(item.id)}
			>
				<X size={12} />
			</button>
		</li>
	{/each}

	{#each ghost as g, gi (gi)}
		<li class="todo-item ghost">
			<span class="check ghost-check"></span>
			<button
				type="button"
				class="todo-text ghost-text"
				title={m.note_addThisItem()}
				onclick={() => acceptOne(gi)}
			>{g}</button>
		</li>
	{/each}

	<li class="todo-add">
		<button type="button" class="add-item" onclick={() => addItem()}>
			<Plus size={12} /> {m.note_addItem()}
		</button>
		{#if ghost.length}
			<span class="ghost-actions">
				<button type="button" class="add-item suggest" onclick={acceptGhost}>
					<Sparkles size={11} /> {m.note_addAllSuggestions({ count: ghost.length })}
				</button>
				<button type="button" class="add-item" onclick={clearGhost}>{m.note_dismissSuggestions()}</button>
			</span>
		{:else}
			<button
				type="button"
				class="add-item suggest"
				title={m.note_suggestItemsTitle()}
				disabled={busy}
				onclick={() => void requestSuggest()}
			>
				<Sparkles size={11} /> {busy ? m.note_suggestThinking() : err ? m.common_retry() : m.note_suggest()}
			</button>
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
		gap: 4px;
	}
	.todo-list.large {
		gap: 7px;
		font-size: 15px;
	}
	.todo-item {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.check {
		flex-shrink: 0;
		width: 16px;
		height: 16px;
		border-radius: 5px;
		border: 1.5px solid rgba(255, 255, 255, 0.3);
		background: transparent;
		cursor: pointer;
		position: relative;
		transition: border-color 120ms ease, background 120ms ease;
	}
	.large .check {
		width: 19px;
		height: 19px;
	}
	.check:hover {
		border-color: rgba(255, 255, 255, 0.6);
	}
	.check.checked {
		background: var(--color-accent);
		border-color: var(--color-accent);
	}
	.check.checked::after {
		content: '';
		position: absolute;
		left: 4.5px;
		top: 1.5px;
		width: 4px;
		height: 8px;
		border: solid #1a1a1a;
		border-width: 0 2px 2px 0;
		transform: rotate(45deg);
	}
	.todo-text {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: none;
		outline: none;
		color: rgba(255, 255, 255, 0.85);
		font-size: 12.5px;
		font-family: inherit;
		padding: 2px 0;
	}
	.large .todo-text {
		font-size: 15px;
	}
	.todo-text::placeholder {
		color: rgba(255, 255, 255, 0.28);
	}
	.todo-item.done .todo-text {
		text-decoration: line-through;
		color: rgba(255, 255, 255, 0.4);
	}
	.todo-item.ghost .ghost-text {
		flex: 1;
		min-width: 0;
		text-align: left;
		background: transparent;
		border: none;
		font-family: inherit;
		cursor: pointer;
		color: rgba(255, 255, 255, 0.4);
		font-style: italic;
		padding: 2px 0;
		transition: color 120ms ease;
	}
	.todo-item.ghost .ghost-text:hover {
		color: rgba(167, 139, 250, 0.95);
	}
	.ghost-check {
		border-style: dashed;
		border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
		cursor: default;
	}
	.item-del {
		flex-shrink: 0;
		display: inline-flex;
		padding: 2px;
		border-radius: 5px;
		cursor: pointer;
		background: transparent;
		border: none;
		color: rgba(255, 255, 255, 0.25);
		opacity: 0;
		transition: opacity 120ms ease, color 120ms ease;
	}
	.todo-item:hover .item-del {
		opacity: 1;
	}
	.item-del:hover {
		color: var(--color-accent);
	}
	.todo-add {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.add-item {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 4px;
		font-size: 11.5px;
		border-radius: 6px;
		cursor: pointer;
		background: transparent;
		border: none;
		color: rgba(255, 255, 255, 0.4);
		transition: color 120ms ease;
	}
	.add-item:hover:not(:disabled) {
		color: rgba(255, 255, 255, 0.75);
	}
	.add-item.suggest {
		color: rgba(167, 139, 250, 0.7);
	}
	.add-item.suggest:hover:not(:disabled) {
		color: rgba(167, 139, 250, 1);
	}
	.add-item:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.ghost-actions {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.todo-err {
		font-size: 11px;
		color: var(--color-accent);
		padding: 2px 0;
	}
</style>
