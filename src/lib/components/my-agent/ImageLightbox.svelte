<script lang="ts">
  import { Button } from '$lib/components/ui';

  import * as m from '$lib/paraglide/messages';
  import { X } from 'lucide-svelte';

  let { src, onclose }: { src: string | null; onclose: () => void } = $props();

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if src}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="lightbox"
    onclick={onclose}
    role="dialog"
    aria-modal="true"
    aria-label={m.imageLightbox_preview()}
    tabindex="-1"
  >
    <Button
      type="button"
      class="close"
      title={m.common_close()}
      aria-label={m.common_close()}
      onclick={onclose}
    >
      <X size={20} />
    </Button>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
    <img {src} alt="" onclick={(e) => e.stopPropagation()} />
  </div>
{/if}

<style>
  .lightbox {
    position: fixed;
    inset: 0;
    z-index: var(--layer-debug);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-8);
    background: color-mix(in srgb, var(--color-bg) 82%, transparent);
    backdrop-filter: blur(6px);
    cursor: zoom-out;
  }
  .lightbox img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-elevation-2);
    cursor: default;
  }
  :global(.close) {
    position: absolute;
    top: 18px;
    right: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-2);
    border-radius: var(--radius-xl);
    cursor: pointer;
    color: color-mix(in srgb, var(--color-foreground) 85%, transparent);
    background: color-mix(in srgb, var(--color-foreground) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-foreground) 14%, transparent);
    transition: background var(--duration-fast) ease;
  }
  :global(.close):hover {
    background: color-mix(in srgb, var(--color-foreground) 16%, transparent);
  }
</style>
