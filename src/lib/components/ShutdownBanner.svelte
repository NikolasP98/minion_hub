<script lang="ts">
  import { ui } from '$lib/state/ui.svelte';
  import * as m from '$lib/paraglide/messages';
</script>

{#if ui.shutdownReason}
  <div class="fixed top-0 left-0 right-0 z-200 bg-destructive/95 text-white text-center py-3 px-5 text-sm font-semibold">
    {m.gateway_shutdownPrefix()} {ui.shutdownReason}
  </div>
{/if}
