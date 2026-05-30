<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';

  import WorkshopToolbar from '$lib/components/workshop/WorkshopToolbar.svelte';
  import WorkshopPalette from '$lib/components/workshop/WorkshopPalette.svelte';
  import WorkshopCanvas from '$lib/components/workshop/WorkshopCanvas.svelte';
  import {
    saveSync,
    openSave,
    cancelDbSave,
    persistActiveSaveId,
  } from '$lib/state/workshop/workshop.svelte';

  const saveId = $derived(page.params.id);

  onMount(async () => {
    if (!saveId) { goto('/agents/workshop'); return; }
    if (saveSync.activeSaveId !== saveId) {
      try {
        await openSave(saveId);
        persistActiveSaveId(saveId);
      } catch {
        goto('/agents/workshop');
      }
    }
  });

  $effect(() => {
    if (saveSync.activeSaveId) persistActiveSaveId(saveSync.activeSaveId);
  });

  onDestroy(() => {
    cancelDbSave();
  });
</script>

<WorkshopToolbar />
<div class="flex-1 flex min-h-0">
  <WorkshopPalette />
  <WorkshopCanvas />
</div>
