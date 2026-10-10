<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$lib/navigation';
  import { onDestroy, onMount } from 'svelte';

  import WorkshopToolbar from '$lib/components/workshop/WorkshopToolbar.svelte';
  import WorkshopPalette from '$lib/components/workshop/WorkshopPalette.svelte';
  import WorkshopCanvas from '$lib/components/workshop/WorkshopCanvas.svelte';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import { toastError } from '$lib/state/ui/toast.svelte';
  import {
    saveSync,
    openSave,
    flushDbSave,
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
        // A superseded completion (`false`) belongs to another navigation — no-op.
        if (await openSave(saveId)) persistActiveSaveId(saveId);
      } catch {
        toastError(m.workshop_openFailed());
        goto('/agents/workshop');
      }
    }
  });

  $effect(() => {
    if (saveSync.activeSaveId) persistActiveSaveId(saveSync.activeSaveId);
  });

  onDestroy(() => {
    // Persist what is on screen instead of dropping the pending debounce.
    flushDbSave();
  });
</script>

<PageShell archetype="canvas" scroll="none" variant="canvas">
  <WorkshopToolbar />
  <PageBody padding="none" scroll="none" class="flex">
    <WorkshopPalette />
    <WorkshopCanvas />
  </PageBody>
</PageShell>
