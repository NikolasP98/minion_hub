// Habbo-style isometric renderer for Minion Workshop
// Creates a playful, game-like visualization with isometric projection

import * as PIXI from "pixi.js";
import {
  getAvatarTexture,
  clearTextureCache,
  getGeneration,
  HABBO_TEXTURE_SIZE,
  TEXT_RESOLUTION,
} from "./texture-cache";

// Constants for isometric rendering
export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 32; // Standard 2:1 isometric ratio
export const WALL_HEIGHT = 48;
export const AVATAR_SIZE = 40;

// Module-level state
let sprites = new Map<string, PIXI.Container>();
let tileContainer: PIXI.Container | null = null;
let avatarContainer: PIXI.Container | null = null;

// Isometric projection helpers
export function isoToScreen(
  x: number,
  y: number,
  z: number = 0,
): { x: number; y: number } {
  // Convert 3D isometric coords to 2D screen coords
  const screenX = (x - y) * (TILE_WIDTH / 2);
  const screenY = (x + y) * (TILE_HEIGHT / 2) - z * (WALL_HEIGHT / 2);
  return { x: screenX, y: screenY };
}

export function screenToIso(
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  // Convert 2D screen coords back to isometric grid
  const isoX = (screenX / (TILE_WIDTH / 2) + screenY / (TILE_HEIGHT / 2)) / 2;
  const isoY = (screenY / (TILE_HEIGHT / 2) - screenX / (TILE_WIDTH / 2)) / 2;
  return { x: isoX, y: isoY };
}

// Dark-theme color palette for Habbo style
const HABBO_COLORS = {
  floorLight: 0x2a3a4a,
  floorDark: 0x1e2d3d,
  floorBorder: 0x15202d,
  wallColor: 0x344a5e,
  wallShadow: 0x253847,
  shadowColor: 0x000000,
};

/** Shared shadow texture — created once per initHabboRenderer call. */
let sharedShadowTexture: PIXI.Texture | null = null;

// Create an isometric tile texture
export function createTileTexture(app: PIXI.Application): PIXI.Texture {
  const g = new PIXI.Graphics();
  const w = TILE_WIDTH;
  const h = TILE_HEIGHT;

  // Top face (floor)
  g.moveTo(0, -h / 2);
  g.lineTo(w / 2, 0);
  g.lineTo(0, h / 2);
  g.lineTo(-w / 2, 0);
  g.closePath();
  g.fill({ color: HABBO_COLORS.floorLight });
  g.stroke({ color: HABBO_COLORS.floorBorder, width: 1 });

  // Add some shading detail
  g.circle(0, 0, 4);
  g.fill({ color: HABBO_COLORS.floorDark, alpha: 0.3 });

  return app.renderer.generateTexture(g);
}

// Create a shadow texture (or return the shared one)
function getOrCreateShadowTexture(app: PIXI.Application): PIXI.Texture {
  if (sharedShadowTexture) return sharedShadowTexture;
  const g = new PIXI.Graphics();
  g.ellipse(0, 0, 20, 10);
  g.fill({ color: HABBO_COLORS.shadowColor, alpha: 0.3 });
  sharedShadowTexture = app.renderer.generateTexture(g);
  return sharedShadowTexture;
}

// Create Habbo-style avatar with "big head" aesthetic
export async function createHabboAvatarSprite(
  instanceId: string,
  info: { name: string; avatarSeed: string; emoji?: string },
  app: PIXI.Application,
  container: PIXI.Container,
): Promise<PIXI.Container> {
  if (sprites.has(instanceId)) {
    return sprites.get(instanceId)!;
  }

  const gen = getGeneration();
  const spriteContainer = new PIXI.Container();
  spriteContainer.label = instanceId;

  // --- Glow ring (matches classic renderer's ring style) ---
  const glow = new PIXI.Graphics();
  glow.label = "glow";
  glow.circle(0, 0, 22);
  glow.stroke({ color: 0x6366f1, width: 2.5, alpha: 0.5 });
  spriteContainer.addChild(glow);

  // Shadow (shared texture)
  const shadow = new PIXI.Sprite(getOrCreateShadowTexture(app));
  shadow.anchor.set(0.5, 0.5);
  shadow.y = 8;
  spriteContainer.addChild(shadow);

  // Avatar body/circle base
  const body = new PIXI.Graphics();
  body.label = "body";
  body.circle(0, 0, 18);
  body.fill({ color: 0x3b82f6 });
  spriteContainer.addChild(body);

  // Load avatar texture from shared cache
  const texture = await getAvatarTexture(info.avatarSeed, HABBO_TEXTURE_SIZE);
  if (gen !== getGeneration()) return spriteContainer;

  // Avatar face (only if texture loaded successfully)
  if (texture) {
    const faceContainer = new PIXI.Container();
    faceContainer.label = "avatar";
    const face = new PIXI.Sprite(texture);
    face.anchor.set(0.5, 0.5);
    face.width = 36;
    face.height = 36;

    // Circular mask matching the body circle exactly
    const mask = new PIXI.Graphics();
    mask.circle(0, 0, 18);
    mask.fill({ color: 0xffffff });
    faceContainer.addChild(mask);
    face.mask = mask;
    faceContainer.addChild(face);
    spriteContainer.addChild(faceContainer);
  }

  // Name tag (Habbo style - floating above, sized to text)
  const nameText = new PIXI.Text({
    text: info.name,
    style: {
      fontFamily: "Inter, sans-serif",
      fontSize: 9,
      fill: 0xffffff,
      align: "center",
      fontWeight: "bold",
    },
    resolution: TEXT_RESOLUTION,
  });
  nameText.anchor.set(0.5, 0.5);
  nameText.y = -28;

  const pad = 6;
  const bgW = nameText.width + pad * 2;
  const bgH = 14;
  const nameBg = new PIXI.Graphics();
  nameBg.roundRect(-bgW / 2, -35, bgW, bgH, 3);
  nameBg.fill({ color: 0x000000, alpha: 0.6 });
  spriteContainer.addChild(nameBg);
  spriteContainer.addChild(nameText);

  // Interaction
  spriteContainer.eventMode = "static";
  spriteContainer.cursor = "grab";

  container.addChild(spriteContainer);
  sprites.set(instanceId, spriteContainer);

  return spriteContainer;
}

/**
 * Compute a grid size that covers all current agent world positions,
 * plus padding. Falls back to `defaultSize` when there are no agents.
 */
export function computeRoomGridSize(
  agentPositions: { x: number; y: number }[],
  defaultSize: number = 10,
): number {
  if (agentPositions.length === 0) return defaultSize;
  let maxDist = 0;
  for (const pos of agentPositions) {
    const isoX = Math.abs(pos.x * WORLD_TO_ISO_SCALE);
    const isoY = Math.abs(pos.y * WORLD_TO_ISO_SCALE);
    maxDist = Math.max(maxDist, isoX, isoY);
  }
  // +4 tiles padding on each side
  return Math.max(defaultSize, Math.ceil(maxDist * 2) + 8);
}

// Render the isometric room/floor
export function renderIsoRoom(
  app: PIXI.Application,
  container: PIXI.Container,
  gridSize: number = 8,
): void {
  if (tileContainer) {
    tileContainer.destroy({ children: true });
  }

  tileContainer = new PIXI.Container();
  tileContainer.label = "isoRoom";

  const tileTexture = createTileTexture(app);

  // Create a grid of isometric tiles
  for (let x = 0; x < gridSize; x++) {
    for (let y = 0; y < gridSize; y++) {
      const tile = new PIXI.Sprite(tileTexture);
      tile.anchor.set(0.5, 0.5);

      const pos = isoToScreen(x - gridSize / 2, y - gridSize / 2);
      tile.x = pos.x;
      tile.y = pos.y;

      // Add checkerboard pattern
      if ((x + y) % 2 === 1) {
        tile.tint = 0xdddddd;
      }

      tileContainer.addChild(tile);
    }
  }

  // Add walls on the back edges
  const wallGraphics = new PIXI.Graphics();
  wallGraphics.label = "walls";

  // Back-left wall
  for (let i = 0; i < gridSize; i++) {
    const start = isoToScreen(-gridSize / 2, i - gridSize / 2);
    const end = isoToScreen(-gridSize / 2, i + 1 - gridSize / 2);
    wallGraphics.moveTo(start.x, start.y);
    wallGraphics.lineTo(start.x, start.y - WALL_HEIGHT);
    wallGraphics.lineTo(end.x, end.y - WALL_HEIGHT);
    wallGraphics.lineTo(end.x, end.y);
    wallGraphics.closePath();
    wallGraphics.fill({ color: HABBO_COLORS.wallColor });
  }

  // Back-right wall
  for (let i = 0; i < gridSize; i++) {
    const start = isoToScreen(i - gridSize / 2, -gridSize / 2);
    const end = isoToScreen(i + 1 - gridSize / 2, -gridSize / 2);
    wallGraphics.moveTo(start.x, start.y);
    wallGraphics.lineTo(start.x, start.y - WALL_HEIGHT);
    wallGraphics.lineTo(end.x, end.y - WALL_HEIGHT);
    wallGraphics.lineTo(end.x, end.y);
    wallGraphics.closePath();
    wallGraphics.fill({ color: HABBO_COLORS.wallShadow });
  }

  tileContainer.addChildAt(wallGraphics, 0);
  // Always insert at index 0 so the room stays behind sprites/elements
  container.addChildAt(tileContainer, 0);
}

// Update avatar position in isometric space
export function updateAvatarIsoPosition(
  instanceId: string,
  isoX: number,
  isoY: number,
  z: number = 0,
): void {
  const sprite = sprites.get(instanceId);
  if (!sprite) return;

  const pos = isoToScreen(isoX, isoY, z);
  sprite.x = pos.x;
  sprite.y = pos.y;

  // Sort by Y for proper depth ordering
  if (sprite.parent) {
    sprite.parent.children.sort((a, b) => a.y - b.y);
  }
}

// Animate avatar walk (bounce) with per-sprite phase offset
export function animateAvatarWalk(instanceId: string, time: number): void {
  const sprite = sprites.get(instanceId);
  if (!sprite) return;

  // Phase offset from instanceId so avatars bounce out of sync
  let phase = 0;
  for (let i = 0; i < instanceId.length; i++) {
    phase += instanceId.charCodeAt(i);
  }

  const avatar = sprite.getChildByLabel("avatar") || sprite;
  avatar.y = Math.sin(time * 0.008 + phase) * 2;
}

// Remove avatar
export function removeAvatar(instanceId: string): void {
  const sprite = sprites.get(instanceId);
  if (sprite) {
    sprite.destroy({ children: true });
    sprites.delete(instanceId);
  }
}

// Clear all avatars
export function clearAllAvatars(): void {
  clearTextureCache(); // bumps generation & frees VRAM
  for (const [, sprite] of sprites) {
    sprite.destroy({ children: true });
  }
  sprites.clear();
}

// Show speech bubble above avatar
export function showSpeechBubble(
  instanceId: string,
  text: string,
  app: PIXI.Application,
): void {
  const sprite = sprites.get(instanceId);
  if (!sprite) return;

  // Remove existing bubble if any
  const existing = sprite.getChildByLabel("bubble");
  if (existing) existing.destroy();

  const bubble = new PIXI.Container();
  bubble.label = "bubble";
  bubble.y = -45;

  // Bubble background
  const bg = new PIXI.Graphics();
  const padding = 8;
  const maxWidth = 120;
  const style = new PIXI.TextStyle({
    fontFamily: "Inter, sans-serif",
    fontSize: 10,
    fill: 0x000000,
    wordWrap: true,
    wordWrapWidth: maxWidth,
  });
  const textObj = new PIXI.Text({ text, style, resolution: TEXT_RESOLUTION });
  const w = Math.min(textObj.width, maxWidth) + padding * 2;
  const h = textObj.height + padding * 2;

  bg.roundRect(-w / 2, -h, w, h, 6);
  bg.fill({ color: 0xffffff });
  bg.stroke({ color: 0xcccccc, width: 1 });

  // Triangle pointer
  bg.moveTo(-6, 0);
  bg.lineTo(0, 4);
  bg.lineTo(6, 0);
  bg.closePath();
  bg.fill({ color: 0xffffff });

  textObj.x = -textObj.width / 2;
  textObj.y = -h + padding;

  bubble.addChild(bg);
  bubble.addChild(textObj);
  sprite.addChild(bubble);

  // Auto-remove after delay
  setTimeout(() => {
    if (!bubble.destroyed) {
      bubble.destroy();
    }
  }, 4000);
}

// ---------------------------------------------------------------------------
// World ↔ Iso coordinate conversion
// ---------------------------------------------------------------------------

/** Scale factor: how many iso tile units per world pixel. */
const WORLD_TO_ISO_SCALE = 1 / 80;

/**
 * Convert world coordinates (used by physics/state) to iso screen coordinates.
 * This is the key bridge between the world-coordinate system and the iso view.
 */
export function worldToIsoScreen(
  worldX: number,
  worldY: number,
): { x: number; y: number } {
  const isoX = worldX * WORLD_TO_ISO_SCALE;
  const isoY = worldY * WORLD_TO_ISO_SCALE;
  return isoToScreen(isoX, isoY, 0);
}

/**
 * Convert iso screen coordinates back to world coordinates (for pointer events).
 */
export function isoScreenToWorld(
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  const iso = screenToIso(screenX, screenY);
  return {
    x: iso.x / WORLD_TO_ISO_SCALE,
    y: iso.y / WORLD_TO_ISO_SCALE,
  };
}

// ---------------------------------------------------------------------------
// Sprite accessors
// ---------------------------------------------------------------------------

/**
 * Return the avatar layer container. Sprites should be added here (not worldContainer)
 * so they render above the floor tiles.
 */
export function getAvatarContainer(): PIXI.Container | null {
  return avatarContainer;
}

export function getSprite(instanceId: string): PIXI.Container | undefined {
  return sprites.get(instanceId);
}

export function getAllSprites(): Map<string, PIXI.Container> {
  return sprites;
}

// ---------------------------------------------------------------------------
// Visual feedback (matching classic API)
// ---------------------------------------------------------------------------

/**
 * Redraw the glow ring of a habbo avatar with a new colour.
 */
export function setSpriteGlowColor(instanceId: string, color: number): void {
  const sprite = sprites.get(instanceId);
  if (!sprite) return;

  const glow = sprite.getChildByLabel("glow") as PIXI.Graphics | null;
  if (glow) {
    glow.clear();
    glow.circle(0, 0, 22);
    glow.stroke({ color, width: 2.5, alpha: 0.5 });
  }
}

/**
 * Animate a brief scale pulse on the avatar (heartbeat).
 * Scale: 1.0 → 1.2 → 1.0 over 600ms.
 */
export function triggerHeartbeatPulse(instanceId: string): void {
  const sprite = sprites.get(instanceId);
  if (!sprite) return;

  const DURATION = 600;
  let elapsed = 0;

  const onTick = (ticker: PIXI.Ticker) => {
    if (sprite.destroyed) {
      PIXI.Ticker.shared.remove(onTick);
      return;
    }
    elapsed += ticker.deltaMS;
    const t = Math.min(elapsed / DURATION, 1);
    const scale = 1 + 0.2 * Math.sin(t * Math.PI);
    sprite.scale.set(scale);
    if (t >= 1) {
      sprite.scale.set(1);
      PIXI.Ticker.shared.remove(onTick);
    }
  };
  PIXI.Ticker.shared.add(onTick);
}

/**
 * Show a floating emoji reaction above a habbo avatar.
 * Fades out upward over 1.2s.
 */
export function showReactionEmoji(instanceId: string, emoji: string): void {
  const sprite = sprites.get(instanceId);
  if (!sprite) return;

  const text = new PIXI.Text({
    text: emoji,
    style: { fontSize: 20, align: "center" },
    resolution: TEXT_RESOLUTION,
  });
  text.anchor.set(0.5, 1);
  text.x = 0;
  text.y = -30;
  sprite.addChild(text);

  const DURATION = 1200;
  let elapsed = 0;

  const onTick = (ticker: PIXI.Ticker) => {
    if (sprite.destroyed || text.destroyed) {
      PIXI.Ticker.shared.remove(onTick);
      return;
    }
    elapsed += ticker.deltaMS;
    const t = Math.min(elapsed / DURATION, 1);
    text.y = -30 - t * 40;
    text.alpha = 1 - t;
    if (t >= 1) {
      text.destroy();
      PIXI.Ticker.shared.remove(onTick);
    }
  };
  PIXI.Ticker.shared.add(onTick);
}

/** Cached app reference for room resize calls. */
let habboApp: PIXI.Application | null = null;
let habboWorldContainer: PIXI.Container | null = null;

// Initialize the Habbo renderer
export function initHabboRenderer(
  app: PIXI.Application,
  worldContainer: PIXI.Container,
): void {
  habboApp = app;
  habboWorldContainer = worldContainer;

  // Room floor FIRST (lowest z-order)
  renderIsoRoom(app, worldContainer, 10);

  // Avatar/element container AFTER room so sprites render on top
  avatarContainer = new PIXI.Container();
  avatarContainer.label = "habboAvatars";
  worldContainer.addChild(avatarContainer);
}

/**
 * Re-render the floor grid to fit the current agent positions.
 * Called after agents are added/moved to ensure the room covers them.
 */
export function resizeRoomIfNeeded(
  agentPositions: { x: number; y: number }[],
): void {
  if (!habboApp || !habboWorldContainer) return;
  const size = computeRoomGridSize(agentPositions);
  renderIsoRoom(habboApp, habboWorldContainer, size);
}

// Cleanup
export function destroyHabboRenderer(): void {
  clearAllAvatars();
  if (sharedShadowTexture) {
    sharedShadowTexture.destroy(true);
    sharedShadowTexture = null;
  }
  if (tileContainer) {
    tileContainer.removeFromParent();
    tileContainer.destroy({ children: true });
  }
  if (avatarContainer) {
    avatarContainer.removeFromParent();
    avatarContainer.destroy({ children: true });
  }
  tileContainer = null;
  avatarContainer = null;
  habboApp = null;
  habboWorldContainer = null;
}
