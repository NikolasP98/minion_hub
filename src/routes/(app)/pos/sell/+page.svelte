<script lang="ts">
  import { page } from '$app/state';
  import type { PageData } from './$types';
  import DataSource from '$lib/components/ui/DataSource.svelte';
  import PageBody from './PageBody.svelte';

  let { data }: { data: PageData } = $props();
</script>

<!-- Till settings ride on the /pos layout's own `pos` slot (spec 039). -->
<DataSource value={data.pos} module="pos">
  {#snippet children(body)}
    <DataSource value={page.data.posSettings} module="pos">
      {#snippet children(posSettings)}
        <PageBody data={body} {posSettings} />
      {/snippet}
    </DataSource>
  {/snippet}
</DataSource>
