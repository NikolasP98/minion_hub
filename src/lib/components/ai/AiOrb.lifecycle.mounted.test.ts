// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import AiOrb from './AiOrb.svelte';

let resize!: ResizeObserverCallback;
let intersect!: IntersectionObserverCallback;
let frame!: FrameRequestCallback;
const schedule = vi.fn((callback: FrameRequestCallback) => {
  frame = callback;
  return 1;
});
const draw = vi.fn();
const uniform = vi.fn();
const loseContext = vi.fn();
const gl = {
  createShader: () => ({}),
  shaderSource() {},
  compileShader() {},
  createProgram: () => ({}),
  attachShader() {},
  linkProgram() {},
  getProgramParameter: () => true,
  useProgram() {},
  disable() {},
  getUniformLocation: () => ({}),
  uniform3fv() {},
  uniform1f: uniform,
  uniform3f() {},
  uniform2f() {},
  viewport() {},
  clearColor() {},
  clear() {},
  drawArrays: draw,
  deleteProgram: vi.fn(),
  getExtension: () => ({ loseContext }),
} as unknown as WebGL2RenderingContext;

beforeEach(() => {
  vi.clearAllMocks();
  // This fixture implements the WebGL overload used by AiOrb; getContext's
  // final DOM overload is WebGPU, which mockReturnValue otherwise selects.
  const getContext = (() => gl) as unknown as HTMLCanvasElement['getContext'];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(getContext);
  vi.stubGlobal('requestAnimationFrame', schedule);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const mount = () =>
  render(AiOrb, {
    stops: [
      [0.5, 0, 0],
      [0.7, 0, 0],
    ],
    body: '#888',
    edge: '#aaa',
  });
const notifyResize = () => resize([], {} as ResizeObserver);
const notifyIntersect = () => intersect([], {} as IntersectionObserver);

describe('AiOrb asynchronous canvas lifetime', () => {
  it('ignores a queued resize after the mounted canvas is removed', async () => {
    const view = mount();
    await tick();
    const pendingResize = notifyResize;
    await view.unmount();
    draw.mockClear();
    uniform.mockClear();
    expect(pendingResize).not.toThrow();
    expect(draw).not.toHaveBeenCalled();
    expect(uniform).not.toHaveBeenCalled();
    expect(gl.deleteProgram).toHaveBeenCalledOnce();
    expect(loseContext).toHaveBeenCalledOnce();
  });
  it('queued animation/intersection callbacks cannot restart GPU work after teardown', async () => {
    const view = mount();
    await tick();
    const pendingFrame = frame;
    await view.unmount();
    schedule.mockClear();
    draw.mockClear();
    uniform.mockClear();
    pendingFrame(16);
    notifyIntersect();
    expect(schedule).not.toHaveBeenCalled();
    expect(draw).not.toHaveBeenCalled();
    expect(uniform).not.toHaveBeenCalled();
  });
  it('ignores observers and frames after context loss replaces the canvas with fallback', async () => {
    const view = mount();
    await tick();
    const pendingFrame = frame;
    view.container
      .querySelector('canvas')!
      .dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    await tick();
    expect(view.container.querySelector('canvas')).toBeNull();
    schedule.mockClear();
    draw.mockClear();
    uniform.mockClear();
    expect(notifyResize).not.toThrow();
    pendingFrame(16);
    notifyIntersect();
    expect(schedule).not.toHaveBeenCalled();
    expect(draw).not.toHaveBeenCalled();
    expect(uniform).not.toHaveBeenCalled();
  });
});
