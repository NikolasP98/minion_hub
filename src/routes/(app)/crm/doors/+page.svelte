<script lang="ts">
  import type { PageData } from './$types';
  import DataSource from '$lib/components/ui/DataSource.svelte';
  import Body from './PageBody.svelte';

  let { data }: { data: PageData } = $props();
</script>

<DataSource value={data.crm} module="crm">
  {#snippet children(body)}
    <Body data={body} />
  {/snippet}
</DataSource>
