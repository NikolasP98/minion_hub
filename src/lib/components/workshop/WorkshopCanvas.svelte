<script lang="ts">
  import * as PIXI from 'pixi.js';
  import * as physics from '$lib/workshop/physics';
  import * as agentSprites from '$lib/workshop/agent-sprite';
  import * as ropeRenderer from '$lib/workshop/rope-renderer';
  import { startSimulation, stopSimulation } from '$lib/workshop/simulation';
  import { screenToWorld, applyZoom, applyPan } from '$lib/workshop/camera';
  import {
    workshopState,
    autoLoad,
    autoSave,
    addAgentInstance,
    removeAgentInstance,
    addRelationship,
    setAgentBehavior,
  } from '$lib/state/workshop.svelte';
  import { findNearbyAgents } from '$lib/workshop/proximity';
  import { gw } from '$lib/state/gateway-data.svelte';
  import { conn } from '$lib/state/connection.svelte';
  import {
    startWorkshopConversation,
    assignTask,
    onWorkshopMessage,
    type WorkshopMessage,
  } from '$lib/workshop/gateway-bridge';
  import SpeechBubble from './SpeechBubble.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import RelationshipPrompt from './RelationshipPrompt.svelte';
  import ChatPanel from './ChatPanel.svelte';

  // ---------------------------------------------------------------------------
  // PixiJS state (not reactive - managed imperatively within onMount)
  // ---------------------------------------------------------------------------

  let app: PIXI.Application | null = null;
  let worldContainer: PIXI.Container | null = null;
  let canvasContainer: HTMLDivElement | null = null;

  // ---------------------------------------------------------------------------
  // Interaction state
  // ---------------------------------------------------------------------------

  let isPanning = $state(false);
  let isDraggingAgent = $state(false);
  let draggedInstanceId = $state<string | null>(null);
  let isLinking = $state(false);
  let linkFromInstanceId = $state<string | null>(null);
  let linkLineGraphics: PIXI.Graphics | null = null;

  // ---------------------------------------------------------------------------
  // Overlay state
  // ---------------------------------------------------------------------------

  let contextMenu = $state<{
    instanceId: string;
    agentName: string;
    x: number;
    y: number;
  } | null>(null);

  let relationshipPrompt = $state<{
    fromId: string;
    toId: string;
    fromName: string;
    toName: string;
    x: number;
    y: number;
  } | null>(null);

  let activeChatPanel = $state<string | null>(null);

  let speechBubbles = $state<
    Array<{ id: string; message: string; agentName: string; screenX: number; screenY: number }>
  >([]);

  // Task prompt dialog state
  let taskPromptDialog = $state<{
    instanceId: string;
    targetInstanceId?: string; // set for "Start conversation with..."
    agentName: string;
    mode: 'assign' | 'conversation';
  } | null>(null);
  let taskPromptInput = $state('');

  // Workshop conversation messages (for ChatPanel)
  let workshopMessages = $state<WorkshopMessage[]>([]);

  // Active conversation handles for abort
  let activeHandles = $state<Map<string, { abort: () => void }>>(new Map());

  // ---------------------------------------------------------------------------
  // Pan tracking
  // ---------------------------------------------------------------------------

  let lastPointerX = 0;
  let lastPointerY = 0;

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  const SPRITE_HIT_RADIUS = 35;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function resolveAgentName(agentId: string): string {
    const agent = gw.agents.find((a) => a.id === agentId);
    return agent?.name ?? agentId;
  }

  function resolveAvatarSeed(agentId: string): string {
    const agent = gw.agents.find((a) => a.id === agentId);
    return agent?.name ?? agentId;
  }

  function resolveEmoji(agentId: string): string | undefined {
    const agent = gw.agents.find((a) => a.id === agentId);
    return agent?.emoji;
  }

  function hitTestAgentAtWorld(worldX: number, worldY: number): string | null {
    const allSprites = agentSprites.getAllSprites();
    for (const [instanceId, container] of allSprites) {
      const dx = container.x - worldX;
      const dy = container.y - worldY;
      if (Math.sqrt(dx * dx + dy * dy) <= SPRITE_HIT_RADIUS) {
        return instanceId;
      }
    }
    return null;
  }

  function syncCamera() {
    if (!worldContainer) return;
    worldContainer.x = workshopState.camera.x;
    worldContainer.y = workshopState.camera.y;
    worldContainer.scale.set(workshopState.camera.zoom);
  }

  function getNearbyAgentsList(instanceId: string): Array<{ instanceId: string; name: string }> {
    const nearbyIds = findNearbyAgents(instanceId);
    return nearbyIds.map((nId) => {
      const inst = workshopState.agents[nId];
      return {
        instanceId: nId,
        name: inst ? resolveAgentName(inst.agentId) : nId,
      };
    });
  }

  function removeBubble(id: string) {
    speechBubbles = speechBubbles.filter((b) => b.id !== id);
  }

  // ---------------------------------------------------------------------------
  // Scene rebuild
  // ---------------------------------------------------------------------------

  async function rebuildScene() {
    if (!worldContainer) return;

    agentSprites.clearAllSprites();
    ropeRenderer.clearAllRopes();

    for (const [instanceId, inst] of Object.entries(workshopState.agents)) {
      physics.addAgentBody(instanceId, inst.position.x, inst.position.y);

      await agentSprites.createAgentSprite(
        instanceId,
        {
          agentId: inst.agentId,
          name: resolveAgentName(inst.agentId),
          avatarSeed: resolveAvatarSeed(inst.agentId),
          emoji: resolveEmoji(inst.agentId),
        },
        inst.position.x,
        inst.position.y,
        worldContainer,
      );

      if (inst.behavior === 'wander' || inst.behavior === 'patrol') {
        physics.makeAgentDynamic(instanceId);
      }
    }

    for (const [relId, rel] of Object.entries(workshopState.relationships)) {
      physics.addSpringJoint(relId, rel.fromInstanceId, rel.toInstanceId);
      ropeRenderer.createRope(relId, rel.label, worldContainer);
    }

    syncCamera();
  }

  // ---------------------------------------------------------------------------
  // Remove agent from canvas
  // ---------------------------------------------------------------------------

  function removeAgentFromCanvas(instanceId: string) {
    for (const [relId, rel] of Object.entries(workshopState.relationships)) {
      if (rel.fromInstanceId === instanceId || rel.toInstanceId === instanceId) {
        physics.removeSpringJoint(relId);
        ropeRenderer.removeRope(relId);
      }
    }

    physics.removeAgentBody(instanceId);
    agentSprites.removeAgentSprite(instanceId);
    removeAgentInstance(instanceId);
    autoSave();
  }

  // ---------------------------------------------------------------------------
  // Pointer event handlers
  // ---------------------------------------------------------------------------

  function handlePointerDown(e: PointerEvent) {
    if (!canvasContainer) return;

    if (contextMenu) {
      contextMenu = null;
      return;
    }

    const rect = canvasContainer.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPos = screenToWorld(screenX, screenY, workshopState.camera);

    const hitId = hitTestAgentAtWorld(worldPos.x, worldPos.y);

    if (hitId) {
      if (e.shiftKey) {
        isLinking = true;
        linkFromInstanceId = hitId;

        if (worldContainer) {
          linkLineGraphics = new PIXI.Graphics();
          worldContainer.addChild(linkLineGraphics);
        }
      } else {
        isDraggingAgent = true;
        draggedInstanceId = hitId;
        physics.makeAgentKinematic(hitId);
        canvasContainer.style.cursor = 'grabbing';
      }
    } else {
      isPanning = true;
      canvasContainer.style.cursor = 'move';
    }

    lastPointerX = e.clientX;
    lastPointerY = e.clientY;

    canvasContainer.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!canvasContainer) return;

    const dx = e.clientX - lastPointerX;
    const dy = e.clientY - lastPointerY;

    if (isPanning) {
      workshopState.camera = applyPan(workshopState.camera, dx, dy);
      syncCamera();
    } else if (isDraggingAgent && draggedInstanceId) {
      const rect = canvasContainer.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const worldPos = screenToWorld(screenX, screenY, workshopState.camera);

      physics.setAgentPosition(draggedInstanceId, worldPos.x, worldPos.y);
      agentSprites.updateSpritePosition(draggedInstanceId, worldPos.x, worldPos.y);
    } else if (isLinking && linkFromInstanceId && linkLineGraphics) {
      const rect = canvasContainer.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const worldPos = screenToWorld(screenX, screenY, workshopState.camera);

      const fromSprite = agentSprites.getSprite(linkFromInstanceId);
      if (fromSprite) {
        linkLineGraphics.clear();
        linkLineGraphics
          .moveTo(fromSprite.x, fromSprite.y)
          .lineTo(worldPos.x, worldPos.y)
          .stroke({ width: 2, color: 0x6366f1, alpha: 0.6 });
      }
    }

    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
  }

  function handlePointerUp(e: PointerEvent) {
    if (!canvasContainer) return;

    canvasContainer.releasePointerCapture(e.pointerId);
    canvasContainer.style.cursor = 'default';

    if (isDraggingAgent && draggedInstanceId) {
      const pos = physics.getAgentPosition(draggedInstanceId);
      if (pos) {
        const inst = workshopState.agents[draggedInstanceId];
        if (inst) {
          inst.position = { x: pos.x, y: pos.y };
          inst.homePosition = { x: pos.x, y: pos.y };
        }
      }

      const inst = workshopState.agents[draggedInstanceId];
      if (inst && (inst.behavior === 'wander' || inst.behavior === 'patrol')) {
        physics.makeAgentDynamic(draggedInstanceId);
      }

      autoSave();
    } else if (isLinking && linkFromInstanceId) {
      const rect = canvasContainer.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const worldPos = screenToWorld(screenX, screenY, workshopState.camera);

      const targetId = hitTestAgentAtWorld(worldPos.x, worldPos.y);

      if (targetId && targetId !== linkFromInstanceId) {
        const fromInst = workshopState.agents[linkFromInstanceId];
        const toInst = workshopState.agents[targetId];
        if (fromInst && toInst) {
          relationshipPrompt = {
            fromId: linkFromInstanceId,
            toId: targetId,
            fromName: resolveAgentName(fromInst.agentId),
            toName: resolveAgentName(toInst.agentId),
            x: e.clientX,
            y: e.clientY,
          };
        }
      }

      if (linkLineGraphics) {
        linkLineGraphics.removeFromParent();
        linkLineGraphics.destroy();
        linkLineGraphics = null;
      }
    } else if (isPanning) {
      autoSave();
    }

    isPanning = false;
    isDraggingAgent = false;
    draggedInstanceId = null;
    isLinking = false;
    linkFromInstanceId = null;
  }

  function handleWheel(e: WheelEvent) {
    if (!canvasContainer) return;
    e.preventDefault();

    const rect = canvasContainer.getBoundingClientRect();
    const pivotX = e.clientX - rect.left;
    const pivotY = e.clientY - rect.top;

    workshopState.camera = applyZoom(workshopState.camera, e.deltaY, pivotX, pivotY);
    syncCamera();
    autoSave();
  }

  function handleContextMenu(e: MouseEvent) {
    if (!canvasContainer) return;
    e.preventDefault();

    const rect = canvasContainer.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPos = screenToWorld(screenX, screenY, workshopState.camera);

    const hitId = hitTestAgentAtWorld(worldPos.x, worldPos.y);

    if (hitId) {
      const inst = workshopState.agents[hitId];
      if (inst) {
        contextMenu = {
          instanceId: hitId,
          agentName: resolveAgentName(inst.agentId),
          x: e.clientX,
          y: e.clientY,
        };
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Drag & drop from toolbar
  // ---------------------------------------------------------------------------

  function handleDragOver(e: DragEvent) {
    if (e.dataTransfer?.types.includes('application/workshop-agent')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }

  async function handleDrop(e: DragEvent) {
    if (!canvasContainer) return;
    e.preventDefault();

    const raw = e.dataTransfer?.getData('application/workshop-agent');
    if (!raw) return;

    let agentData: { id: string; name?: string; emoji?: string; description?: string };
    try {
      agentData = JSON.parse(raw);
    } catch {
      return;
    }

    const rect = canvasContainer.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPos = screenToWorld(screenX, screenY, workshopState.camera);

    const instanceId = addAgentInstance(agentData.id, worldPos.x, worldPos.y);

    physics.addAgentBody(instanceId, worldPos.x, worldPos.y);

    if (worldContainer) {
      await agentSprites.createAgentSprite(
        instanceId,
        {
          agentId: agentData.id,
          name: agentData.name ?? agentData.id,
          avatarSeed: agentData.name ?? agentData.id,
          emoji: agentData.emoji,
        },
        worldPos.x,
        worldPos.y,
        worldContainer,
      );
    }

    autoSave();
  }

  // ---------------------------------------------------------------------------
  // Context menu action handler
  // ---------------------------------------------------------------------------

  function handleContextAction(action: string, data?: unknown) {
    if (!contextMenu) return;
    const { instanceId, agentName } = contextMenu;

    if (action === 'remove') {
      removeAgentFromCanvas(instanceId);
    } else if (action === 'setBehavior') {
      const behavior = data as 'stationary' | 'wander' | 'patrol';
      setAgentBehavior(instanceId, behavior);

      if (behavior === 'wander' || behavior === 'patrol') {
        physics.makeAgentDynamic(instanceId);
      } else {
        physics.makeAgentKinematic(instanceId);
      }

      autoSave();
    } else if (action === 'assignTask') {
      if (!conn.connected) return;
      taskPromptDialog = { instanceId, agentName, mode: 'assign' };
      taskPromptInput = '';
    } else if (action === 'startConversation') {
      if (!conn.connected) return;
      const payload = data as { targetInstanceId: string } | undefined;
      if (!payload?.targetInstanceId) return;
      const targetInst = workshopState.agents[payload.targetInstanceId];
      const targetName = targetInst ? resolveAgentName(targetInst.agentId) : 'agent';
      taskPromptDialog = {
        instanceId,
        targetInstanceId: payload.targetInstanceId,
        agentName: `${agentName} & ${targetName}`,
        mode: 'conversation',
      };
      taskPromptInput = '';
    }

    contextMenu = null;
  }

  function handleTaskPromptSubmit() {
    if (!taskPromptDialog || !taskPromptInput.trim()) return;

    const { instanceId, targetInstanceId, mode } = taskPromptDialog;
    const prompt = taskPromptInput.trim();

    if (mode === 'assign') {
      const handle = assignTask(instanceId, prompt);
      if (handle) {
        activeHandles.set(handle.conversationId, handle);
        activeChatPanel = handle.conversationId;
      }
    } else if (mode === 'conversation' && targetInstanceId) {
      const handle = startWorkshopConversation(
        [instanceId, targetInstanceId],
        prompt,
      );
      if (handle) {
        activeHandles.set(handle.conversationId, handle);
        activeChatPanel = handle.conversationId;
      }
    }

    taskPromptDialog = null;
    taskPromptInput = '';
  }

  // ---------------------------------------------------------------------------
  // Relationship creation
  // ---------------------------------------------------------------------------

  function handleRelationshipCreate(label: string) {
    if (!relationshipPrompt || !worldContainer) return;

    const { fromId, toId } = relationshipPrompt;

    const relId = addRelationship(fromId, toId, label);

    physics.addSpringJoint(relId, fromId, toId);

    physics.makeAgentDynamic(fromId);
    physics.makeAgentDynamic(toId);

    ropeRenderer.createRope(relId, label, worldContainer);

    relationshipPrompt = null;
    autoSave();
  }

  // ---------------------------------------------------------------------------
  // Svelte action: mount PixiJS canvas
  // ---------------------------------------------------------------------------

  function pixiCanvas(node: HTMLDivElement) {
    canvasContainer = node;
    let destroyed = false;

    // Subscribe to workshop bridge messages
    const unsubWorkshop = onWorkshopMessage((msg: WorkshopMessage) => {
      workshopMessages = [...workshopMessages, msg];

      // Also show a speech bubble for this message
      const inst = workshopState.agents[msg.instanceId];
      if (inst) {
        const sprite = agentSprites.getSprite(msg.instanceId);
        if (sprite && canvasContainer) {
          const rect = canvasContainer.getBoundingClientRect();
          const screenX = sprite.x * workshopState.camera.zoom + workshopState.camera.x;
          const screenY = sprite.y * workshopState.camera.zoom + workshopState.camera.y;

          // Truncate long messages for speech bubble display
          const bubbleText = msg.message.length > 120
            ? msg.message.slice(0, 117) + '...'
            : msg.message;

          speechBubbles = [...speechBubbles, {
            id: `ws_${Date.now()}_${msg.instanceId}`,
            message: bubbleText,
            agentName: resolveAgentName(inst.agentId),
            screenX,
            screenY,
          }];
        }
      }
    });

    async function init() {
      const pixiApp = new PIXI.Application();
      await pixiApp.init({
        background: 0x000000,
        backgroundAlpha: 0,
        resizeTo: node,
        antialias: true,
      });

      if (destroyed) {
        pixiApp.destroy(true);
        return;
      }

      app = pixiApp;

      // PixiJS requires direct DOM insertion for its canvas - this is
      // expected and does not conflict with Svelte since Svelte does not
      // manage the children of this container div.
      node.appendChild(app.canvas as HTMLCanvasElement);

      const canvas = app.canvas as HTMLCanvasElement;
      canvas.style.display = 'block';
      canvas.style.width = '100%';
      canvas.style.height = '100%';

      worldContainer = new PIXI.Container();
      app.stage.addChild(worldContainer);

      await physics.initPhysics();

      autoLoad();

      await rebuildScene();

      startSimulation();

      window.addEventListener('workshop:reload', handleReload);
    }

    function handleReload() {
      rebuildScene();
    }

    init();

    return {
      destroy() {
        destroyed = true;
        unsubWorkshop();
        window.removeEventListener('workshop:reload', handleReload);
        stopSimulation();
        physics.destroyPhysics();
        agentSprites.clearAllSprites();
        ropeRenderer.clearAllRopes();

        // Abort any active workshop conversations
        for (const handle of activeHandles.values()) {
          handle.abort();
        }
        activeHandles.clear();

        if (app) {
          app.destroy(true);
          app = null;
        }

        worldContainer = null;
        canvasContainer = null;
      },
    };
  }
</script>

<div class="flex-1 relative overflow-hidden">
  <!-- PixiJS canvas mounts here via the pixiCanvas action -->
  <div
    use:pixiCanvas
    class="w-full h-full"
    role="application"
    aria-label="Workshop canvas"
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onwheel={handleWheel}
    ondragover={handleDragOver}
    ondrop={handleDrop}
    oncontextmenu={handleContextMenu}
  ></div>

  <!-- HTML Overlay: speech bubbles -->
  <div class="absolute inset-0 pointer-events-none overflow-hidden">
    {#each speechBubbles as bubble (bubble.id)}
      <SpeechBubble
        message={bubble.message}
        agentName={bubble.agentName}
        screenX={bubble.screenX}
        screenY={bubble.screenY}
        onFaded={() => removeBubble(bubble.id)}
      />
    {/each}
  </div>

  <!-- Context Menu -->
  {#if contextMenu}
    <ContextMenu
      instanceId={contextMenu.instanceId}
      agentName={contextMenu.agentName}
      x={contextMenu.x}
      y={contextMenu.y}
      nearbyAgents={getNearbyAgentsList(contextMenu.instanceId)}
      onClose={() => (contextMenu = null)}
      onAction={handleContextAction}
    />
  {/if}

  <!-- Relationship Prompt -->
  {#if relationshipPrompt}
    <RelationshipPrompt
      fromName={relationshipPrompt.fromName}
      toName={relationshipPrompt.toName}
      x={relationshipPrompt.x}
      y={relationshipPrompt.y}
      onSubmit={(label) => handleRelationshipCreate(label)}
      onCancel={() => (relationshipPrompt = null)}
    />
  {/if}

  <!-- Chat Panel -->
  {#if activeChatPanel}
    <ChatPanel
      conversationId={activeChatPanel}
      messages={workshopMessages.filter((m) => m.conversationId === activeChatPanel)}
      onClose={() => (activeChatPanel = null)}
    />
  {/if}

  <!-- Task Prompt Dialog -->
  {#if taskPromptDialog}
    <div class="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div class="bg-bg2 border border-border rounded-lg shadow-xl w-96 max-w-[90vw] p-4">
        <h3 class="text-xs font-mono text-foreground mb-1">
          {taskPromptDialog.mode === 'assign' ? 'Assign Task' : 'Start Conversation'}
        </h3>
        <p class="text-[10px] text-muted mb-3">{taskPromptDialog.agentName}</p>
        <textarea
          class="w-full h-24 bg-bg1 border border-border rounded px-2 py-1.5 text-[11px] text-foreground font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder={taskPromptDialog.mode === 'assign' ? 'Describe the task...' : 'What should they discuss?'}
          bind:value={taskPromptInput}
          onkeydown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              handleTaskPromptSubmit();
            }
          }}
        ></textarea>
        <div class="flex justify-end gap-2 mt-3">
          <button
            class="px-3 py-1 text-[10px] font-mono text-muted hover:text-foreground border border-border rounded transition-colors"
            onclick={() => { taskPromptDialog = null; taskPromptInput = ''; }}
          >
            Cancel
          </button>
          <button
            class="px-3 py-1 text-[10px] font-mono text-accent-foreground bg-accent hover:bg-accent/90 rounded transition-colors disabled:opacity-40"
            disabled={!taskPromptInput.trim()}
            onclick={handleTaskPromptSubmit}
          >
            {taskPromptDialog.mode === 'assign' ? 'Send' : 'Start'}
          </button>
        </div>
        <p class="text-[9px] text-muted mt-2">Press Cmd/Ctrl+Enter to submit</p>
      </div>
    </div>
  {/if}
</div>
