<script lang="ts">
  /**
   * Left-edge palette dock: the things you place on the canvas (agents +
   * elements), moved out of the cramped top bar (UX-council 4/5 consensus —
   * Figma Assets / Unity Hierarchy pattern). Collapses to an icon rail.
   *
   * Drag payloads are unchanged ("application/workshop-agent" /
   * "application/workshop-element"), so WorkshopCanvas.handleDrop still works.
   */
  import { onMount } from 'svelte';
  import { gw } from '$lib/state/gateway/gateway-data.svelte';
  import { workshopState } from '$lib/state/workshop/workshop.svelte';
  import WorkshopAgentPill from './WorkshopAgentPill.svelte';
  import PanelLeftClose from 'lucide-svelte/icons/panel-left-close';
  import PanelLeftOpen from 'lucide-svelte/icons/panel-left-open';
  import * as m from '$lib/paraglide/messages';
  import type { ElementType } from '$lib/state/workshop/workshop.svelte';
  import { Button } from '$lib/components/ui';

  const COLLAPSE_KEY = 'workshop:paletteCollapsed';
  let collapsed = $state(false);
  onMount(() => {
    try {
      collapsed = localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      /* ignore */
    }
  });
  function toggle() {
    collapsed = !collapsed;
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  const elementTypes = $derived([
    { type: 'pinboard' as ElementType, icon: '\u{1F4CC}', label: m.workshop_pinboard() },
    { type: 'messageboard' as ElementType, icon: '\u{1F4CB}', label: m.workshop_messageboard() },
    { type: 'inbox' as ElementType, icon: '\u{1F4EC}', label: m.workshop_inbox() },
    { type: 'rulebook' as ElementType, icon: '\u{1F4D6}', label: m.workshop_rulebook() },
    { type: 'portal' as ElementType, icon: '\u{1F300}', label: m.workshop_portal() },
  ]);

  const instanceCounts = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const inst of Object.values(workshopState.agents)) {
      counts[inst.agentId] = (counts[inst.agentId] ?? 0) + 1;
    }
    return counts;
  });

  const onCanvasAgents = $derived(gw.agents.filter((a) => (instanceCounts[a.id] ?? 0) > 0));
  const availableAgents = $derived(gw.agents.filter((a) => (instanceCounts[a.id] ?? 0) === 0));

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
</script>

<aside
  class="shrink-0 h-full flex flex-col border-r border-border bg-bg2/70 backdrop-blur transition-[width] duration-[var(--duration-fast)] {collapsed
    ? 'w-12'
    : 'w-48'}"
>
  <!-- Header / collapse toggle -->
  <div
    class="h-9 shrink-0 flex items-center {collapsed
      ? 'justify-center'
      : 'justify-between px-2'} border-b border-border"
  >
    {#if !collapsed}
      <span class="font-mono text-xs uppercase tracking-widest text-muted select-none"
        >{m.workshop_paletteAgents()}</span
      >
    {/if}
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onclick={toggle}
      class="w-7 h-7 flex items-center justify-center rounded text-muted hover:text-foreground hover:bg-bg3 transition-colors"
      aria-label={m.workshop_paletteToggle()}
      title={m.workshop_paletteToggle()}
    >
      {#if collapsed}
        <PanelLeftOpen size={15} />
      {:else}
        <PanelLeftClose size={15} />
      {/if}
    </Button>
  </div>

  <div class="flex-1 overflow-y-auto overflow-x-hidden p-2 flex flex-col gap-2">
    <!-- Agents -->
    {#if gw.agents.length === 0}
      {#if !collapsed}
        <span class="text-xs font-mono text-muted italic">{m.workshop_noAgents()}</span>
      {/if}
    {:else}
      <div class="flex flex-wrap gap-1.5 {collapsed ? 'justify-center' : ''}">
        {#each onCanvasAgents as agent (agent.id)}
          <WorkshopAgentPill
            {agent}
            count={instanceCounts[agent.id]}
            onDragStart={(e) => onDragStart(e, agent)}
          />
        {/each}
      </div>
      {#if onCanvasAgents.length > 0 && availableAgents.length > 0}
        <div class="h-px bg-border/50 my-0.5"></div>
      {/if}
      <div class="flex flex-wrap gap-1.5 {collapsed ? 'justify-center' : ''}">
        {#each availableAgents as agent (agent.id)}
          <WorkshopAgentPill {agent} onDragStart={(e) => onDragStart(e, agent)} />
        {/each}
      </div>
    {/if}

    <!-- Elements -->
    <div class="mt-1 pt-2 border-t border-border/50">
      {#if !collapsed}
        <span class="font-mono text-xs uppercase tracking-widest text-muted-strong select-none"
          >{m.workshop_elemLabel()}</span
        >
      {/if}
      <div class="mt-1.5 flex flex-wrap gap-1.5 {collapsed ? 'justify-center' : ''}">
        {#each elementTypes as et (et.type)}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            class="w-8 h-8 rounded border border-border bg-bg3 shrink-0 flex items-center justify-center cursor-grab active:cursor-grabbing hover:border-accent transition-colors text-sm"
            draggable="true"
            ondragstart={(e: DragEvent) => onElementDragStart(e, et.type, et.label)}
            title={et.label}
          >
            {et.icon}
          </Button>
        {/each}
      </div>
    </div>
  </div>
</aside>
