<script lang="ts">
  import { ui } from '$lib/state/ui.svelte';
</script>

{#if ui.shutdownReason}
  <div class="shutdown-banner">
    Gateway shutdown: {ui.shutdownReason}
  </div>
{/if}

<style>
  .shutdown-banner {
    position: fixed; top: 0; left: 0; right: 0; z-index: 200;
    background: rgba(239, 68, 68, 0.95);
    color: #fff; text-align: center;
    padding: 12px 20px; font-size: 14px; font-weight: 600;
  }
</style>
