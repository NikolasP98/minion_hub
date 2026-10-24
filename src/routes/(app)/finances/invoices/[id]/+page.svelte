<script lang="ts">
  import type { PageData } from './$types';
  import DataSource from '$lib/components/ui/DataSource.svelte';
  import PageBody from './PageBody.svelte';

  let { data }: { data: PageData } = $props();
</script>

<DataSource value={data.finance} module="finance">
  {#snippet children(body)}
    <PageBody data={body} />
  {/snippet}
</DataSource>
