<script lang="ts">
  import { Button } from '@minion-stack/ui';
  import PageHeader from './PageHeader.svelte';
  let { primaries = 1 }: { primaries?: number } = $props();
</script>

<PageHeader title="Pilot">
  {#snippet primaryActions()}
    {#each { length: primaries } as _, i (i)}
      <Button>Primary {i + 1}</Button>
    {/each}
  {/snippet}
  {#snippet secondaryActions()}
    <Button variant="ghost">Export</Button>
  {/snippet}
</PageHeader>
