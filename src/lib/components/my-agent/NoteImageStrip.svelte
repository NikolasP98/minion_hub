<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import {
		removeAttachment,
		setAttachmentSize,
		type AgentNote
	} from '$lib/state/features/agent-notes.svelte';
	import { X } from 'lucide-svelte';

	// View-only strip for a note/todo's legacy image attachments. New images are
	// added by pasting/dropping straight into the note body (inline), so there are
	// no add buttons here anymore — this just renders + lets you remove existing
	// attachments.
	let { note, onopen }: { note: AgentNote; onopen: (src: string) => void } = $props();

	function rawSrc(fileId: string): string {
		return `/api/files/${fileId}/raw`;
	}

	function onImgLoad(e: Event, attId: string) {
		const img = e.currentTarget as HTMLImageElement;
		if (img.naturalWidth) setAttachmentSize(note.id, attId, img.naturalWidth, img.naturalHeight);
	}
</script>

{#if note.attachments.length > 0}
	<div class="img-strip">
		<div class="thumbs">
			{#each note.attachments as att (att.id)}
				<div class="thumb">
					<button
						type="button"
						class="thumb-btn"
						title={m.noteImageStrip_viewImage()}
						aria-label={m.noteImageStrip_viewImage()}
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
						title={m.noteImageStrip_removeImage()}
						aria-label={m.noteImageStrip_removeImage()}
						onclick={() => removeAttachment(note.id, att.id)}
					>
						<X size={11} />
					</button>
				</div>
			{/each}
		</div>
	</div>
{/if}

<style>
	.img-strip {
		display: flex;
		flex-direction: column;
		gap: 6px;
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
		color: var(--color-accent);
	}
</style>
