<script lang="ts">
  import type { PageData as LoadedPageData } from './$types';
  import type { Granted } from '$lib/permissions';
  import SellableEditorPage from '$lib/components/pos/SellableEditorPage.svelte';

  type PageData = Granted<LoadedPageData['pos']>;
  let { data }: { data: PageData } = $props();
</script>

<SellableEditorPage
  stockEnabled={data.stockEnabled}
  stockItems={data.stockItems}
  consumption={data.consumption}
  categories={data.categories}
  takenCodes={data.takenCodes}
  tags={data.tags}
/>
