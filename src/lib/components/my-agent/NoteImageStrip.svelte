<script lang="ts">
  import { Button } from '$lib/components/ui';

  import * as m from '$lib/paraglide/messages';
  import {
    removeAttachment,
    setAttachmentSize,
    type AgentNote,
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
          <Button
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
          </Button>
          <Button
            type="button"
            class="thumb-del"
            title={m.noteImageStrip_removeImage()}
            aria-label={m.noteImageStrip_removeImage()}
            onclick={() => removeAttachment(note.id, att.id)}
          >
            <X size={11} />
          </Button>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .img-strip {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .thumbs {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
    gap: var(--space-1);
  }
  .thumb {
    position: relative;
    aspect-ratio: 1;
  }
  :global(.thumb-btn) {
    width: 100%;
    height: 100%;
    padding: 0;
    border: 1px solid color-mix(in srgb, var(--color-foreground) 10%, transparent);
    border-radius: var(--radius-lg);
    overflow: hidden;
    cursor: zoom-in;
    background: color-mix(in srgb, var(--color-foreground) 3%, transparent);
  }
  :global(.thumb-btn) img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  :global(.thumb-del) {
    position: absolute;
    top: -5px;
    right: -5px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 17px;
    height: 17px;
    border-radius: var(--radius-full);
    cursor: pointer;
    color: var(--color-foreground);
    background: color-mix(in srgb, var(--color-bg2) 92%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-foreground) 20%, transparent);
    opacity: 0;
    transition: opacity var(--duration-fast) ease;
  }
  .thumb:hover :global(.thumb-del) {
    opacity: 1;
  }
  :global(.thumb-del):hover {
    color: var(--color-accent);
  }
</style>
