/**
 * Asset Loader
 *
 * Loads PNG sprite assets from /pixel-office/ static directory and converts
 * them to SpriteData (2D hex color arrays) for the pixel office renderer.
 *
 * In the original pixel-agents VS Code extension, PNGs were parsed server-side
 * with pngjs. Here we use browser Image + Canvas for the same conversion.
 */

import type { SpriteData } from './types';
import { TILE_SIZE } from './types';
import { setFloorSprites } from './floor-tiles';
import { setWallSprites } from './wall-tiles';
import { setCharacterTemplates, setFurnitureSprites } from './sprite-data';
import { buildDynamicCatalog } from './furniture-catalog';

const PNG_ALPHA_THRESHOLD = 2;

/**
 * Load an image from a URL and return its pixel data as SpriteData.
 */
async function loadPngAsSpriteData(url: string): Promise<SpriteData> {
	const img = await loadImage(url);
	const canvas = document.createElement('canvas');
	canvas.width = img.width;
	canvas.height = img.height;
	const ctx = canvas.getContext('2d')!;
	ctx.drawImage(img, 0, 0);
	const imageData = ctx.getImageData(0, 0, img.width, img.height);
	return imageDataToSpriteData(imageData);
}

function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
		img.src = url;
	});
}

function imageDataToSpriteData(imageData: ImageData): SpriteData {
	const { width, height, data } = imageData;
	const sprite: SpriteData = [];
	for (let y = 0; y < height; y++) {
		const row: string[] = [];
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			const r = data[i];
			const g = data[i + 1];
			const b = data[i + 2];
			const a = data[i + 3];
			if (a < PNG_ALPHA_THRESHOLD) {
				row.push('');
			} else if (a < 255) {
				row.push(
					`#${hex2(r)}${hex2(g)}${hex2(b)}${hex2(a)}`,
				);
			} else {
				row.push(`#${hex2(r)}${hex2(g)}${hex2(b)}`);
			}
		}
		sprite.push(row);
	}
	return sprite;
}

function hex2(n: number): string {
	return n.toString(16).padStart(2, '0').toUpperCase();
}

/**
 * Extract individual tile sprites from a tileset image.
 * The tileset is a horizontal strip of TILE_SIZE × TILE_SIZE tiles.
 */
function extractTilesFromSheet(
	imageData: ImageData,
	tileW: number,
	tileH: number,
): SpriteData[] {
	const { width, data } = imageData;
	const cols = Math.floor(width / tileW);
	const rows = Math.floor(imageData.height / tileH);
	const tiles: SpriteData[] = [];

	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const tile: SpriteData = [];
			for (let y = 0; y < tileH; y++) {
				const tileRow: string[] = [];
				for (let x = 0; x < tileW; x++) {
					const px = col * tileW + x;
					const py = row * tileH + y;
					const i = (py * width + px) * 4;
					const r = data[i];
					const g = data[i + 1];
					const b = data[i + 2];
					const a = data[i + 3];
					if (a < PNG_ALPHA_THRESHOLD) {
						tileRow.push('');
					} else if (a < 255) {
						tileRow.push(`#${hex2(r)}${hex2(g)}${hex2(b)}${hex2(a)}`);
					} else {
						tileRow.push(`#${hex2(r)}${hex2(g)}${hex2(b)}`);
					}
				}
				tile.push(tileRow);
			}
			tiles.push(tile);
		}
	}
	return tiles;
}

/**
 * Load character sprite sheets from /pixel-office/characters/.
 * Each char_N.png is 112×96: 7 frames × 16px wide, 3 direction rows × 32px tall.
 * Returns array of 6 character sprite sets (one per palette).
 */
export interface CharacterSpriteSheet {
	/** walk1, walk2, walk3, type1, type2, read1, read2 for each of 3 directions (down, up, right) */
	frames: SpriteData[][]; // [direction][frame]
}

async function loadCharacterSheet(url: string): Promise<CharacterSpriteSheet> {
	const img = await loadImage(url);
	const canvas = document.createElement('canvas');
	canvas.width = img.width;
	canvas.height = img.height;
	const ctx = canvas.getContext('2d')!;
	ctx.drawImage(img, 0, 0);
	const imageData = ctx.getImageData(0, 0, img.width, img.height);

	const frameW = 16;
	const frameH = 32; // 24px sprite + 8px top padding
	const framesPerRow = 7;
	const directions = 3; // down, up, right (left = flipped right)

	const frames: SpriteData[][] = [];
	for (let dir = 0; dir < directions; dir++) {
		const dirFrames: SpriteData[] = [];
		for (let f = 0; f < framesPerRow; f++) {
			const sprite: SpriteData = [];
			for (let y = 0; y < frameH; y++) {
				const row: string[] = [];
				for (let x = 0; x < frameW; x++) {
					const px = f * frameW + x;
					const py = dir * frameH + y;
					const i = (py * imageData.width + px) * 4;
					const r = imageData.data[i];
					const g = imageData.data[i + 1];
					const b = imageData.data[i + 2];
					const a = imageData.data[i + 3];
					if (a < PNG_ALPHA_THRESHOLD) {
						row.push('');
					} else if (a < 255) {
						row.push(`#${hex2(r)}${hex2(g)}${hex2(b)}${hex2(a)}`);
					} else {
						row.push(`#${hex2(r)}${hex2(g)}${hex2(b)}`);
					}
				}
				sprite.push(row);
			}
			dirFrames.push(sprite);
		}
		frames.push(dirFrames);
	}

	return { frames };
}

/**
 * Load all pixel office assets. Call once during initialization.
 */
export async function loadPixelOfficeAssets(): Promise<{
	characterSheets: CharacterSpriteSheet[];
}> {
	const basePath = '/pixel-office';

	// Load floor tiles (individual PNGs, each 16×16)
	const floorSprites: SpriteData[] = [];
	for (let i = 0; i <= 8; i++) {
		try {
			const sprite = await loadPngAsSpriteData(`${basePath}/floors/floor_${i}.png`);
			floorSprites.push(sprite);
		} catch {
			// Skip missing floor tiles
		}
	}
	if (floorSprites.length > 0) {
		setFloorSprites(floorSprites);
		console.info(`[Workshop Pixel] Loaded ${floorSprites.length} floor tile patterns`);
	}

	// Load wall tiles (wall_0.png is a 4×4 grid of 16×32 pieces = 64×128)
	try {
		const wallImg = await loadImage(`${basePath}/walls/wall_0.png`);
		const canvas = document.createElement('canvas');
		canvas.width = wallImg.width;
		canvas.height = wallImg.height;
		const ctx = canvas.getContext('2d')!;
		ctx.drawImage(wallImg, 0, 0);
		const wallImageData = ctx.getImageData(0, 0, wallImg.width, wallImg.height);
		const wallTiles = extractTilesFromSheet(wallImageData, TILE_SIZE, 32);
		if (wallTiles.length > 0) {
			// Walls come as a single set of 16 bitmask sprites
			setWallSprites([wallTiles]);
			console.info(`[Workshop Pixel] Loaded ${wallTiles.length} wall tile sprites`);
		}
	} catch {
		// Wall sprites are optional — falls back to solid color
	}

	// Load character sprites (6 palettes) and wire into sprite-data module
	const characterSheets: CharacterSpriteSheet[] = [];
	for (let i = 0; i < 6; i++) {
		try {
			const sheet = await loadCharacterSheet(`${basePath}/characters/char_${i}.png`);
			characterSheets.push(sheet);
		} catch {
			// Skip missing character sheets
		}
	}
	if (characterSheets.length > 0) {
		// Convert CharacterSpriteSheet[] → LoadedCharacterData[] for setCharacterTemplates
		const charData = characterSheets.map((sheet) => ({
			down: sheet.frames[0],   // direction 0 = down
			up: sheet.frames[1],     // direction 1 = up
			right: sheet.frames[2],  // direction 2 = right (left = flipped at runtime)
		}));
		setCharacterTemplates(charData);
		console.info(`[Workshop Pixel] Loaded ${characterSheets.length} character palettes`);
	}

	// Load furniture sprites from manifest.json files in each furniture subdirectory
	try {
		await loadFurnitureAssets(basePath);
	} catch (e) {
		console.warn('[Workshop Pixel] Failed to load furniture assets:', e);
	}

	return { characterSheets };
}

/**
 * Load furniture sprites from /pixel-office/furniture/ subdirectories.
 * Each subdirectory has a manifest.json and one or more PNG sprite files.
 */
async function loadFurnitureAssets(basePath: string): Promise<void> {
	// Fetch the furniture directory listing - we need to discover what furniture exists.
	// Since we can't list directories in the browser, load a pre-built catalog index.
	// The original pixel-agents uses a furniture-catalog.json built by the asset pipeline.
	try {
		const resp = await fetch(`${basePath}/furniture/furniture-catalog.json`);
		if (!resp.ok) {
			console.info('[Workshop Pixel] No furniture-catalog.json found, skipping furniture');
			return;
		}
		const catalog: Array<{
			id: string;
			name: string;
			label: string;
			category: string;
			footprintW: number;
			footprintH: number;
			isDesk: boolean;
			canPlaceOnWalls?: boolean;
			canPlaceOnSurfaces?: boolean;
			backgroundTiles?: number;
			groupId?: string;
			orientation?: string;
			state?: string;
		}> = await resp.json();

		// Load each furniture sprite PNG
		const sprites: Record<string, SpriteData> = {};

		for (const item of catalog) {
			try {
				const baseId = item.groupId ?? item.id;
				const pngUrl = `${basePath}/furniture/${baseId}/${item.id}.png`;
				const sprite = await loadPngAsSpriteData(pngUrl);
				sprites[item.id] = sprite;
			} catch {
				// Skip individual furniture items that fail to load
			}
		}

		if (Object.keys(sprites).length > 0) {
			setFurnitureSprites(sprites);
			// Build the dynamic catalog with the format expected by buildDynamicCatalog
			const assetData = {
				catalog: catalog.filter(item => sprites[item.id]).map(item => {
					const sprite = sprites[item.id];
					return {
						id: item.id,
						label: item.label || item.name,
						category: item.category || 'misc',
						width: sprite[0]?.length ?? 16,
						height: sprite.length,
						footprintW: item.footprintW,
						footprintH: item.footprintH,
						isDesk: item.isDesk,
						groupId: item.groupId,
						orientation: item.orientation,
						state: item.state,
						canPlaceOnSurfaces: item.canPlaceOnSurfaces,
						backgroundTiles: item.backgroundTiles,
						canPlaceOnWalls: item.canPlaceOnWalls,
					};
				}),
				sprites,
			};
			buildDynamicCatalog(assetData);
			console.info(`[Workshop Pixel] Loaded ${Object.keys(sprites).length}/${catalog.length} furniture sprites`);
		}
	} catch {
		// No catalog file — furniture rendering will be skipped
	}
}
