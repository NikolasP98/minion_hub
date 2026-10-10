<script lang="ts">
  import WorkshopToolbar from '$lib/components/workshop/WorkshopToolbar.svelte';
  import Toaster from '$lib/components/layout/Toaster.svelte';
  import ListPage from '../../../src/routes/(app)/agents/workshop/+page.svelte';
</script>

<div style="display: flex; flex-direction: column; height: 100vh">
  <WorkshopToolbar />
  <div style="flex: 1; min-height: 0; display: flex">
    <ListPage />
  </div>
</div>
<Toaster />
