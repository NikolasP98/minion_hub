/**
 * Matrix-style digital rain spawn/despawn effect.
 *
 * Per-pixel rendering: each column sweeps top-to-bottom with a bright head
 * and fading green trail. Spawn reveals character pixels behind the sweep;
 * despawn consumes character pixels with green rain trails.
 *
 * Used for agent spawn/despawn animations (~0.3s duration).
 */

import type { Character, SpriteData } from './types';

// ── Constants ────────────────────────────────────────────────────

/** Duration of the matrix effect in seconds */
const MATRIX_EFFECT_DURATION = 0.3;

/** Number of trail pixels behind the sweep head */
const MATRIX_TRAIL_LENGTH = 6;

/** Sprite width in pixel columns */
const MATRIX_SPRITE_COLS = 16;

/** Sprite height in pixel rows */
const MATRIX_SPRITE_ROWS = 24;

/** Flicker sample rate (hash changes per second) */
const MATRIX_FLICKER_FPS = 30;

/** Hash threshold for flicker visibility (0-255; higher = more visible) */
const MATRIX_FLICKER_VISIBILITY_THRESHOLD = 180;

/** Fraction of total duration used for per-column stagger offset */
const MATRIX_COLUMN_STAGGER_RANGE = 0.3;

/** Color of the bright sweep head pixel */
const MATRIX_HEAD_COLOR = '#ccffcc';

/** Alpha of green overlay on revealed character pixels in trail zone */
const MATRIX_TRAIL_OVERLAY_ALPHA = 0.6;

/** Alpha of green trail on empty (no character pixel) positions */
const MATRIX_TRAIL_EMPTY_ALPHA = 0.5;

/** Trail position threshold: bright green below this, medium green above */
const MATRIX_TRAIL_MID_THRESHOLD = 0.33;

/** Trail position threshold: medium green below this, dim green above */
const MATRIX_TRAIL_DIM_THRESHOLD = 0.66;

// ── Flicker ──────────────────────────────────────────────────────

/** Hash-based flicker: ~70% visible for shimmer effect */
function flickerVisible(col: number, row: number, time: number): boolean {
  const t = Math.floor(time * MATRIX_FLICKER_FPS);
  const hash = (col * 7 + row * 13 + t * 31) & 0xff;
  return hash < MATRIX_FLICKER_VISIBILITY_THRESHOLD;
}

// ── Seed Generation ──────────────────────────────────────────────

function generateSeeds(): number[] {
  const seeds: number[] = [];
  for (let i = 0; i < MATRIX_SPRITE_COLS; i++) {
    seeds.push(Math.random());
  }
  return seeds;
}

export { generateSeeds as matrixEffectSeeds };

// ── Rendering ────────────────────────────────────────────────────

/**
 * Render a character with a Matrix-style digital rain spawn/despawn effect.
 * Per-pixel rendering: each column sweeps top-to-bottom with a bright head
 * and fading green trail.
 *
 * @param ctx - Canvas 2D rendering context
 * @param ch - Character with matrixEffect, matrixEffectTimer, and matrixEffectSeeds
 * @param spriteData - The character's current sprite frame
 * @param drawX - Pixel X position to draw at
 * @param drawY - Pixel Y position to draw at
 * @param zoom - Integer zoom factor (pixels per sprite pixel)
 */
export function renderMatrixEffect(
  ctx: CanvasRenderingContext2D,
  ch: Character,
  spriteData: SpriteData,
  drawX: number,
  drawY: number,
  zoom: number,
): void {
  const progress = ch.matrixEffectTimer / MATRIX_EFFECT_DURATION;
  const isSpawn = ch.matrixEffect === 'spawn';
  const time = ch.matrixEffectTimer;
  const totalSweep = MATRIX_SPRITE_ROWS + MATRIX_TRAIL_LENGTH;

  for (let col = 0; col < MATRIX_SPRITE_COLS; col++) {
    // Stagger: each column starts at a slightly different time
    const stagger =
      (ch.matrixEffectSeeds[col] ?? 0) * MATRIX_COLUMN_STAGGER_RANGE;
    const colProgress = Math.max(
      0,
      Math.min(
        1,
        (progress - stagger) / (1 - MATRIX_COLUMN_STAGGER_RANGE),
      ),
    );
    const headRow = colProgress * totalSweep;

    for (let row = 0; row < MATRIX_SPRITE_ROWS; row++) {
      const pixel = spriteData[row]?.[col];
      const hasPixel = pixel !== undefined && pixel !== '';
      const distFromHead = headRow - row;
      const px = drawX + col * zoom;
      const py = drawY + row * zoom;

      if (isSpawn) {
        // Spawn: head sweeps down revealing character pixels
        if (distFromHead < 0) {
          // Above head: invisible
          continue;
        } else if (distFromHead < 1) {
          // Head pixel: bright white-green
          ctx.fillStyle = MATRIX_HEAD_COLOR;
          ctx.fillRect(px, py, zoom, zoom);
        } else if (distFromHead < MATRIX_TRAIL_LENGTH) {
          // Trail zone: show character pixel with green overlay, or just green if no pixel
          const trailPos = distFromHead / MATRIX_TRAIL_LENGTH;
          if (hasPixel) {
            // Draw original pixel
            ctx.fillStyle = pixel;
            ctx.fillRect(px, py, zoom, zoom);
            // Green overlay that fades as trail progresses
            const greenAlpha =
              (1 - trailPos) * MATRIX_TRAIL_OVERLAY_ALPHA;
            if (flickerVisible(col, row, time)) {
              ctx.fillStyle = `rgba(0, 255, 65, ${greenAlpha})`;
              ctx.fillRect(px, py, zoom, zoom);
            }
          } else {
            // No character pixel: fading green trail
            if (flickerVisible(col, row, time)) {
              const alpha =
                (1 - trailPos) * MATRIX_TRAIL_EMPTY_ALPHA;
              ctx.fillStyle =
                trailPos < MATRIX_TRAIL_MID_THRESHOLD
                  ? `rgba(0, 255, 65, ${alpha})`
                  : trailPos < MATRIX_TRAIL_DIM_THRESHOLD
                    ? `rgba(0, 170, 40, ${alpha})`
                    : `rgba(0, 85, 20, ${alpha})`;
              ctx.fillRect(px, py, zoom, zoom);
            }
          }
        } else {
          // Below trail: normal character pixel
          if (hasPixel) {
            ctx.fillStyle = pixel;
            ctx.fillRect(px, py, zoom, zoom);
          }
        }
      } else {
        // Despawn: head sweeps down consuming character pixels
        if (distFromHead < 0) {
          // Above head: normal character pixel (not yet consumed)
          if (hasPixel) {
            ctx.fillStyle = pixel;
            ctx.fillRect(px, py, zoom, zoom);
          }
        } else if (distFromHead < 1) {
          // Head pixel: bright white-green
          ctx.fillStyle = MATRIX_HEAD_COLOR;
          ctx.fillRect(px, py, zoom, zoom);
        } else if (distFromHead < MATRIX_TRAIL_LENGTH) {
          // Trail zone: fading green
          if (flickerVisible(col, row, time)) {
            const trailPos = distFromHead / MATRIX_TRAIL_LENGTH;
            const alpha =
              (1 - trailPos) * MATRIX_TRAIL_EMPTY_ALPHA;
            ctx.fillStyle =
              trailPos < MATRIX_TRAIL_MID_THRESHOLD
                ? `rgba(0, 255, 65, ${alpha})`
                : trailPos < MATRIX_TRAIL_DIM_THRESHOLD
                  ? `rgba(0, 170, 40, ${alpha})`
                  : `rgba(0, 85, 20, ${alpha})`;
            ctx.fillRect(px, py, zoom, zoom);
          }
        }
        // Below trail: nothing (consumed)
      }
    }
  }
}
