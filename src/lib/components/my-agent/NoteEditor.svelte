<script lang="ts">
	import { untrack } from 'svelte';
	import { Editor } from '@tiptap/core';
	import type { EditorView } from '@tiptap/pm/view';
	import StarterKit from '@tiptap/starter-kit';
	import Highlight from '@tiptap/extension-highlight';
	import Image from '@tiptap/extension-image';
	import { Markdown } from 'tiptap-markdown';
	import {
		Bold,
		Italic,
		Strikethrough,
		Code,
		Highlighter,
		Heading1,
		Heading2,
		List,
		ListTodo,
		LayoutDashboard,
		RemoveFormatting
	} from 'lucide-svelte';
	import { createAutofill } from '$lib/components/my-agent/tiptap-autofill';
	import { polishTranscript } from '$lib/state/features/notes-autocomplete';
	import { txPrefs } from '$lib/state/features/transcription-prefs.svelte';
	import {
		updateNote,
		setTextBlock,
		uploadNoteImage,
		type AgentNote
	} from '$lib/state/features/agent-notes.svelte';
	import type { TextBlock } from '$lib/types/notes';

	let {
		note,
		block,
		placeholder = 'Take a note…',
		autofocus = false,
		onfocus,
		oninsertblock
	}: {
		note: AgentNote;
		/** When set, the editor edits this text block instead of the legacy note body. */
		block?: TextBlock;
		placeholder?: string;
		autofocus?: boolean;
		/** Fired when this editor gains focus (so the footer mic can target it). */
		onfocus?: () => void;
		/** Slash-menu: insert a new block of `type` right after this text block. */
		oninsertblock?: (type: 'todo' | 'easel' | 'text') => void;
	} = $props();

	// Current markdown source for this editor (block content or legacy note body).
	const sourceMd = () => (block ? block.md : note.body);
	function persistMd(md: string) {
		if (block) setTextBlock(note.id, block.id, md);
		else updateNote(note.id, { body: md });
	}

	let element = $state<HTMLDivElement | null>(null);
	let editor: Editor | null = null;

	// ── Transcription buffer ───────────────────────────────────────────────────
	// Transcription is NON-EAGER: finalized speech accumulates in `pending` and is
	// shown inline as dimmed italic ghost text (the same type as the note body).
	// It commits to the note only after a quiet pause — the user may still be
	// mid-thought, and a later phrase can reframe what came before. The buffer is
	// mirrored to localStorage as it streams, so a crash/refresh never loses it.
	const COMMIT_DELAY = 5000;
	// The panel keys each card by note.id, so this component is recreated per note —
	// reading the id once here is correct and stable for this instance's lifetime.
	// svelte-ignore state_referenced_locally
	const bufferKey = `minion-note-transcript-buf-${note.id}-${block?.id ?? 'body'}`;

	let pending = $state('');
	let interim = $state('');
	let polishing = $state(false);
	let commitTimer: ReturnType<typeof setTimeout> | null = null;

	function persistBuffer() {
		try {
			const all = (pending + interim).trim();
			if (all) localStorage.setItem(bufferKey, pending + interim);
			else localStorage.removeItem(bufferKey);
		} catch {
			/* storage unavailable — in-memory buffer still works */
		}
	}

	function scheduleCommit() {
		if (commitTimer) clearTimeout(commitTimer);
		commitTimer = setTimeout(commitPending, COMMIT_DELAY);
	}

	async function commitPending() {
		if (commitTimer) {
			clearTimeout(commitTimer);
			commitTimer = null;
		}
		const raw = pending.trim();
		pending = '';
		interim = '';
		try {
			localStorage.removeItem(bufferKey);
		} catch {
			/* ignore */
		}
		if (!raw) return;
		let text = raw;
		// Auto-polish the dictation before committing, if the user enabled it.
		if (txPrefs.autoPolish) {
			try {
				const cleaned = await polishTranscript(raw, txPrefs.intent);
				if (cleaned) text = cleaned;
			} catch {
				/* fall back to raw on failure */
			}
		}
		if (!editor) return;
		editor.chain().focus('end').insertContent(text + ' ').run();
	}

	// Exported so the compact card footer can host the mic while the buffer/ghost
	// live here (the pending transcript renders inline in this editor's body).
	export function handleFinal(text: string) {
		pending += text;
		persistBuffer();
		scheduleCommit();
	}

	export function handleInterim(text: string) {
		interim = text;
		persistBuffer();
	}

	// Exported (with handleFinal/handleInterim) so the external transcription
	// controls (panel footer / zen header) can drive this editor's buffer.
	export function discardPending() {
		if (commitTimer) {
			clearTimeout(commitTimer);
			commitTimer = null;
		}
		pending = '';
		interim = '';
		try {
			localStorage.removeItem(bufferKey);
		} catch {
			/* ignore */
		}
	}

	export function hasPending(): boolean {
		return pending.trim().length > 0;
	}
	export function isPolishing(): boolean {
		return polishing;
	}

	export async function polishPending() {
		const raw = (pending + interim).trim();
		if (!raw || polishing) return;
		polishing = true;
		try {
			const cleaned = await polishTranscript(raw, txPrefs.intent);
			pending = cleaned ? cleaned + ' ' : '';
			interim = '';
			persistBuffer();
			scheduleCommit();
		} catch {
			/* leave the raw buffer intact so nothing is lost */
		} finally {
			polishing = false;
		}
	}

	// Recover any buffered (uncommitted) transcript from a previous crash/refresh.
	$effect(() => {
		untrack(() => {
			try {
				const saved = localStorage.getItem(bufferKey);
				if (saved && !pending) {
					pending = saved;
					scheduleCommit();
				}
			} catch {
				/* ignore */
			}
		});
		return () => {
			if (commitTimer) clearTimeout(commitTimer);
		};
	});

	// ── Formatting toolbar (bubble menu) ───────────────────────────────────────
	// Appears when text is selected inside the editor, or on right-click within
	// it. Applies real marks (which round-trip through Markdown), so formatting
	// renders reliably regardless of markdown-shortcut input rules.
	let toolbar = $state<{ left: number; top: number } | null>(null);
	let pinned = $state(false); // opened via context menu — stays until dismissed
	let active = $state({
		bold: false,
		italic: false,
		strike: false,
		code: false,
		highlight: false,
		h1: false,
		h2: false,
		bullet: false
	});

	function refreshActive() {
		if (!editor) return;
		active = {
			bold: editor.isActive('bold'),
			italic: editor.isActive('italic'),
			strike: editor.isActive('strike'),
			code: editor.isActive('code'),
			highlight: editor.isActive('highlight'),
			h1: editor.isActive('heading', { level: 1 }),
			h2: editor.isActive('heading', { level: 2 }),
			bullet: editor.isActive('bulletList')
		};
	}

	function placeToolbarAtSelection() {
		if (!editor) return;
		const { from, to } = editor.state.selection;
		const start = editor.view.coordsAtPos(from);
		const end = editor.view.coordsAtPos(to);
		const left = (start.left + end.left) / 2;
		const top = Math.min(start.top, end.top);
		toolbar = { left, top };
	}

	// Recompute toolbar visibility/position from the live selection.
	function syncToolbar() {
		if (!editor) return;
		const sel = editor.state.selection;
		if (sel.empty && !pinned) {
			toolbar = null;
			return;
		}
		if (sel.empty && pinned) {
			refreshActive();
			return; // keep the pinned toolbar where it is
		}
		refreshActive();
		placeToolbarAtSelection();
	}

	function closeToolbar() {
		toolbar = null;
		pinned = false;
	}

	// Run an editor command then refresh active states + position (selection kept).
	function run(fn: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) {
		if (!editor) return;
		fn(editor.chain().focus()).run();
		refreshActive();
	}

	function onEditorContextMenu(e: MouseEvent) {
		if (!editor) return;
		e.preventDefault();
		pinned = true;
		refreshActive();
		const sel = editor.state.selection;
		if (sel.empty) {
			toolbar = { left: e.clientX, top: e.clientY };
		} else {
			placeToolbarAtSelection();
		}
	}

	// ── Slash menu: type "/" in a block to embed a to-do or easel ──────────────
	const SLASH_ITEMS: { type: 'todo' | 'easel'; label: string; kw: string[] }[] = [
		{ type: 'todo', label: 'To-do list', kw: ['todo', 'task', 'tasks', 'check', 'list', 'checklist'] },
		{ type: 'easel', label: 'Easel / moodboard', kw: ['easel', 'board', 'moodboard', 'whiteboard', 'draw', 'image'] }
	];
	let slashOpen = $state(false);
	let slashPos = $state<{ left: number; top: number } | null>(null);
	let slashQuery = $state('');
	let slashIndex = $state(0); // highlighted item (keyboard nav)
	let slashStart = -1; // doc position of the "/" that opened the menu
	const slashMatches = $derived(
		slashQuery
			? SLASH_ITEMS.filter(
					(i) => i.type.startsWith(slashQuery) || i.kw.some((k) => k.startsWith(slashQuery))
				)
			: SLASH_ITEMS
	);

	// Keyboard nav while the slash menu is open. Returns true if the key was
	// consumed (so ProseMirror doesn't also act on it).
	function slashKeydown(e: KeyboardEvent): boolean {
		if (!slashOpen || slashMatches.length === 0) return false;
		if (e.key === 'ArrowDown') {
			slashIndex = (slashIndex + 1) % slashMatches.length;
			return true;
		}
		if (e.key === 'ArrowUp') {
			slashIndex = (slashIndex - 1 + slashMatches.length) % slashMatches.length;
			return true;
		}
		if (e.key === 'Enter') {
			const it = slashMatches[Math.min(slashIndex, slashMatches.length - 1)];
			if (it) chooseSlash(it.type);
			return true;
		}
		if (e.key === 'Escape') {
			slashOpen = false;
			return true;
		}
		return false;
	}

	// Detect a "/query" token at the caret (Notion-style) and surface the menu.
	function maybeSlash() {
		if (!oninsertblock || !editor) {
			slashOpen = false;
			return;
		}
		const sel = editor.state.selection;
		if (!sel.empty) {
			slashOpen = false;
			return;
		}
		const resolved = editor.state.doc.resolve(sel.from);
		const before = resolved.parent.textBetween(0, resolved.parentOffset, undefined, '￼');
		const m = /(?:^|\s)\/([a-z]*)$/i.exec(before);
		if (m) {
			slashQuery = m[1].toLowerCase();
			slashStart = sel.from - m[1].length - 1; // include the "/"
			slashIndex = 0; // first match focused for quick-pick (also resets on filter)
			const c = editor.view.coordsAtPos(sel.from);
			slashPos = { left: c.left, top: c.bottom };
			slashOpen = true;
		} else {
			slashOpen = false;
		}
	}

	function chooseSlash(type: 'todo' | 'easel') {
		slashOpen = false;
		// Strip the "/query" the user typed, then insert the new block after this one.
		if (editor && slashStart >= 0) {
			const to = editor.state.selection.from;
			editor.chain().focus().deleteRange({ from: slashStart, to }).run();
		}
		oninsertblock?.(type);
	}

	// ── Media: drop / paste images & URLs (no buttons) ─────────────────────────
	const IMG_URL_RE = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)(\?|#|$)/i;
	const URL_RE = /^https?:\/\/[^\s]+$/i;

	function insertImage(src: string, pos?: number) {
		if (!editor) return;
		const chain = editor.chain().focus();
		if (pos != null) chain.insertContentAt(pos, { type: 'image', attrs: { src } });
		else chain.setImage({ src });
		chain.run();
	}

	function insertLink(href: string, pos?: number) {
		if (!editor) return;
		const node = { type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] };
		const chain = editor.chain().focus();
		if (pos != null) chain.insertContentAt(pos, node);
		else chain.insertContent(node);
		chain.run();
	}

	async function uploadAndInsert(file: File, pos?: number) {
		try {
			const fileId = await uploadNoteImage(file);
			insertImage(`/api/files/${fileId}/raw`, pos);
		} catch {
			/* upload failed — drop silently */
		}
	}

	// Returns true if we handled the paste/drop (image files, image URL, or link).
	function ingest(data: DataTransfer | null, pos?: number): boolean {
		if (!data) return false;
		const imgFiles = Array.from(data.files).filter((f) => f.type.startsWith('image/'));
		if (imgFiles.length) {
			for (const f of imgFiles) void uploadAndInsert(f, pos);
			return true;
		}
		const text = (data.getData('text/uri-list') || data.getData('text/plain') || '').trim();
		if (text && URL_RE.test(text)) {
			if (IMG_URL_RE.test(text)) insertImage(text, pos);
			else insertLink(text, pos);
			return true;
		}
		return false;
	}

	function onEditorPaste(view: EditorView, event: ClipboardEvent): boolean {
		const handled = ingest(event.clipboardData);
		if (handled) {
			event.preventDefault();
			event.stopPropagation();
		}
		return handled;
	}

	function onEditorDrop(view: EditorView, event: DragEvent): boolean {
		const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
		const handled = ingest(event.dataTransfer, at?.pos);
		if (handled) event.preventDefault();
		return handled;
	}

	// Create the editor once the container is mounted (browser-only). Content is
	// the note's Markdown body — the Markdown extension parses the string on the
	// way in and serializes back out via storage.markdown.getMarkdown().
	//
	// This effect must depend on ONLY `element`. Everything else (note.body,
	// note.id, autofocus) is read inside untrack() — otherwise onUpdate's
	// updateNote() mutates note.body, which would re-run this effect, destroy the
	// editor, and recreate it on every keystroke (severe lag + dropped chars).
	$effect(() => {
		if (!element) return;
		const el = element;
		untrack(() => {
			if (editor) return;
			editor = new Editor({
				element: el,
				extensions: [
					StarterKit,
					Highlight,
					Image.configure({ inline: false, allowBase64: false }),
					// html:true lets marks without a markdown spec (highlight → <mark>) round-trip.
					Markdown.configure({ html: true, transformPastedText: true, transformCopiedText: true }),
					createAutofill({ kind: 'note', getContext: () => sourceMd() })
				],
				content: sourceMd() || '',
				autofocus: autofocus ? 'end' : false,
				editorProps: {
					attributes: { class: 'note-prose', 'aria-label': 'Note body' },
					handleKeyDown: (_view, event) => slashKeydown(event),
					handlePaste: onEditorPaste,
					handleDrop: onEditorDrop
				},
				onUpdate({ editor: ed }) {
					const md =
						(ed.storage as unknown as Record<string, { getMarkdown?: () => string }>).markdown?.getMarkdown?.() ??
						'';
					persistMd(md);
					maybeSlash();
					syncToolbar();
				},
				onFocus() {
					onfocus?.();
				},
				onSelectionUpdate() {
					maybeSlash();
					syncToolbar();
				},
				onBlur() {
					// A blur from clicking the toolbar is prevented (mousedown
					// preventDefault); any real blur that isn't pinned dismisses.
					if (!pinned) toolbar = null;
				}
			});
		});

		return () => {
			editor?.destroy();
			editor = null;
		};
	});
</script>

<div class="note-editor-wrap">
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="note-editor"
		bind:this={element}
		data-placeholder={placeholder}
		oncontextmenu={onEditorContextMenu}
	></div>
	{#if pending || interim}
		<p class="transcript-ghost" aria-live="polite">{pending}{interim}</p>
	{/if}
</div>

{#if toolbar}
	<!-- Floating formatting toolbar. mousedown is prevented so clicking a button
	     never blurs the editor / clears the selection. -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fmt-toolbar"
		style:left="{toolbar.left}px"
		style:top="{toolbar.top}px"
		onmousedown={(e) => e.preventDefault()}
		role="toolbar"
		tabindex="-1"
		aria-label="Text formatting"
	>
		<button type="button" class="fmt-btn" class:on={active.bold} title="Bold" aria-label="Bold" onclick={() => run((c) => c.toggleBold())}><Bold size={14} /></button>
		<button type="button" class="fmt-btn" class:on={active.italic} title="Italic" aria-label="Italic" onclick={() => run((c) => c.toggleItalic())}><Italic size={14} /></button>
		<button type="button" class="fmt-btn" class:on={active.strike} title="Strikethrough" aria-label="Strikethrough" onclick={() => run((c) => c.toggleStrike())}><Strikethrough size={14} /></button>
		<button type="button" class="fmt-btn" class:on={active.code} title="Inline code" aria-label="Inline code" onclick={() => run((c) => c.toggleCode())}><Code size={14} /></button>
		<button type="button" class="fmt-btn" class:on={active.highlight} title="Highlight" aria-label="Highlight" onclick={() => run((c) => c.toggleHighlight())}><Highlighter size={14} /></button>
		<span class="fmt-sep"></span>
		<button type="button" class="fmt-btn" class:on={active.h1} title="Heading 1" aria-label="Heading 1" onclick={() => run((c) => c.toggleHeading({ level: 1 }))}><Heading1 size={14} /></button>
		<button type="button" class="fmt-btn" class:on={active.h2} title="Heading 2" aria-label="Heading 2" onclick={() => run((c) => c.toggleHeading({ level: 2 }))}><Heading2 size={14} /></button>
		<button type="button" class="fmt-btn" class:on={active.bullet} title="Bullet list" aria-label="Bullet list" onclick={() => run((c) => c.toggleBulletList())}><List size={14} /></button>
		<span class="fmt-sep"></span>
		<button type="button" class="fmt-btn" title="Clear formatting" aria-label="Clear formatting" onclick={() => run((c) => c.unsetAllMarks().clearNodes())}><RemoveFormatting size={14} /></button>
	</div>
{/if}

{#if slashOpen && slashPos && slashMatches.length > 0}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="slash-menu"
		style:left="{slashPos.left}px"
		style:top="{slashPos.top}px"
		onmousedown={(e) => e.preventDefault()}
		role="menu"
		tabindex="-1"
		aria-label="Insert block"
	>
		{#each slashMatches as item, idx (item.type)}
			<button
				type="button"
				role="menuitem"
				class="slash-item"
				class:active={idx === slashIndex}
				onmousemove={() => (slashIndex = idx)}
				onclick={() => chooseSlash(item.type)}
			>
				{#if item.type === 'todo'}<ListTodo size={14} />{:else}<LayoutDashboard size={14} />{/if}
				{item.label}
			</button>
		{/each}
	</div>
{/if}

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') {
			if (slashOpen) slashOpen = false;
			if (toolbar) closeToolbar();
		}
	}}
	onscroll={() => { if (toolbar && !pinned) syncToolbar(); else if (toolbar) closeToolbar(); }}
	onpointerdown={(e) => {
		if (toolbar && e.target instanceof Node && !(e.target as Element).closest?.('.fmt-toolbar') && !(e.target as Element).closest?.('.note-editor')) closeToolbar();
	}}
/>

<style>
	.note-editor-wrap {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	/* Floating formatting toolbar (bubble menu). */
	.fmt-toolbar {
		position: fixed;
		z-index: 95;
		transform: translate(-50%, calc(-100% - 8px));
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 4px;
		border-radius: 9px;
		background: var(--color-bg2, #1b1b1f);
		border: 1px solid rgba(255, 255, 255, 0.12);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
	}
	.fmt-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 6px;
		cursor: pointer;
		background: transparent;
		border: none;
		color: rgba(255, 255, 255, 0.7);
		transition: color 120ms ease, background 120ms ease;
	}
	.fmt-btn:hover {
		color: #fff;
		background: rgba(255, 255, 255, 0.08);
	}
	.fmt-btn.on {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 16%, transparent);
	}
	.fmt-sep {
		width: 1px;
		height: 18px;
		margin: 0 2px;
		background: rgba(255, 255, 255, 0.12);
	}
	/* Slash menu (type "/" to embed a to-do or easel). */
	.slash-menu {
		position: fixed;
		z-index: 95;
		min-width: 180px;
		display: flex;
		flex-direction: column;
		padding: 4px;
		border-radius: 9px;
		background: var(--color-bg2, #1b1b1f);
		border: 1px solid rgba(255, 255, 255, 0.12);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
	}
	.slash-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 9px;
		font-size: 12.5px;
		font-family: inherit;
		text-align: left;
		border-radius: 6px;
		cursor: pointer;
		background: transparent;
		border: none;
		color: rgba(255, 255, 255, 0.82);
		transition: background 120ms ease, color 120ms ease;
	}
	.slash-item:hover,
	.slash-item.active {
		color: #fff;
		background: color-mix(in srgb, var(--color-accent) 18%, transparent);
	}
	.slash-item :global(svg) {
		color: var(--color-accent);
	}
	/* Inline images dropped/pasted into the note. */
	:global(.note-editor .ProseMirror img) {
		max-width: 100%;
		height: auto;
		border-radius: 8px;
		margin: 4px 0;
		display: block;
	}
	:global(.note-editor .ProseMirror img.ProseMirror-selectednode) {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}
	/* Highlight mark inside the editor. */
	:global(.note-editor .ProseMirror mark) {
		background: color-mix(in srgb, var(--color-accent) 35%, transparent);
		color: inherit;
		border-radius: 3px;
		padding: 0 1px;
	}

	/* Pending (uncommitted) transcript — rendered inline with the note body in
	   the same type, just dimmed + italic so it reads as a draft of the note. */
	.transcript-ghost {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.55;
		font-family: inherit;
		font-style: italic;
		color: rgba(255, 255, 255, 0.4);
		white-space: pre-wrap;
		word-break: break-word;
	}
	.note-editor {
		width: 100%;
		font-size: 12.5px;
		line-height: 1.55;
		color: rgba(255, 255, 255, 0.82);
	}
	:global(.note-editor .ProseMirror) {
		outline: none;
		min-height: 36px;
		white-space: pre-wrap;
		word-break: break-word;
	}
	/* Placeholder for an empty editor. */
	:global(.note-editor .ProseMirror.is-editor-empty:first-child::before),
	:global(.note-editor .ProseMirror p.is-empty:first-child::before) {
		content: attr(data-placeholder);
		color: rgba(255, 255, 255, 0.28);
		float: left;
		height: 0;
		pointer-events: none;
	}
	:global(.note-editor .ProseMirror p) {
		margin: 0 0 0.5em;
	}
	:global(.note-editor .ProseMirror p:last-child) {
		margin-bottom: 0;
	}
	:global(.note-editor .ProseMirror h1) {
		font-size: 1.35em;
		font-weight: 650;
		margin: 0.4em 0 0.3em;
	}
	:global(.note-editor .ProseMirror h2) {
		font-size: 1.18em;
		font-weight: 600;
		margin: 0.4em 0 0.3em;
	}
	:global(.note-editor .ProseMirror h3) {
		font-size: 1.05em;
		font-weight: 600;
		margin: 0.4em 0 0.3em;
	}
	:global(.note-editor .ProseMirror ul),
	:global(.note-editor .ProseMirror ol) {
		margin: 0.2em 0;
		padding-left: 1.4em;
	}
	/* The app/Tailwind base resets list markers — restore them inside notes. */
	:global(.note-editor .ProseMirror ul) {
		list-style: disc outside;
	}
	:global(.note-editor .ProseMirror ol) {
		list-style: decimal outside;
	}
	:global(.note-editor .ProseMirror li) {
		display: list-item;
	}
	:global(.note-editor .ProseMirror li p) {
		margin: 0;
	}
	:global(.note-editor .ProseMirror code) {
		font-family: ui-monospace, monospace;
		font-size: 0.92em;
		padding: 1px 4px;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.08);
	}
	:global(.note-editor .ProseMirror pre) {
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 8px;
		padding: 8px 10px;
		overflow-x: auto;
	}
	:global(.note-editor .ProseMirror pre code) {
		background: none;
		padding: 0;
	}
	:global(.note-editor .ProseMirror blockquote) {
		border-left: 2px solid color-mix(in srgb, var(--color-accent) 50%, transparent);
		margin: 0.3em 0;
		padding-left: 0.8em;
		color: rgba(255, 255, 255, 0.65);
	}
	:global(.note-editor .ProseMirror a) {
		color: var(--color-accent);
		text-decoration: underline;
	}
	/* Ghost-text autocomplete suggestion (set by the autofill extension). */
	:global(.note-editor .autofill-ghost) {
		color: rgba(255, 255, 255, 0.32);
		pointer-events: none;
	}
</style>
