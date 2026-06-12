<script lang="ts">
	import { updateNote, setNoteIcon, type AgentNote } from '$lib/state/features/agent-notes.svelte';
	import type { EaselBlock } from '$lib/types/notes';
	import NoteBlocks from './NoteBlocks.svelte';
	import TodoChecklist from './TodoChecklist.svelte';
	import NoteImageStrip from './NoteImageStrip.svelte';
	import ImageLightbox from './ImageLightbox.svelte';
	import EaselBoard from './EaselBoard.svelte';
	import TranscribeButton from './TranscribeButton.svelte';
	import NoteIconButton from './NoteIconButton.svelte';
	import { Minimize2, Wand2 } from 'lucide-svelte';

	let { note, onclose }: { note: AgentNote | null; onclose: () => void } = $props();

	let lightboxSrc = $state<string | null>(null);
	let easelBlock = $state<{ note: AgentNote; block: EaselBlock } | null>(null);

	// The NoteBlocks instance — the header transcription controls feed its focused
	// text block (buffer/ghost live in that block's editor).
	type BlocksRef = {
		handleFinal: (t: string) => void;
		handleInterim: (t: string) => void;
		polishFocused: () => void;
		discardFocused: () => void;
		hasPendingFocused: () => boolean;
		togglePolish: () => void;
	};
	let blocksRef = $state<BlocksRef | undefined>();
	let polishOn = $state(false);

	function onKey(e: KeyboardEvent) {
		// Close on Esc only when no inline ghost/menu swallowed it first.
		if (e.key === 'Escape' && !e.defaultPrevented) onclose();
	}
</script>

<svelte:window onkeydown={onKey} />

{#if note}
	{@const current = note}
	<div class="zen" role="dialog" aria-modal="true" aria-label="Focus mode">
		<div class="zen-header">
			{#if current.kind === 'note'}
				<button
					type="button"
					class="zen-polish"
					class:on={polishOn}
					title="Polish — AI-fill empty titles with a chosen intent"
					onclick={() => blocksRef?.togglePolish()}
				>
					<Wand2 size={14} /> Polish
				</button>
				<TranscribeButton
					allowTab={true}
					onfinal={(t) => blocksRef?.handleFinal(t)}
					oninterim={(t) => blocksRef?.handleInterim(t)}
					onpolish={() => blocksRef?.polishFocused()}
					ondiscard={() => blocksRef?.discardFocused()}
					hasPending={() => blocksRef?.hasPendingFocused() ?? false}
				/>
			{/if}
			<button type="button" class="zen-min" title="Minimize (Esc)" aria-label="Minimize" onclick={onclose}>
				<Minimize2 size={18} />
			</button>
		</div>

		<div class="zen-stage">
			<div class="zen-title-row">
				{#if current.kind === 'note'}
					<NoteIconButton icon={current.icon ?? ''} size={26} onpick={(v) => setNoteIcon(current.id, v)} />
				{/if}
				<input
					class="zen-title"
					placeholder="Title"
					value={current.title}
					oninput={(e) => updateNote(current.id, { title: e.currentTarget.value })}
					aria-label="Title"
				/>
			</div>

			<div class="zen-body" id={`note-${current.id}`}>
				{#if current.kind === 'todo'}
					<TodoChecklist note={current} large />
				{:else}
					<NoteBlocks
						bind:this={blocksRef}
						note={current}
						onopeneasel={(block) => (easelBlock = { note: current, block })}
						onpolishchange={(o) => (polishOn = o)}
					/>
				{/if}
			</div>

			<div class="zen-images">
				<NoteImageStrip note={current} onopen={(src) => (lightboxSrc = src)} />
			</div>
		</div>
	</div>
{/if}

<ImageLightbox src={lightboxSrc} onclose={() => (lightboxSrc = null)} />

{#if easelBlock}
	<EaselBoard note={easelBlock.note} block={easelBlock.block} onclose={() => (easelBlock = null)} />
{/if}

<style>
	.zen {
		position: fixed;
		inset: 0;
		z-index: 90;
		overflow-y: auto;
		background: radial-gradient(
			120% 100% at 50% 0%,
			rgba(20, 20, 22, 0.98),
			rgba(8, 8, 9, 0.99)
		);
		backdrop-filter: blur(10px);
		display: flex;
		justify-content: center;
	}
	.zen-stage {
		width: min(720px, 92vw);
		margin: 9vh 0 12vh;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.zen-title-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-left: -4px;
	}
	.zen-title {
		flex: 1;
		min-width: 0;
		width: 100%;
		background: transparent;
		border: none;
		outline: none;
		color: rgba(255, 255, 255, 0.96);
		font-size: 28px;
		font-weight: 650;
		letter-spacing: -0.01em;
		font-family: inherit;
		padding: 0;
	}
	.zen-title::placeholder {
		color: rgba(255, 255, 255, 0.22);
	}
	.zen-body {
		font-size: 16px;
		line-height: 1.7;
	}
	/* Make the embedded editor breathe in focus mode. */
	.zen-body :global(.note-editor) {
		font-size: 16px;
		line-height: 1.7;
		color: rgba(255, 255, 255, 0.9);
	}
	.zen-body :global(.note-editor .ProseMirror) {
		min-height: 40vh;
	}
	/* Keep the inline transcript ghost the same size as the focus-mode body. */
	.zen-body :global(.transcript-ghost) {
		font-size: 16px;
		line-height: 1.7;
	}
	.zen-images {
		margin-top: 6px;
		border-top: 1px solid rgba(255, 255, 255, 0.07);
		padding-top: 12px;
	}
	.zen-header {
		position: fixed;
		top: 16px;
		right: 18px;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	/* Note-polish trigger. */
	.zen-polish {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 11px;
		font-size: 12px;
		font-family: inherit;
		border-radius: 8px;
		cursor: pointer;
		color: rgba(167, 139, 250, 0.9);
		background: rgba(167, 139, 250, 0.08);
		border: 1px solid rgba(167, 139, 250, 0.28);
		transition: color 120ms ease, background 120ms ease, border-color 120ms ease;
	}
	.zen-polish:hover,
	.zen-polish.on {
		color: #fff;
		background: rgba(167, 139, 250, 0.22);
		border-color: rgba(167, 139, 250, 0.55);
	}
	/* Minimize button — borderless, subtle, icon highlights on hover. */
	.zen-min {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 8px;
		border-radius: 9px;
		cursor: pointer;
		color: rgba(255, 255, 255, 0.4);
		background: transparent;
		border: none;
		transition: color 120ms ease, background 120ms ease;
	}
	.zen-min:hover {
		color: #fff;
		background: rgba(255, 255, 255, 0.08);
	}
</style>
