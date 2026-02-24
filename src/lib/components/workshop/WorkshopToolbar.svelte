<script lang="ts">
  import { gw } from '$lib/state/gateway-data.svelte';
  import WorkshopAgentPill from './WorkshopAgentPill.svelte';
  import * as m from '$lib/paraglide/messages';
  import {
    saveWorkspace,
    listWorkspaceSaves,
    loadWorkspace,
    deleteWorkspaceSave,
  } from '$lib/state/workshop.svelte';

  let saves = $state<Array<{ id: string; name: string; updatedAt: number }>>([]);
  let saveName = $state('');
  let showSaves = $state(false);
  let saving = $state(false);

  async function refreshSaves() {
    saves = await listWorkspaceSaves();
  }

  import type { ElementType } from '$lib/state/workshop.svelte';

  const elementTypes: Array<{ type: ElementType; icon: string; label: string }> = [
    { type: 'pinboard', icon: '\u{1F4CC}', label: 'Pinboard' },
    { type: 'messageboard', icon: '\u{1F4CB}', label: 'Message Board' },
    { type: 'inbox', icon: '\u{1F4EC}', label: 'Inbox' },
    { type: 'rulebook', icon: '\u{1F4D6}', label: 'Rulebook' },
  ];

  function onDragStart(
    e: DragEvent,
    agent: { id: string; name?: string; emoji?: string; description?: string },
  ) {
    e.dataTransfer?.setData('application/workshop-agent', JSON.stringify(agent));
    e.dataTransfer!.effectAllowed = 'copy';
  }

  function onElementDragStart(e: DragEvent, type: ElementType, label: string) {
    e.dataTransfer?.setData('application/workshop-element', JSON.stringify({ type, label }));
    e.dataTransfer!.effectAllowed = 'copy';
  }

  async function handleSave() {
    if (!saveName.trim()) return;
    saving = true;
    try {
      await saveWorkspace(saveName.trim());
      saveName = '';
      await refreshSaves();
    } finally {
      saving = false;
    }
  }

  async function handleLoad(id: string) {
    await loadWorkspace(id);
    showSaves = false;
    window.dispatchEvent(new CustomEvent('workshop:reload'));
  }

  async function handleDelete(id: string) {
    await deleteWorkspaceSave(id);
    await refreshSaves();
  }

  function toggleSaves() {
    showSaves = !showSaves;
    if (showSaves) refreshSaves();
  }

  function handleSaveKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') handleSave();
  }
</script>

<div
  class="h-12 border-b border-border bg-bg2/80 backdrop-blur flex items-center px-3 gap-2 relative z-40"
>
  <!-- Left label -->
  <span class="font-mono text-[10px] uppercase tracking-widest text-muted shrink-0 select-none">
    {m.workshop_title()}
  </span>

  <div class="w-px h-6 bg-border shrink-0"></div>

  <!-- Agent list (scrollable) -->
  <div class="flex-1 overflow-x-auto flex items-center gap-2 min-w-0 scrollbar-thin">
    {#each gw.agents as agent (agent.id)}
      <WorkshopAgentPill {agent} onDragStart={(e) => onDragStart(e, agent)} />
    {:else}
      <span class="text-[10px] font-mono text-muted italic">{m.workshop_noAgents()}</span>
    {/each}
  </div>

  <div class="w-px h-6 bg-border shrink-0"></div>

  <!-- Element buttons -->
  <div class="flex items-center gap-1 shrink-0">
    <span class="font-mono text-[9px] uppercase tracking-widest text-muted/60 mr-0.5 select-none">Elem</span>
    {#each elementTypes as et (et.type)}
      <button
        type="button"
        class="w-8 h-8 rounded border border-border bg-bg3 shrink-0 flex items-center justify-center cursor-grab active:cursor-grabbing hover:border-accent transition-colors text-sm"
        draggable="true"
        ondragstart={(e) => onElementDragStart(e, et.type, et.label)}
        title={et.label}
      >
        {et.icon}
      </button>
    {/each}
  </div>

  <div class="w-px h-6 bg-border shrink-0"></div>

  <!-- Save / Load section -->
  <div class="flex items-center gap-1.5 shrink-0">
    <input
      type="text"
      bind:value={saveName}
      placeholder={m.workshop_saveName()}
      onkeydown={handleSaveKeydown}
      class="h-7 w-28 px-2 text-[10px] font-mono bg-bg3 border border-border rounded text-foreground placeholder:text-muted/50 focus:outline-none focus:border-accent"
    />
    <button
      type="button"
      onclick={handleSave}
      disabled={saving || !saveName.trim()}
      class="h-7 px-2.5 text-[10px] font-mono uppercase tracking-wider rounded border border-border bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {saving ? '...' : m.workshop_save()}
    </button>

    <div class="relative">
      <button
        type="button"
        onclick={toggleSaves}
        class="h-7 px-2.5 text-[10px] font-mono uppercase tracking-wider rounded border transition-colors {showSaves
          ? 'border-accent bg-accent/10 text-accent'
          : 'border-border text-muted hover:bg-bg3 hover:text-foreground'}"
      >
        {m.workshop_load()}
      </button>

      {#if showSaves}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          class="absolute right-0 top-full mt-1 w-56 max-h-60 overflow-y-auto rounded border border-border bg-bg2/95 backdrop-blur shadow-lg z-50"
          onclick={(e) => e.stopPropagation()}
        >
          {#if saves.length === 0}
            <div class="px-3 py-2 text-[10px] font-mono text-muted italic">{m.workshop_noSaves()}</div>
          {:else}
            {#each saves as save (save.id)}
              <div
                class="flex items-center gap-1 px-2 py-1.5 hover:bg-bg3 transition-colors group"
              >
                <button
                  type="button"
                  onclick={() => handleLoad(save.id)}
                  class="flex-1 text-left text-[10px] font-mono text-foreground truncate hover:text-accent transition-colors"
                >
                  {save.name}
                </button>
                <button
                  type="button"
                  onclick={() => handleDelete(save.id)}
                  class="text-[10px] text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                  title="Delete save"
                >
                  x
                </button>
              </div>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>
