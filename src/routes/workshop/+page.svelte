<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import Topbar from '$lib/components/Topbar.svelte';
  import {
    listWorkspaceSaves,
    createBlankSave,
    openSave,
    deleteWorkspaceSave,
    persistActiveSaveId,
  } from '$lib/state/workshop.svelte';

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

  onMount(async () => {
    saves = await listWorkspaceSaves();
    loading = false;
  });

  async function handleCreateBlank() {
    const name = `Workspace ${new Date().toLocaleDateString()}`;
    const id = await createBlankSave(name);
    goto(`/workshop/${id}`);
  }

  async function handleOpen(id: string) {
    await openSave(id);
    persistActiveSaveId(id);
    goto(`/workshop/${id}`);
  }

  async function handleDelete(e: MouseEvent, id: string) {
    e.stopPropagation();
    await deleteWorkspaceSave(id);
    saves = saves.filter((s) => s.id !== id);
  }
</script>

<div class="flex flex-col h-screen bg-bg overflow-hidden">
  <Topbar />
  <div class="flex-1 overflow-y-auto p-6">
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <h1 class="font-mono text-sm uppercase tracking-widest text-muted">Workshop</h1>
      <button
        onclick={handleCreateBlank}
        class="h-7 px-3 text-[10px] font-mono uppercase tracking-wider rounded border border-border text-muted hover:bg-bg3 hover:text-foreground transition-colors"
      >
        + Create Blank
      </button>
    </div>

    <!-- Card grid -->
    {#if loading}
      <p class="text-muted text-xs font-mono">Loading…</p>
    {:else if saves.length === 0}
      <p class="text-muted text-xs font-mono italic">No saved workspaces yet.</p>
    {:else}
      <div class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
        {#each saves as save (save.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            onclick={() => handleOpen(save.id)}
            class="group rounded border border-border bg-bg2 overflow-hidden cursor-pointer hover:border-accent/50 transition-colors"
          >
            <!-- Thumbnail / placeholder -->
            <div class="aspect-video bg-bg3 overflow-hidden">
              {#if save.thumbnail}
                <img src={save.thumbnail} alt="" class="w-full h-full object-cover" />
              {:else}
                <div class="w-full h-full flex items-center justify-center text-muted/30 text-2xl select-none">
                  ⬡
                </div>
              {/if}
            </div>
            <!-- Metadata footer -->
            <div class="p-2.5 flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="font-mono text-xs text-foreground truncate">{save.name}</p>
                <p class="font-mono text-[10px] text-muted mt-0.5">
                  {save.agentCount} agents · {save.elementCount} elements
                </p>
                <p class="font-mono text-[9px] text-muted/60 mt-0.5">
                  {new Date(save.updatedAt).toLocaleDateString()}
                </p>
              </div>
              <button
                onclick={(e) => handleDelete(e, save.id)}
                class="opacity-0 group-hover:opacity-100 text-muted hover:text-red-400 text-xs transition-all shrink-0 mt-0.5"
                title="Delete"
              >×</button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
