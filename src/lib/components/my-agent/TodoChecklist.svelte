<script lang="ts">
	import {
		addTodoItem,
		setTodoItemText,
		toggleTodoItem,
		deleteTodoItem,
		type AgentNote
	} from '$lib/state/features/agent-notes.svelte';
	import { fetchAutocomplete } from '$lib/state/features/notes-autocomplete';
	import { Plus, X, Sparkles } from 'lucide-svelte';

	let { note, large = false }: { note: AgentNote; large?: boolean } = $props();

	// AI Tab-suggest: dimmed ghost rows the user can accept with another Tab.
	let ghost = $state<string[]>([]);
	let busy = $state(false);
	let inflight: AbortController | null = null;

	function focusItem(index: number) {
		queueMicrotask(() => {
			const root = document.getElementById(`note-${note.id}`);
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
		for (const text of ghost) addTodoItem(note.id, text);
		ghost = [];
	}

	async function requestSuggest() {
		const context = [note.title, ...note.items.map((i) => i.text)].filter(Boolean).join('\n');
		inflight?.abort();
		inflight = new AbortController();
		const signal = inflight.signal;
		busy = true;
		try {
			const res = await fetchAutocomplete({ kind: 'todo', context }, signal);
			if (!signal.aborted && 'items' in res) ghost = res.items;
		} catch {
			/* silent */
		} finally {
			busy = false;
		}
	}

	function onItemKey(e: KeyboardEvent, itemIndex: number) {
		if (e.key === 'Enter') {
			e.preventDefault();
			if (itemIndex === note.items.length - 1) addTodoItem(note.id);
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

<ul class="todo-list" class:large>
	{#each note.items as item, i (item.id)}
		<li class="todo-item" class:done={item.done}>
			<button
				type="button"
				class="check"
				class:checked={item.done}
				title={item.done ? 'Mark not done' : 'Mark done'}
				aria-label="Toggle item"
				onclick={() => toggleTodoItem(note.id, item.id)}
			></button>
			<input
				class="todo-text"
				placeholder="List item"
				value={item.text}
				oninput={(e) => setTodoItemText(note.id, item.id, e.currentTarget.value)}
				onkeydown={(e) => onItemKey(e, i)}
				aria-label="List item"
			/>
			<button
				type="button"
				class="item-del"
				title="Remove item"
				aria-label="Remove item"
				onclick={() => deleteTodoItem(note.id, item.id)}
			>
				<X size={12} />
			</button>
		</li>
	{/each}

	{#each ghost as g, gi (gi)}
		<li class="todo-item ghost">
			<span class="check ghost-check"></span>
			<span class="todo-text ghost-text">{g}</span>
		</li>
	{/each}

	<li class="todo-add">
		<button type="button" class="add-item" onclick={() => addTodoItem(note.id)}>
			<Plus size={12} /> Add item
		</button>
		{#if ghost.length}
			<span class="ghost-hint"><Sparkles size={11} /> Tab to add {ghost.length}, Esc to dismiss</span>
		{:else}
			<button
				type="button"
				class="add-item suggest"
				title="Suggest items (Tab)"
				disabled={busy}
				onclick={() => void requestSuggest()}
			>
				<Sparkles size={11} /> {busy ? 'Thinking…' : 'Suggest'}
			</button>
		{/if}
	</li>
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
		color: rgba(255, 255, 255, 0.4);
		font-style: italic;
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
	.ghost-hint {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 10.5px;
		color: rgba(167, 139, 250, 0.8);
	}
</style>
