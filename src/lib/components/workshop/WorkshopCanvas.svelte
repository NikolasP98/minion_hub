<script lang="ts">
  import { untrack } from 'svelte';
  import * as PIXI from 'pixi.js';
  import * as physics from '$lib/workshop/physics';
  import * as agentSprites from '$lib/workshop/agent-sprite';
  import * as elementSprites from '$lib/workshop/element-sprite';
  import { ELEMENT_WIDTH, ELEMENT_HEIGHT } from '$lib/workshop/element-sprite';
  import * as ropeRenderer from '$lib/workshop/rope-renderer';
  import { startSimulation, stopSimulation, setBanterCallback, removeAgentFromSimulation } from '$lib/workshop/simulation';
  import { screenToWorld, worldToScreen, applyZoom, applyPan } from '$lib/workshop/camera';
  import { createAgentFsm, destroyAgentFsm, sendFsmEvent, clearAllFsms } from '$lib/workshop/agent-fsm';
  import {
    workshopState,
    autoLoad,
    autoSave,
    addAgentInstance,
    removeAgentInstance,
    addRelationship,
    setAgentBehavior,
    addElement,
    removeElement,
    updateElementPosition,
  } from '$lib/state/workshop.svelte';
  import type { ElementType } from '$lib/state/workshop.svelte';
  import { findNearbyAgents } from '$lib/workshop/proximity';
  import { gw } from '$lib/state/gateway-data.svelte';
  import { conn } from '$lib/state/connection.svelte';
  import { hostsState } from '$lib/state/hosts.svelte';
  import {
    startWorkshopConversation,
    assignTask,
    onWorkshopMessage,
    type WorkshopMessage,
  } from '$lib/workshop/gateway-bridge';
  import SpeechBubble from './SpeechBubble.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import RelationshipPrompt from './RelationshipPrompt.svelte';
  import ConversationSidebar from './ConversationSidebar.svelte';
  import ConversationIndicator from './ConversationIndicator.svelte';
  import ElementContextMenu from './ElementContextMenu.svelte';
  import PinboardOverlay from './PinboardOverlay.svelte';
  import MessageBoardOverlay from './MessageBoardOverlay.svelte';
  import InboxOverlay from './InboxOverlay.svelte';
  import RulebookOverlay from './RulebookOverlay.svelte';
  import { thinkingAgents } from '$lib/state/workshop-conversations.svelte';

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
  let isDraggingElement = $state(false);
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

  let sidebarOpen = $state(false);
  let selectedConversationId = $state<string | null>(null);

  let speechBubbles = $state<
    Array<{ id: string; message: string; agentName: string; instanceId: string }>
  >([]);

  // Task prompt dialog state
  let taskPromptDialog = $state<{
    instanceId: string;
    targetInstanceId?: string; // set for "Start conversation with..."
    agentName: string;
    mode: 'assign' | 'conversation';
  } | null>(null);
  let taskPromptInput = $state('');

  // (messages now stored in conversationMessages state module)

  // Element overlay state
  let activeOverlay = $state<{
    elementId: string;
    type: ElementType;
  } | null>(null);

  let elementContextMenu = $state<{
    instanceId: string;
    label: string;
    x: number;
    y: number;
  } | null>(null);

  // Active conversation handles for abort
  let activeHandles = $state<Map<string, { abort: () => void }>>(new Map());

  // ---------------------------------------------------------------------------
  // Hide/show agents based on connection state
  // ---------------------------------------------------------------------------

  $effect(() => {
    if (!conn.connected) {
      agentSprites.clearAllSprites();
      elementSprites.clearAllElementSprites();
      ropeRenderer.clearAllRopes();
    } else {
      untrack(() => {
        autoLoad(hostsState.activeHostId);
        rebuildScene();
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Pan tracking
  // ---------------------------------------------------------------------------

  let lastPointerX = 0;
  let lastPointerY = 0;
  let pointerDownX = 0;
  let pointerDownY = 0;

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

  function hitTestElementAtWorld(worldX: number, worldY: number): string | null {
    const allSprites = elementSprites.getAllElementSprites();
    const halfW = ELEMENT_WIDTH / 2;
    const halfH = ELEMENT_HEIGHT / 2;
    for (const [instanceId, container] of allSprites) {
      if (
        worldX >= container.x - halfW && worldX <= container.x + halfW &&
        worldY >= container.y - halfH && worldY <= container.y + halfH
      ) {
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

  let rebuildVersion = 0;

  async function rebuildScene() {
    if (!worldContainer) return;

    const thisVersion = ++rebuildVersion;

    agentSprites.clearAllSprites();
    elementSprites.clearAllElementSprites();
    ropeRenderer.clearAllRopes();
    clearAllFsms();

    for (const [instanceId, inst] of Object.entries(workshopState.agents)) {
      // Bail out if a newer rebuildScene started while we were awaiting
      if (thisVersion !== rebuildVersion) return;

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

      // Create FSM for this agent instance
      createAgentFsm(instanceId, inst.behavior);
    }

    for (const [relId, rel] of Object.entries(workshopState.relationships)) {
      physics.addSpringJoint(relId, rel.fromInstanceId, rel.toInstanceId);
      ropeRenderer.createRope(relId, rel.label, worldContainer);
    }

    // Rebuild element sprites
    for (const [instanceId, el] of Object.entries(workshopState.elements)) {
      if (thisVersion !== rebuildVersion) return;
      physics.addElementBody(instanceId, el.position.x, el.position.y);
      const itemCount =
        el.type === 'pinboard' ? (el.pinboardItems?.length ?? 0) :
        el.type === 'inbox' ? (el.inboxItems?.filter((i) => !i.read).length ?? 0) : 0;
      elementSprites.createElementSprite(
        instanceId,
        el.type,
        el.label,
        el.position.x,
        el.position.y,
        worldContainer,
        itemCount,
      );
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
    destroyAgentFsm(instanceId);
    removeAgentFromSimulation(instanceId);
    removeAgentInstance(instanceId);
    autoSave();
  }

  // ---------------------------------------------------------------------------
  // Pointer event handlers
  // ---------------------------------------------------------------------------

  function handlePointerDown(e: PointerEvent) {
    if (!canvasContainer) return;

    if (contextMenu || elementContextMenu) {
      contextMenu = null;
      elementContextMenu = null;
      return;
    }

    const rect = canvasContainer.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPos = screenToWorld(screenX, screenY, workshopState.camera);

    const hitId = hitTestAgentAtWorld(worldPos.x, worldPos.y);
    const hitElementId = hitId ? null : hitTestElementAtWorld(worldPos.x, worldPos.y);

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
        sendFsmEvent(hitId, 'pickUp');
        physics.makeAgentKinematic(hitId);
        canvasContainer.style.cursor = 'grabbing';
      }
    } else if (hitElementId) {
      isDraggingElement = true;
      draggedInstanceId = hitElementId;
      canvasContainer.style.cursor = 'grabbing';
    } else {
      isPanning = true;
      canvasContainer.style.cursor = 'move';
    }

    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    pointerDownX = e.clientX;
    pointerDownY = e.clientY;

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
    } else if (isDraggingElement && draggedInstanceId) {
      const rect = canvasContainer.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const worldPos = screenToWorld(screenX, screenY, workshopState.camera);

      physics.setElementPosition(draggedInstanceId, worldPos.x, worldPos.y);
      elementSprites.updateElementSpritePosition(draggedInstanceId, worldPos.x, worldPos.y);
      updateElementPosition(draggedInstanceId, worldPos.x, worldPos.y);
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

      sendFsmEvent(draggedInstanceId, 'putDown');
      autoSave();
    } else if (isDraggingElement && draggedInstanceId) {
      // Check if it was just a click (no significant movement) — open overlay
      const moved = Math.abs(e.clientX - pointerDownX) + Math.abs(e.clientY - pointerDownY);
      if (moved < 5) {
        const el = workshopState.elements[draggedInstanceId];
        if (el) {
          activeOverlay = { elementId: draggedInstanceId, type: el.type };
        }
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
    isDraggingElement = false;
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
    } else {
      const hitElementId = hitTestElementAtWorld(worldPos.x, worldPos.y);
      if (hitElementId) {
        const el = workshopState.elements[hitElementId];
        if (el) {
          elementContextMenu = {
            instanceId: hitElementId,
            label: el.label,
            x: e.clientX,
            y: e.clientY,
          };
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Drag & drop from toolbar
  // ---------------------------------------------------------------------------

  function handleDragOver(e: DragEvent) {
    if (
      e.dataTransfer?.types.includes('application/workshop-agent') ||
      e.dataTransfer?.types.includes('application/workshop-element')
    ) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }

  async function handleDrop(e: DragEvent) {
    if (!canvasContainer) return;
    e.preventDefault();

    // Handle element drops
    const elementRaw = e.dataTransfer?.getData('application/workshop-element');
    if (elementRaw) {
      let data: { type: ElementType; label: string };
      try {
        data = JSON.parse(elementRaw);
      } catch { return; }

      const rect = canvasContainer.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const worldPos = screenToWorld(screenX, screenY, workshopState.camera);

      const instanceId = addElement(data.type, worldPos.x, worldPos.y, data.label);
      physics.addElementBody(instanceId, worldPos.x, worldPos.y);
      if (worldContainer) {
        elementSprites.createElementSprite(
          instanceId, data.type, data.label,
          worldPos.x, worldPos.y, worldContainer,
        );
      }
      autoSave();
      return;
    }

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
    createAgentFsm(instanceId, 'stationary');

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

      // Sync FSM state with the behavior change
      const fsmEvent = behavior === 'wander' ? 'wander' : behavior === 'patrol' ? 'patrol' : 'stop';
      sendFsmEvent(instanceId, fsmEvent as 'wander' | 'patrol' | 'stop');

      // All behaviors use kinematic bodies; simulation.ts drives wander/patrol
      // positions via setAgentPosition each tick. Ensure body is kinematic.
      physics.makeAgentKinematic(instanceId);

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
    } else if (action === 'quickBanter') {
      const payload = data as { targetInstanceId: string } | undefined;
      if (!payload?.targetInstanceId) return;
      launchQuickBanter(instanceId, payload.targetInstanceId);
    }

    contextMenu = null;
  }

  // ---------------------------------------------------------------------------
  // Element context menu action handler
  // ---------------------------------------------------------------------------

  function handleElementContextAction(action: string) {
    if (!elementContextMenu) return;
    const { instanceId } = elementContextMenu;

    if (action === 'open') {
      const el = workshopState.elements[instanceId];
      if (el) {
        activeOverlay = { elementId: instanceId, type: el.type };
      }
    } else if (action === 'remove') {
      elementSprites.removeElementSprite(instanceId);
      physics.removeElementBody(instanceId);
      removeElement(instanceId);
      autoSave();
    }

    elementContextMenu = null;
  }

  /** Start a banter conversation immediately without a dialog prompt. */
  function launchQuickBanter(instanceIdA: string, instanceIdB: string) {
    if (!conn.connected) return;
    const activeCount = Object.values(workshopState.conversations).filter(
      (c) => c.status === 'active'
    ).length;
    if (activeCount >= workshopState.settings.maxConcurrentConversations) return;
    const handle = startWorkshopConversation(
      [instanceIdA, instanceIdB],
      workshopState.settings.banterPrompt,
      workshopState.settings.banterMaxTurns,
    );
    if (handle) {
      activeHandles.set(handle.conversationId, handle);
      sidebarOpen = true;
      selectedConversationId = handle.conversationId;
    }
  }

  function handleTaskPromptSubmit() {
    if (!taskPromptDialog) return;

    const { instanceId, targetInstanceId, mode } = taskPromptDialog;
    const prompt =
      taskPromptInput.trim() ||
      (mode === 'assign' ? workshopState.settings.taskPrompt : workshopState.settings.banterPrompt);

    if (mode === 'assign') {
      const handle = assignTask(instanceId, prompt);
      if (handle) {
        activeHandles.set(handle.conversationId, handle);
        sidebarOpen = true;
      selectedConversationId = handle.conversationId;
      }
    } else if (mode === 'conversation' && targetInstanceId) {
      const handle = startWorkshopConversation(
        [instanceId, targetInstanceId],
        prompt,
      );
      if (handle) {
        activeHandles.set(handle.conversationId, handle);
        sidebarOpen = true;
      selectedConversationId = handle.conversationId;
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
      // Show a speech bubble for this message
      const inst = workshopState.agents[msg.instanceId];
      if (inst) {
        // Truncate long messages for speech bubble display
        const bubbleText = msg.message.length > 120
          ? msg.message.slice(0, 117) + '...'
          : msg.message;

        speechBubbles = [...speechBubbles, {
          id: `ws_${Date.now()}_${msg.instanceId}`,
          message: bubbleText,
          agentName: resolveAgentName(inst.agentId),
          instanceId: msg.instanceId,
        }];
      }
    });

    async function init() {
      const pixiApp = new PIXI.Application();
      await pixiApp.init({
        background: 0x000000,
        backgroundAlpha: 0,
        resizeTo: node,
        antialias: true,
        preferWebGLVersion: 2,
        powerPreference: 'default' as GPUPowerPreference,
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

      // Handle WebGL context loss/restore (e.g. during HMR or GPU pressure)
      canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        console.warn('[Workshop] WebGL context lost — pausing simulation');
        stopSimulation();
      });
      canvas.addEventListener('webglcontextrestored', () => {
        console.info('[Workshop] WebGL context restored — resuming');
        startSimulation();
      });

      worldContainer = new PIXI.Container();
      app.stage.addChild(worldContainer);

      await physics.initPhysics();

      await rebuildScene();

      // Wire idle-banter: simulation fires this when nearby agents are idle
      setBanterCallback((a, b) => launchQuickBanter(a, b));

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
        setBanterCallback(null);
        window.removeEventListener('workshop:reload', handleReload);
        stopSimulation();
        physics.destroyPhysics();
        agentSprites.clearAllSprites();
        elementSprites.clearAllElementSprites();
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

  <!-- HTML Overlay: speech bubbles + conversation indicators -->
  <div class="absolute inset-0 pointer-events-none overflow-hidden">
    {#each speechBubbles as bubble (bubble.id)}
      {@const agent = workshopState.agents[bubble.instanceId]}
      {#if agent}
        {@const screenPos = worldToScreen(agent.position.x, agent.position.y, workshopState.camera)}
        <SpeechBubble
          message={bubble.message}
          agentName={bubble.agentName}
          screenX={screenPos.x}
          screenY={screenPos.y}
          onFaded={() => removeBubble(bubble.id)}
        />
      {/if}
    {/each}

    <!-- Conversation indicators between agent pairs -->
    {#each Object.values(workshopState.conversations).filter(c => c.status === 'active') as conv (conv.id)}
      {#if conv.participantInstanceIds.length >= 2}
        {@const instA = workshopState.agents[conv.participantInstanceIds[0]]}
        {@const instB = workshopState.agents[conv.participantInstanceIds[1]]}
        {#if instA && instB}
          {@const midWorldX = (instA.position.x + instB.position.x) / 2}
          {@const midWorldY = Math.min(instA.position.y, instB.position.y) - 30}
          {@const screenPos = worldToScreen(midWorldX, midWorldY, workshopState.camera)}
          <ConversationIndicator
            x={screenPos.x}
            y={screenPos.y}
            type={conv.type}
            onclick={() => { sidebarOpen = true; selectedConversationId = conv.id; }}
          />
        {/if}
      {/if}
    {/each}

    <!-- Thinking/typing indicators -->
    {#each Object.keys(thinkingAgents) as instanceId (instanceId)}
      {@const agent = workshopState.agents[instanceId]}
      {#if agent}
        {@const pos = worldToScreen(agent.position.x, agent.position.y, workshopState.camera)}
        <div
          class="absolute pointer-events-none z-20 thinking-indicator"
          style="left: {pos.x}px; top: {pos.y - 55}px; transform: translateX(-50%);"
        >
          <div class="flex items-center gap-0.5 px-2 py-1 rounded-full bg-bg2/80 backdrop-blur border border-border/50">
            <span class="thinking-dot w-1.5 h-1.5 rounded-full bg-accent"></span>
            <span class="thinking-dot w-1.5 h-1.5 rounded-full bg-accent" style="animation-delay: 0.2s"></span>
            <span class="thinking-dot w-1.5 h-1.5 rounded-full bg-accent" style="animation-delay: 0.4s"></span>
          </div>
        </div>
      {/if}
    {/each}
  </div>

  <!-- Conversations toggle button -->
  {#if Object.keys(workshopState.conversations).length > 0}
    {@const activeCount = Object.values(workshopState.conversations).filter(c => c.status === 'active').length}
    <button
      class="absolute top-3 right-3 z-40 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-bg2/90 backdrop-blur border border-border text-[10px] font-mono text-foreground hover:bg-accent/10 hover:border-accent/30 transition-all"
      onclick={() => { sidebarOpen = !sidebarOpen; }}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
      Chats
      {#if activeCount > 0}
        <span class="flex items-center justify-center w-4 h-4 rounded-full bg-green-500/20 text-green-400 text-[9px]">
          {activeCount}
        </span>
      {/if}
    </button>
  {/if}

  <!-- Context Menu -->
  {#if contextMenu}
    <ContextMenu
      instanceId={contextMenu.instanceId}
      agentName={contextMenu.agentName}
      x={contextMenu.x}
      y={contextMenu.y}
      nearbyAgents={getNearbyAgentsList(contextMenu.instanceId)}
      currentBehavior={workshopState.agents[contextMenu.instanceId]?.behavior ?? 'stationary'}
      isConnected={conn.connected}
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

  <!-- Conversation Sidebar -->
  {#if sidebarOpen}
    <ConversationSidebar
      {selectedConversationId}
      onSelectConversation={(id) => { selectedConversationId = id; }}
      onClose={() => { sidebarOpen = false; }}
    />
  {/if}

  <!-- Element Context Menu -->
  {#if elementContextMenu}
    <ElementContextMenu
      label={elementContextMenu.label}
      x={elementContextMenu.x}
      y={elementContextMenu.y}
      onClose={() => (elementContextMenu = null)}
      onAction={handleElementContextAction}
    />
  {/if}

  <!-- Element Overlays -->
  {#if activeOverlay}
    {#if activeOverlay.type === 'pinboard'}
      <PinboardOverlay
        elementId={activeOverlay.elementId}
        onClose={() => (activeOverlay = null)}
      />
    {:else if activeOverlay.type === 'messageboard'}
      <MessageBoardOverlay
        elementId={activeOverlay.elementId}
        onClose={() => (activeOverlay = null)}
      />
    {:else if activeOverlay.type === 'inbox'}
      <InboxOverlay
        elementId={activeOverlay.elementId}
        onClose={() => (activeOverlay = null)}
      />
    {:else if activeOverlay.type === 'rulebook'}
      <RulebookOverlay
        elementId={activeOverlay.elementId}
        onClose={() => (activeOverlay = null)}
      />
    {/if}
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
            onclick={handleTaskPromptSubmit}
          >
            {taskPromptDialog.mode === 'assign' ? 'Send' : 'Start'}
          </button>
        </div>
        <p class="text-[9px] text-muted mt-2">Leave blank to use a default prompt · Cmd/Ctrl+Enter</p>
      </div>
    </div>
  {/if}
</div>

<style>
  .thinking-dot {
    animation: thinking-bounce 1.4s infinite ease-in-out;
  }

  @keyframes thinking-bounce {
    0%, 80%, 100% { opacity: 0.25; transform: scale(0.8); }
    40% { opacity: 1; transform: scale(1.2); }
  }
</style>
