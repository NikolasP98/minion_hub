<script lang="ts">
  import Popover from './Popover.svelte';
  import Tooltip from './Tooltip.svelte';

  // Driven from inside the fixture so a test can open and close the panel
  // without depending on Zag's dismissal paths (which need real pointer
  // sequences happy-dom does not synthesise).
  let open = $state(false);
</script>

<button type="button" data-testid="toggle" onclick={() => (open = !open)}>toggle</button>

<!-- The `ShiftBanner` shape: a Tooltip wrapping a Popover trigger. -->
<Tooltip label="Otras cajas abiertas" openDelay={0} closeDelay={0}>
  <Popover bind:open>
    {#snippet trigger()}Open panel{/snippet}
    {#snippet children()}
      <Tooltip label="Inside the panel" openDelay={0} closeDelay={0}>
        <span data-testid="inner-trigger">?</span>
      </Tooltip>
    {/snippet}
  </Popover>
</Tooltip>
