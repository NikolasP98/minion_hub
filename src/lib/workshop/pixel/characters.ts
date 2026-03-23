/**
 * Character finite state machine: idle/walk/type states with wander AI.
 *
 * Each character cycles through: typing at desk -> idle wandering -> walking
 * to random tiles or back to their assigned seat.
 *
 * IMPROVEMENT: Walk step tracking uses a `pathIndex` field instead of
 * `path.shift()` to avoid O(n) array mutations on every tile transition.
 */

import type { CharacterSprites } from './sprite-data';
import type {
  Character,
  CharacterState as CharacterStateVal,
  Seat,
  SpriteData,
  TileType as TileTypeVal,
} from './types';
import { CharacterState, Direction, TILE_SIZE } from './types';
import {
  WALK_SPEED_PX_PER_SEC,
  WALK_SPEED_RETURN_PX_PER_SEC,
  WALK_FRAME_DURATION_SEC,
  TYPE_FRAME_DURATION_SEC,
  READ_FRAME_DURATION_SEC,
  WANDER_PAUSE_MIN_SEC,
  WANDER_PAUSE_MAX_SEC,
  WANDER_MOVES_BEFORE_REST_MIN,
  WANDER_MOVES_BEFORE_REST_MAX,
  SEAT_REST_MIN_SEC,
  SEAT_REST_MAX_SEC,
} from './constants';

// ── Reading Tool Detection ──────────────────────────────────────

/** Tools that show reading animation instead of typing */
const READING_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'WebFetch',
  'WebSearch',
]);

export function isReadingTool(tool: string | null): boolean {
  if (!tool) return false;
  return READING_TOOLS.has(tool);
}

// ── Tile Helpers ────────────────────────────────────────────────

/** Pixel center of a tile */
function tileCenter(
  col: number,
  row: number,
): { x: number; y: number } {
  return {
    x: col * TILE_SIZE + TILE_SIZE / 2,
    y: row * TILE_SIZE + TILE_SIZE / 2,
  };
}

/** Direction from one tile to an adjacent tile */
function directionBetween(
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
): (typeof Direction)[keyof typeof Direction] {
  const dc = toCol - fromCol;
  const dr = toRow - fromRow;
  if (dc > 0) return Direction.RIGHT;
  if (dc < 0) return Direction.LEFT;
  if (dr > 0) return Direction.DOWN;
  return Direction.UP;
}

// ── Random Utilities ────────────────────────────────────────────

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

// ── Character Creation ──────────────────────────────────────────

export function createCharacter(
  id: number,
  palette: number,
  seatId: string | null,
  seat: Seat | null,
  hueShift = 0,
): Character {
  const col = seat ? seat.seatCol : 1;
  const row = seat ? seat.seatRow : 1;
  const center = tileCenter(col, row);
  return {
    id,
    state: CharacterState.TYPE,
    dir: seat ? seat.facingDir : Direction.DOWN,
    x: center.x,
    y: center.y,
    tileCol: col,
    tileRow: row,
    path: [],
    pathIndex: 0,
    moveProgress: 0,
    currentTool: null,
    palette,
    hueShift,
    frame: 0,
    frameTimer: 0,
    wanderTimer: 0,
    wanderCount: 0,
    wanderLimit: randomInt(
      WANDER_MOVES_BEFORE_REST_MIN,
      WANDER_MOVES_BEFORE_REST_MAX,
    ),
    isActive: true,
    seatId,
    bubbleType: null,
    bubbleTimer: 0,
    seatTimer: 0,
    isSubagent: false,
    parentAgentId: null,
    matrixEffect: null,
    matrixEffectTimer: 0,
    matrixEffectSeeds: [],
    walkSpeedOverride: null,
  };
}

// ── Pathfinding Callback Type ───────────────────────────────────

/**
 * Pathfinding function signature. The caller provides an implementation
 * (e.g. BFS over the tile map) so this module stays decoupled from the
 * specific map representation.
 */
export type FindPathFn = (
  startCol: number,
  startRow: number,
  endCol: number,
  endRow: number,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<number>,
) => Array<{ col: number; row: number }>;

// ── Character FSM Update ────────────────────────────────────────

/**
 * Helper: assign a fresh path to a character (resets pathIndex and moveProgress).
 */
function assignPath(
  ch: Character,
  path: Array<{ col: number; row: number }>,
): void {
  ch.path = path;
  ch.pathIndex = 0;
  ch.moveProgress = 0;
}

/**
 * Returns the number of remaining path steps for the character.
 */
function remainingSteps(ch: Character): number {
  return ch.path.length - ch.pathIndex;
}

export function updateCharacter(
  ch: Character,
  dt: number,
  walkableTiles: Array<{ col: number; row: number }>,
  seats: Map<string, Seat>,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<number>,
  findPath: FindPathFn,
): void {
  ch.frameTimer += dt;

  switch (ch.state) {
    case CharacterState.TYPE: {
      const frameDuration = isReadingTool(ch.currentTool)
        ? READ_FRAME_DURATION_SEC   // 0.5s for reading
        : TYPE_FRAME_DURATION_SEC;  // 0.3s for typing
      if (ch.frameTimer >= frameDuration) {
        ch.frameTimer -= frameDuration;
        ch.frame = (ch.frame + 1) % 2;
      }
      // If no longer active, stand up and start wandering (after seatTimer expires)
      if (!ch.isActive) {
        if (ch.seatTimer > 0) {
          ch.seatTimer -= dt;
          break;
        }
        ch.seatTimer = 0; // clear sentinel
        ch.state = CharacterState.IDLE;
        ch.frame = 0;
        ch.frameTimer = 0;
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
        ch.wanderCount = 0;
        ch.wanderLimit = randomInt(
          WANDER_MOVES_BEFORE_REST_MIN,
          WANDER_MOVES_BEFORE_REST_MAX,
        );
      }
      break;
    }

    case CharacterState.IDLE: {
      // No idle animation -- static pose
      ch.frame = 0;
      if (ch.seatTimer < 0) ch.seatTimer = 0; // clear turn-end sentinel
      // If became active, pathfind to seat
      if (ch.isActive) {
        if (!ch.seatId) {
          // No seat assigned -- type in place
          ch.state = CharacterState.TYPE;
          ch.frame = 0;
          ch.frameTimer = 0;
          break;
        }
        const seat = seats.get(ch.seatId);
        if (seat) {
          const path = findPath(
            ch.tileCol,
            ch.tileRow,
            seat.seatCol,
            seat.seatRow,
            tileMap,
            blockedTiles,
          );
          if (path.length > 0) {
            assignPath(ch, path);
            ch.state = CharacterState.WALK;
            ch.frame = 0;
            ch.frameTimer = 0;
            ch.walkSpeedOverride = WALK_SPEED_RETURN_PX_PER_SEC;
          } else {
            // Already at seat or no path -- sit down
            ch.state = CharacterState.TYPE;
            ch.dir = seat.facingDir;
            ch.frame = 0;
            ch.frameTimer = 0;
          }
        }
        break;
      }
      // Countdown wander timer
      ch.wanderTimer -= dt;
      if (ch.wanderTimer <= 0) {
        // Check if we've wandered enough -- return to seat for a rest
        if (ch.wanderCount >= ch.wanderLimit && ch.seatId) {
          const seat = seats.get(ch.seatId);
          if (seat) {
            const path = findPath(
              ch.tileCol,
              ch.tileRow,
              seat.seatCol,
              seat.seatRow,
              tileMap,
              blockedTiles,
            );
            if (path.length > 0) {
              assignPath(ch, path);
              ch.state = CharacterState.WALK;
              ch.frame = 0;
              ch.frameTimer = 0;
              ch.walkSpeedOverride = WALK_SPEED_RETURN_PX_PER_SEC;
              break;
            }
          }
        }
        if (walkableTiles.length > 0) {
          const target =
            walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
          const path = findPath(
            ch.tileCol,
            ch.tileRow,
            target.col,
            target.row,
            tileMap,
            blockedTiles,
          );
          if (path.length > 0) {
            assignPath(ch, path);
            ch.state = CharacterState.WALK;
            ch.frame = 0;
            ch.frameTimer = 0;
            ch.wanderCount++;
          }
        }
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
      }
      break;
    }

    case CharacterState.WALK: {
      // Walk animation
      if (ch.frameTimer >= WALK_FRAME_DURATION_SEC) {
        ch.frameTimer -= WALK_FRAME_DURATION_SEC;
        ch.frame = (ch.frame + 1) % 4;
      }

      if (remainingSteps(ch) === 0) {
        // Path complete -- snap to tile center and transition
        const center = tileCenter(ch.tileCol, ch.tileRow);
        ch.x = center.x;
        ch.y = center.y;

        if (ch.isActive) {
          if (!ch.seatId) {
            // No seat -- type in place
            ch.state = CharacterState.TYPE;
          } else {
            const seat = seats.get(ch.seatId);
            if (
              seat &&
              ch.tileCol === seat.seatCol &&
              ch.tileRow === seat.seatRow
            ) {
              ch.state = CharacterState.TYPE;
              ch.dir = seat.facingDir;
            } else {
              ch.state = CharacterState.IDLE;
            }
          }
        } else {
          // Check if arrived at assigned seat -- sit down for a rest before wandering again
          if (ch.seatId) {
            const seat = seats.get(ch.seatId);
            if (
              seat &&
              ch.tileCol === seat.seatCol &&
              ch.tileRow === seat.seatRow
            ) {
              ch.state = CharacterState.TYPE;
              ch.dir = seat.facingDir;
              ch.walkSpeedOverride = null;
              // seatTimer < 0 is a sentinel from setAgentActive(false) meaning
              // "turn just ended" -- skip the long rest so idle transition is immediate
              if (ch.seatTimer < 0) {
                ch.seatTimer = 0;
              } else {
                ch.seatTimer = randomRange(SEAT_REST_MIN_SEC, SEAT_REST_MAX_SEC);
              }
              ch.wanderCount = 0;
              ch.wanderLimit = randomInt(
                WANDER_MOVES_BEFORE_REST_MIN,
                WANDER_MOVES_BEFORE_REST_MAX,
              );
              ch.frame = 0;
              ch.frameTimer = 0;
              break;
            }
          }
          ch.state = CharacterState.IDLE;
          ch.wanderTimer = randomRange(
            WANDER_PAUSE_MIN_SEC,
            WANDER_PAUSE_MAX_SEC,
          );
        }
        ch.frame = 0;
        ch.frameTimer = 0;
        break;
      }

      // Move toward next tile in path (using index instead of shift)
      const nextTile = ch.path[ch.pathIndex];
      ch.dir = directionBetween(
        ch.tileCol,
        ch.tileRow,
        nextTile.col,
        nextTile.row,
      );

      const speed = ch.walkSpeedOverride ?? WALK_SPEED_PX_PER_SEC;
      ch.moveProgress += (speed / TILE_SIZE) * dt;

      const fromCenter = tileCenter(ch.tileCol, ch.tileRow);
      const toCenter = tileCenter(nextTile.col, nextTile.row);
      const t = Math.min(ch.moveProgress, 1);
      ch.x = fromCenter.x + (toCenter.x - fromCenter.x) * t;
      ch.y = fromCenter.y + (toCenter.y - fromCenter.y) * t;

      if (ch.moveProgress >= 1) {
        // Arrived at next tile -- advance index instead of shifting
        ch.tileCol = nextTile.col;
        ch.tileRow = nextTile.row;
        ch.x = toCenter.x;
        ch.y = toCenter.y;
        ch.pathIndex++;
        ch.moveProgress = 0;
      }

      // If became active while wandering, repath to seat
      if (ch.isActive && ch.seatId) {
        const seat = seats.get(ch.seatId);
        if (seat) {
          const lastStepIdx = ch.path.length - 1;
          const lastStep = lastStepIdx >= 0 ? ch.path[lastStepIdx] : undefined;
          if (
            !lastStep ||
            lastStep.col !== seat.seatCol ||
            lastStep.row !== seat.seatRow
          ) {
            const newPath = findPath(
              ch.tileCol,
              ch.tileRow,
              seat.seatCol,
              seat.seatRow,
              tileMap,
              blockedTiles,
            );
            if (newPath.length > 0) {
              assignPath(ch, newPath);
            }
          }
        }
      }
      break;
    }
  }
}

// ── Sprite Selection ────────────────────────────────────────────

/** Get the correct sprite frame for a character's current state and direction */
export function getCharacterSprite(
  ch: Character,
  sprites: CharacterSprites,
): SpriteData {
  switch (ch.state) {
    case CharacterState.TYPE:
      if (isReadingTool(ch.currentTool)) {
        return sprites.reading[ch.dir][ch.frame % 2];
      }
      return sprites.typing[ch.dir][ch.frame % 2];
    case CharacterState.WALK:
      // 4-frame animation cycle maps to 2-frame sprites: [0,1,2,3] -> [0,1,0,1]
      return sprites.walk[ch.dir][ch.frame % 2];
    case CharacterState.IDLE:
      return sprites.walk[ch.dir][1];
    default:
      return sprites.walk[ch.dir][1];
  }
}
