/**
 * Parametric SVG shape registry for stock packaging visuals (P5.1c).
 * All shapes are hand-drawn in-repo (no external assets — CSP + licensing).
 *
 * Two families:
 * - VESSELS (subunit_svg): fillable containers drawn in a 64×140 viewBox.
 *   `body` is a closed path used both as the outline stroke and as the
 *   clipPath for the liquid fill; `fillTop`/`fillBottom` bound the y-range the
 *   fill fraction maps onto (linear — it's a gauge, not a volumetric model).
 * - CONTAINERS (unit_svg): outer packaging drawn in a 120×110 viewBox by
 *   UnitDiagram, which lays a marker grid inside `content` (inset rect).
 */

export interface VesselShape {
  id: string;
  /** Closed path: outline + fill clip. */
  body: string;
  /** Stroke-only decorations (caps, plungers, needles…). */
  extras?: string[];
  fillTop: number;
  fillBottom: number;
}

export const VESSEL_VIEWBOX = { w: 64, h: 140 };

export const VESSEL_SHAPES: VesselShape[] = [
  {
    id: 'bottle',
    body: 'M26 4 L38 4 L38 16 Q58 20 58 34 L58 124 Q58 136 46 136 L18 136 Q6 136 6 124 L6 34 Q6 20 26 16 Z',
    fillTop: 16,
    fillBottom: 136,
  },
  {
    id: 'vial',
    body: 'M18 12 L46 12 L48 16 L48 128 Q48 136 40 136 L24 136 Q16 136 16 128 L16 16 Z',
    extras: ['M20 4 L44 4 L44 12 L20 12 Z'],
    fillTop: 16,
    fillBottom: 136,
  },
  {
    id: 'ampoule',
    body: 'M30 4 L34 4 L36 40 Q54 52 54 92 Q54 136 32 136 Q10 136 10 92 Q10 52 28 40 Z',
    extras: ['M24 30 L40 30'],
    fillTop: 40,
    fillBottom: 136,
  },
  {
    id: 'jar',
    body: 'M14 32 L50 32 Q56 34 56 44 L56 122 Q56 136 42 136 L22 136 Q8 136 8 122 L8 44 Q8 34 14 32 Z',
    extras: ['M12 20 L52 20 L52 32 L12 32 Z'],
    fillTop: 32,
    fillBottom: 136,
  },
  {
    id: 'tube',
    body: 'M20 8 L44 8 L44 112 Q44 136 32 136 Q20 136 20 112 Z',
    extras: ['M16 14 L48 14'],
    fillTop: 8,
    fillBottom: 136,
  },
  {
    id: 'syringe',
    body: 'M18 28 L46 28 L46 104 L36 112 L36 118 L28 118 L28 112 L18 104 Z',
    extras: ['M24 4 L40 4 L40 10 L36 10 L36 28 M28 28 L28 10 L24 10 Z', 'M32 118 L32 136'],
    fillTop: 28,
    fillBottom: 104,
  },
  {
    id: 'dropper',
    body: 'M20 30 Q6 36 6 52 L6 122 Q6 136 20 136 L44 136 Q58 136 58 122 L58 52 Q58 36 44 30 Z',
    extras: ['M26 4 L38 4 L38 14 L42 14 L42 22 L22 22 L22 14 L26 14 Z'],
    fillTop: 30,
    fillBottom: 136,
  },
  {
    id: 'iv_bag',
    body: 'M16 14 L48 14 Q56 14 56 26 L56 106 Q56 122 44 124 L36 126 L36 136 L28 136 L28 126 L20 124 Q8 122 8 106 L8 26 Q8 14 16 14 Z',
    extras: ['M32 5 m-3 0 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0'],
    fillTop: 14,
    fillBottom: 124,
  },
];

export interface ContainerShape {
  id: string;
  /** Outline paths drawn in the 120×110 viewBox. */
  outline: string[];
  /** Inset rect the marker grid is laid out in. */
  content: { x: number; y: number; w: number; h: number };
}

export const CONTAINER_VIEWBOX = { w: 120, h: 110 };

export const CONTAINER_SHAPES: ContainerShape[] = [
  {
    id: 'box',
    outline: ['M8 12 L112 12 L112 102 L8 102 Z'],
    content: { x: 16, y: 20, w: 88, h: 74 },
  },
  {
    id: 'carton',
    outline: ['M8 22 L112 22 L112 102 L8 102 Z', 'M8 22 L20 6 L100 6 L112 22', 'M60 6 L60 22'],
    content: { x: 16, y: 30, w: 88, h: 64 },
  },
  {
    id: 'tray',
    outline: ['M8 20 Q8 12 16 12 L104 12 Q112 12 112 20 L112 94 Q112 102 104 102 L16 102 Q8 102 8 94 Z'],
    content: { x: 16, y: 20, w: 88, h: 74 },
  },
  {
    id: 'pouch',
    outline: ['M20 10 L100 10 L112 96 Q112 104 104 104 L16 104 Q8 104 8 96 Z', 'M20 20 L100 20'],
    content: { x: 20, y: 28, w: 80, h: 68 },
  },
  {
    id: 'strip',
    outline: ['M8 34 Q8 26 16 26 L104 26 Q112 26 112 34 L112 80 Q112 88 104 88 L16 88 Q8 88 8 80 Z'],
    content: { x: 16, y: 34, w: 88, h: 46 },
  },
];

export const DEFAULT_VESSEL = 'bottle';
export const DEFAULT_CONTAINER = 'box';

export function vesselShape(id?: string | null): VesselShape {
  return VESSEL_SHAPES.find((s) => s.id === id) ?? VESSEL_SHAPES.find((s) => s.id === DEFAULT_VESSEL)!;
}

export function containerShape(id?: string | null): ContainerShape {
  return CONTAINER_SHAPES.find((s) => s.id === id) ?? CONTAINER_SHAPES.find((s) => s.id === DEFAULT_CONTAINER)!;
}

export interface MarkerCell {
  cx: number;
  cy: number;
  r: number;
  /** 0..1 fill of this marker (partial markers clip the fill circle). */
  fill: number;
}

/** Beyond this, UnitDiagram falls back to a numeric caption instead of a grid. */
export const MAX_MARKERS = 60;

/**
 * Lay `count` markers in a near-square grid inside `content`, filling
 * row-major from the top-left with `filled` (possibly fractional) subunits.
 * Returns [] when count is invalid or exceeds MAX_MARKERS.
 */
export function markerGrid(content: ContainerShape['content'], count: number, filled: number): MarkerCell[] {
  if (!Number.isFinite(count) || count < 1 || count > MAX_MARKERS) return [];
  const n = Math.floor(count);
  const cols = Math.ceil(Math.sqrt((n * content.w) / content.h));
  const rows = Math.ceil(n / cols);
  const cellW = content.w / cols;
  const cellH = content.h / rows;
  const r = Math.max(2, Math.min(cellW, cellH) * 0.38);
  const clamped = Math.max(0, Math.min(filled, n));
  const cells: MarkerCell[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    cells.push({
      cx: content.x + col * cellW + cellW / 2,
      cy: content.y + row * cellH + cellH / 2,
      r,
      fill: Math.max(0, Math.min(1, clamped - i)),
    });
  }
  return cells;
}
