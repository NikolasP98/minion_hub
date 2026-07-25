import { describe, it, expect } from 'vitest';
import { cameraOffset } from './renderer';

// Bug: clicking a node animated the camera to blank space. Root cause was the
// click handler targeting a node's static build-time anchor instead of its
// live simulated position — the actual "center on node" math (this function,
// shared by applyCamera/animateTo/fitView) was always correct. This test
// pins that math down so a future regression can't reintroduce the mismatch
// without touching a browser/Pixi instance.
describe('cameraOffset', () => {
  it('centers a node at the world origin exactly at the viewport center', () => {
    expect(cameraOffset([0, 0], 1, 800, 600)).toEqual([400, 300]);
  });

  it('scales the offset by zoom', () => {
    expect(cameraOffset([100, 50], 2, 800, 600)).toEqual([400 - 200, 300 - 100]);
  });

  it('is exactly reversible: offsetting world.position by this amount puts `center` at screen-center', () => {
    const center: [number, number] = [1234, -567];
    const zoom = 1.55;
    const [offX, offY] = cameraOffset(center, zoom, 1024, 768);
    // world.position + center*zoom === (viewport/2)
    expect(offX + center[0] * zoom).toBeCloseTo(1024 / 2, 6);
    expect(offY + center[1] * zoom).toBeCloseTo(768 / 2, 6);
  });
});
