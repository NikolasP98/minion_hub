<script lang="ts">
	import {
		notesState,
		sortedNotes,
		addNote,
		updateNote,
		deleteNote,
		togglePin,
		setColor,
		todoProgress,
		togglePanel,
		uploadNoteImage,
		addAttachment,
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
		Palette,
		Maximize2,
		LayoutDashboard,
		Image as ImageIcon,
		ChevronRight,
		ChevronLeft,
		GripVertical
	} from 'lucide-svelte';
	import { setDragContext, type DragContext } from '$lib/utils/drag-context';
	import NoteImageStrip from './NoteImageStrip.svelte';
	import ImageLightbox from './ImageLightbox.svelte';
	import NoteEditor from './NoteEditor.svelte';
	import TodoChecklist from './TodoChecklist.svelte';
	import ZenMode from './ZenMode.svelte';
	import EaselBoard from './EaselBoard.svelte';

	const list = $derived(sortedNotes());
	const noteCount = $derived(notesState.notes.length);

	// Which card has its colour palette popover open.
	let colorMenuFor = $state<string | null>(null);
	// Fullscreen image preview source (null = closed).
	let lightboxSrc = $state<string | null>(null);
	// The note open in fullscreen focus ("zen") mode, if any.
	let zenNote = $state<AgentNote | null>(null);
	// The easel board open fullscreen, if any.
	let easelNote = $state<AgentNote | null>(null);

	// Build a draggable context payload for a note/todo (folded into chat on drop).
	function noteDragStart(e: DragEvent, note: AgentNote) {
		const parts: string[] = [];
		if (note.kind === 'todo') {
			parts.push(`Todo list: "${note.title || '(untitled)'}"`);
			for (const it of note.items) {
				parts.push(`${it.done ? '[x]' : '[ ]'} ${it.text}`);
			}
		} else {
			parts.push(`Note: "${note.title || '(untitled)'}"`);
			const body = note.body?.trim();
			if (body) parts.push(body);
		}
		const ctx: DragContext = {
			kind: note.kind === 'todo' ? 'todo' : 'note',
			label: note.title || (note.kind === 'todo' ? 'Todo' : 'Note'),
			text: parts.join('\n'),
		};
		setDragContext(e, ctx);
	}

	// Paste an image straight onto a card (Ctrl+V while editing it).
	async function onCardPaste(e: ClipboardEvent, note: AgentNote) {
		const items = e.clipboardData?.items;
		if (!items) return;
		for (const item of items) {
			if (!item.type.startsWith('image/')) continue;
			const file = item.getAsFile();
			if (!file) continue;
			e.preventDefault();
			try {
				const fileId = await uploadNoteImage(file);
				addAttachment(note.id, fileId);
			} catch {
				/* surfaced by the strip on next interaction */
			}
		}
	}
</script>

<aside class="notes-panel" class:collapsed={!notesState.open} aria-label="Notes and todos">
	<!-- Drawer handle: the panel never fully unmounts — it collapses to a slim
	     rail and this little tab toggles it open/closed. -->
	<button
		type="button"
		class="panel-tab"
		onclick={togglePanel}
		title={notesState.open ? 'Collapse notes' : 'Expand notes'}
		aria-label="Toggle notes and todos panel"
		aria-expanded={notesState.open}
	>
		{#if notesState.open}<ChevronRight size={15} />{:else}<ChevronLeft size={15} />{/if}
	</button>

	{#if notesState.open}
	<header class="panel-head">
		<div class="head-title">
			<StickyNote size={15} />
			<span>Notes &amp; Todos</span>
		</div>
		<button type="button" class="icon-btn" title="Collapse panel" onclick={togglePanel}>
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
		<button
			type="button"
			class="add-btn"
			title="Freeform image board"
			onclick={() => (easelNote = addNote('easel'))}
		>
			<LayoutDashboard size={14} /> Easel
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
					onpaste={(e) => onCardPaste(e, note)}
			>
				<div class="card-top">
					{#if note.kind !== 'easel'}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<span
							class="drag-grip"
							draggable="true"
							ondragstart={(e) => noteDragStart(e, note)}
							title="Drag into chat as context"
							aria-hidden="true"
						>
							<GripVertical size={13} />
						</span>
					{/if}
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
						class="pin-btn focus-btn"
						title={note.kind === 'easel' ? 'Open board' : 'Focus mode'}
						aria-label="Open fullscreen"
						onclick={() => (note.kind === 'easel' ? (easelNote = note) : (zenNote = note))}
					>
						<Maximize2 size={13} />
					</button>
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
					<div class="card-body">
						<NoteEditor {note} compactTools />
					</div>
				{:else if note.kind === 'todo'}
					<TodoChecklist {note} />
				{:else}
					<button type="button" class="easel-card" onclick={() => (easelNote = note)}>
						{#if note.easel.items.length > 0}
							<span class="easel-count"><ImageIcon size={13} /> {note.easel.items.length} items</span>
						{:else}
							<span class="easel-count"><LayoutDashboard size={13} /> Empty board</span>
						{/if}
						<span class="easel-open">Open board</span>
					</button>
				{/if}

				{#if note.kind !== 'easel'}
						<NoteImageStrip {note} onopen={(src) => (lightboxSrc = src)} />
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
	{:else}
		<!-- Collapsed: a slim discoverable rail. Click anywhere to expand. -->
		<button type="button" class="rail" onclick={togglePanel} aria-label="Open notes and todos">
			<span class="rail-icon">
				<StickyNote size={18} />
				{#if noteCount > 0}<span class="rail-badge">{noteCount}</span>{/if}
			</span>
			<span class="rail-label">Notes &amp; Todos</span>
		</button>
	{/if}
</aside>

<ImageLightbox src={lightboxSrc} onclose={() => (lightboxSrc = null)} />

<ZenMode note={zenNote} onclose={() => (zenNote = null)} />

{#if easelNote}
	<EaselBoard note={easelNote} onclose={() => (easelNote = null)} />
{/if}

<style>
	.notes-panel {
		position: relative;
		width: 320px;
		flex-shrink: 0;
		height: 100%;
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: var(--color-bg);
		border-left: 1px solid var(--color-border);
		transition: width 180ms cubic-bezier(0.4, 0, 0.2, 1);
	}
	.notes-panel.collapsed {
		width: 46px;
	}

	/* Drawer handle protruding from the panel's left edge. */
	.panel-tab {
		position: absolute;
		top: 50%;
		left: 0;
		transform: translate(-100%, -50%);
		z-index: 6;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 52px;
		padding: 0;
		cursor: pointer;
		color: var(--color-muted);
		background: var(--color-bg2);
		border: 1px solid var(--color-border);
		border-right: none;
		border-radius: 8px 0 0 8px;
		transition: color 120ms ease, background 120ms ease;
	}
	.panel-tab:hover {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
	}
	.panel-tab:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	/* Collapsed rail: vertical, discoverable, click-to-expand. */
	.rail {
		flex: 1;
		min-height: 0;
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 16px 0;
		cursor: pointer;
		background: transparent;
		border: none;
		color: var(--color-muted);
		transition: color 120ms ease, background 120ms ease;
	}
	.rail:hover {
		color: var(--color-foreground);
		background: color-mix(in srgb, var(--color-foreground) 4%, transparent);
	}
	.rail-icon {
		position: relative;
		display: inline-flex;
		color: var(--color-accent);
	}
	.rail-badge {
		position: absolute;
		top: -7px;
		right: -9px;
		min-width: 15px;
		height: 15px;
		padding: 0 4px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 9px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		border-radius: 999px;
		color: var(--color-accent-foreground);
		background: var(--color-accent);
	}
	.rail-label {
		writing-mode: vertical-rl;
		text-orientation: mixed;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--color-muted-foreground);
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
		color: color-mix(in srgb, var(--color-foreground) 85%, transparent);
	}
	.head-title :global(svg) {
		color: var(--color-accent);
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
		color: color-mix(in srgb, var(--color-foreground) 80%, transparent);
		background: color-mix(in srgb, var(--color-foreground) 4%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-foreground) 8%, transparent);
		transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
	}
	.add-btn:hover {
		color: var(--color-foreground);
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
		border-color: color-mix(in srgb, var(--color-accent) 35%, transparent);
	}

	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 14px 10px;
		padding: 7px 10px;
		border-radius: 8px;
		background: color-mix(in srgb, var(--color-foreground) 3%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-foreground) 7%, transparent);
		flex-shrink: 0;
		color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
	}
	.search input {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: none;
		outline: none;
		color: color-mix(in srgb, var(--color-foreground) 90%, transparent);
		font-size: 12.5px;
		font-family: inherit;
	}
	.search input::placeholder {
		color: color-mix(in srgb, var(--color-foreground) 30%, transparent);
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
		color: color-mix(in srgb, var(--color-foreground) 30%, transparent);
	}
	.empty p {
		margin: 0;
		font-size: 12.5px;
		max-width: 26ch;
		line-height: 1.5;
	}

	.card {
		border: 1px solid color-mix(in srgb, var(--color-foreground) 10%, transparent);
		border-radius: 12px;
		padding: 10px 10px 8px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.card.pinned {
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 18%, transparent);
	}

	.card-top {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.drag-grip {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		margin: 0 -2px 0 -4px;
		cursor: grab;
		color: color-mix(in srgb, var(--color-foreground) 22%, transparent);
		transition: color 120ms ease;
	}
	.drag-grip:hover {
		color: color-mix(in srgb, var(--color-foreground) 55%, transparent);
	}
	.drag-grip:active {
		cursor: grabbing;
	}
	.kind-badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		flex-shrink: 0;
		font-size: 10px;
		font-variant-numeric: tabular-nums;
		color: color-mix(in srgb, var(--color-foreground) 50%, transparent);
	}
	.card-title {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: none;
		outline: none;
		color: color-mix(in srgb, var(--color-foreground) 92%, transparent);
		font-size: 13px;
		font-weight: 600;
		font-family: inherit;
		padding: 0;
	}
	.card-title::placeholder {
		color: color-mix(in srgb, var(--color-foreground) 30%, transparent);
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
		color: color-mix(in srgb, var(--color-foreground) 30%, transparent);
		transition: color 120ms ease, transform 120ms ease;
	}
	.pin-btn:hover {
		color: color-mix(in srgb, var(--color-foreground) 70%, transparent);
	}
	.pin-btn.on {
		color: var(--color-accent);
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
		color: color-mix(in srgb, var(--color-foreground) 82%, transparent);
		font-size: 12.5px;
		line-height: 1.55;
		font-family: inherit;
		padding: 0;
	}
	.card-body::placeholder {
		color: color-mix(in srgb, var(--color-foreground) 28%, transparent);
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
		background: var(--color-bg2);
		border: 1px solid color-mix(in srgb, var(--color-foreground) 10%, transparent);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
	}
	.swatch {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		cursor: pointer;
		border: 1px solid color-mix(in srgb, var(--color-foreground) 15%, transparent);
		transition: transform 100ms ease;
	}
	.swatch:hover {
		transform: scale(1.15);
	}
	.swatch.active {
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-foreground) 70%, transparent);
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
		color: color-mix(in srgb, var(--color-foreground) 45%, transparent);
		transition: color 120ms ease, background 120ms ease;
	}
	.icon-btn:hover {
		color: color-mix(in srgb, var(--color-foreground) 85%, transparent);
		background: color-mix(in srgb, var(--color-foreground) 5%, transparent);
	}
	.icon-btn.sm {
		padding: 4px;
	}
	.icon-btn.danger:hover {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
	}

	.easel-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		width: 100%;
		padding: 14px 12px;
		border-radius: 10px;
		cursor: pointer;
		color: rgba(255, 255, 255, 0.7);
		background:
			linear-gradient(135deg, rgba(167, 139, 250, 0.08), rgba(96, 165, 250, 0.06)),
			repeating-linear-gradient(45deg, transparent, transparent 9px, rgba(255, 255, 255, 0.02) 9px, rgba(255, 255, 255, 0.02) 10px);
		border: 1px dashed rgba(255, 255, 255, 0.14);
		transition: border-color 120ms ease, color 120ms ease;
		font-family: inherit;
	}
	.easel-card:hover {
		color: #fff;
		border-color: rgba(167, 139, 250, 0.5);
	}
	.easel-count {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
	}
	.easel-open {
		font-size: 11px;
		color: rgba(167, 139, 250, 0.85);
	}
</style>
