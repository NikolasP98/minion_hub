<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import Dialog from '$lib/components/ui/foundations/Dialog.svelte';

  let {
    src,
    alt = '',
    onclose,
  }: { src: string | null; alt?: string; onclose: () => void } = $props();
</script>

{#if src}
  <Dialog open title={m.imageLightbox_preview()} size="xl" {onclose}>
    <img class="preview" {src} {alt} />
  </Dialog>
{/if}

<style>
  .preview {
    display: block;
    max-width: 100%;
    max-height: calc(100dvh - var(--space-12) - var(--space-12));
    margin-inline: auto;
    object-fit: contain;
    border-radius: var(--radius-lg);
  }
</style>
