<script lang="ts">
  import Popover from './Popover.svelte';

  let { viewportContained = false }: { viewportContained?: boolean } = $props();
</script>

<Popover {viewportContained}>
  {#snippet trigger()}Open panel{/snippet}
  {#snippet children()}<div data-testid="panel-body">Panel body</div>{/snippet}
</Popover>
