<script lang="ts">
  import type { Snippet } from 'svelte';
  import { FileSpreadsheet, FileText, Image, Music, Paperclip, Video } from 'lucide-svelte';
  import { Button, iconSizes } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { formatBytes } from '$lib/utils/format';
  import type { AttachmentPreviewMode } from '$lib/attachments/preview-mode.svelte';

  /**
   * ONE attachment, rendered the same way everywhere (uploaded files, files
   * staged before their record exists, trashed files): a type tile, the name,
   * a meta line, and the caller's actions. `preview` decides the shape — see
   * preview-mode.svelte.ts. Image thumbnails are resolved lazily through
   * `thumb` (a presigned URL for uploaded files, an object URL for staged
   * ones) so a plain list never pays for a presign.
   */
  interface Props {
    name: string;
    contentType: string;
    sizeBytes: number;
    /** Trailing meta text (uploaded ago, deleted ago, "pending"…). */
    meta?: string;
    preview?: AttachmentPreviewMode;
    /** Resolves an image URL for `image/*` files. Called at most once. */
    thumb?: () => Promise<string> | string;
    /** Click on the name/thumbnail. */
    onopen?: () => void;
    /** Greyed row (trash). */
    muted?: boolean;
    actions?: Snippet;
    /** Extra inline content after the meta (e.g. "also linked" chips). */
    children?: Snippet;
  }

  let {
    name,
    contentType,
    sizeBytes,
    meta,
    preview = 'hover',
    thumb,
    onopen,
    muted = false,
    actions,
    children,
  }: Props = $props();

  const isImage = $derived(contentType.startsWith('image/'));
  const Icon = $derived.by(() => {
    if (isImage) return Image;
    if (contentType.startsWith('audio/')) return Music;
    if (contentType.startsWith('video/')) return Video;
    if (contentType.includes('sheet') || contentType.includes('excel')) return FileSpreadsheet;
    if (contentType === 'application/pdf' || contentType.includes('word')) return FileText;
    return Paperclip;
  });
  const ext = $derived(
    (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '').toUpperCase().slice(0, 5),
  );

  let src = $state<string | null>(null);
  let requested = false;
  async function loadThumb() {
    if (requested || !thumb || !isImage) return;
    requested = true;
    try {
      src = await thumb();
    } catch {
      src = null;
    }
  }
  // Cards show the thumbnail up front; hover rows wait for intent.
  $effect(() => {
    if (preview === 'card') void loadThumb();
  });
</script>

<div
  class="tile {preview}"
  class:muted
  class:is-image={isImage}
  onmouseenter={preview === 'hover' ? loadThumb : undefined}
  onfocusin={preview === 'hover' ? loadThumb : undefined}
  role="group"
  aria-label={name}
>
  <Button variant="ghost" size="icon" class="att-thumb" onclick={onopen} disabled={!onopen}>
    {#if preview !== 'off' && src}
      <img {src} alt={m.attachments_preview_of({ file: name })} loading="lazy" />
    {:else}
      <Icon size={preview === 'card' ? iconSizes.lg : iconSizes.sm} aria-hidden="true" />
      {#if preview === 'card' && ext}<span class="t-caption ext">{ext}</span>{/if}
    {/if}
  </Button>

  <div class="body">
    <Button variant="ghost" size="xs" class="att-name" onclick={onopen} disabled={!onopen}>
      {name}
    </Button>
    <div class="meta t-caption">
      <span>{formatBytes(sizeBytes)}</span>
      {#if meta}<span aria-hidden="true">·</span><span>{meta}</span>{/if}
      {#if children}{@render children()}{/if}
    </div>
  </div>

  {#if actions}<div class="actions">{@render actions()}</div>{/if}

  {#if preview === 'hover' && src}
    <div class="peek" aria-hidden="true">
      <img {src} alt="" />
    </div>
  {/if}
</div>

<style>
  .tile {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-1) 0;
    border-bottom: 1px solid var(--hairline);
  }
  .tile.muted {
    color: var(--color-text-tertiary);
  }
  /* Forwarded class on the Button primitive → :global, and its inner row
     <span> needs its own rule (Button slot trap, see governance). */
  .tile :global(.att-thumb) {
    flex-shrink: 0;
    width: var(--control-height-md);
    height: var(--control-height-md);
    padding: 0;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    overflow: hidden;
  }
  .tile :global(.att-thumb:disabled) {
    opacity: 1;
    cursor: default;
  }
  .tile :global(.att-thumb > span) {
    width: 100%;
    height: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: var(--space-1);
  }
  .tile :global(.att-thumb img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
    flex: 1;
  }
  /* Forwarded class → must be :global (see governance forwarded-class rule). */
  .tile :global(.att-name) {
    justify-content: flex-start;
    max-width: 100%;
    height: auto;
    min-height: 0;
    padding: 0;
    color: var(--color-text-primary);
    font-weight: 500;
  }
  .tile :global(.att-name > span) {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* A staged file has nothing to open yet — that is not a disabled state. */
  .tile :global(.att-name:disabled) {
    opacity: 1;
    cursor: default;
  }
  .tile :global(.att-name:hover:not(:disabled)) {
    color: var(--color-accent);
    background: transparent;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-wrap: wrap;
    color: var(--color-text-secondary);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-inline-start: auto;
    flex-shrink: 0;
  }

  /* hover: floating preview above the tile for images, revealed on intent */
  .peek {
    position: absolute;
    left: 0;
    bottom: calc(100% + var(--space-1));
    z-index: var(--layer-popover);
    padding: var(--space-1);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    background: var(--color-overlay);
    box-shadow: var(--shadow-overlay);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-fast) var(--ease-standard);
  }
  .tile.hover:hover .peek,
  .tile.hover:focus-within .peek {
    opacity: 1;
  }
  .peek img {
    display: block;
    max-width: 18rem;
    max-height: 12rem;
    border-radius: var(--radius-sm);
  }

  /* card: thumbnail on top, text below, actions in a footer row */
  .tile.card {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2);
    padding: var(--space-2);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
  }
  .tile.card :global(.att-thumb) {
    width: 100%;
    height: auto;
    aspect-ratio: 4 / 3;
    border-radius: var(--radius-md);
  }
  .tile.card .ext {
    color: var(--color-text-tertiary);
    letter-spacing: 0.04em;
  }
  .tile.card .actions {
    margin-inline-start: 0;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
</style>
