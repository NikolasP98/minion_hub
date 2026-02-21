<script lang="ts">
  import Topbar from '$lib/components/Topbar.svelte';
  import WorkshopToolbar from '$lib/components/workshop/WorkshopToolbar.svelte';
  import WorkshopCanvas from '$lib/components/workshop/WorkshopCanvas.svelte';
</script>

<div class="relative z-10 flex flex-col h-screen overflow-hidden">
  <Topbar />
  <WorkshopToolbar />
  <WorkshopCanvas />
</div>
