<script lang="ts">
  import type { PageData } from './$types';
  import SellableEditorPage from '$lib/components/pos/SellableEditorPage.svelte';

  let { data }: { data: PageData } = $props();
</script>

<SellableEditorPage
  stockEnabled={data.stockEnabled}
  stockItems={data.stockItems}
  consumption={data.consumption}
  categories={data.categories}
  takenCodes={data.takenCodes}
  editing={data.editing}
/>
