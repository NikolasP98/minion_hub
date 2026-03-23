<script lang="ts">
    import { untrack } from "svelte";
    import * as PIXI from "pixi.js";
    import * as physics from "$lib/workshop/physics";
    import * as renderer from "$lib/workshop/renderer-adapter";
    import {
        ELEMENT_WIDTH,
        ELEMENT_HEIGHT,
    } from "$lib/workshop/renderer-adapter";
    import {
        startSimulation,
        stopSimulation,
        setBanterCallback,
        removeAgentFromSimulation,
        setRopeContainer,
        clearConversationRopes,
        simConfig,
    } from "$lib/workshop/simulation";
    import {
        screenToWorld,
        worldToScreen,
        applyZoom,
        applyPan,
    } from "$lib/workshop/camera";
    import {
        createAgentFsm,
        destroyAgentFsm,
        sendFsmEvent,
        clearAllFsms,
    } from "$lib/workshop/agent-fsm";
    import {
        checkElementChanges,
        resetWatcher,
    } from "$lib/workshop/element-watcher";
    import { clearAllQueues } from "$lib/workshop/agent-queue";
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
        registerThumbnailProvider,
        unregisterThumbnailProvider,
        setViewMode,
    } from "$lib/state/workshop/workshop.svelte";
    import type { ElementType } from "$lib/state/workshop/workshop.svelte";
    import { findNearbyAgents } from "$lib/workshop/proximity";
    import { gw } from "$lib/state/gateway/gateway-data.svelte";
    import { conn } from "$lib/state/gateway/connection.svelte";
    import { hostsState } from "$lib/state/features/hosts.svelte";
    import {
        startWorkshopConversation,
        assignTask,
        onWorkshopMessage,
        resumeInterruptedConversations,
        type WorkshopMessage,
    } from "$lib/workshop/gateway-bridge";
    import SpeechBubble from "./SpeechBubble.svelte";
    import ContextMenu from "./ContextMenu.svelte";
    import RelationshipPrompt from "./RelationshipPrompt.svelte";
    import ConversationSidebar from "./ConversationSidebar.svelte";
    import ConversationIndicator from "./ConversationIndicator.svelte";
    import ElementContextMenu from "./ElementContextMenu.svelte";
    import PinboardOverlay from "./PinboardOverlay.svelte";
    import MessageBoardOverlay from "./MessageBoardOverlay.svelte";
    import InboxOverlay from "./InboxOverlay.svelte";
    import RulebookOverlay from "./RulebookOverlay.svelte";
    import PortalOverlay from "./PortalOverlay.svelte";
    import { thinkingAgents } from "$lib/state/workshop/workshop-conversations.svelte";
    import DebugOverlay from "./DebugOverlay.svelte";
    import ToggleSwitch from "$lib/components/config/ToggleSwitch.svelte";
    import { OfficeState } from "$lib/workshop/pixel/office-state";
    import { startGameLoop } from "$lib/workshop/pixel/game-loop";
    import { renderFrame as pixelRenderFrame } from "$lib/workshop/pixel/renderer";
    import { pixelOfficeState, loadPixelOffice, autoSavePixelOffice } from "$lib/state/workshop/pixel-office.svelte";
    import { loadPixelOfficeAssets } from "$lib/workshop/pixel/asset-loader";
    import {
        syncAgentState,
        syncAgentList,
        clearMappings,
        allocateCharId,
        registerMapping,
        getInstanceForCharId,
        startToolCallListener,
        startSubagentListener,
    } from "$lib/workshop/pixel/gateway-pixel-bridge";
    import type { OfficeLayout } from "$lib/workshop/pixel/types";

    // ---------------------------------------------------------------------------
    // PixiJS state (not reactive - managed imperatively within onMount)
    // ---------------------------------------------------------------------------

    let app: PIXI.Application | null = null;
    let worldContainer: PIXI.Container | null = null;
    let canvasContainer: HTMLDivElement | null = null;

    // ---------------------------------------------------------------------------
    // Pixel office state
    // ---------------------------------------------------------------------------

    let pixelCanvas: HTMLCanvasElement | null = null;
    let pixelOffice: OfficeState | null = null;
    let stopPixelLoop: (() => void) | null = null;
    let cleanupToolListener: (() => void) | null = null;
    let cleanupSubagentListener: (() => void) | null = null;
    let pixelPanX = 0;
    let pixelPanY = 0;
    let pixelInitializing = false;

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
        Array<{
            id: string;
            message: string;
            agentName: string;
            instanceId: string;
        }>
    >([]);

    // Task prompt dialog state
    let taskPromptDialog = $state<{
        instanceId: string;
        targetInstanceId?: string; // set for "Start conversation with..."
        agentName: string;
        mode: "assign" | "conversation";
    } | null>(null);
    let taskPromptInput = $state("");

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

    let debugMode = $state(
        typeof localStorage !== "undefined"
            ? localStorage.getItem("workshop:debugMode") === "true"
            : false,
    );

    let showChatRopes = $state(
        typeof localStorage !== "undefined"
            ? localStorage.getItem("workshop:showChatRopes") !== "false"
            : true,
    );
    let showRelationshipRopes = $state(
        typeof localStorage !== "undefined"
            ? localStorage.getItem("workshop:showRelationshipRopes") !== "false"
            : true,
    );
    let configOpen = $state(false);

    // Keep simConfig in sync with local state
    $effect(() => {
        simConfig.showChatRopes = showChatRopes;
        simConfig.showRelationshipRopes = showRelationshipRopes;
    });

    // Performance metrics (only runs while debugMode is on)
    let perfFps = $state(0);
    let perfFrameMs = $state(0);
    let perfHeapMB = $state<number | null>(null);

    $effect(() => {
        if (!configOpen) return;
        let rafId: number;
        let frameCount = 0;
        let lastSecond = performance.now();
        let lastFrame = performance.now();

        function tick() {
            const now = performance.now();
            perfFrameMs = Math.round(now - lastFrame);
            lastFrame = now;
            frameCount++;
            if (now - lastSecond >= 1000) {
                perfFps = Math.round((frameCount * 1000) / (now - lastSecond));
                frameCount = 0;
                lastSecond = now;
                const p = performance as Performance & {
                    memory?: { usedJSHeapSize: number };
                };
                if (p.memory)
                    perfHeapMB = Math.round(
                        p.memory.usedJSHeapSize / 1_048_576,
                    );
            }
            rafId = requestAnimationFrame(tick);
        }
        rafId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafId);
    });

    // ---------------------------------------------------------------------------
    // Hide/show agents based on connection state
    // ---------------------------------------------------------------------------

    $effect(() => {
        if (!conn.connected) {
            renderer.clearAllSprites();
            renderer.clearAllElementSprites();
            renderer.clearAllRopes();
        } else {
            untrack(() => {
                autoLoad(hostsState.activeHostId);
                rebuildScene();
            });
        }
    });

    // ---------------------------------------------------------------------------
    // View mode switch (classic ↔ habbo ↔ pixel)
    // ---------------------------------------------------------------------------

    function teardownPixelOffice(): void {
        if (stopPixelLoop) {
            stopPixelLoop();
            stopPixelLoop = null;
        }
        if (cleanupToolListener) {
            cleanupToolListener();
            cleanupToolListener = null;
        }
        if (cleanupSubagentListener) {
            cleanupSubagentListener();
            cleanupSubagentListener = null;
        }
        if (pixelResizeObserver) {
            pixelResizeObserver.disconnect();
            pixelResizeObserver = null;
        }
        clearMappings();
        pixelOffice = null;
        if (pixelCanvas) {
            pixelCanvas.style.display = "none";
        }
    }

    /** Resize the pixel canvas buffer to match its CSS display size */
    function resizePixelCanvas(): void {
        if (!pixelCanvas) return;
        // Use the canvas's own rendered size (set by CSS absolute inset-0 w-full h-full)
        let w = pixelCanvas.clientWidth;
        let h = pixelCanvas.clientHeight;
        // Fallback: if clientWidth is the default 300, try offsetWidth or parent
        if ((w <= 300 && h <= 150) || w === 0 || h === 0) {
            const parent = pixelCanvas.parentElement;
            if (parent) {
                w = parent.clientWidth;
                h = parent.clientHeight;
            }
        }
        if (w === 0 || h === 0) return;
        // Only update if buffer size differs from display size
        if (pixelCanvas.width !== w || pixelCanvas.height !== h) {
            pixelCanvas.width = w;
            pixelCanvas.height = h;
        }
    }

    let pixelResizeObserver: ResizeObserver | null = null;

    /** Assets are loaded once and cached — no need to reload on every mode switch */
    let pixelAssetsLoaded = false;

    async function initPixelOffice(): Promise<void> {
        if (!pixelCanvas || !canvasContainer) return;
        if (pixelInitializing) return; // guard against duplicate init
        pixelInitializing = true;

        try {
            // Load layout from persistence or fetch default
            const hostId = hostsState.activeHostId;
            if (hostId) loadPixelOffice(hostId);

            if (!pixelOfficeState.layout) {
                try {
                    const resp = await fetch("/pixel-office/default-layout-1.json");
                    const layout: OfficeLayout = await resp.json();
                    pixelOfficeState.layout = layout;
                } catch (e) {
                    console.warn("[Workshop Pixel] Failed to load default layout:", e);
                    return;
                }
            }

            // Show canvas and wait for layout
            pixelCanvas.style.display = "block";
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
            resizePixelCanvas();

            pixelResizeObserver = new ResizeObserver(() => resizePixelCanvas());
            pixelResizeObserver.observe(pixelCanvas);

            // Load sprite assets once (cached across mode switches)
            if (!pixelAssetsLoaded) {
                await loadPixelOfficeAssets();
                pixelAssetsLoaded = true;
            }

            // Create the office state from layout
            pixelOffice = new OfficeState(pixelOfficeState.layout);

            // Map workshop agents to pixel characters via the bridge
            // D-17: Initial load — agents appear directly at seats, no entrance walk
            clearMappings();
            const agentInstances = Object.entries(workshopState.agents);
            if (agentInstances.length > 0) {
                syncAgentList(pixelOffice, true);
            } else {
                // No agents connected — add demo characters that wander
                for (let i = 0; i < 3; i++) {
                    const charId = allocateCharId();
                    registerMapping(`demo-${i}`, charId);
                    pixelOffice.addAgent(charId);
                    // Set demo chars to inactive so they'll start wandering
                    const ch = pixelOffice.characters.get(charId);
                    if (ch) {
                        ch.isActive = false;
                        ch.seatTimer = 1 + i * 2; // stagger wander start
                    }
                }
            }

            // Auto-compute zoom to fit the non-VOID portion
            const layout = pixelOfficeState.layout;
            const TP = 16; // TILE_SIZE
            let minR = layout.rows, maxR = 0, minC = layout.cols, maxC = 0;
            for (let r = 0; r < layout.rows; r++) {
                for (let c = 0; c < layout.cols; c++) {
                    if (layout.tiles[r * layout.cols + c] !== 255) {
                        minR = Math.min(minR, r);
                        maxR = Math.max(maxR, r);
                        minC = Math.min(minC, c);
                        maxC = Math.max(maxC, c);
                    }
                }
            }
            const contentW = (maxC - minC + 1) * TP;
            const contentH = (maxR - minR + 1) * TP;
            const fitZoomW = Math.floor((pixelCanvas.width * 0.95) / contentW);
            const fitZoomH = Math.floor((pixelCanvas.height * 0.95) / contentH);
            const autoZoom = Math.max(1, Math.min(fitZoomW, fitZoomH, 8));
            pixelOfficeState.settings.zoomLevel = autoZoom;

            // Auto-pan to center on content
            const mapW = layout.cols * TP * autoZoom;
            const mapH = layout.rows * TP * autoZoom;
            const ccx = ((minC + maxC + 1) / 2) * TP * autoZoom;
            const ccy = ((minR + maxR + 1) / 2) * TP * autoZoom;
            const bx = Math.floor((pixelCanvas.width - mapW) / 2);
            const by = Math.floor((pixelCanvas.height - mapH) / 2);
            pixelPanX = Math.round(pixelCanvas.width / 2 - ccx - bx);
            pixelPanY = Math.round(pixelCanvas.height / 2 - ccy - by);

            console.info(`[Workshop Pixel] ${layout.cols}×${layout.rows} grid, zoom=${autoZoom}, ${Object.keys(workshopState.agents).length} agents`);

            // Start the render loop
            stopPixelLoop = startGameLoop(pixelCanvas, {
                update: (dt) => {
                    if (!pixelOffice) return;
                    // Sync gateway agent state → pixel character state
                    // isInitialLoad=false: runtime connects spawn at entrance tile (D-14)
                    syncAgentList(pixelOffice, false);
                    syncAgentState(pixelOffice);
                    pixelOffice.update(dt);
                },
                render: (ctx) => {
                    if (!pixelOffice || !pixelCanvas) return;
                    resizePixelCanvas();
                    ctx.imageSmoothingEnabled = false;
                    const office = pixelOffice;
                    const z = pixelOfficeState.settings.zoomLevel;
                    const sel = office.selectedAgentId !== null ? {
                        selectedAgentId: office.selectedAgentId,
                        hoveredAgentId: office.hoveredAgentId,
                        hoveredTile: office.hoveredTile,
                        seats: office.seats,
                        characters: office.characters,
                    } : undefined;
                    pixelRenderFrame(
                        ctx,
                        pixelCanvas.width,
                        pixelCanvas.height,
                        office.tileMap,
                        office.furniture,
                        office.getCharacters(),
                        z,
                        pixelPanX,
                        pixelPanY,
                        sel,
                        undefined,
                        office.layout.tileColors,
                        office.layout.cols,
                        office.layout.rows,
                    );
                },
            });

            // Wire real-time event listeners (GATE-03, GATE-05, D-09)
            cleanupToolListener = startToolCallListener(pixelOffice);
            cleanupSubagentListener = startSubagentListener(pixelOffice);
        } finally {
            pixelInitializing = false;
        }
    }

    let prevViewMode: string | null = null;

    $effect(() => {
        const mode = workshopState.settings.viewMode; // subscribe to viewMode
        untrack(() => {
            if (!app || !worldContainer) return;
            // Skip if mode hasn't actually changed
            if (mode === prevViewMode) return;
            const wasPixel = prevViewMode === "pixel";
            prevViewMode = mode;

            // Tear down pixel office only if switching AWAY from pixel
            if (wasPixel) teardownPixelOffice();

            if (mode === "pixel") {
                // Hide PixiJS canvas, show pixel canvas
                const pixi = app.canvas as HTMLCanvasElement;
                pixi.style.display = "none";
                initPixelOffice();
            } else {
                // Show PixiJS canvas
                const pixi = app.canvas as HTMLCanvasElement;
                pixi.style.display = "block";

                pixi.style.transition = "opacity 120ms ease-out";
                pixi.style.opacity = "0";

                setTimeout(() => {
                    renderer.destroyRenderer();
                    renderer.initRenderer(app!, worldContainer!);
                    rebuildScene();

                    requestAnimationFrame(() => {
                        pixi.style.opacity = "1";
                        setTimeout(() => {
                            pixi.style.transition = "";
                        }, 140);
                    });
                }, 130);
            }
        });
    });

    // Watch for element content changes and enqueue agent actions.
    // Explicitly access each tracked field so Svelte 5 creates reactive
    // dependencies on nested properties — `void workshopState.elements` alone
    // only subscribes to the parent source and misses in-place mutations.
    $effect(() => {
        for (const el of Object.values(workshopState.elements)) {
            void el.messageBoardContent;
            void el.rulebookContent;
            void el.pinboardItems?.length;
            void el.inboxItems?.length;
        }
        checkElementChanges();
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

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    /**
     * Convert world coordinates to CSS screen pixels, accounting for the
     * current view mode. In classic mode this is just zoom+pan. In habbo mode
     * the world coords are first iso-projected, then zoom+pan is applied.
     */
    function worldToScreenAware(
        worldX: number,
        worldY: number,
    ): { x: number; y: number } {
        const inWorld = renderer.worldToScreenForMode(worldX, worldY);
        return worldToScreen(inWorld.x, inWorld.y, workshopState.camera);
    }

    /**
     * Convert CSS screen pixels to true world coordinates, accounting for the
     * current view mode. In classic mode this is just reverse zoom+pan. In habbo
     * mode the worldContainer-local coords are reverse-iso-projected to get
     * true world coords suitable for physics/state.
     */
    function screenToWorldAware(
        screenX: number,
        screenY: number,
    ): { x: number; y: number } {
        const local = screenToWorld(screenX, screenY, workshopState.camera);
        return renderer.containerLocalToWorld(local.x, local.y);
    }

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

    function hitTestAgentAtWorld(
        worldX: number,
        worldY: number,
    ): string | null {
        return renderer.hitTestAgentAtWorld(worldX, worldY);
    }

    function hitTestElementAtWorld(
        worldX: number,
        worldY: number,
    ): string | null {
        return renderer.hitTestElementAtWorld(worldX, worldY);
    }

    function syncCamera() {
        if (!worldContainer) return;
        worldContainer.x = workshopState.camera.x;
        worldContainer.y = workshopState.camera.y;
        worldContainer.scale.set(workshopState.camera.zoom);
    }

    function getNearbyAgentsList(
        instanceId: string,
    ): Array<{ instanceId: string; name: string }> {
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

        renderer.clearAllSprites();
        renderer.clearAllElementSprites();
        renderer.clearAllRopes();
        clearConversationRopes();
        clearAllFsms();
        resetWatcher();
        clearAllQueues();

        for (const [instanceId, inst] of Object.entries(workshopState.agents)) {
            // Bail out if a newer rebuildScene started while we were awaiting
            if (thisVersion !== rebuildVersion) return;

            physics.addAgentBody(instanceId, inst.position.x, inst.position.y);

            await renderer.createAgentSprite(
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

        for (const [relId, rel] of Object.entries(
            workshopState.relationships,
        )) {
            physics.addSpringJoint(relId, rel.fromInstanceId, rel.toInstanceId);
            renderer.createRope(relId, rel.label, worldContainer);
        }

        // Rebuild element sprites
        for (const [instanceId, el] of Object.entries(workshopState.elements)) {
            if (thisVersion !== rebuildVersion) return;
            physics.addElementBody(instanceId, el.position.x, el.position.y);
            const itemCount =
                el.type === "pinboard"
                    ? (el.pinboardItems?.length ?? 0)
                    : el.type === "inbox"
                      ? (el.inboxItems?.filter((i) => !i.read).length ?? 0)
                      : 0;
            renderer.createElementSprite(
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
        for (const [relId, rel] of Object.entries(
            workshopState.relationships,
        )) {
            if (
                rel.fromInstanceId === instanceId ||
                rel.toInstanceId === instanceId
            ) {
                physics.removeSpringJoint(relId);
                renderer.removeRope(relId);
            }
        }

        physics.removeAgentBody(instanceId);
        renderer.removeAgentSprite(instanceId);
        destroyAgentFsm(instanceId);
        removeAgentFromSimulation(instanceId);
        removeAgentInstance(instanceId);
        autoSave();
    }

    // ---------------------------------------------------------------------------
    // Pointer event handlers
    // ---------------------------------------------------------------------------

    // ---------------------------------------------------------------------------
    // Pixel mode: pan state for middle-mouse drag
    // ---------------------------------------------------------------------------
    let pixelPanStartX = 0;
    let pixelPanStartY = 0;
    let pixelPanDragStartX = 0;
    let pixelPanDragStartY = 0;
    let isPixelPanning = false;

    function handlePointerDown(e: PointerEvent) {
        if (!canvasContainer) return;

        // Pixel mode: any mouse button starts panning
        if (workshopState.settings.viewMode === "pixel") {
            if (e.button === 0 || e.button === 1) {
                isPixelPanning = true;
                pixelPanStartX = pixelPanX;
                pixelPanStartY = pixelPanY;
                pixelPanDragStartX = e.clientX;
                pixelPanDragStartY = e.clientY;
                (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
                if (pixelCanvas) pixelCanvas.style.cursor = "grabbing";
                e.preventDefault();
            }
            return;
        }

        if (contextMenu || elementContextMenu) {
            contextMenu = null;
            elementContextMenu = null;
            return;
        }

        const rect = canvasContainer.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const worldPos = screenToWorldAware(screenX, screenY);

        const hitId = hitTestAgentAtWorld(worldPos.x, worldPos.y);
        const hitElementId = hitId
            ? null
            : hitTestElementAtWorld(worldPos.x, worldPos.y);

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
                sendFsmEvent(hitId, "pickUp");
                physics.makeAgentKinematic(hitId);
                canvasContainer.style.cursor = "grabbing";
            }
        } else if (hitElementId) {
            isDraggingElement = true;
            draggedInstanceId = hitElementId;
            canvasContainer.style.cursor = "grabbing";
        } else {
            isPanning = true;
            canvasContainer.style.cursor = "move";
        }

        lastPointerX = e.clientX;
        lastPointerY = e.clientY;
        pointerDownX = e.clientX;
        pointerDownY = e.clientY;

        canvasContainer.setPointerCapture(e.pointerId);
    }

    function handlePointerMove(e: PointerEvent) {
        if (!canvasContainer) return;

        // Pixel mode panning
        if (isPixelPanning) {
            pixelPanX = pixelPanStartX + (e.clientX - pixelPanDragStartX);
            pixelPanY = pixelPanStartY + (e.clientY - pixelPanDragStartY);
            return;
        }
        if (workshopState.settings.viewMode === "pixel") return;

        const dx = e.clientX - lastPointerX;
        const dy = e.clientY - lastPointerY;

        if (isPanning) {
            workshopState.camera = applyPan(workshopState.camera, dx, dy);
            syncCamera();
        } else if (isDraggingAgent && draggedInstanceId) {
            const rect = canvasContainer.getBoundingClientRect();
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;
            const worldPos = screenToWorldAware(screenX, screenY);

            physics.setAgentPosition(draggedInstanceId, worldPos.x, worldPos.y);
            renderer.updateSpritePosition(
                draggedInstanceId,
                worldPos.x,
                worldPos.y,
            );
        } else if (isDraggingElement && draggedInstanceId) {
            const rect = canvasContainer.getBoundingClientRect();
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;
            const worldPos = screenToWorldAware(screenX, screenY);

            physics.setElementPosition(
                draggedInstanceId,
                worldPos.x,
                worldPos.y,
            );
            renderer.updateElementSpritePosition(
                draggedInstanceId,
                worldPos.x,
                worldPos.y,
            );
            updateElementPosition(draggedInstanceId, worldPos.x, worldPos.y);
        } else if (isLinking && linkFromInstanceId && linkLineGraphics) {
            const rect = canvasContainer.getBoundingClientRect();
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;
            const worldPos = screenToWorldAware(screenX, screenY);

            const fromSprite = renderer.getSprite(linkFromInstanceId);
            if (fromSprite) {
                // Project the pointer's world position to match the sprite's coordinate space
                const endPos = renderer.worldToScreenForMode(worldPos.x, worldPos.y);
                linkLineGraphics.clear();
                linkLineGraphics
                    .moveTo(fromSprite.x, fromSprite.y)
                    .lineTo(endPos.x, endPos.y)
                    .stroke({ width: 2, color: 0x6366f1, alpha: 0.6 });
            }
        }

        lastPointerX = e.clientX;
        lastPointerY = e.clientY;
    }

    function handlePointerUp(e: PointerEvent) {
        if (!canvasContainer) return;

        // Pixel mode: stop panning, detect clicks
        if (isPixelPanning) {
            const wasDrag = Math.abs(e.clientX - pixelPanDragStartX) > 4 ||
                            Math.abs(e.clientY - pixelPanDragStartY) > 4;
            isPixelPanning = false;
            if (pixelCanvas) pixelCanvas.style.cursor = "grab";

            // If it was a click (not drag), try to select a character
            if (!wasDrag && pixelOffice && pixelCanvas) {
                const rect = pixelCanvas.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const clickY = e.clientY - rect.top;
                const z = pixelOfficeState.settings.zoomLevel;
                const TP = 16;
                const layout = pixelOffice.layout;
                // Convert screen coords to tile coords
                const mapW = layout.cols * TP * z;
                const mapH = layout.rows * TP * z;
                const ox = Math.floor((pixelCanvas.width - mapW) / 2) + pixelPanX;
                const oy = Math.floor((pixelCanvas.height - mapH) / 2) + pixelPanY;
                const worldX = (clickX - ox) / z;
                const worldY = (clickY - oy) / z;

                // Find character at this world position
                let hitCharId: number | null = null;
                for (const ch of pixelOffice.characters.values()) {
                    const dx = Math.abs(ch.x - worldX);
                    const dy = Math.abs(ch.y - worldY);
                    if (dx < 8 && dy < 16) { // ~half character width/height
                        hitCharId = ch.id;
                        break;
                    }
                }

                if (hitCharId !== null) {
                    const instanceId = getInstanceForCharId(hitCharId);
                    if (instanceId) {
                        // Select character in pixel office (show outline)
                        pixelOffice.selectedAgentId = hitCharId;
                    }
                } else {
                    pixelOffice.selectedAgentId = null;
                }
            }
            return;
        }
        if (workshopState.settings.viewMode === "pixel") return;

        canvasContainer.releasePointerCapture(e.pointerId);
        canvasContainer.style.cursor = "default";

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
            if (
                inst &&
                (inst.behavior === "wander" || inst.behavior === "patrol")
            ) {
                physics.makeAgentDynamic(draggedInstanceId);
            }

            sendFsmEvent(draggedInstanceId, "putDown");
            autoSave();
        } else if (isDraggingElement && draggedInstanceId) {
            // Check if it was just a click (no significant movement) — open overlay
            const moved =
                Math.abs(e.clientX - pointerDownX) +
                Math.abs(e.clientY - pointerDownY);
            if (moved < 5) {
                const el = workshopState.elements[draggedInstanceId];
                if (el) {
                    activeOverlay = {
                        elementId: draggedInstanceId,
                        type: el.type,
                    };
                }
            }
            autoSave();
        } else if (isLinking && linkFromInstanceId) {
            const rect = canvasContainer.getBoundingClientRect();
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;
            const worldPos = screenToWorldAware(screenX, screenY);

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

        // Pixel mode: integer zoom with pivot-preserving pan adjustment
        if (workshopState.settings.viewMode === "pixel" && pixelCanvas && pixelOffice) {
            const oldZoom = pixelOfficeState.settings.zoomLevel;
            const newZoom = e.deltaY > 0
                ? Math.max(1, oldZoom - 1)
                : Math.min(8, oldZoom + 1);
            if (newZoom === oldZoom) return;

            const rect = pixelCanvas.getBoundingClientRect();
            const cursorX = e.clientX - rect.left;
            const cursorY = e.clientY - rect.top;
            const cw = pixelCanvas.width;
            const ch = pixelCanvas.height;
            const layout = pixelOffice.layout;
            const TP = 16;

            // Compute the old and new centering offsets
            const oldMapW = layout.cols * TP * oldZoom;
            const oldMapH = layout.rows * TP * oldZoom;
            const newMapW = layout.cols * TP * newZoom;
            const newMapH = layout.rows * TP * newZoom;
            const oldBaseX = Math.floor((cw - oldMapW) / 2);
            const oldBaseY = Math.floor((ch - oldMapH) / 2);
            const newBaseX = Math.floor((cw - newMapW) / 2);
            const newBaseY = Math.floor((ch - newMapH) / 2);

            // World point under cursor: worldX = (cursorX - oldBaseX - pixelPanX) / oldZoom
            // After zoom: cursorX = newBaseX + newPanX + worldX * newZoom
            // newPanX = cursorX - newBaseX - worldX * newZoom
            const worldX = (cursorX - oldBaseX - pixelPanX) / oldZoom;
            const worldY = (cursorY - oldBaseY - pixelPanY) / oldZoom;
            pixelPanX = Math.round(cursorX - newBaseX - worldX * newZoom);
            pixelPanY = Math.round(cursorY - newBaseY - worldY * newZoom);

            pixelOfficeState.settings.zoomLevel = newZoom;
            return;
        }

        const rect = canvasContainer.getBoundingClientRect();
        const pivotX = e.clientX - rect.left;
        const pivotY = e.clientY - rect.top;

        workshopState.camera = applyZoom(
            workshopState.camera,
            e.deltaY,
            pivotX,
            pivotY,
        );
        syncCamera();
        autoSave();
    }

    function handleContextMenu(e: MouseEvent) {
        if (!canvasContainer) return;
        e.preventDefault();

        const rect = canvasContainer.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const worldPos = screenToWorldAware(screenX, screenY);

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
            e.dataTransfer?.types.includes("application/workshop-agent") ||
            e.dataTransfer?.types.includes("application/workshop-element")
        ) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
        }
    }

    async function handleDrop(e: DragEvent) {
        if (!canvasContainer) return;
        e.preventDefault();

        // Handle element drops
        const elementRaw = e.dataTransfer?.getData(
            "application/workshop-element",
        );
        if (elementRaw) {
            let data: { type: ElementType; label: string };
            try {
                data = JSON.parse(elementRaw);
            } catch {
                return;
            }

            const rect = canvasContainer.getBoundingClientRect();
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;
            const worldPos = screenToWorldAware(screenX, screenY);

            const instanceId = addElement(
                data.type,
                worldPos.x,
                worldPos.y,
                data.label,
            );
            physics.addElementBody(instanceId, worldPos.x, worldPos.y);
            if (worldContainer) {
                renderer.createElementSprite(
                    instanceId,
                    data.type,
                    data.label,
                    worldPos.x,
                    worldPos.y,
                    worldContainer,
                );
            }
            autoSave();
            return;
        }

        const raw = e.dataTransfer?.getData("application/workshop-agent");
        if (!raw) return;

        let agentData: {
            id: string;
            name?: string;
            emoji?: string;
            description?: string;
        };
        try {
            agentData = JSON.parse(raw);
        } catch {
            return;
        }

        const rect = canvasContainer.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const worldPos = screenToWorldAware(screenX, screenY);

        const instanceId = addAgentInstance(agentData.id, worldPos.x, worldPos.y);

        physics.addAgentBody(instanceId, worldPos.x, worldPos.y);
        createAgentFsm(instanceId, "stationary");

        if (worldContainer) {
            await renderer.createAgentSprite(
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

        if (action === "remove") {
            removeAgentFromCanvas(instanceId);
        } else if (action === "setBehavior") {
            const behavior = data as "stationary" | "wander" | "patrol";
            setAgentBehavior(instanceId, behavior);

            // Sync FSM state with the behavior change
            const fsmEvent =
                behavior === "wander"
                    ? "wander"
                    : behavior === "patrol"
                      ? "patrol"
                      : "stop";
            sendFsmEvent(instanceId, fsmEvent as "wander" | "patrol" | "stop");

            // All behaviors use kinematic bodies; simulation.ts drives wander/patrol
            // positions via setAgentPosition each tick. Ensure body is kinematic.
            physics.makeAgentKinematic(instanceId);

            autoSave();
        } else if (action === "assignTask") {
            if (!conn.connected) return;
            taskPromptDialog = { instanceId, agentName, mode: "assign" };
            taskPromptInput = "";
        } else if (action === "startConversation") {
            if (!conn.connected) return;
            const payload = data as { targetInstanceId: string } | undefined;
            if (!payload?.targetInstanceId) return;
            const targetInst = workshopState.agents[payload.targetInstanceId];
            const targetName = targetInst
                ? resolveAgentName(targetInst.agentId)
                : "agent";
            taskPromptDialog = {
                instanceId,
                targetInstanceId: payload.targetInstanceId,
                agentName: `${agentName} & ${targetName}`,
                mode: "conversation",
            };
            taskPromptInput = "";
        } else if (action === "quickBanter") {
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

        if (action === "open") {
            const el = workshopState.elements[instanceId];
            if (el) {
                activeOverlay = { elementId: instanceId, type: el.type };
            }
        } else if (action === "remove") {
            renderer.removeElementSprite(instanceId);
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
            (c) => c.status === "active",
        ).length;
        if (activeCount >= workshopState.settings.maxConcurrentConversations)
            return;
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
            (mode === "assign"
                ? workshopState.settings.taskPrompt
                : workshopState.settings.banterPrompt);

        if (mode === "assign") {
            const handle = assignTask(instanceId, prompt);
            if (handle) {
                activeHandles.set(handle.conversationId, handle);
                sidebarOpen = true;
                selectedConversationId = handle.conversationId;
            }
        } else if (mode === "conversation" && targetInstanceId) {
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
        taskPromptInput = "";
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

        renderer.createRope(relId, label, worldContainer);

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
                const bubbleText =
                    msg.message.length > 120
                        ? msg.message.slice(0, 117) + "..."
                        : msg.message;

                speechBubbles = [
                    ...speechBubbles,
                    {
                        id: `ws_${Date.now()}_${msg.instanceId}`,
                        message: bubbleText,
                        agentName: resolveAgentName(inst.agentId),
                        instanceId: msg.instanceId,
                    },
                ];
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
                powerPreference: "default" as GPUPowerPreference,
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
            canvas.style.display = "block";
            canvas.style.width = "100%";
            canvas.style.height = "100%";

            // Handle WebGL context loss/restore (e.g. during HMR or GPU pressure)
            canvas.addEventListener("webglcontextlost", (e) => {
                e.preventDefault();
                console.warn(
                    "[Workshop] WebGL context lost — pausing simulation",
                );
                stopSimulation();
            });
            canvas.addEventListener("webglcontextrestored", () => {
                console.info("[Workshop] WebGL context restored — resuming");
                startSimulation();
            });

            worldContainer = new PIXI.Container();
            app.stage.addChild(worldContainer);
            setRopeContainer(worldContainer);
            renderer.initRenderer(pixiApp, worldContainer);

            registerThumbnailProvider(async () => {
                if (!app || !worldContainer) return null;
                try {
                    return await app.renderer.extract.base64(worldContainer);
                } catch {
                    return null;
                }
            });

            await physics.initPhysics();

            await rebuildScene();

            // Resume any conversations that were active before the last page close
            const resumedHandles = await resumeInterruptedConversations();
            for (const handle of resumedHandles) {
                activeHandles.set(handle.conversationId, handle);
            }
            if (resumedHandles.length > 0) {
                sidebarOpen = true;
                selectedConversationId = resumedHandles[0].conversationId;
            }

            // Wire idle-banter: simulation fires this when nearby agents are idle
            setBanterCallback((a, b) => launchQuickBanter(a, b));

            startSimulation();

            window.addEventListener("workshop:reload", handleReload);
        }

        function handleReload() {
            rebuildScene();
        }

        init();

        return {
            destroy() {
                destroyed = true;
                unsubWorkshop();
                unregisterThumbnailProvider();
                setBanterCallback(null);
                setRopeContainer(null);
                window.removeEventListener("workshop:reload", handleReload);
                stopSimulation();
                clearConversationRopes();
                physics.destroyPhysics();
                renderer.destroyRenderer();

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

    <!-- Pixel office Canvas 2D (shown only in pixel viewMode, overlays the PixiJS div) -->
    <canvas
        bind:this={pixelCanvas}
        class="absolute inset-0 z-10 bg-[#1a1a2e] w-full h-full"
        style="display: none; image-rendering: pixelated; cursor: grab;"
        onpointerdown={handlePointerDown}
        onpointermove={handlePointerMove}
        onpointerup={handlePointerUp}
        onwheel={handleWheel}
        oncontextmenu={handleContextMenu}
    ></canvas>

    <!-- HTML Overlay: speech bubbles + conversation indicators -->
    <div class="absolute inset-0 pointer-events-none overflow-hidden">
        {#each speechBubbles as bubble (bubble.id)}
            {@const agent = workshopState.agents[bubble.instanceId]}
            {#if agent}
                {@const screenPos = worldToScreenAware(
                    agent.position.x,
                    agent.position.y,
                )}
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
        {#each Object.values(workshopState.conversations).filter((c) => c.status === "active") as conv (conv.id)}
            {#if conv.participantInstanceIds.length >= 2}
                {@const instA =
                    workshopState.agents[conv.participantInstanceIds[0]]}
                {@const instB =
                    workshopState.agents[conv.participantInstanceIds[1]]}
                {#if instA && instB}
                    {@const midWorldX =
                        (instA.position.x + instB.position.x) / 2}
                    {@const midWorldY =
                        Math.min(instA.position.y, instB.position.y) - 30}
                    {@const screenPos = worldToScreenAware(
                        midWorldX,
                        midWorldY,
                    )}
                    <ConversationIndicator
                        x={screenPos.x}
                        y={screenPos.y}
                        type={conv.type}
                        onclick={() => {
                            sidebarOpen = true;
                            selectedConversationId = conv.id;
                        }}
                    />
                {/if}
            {/if}
        {/each}

        <!-- Thinking/typing indicators -->
        {#each Object.keys(thinkingAgents) as instanceId (instanceId)}
            {@const agent = workshopState.agents[instanceId]}
            {#if agent}
                {@const pos = worldToScreenAware(
                    agent.position.x,
                    agent.position.y,
                )}
                <div
                    class="absolute pointer-events-none z-20 thinking-indicator"
                    style="left: {pos.x}px; top: {pos.y -
                        55}px; transform: translateX(-50%);"
                >
                    <div
                        class="flex items-center gap-0.5 px-2 py-1 rounded-full bg-bg2/80 backdrop-blur border border-border/50"
                    >
                        <span
                            class="thinking-dot w-1.5 h-1.5 rounded-full bg-accent"
                        ></span>
                        <span
                            class="thinking-dot w-1.5 h-1.5 rounded-full bg-accent"
                            style="animation-delay: 0.2s"
                        ></span>
                        <span
                            class="thinking-dot w-1.5 h-1.5 rounded-full bg-accent"
                            style="animation-delay: 0.4s"
                        ></span>
                    </div>
                </div>
            {/if}
        {/each}
    </div>

    <!-- Conversations toggle button -->
    {#if Object.keys(workshopState.conversations).length > 0}
        {@const activeCount = Object.values(workshopState.conversations).filter(
            (c) => c.status === "active",
        ).length}
        <button
            class="absolute top-3 right-3 z-40 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-bg2/90 backdrop-blur border border-border text-[10px] font-mono text-foreground hover:bg-accent/10 hover:border-accent/30 transition-all"
            onclick={() => {
                sidebarOpen = !sidebarOpen;
            }}
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
            >
                <path
                    d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                ></path>
            </svg>
            Chats
            {#if activeCount > 0}
                <span
                    class="flex items-center justify-center w-4 h-4 rounded-full bg-green-500/20 text-green-400 text-[9px]"
                >
                    {activeCount}
                </span>
            {/if}
        </button>
    {/if}

    <!-- Config panel (bottom-left) -->
    <div class="absolute bottom-3 left-3 z-40 flex flex-col items-start gap-0">
        {#if configOpen}
            {@const agentCount = Object.keys(workshopState.agents).length}
            {@const elementCount = Object.keys(workshopState.elements).length}
            {@const activeConvs = Object.values(
                workshopState.conversations,
            ).filter((c) => c.status === "active").length}
            {@const totalConvs = Object.keys(
                workshopState.conversations,
            ).length}
            <div
                class="mb-0 rounded-t bg-bg2/90 backdrop-blur border border-b-0 border-border text-[8px] font-mono p-1.5 min-w-[130px] space-y-0.5"
            >
                <!-- Stats: perf -->
                <div
                    class="text-[7px] text-muted/60 uppercase tracking-wider mb-1"
                >
                    perf
                </div>
                <div class="flex justify-between gap-3">
                    <span class="text-muted/70">fps</span>
                    <span
                        class="tabular-nums font-semibold {perfFps >= 50
                            ? 'text-green-400'
                            : perfFps >= 30
                              ? 'text-yellow-400'
                              : 'text-red-400'}">{perfFps}</span
                    >
                </div>
                <div class="flex justify-between gap-3">
                    <span class="text-muted/70">frame</span>
                    <span class="text-foreground/80 tabular-nums"
                        >{perfFrameMs}ms</span
                    >
                </div>
                {#if perfHeapMB !== null}
                    <div class="flex justify-between gap-3">
                        <span class="text-muted/70">heap</span>
                        <span class="text-foreground/80 tabular-nums"
                            >{perfHeapMB} MB</span
                        >
                    </div>
                {/if}

                <!-- Stats: scene -->
                <div class="border-t border-border/30 mt-1 pt-1 space-y-0.5">
                    <div
                        class="text-[7px] text-muted/60 uppercase tracking-wider mb-0.5"
                    >
                        scene
                    </div>
                    <div class="flex justify-between gap-3">
                        <span class="text-muted/70">agents</span>
                        <span class="text-foreground/80 tabular-nums"
                            >{agentCount}</span
                        >
                    </div>
                    <div class="flex justify-between gap-3">
                        <span class="text-muted/70">elements</span>
                        <span class="text-foreground/80 tabular-nums"
                            >{elementCount}</span
                        >
                    </div>
                    <div class="flex justify-between gap-3">
                        <span class="text-muted/70">convs</span>
                        <span class="text-foreground/80 tabular-nums">
                            <span class="text-green-400">{activeConvs}</span
                            >/{totalConvs}
                        </span>
                    </div>
                </div>

                <!-- View Mode -->
                <div class="border-t border-border/30 mt-1 pt-1">
                    <div
                        class="text-[7px] text-muted/60 uppercase tracking-wider mb-1"
                    >
                        view mode
                    </div>
                    <div class="flex rounded border border-border overflow-hidden">
                        <button
                            class="flex-1 px-2 py-0.5 text-[8px] transition-colors {workshopState
                                .settings.viewMode === 'classic'
                                ? 'bg-accent text-white'
                                : 'bg-bg3 text-muted hover:text-foreground'}"
                            onclick={() => setViewMode("classic")}
                        >
                            Classic
                        </button>
                        <button
                            class="flex-1 px-2 py-0.5 text-[8px] transition-colors {workshopState
                                .settings.viewMode === 'habbo'
                                ? 'bg-accent text-white'
                                : 'bg-bg3 text-muted hover:text-foreground'}"
                            onclick={() => setViewMode("habbo")}
                        >
                            Habbo
                        </button>
                        <button
                            class="flex-1 px-2 py-0.5 text-[8px] transition-colors {workshopState
                                .settings.viewMode === 'pixel'
                                ? 'bg-accent text-white'
                                : 'bg-bg3 text-muted hover:text-foreground'}"
                            onclick={() => setViewMode("pixel")}
                        >
                            Pixel
                        </button>
                    </div>
                </div>

                <!-- Ropes -->
                <div class="border-t border-border/30 mt-1 pt-1">
                    <div
                        class="text-[7px] text-muted/60 uppercase tracking-wider mb-1"
                    >
                        ropes
                    </div>
                    <div class="flex rounded border border-border overflow-hidden">
                        <button
                            class="flex-1 px-2 py-0.5 text-[8px] transition-colors {showChatRopes
                                ? 'bg-accent/80 text-white'
                                : 'bg-bg3 text-muted hover:text-foreground'}"
                            onclick={() => {
                                showChatRopes = !showChatRopes;
                                localStorage.setItem(
                                    "workshop:showChatRopes",
                                    String(showChatRopes),
                                );
                            }}
                        >
                            Chat
                        </button>
                        <button
                            class="flex-1 px-2 py-0.5 text-[8px] transition-colors {showRelationshipRopes
                                ? 'bg-accent/80 text-white'
                                : 'bg-bg3 text-muted hover:text-foreground'}"
                            onclick={() => {
                                showRelationshipRopes = !showRelationshipRopes;
                                localStorage.setItem(
                                    "workshop:showRelationshipRopes",
                                    String(showRelationshipRopes),
                                );
                            }}
                        >
                            Relations
                        </button>
                    </div>
                </div>

                <!-- Debug -->
                <div class="border-t border-border/30 mt-1 pt-1">
                    <div class="flex items-center justify-between">
                        <span class="text-[7px] text-muted/60 uppercase tracking-wider"
                            >agent debug</span
                        >
                        <ToggleSwitch
                            id="workshop-debug"
                            checked={debugMode}
                            onchange={(v) => {
                                debugMode = v;
                                localStorage.setItem(
                                    "workshop:debugMode",
                                    String(debugMode),
                                );
                            }}
                        />
                    </div>
                </div>
            </div>
        {/if}
        <button
            class="flex items-center gap-1.5 px-2 py-1 text-[9px] font-mono text-muted hover:text-foreground transition-colors backdrop-blur border border-border bg-bg2/80 {configOpen
                ? 'rounded-b rounded-t-none w-full justify-center'
                : 'rounded'}"
            onclick={() => {
                configOpen = !configOpen;
            }}
        >
            {configOpen ? "⚙ config" : "⚙"}
        </button>
    </div>

    {#if debugMode}
        <DebugOverlay />
    {/if}

    <!-- Context Menu -->
    {#if contextMenu}
        <ContextMenu
            instanceId={contextMenu.instanceId}
            agentName={contextMenu.agentName}
            x={contextMenu.x}
            y={contextMenu.y}
            nearbyAgents={getNearbyAgentsList(contextMenu.instanceId)}
            currentBehavior={workshopState.agents[contextMenu.instanceId]
                ?.behavior ?? "stationary"}
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
            onSelectConversation={(id) => {
                selectedConversationId = id;
            }}
            onClose={() => {
                sidebarOpen = false;
            }}
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
        {#if activeOverlay.type === "pinboard"}
            <PinboardOverlay
                elementId={activeOverlay.elementId}
                onClose={() => (activeOverlay = null)}
            />
        {:else if activeOverlay.type === "messageboard"}
            <MessageBoardOverlay
                elementId={activeOverlay.elementId}
                onClose={() => (activeOverlay = null)}
            />
        {:else if activeOverlay.type === "inbox"}
            <InboxOverlay
                elementId={activeOverlay.elementId}
                onClose={() => (activeOverlay = null)}
            />
        {:else if activeOverlay.type === "rulebook"}
            <RulebookOverlay
                elementId={activeOverlay.elementId}
                onClose={() => (activeOverlay = null)}
            />
        {:else if activeOverlay.type === "portal"}
            <PortalOverlay
                elementId={activeOverlay.elementId}
                onClose={() => (activeOverlay = null)}
            />
        {/if}
    {/if}

    <!-- Task Prompt Dialog -->
    {#if taskPromptDialog}
        <div
            class="fixed inset-0 z-1100 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        >
            <div
                class="bg-bg2 border border-border rounded-lg shadow-xl w-96 max-w-[90vw] p-4"
            >
                <h3 class="text-xs font-mono text-foreground mb-1">
                    {taskPromptDialog.mode === "assign"
                        ? "Assign Task"
                        : "Start Conversation"}
                </h3>
                <p class="text-[10px] text-muted mb-3">
                    {taskPromptDialog.agentName}
                </p>
                <textarea
                    class="w-full h-24 bg-bg1 border border-border rounded px-2 py-1.5 text-[11px] text-foreground font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent"
                    placeholder={taskPromptDialog.mode === "assign"
                        ? "Describe the task..."
                        : "What should they discuss?"}
                    bind:value={taskPromptInput}
                    onkeydown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            handleTaskPromptSubmit();
                        }
                    }}
                ></textarea>
                <div class="flex justify-end gap-2 mt-3">
                    <button
                        class="px-3 py-1 text-[10px] font-mono text-muted hover:text-foreground border border-border rounded transition-colors"
                        onclick={() => {
                            taskPromptDialog = null;
                            taskPromptInput = "";
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        class="px-3 py-1 text-[10px] font-mono text-accent-foreground bg-accent hover:bg-accent/90 rounded transition-colors disabled:opacity-40"
                        onclick={handleTaskPromptSubmit}
                    >
                        {taskPromptDialog.mode === "assign" ? "Send" : "Start"}
                    </button>
                </div>
                <p class="text-[9px] text-muted mt-2">
                    Leave blank to use a default prompt · Cmd/Ctrl+Enter
                </p>
            </div>
        </div>
    {/if}
</div>

<style>
    .thinking-dot {
        animation: thinking-bounce 1.4s infinite ease-in-out;
    }

    @keyframes thinking-bounce {
        0%,
        80%,
        100% {
            opacity: 0.25;
            transform: scale(0.8);
        }
        40% {
            opacity: 1;
            transform: scale(1.2);
        }
    }
</style>
