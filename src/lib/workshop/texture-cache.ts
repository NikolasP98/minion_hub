/**
 * Shared Texture Cache
 *
 * Centralises DiceBear SVG → PIXI.Texture loading for both the classic and
 * habbo renderers. Prevents duplicate fetches when switching view modes.
 */

import * as PIXI from 'pixi.js';
import { diceBearAvatarUrl } from '$lib/utils/avatar';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Render size for the SVG → canvas conversion (classic sprites). */
const CLASSIC_TEX_SIZE = 120; // SPRITE_SIZE * 2

/** Render size for the habbo avatar texture. */
const HABBO_TEX_SIZE = 64;

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const textureCache = new Map<string, PIXI.Texture>();

/** Incremented on clearTextureCache(). Used to detect stale async work. */
let generation = 0;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Current generation counter – callers snapshot before async work. */
export function getGeneration(): number {
	return generation;
}

/**
 * Fetch a DiceBear Notionists SVG, render to an offscreen canvas, and return
 * a PIXI.Texture. Results are cached by `seed`. Returns `null` on failure.
 *
 * @param seed  The avatarSeed string passed to DiceBear.
 * @param size  Canvas render size (defaults to classic sprite size).
 */
export async function getAvatarTexture(
	seed: string,
	size: number = CLASSIC_TEX_SIZE,
): Promise<PIXI.Texture | null> {
	const key = `${seed}:${size}`;
	const cached = textureCache.get(key);
	if (cached) return cached;

	try {
		const url = diceBearAvatarUrl(seed);
		const res = await fetch(url);
		if (!res.ok) throw new Error(`DiceBear fetch failed: ${res.status}`);

		const svgText = await res.text();

		const texture = await new Promise<PIXI.Texture>((resolve, reject) => {
			const img = new Image();
			img.onload = () => {
				const canvas = document.createElement('canvas');
				canvas.width = size;
				canvas.height = size;
				const ctx = canvas.getContext('2d')!;
				ctx.drawImage(img, 0, 0, size, size);
				URL.revokeObjectURL(img.src);
				const source = new PIXI.ImageSource({ resource: canvas, alphaMode: 'no-premultiply-alpha' });
				resolve(new PIXI.Texture({ source }));
			};
			img.onerror = () => {
				URL.revokeObjectURL(img.src);
				reject(new Error('Failed to load SVG as image'));
			};
			const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
			img.src = URL.createObjectURL(blob);
		});

		textureCache.set(key, texture);
		return texture;
	} catch {
		return null;
	}
}

/**
 * Deterministically pick a colour from a seed string.
 * Returns a hex colour number (e.g. 0xRRGGBB).
 */
export function seedToColor(seed: string): number {
	let hash = 0;
	for (let i = 0; i < seed.length; i++) {
		hash = seed.charCodeAt(i) + ((hash << 5) - hash);
	}
	const r = (Math.abs(hash) >> 16) & 0xff;
	const g = (Math.abs(hash) >> 8) & 0xff;
	const b = Math.abs(hash) & 0xff;
	return (r << 16) | (g << 8) | b;
}

/**
 * Destroy all cached textures and free VRAM. Bumps the generation counter
 * so in-flight loads from previous callers are discarded.
 */
export function clearTextureCache(): void {
	generation++;
	for (const [, tex] of textureCache) {
		tex.destroy(true);
	}
	textureCache.clear();
}

/** Size constant for classic renderer textures. */
export const CLASSIC_TEXTURE_SIZE = CLASSIC_TEX_SIZE;

/** Size constant for habbo renderer textures. */
export const HABBO_TEXTURE_SIZE = HABBO_TEX_SIZE;

/** Text resolution multiplier for crisp rendering on HiDPI screens. */
export const TEXT_RESOLUTION = 2;
