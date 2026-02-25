<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';
  import Topbar from '$lib/components/Topbar.svelte';
  import WorkshopToolbar from '$lib/components/workshop/WorkshopToolbar.svelte';
  import WorkshopCanvas from '$lib/components/workshop/WorkshopCanvas.svelte';
  import {
    activeSaveId,
    openSave,
    cancelDbSave,
    persistActiveSaveId,
  } from '$lib/state/workshop.svelte';

  const saveId = $derived(page.params.id);

  onMount(async () => {
    if (!saveId) { goto('/workshop'); return; }
    if (activeSaveId !== saveId) {
      try {
        await openSave(saveId);
        persistActiveSaveId(saveId);
      } catch {
        goto('/workshop');
      }
    }
  });

  $effect(() => {
    if (activeSaveId) persistActiveSaveId(activeSaveId);
  });

  onDestroy(() => {
    cancelDbSave();
  });
</script>

<div class="relative z-10 flex flex-col h-screen overflow-hidden">
  <Topbar />
  <WorkshopToolbar />
  <WorkshopCanvas />
</div>
