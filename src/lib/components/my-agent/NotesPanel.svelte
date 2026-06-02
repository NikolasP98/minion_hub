<script lang="ts">
	import {
		notesState,
		sortedNotes,
		addNote,
		updateNote,
		deleteNote,
		togglePin,
		setColor,
		addTodoItem,
		setTodoItemText,
		toggleTodoItem,
		deleteTodoItem,
		todoProgress,
		setPanelOpen,
		NOTE_COLORS,
		COLOR_STYLES,
		type AgentNote
	} from '$lib/state/features/agent-notes.svelte';
	import {
		StickyNote,
		ListTodo,
		Plus,
		Pin,
		Trash2,
		X,
		Search,
		Palette
	} from 'lucide-svelte';

	const list = $derived(sortedNotes());

	// Which card has its colour palette popover open.
	let colorMenuFor = $state<string | null>(null);

	// Autosize a textarea to its content (Svelte 5 attachment).
	function autoGrow(el: Element) {
		const ta = el as HTMLTextAreaElement;
		const grow = () => {
			ta.style.height = 'auto';
			ta.style.height = ta.scrollHeight + 'px';
		};
		grow();
		ta.addEventListener('input', grow);
		return () => ta.removeEventListener('input', grow);
	}

	function onTodoItemKey(e: KeyboardEvent, note: AgentNote, itemIndex: number) {
		if (e.key === 'Enter') {
			e.preventDefault();
			// Enter on the last item adds a new one and focuses it.
			if (itemIndex === note.items.length - 1) {
				addTodoItem(note.id);
			}
			// Focus next item on the next tick.
			queueMicrotask(() => {
				const root = document.getElementById(`note-${note.id}`);
				const inputs = root?.querySelectorAll<HTMLInputElement>('.todo-text');
				inputs?.[itemIndex + 1]?.focus();
			});
		}
	}
</script>

<aside class="notes-panel" aria-label="Notes and todos">
	<header class="panel-head">
		<div class="head-title">
			<StickyNote size={15} />
			<span>Notes &amp; Todos</span>
		</div>
		<button type="button" class="icon-btn" title="Close panel" onclick={() => setPanelOpen(false)}>
			<X size={16} />
		</button>
	</header>

	<div class="panel-actions">
		<button type="button" class="add-btn" onclick={() => addNote('note')}>
			<Plus size={14} /> Note
		</button>
		<button type="button" class="add-btn" onclick={() => addNote('todo')}>
			<ListTodo size={14} /> Todo
		</button>
	</div>

	<div class="search">
		<Search size={13} />
		<input
			type="text"
			placeholder="Search…"
			bind:value={notesState.query}
			aria-label="Search notes and todos"
		/>
	</div>

	<div class="cards" role="list">
		{#if list.length === 0}
			<div class="empty">
				<StickyNote size={26} />
				{#if notesState.query.trim()}
					<p>No matches for “{notesState.query}”.</p>
				{:else}
					<p>Capture a thought or a checklist. Add a Note or Todo above.</p>
				{/if}
			</div>
		{/if}

		{#each list as note (note.id)}
			{@const style = COLOR_STYLES[note.color]}
			<article
				id="note-{note.id}"
				class="card"
				class:pinned={note.pinned}
				role="listitem"
				style:border-color={style.border}
				style:background={style.fill}
			>
				<div class="card-top">
					{#if note.kind === 'todo'}
						{@const p = todoProgress(note)}
						<span class="kind-badge todo" title="Checklist">
							<ListTodo size={12} /> {p.done}/{p.total}
						</span>
					{:else}
						<span class="kind-badge note" title="Note"><StickyNote size={12} /></span>
					{/if}
					<input
						class="card-title"
						placeholder={note.kind === 'todo' ? 'Checklist title' : 'Title'}
						value={note.title}
						oninput={(e) => updateNote(note.id, { title: e.currentTarget.value })}
						aria-label="Title"
					/>
					<button
						type="button"
						class="pin-btn"
						class:on={note.pinned}
						title={note.pinned ? 'Unpin' : 'Pin to top'}
						onclick={() => togglePin(note.id)}
					>
						<Pin size={14} />
					</button>
				</div>

				{#if note.kind === 'note'}
					<textarea
						class="card-body"
						placeholder="Take a note…"
						value={note.body}
						oninput={(e) => updateNote(note.id, { body: e.currentTarget.value })}
						{@attach autoGrow}
						aria-label="Note body"
					></textarea>
				{:else}
					<ul class="todo-list">
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
									onkeydown={(e) => onTodoItemKey(e, note, i)}
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
						<li class="todo-add">
							<button type="button" class="add-item" onclick={() => addTodoItem(note.id)}>
								<Plus size={12} /> Add item
							</button>
						</li>
					</ul>
				{/if}

				<footer class="card-foot">
					<div class="color-wrap">
						<button
							type="button"
							class="icon-btn sm"
							title="Colour"
							aria-label="Change colour"
							onclick={() => (colorMenuFor = colorMenuFor === note.id ? null : note.id)}
						>
							<Palette size={14} />
						</button>
						{#if colorMenuFor === note.id}
							<div class="color-menu">
								{#each NOTE_COLORS as c (c.id)}
									<button
										type="button"
										class="swatch"
										class:active={note.color === c.id}
										style:background={c.swatch}
										title={c.label}
										aria-label={c.label}
										onclick={() => {
											setColor(note.id, c.id);
											colorMenuFor = null;
										}}
									></button>
								{/each}
							</div>
						{/if}
					</div>
					<button
						type="button"
						class="icon-btn sm danger"
						title="Delete"
						aria-label="Delete"
						onclick={() => deleteNote(note.id)}
					>
						<Trash2 size={14} />
					</button>
				</footer>
			</article>
		{/each}
	</div>
</aside>

<style>
	.notes-panel {
		width: 320px;
		flex-shrink: 0;
		height: 100%;
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: var(--color-bg, #0d0d0d);
		border-left: 1px solid rgba(255, 255, 255, 0.06);
	}

	.panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 14px 10px;
		flex-shrink: 0;
	}
	.head-title {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.85);
	}
	.head-title :global(svg) {
		color: #e87d6a;
	}

	.panel-actions {
		display: flex;
		gap: 8px;
		padding: 0 14px 10px;
		flex-shrink: 0;
	}
	.add-btn {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 7px 10px;
		font-size: 12.5px;
		font-weight: 500;
		border-radius: 8px;
		cursor: pointer;
		color: rgba(255, 255, 255, 0.8);
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
	}
	.add-btn:hover {
		color: #fff;
		background: rgba(232, 125, 106, 0.1);
		border-color: rgba(232, 125, 106, 0.35);
	}

	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 14px 10px;
		padding: 7px 10px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.07);
		flex-shrink: 0;
		color: rgba(255, 255, 255, 0.4);
	}
	.search input {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: none;
		outline: none;
		color: rgba(255, 255, 255, 0.9);
		font-size: 12.5px;
		font-family: inherit;
	}
	.search input::placeholder {
		color: rgba(255, 255, 255, 0.3);
	}

	.cards {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		scrollbar-width: thin;
		padding: 2px 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		text-align: center;
		padding: 36px 12px;
		color: rgba(255, 255, 255, 0.3);
	}
	.empty p {
		margin: 0;
		font-size: 12.5px;
		max-width: 26ch;
		line-height: 1.5;
	}

	.card {
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 12px;
		padding: 10px 10px 8px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.card.pinned {
		box-shadow: 0 0 0 1px rgba(232, 125, 106, 0.18);
	}

	.card-top {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.kind-badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		flex-shrink: 0;
		font-size: 10px;
		font-variant-numeric: tabular-nums;
		color: rgba(255, 255, 255, 0.5);
	}
	.card-title {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: none;
		outline: none;
		color: rgba(255, 255, 255, 0.92);
		font-size: 13px;
		font-weight: 600;
		font-family: inherit;
		padding: 0;
	}
	.card-title::placeholder {
		color: rgba(255, 255, 255, 0.3);
		font-weight: 500;
	}

	.pin-btn {
		flex-shrink: 0;
		display: inline-flex;
		padding: 3px;
		border-radius: 6px;
		cursor: pointer;
		background: transparent;
		border: none;
		color: rgba(255, 255, 255, 0.3);
		transition: color 120ms ease, transform 120ms ease;
	}
	.pin-btn:hover {
		color: rgba(255, 255, 255, 0.7);
	}
	.pin-btn.on {
		color: #e87d6a;
		transform: rotate(20deg);
	}

	.card-body {
		width: 100%;
		min-height: 36px;
		resize: none;
		overflow: hidden;
		background: transparent;
		border: none;
		outline: none;
		color: rgba(255, 255, 255, 0.82);
		font-size: 12.5px;
		line-height: 1.55;
		font-family: inherit;
		padding: 0;
	}
	.card-body::placeholder {
		color: rgba(255, 255, 255, 0.28);
	}

	.todo-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
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
	.check:hover {
		border-color: rgba(255, 255, 255, 0.6);
	}
	.check.checked {
		background: #e87d6a;
		border-color: #e87d6a;
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
	.todo-text::placeholder {
		color: rgba(255, 255, 255, 0.28);
	}
	.todo-item.done .todo-text {
		text-decoration: line-through;
		color: rgba(255, 255, 255, 0.4);
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
		color: #e87d6a;
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
	.add-item:hover {
		color: rgba(255, 255, 255, 0.75);
	}

	.card-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 2px;
	}
	.color-wrap {
		position: relative;
	}
	.color-menu {
		position: absolute;
		bottom: calc(100% + 6px);
		left: 0;
		z-index: 5;
		display: flex;
		gap: 5px;
		padding: 7px 8px;
		border-radius: 9px;
		background: #1a1a1a;
		border: 1px solid rgba(255, 255, 255, 0.1);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
	}
	.swatch {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		cursor: pointer;
		border: 1px solid rgba(255, 255, 255, 0.15);
		transition: transform 100ms ease;
	}
	.swatch:hover {
		transform: scale(1.15);
	}
	.swatch.active {
		box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.7);
	}

	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 5px;
		border-radius: 7px;
		cursor: pointer;
		background: transparent;
		border: none;
		color: rgba(255, 255, 255, 0.45);
		transition: color 120ms ease, background 120ms ease;
	}
	.icon-btn:hover {
		color: rgba(255, 255, 255, 0.85);
		background: rgba(255, 255, 255, 0.05);
	}
	.icon-btn.sm {
		padding: 4px;
	}
	.icon-btn.danger:hover {
		color: #e87d6a;
		background: rgba(232, 125, 106, 0.1);
	}
</style>
