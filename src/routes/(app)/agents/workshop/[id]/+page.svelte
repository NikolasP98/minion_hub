<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$lib/navigation';
  import { onDestroy, onMount } from 'svelte';

  import WorkshopToolbar from '$lib/components/workshop/WorkshopToolbar.svelte';
  import WorkshopPalette from '$lib/components/workshop/WorkshopPalette.svelte';
  import WorkshopCanvas from '$lib/components/workshop/WorkshopCanvas.svelte';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import {
    saveSync,
    openSave,
    cancelDbSave,
    persistActiveSaveId,
  } from '$lib/state/workshop/workshop.svelte';

  const saveId = $derived(page.params.id);

  onMount(async () => {
    if (!saveId) {
      goto('/agents/workshop');
      return;
    }
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

<PageShell archetype="canvas" scroll="none" variant="canvas">
  <WorkshopToolbar />
  <PageBody padding="none" scroll="none" class="flex">
    <WorkshopPalette />
    <WorkshopCanvas />
  </PageBody>
</PageShell>
