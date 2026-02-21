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
    const { instanceId } = contextMenu;

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
      // TODO: Task 20 - gateway integration
    } else if (action === 'startConversation') {
      // TODO: Task 20 - gateway integration
    }

    contextMenu = null;
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
        window.removeEventListener('workshop:reload', handleReload);
        stopSimulation();
        physics.destroyPhysics();
        agentSprites.clearAllSprites();
        ropeRenderer.clearAllRopes();

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
      onClose={() => (activeChatPanel = null)}
    />
  {/if}
</div>
