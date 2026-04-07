# WebGPU (Dawn) API

> Source: https://blackboard.sh/electrobun/docs/apis/webgpu/

## Overview

Electrobun integrates a native WebGPU implementation (Dawn) to enable GPU-backed rendering without requiring a browser webview. This supports GPU windows, compute workloads, and WebGPU-first libraries.

## Enable Bundling

Configure WebGPU per platform in `electrobun.config.ts`:

```typescript
import { type ElectrobunConfig } from "electrobun";

export const config: ElectrobunConfig = {
  build: {
    macos: { bundleWGPU: true },
    win: { bundleWGPU: true },
    linux: { bundleWGPU: true },
  },
};
```

## Create A GPU Window

```typescript
import { GpuWindow, webgpu } from "electrobun/bun";

const win = new GpuWindow({
  title: "WebGPU",
  frame: { width: 800, height: 600, x: 200, y: 120 },
});

const ctx = webgpu.createContext(win);

const adapter = await webgpu.navigator.requestAdapter({
  compatibleSurface: ctx,
});
const device = await adapter.requestDevice();

ctx.configure({
  device,
  format: webgpu.navigator.getPreferredCanvasFormat(),
  alphaMode: "premultiplied",
});
```

## Embed GPU Surfaces in Web UIs

The `<electrobun-wgpu>` custom element embeds native GPU surfaces within webview layouts.

## Raw FFI Access

Access Dawn's C API directly through raw FFI bindings:

```typescript
import { WGPU } from "electrobun/bun";

if (!WGPU.native.available) {
  throw new Error("WGPU not bundled or failed to load");
}

const instance = WGPU.native.symbols.wgpuCreateInstance(0);
```

## Compute + Readback

```typescript
await readbackBuffer.mapAsync(GPUMapMode.READ);
const mapped = readbackBuffer.getMappedRange();
const out = new Uint8Array(mapped.slice(0));
readbackBuffer.unmap();
```

## Bundling + Runtime Resolution

The loader searches for the Dawn library in:
- Path specified in `ELECTROBUN_WGPU_PATH`
- Current working directory
- Application's `Resources` / `MacOS` folders (macOS)

## Template Examples

- `wgpu`: raw FFI rendering
- `wgpu-threejs`: Three.js on WebGPU
- `wgpu-babylon`: Babylon.js integration
- `wgpu-mlp`: compute + readback for inference
- `electrobun-doom`: game rendering

## Three.js Integration

```typescript
import { GpuWindow, three, webgpu } from "electrobun/bun";

const win = new GpuWindow({ title: "three.js + WebGPU" });
webgpu.install();

const size = win.getSize();
const canvas = {
  width: size.width,
  height: size.height,
  clientWidth: size.width,
  clientHeight: size.height,
  style: {},
  getContext: (type) => {
    if (type !== "webgpu") return null;
    return webgpu.createContext(win).context;
  },
  getBoundingClientRect: () => ({
    left: 0, top: 0,
    width: win.getSize().width,
    height: win.getSize().height,
  }),
  addEventListener: () => {},
  removeEventListener: () => {},
  setAttribute: () => {},
};

const renderer = new (three as any).WebGPURenderer({ canvas });
await renderer.init();

const scene = new three.Scene();
const camera = new three.PerspectiveCamera(60, size.width / size.height, 0.1, 100);
camera.position.z = 2;

const mesh = new three.Mesh(
  new three.BoxGeometry(0.6, 0.6, 0.6),
  new three.MeshStandardMaterial({ color: 0x202020 })
);
scene.add(mesh);

renderer.setAnimationLoop(() => {
  mesh.rotation.y += 0.01;
  renderer.render(scene, camera);
});
```
