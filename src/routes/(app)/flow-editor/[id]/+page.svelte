<script lang="ts">
  import { page } from '$app/state';
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
  import { coordinateFlowActivation } from '$lib/flows/flow-activation';
  import type { WorkingFlow } from '$lib/flows/flow-ops';
  import { jsonMutation, mutationErrorMessage } from '$lib/api/json-mutation';
  import { isAdmin } from '$lib/state/features/user.svelte';
  import type { TriggerNodeData, ScheduleNodeData } from '$lib/state/features/flow-editor.svelte';
  import ConsolePanel from '$lib/components/flow-editor/ConsolePanel.svelte';
  import { sendRequest } from '$lib/services/gateway.svelte';
  import { ArrowLeft, Copy, PanelLeft, Sparkles, Trash2 } from 'lucide-svelte';
  import { Badge, Button, Input, PageHeader } from '$lib/components/ui';
  import AsyncBoundary from '$lib/components/ui/foundations/AsyncBoundary.svelte';
  import Layer from '$lib/components/ui/foundations/Layer.svelte';
  import PageBody from '$lib/components/ui/foundations/PageBody.svelte';
  import PageShell from '$lib/components/ui/foundations/PageShell.svelte';
  import * as m from '$lib/paraglide/messages';

  const back = createBackNav('/flow-editor', m.flow_backToFlows);
  const flowId = $derived(page.params.id);
  let flowLoading = $state(true);
  let loadError = $state<string | null>(null);
  let operationError = $state<string | null>(null);
  let isActivating = $state(false);
  let paletteOpen = $state(false);
  let copilotOpen = $state(false);
  const hasTrigger = $derived(
    flowEditorState.nodes.some(
      (n) => n.type === 'trigger' || n.type === 'pluginTrigger' || n.type === 'schedule',
    ),
  );

  async function handleActivate() {
    if (isActivating || !flowEditorState.flowId) return;
    isActivating = true;
    operationError = null;
    try {
      const previousActive = flowEditorState.flowActive;
      const newActive = !flowEditorState.flowActive;
      const scheduleNode = flowEditorState.nodes.find((n) => n.type === 'schedule');
      const triggerNode = flowEditorState.nodes.find(
        (n) => n.type === 'trigger' || n.type === 'pluginTrigger',
      );

      await coordinateFlowActivation({
        previousActive,
        nextActive: newActive,
        syncGateway: async (active) => {
          // A schedule-entry flow registers with the gateway's interval
          // scheduler instead of the event-driven trigger-manager.
          if (scheduleNode) {
            const sd = scheduleNode.data as ScheduleNodeData;
            if (active) {
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

          if (!triggerNode) return;
          const td = triggerNode.data as TriggerNodeData;
          if (active) {
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
        },
        persist: async (active) => {
          await jsonMutation<{ ok: boolean }>({
            input: `/api/flows/${flowEditorState.flowId}`,
            init: {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ active }),
            },
          });
        },
      });
      // Local UI commits only after both systems agree.
      flowEditorState.flowActive = newActive;
    } catch (error) {
      operationError = mutationErrorMessage(error, m.common_error());
    } finally {
      isActivating = false;
    }
  }

  async function hydrateFlow() {
    flowLoading = true;
    loadError = null;
    try {
      await loadFlow(flowId!);
    } catch (e) {
      loadError = e instanceof Error ? e.message : m.common_error();
    } finally {
      flowLoading = false;
    }
  }

  onMount(hydrateFlow);

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
    operationError = null;
    try {
      await jsonMutation<{ ok: boolean }>({
        input: `/api/flows/${flowEditorState.flowId}`,
        init: {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodes: proposed.nodes, edges: proposed.edges }),
        },
        onSuccess: () => {
          setNodes(proposed.nodes);
          setEdges(proposed.edges);
          flowEditorState.previewDiff = null;
          backup = null;
        },
      });
      return true;
    } catch (error) {
      // Keep the proposal preview and backup intact so the user can retry or reject it.
      operationError = mutationErrorMessage(error, m.common_error());
      return false;
    }
  }

  function onReject() {
    onPreview(null);
  }
</script>

<PageShell archetype="canvas" scroll="none" variant="canvas">
  <PageHeader title={flowEditorState.flowName || m.flow_untitledFlow()} sticky={false}>
    {#snippet leading()}
      <Button variant="ghost" size="sm" shape="icon" onclick={back.go} aria-label={back.label}>
        {#snippet icon()}<ArrowLeft size={16} aria-hidden="true" />{/snippet}
      </Button>
    {/snippet}
    {#snippet secondaryActions()}
      <Input
        aria-label={m.flow_name()}
        value={flowEditorState.flowName}
        size="sm"
        oninput={handleNameInput}
      />
      {#if flowEditorState.flowPluginId}
        <Badge variant="neutral" size="sm">
          {flowEditorState.flowPluginId}
        </Badge>
      {/if}
      {#if flowEditorState.relationshipMode}
        <Badge variant="semantic" value="warning" size="sm">
          {m.flow_relationshipMode()}
        </Badge>
      {:else if flowEditorState.isDirty}
        <Badge variant="neutral" size="sm">{m.flow_unsaved()}</Badge>
      {/if}
    {/snippet}
    {#snippet primaryActions()}
      {#if hasTrigger}
        <Button
          variant={flowEditorState.flowActive ? 'danger' : 'primary'}
          size="sm"
          loading={isActivating}
          onclick={handleActivate}
        >
          {flowEditorState.flowActive ? m.flow_deactivate() : m.flow_activate()}
        </Button>
      {/if}
    {/snippet}
  </PageHeader>

  {#if operationError}
    <p class="operation-error" role="alert">{operationError}</p>
  {/if}

  <div class="mobile-editor-controls">
    <Button variant="secondary" size="sm" onclick={() => (paletteOpen = !paletteOpen)}>
      {#snippet icon()}<PanelLeft size={14} aria-hidden="true" />{/snippet}
      {m.flow_palette()}
    </Button>
    {#if canCopilot && flowEditorState.flowId}
      <Button variant="secondary" size="sm" onclick={() => (copilotOpen = !copilotOpen)}>
        {#snippet icon()}<Sparkles size={14} aria-hidden="true" />{/snippet}
        {m.flow_copilot_title()}
      </Button>
    {/if}
  </div>

  <PageBody padding="none" scroll="none" class="flow-editor-body">
    <AsyncBoundary
      state={flowLoading
        ? { kind: 'loading' }
        : loadError
          ? { kind: 'error', title: m.common_error(), description: loadError, retry: hydrateFlow }
          : { kind: 'ready' }}
      class="flow-boundary"
    >
      <div class="editor-stage">
        <div class:mobile-open={paletteOpen} class="palette-pane">
          <div class="mobile-pane-header">
            <span>{m.flow_palette()}</span>
            <Button variant="ghost" size="sm" onclick={() => (paletteOpen = false)}>
              {m.flow_collapsePalette()}
            </Button>
          </div>
          <FlowSidebar />
        </div>

        <div class="canvas-stack">
          <FlowCanvas />
          {#if flowEditorState.consoleOpen}
            <ConsolePanel />
          {/if}
        </div>

        {#if canCopilot && flowEditorState.flowId}
          <div class:mobile-open={copilotOpen} class="copilot-pane">
            <div class="mobile-pane-header">
              <span>{m.flow_copilot_title()}</span>
              <Button variant="ghost" size="sm" onclick={() => (copilotOpen = false)}>
                {m.common_close()}
              </Button>
            </div>
            <FlowCopilotPanel
              flowId={flowEditorState.flowId}
              onpreview={onPreview}
              onapply={onApply}
              onreject={onReject}
            />
          </div>
        {/if}
      </div>
    </AsyncBoundary>
  </PageBody>
</PageShell>

{#if flowEditorState.contextMenu.open}
  <Layer tier="dropdown" portal position="fixed" class="context-backdrop-layer">
    <div
      class="context-backdrop"
      role="presentation"
      onclick={() => (flowEditorState.contextMenu.open = false)}
      oncontextmenu={(event) => {
        event.preventDefault();
        flowEditorState.contextMenu.open = false;
      }}
    ></div>
  </Layer>
  <Layer tier="popover" portal position="fixed">
    <div
      style:left={`${flowEditorState.contextMenu.x}px`}
      style:top={`${flowEditorState.contextMenu.y}px`}
      class="context-menu"
      role="menu"
    >
      {#if nodeHasConfig(flowEditorState.nodes.find((node) => node.id === flowEditorState.contextMenu.nodeId))}
        <Button
          variant="ghost"
          size="sm"
          class="context-action"
          role="menuitem"
          onclick={() => {
            if (flowEditorState.contextMenu.nodeId)
              openNodeConfig(flowEditorState.contextMenu.nodeId);
            flowEditorState.contextMenu.open = false;
          }}
        >
          {m.common_configure()}
        </Button>
      {/if}
      <Button
        variant="ghost"
        size="sm"
        class="context-action"
        role="menuitem"
        onclick={() => {
          if (flowEditorState.contextMenu.nodeId) duplicateNode(flowEditorState.contextMenu.nodeId);
          flowEditorState.contextMenu.open = false;
        }}
      >
        {#snippet icon()}<Copy size={12} aria-hidden="true" />{/snippet}
        {m.flow_duplicate()}
      </Button>
      <Button
        variant="danger"
        size="sm"
        class="context-action"
        role="menuitem"
        onclick={() => {
          if (flowEditorState.contextMenu.nodeId) deleteNode(flowEditorState.contextMenu.nodeId);
          flowEditorState.contextMenu.open = false;
        }}
      >
        {#snippet icon()}<Trash2 size={12} aria-hidden="true" />{/snippet}
        {m.common_delete()}
      </Button>
    </div>
  </Layer>
{/if}

<style>
  .operation-error {
    padding: var(--space-2) var(--space-page-gutter);
    border-bottom: 1px solid var(--color-danger-border);
    color: var(--color-danger-fg);
    background: var(--color-danger-surface);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  :global(.flow-editor-body),
  :global(.flow-boundary),
  .editor-stage,
  .canvas-stack,
  .palette-pane,
  .copilot-pane {
    display: flex;
    min-width: 0;
    min-height: 0;
  }

  :global(.flow-editor-body),
  :global(.flow-boundary),
  .canvas-stack {
    flex: 1;
  }

  :global(.flow-boundary),
  .canvas-stack,
  .palette-pane,
  .copilot-pane {
    flex-direction: column;
  }

  .editor-stage {
    position: relative;
    flex: 1;
    overflow: hidden;
  }

  .mobile-editor-controls,
  .mobile-pane-header {
    display: none;
  }

  .context-backdrop {
    position: fixed;
    inset: 0;
  }

  .context-menu {
    position: fixed;
    display: flex;
    min-width: 12rem;
    padding: var(--space-1);
    flex-direction: column;
    gap: var(--space-0-5);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-3);
    box-shadow: var(--shadow-elevation-3);
  }

  :global(.context-action) {
    width: 100%;
    justify-content: flex-start;
  }

  @media (max-width: 767.98px) {
    .mobile-editor-controls {
      display: flex;
      padding: var(--space-2) var(--space-page-gutter);
      gap: var(--space-control-gap);
      overflow-x: auto;
      border-bottom: 1px solid var(--color-border-subtle);
      background: var(--color-surface-1);
    }

    .palette-pane,
    .copilot-pane {
      position: absolute;
      inset: 0;
      display: none;
      z-index: var(--layer-popover);
      background: var(--color-canvas);
    }

    .palette-pane.mobile-open,
    .copilot-pane.mobile-open {
      display: flex;
    }

    .mobile-pane-header {
      display: flex;
      min-height: var(--control-height-touch);
      padding-inline: var(--space-page-gutter);
      align-items: center;
      justify-content: space-between;
      gap: var(--space-control-gap);
      border-bottom: 1px solid var(--color-border-subtle);
      color: var(--color-text-primary);
      background: var(--color-surface-1);
      font-size: var(--font-size-section-title);
      font-weight: var(--font-weight-semibold);
    }

    .palette-pane :global(aside),
    .copilot-pane :global(aside) {
      width: 100%;
      flex: 1;
    }
  }
</style>
