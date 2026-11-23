<script lang="ts">
  import { Plus } from 'lucide-svelte';
  import { Button, iconSizes } from '$lib/components/ui';
  import { reserveCorner } from '$lib/state/ui/corner-reserve.svelte';

  let { onclick, label }: { onclick: () => void; label: string } = $props();

  // Button (56 px) plus 12 px of clearance; the assistant launcher sits above this much.
  $effect(() => reserveCorner(56 + 12));
</script>

<Button class="cal-add" variant="primary" shape="icon" aria-label={label} {onclick}>
  <Plus size={iconSizes.lg} />
</Button>

<style>
  /* Forwarded class on the shared Button ⇒ :global (the primitive's own
     scoped rules would otherwise outrank this one). */
  :global(.cal-add) {
    position: fixed;
    right: max(var(--space-4), env(safe-area-inset-right));
    bottom: max(var(--space-4), env(safe-area-inset-bottom));
    z-index: var(--layer-sticky);
    /* 56 px: the touch height plus one step. */
    width: calc(var(--control-height-touch) + var(--space-3));
    height: calc(var(--control-height-touch) + var(--space-3));
    border-radius: var(--radius-full);
  }
</style>
