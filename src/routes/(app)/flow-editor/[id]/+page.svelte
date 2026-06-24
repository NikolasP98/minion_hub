<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { createBackNav } from '$lib/nav/back-nav.svelte';
  import FlowCanvas from '$lib/components/flow-editor/FlowCanvas.svelte';
  import FlowSidebar from '$lib/components/flow-editor/FlowSidebar.svelte';
  import FlowCopilotPanel from '$lib/components/flow-editor/FlowCopilotPanel.svelte';
  import {
    flowEditorState,
    loadFlow,
    deleteNode,
    duplicateNode,
    openNodeConfig,
    nodeHasConfig,
    triggerChannelFilter,
    setNodes,
    setEdges,
  } from '$lib/state/features/flow-editor.svelte';
  import { diffFlow } from '$lib/flows/flow-diff';
  import type { WorkingFlow } from '$lib/flows/flow-ops';
  import { isAdmin } from '$lib/state/features/user.svelte';
  import type { TriggerNodeData, ScheduleNodeData } from '$lib/state/features/flow-editor.svelte';
  import ConsolePanel from '$lib/components/flow-editor/ConsolePanel.svelte';
  import { sendRequest } from '$lib/services/gateway.svelte';
  import { ArrowLeft, GitBranch, Trash2, Copy, Settings2, Puzzle } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  const back = createBackNav('/flow-editor', m.flow_backToFlows);
  const flowId = $derived(page.params.id);
  let loadError = $state<string | null>(null);
  let isActivating = $state(false);
  const hasTrigger = $derived(
    flowEditorState.nodes.some(
      (n) => n.type === 'trigger' || n.type === 'pluginTrigger' || n.type === 'schedule',
    ),
  );

  async function handleActivate() {
    if (isActivating || !flowEditorState.flowId) return;
    isActivating = true;
    try {
      const newActive = !flowEditorState.flowActive;
      await fetch(`/api/flows/${flowEditorState.flowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: newActive }),
      });
      flowEditorState.flowActive = newActive;

      // A schedule-entry flow registers with the gateway's interval scheduler
      // instead of the event-driven trigger-manager.
      const scheduleNode = flowEditorState.nodes.find((n) => n.type === 'schedule');
      if (scheduleNode) {
        const sd = scheduleNode.data as ScheduleNodeData;
        if (newActive) {
          await sendRequest('flows.schedule.register', {
            flowId: flowEditorState.flowId,
            every: sd.every,
            unit: sd.unit,
            atTime: sd.atTime,
          });
        } else {
          await sendRequest('flows.schedule.unregister', { flowId: flowEditorState.flowId });
        }
        return;
      }

      const triggerNode = flowEditorState.nodes.find(
        (n) => n.type === 'trigger' || n.type === 'pluginTrigger',
      );
      if (!triggerNode) return;
      const td = triggerNode.data as TriggerNodeData;
      if (newActive) {
        await sendRequest('flows.trigger.register', {
          flowId: flowEditorState.flowId,
          event: td.event,
          deliverResponse: td.deliverResponse,
          ...triggerChannelFilter(td),
          filterAgentId: td.filterAgentId,
        });
      } else {
        await sendRequest('flows.trigger.unregister', { flowId: flowEditorState.flowId });
      }
    } finally {
      isActivating = false;
    }
  }

  onMount(async () => {
    try {
      await loadFlow(flowId!);
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load flow';
    }
  });

  function handleNameInput(e: Event) {
    flowEditorState.flowName = (e.target as HTMLInputElement).value;
    flowEditorState.isDirty = true;
  }

  // ── Flow copilot (admin or flow owner) ──────────────────────────────────────
  const currentUserId = $derived((page.data as { user?: { id?: string } }).user?.id ?? null);
  const canCopilot = $derived(
    isAdmin.value ||
      (!!flowEditorState.flowOwnerId && flowEditorState.flowOwnerId === currentUserId),
  );

  let backup: WorkingFlow | null = null;

  function onPreview(proposed: WorkingFlow | null) {
    if (!proposed) {
      if (backup) {
        setNodes(backup.nodes);
        setEdges(backup.edges);
        backup = null;
      }
      flowEditorState.previewDiff = null;
      return;
    }
    if (!backup) backup = { nodes: [...flowEditorState.nodes], edges: [...flowEditorState.edges] };
    flowEditorState.previewDiff = diffFlow(backup, proposed);
    // Merge backup ∪ proposed so removed items still render (as red-ringed ghosts).
    const nById = new Map(backup.nodes.map((n) => [n.id, n]));
    for (const n of proposed.nodes) nById.set(n.id, n);
    const eById = new Map(backup.edges.map((e) => [e.id, e]));
    for (const e of proposed.edges) eById.set(e.id, e);
    setNodes([...nById.values()]);
    setEdges([...eById.values()]);
  }

  async function onApply(proposed: WorkingFlow) {
    setNodes(proposed.nodes);
    setEdges(proposed.edges);
    flowEditorState.previewDiff = null;
    backup = null;
    await fetch(`/api/flows/${flowEditorState.flowId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes: proposed.nodes, edges: proposed.edges }),
    });
  }

  function onReject() {
    onPreview(null);
  }
</script>

<!-- Self-sufficient flex-column shell: Svelte Flow needs a definite-height
     ancestor, so don't rely on the parent layout being a flex column. -->
<div class="flex flex-col flex-1 min-h-0 h-full">
  {#if loadError}
    <div class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <p class="text-red-400 mb-4">{loadError}</p>
        <button
          onclick={() => goto('/flow-editor')}
          class="text-xs text-muted hover:text-foreground transition-colors"
        >
          {m.flow_backToFlows()}
        </button>
      </div>
    </div>
  {:else}
    <!-- Toolbar -->
    <div
      class="shrink-0 h-10 border-b border-border bg-bg2/80 flex items-center px-3 gap-3 md:pr-[var(--notch-clearance)]"
    >
      <!-- Back -->
      <button
        type="button"
        onclick={back.go}
        class="flex items-center justify-center w-7 h-7 rounded text-muted hover:text-foreground hover:bg-bg3 transition-colors"
        title={m.flow_backToFlows()}
      >
        <ArrowLeft size={14} />
      </button>

      <div class="w-px h-4 bg-border/60"></div>

      <!-- Flow name -->
      <div class="flex items-center gap-1.5 min-w-0">
        <GitBranch size={13} class="text-muted shrink-0" />
        <input
          type="text"
          class="bg-transparent text-sm font-semibold text-foreground focus:outline-none w-48 truncate placeholder:text-muted"
          value={flowEditorState.flowName}
          oninput={handleNameInput}
          placeholder={m.flow_untitledFlow()}
        />
      </div>

      <!-- Plugin-origin pill -->
      {#if flowEditorState.flowPluginId}
        <div
          class="flex items-center gap-1 px-2 py-1 rounded-full bg-accent/15 text-accent text-[10px] font-mono uppercase tracking-wider ring-1 ring-accent/25 shrink-0"
          title={m.flow_pluginManaged({ plugin: flowEditorState.flowPluginId })}
        >
          <Puzzle size={11} />
          {flowEditorState.flowPluginId}
        </div>
      {/if}

      <!-- Mode indicator -->
      {#if flowEditorState.relationshipMode}
        <div
          class="flex items-center gap-1.5 px-2 py-1 rounded bg-amber-500/15 border border-amber-500/30"
        >
          <div class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></div>
          <span class="text-[10px] font-mono text-amber-300">{m.flow_relationshipMode()}</span>
        </div>
      {:else if flowEditorState.isDirty}
        <div class="flex items-center gap-1 text-[10px] text-muted font-mono">
          <div class="w-1.5 h-1.5 rounded-full bg-yellow-500/60"></div>
          {m.flow_unsaved()}
        </div>
      {/if}

      <div class="flex-1"></div>

      <!-- Activate / Deactivate button -->
      {#if hasTrigger}
        <button
          onclick={handleActivate}
          disabled={isActivating}
          class="flex items-center gap-1.5 h-7 px-3 text-xs rounded border transition-colors
            {flowEditorState.flowActive
              ? 'border-red-500/50 text-red-400 hover:bg-red-500/10'
              : 'border-amber-500/50 text-amber-400 hover:bg-amber-500/10'}
            disabled:opacity-50 disabled:cursor-default"
        >
          {flowEditorState.flowActive ? 'Deactivate' : 'Activate'}
        </button>
      {/if}
    </div>

    <!-- Editor body -->
    <div class="flex flex-1 min-h-0 overflow-hidden flex-col">
      <div class="flex flex-1 min-h-0 overflow-hidden">
        <FlowSidebar />
        <FlowCanvas />
        {#if canCopilot && flowEditorState.flowId}
          <FlowCopilotPanel
            flowId={flowEditorState.flowId}
            onpreview={onPreview}
            onapply={onApply}
            onreject={onReject}
          />
        {/if}
      </div>
      {#if flowEditorState.consoleOpen}
        <ConsolePanel />
      {/if}
    </div>
  {/if}
</div>

  <!-- Node context menu — rendered outside the flow canvas to avoid transform clipping -->
  {#if flowEditorState.contextMenu.open}
    <!-- Backdrop to close on outside click -->
    <div
      class="fixed inset-0 z-40"
      role="presentation"
      onclick={() => (flowEditorState.contextMenu.open = false)}
      oncontextmenu={(e) => {
        e.preventDefault();
        flowEditorState.contextMenu.open = false;
      }}
    ></div>
    <!-- Menu -->
    <div
      style="left: {flowEditorState.contextMenu.x}px; top: {flowEditorState.contextMenu.y}px;"
      class="fixed z-50 bg-bg2 border border-border rounded-lg shadow-xl py-1 min-w-36"
    >
      {#if nodeHasConfig(flowEditorState.nodes.find((n) => n.id === flowEditorState.contextMenu.nodeId))}
        <button
          onclick={() => {
            if (flowEditorState.contextMenu.nodeId) openNodeConfig(flowEditorState.contextMenu.nodeId);
            flowEditorState.contextMenu.open = false;
          }}
          class="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-foreground/80 hover:bg-bg3 transition-colors"
        >
          <Settings2 size={12} class="shrink-0" />
          Configure
        </button>
        <div class="h-px bg-border/50 my-1"></div>
      {/if}
      <button
        onclick={() => {
          if (flowEditorState.contextMenu.nodeId) duplicateNode(flowEditorState.contextMenu.nodeId);
          flowEditorState.contextMenu.open = false;
        }}
        class="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-foreground/80 hover:bg-bg3 transition-colors"
      >
        <Copy size={12} class="shrink-0" />
        {m.flow_duplicate()}
      </button>
      <div class="h-px bg-border/50 my-1"></div>
      <button
        onclick={() => {
          if (flowEditorState.contextMenu.nodeId) deleteNode(flowEditorState.contextMenu.nodeId);
          flowEditorState.contextMenu.open = false;
        }}
        class="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-red-400 hover:bg-red-500/10 transition-colors"
      >
        <Trash2 size={12} class="shrink-0" />
        {m.common_delete()}
      </button>
    </div>
  {/if}
