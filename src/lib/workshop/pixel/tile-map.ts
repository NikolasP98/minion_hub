import { TileType, MAX_COLS } from './types';

/** Check if a tile is walkable (floor, carpet, or doorway, and not blocked by furniture) */
export function isWalkable(
  col: number,
  row: number,
  tileMap: TileType[][],
  blockedTiles: Set<number>,
): boolean {
  const rows = tileMap.length;
  const cols = rows > 0 ? tileMap[0].length : 0;
  if (row < 0 || row >= rows || col < 0 || col >= cols) return false;
  const t = tileMap[row][col];
  if (t === TileType.WALL || t === TileType.VOID) return false;
  if (blockedTiles.has(col + row * MAX_COLS)) return false;
  return true;
}

/** Get walkable tile positions (grid coords) for wandering */
export function getWalkableTiles(
  tileMap: TileType[][],
  blockedTiles: Set<number>,
): Array<{ col: number; row: number }> {
  const rows = tileMap.length;
  const cols = rows > 0 ? tileMap[0].length : 0;
  const tiles: Array<{ col: number; row: number }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isWalkable(c, r, tileMap, blockedTiles)) {
        tiles.push({ col: c, row: r });
      }
    }
  }
  return tiles;
}

/** Encode a (col, row) pair into a single integer key for flat map lookups */
function tileKey(col: number, row: number): number {
  return col + row * MAX_COLS;
}

/** Decode an integer key back into (col, row) */
function fromTileKey(key: number): { col: number; row: number } {
  const row = Math.floor(key / MAX_COLS);
  const col = key - row * MAX_COLS;
  return { col, row };
}

/** BFS pathfinding on 4-connected grid (no diagonals). Returns path excluding start, including end. */
export function findPath(
  startCol: number,
  startRow: number,
  endCol: number,
  endRow: number,
  tileMap: TileType[][],
  blockedTiles: Set<number>,
): Array<{ col: number; row: number }> {
  if (startCol === endCol && startRow === endRow) return [];

  const startK = tileKey(startCol, startRow);
  const endK = tileKey(endCol, endRow);

  // End must be walkable
  if (!isWalkable(endCol, endRow, tileMap, blockedTiles)) {
    return [];
  }

  const visited = new Set<number>();
  visited.add(startK);

  const parent = new Map<number, number>();
  const queue: Array<{ col: number; row: number }> = [{ col: startCol, row: startRow }];

  const dirs = [
    { dc: 0, dr: -1 }, // up
    { dc: 0, dr: 1 }, // down
    { dc: -1, dr: 0 }, // left
    { dc: 1, dr: 0 }, // right
  ];

  let qi = 0;
  while (qi < queue.length) {
    const curr = queue[qi++];
    const currK = tileKey(curr.col, curr.row);

    if (currK === endK) {
      // Reconstruct path
      const path: Array<{ col: number; row: number }> = [];
      let k = endK;
      while (k !== startK) {
        path.unshift(fromTileKey(k));
        k = parent.get(k)!;
      }
      return path;
    }

    for (const d of dirs) {
      const nc = curr.col + d.dc;
      const nr = curr.row + d.dr;
      const nk = tileKey(nc, nr);

      if (visited.has(nk)) continue;
      if (!isWalkable(nc, nr, tileMap, blockedTiles)) continue;

      visited.add(nk);
      parent.set(nk, currK);
      queue.push({ col: nc, row: nr });
    }
  }

  // No path found
  return [];
}
