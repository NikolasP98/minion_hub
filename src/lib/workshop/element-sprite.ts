import * as PIXI from 'pixi.js';
import type { ElementType } from '$lib/state/workshop.svelte';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ELEMENT_WIDTH = 100;
export const ELEMENT_HEIGHT = 80;
const CORNER_RADIUS = 8;

const TYPE_COLORS: Record<ElementType, number> = {
	pinboard: 0x8b6914,   // cork
	messageboard: 0x2563eb, // blue
	inbox: 0x475569,       // steel
	rulebook: 0x1a472a,   // deep green
	portal: 0x7c3aed,     // purple/violet
};

const TYPE_ICONS: Record<ElementType, string> = {
	pinboard: '\u{1F4CC}',      // 📌
	messageboard: '\u{1F4CB}', // 📋
	inbox: '\u{1F4EC}',        // 📬
	rulebook: '\u{1F4D6}',     // 📖
	portal: '\u{1F300}',       // 🌀
};

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const sprites = new Map<string, PIXI.Container>();
let generation = 0;

// ---------------------------------------------------------------------------
// Public API
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
	if (sprites.has(instanceId)) {
		return sprites.get(instanceId)!;
	}

	const container = new PIXI.Container();
	container.label = instanceId;
	container.x = x;
	container.y = y;

	// --- Background rounded rect ---
	const bg = new PIXI.Graphics();
	bg.label = 'bg';
	bg.roundRect(
		-ELEMENT_WIDTH / 2,
		-ELEMENT_HEIGHT / 2,
		ELEMENT_WIDTH,
		ELEMENT_HEIGHT,
		CORNER_RADIUS,
	);
	bg.fill({ color: TYPE_COLORS[type], alpha: 0.7 });
	bg.stroke({ color: 0xffffff, width: 1, alpha: 0.15 });
	container.addChild(bg);

	// --- Type icon ---
	const icon = new PIXI.Text({
		text: TYPE_ICONS[type],
		style: { fontSize: 22, align: 'center' },
	});
	icon.label = 'icon';
	icon.anchor.set(0.5);
	icon.y = -8;
	container.addChild(icon);

	// --- Label text ---
	const labelText = new PIXI.Text({
		text: label,
		style: {
			fontFamily: 'JetBrains Mono NF, monospace',
			fontSize: 9,
			fill: 0xdddddd,
			align: 'center',
		},
	});
	labelText.label = 'label';
	labelText.anchor.set(0.5, 0);
	labelText.y = 10;
	container.addChild(labelText);

	// --- Badge (item count) ---
	if (itemCount !== undefined && itemCount > 0) {
		addBadge(container, itemCount);
	}

	// --- Interaction ---
	container.eventMode = 'static';
	container.cursor = 'pointer';

	stage.addChild(container);
	sprites.set(instanceId, container);

	return container;
}

export function removeElementSprite(instanceId: string): void {
	const container = sprites.get(instanceId);
	if (!container) return;
	container.removeFromParent();
	container.destroy({ children: true });
	sprites.delete(instanceId);
}

export function updateElementSpritePosition(instanceId: string, x: number, y: number): void {
	const container = sprites.get(instanceId);
	if (!container) return;
	container.x = x;
	container.y = y;
}

export function updateElementBadge(instanceId: string, count: number): void {
	const container = sprites.get(instanceId);
	if (!container) return;

	// Remove existing badge
	const existing = container.getChildByLabel('badge');
	if (existing) {
		container.removeChild(existing);
		existing.destroy({ children: true });
	}

	if (count > 0) {
		addBadge(container, count);
	}
}

export function getElementSprite(instanceId: string): PIXI.Container | undefined {
	return sprites.get(instanceId);
}

export function getAllElementSprites(): Map<string, PIXI.Container> {
	return sprites;
}

export function clearAllElementSprites(): void {
	generation++;
	for (const [, container] of sprites) {
		container.removeFromParent();
		container.destroy({ children: true });
	}
	sprites.clear();
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function addBadge(container: PIXI.Container, count: number): void {
	const badgeContainer = new PIXI.Container();
	badgeContainer.label = 'badge';
	badgeContainer.x = ELEMENT_WIDTH / 2 - 8;
	badgeContainer.y = -ELEMENT_HEIGHT / 2 + 4;

	const badgeBg = new PIXI.Graphics();
	badgeBg.circle(0, 0, 8);
	badgeBg.fill({ color: 0xef4444 });
	badgeContainer.addChild(badgeBg);

	const badgeText = new PIXI.Text({
		text: count > 99 ? '99+' : String(count),
		style: {
			fontFamily: 'JetBrains Mono NF, monospace',
			fontSize: 8,
			fill: 0xffffff,
			align: 'center',
		},
	});
	badgeText.anchor.set(0.5);
	badgeContainer.addChild(badgeText);

	container.addChild(badgeContainer);
}
