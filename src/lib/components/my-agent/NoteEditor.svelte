<script lang="ts">
	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import { Markdown } from 'tiptap-markdown';
	import { createAutofill } from '$lib/components/my-agent/tiptap-autofill';
	import TranscribeButton from './TranscribeButton.svelte';
	import { updateNote, type AgentNote } from '$lib/state/features/agent-notes.svelte';

	let {
		note,
		placeholder = 'Take a note…',
		autofocus = false,
		compactTools = false
	}: { note: AgentNote; placeholder?: string; autofocus?: boolean; compactTools?: boolean } =
		$props();

	// Insert finalized transcript text at the caret (or end).
	function insertTranscript(text: string) {
		if (!editor) return;
		editor.chain().focus().insertContent(text).run();
	}

	let element = $state<HTMLDivElement | null>(null);
	let editor: Editor | null = null;

	// Create the editor once the container is mounted (browser-only). Content is
	// the note's Markdown body — the Markdown extension parses the string on the
	// way in and serializes back out via storage.markdown.getMarkdown().
	$effect(() => {
		if (!element || editor) return;
		editor = new Editor({
			element,
			extensions: [
				StarterKit,
				Markdown.configure({ html: false, transformPastedText: true, transformCopiedText: true }),
				createAutofill({ kind: 'note', getContext: () => note.body })
			],
			content: note.body || '',
			autofocus: autofocus ? 'end' : false,
			editorProps: { attributes: { class: 'note-prose', 'aria-label': 'Note body' } },
			onUpdate({ editor: ed }) {
				const md =
					(ed.storage as unknown as Record<string, { getMarkdown?: () => string }>).markdown?.getMarkdown?.() ??
					'';
				updateNote(note.id, { body: md });
			}
		});

		return () => {
			editor?.destroy();
			editor = null;
		};
	});
</script>

<div class="note-editor-wrap">
	<div class="transcribe-row" class:compact={compactTools}>
		<TranscribeButton onfinal={insertTranscript} compact={compactTools} />
	</div>
	<div class="note-editor" bind:this={element} data-placeholder={placeholder}></div>
</div>

<style>
	.note-editor-wrap {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.transcribe-row {
		display: flex;
		justify-content: flex-end;
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
		padding-left: 1.2em;
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
