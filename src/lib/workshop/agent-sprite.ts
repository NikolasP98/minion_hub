import * as PIXI from 'pixi.js';
import {
	getAvatarTexture,
	seedToColor,
	clearTextureCache,
	getGeneration,
	CLASSIC_TEXTURE_SIZE,
	TEXT_RESOLUTION,
} from './texture-cache';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SPRITE_SIZE = 60;
export const BOBBING_AMPLITUDE = 2;
export const BOBBING_SPEED = 0.002;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentSpriteInfo {
	agentId: string;
	name: string;
	avatarSeed: string;
	emoji?: string;
}

// ---------------------------------------------------------------------------
// Module-level state (singleton)
// ---------------------------------------------------------------------------

const sprites = new Map<string, PIXI.Container>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a PIXI.Container for an agent instance containing:
 *   - Glow ring (Graphics circle stroke)
 *   - Avatar sprite (masked to a circle)
 *   - Name label (below the sprite)
 *
 * The container is added to `stage` and stored in the sprites map.
 */
export async function createAgentSprite(
	instanceId: string,
	info: AgentSpriteInfo,
	x: number,
	y: number,
	stage: PIXI.Container
): Promise<PIXI.Container> {
	// Avoid duplicates
	if (sprites.has(instanceId)) {
		return sprites.get(instanceId)!;
	}

	// Capture generation before async work so we can detect stale calls
	const gen = getGeneration();

	const container = new PIXI.Container();
	container.label = instanceId;
	container.x = x;
	container.y = y;

	// --- Glow ring ---
	const glow = new PIXI.Graphics();
	glow.label = 'glow';
	glow.circle(0, 0, SPRITE_SIZE / 2 + 4);
	glow.stroke({ color: 0x6366f1, width: 3, alpha: 0.5 });
	container.addChild(glow);

	// --- Background circle (always visible as a base) ---
	const bgCircle = new PIXI.Graphics();
	bgCircle.label = 'bg';
	bgCircle.circle(0, 0, SPRITE_SIZE / 2);
	bgCircle.fill({ color: seedToColor(info.avatarSeed) });
	container.addChild(bgCircle);

	// --- Avatar (loaded async, rendered on top of background) ---
	const texture = await getAvatarTexture(info.avatarSeed, CLASSIC_TEXTURE_SIZE);

	// If sprites were cleared while we were loading the texture, discard this container
	if (gen !== getGeneration()) {
		container.destroy({ children: true });
		// Return a new sprite if one was created by a newer rebuildScene call
		return sprites.get(instanceId) ?? container;
	}

	// Another createAgentSprite for the same instanceId finished first
	if (sprites.has(instanceId)) {
		container.destroy({ children: true });
		return sprites.get(instanceId)!;
	}

	const avatarContainer = new PIXI.Container();
	avatarContainer.label = 'avatar';

	if (texture) {
		const avatar = new PIXI.Sprite(texture);
		avatar.anchor.set(0.5);
		avatar.width = SPRITE_SIZE;
		avatar.height = SPRITE_SIZE;

		// Circular mask
		const mask = new PIXI.Graphics();
		mask.circle(0, 0, SPRITE_SIZE / 2);
		mask.fill({ color: 0xffffff });
		avatarContainer.addChild(mask);
		avatar.mask = mask;

		avatarContainer.addChild(avatar);
	}

	container.addChild(avatarContainer);

	// --- Name label ---
	const label = new PIXI.Text({
		text: info.name,
		style: {
			fontFamily: 'JetBrains Mono NF, monospace',
			fontSize: 5,
			fill: 0xaaaaaa,
			align: 'center'
		},
		resolution: TEXT_RESOLUTION,
	});
	label.label = 'name';
	label.anchor.set(0.5, 0);
	label.y = SPRITE_SIZE / 2 + 2;
	container.addChild(label);

	// --- Interaction ---
	container.eventMode = 'static';
	container.cursor = 'grab';

	// Add to stage and track
	stage.addChild(container);
	sprites.set(instanceId, container);

	return container;
}

/**
 * Remove an agent sprite from its parent, destroy it, and delete from map.
 * Evicts the cached texture if no remaining sprite uses the same avatarSeed.
 */
export function removeAgentSprite(instanceId: string): void {
	const container = sprites.get(instanceId);
	if (!container) return;

	container.removeFromParent();
	container.destroy({ children: true });
	sprites.delete(instanceId);
}

/**
 * Update the position of an agent sprite container.
 */
export function updateSpritePosition(instanceId: string, x: number, y: number): void {
	const container = sprites.get(instanceId);
	if (!container) return;
	container.x = x;
	container.y = y;
}

/**
 * Apply a sinusoidal bobbing animation to every sprite's avatar child.
 * `elapsed` is the total time in milliseconds (e.g. from a PIXI ticker).
 */
export function applyBobbingAnimation(elapsed: number): void {
	for (const [instanceId, container] of sprites) {
		const avatar = container.getChildByLabel('avatar');
		if (!avatar) continue;

		// Use instanceId hash to offset phase so agents bob out of sync
		let phase = 0;
		for (let i = 0; i < instanceId.length; i++) {
			phase += instanceId.charCodeAt(i);
		}

		avatar.y = Math.sin(elapsed * BOBBING_SPEED + phase) * BOBBING_AMPLITUDE;
	}
}

/**
 * Redraw the glow ring of a sprite with a new colour.
 */
export function setSpriteGlowColor(instanceId: string, color: number): void {
	const container = sprites.get(instanceId);
	if (!container) return;

	const glow = container.getChildByLabel('glow') as PIXI.Graphics | null;
	if (!glow) return;

	glow.clear();
	glow.circle(0, 0, SPRITE_SIZE / 2 + 4);
	glow.stroke({ color, width: 3, alpha: 0.5 });
}

/**
 * Animate a brief scale + glow pulse on the agent sprite (used for heartbeat).
 * Scale: 1.0 → 1.25 → 1.0 over 600 ms. Glow alpha: 0.5 → 1.0 → 0.5.
 */
export function triggerHeartbeatPulse(instanceId: string): void {
	const container = sprites.get(instanceId);
	if (!container) return;

	const glow = container.getChildByLabel('glow') as PIXI.Graphics | null;
	const DURATION = 600;
	let elapsed = 0;

	const onTick = (ticker: PIXI.Ticker) => {
		if (container.destroyed) {
			PIXI.Ticker.shared.remove(onTick);
			return;
		}
		elapsed += ticker.deltaMS;
		const t = Math.min(elapsed / DURATION, 1);
		const scale = 1 + 0.25 * Math.sin(t * Math.PI);
		container.scale.set(scale);
		if (glow) glow.alpha = 0.5 + 0.5 * Math.sin(t * Math.PI);
		if (t >= 1) {
			container.scale.set(1);
			if (glow) glow.alpha = 0.5;
			PIXI.Ticker.shared.remove(onTick);
		}
	};
	PIXI.Ticker.shared.add(onTick);
}

/**
 * Show a floating emoji reaction above an agent sprite that fades out upward over 1.2 s.
 */
export function showReactionEmoji(instanceId: string, emoji: string): void {
	const container = sprites.get(instanceId);
	if (!container) return;

	const text = new PIXI.Text({
		text: emoji,
		style: {
			fontSize: 20,
			align: 'center',
		},
		resolution: TEXT_RESOLUTION,
	});
	text.anchor.set(0.5, 1);
	text.x = 0;
	text.y = -SPRITE_SIZE / 2;
	container.addChild(text);

	const DURATION = 1200;
	let elapsed = 0;

	const onTick = (ticker: PIXI.Ticker) => {
		if (container.destroyed || text.destroyed) {
			PIXI.Ticker.shared.remove(onTick);
			return;
		}
		elapsed += ticker.deltaMS;
		const t = Math.min(elapsed / DURATION, 1);
		text.y = -SPRITE_SIZE / 2 - t * 40;
		text.alpha = 1 - t;
		if (t >= 1) {
			text.destroy();
			PIXI.Ticker.shared.remove(onTick);
		}
	};
	PIXI.Ticker.shared.add(onTick);
}

/**
 * Return the container for an agent instance, or undefined.
 */
export function getSprite(instanceId: string): PIXI.Container | undefined {
	return sprites.get(instanceId);
}

/**
 * Return the full sprites map.
 */
export function getAllSprites(): Map<string, PIXI.Container> {
	return sprites;
}

/**
 * Destroy all sprites and their cached textures, clear both maps.
 */
export function clearAllSprites(): void {
	clearTextureCache(); // bumps generation & frees VRAM
	for (const [, container] of sprites) {
		container.removeFromParent();
		container.destroy({ children: true });
	}
	sprites.clear();
}
