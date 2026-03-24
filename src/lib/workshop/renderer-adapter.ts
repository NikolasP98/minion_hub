/**
 * Renderer Adapter
 *
 * Sits between consumers (simulation, agent-fsm, gateway-bridge, WorkshopCanvas)
 * and the three concrete renderers (classic + habbo + pixel). Reads
 * `workshopState.settings.viewMode` at call time and delegates to the correct
 * backing renderer.
 *
 * Physics, state, FSMs, and proximity all stay in world coordinates — the iso
 * transformation is purely visual, applied at the rendering layer only.
 * In pixel mode, the pixel office engine manages its own Canvas 2D rendering;
 * the adapter provides lightweight position tracking stubs.
 */

import * as PIXI from 'pixi.js';
import { workshopState } from '$lib/state/workshop/workshop.svelte';
import type { ElementType } from '$lib/state/workshop/workshop.svelte';

// Classic renderers
import * as classicAgentSprite from './agent-sprite';
import * as classicElementSprite from './element-sprite';
import * as ropeRendererModule from './rope-renderer';

// Habbo renderers
import * as habboRenderer from './habbo-renderer';
import * as habboElementSprite from './habbo-element-sprite';

// Re-export types that consumers need
export type { AgentSpriteInfo } from './agent-sprite';

// Re-export constants
export const SPRITE_SIZE = classicAgentSprite.SPRITE_SIZE;
export const ELEMENT_WIDTH = classicElementSprite.ELEMENT_WIDTH;
export const ELEMENT_HEIGHT = classicElementSprite.ELEMENT_HEIGHT;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isHabbo(): boolean {
	return workshopState.settings.viewMode === 'habbo';
}

function isPixel(): boolean {
	return workshopState.settings.viewMode === 'pixel';
}

// ---------------------------------------------------------------------------
// Pixel mode: lightweight position/state tracking
// The pixel office engine does its own Canvas 2D rendering; the adapter just
// tracks positions so the simulation can query them.
// ---------------------------------------------------------------------------

/** Pixel-mode character positions, keyed by instanceId */
const pixelPositions = new Map<string, { x: number; y: number }>();
/** Pixel-mode glow colors, keyed by instanceId */
const pixelGlowColors = new Map<string, number>();

/** Get all pixel-mode character positions (used by simulation for proximity checks) */
export function getPixelPositions(): Map<string, { x: number; y: number }> {
	return pixelPositions;
}

/** Get pixel-mode glow color for an agent */
export function getPixelGlowColor(instanceId: string): number | undefined {
	return pixelGlowColors.get(instanceId);
}

function clearPixelState(): void {
	pixelPositions.clear();
	pixelGlowColors.clear();
}

/** The PIXI.Application instance, set via initRenderer. */
let pixiApp: PIXI.Application | null = null;
/** The world container, set via initRenderer. */
let worldCont: PIXI.Container | null = null;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Initialise the renderer for the current view mode.
 * Classic mode: no-op (sprites are added directly to worldContainer).
 * Habbo mode: creates iso room + avatar container layer.
 */
export function initRenderer(app: PIXI.Application, worldContainer: PIXI.Container): void {
	pixiApp = app;
	worldCont = worldContainer;
	if (isPixel()) {
		// Pixel mode: no PixiJS init needed — Canvas 2D is managed by WorkshopCanvas
		return;
	}
	if (isHabbo()) {
		habboRenderer.initHabboRenderer(app, worldContainer);
	}
}

/**
 * Tear down the current renderer. Classic: clears sprites. Habbo: destroys
 * iso room + avatars.
 */
export function destroyRenderer(): void {
	// Always tear down all renderers unconditionally — on mode switch the
	// viewMode has already changed so isHabbo()/isPixel() reflects the NEW mode, not
	// the one being torn down. Calling destroy on an empty renderer is a no-op.
	habboRenderer.destroyHabboRenderer();
	habboElementSprite.clearAllHabboElementSprites();
	classicAgentSprite.clearAllSprites();
	classicElementSprite.clearAllElementSprites();
	ropeRendererModule.clearAllRopes();
	clearPixelState();
}

// ---------------------------------------------------------------------------
// Agent sprite API
// ---------------------------------------------------------------------------

export async function createAgentSprite(
	instanceId: string,
	info: classicAgentSprite.AgentSpriteInfo,
	x: number,
	y: number,
	stage: PIXI.Container,
): Promise<PIXI.Container> {
	if (isPixel()) {
		// Pixel mode: track position; actual character is managed by pixel office engine
		pixelPositions.set(instanceId, { x, y });
		// Return a minimal empty container as a stub (not rendered by PixiJS)
		const stub = new PIXI.Container();
		stub.label = instanceId;
		stub.x = x;
		stub.y = y;
		return stub;
	}
	if (isHabbo() && pixiApp) {
		// Use the dedicated avatar layer so sprites render above the floor
		const avatarLayer = habboRenderer.getAvatarContainer() ?? stage;
		const isoPos = habboRenderer.worldToIsoScreen(x, y);
		const container = await habboRenderer.createHabboAvatarSprite(
			instanceId,
			info,
			pixiApp,
			avatarLayer,
		);
		container.x = isoPos.x;
		container.y = isoPos.y;
		// Depth sort within the avatar layer
		avatarLayer.children.sort((a, b) => a.y - b.y);
		return container;
	}
	return classicAgentSprite.createAgentSprite(instanceId, info, x, y, stage);
}

export function removeAgentSprite(instanceId: string): void {
	if (isPixel()) {
		pixelPositions.delete(instanceId);
		pixelGlowColors.delete(instanceId);
		return;
	}
	if (isHabbo()) {
		habboRenderer.removeAvatar(instanceId);
		return;
	}
	classicAgentSprite.removeAgentSprite(instanceId);
}

export function updateSpritePosition(instanceId: string, x: number, y: number): void {
	if (isPixel()) {
		const pos = pixelPositions.get(instanceId);
		if (pos) { pos.x = x; pos.y = y; }
		else pixelPositions.set(instanceId, { x, y });
		return;
	}
	if (isHabbo()) {
		const isoPos = habboRenderer.worldToIsoScreen(x, y);
		const sprite = habboRenderer.getSprite(instanceId);
		if (sprite) {
			sprite.x = isoPos.x;
			sprite.y = isoPos.y;
			// Depth sort
			if (sprite.parent) {
				sprite.parent.children.sort((a, b) => a.y - b.y);
			}
		}
		return;
	}
	classicAgentSprite.updateSpritePosition(instanceId, x, y);
}

export function applyBobbingAnimation(_elapsed: number): void {
	// Avatar bobbing disabled — kept as no-op to avoid breaking the simulation call site.
}

export function setSpriteGlowColor(instanceId: string, color: number): void {
	if (isPixel()) {
		pixelGlowColors.set(instanceId, color);
		return;
	}
	if (isHabbo()) {
		habboRenderer.setSpriteGlowColor(instanceId, color);
		return;
	}
	classicAgentSprite.setSpriteGlowColor(instanceId, color);
}

export function triggerHeartbeatPulse(instanceId: string): void {
	if (isPixel()) {
		// Pixel office handles heartbeat pulse in its own render loop
		return;
	}
	if (isHabbo()) {
		habboRenderer.triggerHeartbeatPulse(instanceId);
		return;
	}
	classicAgentSprite.triggerHeartbeatPulse(instanceId);
}

export function showReactionEmoji(instanceId: string, emoji: string): void {
	if (isPixel()) {
		// Pixel office handles emoji display in its own render loop
		return;
	}
	if (isHabbo()) {
		habboRenderer.showReactionEmoji(instanceId, emoji);
		return;
	}
	classicAgentSprite.showReactionEmoji(instanceId, emoji);
}

export function getSprite(instanceId: string): PIXI.Container | undefined {
	if (isPixel()) {
		// Pixel mode has no PixiJS sprites — return undefined
		return undefined;
	}
	if (isHabbo()) {
		return habboRenderer.getSprite(instanceId);
	}
	return classicAgentSprite.getSprite(instanceId);
}

export function getAllSprites(): Map<string, PIXI.Container> {
	if (isPixel()) {
		return new Map(); // Pixel mode has no PixiJS sprites
	}
	if (isHabbo()) {
		return habboRenderer.getAllSprites();
	}
	return classicAgentSprite.getAllSprites();
}

export function clearAllSprites(): void {
	if (isPixel()) {
		clearPixelState();
		return;
	}
	if (isHabbo()) {
		habboRenderer.clearAllAvatars();
		return;
	}
	classicAgentSprite.clearAllSprites();
}

// ---------------------------------------------------------------------------
// Element sprite API
// ---------------------------------------------------------------------------

export function createElementSprite(
	instanceId: string,
	type: ElementType,
	label: string,
	x: number,
	y: number,
	stage: PIXI.Container,
	itemCount?: number,
): PIXI.Container {
	if (isPixel()) {
		// Pixel mode: elements not rendered via PixiJS — return empty stub
		const stub = new PIXI.Container();
		stub.label = instanceId;
		stub.x = x;
		stub.y = y;
		return stub;
	}
	if (isHabbo()) {
		const avatarLayer = habboRenderer.getAvatarContainer() ?? stage;
		const isoPos = habboRenderer.worldToIsoScreen(x, y);
		return habboElementSprite.createHabboElementSprite(
			instanceId, type, label, isoPos.x, isoPos.y, avatarLayer, itemCount,
		);
	}
	return classicElementSprite.createElementSprite(instanceId, type, label, x, y, stage, itemCount);
}

export function removeElementSprite(instanceId: string): void {
	if (isPixel()) return;
	if (isHabbo()) {
		habboElementSprite.removeHabboElementSprite(instanceId);
		return;
	}
	classicElementSprite.removeElementSprite(instanceId);
}

export function updateElementSpritePosition(instanceId: string, x: number, y: number): void {
	if (isPixel()) return;
	if (isHabbo()) {
		const isoPos = habboRenderer.worldToIsoScreen(x, y);
		habboElementSprite.updateHabboElementSpritePosition(instanceId, isoPos.x, isoPos.y);
		return;
	}
	classicElementSprite.updateElementSpritePosition(instanceId, x, y);
}

export function updateElementBadge(instanceId: string, count: number): void {
	if (isPixel()) return;
	if (isHabbo()) {
		habboElementSprite.updateHabboElementBadge(instanceId, count);
		return;
	}
	classicElementSprite.updateElementBadge(instanceId, count);
}

export function getElementSprite(instanceId: string): PIXI.Container | undefined {
	if (isPixel()) return undefined;
	if (isHabbo()) {
		return habboElementSprite.getHabboElementSprite(instanceId);
	}
	return classicElementSprite.getElementSprite(instanceId);
}

export function getAllElementSprites(): Map<string, PIXI.Container> {
	if (isPixel()) return new Map();
	if (isHabbo()) {
		return habboElementSprite.getAllHabboElementSprites();
	}
	return classicElementSprite.getAllElementSprites();
}

export function clearAllElementSprites(): void {
	if (isPixel()) return;
	if (isHabbo()) {
		habboElementSprite.clearAllHabboElementSprites();
		return;
	}
	classicElementSprite.clearAllElementSprites();
}

// ---------------------------------------------------------------------------
// Rope API
// ---------------------------------------------------------------------------

export function createRope(relationshipId: string, label: string, stage: PIXI.Container): void {
	if (isPixel()) return; // Pixel mode draws connections in its own canvas
	ropeRendererModule.createRope(relationshipId, label, stage);
}

export function updateRope(
	relationshipId: string,
	fromX: number,
	fromY: number,
	toX: number,
	toY: number,
	label: string,
	isActive?: boolean,
	dt?: number,
	flowDirection?: 1 | -1,
): void {
	if (isPixel()) return;
	if (isHabbo()) {
		// Project world coords to iso screen for rope endpoints
		const from = habboRenderer.worldToIsoScreen(fromX, fromY);
		const to = habboRenderer.worldToIsoScreen(toX, toY);
		ropeRendererModule.updateRope(
			relationshipId,
			from.x,
			from.y,
			to.x,
			to.y,
			label,
			isActive,
			dt,
			flowDirection,
		);
		return;
	}
	ropeRendererModule.updateRope(
		relationshipId,
		fromX,
		fromY,
		toX,
		toY,
		label,
		isActive,
		dt,
		flowDirection,
	);
}

export function removeRope(relationshipId: string): void {
	if (isPixel()) return;
	ropeRendererModule.removeRope(relationshipId);
}

export function clearAllRopes(): void {
	if (isPixel()) return;
	ropeRendererModule.clearAllRopes();
}

export function getRopeAtPoint(x: number, y: number, threshold?: number): string | null {
	if (isPixel()) return null;
	return ropeRendererModule.getRopeAtPoint(x, y, threshold);
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

const SPRITE_HIT_RADIUS = 35;

export function hitTestAgentAtWorld(worldX: number, worldY: number): string | null {
	if (isPixel()) {
		// Use the pixel position tracking for hit testing
		for (const [instanceId, pos] of pixelPositions) {
			const dx = pos.x - worldX;
			const dy = pos.y - worldY;
			if (Math.sqrt(dx * dx + dy * dy) <= SPRITE_HIT_RADIUS) {
				return instanceId;
			}
		}
		return null;
	}
	if (isHabbo()) {
		// Convert world click to iso screen, then distance-check against iso positions
		const isoClick = habboRenderer.worldToIsoScreen(worldX, worldY);
		for (const [instanceId, container] of habboRenderer.getAllSprites()) {
			const dx = container.x - isoClick.x;
			const dy = container.y - isoClick.y;
			if (Math.sqrt(dx * dx + dy * dy) <= SPRITE_HIT_RADIUS) {
				return instanceId;
			}
		}
		return null;
	}
	const allSprites = classicAgentSprite.getAllSprites();
	for (const [instanceId, container] of allSprites) {
		const dx = container.x - worldX;
		const dy = container.y - worldY;
		if (Math.sqrt(dx * dx + dy * dy) <= SPRITE_HIT_RADIUS) {
			return instanceId;
		}
	}
	return null;
}

/** Hit radius for habbo element cuboids (approximate). */
const HABBO_ELEMENT_HIT_RADIUS = 40;

export function hitTestElementAtWorld(worldX: number, worldY: number): string | null {
	if (isPixel()) return null; // Pixel mode handles elements differently

	const halfW = ELEMENT_WIDTH / 2;
	const halfH = ELEMENT_HEIGHT / 2;

	if (isHabbo()) {
		const isoClick = habboRenderer.worldToIsoScreen(worldX, worldY);
		for (const [instanceId, container] of habboElementSprite.getAllHabboElementSprites()) {
			const dx = container.x - isoClick.x;
			const dy = container.y - isoClick.y;
			if (Math.sqrt(dx * dx + dy * dy) <= HABBO_ELEMENT_HIT_RADIUS) {
				return instanceId;
			}
		}
		return null;
	}

	for (const [instanceId, container] of classicElementSprite.getAllElementSprites()) {
		if (
			worldX >= container.x - halfW &&
			worldX <= container.x + halfW &&
			worldY >= container.y - halfH &&
			worldY <= container.y + halfH
		) {
			return instanceId;
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

/**
 * Convert world coordinates to screen coordinates for the current view mode.
 * In classic mode this is identity (world = screen within worldContainer).
 * In habbo mode this applies isometric projection.
 */
export function worldToScreenForMode(
	worldX: number,
	worldY: number,
): { x: number; y: number } {
	if (isPixel()) {
		// Pixel mode: world = screen (same as classic, no projection)
		return { x: worldX, y: worldY };
	}
	if (isHabbo()) {
		return habboRenderer.worldToIsoScreen(worldX, worldY);
	}
	return { x: worldX, y: worldY };
}

/**
 * Convert worldContainer-local coordinates (from screenToWorld / pointer events)
 * back to true world coordinates.
 *
 * In classic mode this is identity (worldContainer-local = world).
 * In habbo mode, worldContainer-local coords are in iso screen space,
 * so we reverse the iso projection to recover true world coords.
 *
 * Use this when a pointer event gives you a worldContainer-local position
 * that needs to be stored in state/physics as a world coordinate.
 */
export function containerLocalToWorld(
	localX: number,
	localY: number,
): { x: number; y: number } {
	if (isPixel()) {
		return { x: localX, y: localY };
	}
	if (isHabbo()) {
		return habboRenderer.isoScreenToWorld(localX, localY);
	}
	return { x: localX, y: localY };
}
