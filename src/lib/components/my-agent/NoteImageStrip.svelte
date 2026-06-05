<script lang="ts">
	import {
		uploadNoteImage,
		fetchImageFromUrl,
		addAttachment,
		removeAttachment,
		setAttachmentSize,
		type AgentNote
	} from '$lib/state/features/agent-notes.svelte';
	import { ImagePlus, Link2, X, Loader2 } from 'lucide-svelte';

	let { note, onopen }: { note: AgentNote; onopen: (src: string) => void } = $props();

	let fileInput = $state<HTMLInputElement | null>(null);
	let urlOpen = $state(false);
	let urlValue = $state('');
	let busy = $state(false);
	let err = $state('');

	function rawSrc(fileId: string): string {
		return `/api/files/${fileId}/raw`;
	}

	async function ingestFiles(files: FileList | null | undefined) {
		if (!files || files.length === 0) return;
		err = '';
		busy = true;
		try {
			for (const file of Array.from(files)) {
				if (!file.type.startsWith('image/')) continue;
				const fileId = await uploadNoteImage(file);
				addAttachment(note.id, fileId);
			}
		} catch {
			err = 'Upload failed.';
		} finally {
			busy = false;
		}
	}

	async function submitUrl() {
		const url = urlValue.trim();
		if (!url) return;
		err = '';
		busy = true;
		try {
			const fileId = await fetchImageFromUrl(url);
			addAttachment(note.id, fileId);
			urlValue = '';
			urlOpen = false;
		} catch (e) {
			err = e instanceof Error && e.message ? e.message : 'Could not fetch that image.';
		} finally {
			busy = false;
		}
	}

	function onImgLoad(e: Event, attId: string) {
		const img = e.currentTarget as HTMLImageElement;
		if (img.naturalWidth) setAttachmentSize(note.id, attId, img.naturalWidth, img.naturalHeight);
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		void ingestFiles(e.dataTransfer?.files);
	}

	let dragOver = $state(false);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="img-strip"
	class:drag={dragOver}
	ondragover={(e) => {
		e.preventDefault();
		dragOver = true;
	}}
	ondragleave={() => (dragOver = false)}
	ondrop={onDrop}
>
	{#if note.attachments.length > 0}
		<div class="thumbs">
			{#each note.attachments as att (att.id)}
				<div class="thumb">
					<button
						type="button"
						class="thumb-btn"
						title="View image"
						aria-label="View image"
						onclick={() => onopen(rawSrc(att.fileId))}
					>
						<img
							src={rawSrc(att.fileId)}
							alt=""
							loading="lazy"
							onload={(e) => onImgLoad(e, att.id)}
						/>
					</button>
					<button
						type="button"
						class="thumb-del"
						title="Remove image"
						aria-label="Remove image"
						onclick={() => removeAttachment(note.id, att.id)}
					>
						<X size={11} />
					</button>
				</div>
			{/each}
		</div>
	{/if}

	{#if urlOpen}
		<form
			class="url-row"
			onsubmit={(e) => {
				e.preventDefault();
				void submitUrl();
			}}
		>
			<input
				type="url"
				placeholder="Paste image URL…"
				bind:value={urlValue}
				aria-label="Image URL"
				{@attach (el) => el.focus()}
			/>
			<button type="submit" disabled={busy}>Add</button>
			<button
				type="button"
				class="ghost"
				onclick={() => {
					urlOpen = false;
					urlValue = '';
					err = '';
				}}>Cancel</button
			>
		</form>
	{/if}

	{#if err}
		<p class="err">{err}</p>
	{/if}

	<div class="add-row">
		<button
			type="button"
			class="img-add"
			title="Add image"
			disabled={busy}
			onclick={() => fileInput?.click()}
		>
			{#if busy}<Loader2 size={12} class="spin" />{:else}<ImagePlus size={12} />{/if}
			Image
		</button>
		<button
			type="button"
			class="img-add"
			title="Add image from URL"
			onclick={() => (urlOpen = !urlOpen)}
		>
			<Link2 size={12} /> URL
		</button>
	</div>

	<input
		bind:this={fileInput}
		type="file"
		accept="image/*"
		multiple
		class="hidden-file"
		onchange={(e) => {
			void ingestFiles(e.currentTarget.files);
			e.currentTarget.value = '';
		}}
	/>
</div>

<style>
	.img-strip {
		display: flex;
		flex-direction: column;
		gap: 6px;
		border-radius: 8px;
		transition: box-shadow 120ms ease;
	}
	.img-strip.drag {
		box-shadow: inset 0 0 0 2px rgba(232, 125, 106, 0.5);
	}
	.thumbs {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
		gap: 6px;
	}
	.thumb {
		position: relative;
		aspect-ratio: 1;
	}
	.thumb-btn {
		width: 100%;
		height: 100%;
		padding: 0;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 7px;
		overflow: hidden;
		cursor: zoom-in;
		background: rgba(255, 255, 255, 0.03);
	}
	.thumb-btn img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.thumb-del {
		position: absolute;
		top: -5px;
		right: -5px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 17px;
		height: 17px;
		border-radius: 50%;
		cursor: pointer;
		color: #fff;
		background: rgba(20, 20, 20, 0.92);
		border: 1px solid rgba(255, 255, 255, 0.2);
		opacity: 0;
		transition: opacity 120ms ease;
	}
	.thumb:hover .thumb-del {
		opacity: 1;
	}
	.thumb-del:hover {
		color: #e87d6a;
	}
	.add-row {
		display: flex;
		gap: 6px;
	}
	.img-add {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 7px;
		font-size: 11px;
		border-radius: 6px;
		cursor: pointer;
		color: rgba(255, 255, 255, 0.5);
		background: transparent;
		border: 1px solid rgba(255, 255, 255, 0.08);
		transition: color 120ms ease, border-color 120ms ease;
	}
	.img-add:hover:not(:disabled) {
		color: rgba(255, 255, 255, 0.85);
		border-color: rgba(232, 125, 106, 0.35);
	}
	.img-add:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.url-row {
		display: flex;
		gap: 5px;
		align-items: center;
	}
	.url-row input {
		flex: 1;
		min-width: 0;
		padding: 5px 8px;
		font-size: 11.5px;
		border-radius: 6px;
		color: rgba(255, 255, 255, 0.9);
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.1);
		outline: none;
		font-family: inherit;
	}
	.url-row button {
		padding: 5px 8px;
		font-size: 11px;
		border-radius: 6px;
		cursor: pointer;
		color: rgba(255, 255, 255, 0.85);
		background: rgba(232, 125, 106, 0.18);
		border: 1px solid rgba(232, 125, 106, 0.35);
	}
	.url-row button.ghost {
		background: transparent;
		border-color: rgba(255, 255, 255, 0.1);
		color: rgba(255, 255, 255, 0.5);
	}
	.err {
		margin: 0;
		font-size: 11px;
		color: #e87d6a;
	}
	.hidden-file {
		display: none;
	}
	:global(.img-add .spin) {
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
