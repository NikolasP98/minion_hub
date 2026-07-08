import { describe, it, expect } from 'vitest';
import {
  VESSEL_SHAPES,
  CONTAINER_SHAPES,
  vesselShape,
  containerShape,
  markerGrid,
  MAX_MARKERS,
  DEFAULT_VESSEL,
  DEFAULT_CONTAINER,
  VESSEL_VIEWBOX,
  CONTAINER_VIEWBOX,
} from './stock-svg';

describe('shape registry', () => {
  it('has unique ids and valid fill ranges inside the viewBox', () => {
    const ids = VESSEL_SHAPES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of VESSEL_SHAPES) {
      expect(s.fillTop).toBeLessThan(s.fillBottom);
      expect(s.fillTop).toBeGreaterThanOrEqual(0);
      expect(s.fillBottom).toBeLessThanOrEqual(VESSEL_VIEWBOX.h);
    }
    const cids = CONTAINER_SHAPES.map((s) => s.id);
    expect(new Set(cids).size).toBe(cids.length);
    for (const s of CONTAINER_SHAPES) {
      expect(s.content.x + s.content.w).toBeLessThanOrEqual(CONTAINER_VIEWBOX.w);
      expect(s.content.y + s.content.h).toBeLessThanOrEqual(CONTAINER_VIEWBOX.h);
    }
  });

  it('falls back to the default shape for unknown/null ids', () => {
    expect(vesselShape('nope').id).toBe(DEFAULT_VESSEL);
    expect(vesselShape(null).id).toBe(DEFAULT_VESSEL);
    expect(vesselShape('syringe').id).toBe('syringe');
    expect(containerShape(undefined).id).toBe(DEFAULT_CONTAINER);
    expect(containerShape('tray').id).toBe('tray');
  });
});

describe('markerGrid', () => {
  const content = { x: 10, y: 10, w: 100, h: 80 };

  it('lays out exactly count markers inside the content rect', () => {
    const cells = markerGrid(content, 10, 10);
    expect(cells).toHaveLength(10);
    for (const c of cells) {
      expect(c.cx - c.r).toBeGreaterThanOrEqual(content.x);
      expect(c.cx + c.r).toBeLessThanOrEqual(content.x + content.w);
      expect(c.cy - c.r).toBeGreaterThanOrEqual(content.y);
      expect(c.cy + c.r).toBeLessThanOrEqual(content.y + content.h);
    }
  });

  it('fills row-major with a fractional last marker (3.4 → 3 full + one 0.4)', () => {
    const fills = markerGrid(content, 10, 3.4).map((c) => c.fill);
    expect(fills.slice(0, 3)).toEqual([1, 1, 1]);
    expect(fills[3]).toBeCloseTo(0.4);
    expect(fills.slice(4).every((f) => f === 0)).toBe(true);
  });

  it('clamps filled to [0, count]', () => {
    expect(markerGrid(content, 4, 99).every((c) => c.fill === 1)).toBe(true);
    expect(markerGrid(content, 4, -1).every((c) => c.fill === 0)).toBe(true);
  });

  it('returns [] for invalid or oversized counts', () => {
    expect(markerGrid(content, 0, 0)).toEqual([]);
    expect(markerGrid(content, NaN, 0)).toEqual([]);
    expect(markerGrid(content, MAX_MARKERS + 1, 0)).toEqual([]);
  });
});
