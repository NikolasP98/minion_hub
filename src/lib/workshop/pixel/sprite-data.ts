/**
 * Sprite data management: character sprites, furniture, floor tiles, wall tiles,
 * speech bubbles, palette selection, and caching.
 *
 * Consolidates sprite storage/retrieval for the pixel workshop renderer.
 */

import { adjustSprite } from './colorize';
import type { Direction, FloorColor, SpriteData } from './types';
import { Direction as Dir } from './types';

// ════════════════════════════════════════════════════════════════
// Speech Bubble Sprites
// ════════════════════════════════════════════════════════════════

interface BubbleSpriteJson {
  palette: Record<string, string>;
  pixels: string[][];
}

function resolveBubbleSprite(data: BubbleSpriteJson): SpriteData {
  return data.pixels.map((row) => row.map((key) => data.palette[key] ?? key));
}

/** Module-level storage for bubble sprites keyed by type */
const bubbleSprites = new Map<string, SpriteData>();

/** Set bubble sprites from loaded JSON data. Call once during asset initialization. */
export function setBubbleSprites(sprites: Record<string, BubbleSpriteJson>): void {
  bubbleSprites.clear();
  for (const [key, data] of Object.entries(sprites)) {
    bubbleSprites.set(key, resolveBubbleSprite(data));
  }
}

/** Get a bubble sprite by type key (e.g. 'permission', 'waiting'). Returns null if not loaded. */
export function getBubbleSprite(type: string): SpriteData | null {
  return bubbleSprites.get(type) ?? null;
}

// ════════════════════════════════════════════════════════════════
// Furniture Sprites
// ════════════════════════════════════════════════════════════════

/** Module-level storage for furniture sprites keyed by type ID */
const furnitureSprites = new Map<string, SpriteData>();

/** Set furniture sprites from loaded asset data. Call once during asset initialization. */
export function setFurnitureSprites(sprites: Record<string, SpriteData>): void {
  furnitureSprites.clear();
  for (const [key, data] of Object.entries(sprites)) {
    furnitureSprites.set(key, data);
  }
}

/** Get a furniture sprite by type ID. Returns null if not loaded. */
export function getFurnitureSprite(type: string): SpriteData | null {
  return furnitureSprites.get(type) ?? null;
}

// ════════════════════════════════════════════════════════════════
// Floor Tile Sprites
// ════════════════════════════════════════════════════════════════

/** Default tile size (pixels) */
const TILE_SIZE = 16;

/** Default solid gray 16x16 tile used when floor tile PNGs are not loaded */
const DEFAULT_FLOOR_SPRITE: SpriteData = Array.from(
  { length: TILE_SIZE },
  () => Array(TILE_SIZE).fill('#808080') as string[],
);

/** Module-level storage for floor tile sprites (set once on load) */
let floorSprites: SpriteData[] = [];

/** Set floor tile sprites (called once when floor tile assets are loaded) */
export function setFloorSprites(sprites: SpriteData[]): void {
  floorSprites = sprites;
}

/**
 * Get the raw (grayscale) floor sprite for a pattern index (1-based).
 * Falls back to the default solid gray tile when no PNGs are loaded.
 * Returns null for invalid indices.
 */
export function getFloorSprite(patternIndex: number): SpriteData | null {
  const idx = patternIndex - 1;
  if (idx < 0) return null;
  if (idx < floorSprites.length) return floorSprites[idx];
  // No PNG sprites loaded -- return default solid tile for any valid pattern index
  if (floorSprites.length === 0 && patternIndex >= 1) return DEFAULT_FLOOR_SPRITE;
  return null;
}

// ════════════════════════════════════════════════════════════════
// Wall Tile Sprites
// ════════════════════════════════════════════════════════════════

/** Wall tile sets: each set has 16 sprites indexed by bitmask (0-15) */
let wallSets: SpriteData[][] = [];

/** Set wall tile sets (called once when wall tile assets are loaded) */
export function setWallSprites(sets: SpriteData[][]): void {
  wallSets = sets;
}

/**
 * Get a wall sprite by set index and bitmask.
 * Returns null if no wall sprites are loaded or the index is invalid.
 */
export function getWallSprite(setIndex: number, bitmask: number): SpriteData | null {
  if (wallSets.length === 0) return null;
  const sprites = wallSets[setIndex] ?? wallSets[0];
  return sprites[bitmask] ?? null;
}

// ════════════════════════════════════════════════════════════════
// Loaded Character Sprites (from PNG assets)
// ════════════════════════════════════════════════════════════════

interface LoadedCharacterData {
  down: SpriteData[];
  up: SpriteData[];
  right: SpriteData[];
}

let loadedCharacters: LoadedCharacterData[] | null = null;

/**
 * Set pre-colored character sprites loaded from PNG assets.
 * Call this when character sprite assets are loaded.
 */
export function setCharacterTemplates(data: LoadedCharacterData[]): void {
  loadedCharacters = data;
  // Clear cache so sprites are rebuilt from loaded data
  spriteCache.clear();
}

/** Flip a SpriteData horizontally (for generating left sprites from right) */
export function flipSpriteHorizontal(sprite: SpriteData): SpriteData {
  return sprite.map((row) => [...row].reverse());
}

// ════════════════════════════════════════════════════════════════
// Character Sprite Resolution + Caching
// ════════════════════════════════════════════════════════════════

export interface CharacterSprites {
  walk: Record<Direction, [SpriteData, SpriteData, SpriteData, SpriteData]>;
  typing: Record<Direction, [SpriteData, SpriteData]>;
  reading: Record<Direction, [SpriteData, SpriteData]>;
}

const spriteCache = new Map<string, CharacterSprites>();

/** Apply hue shift to every sprite in a CharacterSprites set */
export function hueShiftSprites(sprites: CharacterSprites, hueShift: number): CharacterSprites {
  const color: FloorColor = { h: hueShift, s: 0, b: 0, c: 0 };
  const shift = (s: SpriteData) => adjustSprite(s, color);
  const shiftWalk = (
    arr: [SpriteData, SpriteData, SpriteData, SpriteData],
  ): [SpriteData, SpriteData, SpriteData, SpriteData] => [
    shift(arr[0]),
    shift(arr[1]),
    shift(arr[2]),
    shift(arr[3]),
  ];
  const shiftPair = (arr: [SpriteData, SpriteData]): [SpriteData, SpriteData] => [
    shift(arr[0]),
    shift(arr[1]),
  ];

  return {
    walk: {
      [Dir.DOWN]: shiftWalk(sprites.walk[Dir.DOWN]),
      [Dir.UP]: shiftWalk(sprites.walk[Dir.UP]),
      [Dir.RIGHT]: shiftWalk(sprites.walk[Dir.RIGHT]),
      [Dir.LEFT]: shiftWalk(sprites.walk[Dir.LEFT]),
    } as Record<Direction, [SpriteData, SpriteData, SpriteData, SpriteData]>,
    typing: {
      [Dir.DOWN]: shiftPair(sprites.typing[Dir.DOWN]),
      [Dir.UP]: shiftPair(sprites.typing[Dir.UP]),
      [Dir.RIGHT]: shiftPair(sprites.typing[Dir.RIGHT]),
      [Dir.LEFT]: shiftPair(sprites.typing[Dir.LEFT]),
    } as Record<Direction, [SpriteData, SpriteData]>,
    reading: {
      [Dir.DOWN]: shiftPair(sprites.reading[Dir.DOWN]),
      [Dir.UP]: shiftPair(sprites.reading[Dir.UP]),
      [Dir.RIGHT]: shiftPair(sprites.reading[Dir.RIGHT]),
      [Dir.LEFT]: shiftPair(sprites.reading[Dir.LEFT]),
    } as Record<Direction, [SpriteData, SpriteData]>,
  };
}

/** Create a transparent placeholder sprite of given dimensions */
function emptySprite(w: number, h: number): SpriteData {
  const rows: string[][] = [];
  for (let y = 0; y < h; y++) {
    rows.push(new Array(w).fill(''));
  }
  return rows;
}

/**
 * Get the full CharacterSprites set for a palette index, with optional hue shift.
 * Results are cached by `paletteIndex:hueShift` key.
 */
export function getCharacterSprites(paletteIndex: number, hueShift = 0): CharacterSprites {
  const cacheKey = `${paletteIndex}:${hueShift}`;
  const cached = spriteCache.get(cacheKey);
  if (cached) return cached;

  let sprites: CharacterSprites;

  if (loadedCharacters) {
    // Use pre-colored character sprites directly (no palette swapping)
    const char = loadedCharacters[paletteIndex % loadedCharacters.length];
    const d = char.down;
    const u = char.up;
    const rt = char.right;
    const flip = flipSpriteHorizontal;

    sprites = {
      walk: {
        [Dir.DOWN]: [d[0], d[1], d[2], d[1]],
        [Dir.UP]: [u[0], u[1], u[2], u[1]],
        [Dir.RIGHT]: [rt[0], rt[1], rt[2], rt[1]],
        [Dir.LEFT]: [flip(rt[0]), flip(rt[1]), flip(rt[2]), flip(rt[1])],
      },
      typing: {
        [Dir.DOWN]: [d[3], d[4]],
        [Dir.UP]: [u[3], u[4]],
        [Dir.RIGHT]: [rt[3], rt[4]],
        [Dir.LEFT]: [flip(rt[3]), flip(rt[4])],
      },
      reading: {
        [Dir.DOWN]: [d[5], d[6]],
        [Dir.UP]: [u[5], u[6]],
        [Dir.RIGHT]: [rt[5], rt[6]],
        [Dir.LEFT]: [flip(rt[5]), flip(rt[6])],
      },
    };
  } else {
    // Fallback: return transparent placeholder sprites (16x32)
    const e = emptySprite(16, 32);
    const walkSet: [SpriteData, SpriteData, SpriteData, SpriteData] = [e, e, e, e];
    const pairSet: [SpriteData, SpriteData] = [e, e];
    sprites = {
      walk: {
        [Dir.DOWN]: walkSet,
        [Dir.UP]: walkSet,
        [Dir.RIGHT]: walkSet,
        [Dir.LEFT]: walkSet,
      },
      typing: {
        [Dir.DOWN]: pairSet,
        [Dir.UP]: pairSet,
        [Dir.RIGHT]: pairSet,
        [Dir.LEFT]: pairSet,
      },
      reading: {
        [Dir.DOWN]: pairSet,
        [Dir.UP]: pairSet,
        [Dir.RIGHT]: pairSet,
        [Dir.LEFT]: pairSet,
      },
    };
  }

  // Apply hue shift if non-zero
  if (hueShift !== 0) {
    sprites = hueShiftSprites(sprites, hueShift);
  }

  spriteCache.set(cacheKey, sprites);
  return sprites;
}

// ════════════════════════════════════════════════════════════════
// Diverse Palette Selection
// ════════════════════════════════════════════════════════════════

/** Number of built-in character palettes */
const PALETTE_COUNT = 6;

/** Minimum hue shift for repeated palettes (degrees) */
const HUE_SHIFT_MIN_DEG = 45;

/** Range of randomized hue shift above the minimum (degrees) */
const HUE_SHIFT_RANGE_DEG = 271;

/**
 * Pick a diverse palette for a new agent based on currently active agents.
 * First 6 agents each get a unique skin (random order). Beyond 6, skins
 * repeat in balanced rounds with a random hue shift (>=45 degrees).
 *
 * @param existingCharacters - iterable of current characters with palette and isSubagent fields
 * @returns palette index (0-5) and hue shift in degrees
 */
export function pickDiversePalette(
  existingCharacters: Iterable<{
    palette: number;
    isSubagent: boolean;
  }>,
): { palette: number; hueShift: number } {
  // Count how many non-sub-agents use each base palette (0-5)
  const counts = new Array(PALETTE_COUNT).fill(0) as number[];
  for (const ch of existingCharacters) {
    if (ch.isSubagent) continue;
    counts[ch.palette]++;
  }
  const minCount = Math.min(...counts);
  // Available = palettes at the minimum count (least used)
  const available: number[] = [];
  for (let i = 0; i < PALETTE_COUNT; i++) {
    if (counts[i] === minCount) available.push(i);
  }
  const palette = available[Math.floor(Math.random() * available.length)];
  // First round (minCount === 0): no hue shift. Subsequent rounds: random >= 45 degrees.
  let hueShift = 0;
  if (minCount > 0) {
    hueShift = HUE_SHIFT_MIN_DEG + Math.floor(Math.random() * HUE_SHIFT_RANGE_DEG);
  }
  return { palette, hueShift };
}
