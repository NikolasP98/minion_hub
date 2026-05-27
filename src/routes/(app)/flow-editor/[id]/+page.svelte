<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import FlowCanvas from '$lib/components/flow-editor/FlowCanvas.svelte';
  import FlowSidebar from '$lib/components/flow-editor/FlowSidebar.svelte';
  import {
    flowEditorState,
    loadFlow,
    saveFlow,
    runFlow,
    deleteNode,
    duplicateNode,
  } from '$lib/state/features/flow-editor.svelte';
  import ConsolePanel from '$lib/components/flow-editor/ConsolePanel.svelte';
  import { sendRequest } from '$lib/services/gateway.svelte';
  import { ArrowLeft, Save, GitBranch, Loader, Play, Trash2, Copy } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  const flowId = $derived(page.params.id);
  let loadError = $state<string | null>(null);
  let isActivating = $state(false);
  const hasTrigger = $derived(
    flowEditorState.nodes.some((n) => n.type === 'trigger' || n.type === 'pluginTrigger'),
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
      const triggerNode = flowEditorState.nodes.find(
        (n) => n.type === 'trigger' || n.type === 'pluginTrigger',
      );
      if (!triggerNode) return;
      const td = triggerNode.data as {
        event: string;
        deliverResponse: boolean;
        filterChannelId?: string;
        filterAgentId?: string;
      };
      if (newActive) {
        await sendRequest('flows.trigger.register', {
          flowId: flowEditorState.flowId,
          event: td.event,
          deliverResponse: td.deliverResponse,
          filterChannelId: td.filterChannelId,
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

  async function handleSave() {
    await saveFlow();
  }

  function handleNameInput(e: Event) {
    flowEditorState.flowName = (e.target as HTMLInputElement).value;
    flowEditorState.isDirty = true;
  }
</script>

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
      class="shrink-0 h-10 border-b border-border bg-bg2/80 flex items-center px-3 gap-3"
    >
      <!-- Back -->
      <a
        href="/flow-editor"
        class="flex items-center justify-center w-7 h-7 rounded text-muted hover:text-foreground hover:bg-bg3 transition-colors"
        title={m.flow_backToFlows()}
      >
        <ArrowLeft size={14} />
      </a>

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

      <!-- Test Run button -->
      <button
        onclick={runFlow}
        disabled={flowEditorState.isRunning}
        class="flex items-center gap-1.5 h-7 px-3 text-xs rounded border transition-colors
          border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50 disabled:cursor-default"
      >
        {#if flowEditorState.isRunning}
          <Loader size={12} class="animate-spin" />
        {:else}
          <Play size={12} />
        {/if}
        {m.flow_testRun()}
      </button>

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

      <!-- Save button -->
      <button
        onclick={handleSave}
        disabled={flowEditorState.isSaving || !flowEditorState.isDirty}
        class="flex items-center gap-1.5 h-7 px-3 text-xs rounded border transition-colors
          {flowEditorState.isDirty
          ? 'border-accent/50 text-accent hover:bg-accent/10'
          : 'border-border text-muted/50 cursor-default'}"
      >
        {#if flowEditorState.isSaving}
          <Loader size={12} class="animate-spin" />
        {:else}
          <Save size={12} />
        {/if}
        {m.common_save()}
      </button>
    </div>

    <!-- Editor body -->
    <div class="flex flex-1 min-h-0 overflow-hidden flex-col">
      <div class="flex flex-1 min-h-0 overflow-hidden">
        <FlowSidebar />
        <FlowCanvas />
      </div>
      {#if flowEditorState.consoleOpen}
        <ConsolePanel />
      {/if}
    </div>
  {/if}

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
