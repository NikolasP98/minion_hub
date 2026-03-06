<script lang="ts">
  import { agentToolsState, loadAgentTools, toggleTool } from '$lib/state/agents/agent-tools.svelte';
  import type { ToolStatusEntry } from '$lib/types/tools';
  import * as m from '$lib/paraglide/messages';

  let { agentId }: { agentId: string } = $props();

  $effect(() => {
    loadAgentTools(agentId);
  });

  let enabledTools = $derived(agentToolsState.tools.filter((t) => t.enabled));
  let disabledTools = $derived(agentToolsState.tools.filter((t) => !t.enabled));

  let dragOverZone = $state<'enabled' | 'disabled' | null>(null);
  let draggedToolId = $state<string | null>(null);
  let tooltipOpen = $state(false);

  function onDragStart(e: DragEvent, tool: ToolStatusEntry) {
    draggedToolId = tool.id;
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', JSON.stringify({ toolId: tool.id, enabled: tool.enabled }));
  }

  function onDragOver(e: DragEvent, zone: 'enabled' | 'disabled') {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    dragOverZone = zone;
  }

  function onDragLeave() {
    dragOverZone = null;
  }

  function onDrop(e: DragEvent, targetEnabled: boolean) {
    e.preventDefault();
    dragOverZone = null;
    draggedToolId = null;
    try {
      const data = JSON.parse(e.dataTransfer!.getData('text/plain'));
      if (data.enabled !== targetEnabled) {
        toggleTool(agentId, data.toolId, targetEnabled);
      }
    } catch {}
  }

  function onDragEnd() {
    dragOverZone = null;
    draggedToolId = null;
  }

  function groupLabel(g: string): string {
    return g.replace('group:', '');
  }
</script>

<div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      <h2 class="text-sm font-semibold text-foreground">{m.tools_title()}</h2>
      <!-- Tooltip trigger -->
      <div class="relative">
        <button
          type="button"
          class="w-4 h-4 rounded-full border border-border text-[9px] text-muted-foreground
            hover:border-accent/50 hover:text-foreground transition-colors cursor-help
            flex items-center justify-center"
          onclick={() => (tooltipOpen = !tooltipOpen)}
          onmouseenter={() => (tooltipOpen = true)}
          onmouseleave={() => (tooltipOpen = false)}
        >
          ?
        </button>
        {#if tooltipOpen}
          <div
            class="absolute left-6 top-0 z-50 w-64 rounded-lg border border-border bg-bg2
              shadow-lg px-3 py-2.5 text-[10px] text-muted-foreground leading-relaxed whitespace-pre-line"
          >
            {m.tools_tooltip()}
          </div>
        {/if}
      </div>
    </div>
    <div class="flex items-center gap-2">
      {#if agentToolsState.tools.length > 0}
        <span class="text-[10px] text-muted-foreground">
          {enabledTools.length}/{agentToolsState.tools.length} enabled · profile: {agentToolsState.profile}
        </span>
      {/if}
      <button
        class="text-[10px] px-2.5 py-1 rounded border border-border bg-bg3 text-muted-foreground
          hover:border-accent/50 hover:text-foreground transition-colors"
        disabled={agentToolsState.loading}
        onclick={() => loadAgentTools(agentId)}
      >
        {agentToolsState.loading ? m.tools_loading() : m.tools_refresh()}
      </button>
    </div>
  </div>

  <!-- Description -->
  <p class="text-[10px] text-muted-foreground -mt-1">{m.tools_description()}</p>

  {#if agentToolsState.loading && agentToolsState.tools.length === 0}
    <div class="flex items-center justify-center py-8">
      <div class="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin"></div>
      <span class="ml-2 text-[11px] text-muted-foreground">{m.tools_loading()}</span>
    </div>
  {:else if agentToolsState.error}
    <div class="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-[11px] text-red-400">
      {agentToolsState.error}
    </div>
  {:else if agentToolsState.tools.length === 0}
    <div class="text-[11px] text-muted-foreground py-4">{m.tools_noTools()}</div>
  {:else}
    <!-- Two-column layout -->
    <div class="grid grid-cols-2 gap-3">
      <!-- Enabled zone -->
      <div
        class="rounded-lg border overflow-hidden transition-colors
          {dragOverZone === 'enabled'
          ? 'border-green-400/60 bg-green-500/10'
          : 'border-green-500/20 bg-green-500/5'}"
        role="list"
        ondragover={(e) => onDragOver(e, 'enabled')}
        ondragleave={onDragLeave}
        ondrop={(e) => onDrop(e, true)}
      >
        <div class="px-3 py-2 border-b border-green-500/20 flex items-center justify-between">
          <span class="text-[11px] font-semibold text-green-400 uppercase tracking-wider">
            {m.tools_enabled()}
          </span>
          <span class="text-[10px] text-green-400/70">{enabledTools.length}</span>
        </div>
        <div class="max-h-[500px] overflow-y-auto p-1">
          {#each enabledTools as tool (tool.id)}
            {@render toolItem(tool)}
          {/each}
          {#if enabledTools.length === 0}
            <div class="text-[10px] text-muted-foreground/50 text-center py-4">
              Drop tools here to enable
            </div>
          {/if}
        </div>
      </div>

      <!-- Disabled zone -->
      <div
        class="rounded-lg border overflow-hidden transition-colors
          {dragOverZone === 'disabled'
          ? 'border-muted-foreground/40 bg-bg3'
          : 'border-border bg-bg2'}"
        role="list"
        ondragover={(e) => onDragOver(e, 'disabled')}
        ondragleave={onDragLeave}
        ondrop={(e) => onDrop(e, false)}
      >
        <div class="px-3 py-2 border-b border-border flex items-center justify-between">
          <span class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            {m.tools_disabled()}
          </span>
          <span class="text-[10px] text-muted-foreground/70">{disabledTools.length}</span>
        </div>
        <div class="max-h-[500px] overflow-y-auto p-1 opacity-60">
          {#each disabledTools as tool (tool.id)}
            {@render toolItem(tool)}
          {/each}
          {#if disabledTools.length === 0}
            <div class="text-[10px] text-muted-foreground/50 text-center py-4">
              Drop tools here to disable
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

{#snippet toolItem(tool: ToolStatusEntry)}
  <div
    draggable="true"
    ondragstart={(e) => onDragStart(e, tool)}
    ondragend={onDragEnd}
    class="flex items-start gap-1.5 px-2 py-1.5 rounded-md cursor-grab active:cursor-grabbing
      hover:bg-white/5 transition-colors group
      {draggedToolId === tool.id ? 'opacity-30' : ''}"
    role="listitem"
  >
    <!-- Drag handle -->
    <span class="text-[10px] text-muted-foreground/40 group-hover:text-muted-foreground mt-0.5 shrink-0 select-none">
      ⠿
    </span>

    <!-- Content -->
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-1 flex-wrap">
        <span class="text-[10px] text-foreground font-mono font-medium truncate">{tool.id}</span>
        {#if tool.mcpExport}
          <span class="shrink-0 bg-accent/20 border border-accent/30 rounded-full px-1 text-[8px] text-accent leading-relaxed">
            MCP
          </span>
        {/if}
        {#if tool.multi}
          <span class="shrink-0 bg-bg3 border border-border rounded-full px-1 text-[8px] text-muted-foreground leading-relaxed">
            multi
          </span>
        {/if}
        {#if tool.optional}
          <span class="shrink-0 bg-bg3 border border-border rounded-full px-1 text-[8px] text-muted-foreground leading-relaxed">
            opt
          </span>
        {/if}
      </div>
      {#if tool.groups.length > 0}
        <div class="flex gap-0.5 flex-wrap mt-0.5">
          {#each tool.groups as g (g)}
            <span class="bg-bg3 border border-border rounded-full px-1 text-[8px] text-muted-foreground leading-relaxed">
              {groupLabel(g)}
            </span>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/snippet}
