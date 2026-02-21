// src/lib/workshop/camera.ts

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3;
const ZOOM_SPEED = 0.001;

export function screenToWorld(screenX: number, screenY: number, camera: CameraState): { x: number; y: number } {
  return {
    x: (screenX - camera.x) / camera.zoom,
    y: (screenY - camera.y) / camera.zoom,
  };
}

export function worldToScreen(worldX: number, worldY: number, camera: CameraState): { x: number; y: number } {
  return {
    x: worldX * camera.zoom + camera.x,
    y: worldY * camera.zoom + camera.y,
  };
}

export function applyZoom(
  camera: CameraState,
  deltaY: number,
  pivotScreenX: number,
  pivotScreenY: number,
): CameraState {
  const oldZoom = camera.zoom;
  const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, oldZoom - deltaY * ZOOM_SPEED));

  // Zoom toward the cursor position
  const worldX = (pivotScreenX - camera.x) / oldZoom;
  const worldY = (pivotScreenY - camera.y) / oldZoom;

  return {
    x: pivotScreenX - worldX * newZoom,
    y: pivotScreenY - worldY * newZoom,
    zoom: newZoom,
  };
}

export function applyPan(camera: CameraState, dx: number, dy: number): CameraState {
  return {
    x: camera.x + dx,
    y: camera.y + dy,
    zoom: camera.zoom,
  };
}
