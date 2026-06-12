<script lang="ts">
	import { slide } from 'svelte/transition';
	import {
		addBlock,
		removeBlock,
		moveBlock,
		setBlockTitle,
		type AgentNote
	} from '$lib/state/features/agent-notes.svelte';
	import type { EaselBlock, TextBlock, TodoBlock } from '$lib/types/notes';
	import {
		getProposal,
		applyProposal,
		clearProposal
	} from '$lib/state/features/note-polish.svelte';
	import { wordDiff } from '$lib/utils/word-diff';
	import NoteEditor from './NoteEditor.svelte';
	import TodoChecklist from './TodoChecklist.svelte';
	import {
		ListTodo,
		LayoutDashboard,
		Trash2,
		ChevronUp,
		ChevronDown,
		Image as ImageIcon,
		Loader2,
		Wand2,
		Check,
		X
	} from 'lucide-svelte';

	let {
		note,
		compact = false,
		onopeneasel
	}: {
		note: AgentNote;
		/** Compact (panel) vs roomy (zen) rendering of text blocks. */
		compact?: boolean;
		/** Open an easel block fullscreen. */
		onopeneasel?: (block: EaselBlock) => void;
	} = $props();

	// Per-text-block editor instances; external transcription controls (panel
	// footer / zen header) feed the focused one.
	type EditorRef = {
		handleFinal: (t: string) => void;
		handleInterim: (t: string) => void;
		polishPending: () => void;
		discardPending: () => void;
		hasPending: () => boolean;
	};
	const editors = $state<Record<string, EditorRef | undefined>>({});
	let focusedTextId = $state<string | null>(null);

	function targetEditor(): EditorRef | undefined {
		const id =
			(focusedTextId && editors[focusedTextId] && focusedTextId) ||
			note.blocks.find((b) => b.type === 'text')?.id;
		return id ? editors[id] : undefined;
	}

	// Exposed to the external mic + polish/discard controls (NotesPanel / ZenMode bind this).
	export function handleFinal(t: string) {
		targetEditor()?.handleFinal(t);
	}
	export function handleInterim(t: string) {
		targetEditor()?.handleInterim(t);
	}
	export function polishFocused() {
		targetEditor()?.polishPending();
	}
	export function discardFocused() {
		targetEditor()?.discardPending();
	}
	export function hasPendingFocused(): boolean {
		return targetEditor()?.hasPending() ?? false;
	}

	// Which embedded-block summaries are expanded (side-menu view).
	let expanded = $state<Set<string>>(new Set());
	function toggleExpand(id: string) {
		const next = new Set(expanded);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		expanded = next;
	}

	function rawSrc(fileId: string): string {
		return `/api/files/${fileId}/raw`;
	}

	// ── Note "Polish" review ───────────────────────────────────────────────────
	// The proposal is a shared (module-level) provisional change set, so it survives
	// switching between the side-menu and zen views and is shown as a confirm/reject
	// diff. The Polish *trigger* lives on the buttons (NotesPanel / ZenMode).
	const proposal = $derived(getProposal(note.id));
	// Titles just filled by polish → one-shot "committed" animation.
	let justFilled = $state<Set<string>>(new Set());

	function confirmPolish() {
		const filled = applyProposal(note.id);
		justFilled = new Set(filled);
		setTimeout(() => (justFilled = new Set()), 1400);
	}
	function rejectPolish() {
		clearProposal(note.id);
	}
</script>

{#snippet textBlock(block: TextBlock, i: number)}
	<NoteEditor
		bind:this={editors[block.id]}
		{note}
		{block}
		placeholder={i === 0 ? 'Take a note… (type / to embed)' : 'Type / to embed…'}
		onfocus={() => (focusedTextId = block.id)}
		oninsertblock={(type) => addBlock(note.id, type, block.id)}
	/>
{/snippet}

{#snippet embedBlock(block: TodoBlock | EaselBlock, i: number)}
	{#if block.type === 'todo'}
		<input
			class="nb-title"
			class:committed={justFilled.has(block.id)}
			placeholder="Checklist title"
			value={block.title ?? ''}
			oninput={(e) => setBlockTitle(note.id, block.id, e.currentTarget.value)}
			aria-label="Checklist title"
		/>
		<div class="nb-embed-body">
			<TodoChecklist {note} {block} large={!compact} />
		</div>
	{:else}
		<input
			class="nb-title"
			class:committed={justFilled.has(block.id)}
			placeholder="Board title"
			value={block.title ?? ''}
			oninput={(e) => setBlockTitle(note.id, block.id, e.currentTarget.value)}
			aria-label="Board title"
		/>
		<button type="button" class="easel-card" onclick={() => onopeneasel?.(block)}>
			{#if block.items.length > 0}
				<div class="easel-thumbs" aria-hidden="true">
					{#each block.items.slice(0, 3) as it (it.id)}
						{#if it.type === 'image'}
							<img class="easel-thumb" src={rawSrc(it.fileId)} alt="" loading="lazy" />
						{:else}
							<span class="easel-thumb easel-thumb-text">{it.text || 'Text'}</span>
						{/if}
					{/each}
					{#if block.items.length > 3}<span class="easel-more">+{block.items.length - 3}</span>{/if}
				</div>
			{/if}
			<div class="easel-meta">
				{#if block.items.length > 0}
					<span class="easel-count"><ImageIcon size={13} /> {block.items.length} items</span>
				{:else}
					<span class="easel-count"><LayoutDashboard size={13} /> Empty board</span>
				{/if}
				<span class="easel-open">Open board</span>
			</div>
		</button>
	{/if}
	<div class="nb-ctl">
		<button type="button" title="Move up" aria-label="Move block up" disabled={i === 0} onclick={() => moveBlock(note.id, block.id, -1)}><ChevronUp size={13} /></button>
		<button type="button" title="Move down" aria-label="Move block down" disabled={i === note.blocks.length - 1} onclick={() => moveBlock(note.id, block.id, 1)}><ChevronDown size={13} /></button>
		<button type="button" class="del" title="Remove block" aria-label="Remove block" onclick={() => removeBlock(note.id, block.id)}><Trash2 size={13} /></button>
	</div>
{/snippet}

<div class="note-blocks">
	{#if proposal?.status === 'ready'}
		<!-- Polish review: provisional changes shown as a diff, confirm or reject. -->
		<div class="nb-review" transition:slide={{ duration: 160 }}>
			<div class="nb-review-head"><Wand2 size={13} /> Polished as <em>{proposal.intent}</em> — review changes</div>
			{#if proposal.noteTitle}
				<div class="nb-rv-row"><span class="nb-rv-label">Title</span><span class="d-add">{proposal.noteTitle.to}</span></div>
			{/if}
			{#each proposal.blockTitles as bt (bt.id)}
				<div class="nb-rv-row"><span class="nb-rv-label">Block title</span><span class="d-add">{bt.to}</span></div>
			{/each}
			{#each proposal.textBlocks as tb (tb.id)}
				<div class="nb-diff">
					{#each wordDiff(tb.from, tb.to) as s, si (si)}<span class={s.type === 'add' ? 'd-add' : s.type === 'del' ? 'd-del' : 'd-same'}>{s.text}</span>{/each}
				</div>
			{/each}
			<div class="nb-rv-bar">
				<button type="button" class="nb-rv-btn reject" onclick={rejectPolish}><X size={13} /> Reject</button>
				<button type="button" class="nb-rv-btn confirm" onclick={confirmPolish}><Check size={13} /> Confirm changes</button>
			</div>
		</div>
	{:else}
		{#if proposal?.status === 'loading'}
			<div class="nb-status" transition:slide={{ duration: 120 }}><Loader2 size={13} class="nb-spin" /> Polishing…</div>
		{:else if proposal?.status === 'error'}
			<div class="nb-status err" transition:slide={{ duration: 120 }}>
				{proposal.error}
				<button type="button" class="nb-status-dismiss" onclick={rejectPolish}>Dismiss</button>
			</div>
		{/if}

		{#if compact}
			<!-- Side-menu: embedded blocks hoisted to the top as collapsible summaries. -->
			{#each note.blocks as block, i (block.id)}
				{#if block.type !== 'text'}
					{@const count = block.type === 'todo' ? block.items.filter((x) => x.text.trim()).length : block.items.length}
					<div class="nb-summary" class:open={expanded.has(block.id)}>
						<button type="button" class="nb-sum-head" onclick={() => toggleExpand(block.id)}>
							{#if block.type === 'todo'}<ListTodo size={14} />{:else}<LayoutDashboard size={14} />{/if}
							<span class="nb-sum-title">{block.title?.trim() || (block.type === 'todo' ? 'Checklist' : 'Board')}</span>
							<span class="nb-sum-count">{count} {count === 1 ? 'item' : 'items'}</span>
							<ChevronDown class="nb-sum-chev {expanded.has(block.id) ? 'rot' : ''}" size={14} />
						</button>
						{#if expanded.has(block.id)}
							<div class="nb-sum-body">{@render embedBlock(block, i)}</div>
						{/if}
					</div>
				{/if}
			{/each}
			{#each note.blocks as block, i (block.id)}
				{#if block.type === 'text'}
					<div class="nb-block">{@render textBlock(block, i)}</div>
				{/if}
			{/each}
		{:else}
			<!-- Zen: blocks rendered inline, in order. -->
			{#each note.blocks as block, i (block.id)}
				<div class="nb-block" class:embed={block.type !== 'text'}>
					{#if block.type === 'text'}{@render textBlock(block, i)}{:else}{@render embedBlock(block, i)}{/if}
				</div>
			{/each}
		{/if}
	{/if}
</div>

<style>
	.note-blocks {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	/* Collapsible embedded-block summary (side-menu). */
	.nb-summary {
		border-radius: 9px;
		background: color-mix(in srgb, var(--color-foreground) 3%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-foreground) 8%, transparent);
		overflow: hidden;
	}
	.nb-sum-head {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 9px 10px;
		font-family: inherit;
		font-size: 12.5px;
		cursor: pointer;
		background: transparent;
		border: none;
		color: color-mix(in srgb, var(--color-foreground) 85%, transparent);
		transition: background 120ms ease;
	}
	.nb-sum-head:hover {
		background: color-mix(in srgb, var(--color-foreground) 4%, transparent);
	}
	.nb-sum-head :global(svg) {
		color: var(--color-accent);
		flex-shrink: 0;
	}
	.nb-sum-title {
		flex: 1;
		min-width: 0;
		font-weight: 600;
		text-align: left;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.nb-sum-count {
		font-size: 11px;
		color: color-mix(in srgb, var(--color-foreground) 45%, transparent);
		flex-shrink: 0;
	}
	.nb-sum-head :global(.nb-sum-chev) {
		color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
		transition: transform 160ms ease;
	}
	.nb-sum-head :global(.nb-sum-chev.rot) {
		transform: rotate(180deg);
	}
	.nb-sum-body {
		padding: 0 10px 8px;
	}
	.nb-block.embed {
		position: relative;
		border-radius: 9px;
		padding: 8px 8px 6px;
		background: color-mix(in srgb, var(--color-foreground) 3%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-foreground) 8%, transparent);
	}
	/* Embedded block title (todo/easel). */
	.nb-title {
		width: 100%;
		margin: 0 0 6px;
		padding: 2px 2px;
		background: transparent;
		border: none;
		outline: none;
		font-family: inherit;
		font-size: 13px;
		font-weight: 600;
		color: color-mix(in srgb, var(--color-foreground) 90%, transparent);
	}
	.nb-title::placeholder {
		color: color-mix(in srgb, var(--color-foreground) 28%, transparent);
		font-weight: 500;
	}
	/* Provisional → committed: a one-shot accent flash when AI fills a title. */
	.nb-title.committed {
		animation: nb-commit 1.3s ease-out;
	}
	@keyframes nb-commit {
		0% {
			color: var(--color-accent);
			background: color-mix(in srgb, var(--color-accent) 16%, transparent);
		}
		100% {
			color: color-mix(in srgb, var(--color-foreground) 90%, transparent);
			background: transparent;
		}
	}

	/* Note-polish intent chips (below the note). */
	/* Polish status pill (loading / error). */
	.nb-status {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 7px 10px;
		font-size: 12px;
		border-radius: 8px;
		color: color-mix(in srgb, var(--color-foreground) 70%, transparent);
		background: color-mix(in srgb, var(--color-accent) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-accent) 22%, transparent);
	}
	.nb-status.err {
		color: var(--color-accent);
	}
	.nb-status-dismiss {
		margin-left: auto;
		font-family: inherit;
		font-size: 11px;
		padding: 2px 7px;
		border-radius: 5px;
		cursor: pointer;
		color: inherit;
		background: transparent;
		border: 1px solid color-mix(in srgb, var(--color-foreground) 18%, transparent);
	}
	:global(.nb-status .nb-spin) {
		animation: nb-rot 0.8s linear infinite;
	}
	@keyframes nb-rot {
		to {
			transform: rotate(360deg);
		}
	}

	/* Polish review (confirm/reject diff). */
	.nb-review {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px;
		border-radius: 10px;
		background: color-mix(in srgb, var(--color-accent) 6%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-accent) 28%, transparent);
	}
	.nb-review-head {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11.5px;
		color: color-mix(in srgb, var(--color-foreground) 60%, transparent);
	}
	.nb-review-head :global(svg) {
		color: rgba(167, 139, 250, 0.95);
	}
	.nb-review-head em {
		font-style: italic;
		color: rgba(167, 139, 250, 0.95);
	}
	.nb-rv-row {
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-size: 13px;
	}
	.nb-rv-label {
		flex-shrink: 0;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
	}
	.nb-diff {
		font-size: 13px;
		line-height: 1.6;
		color: color-mix(in srgb, var(--color-foreground) 85%, transparent);
		white-space: pre-wrap;
		word-break: break-word;
	}
	.d-del {
		text-decoration: line-through;
		color: rgba(232, 125, 106, 0.85);
		background: rgba(232, 125, 106, 0.1);
	}
	.d-add {
		color: rgba(52, 211, 153, 0.95);
		background: rgba(52, 211, 153, 0.12);
		border-radius: 3px;
	}
	.nb-rv-bar {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 2px;
	}
	.nb-rv-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 6px 12px;
		font-size: 12.5px;
		font-family: inherit;
		font-weight: 500;
		border-radius: 8px;
		cursor: pointer;
		transition: filter 120ms ease, background 120ms ease;
	}
	.nb-rv-btn.reject {
		color: color-mix(in srgb, var(--color-foreground) 70%, transparent);
		background: transparent;
		border: 1px solid color-mix(in srgb, var(--color-foreground) 16%, transparent);
	}
	.nb-rv-btn.reject:hover {
		color: var(--color-foreground);
		background: color-mix(in srgb, var(--color-foreground) 6%, transparent);
	}
	.nb-rv-btn.confirm {
		color: var(--color-accent-foreground, #fff);
		background: var(--color-accent);
		border: 1px solid var(--color-accent);
	}
	.nb-rv-btn.confirm:hover {
		filter: brightness(1.08);
	}
	.nb-ctl {
		display: flex;
		justify-content: flex-end;
		gap: 2px;
		margin-top: 4px;
		opacity: 0;
		transition: opacity 120ms ease;
	}
	.nb-block.embed:hover .nb-ctl,
	.nb-block.embed:focus-within .nb-ctl {
		opacity: 1;
	}
	.nb-ctl button {
		display: inline-flex;
		padding: 3px;
		border-radius: 5px;
		cursor: pointer;
		background: transparent;
		border: none;
		color: color-mix(in srgb, var(--color-foreground) 40%, transparent);
		transition: color 120ms ease, background 120ms ease;
	}
	.nb-ctl button:hover:not(:disabled) {
		color: color-mix(in srgb, var(--color-foreground) 85%, transparent);
		background: color-mix(in srgb, var(--color-foreground) 6%, transparent);
	}
	.nb-ctl button:disabled {
		opacity: 0.3;
		cursor: default;
	}
	.nb-ctl button.del:hover {
		color: var(--color-accent);
	}


	/* Easel block preview card. */
	.easel-card {
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: 100%;
		padding: 4px;
		border-radius: 8px;
		cursor: pointer;
		color: rgba(255, 255, 255, 0.7);
		background: transparent;
		border: none;
		font-family: inherit;
		transition: color 120ms ease;
	}
	.easel-card:hover {
		color: #fff;
	}
	.easel-thumbs {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.easel-thumb {
		width: 56px;
		height: 42px;
		flex-shrink: 0;
		object-fit: cover;
		border-radius: 6px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: rgba(0, 0, 0, 0.25);
	}
	.easel-thumb-text {
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		padding: 4px 6px;
		font-size: 10px;
		line-height: 1.25;
		color: rgba(255, 255, 255, 0.6);
		overflow: hidden;
		white-space: normal;
		word-break: break-word;
	}
	.easel-more {
		font-size: 11px;
		color: rgba(255, 255, 255, 0.6);
	}
	.easel-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
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
