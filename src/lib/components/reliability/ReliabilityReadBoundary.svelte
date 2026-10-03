<script lang="ts">
  import { AsyncBoundary, type AsyncBoundaryState } from '$lib/components/ui/foundations';

  let { state, compact = false }: { state: AsyncBoundaryState; compact?: boolean } = $props();
</script>

<div class="reliability-read-boundary">
  <AsyncBoundary {state} {compact} />
</div>

<style>
  .reliability-read-boundary {
    min-width: 0;
  }

  @media (max-width: 767.98px), (pointer: coarse) {
    .reliability-read-boundary :global(button) {
      min-width: var(--control-height-touch);
      min-height: var(--control-height-touch);
    }
  }
</style>
