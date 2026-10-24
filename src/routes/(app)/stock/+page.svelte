<script lang="ts">
  import type { PageData } from './$types';
  import DataSource from '$lib/components/ui/DataSource.svelte';
  import PageBody from './PageBody.svelte';

  let { data }: { data: PageData } = $props();
</script>

<DataSource value={data.stock} module="stock">
  {#snippet children(body)}
    <PageBody data={body} />
  {/snippet}
</DataSource>
