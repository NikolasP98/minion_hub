/**
 * Habbo-style Isometric Element Sprites
 *
 * Renders workshop elements (pinboard, messageboard, inbox, rulebook) as
 * isometric furniture-style cuboids with 3 visible faces, type-specific
 * colours, an icon on the top face, a label, and an optional badge count.
 *
 * Positions are set in iso-screen coordinates (the caller converts from world
 * coords via habbo-renderer.worldToIsoScreen).
 */

import * as PIXI from 'pixi.js';
import type { ElementType } from '$lib/state/workshop.svelte';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Cuboid dimensions in screen pixels.
 * The top face uses the same 2:1 iso ratio as the floor tiles (TILE_WIDTH:TILE_HEIGHT = 64:32).
 * We use a smaller scale so elements don't dominate the room.
 */
const CUBE_WIDTH = 48;         // half-width of the top diamond = 24
const CUBE_HEIGHT_TOP = 24;    // half-height of the top diamond = 12  → 48:24 = 2:1 iso ratio
const CUBE_DEPTH = 28;         // vertical extent of the side faces

const TYPE_COLORS: Record<ElementType, number> = {
	pinboard: 0x8b6914,
	messageboard: 0x2563eb,
	inbox: 0x475569,
	rulebook: 0x1a472a,
	portal: 0x7c3aed,
};

const TYPE_ICONS: Record<ElementType, string> = {
	pinboard: '\u{1F4CC}',
	messageboard: '\u{1F4CB}',
	inbox: '\u{1F4EC}',
	rulebook: '\u{1F4D6}',
	portal: '\u{1F300}',
};

/** Darken a colour by a factor (0–1 where 0 = black). */
function darken(color: number, factor: number): number {
	const r = ((color >> 16) & 0xff) * factor;
	const g = ((color >> 8) & 0xff) * factor;
	const b = (color & 0xff) * factor;
	return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const sprites = new Map<string, PIXI.Container>();

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function drawCuboid(g: PIXI.Graphics, baseColor: number): void {
	const hw = CUBE_WIDTH / 2;   // 24
	const hh = CUBE_HEIGHT_TOP / 2; // 12

	// Top-face diamond vertices (2:1 iso ratio, matching floor tiles)
	//   top:    ( 0, -hh)
	//   right:  ( hw,  0)
	//   bottom: ( 0,  hh)
	//   left:   (-hw,  0)

	// --- Top face (diamond) ---
	g.moveTo(0, -hh);
	g.lineTo(hw, 0);
	g.lineTo(0, hh);
	g.lineTo(-hw, 0);
	g.closePath();
	g.fill({ color: baseColor });
	g.stroke({ color: 0xffffff, width: 0.5, alpha: 0.15 });

	// Side faces: vertical edges drop straight down by CUBE_DEPTH,
	// bottom edges parallel the corresponding top edges.

	// --- Left face (visible: left→bottom edge of diamond, dropped down) ---
	g.moveTo(-hw, 0);                     // top-left
	g.lineTo(0, hh);                      // top-right (diamond bottom)
	g.lineTo(0, hh + CUBE_DEPTH);         // bottom-right
	g.lineTo(-hw, 0 + CUBE_DEPTH);        // bottom-left
	g.closePath();
	g.fill({ color: darken(baseColor, 0.7) });
	g.stroke({ color: 0xffffff, width: 0.5, alpha: 0.08 });

	// --- Right face (visible: bottom→right edge of diamond, dropped down) ---
	g.moveTo(0, hh);                      // top-left (diamond bottom)
	g.lineTo(hw, 0);                      // top-right
	g.lineTo(hw, 0 + CUBE_DEPTH);         // bottom-right
	g.lineTo(0, hh + CUBE_DEPTH);         // bottom-left
	g.closePath();
	g.fill({ color: darken(baseColor, 0.5) });
	g.stroke({ color: 0xffffff, width: 0.5, alpha: 0.08 });
}

function addBadge(container: PIXI.Container, count: number): void {
	const badgeContainer = new PIXI.Container();
	badgeContainer.label = 'badge';
	badgeContainer.x = CUBE_WIDTH / 2 - 4;
	badgeContainer.y = -CUBE_HEIGHT_TOP / 2 - 4;

	const bg = new PIXI.Graphics();
	bg.circle(0, 0, 8);
	bg.fill({ color: 0xef4444 });
	badgeContainer.addChild(bg);

	const text = new PIXI.Text({
		text: count > 99 ? '99+' : String(count),
		style: {
			fontFamily: 'JetBrains Mono NF, monospace',
			fontSize: 8,
			fill: 0xffffff,
			align: 'center',
		},
	});
	text.anchor.set(0.5);
	badgeContainer.addChild(text);

	container.addChild(badgeContainer);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createHabboElementSprite(
	instanceId: string,
	type: ElementType,
	label: string,
	x: number,
	y: number,
	stage: PIXI.Container,
	itemCount?: number,
): PIXI.Container {
	if (sprites.has(instanceId)) {
		return sprites.get(instanceId)!;
	}

	const container = new PIXI.Container();
	container.label = instanceId;
	container.x = x;
	container.y = y;

	// --- Isometric cuboid ---
	const cuboid = new PIXI.Graphics();
	cuboid.label = 'cuboid';
	drawCuboid(cuboid, TYPE_COLORS[type]);
	container.addChild(cuboid);

	// --- Icon on top face (centered in the diamond) ---
	const icon = new PIXI.Text({
		text: TYPE_ICONS[type],
		style: { fontSize: 14, align: 'center' },
	});
	icon.label = 'icon';
	icon.anchor.set(0.5);
	icon.y = 0; // center of the top face diamond
	container.addChild(icon);

	// --- Label below cuboid ---
	const labelText = new PIXI.Text({
		text: label,
		style: {
			fontFamily: 'JetBrains Mono NF, monospace',
			fontSize: 9,
			fill: 0xaaaaaa,
			align: 'center',
		},
	});
	labelText.label = 'label';
	labelText.anchor.set(0.5, 0);
	labelText.y = CUBE_HEIGHT_TOP / 2 + CUBE_DEPTH + 4; // below the visible cuboid bottom
	container.addChild(labelText);

	// --- Badge ---
	if (itemCount !== undefined && itemCount > 0) {
		addBadge(container, itemCount);
	}

	// Interaction
	container.eventMode = 'static';
	container.cursor = 'pointer';

	stage.addChild(container);
	sprites.set(instanceId, container);

	return container;
}

export function removeHabboElementSprite(instanceId: string): void {
	const container = sprites.get(instanceId);
	if (!container) return;
	container.removeFromParent();
	container.destroy({ children: true });
	sprites.delete(instanceId);
}

export function updateHabboElementSpritePosition(
	instanceId: string,
	x: number,
	y: number,
): void {
	const container = sprites.get(instanceId);
	if (!container) return;
	container.x = x;
	container.y = y;
}

export function updateHabboElementBadge(instanceId: string, count: number): void {
	const container = sprites.get(instanceId);
	if (!container) return;

	const existing = container.getChildByLabel('badge');
	if (existing) {
		container.removeChild(existing);
		existing.destroy({ children: true });
	}

	if (count > 0) {
		addBadge(container, count);
	}
}

export function getHabboElementSprite(
	instanceId: string,
): PIXI.Container | undefined {
	return sprites.get(instanceId);
}

export function getAllHabboElementSprites(): Map<string, PIXI.Container> {
	return sprites;
}

export function clearAllHabboElementSprites(): void {
	for (const [, container] of sprites) {
		container.removeFromParent();
		container.destroy({ children: true });
	}
	sprites.clear();
}
