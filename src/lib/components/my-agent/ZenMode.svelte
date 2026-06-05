<script lang="ts">
	import { updateNote, type AgentNote } from '$lib/state/features/agent-notes.svelte';
	import NoteEditor from './NoteEditor.svelte';
	import TodoChecklist from './TodoChecklist.svelte';
	import NoteImageStrip from './NoteImageStrip.svelte';
	import ImageLightbox from './ImageLightbox.svelte';
	import { X, StickyNote, ListTodo } from 'lucide-svelte';

	let { note, onclose }: { note: AgentNote | null; onclose: () => void } = $props();

	let lightboxSrc = $state<string | null>(null);

	function onKey(e: KeyboardEvent) {
		// Close on Esc only when no inline ghost/menu swallowed it first.
		if (e.key === 'Escape' && !e.defaultPrevented) onclose();
	}
</script>

<svelte:window onkeydown={onKey} />

{#if note}
	{@const current = note}
	<div class="zen" role="dialog" aria-modal="true" aria-label="Focus mode">
		<button type="button" class="zen-close" title="Exit focus (Esc)" aria-label="Exit focus" onclick={onclose}>
			<X size={18} />
		</button>

		<div class="zen-stage">
			<div class="zen-kind">
				{#if current.kind === 'todo'}<ListTodo size={13} /> Checklist{:else}<StickyNote size={13} /> Note{/if}
			</div>

			<input
				class="zen-title"
				placeholder="Title"
				value={current.title}
				oninput={(e) => updateNote(current.id, { title: e.currentTarget.value })}
				aria-label="Title"
			/>

			<div class="zen-body" id={`note-${current.id}`}>
				{#if current.kind === 'todo'}
					<TodoChecklist note={current} large />
				{:else}
					<NoteEditor note={current} autofocus placeholder="Start writing… (Tab for a suggestion)" />
				{/if}
			</div>

			<div class="zen-images">
				<NoteImageStrip note={current} onopen={(src) => (lightboxSrc = src)} />
			</div>
		</div>
	</div>
{/if}

<ImageLightbox src={lightboxSrc} onclose={() => (lightboxSrc = null)} />

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
	.zen-kind {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: rgba(255, 255, 255, 0.4);
	}
	.zen-title {
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
	.zen-images {
		margin-top: 6px;
		border-top: 1px solid rgba(255, 255, 255, 0.07);
		padding-top: 12px;
	}
	.zen-close {
		position: fixed;
		top: 18px;
		right: 20px;
		z-index: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 8px;
		border-radius: 9px;
		cursor: pointer;
		color: rgba(255, 255, 255, 0.6);
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.12);
		transition: color 120ms ease, background 120ms ease;
	}
	.zen-close:hover {
		color: #fff;
		background: rgba(255, 255, 255, 0.14);
	}
</style>
