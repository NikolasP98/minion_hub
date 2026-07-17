<script lang="ts">
  import { goto } from '$lib/navigation';
  import { onMount } from 'svelte';

  import * as m from '$lib/paraglide/messages';
  import { Button, PageHeader } from '$lib/components/ui';
  import { AsyncBoundary, PageBody, PageShell } from '$lib/components/ui/foundations';
  import {
    listWorkspaceSaves,
    createBlankSave,
    openSave,
    deleteWorkspaceSave,
    persistActiveSaveId,
  } from '$lib/state/workshop/workshop.svelte';

  type SaveMeta = {
    id: string;
    name: string;
    updatedAt: number;
    thumbnail: string | null;
    agentCount: number;
    elementCount: number;
  };

  let saves = $state<SaveMeta[]>([]);
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  async function loadSaves() {
    loading = true;
    loadError = null;
    try {
      saves = await listWorkspaceSaves();
    } catch (error) {
      loadError = error instanceof Error ? error.message : m.common_error();
    } finally {
      loading = false;
    }
  }

  onMount(loadSaves);

  async function handleCreateBlank() {
    const name = `Workspace ${new Date().toLocaleDateString()}`;
    const id = await createBlankSave(name);
    goto(`/agents/workshop/${id}`);
  }

  async function handleOpen(id: string) {
    await openSave(id);
    persistActiveSaveId(id);
    goto(`/agents/workshop/${id}`);
  }

  async function handleDelete(e: MouseEvent, id: string) {
    e.stopPropagation();
    await deleteWorkspaceSave(id);
    saves = saves.filter((s) => s.id !== id);
  }

  const pageState = $derived(
    loading
      ? { kind: 'loading' as const }
      : loadError
        ? { kind: 'error' as const, description: loadError, retry: loadSaves }
        : saves.length === 0
          ? { kind: 'empty' as const, title: m.workshop_noSaves() }
          : { kind: 'ready' as const },
  );
</script>

<PageShell archetype="collection" scroll="region" variant="canvas" labelledBy="workshop-list-title">
  <PageHeader title={m.nav_workshop()} titleId="workshop-list-title">
    {#snippet primaryActions()}
      <Button variant="primary" size="sm" onclick={handleCreateBlank}
        >{m.workshop_createBlank()}</Button
      >
    {/snippet}
  </PageHeader>
  <PageBody width="content" scroll="region">
    <AsyncBoundary state={pageState}>
      <div class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
        {#each saves as save (save.id)}
          <div
            role="button"
            tabindex="0"
            onclick={() => handleOpen(save.id)}
            onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && handleOpen(save.id)}
            class="group rounded border border-border bg-bg2 overflow-hidden cursor-pointer hover:border-accent/50 transition-colors"
          >
            <!-- Thumbnail / placeholder -->
            <div class="aspect-video bg-bg3 overflow-hidden">
              {#if save.thumbnail}
                <img src={save.thumbnail} alt="" class="w-full h-full object-cover" />
              {:else}
                <div
                  class="w-full h-full flex items-center justify-center text-muted-strong text-2xl select-none"
                >
                  ⬡
                </div>
              {/if}
            </div>
            <!-- Metadata footer -->
            <div class="p-2.5 flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="font-mono text-xs text-foreground truncate">{save.name}</p>
                <p class="font-mono text-xs text-muted mt-0.5">
                  {m.workshop_agentElementCount({
                    agents: save.agentCount,
                    elements: save.elementCount,
                  })}
                </p>
                <p class="font-mono text-xs text-muted-strong mt-0.5">
                  {new Date(save.updatedAt).toLocaleDateString()}
                </p>
              </div>
              <Button
                variant="danger"
                size="icon"
                onclick={(e) => handleDelete(e, save.id)}
                class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 shrink-0 mt-0.5"
                title={m.common_delete()}
                aria-label={`${m.common_delete()} ${save.name}`}>×</Button
              >
            </div>
          </div>
        {/each}
      </div>
      {#snippet emptyAction()}
        <Button variant="primary" size="sm" onclick={handleCreateBlank}
          >{m.workshop_createBlank()}</Button
        >
      {/snippet}
    </AsyncBoundary>
  </PageBody>
</PageShell>
