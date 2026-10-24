<script lang="ts">
  import type { PageData as LoadedPageData } from './$types';
  import { isDenied, type Granted } from '$lib/permissions';
  import DataSource from '$lib/components/ui/DataSource.svelte';
  import SellableEditorPage from '$lib/components/pos/SellableEditorPage.svelte';

  type PageData = Granted<LoadedPageData['pos']>;
  let { data }: { data: PageData } = $props();
</script>

<!-- Stock is its own dataset: without view access the ingredient picker stays empty. -->
<DataSource value={data.stockItems} module="stock" compact
  >{#snippet children()}{/snippet}</DataSource
>

<SellableEditorPage
  inheritedTags={data.inheritedTags}
  stockEnabled={data.stockEnabled}
  stockItems={isDenied(data.stockItems) ? [] : data.stockItems}
  consumption={isDenied(data.consumption) ? [] : data.consumption}
  categories={data.categories}
  takenCodes={data.takenCodes}
  tags={data.tags}
  editing={data.editing}
/>
