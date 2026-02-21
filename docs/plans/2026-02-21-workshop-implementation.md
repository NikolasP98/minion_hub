# Workshop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a pannable, zoomable canvas where users drag agent avatars from a toolbar, create instances, link them with elastic relationship ropes, and orchestrate real LLM conversations between agents.

**Architecture:** PixiJS 8 (WebGL 2D) renders agents/ropes on a canvas, Rapier.js (WASM) handles physics (zero-gravity, spring constraints, collision). HTML overlay layer provides speech bubbles, chat panels, and context menus. State managed via Svelte 5 runes with auto-save to localStorage and named saves to SQLite.

**Tech Stack:** SvelteKit 5, PixiJS 8, @dimforge/rapier2d-compat, Tailwind CSS 4, Drizzle ORM (SQLite), existing gateway WebSocket

**Design doc:** `docs/plans/2026-02-21-workshop-design.md`

---

## Task 1: Install Dependencies & Configure WASM

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`

**Step 1: Install PixiJS and Rapier**

```bash
cd /home/nikolas/Documents/CODE/AI/minion_hub
npm install pixi.js @dimforge/rapier2d-compat
```

**Step 2: Configure Vite for WASM support**

Modify `vite.config.ts` to handle Rapier's WASM module. Add `@dimforge/rapier2d-compat` to `optimizeDeps.exclude` and configure `ssr.noExternal`:

```typescript
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  optimizeDeps: {
    include: ['@zag-js/popover', '@zag-js/combobox', '@zag-js/slider'],
    exclude: ['@dimforge/rapier2d-compat'],
  },
  ssr: {
    noExternal: ['@zag-js/popover', '@zag-js/combobox', '@zag-js/slider', '@zag-js/svelte'],
  },
});
```

**Step 3: Verify build succeeds**

```bash
npm run build
```

Expected: Build completes without errors.

**Step 4: Commit**

```bash
git add package.json package-lock.json vite.config.ts
git commit -m "chore: add pixi.js and rapier2d dependencies for workshop"
```

---

## Task 2: Workshop State Store

**Files:**
- Create: `src/lib/state/workshop.svelte.ts`

**Step 1: Create the workshop state store**

Follow the pattern from `src/lib/state/ui.svelte.ts` and `src/lib/state/marketplace.svelte.ts`.

```typescript
// src/lib/state/workshop.svelte.ts

export interface AgentInstance {
  instanceId: string;
  agentId: string;
  position: { x: number; y: number };
  behavior: 'stationary' | 'wander' | 'patrol';
  homePosition: { x: number; y: number };
}

export interface Relationship {
  id: string;
  fromInstanceId: string;
  toInstanceId: string;
  label: string;
}

export interface WorkshopConversation {
  id: string;
  type: 'task' | 'banter';
  participantInstanceIds: string[];
  sessionKey: string;
  status: 'active' | 'completed' | 'queued';
}

export interface WorkshopSettings {
  maxConcurrentConversations: number;
  idleBanterEnabled: boolean;
  idleBanterBudgetPerHour: number;
  proximityRadius: number;
}

export interface WorkshopState {
  camera: { x: number; y: number; zoom: number };
  agents: Record<string, AgentInstance>;
  relationships: Record<string, Relationship>;
  conversations: Record<string, WorkshopConversation>;
  settings: WorkshopSettings;
}

const DEFAULT_SETTINGS: WorkshopSettings = {
  maxConcurrentConversations: 3,
  idleBanterEnabled: true,
  idleBanterBudgetPerHour: 20,
  proximityRadius: 200,
};

function createDefaultState(): WorkshopState {
  return {
    camera: { x: 0, y: 0, zoom: 1 },
    agents: {},
    relationships: {},
    conversations: {},
    settings: { ...DEFAULT_SETTINGS },
  };
}

export const workshop = $state<WorkshopState>(createDefaultState());

// --- Persistence ---

const AUTOSAVE_KEY = 'workshop:autosave';
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

export function autoSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      const serializable: WorkshopState = {
        camera: workshop.camera,
        agents: { ...workshop.agents },
        relationships: { ...workshop.relationships },
        conversations: {},
        settings: workshop.settings,
      };
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serializable));
    } catch {
      // localStorage full or unavailable
    }
  }, 300);
}

export function autoLoad(): boolean {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw) as WorkshopState;
    workshop.camera = saved.camera;
    workshop.agents = saved.agents ?? {};
    workshop.relationships = saved.relationships ?? {};
    workshop.conversations = {};
    workshop.settings = { ...DEFAULT_SETTINGS, ...saved.settings };
    return true;
  } catch {
    return false;
  }
}

// --- Agent Instance Management ---

let instanceCounter = 0;

export function addAgentInstance(agentId: string, x: number, y: number): string {
  const instanceId = `inst_${agentId}_${Date.now()}_${instanceCounter++}`;
  workshop.agents[instanceId] = {
    instanceId,
    agentId,
    position: { x, y },
    behavior: 'stationary',
    homePosition: { x, y },
  };
  autoSave();
  return instanceId;
}

export function removeAgentInstance(instanceId: string) {
  // Remove relationships connected to this agent
  for (const [relId, rel] of Object.entries(workshop.relationships)) {
    if (rel.fromInstanceId === instanceId || rel.toInstanceId === instanceId) {
      delete workshop.relationships[relId];
    }
  }
  delete workshop.agents[instanceId];
  autoSave();
}

export function updateAgentPosition(instanceId: string, x: number, y: number) {
  const agent = workshop.agents[instanceId];
  if (agent) {
    agent.position.x = x;
    agent.position.y = y;
  }
}

export function setAgentBehavior(instanceId: string, behavior: AgentInstance['behavior']) {
  const agent = workshop.agents[instanceId];
  if (agent) {
    agent.behavior = behavior;
    autoSave();
  }
}

// --- Relationships ---

let relCounter = 0;

export function addRelationship(fromInstanceId: string, toInstanceId: string, label: string): string {
  const id = `rel_${Date.now()}_${relCounter++}`;
  workshop.relationships[id] = { id, fromInstanceId, toInstanceId, label };
  autoSave();
  return id;
}

export function removeRelationship(id: string) {
  delete workshop.relationships[id];
  autoSave();
}

export function updateRelationshipLabel(id: string, label: string) {
  const rel = workshop.relationships[id];
  if (rel) {
    rel.label = label;
    autoSave();
  }
}

// --- Named Saves (API) ---

export async function saveWorkspace(name: string): Promise<boolean> {
  try {
    const state: WorkshopState = {
      camera: workshop.camera,
      agents: { ...workshop.agents },
      relationships: { ...workshop.relationships },
      conversations: {},
      settings: workshop.settings,
    };
    const res = await fetch('/api/workshop/saves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, state }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function loadWorkspace(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/workshop/saves/${id}`);
    if (!res.ok) return false;
    const { state } = await res.json();
    workshop.camera = state.camera;
    workshop.agents = state.agents ?? {};
    workshop.relationships = state.relationships ?? {};
    workshop.conversations = {};
    workshop.settings = { ...DEFAULT_SETTINGS, ...state.settings };
    autoSave();
    return true;
  } catch {
    return false;
  }
}

export async function listWorkspaceSaves(): Promise<Array<{ id: string; name: string; updatedAt: number }>> {
  try {
    const res = await fetch('/api/workshop/saves');
    if (!res.ok) return [];
    const { saves } = await res.json();
    return saves;
  } catch {
    return [];
  }
}

export async function deleteWorkspaceSave(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/workshop/saves/${id}`, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}

// --- Reset ---

export function resetWorkshop() {
  const fresh = createDefaultState();
  workshop.camera = fresh.camera;
  workshop.agents = fresh.agents;
  workshop.relationships = fresh.relationships;
  workshop.conversations = fresh.conversations;
  workshop.settings = fresh.settings;
  autoSave();
}
```

**Step 2: Commit**

```bash
git add src/lib/state/workshop.svelte.ts
git commit -m "feat(workshop): add workshop state store with persistence"
```

---

## Task 3: Database Schema & API for Named Saves

**Files:**
- Create: `src/server/db/schema/workshop-saves.ts`
- Modify: `src/server/db/schema/index.ts` (add export)
- Create: `src/routes/api/workshop/saves/+server.ts`
- Create: `src/routes/api/workshop/saves/[id]/+server.ts`

**Step 1: Create the workshop saves schema**

Follow the pattern from `src/server/db/schema/tasks.ts`:

```typescript
// src/server/db/schema/workshop-saves.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const workshopSaves = sqliteTable('workshop_saves', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  state: text('state').notNull(), // JSON string of WorkshopState
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
```

**Step 2: Export from schema index**

Add to `src/server/db/schema/index.ts`:

```typescript
export * from './workshop-saves';
```

**Step 3: Run migration**

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

**Step 4: Create the saves list/create API endpoint**

```typescript
// src/routes/api/workshop/saves/+server.ts
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$server/db/client';
import { workshopSaves } from '$server/db/schema/workshop-saves';
import { desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export const GET: RequestHandler = async () => {
  const db = getDb();
  const saves = await db
    .select({
      id: workshopSaves.id,
      name: workshopSaves.name,
      updatedAt: workshopSaves.updatedAt,
    })
    .from(workshopSaves)
    .orderBy(desc(workshopSaves.updatedAt));
  return json({ saves });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { name, state } = body as { name?: string; state?: unknown };
  if (!name || typeof name !== 'string') throw error(400, 'name is required');
  if (!state) throw error(400, 'state is required');

  const db = getDb();
  const now = Date.now();
  const id = randomUUID();

  await db.insert(workshopSaves).values({
    id,
    name,
    state: JSON.stringify(state),
    createdAt: now,
    updatedAt: now,
  });

  return json({ id, ok: true });
};
```

**Step 5: Create the single save GET/PUT/DELETE endpoint**

```typescript
// src/routes/api/workshop/saves/[id]/+server.ts
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$server/db/client';
import { workshopSaves } from '$server/db/schema/workshop-saves';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  const db = getDb();
  const rows = await db.select().from(workshopSaves).where(eq(workshopSaves.id, params.id!));
  if (rows.length === 0) throw error(404, 'Save not found');
  const row = rows[0];
  return json({ id: row.id, name: row.name, state: JSON.parse(row.state), updatedAt: row.updatedAt });
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const body = await request.json();
  const { name, state } = body as { name?: string; state?: unknown };
  const db = getDb();
  const updates: Record<string, unknown> = { updatedAt: Date.now() };
  if (name) updates.name = name;
  if (state) updates.state = JSON.stringify(state);
  await db.update(workshopSaves).set(updates).where(eq(workshopSaves.id, params.id!));
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const db = getDb();
  await db.delete(workshopSaves).where(eq(workshopSaves.id, params.id!));
  return json({ ok: true });
};
```

**Step 6: Commit**

```bash
git add src/server/db/schema/workshop-saves.ts src/server/db/schema/index.ts src/routes/api/workshop/saves/
git commit -m "feat(workshop): add workshop saves schema and API endpoints"
```

---

## Task 4: Physics Engine Module

**Files:**
- Create: `src/lib/workshop/physics.ts`

**Step 1: Create the Rapier physics wrapper**

This module initializes Rapier, manages bodies and spring joints, and provides the simulation step.

```typescript
// src/lib/workshop/physics.ts
import RAPIER from '@dimforge/rapier2d-compat';

let world: RAPIER.World | null = null;
let rapier: typeof RAPIER | null = null;

const bodies = new Map<string, RAPIER.RigidBody>();
const colliders = new Map<string, RAPIER.Collider>();
const joints = new Map<string, RAPIER.ImpulseJoint>();

const AGENT_RADIUS = 30;
const DAMPING = 10;
const REPULSION_STIFFNESS = 50;

export async function initPhysics(): Promise<void> {
  await RAPIER.init();
  rapier = RAPIER;
  const gravity = new RAPIER.Vector2(0, 0);
  world = new RAPIER.World(gravity);
}

export function destroyPhysics() {
  if (world) {
    world.free();
    world = null;
  }
  bodies.clear();
  colliders.clear();
  joints.clear();
}

export function addAgentBody(instanceId: string, x: number, y: number): void {
  if (!world || !rapier) return;

  const bodyDesc = rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y);
  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = rapier.ColliderDesc.ball(AGENT_RADIUS).setRestitution(0.1).setFriction(0.5);
  const collider = world.createCollider(colliderDesc, body);

  bodies.set(instanceId, body);
  colliders.set(instanceId, collider);
}

export function removeAgentBody(instanceId: string): void {
  if (!world) return;
  const body = bodies.get(instanceId);
  if (body) {
    world.removeRigidBody(body);
    bodies.delete(instanceId);
    colliders.delete(instanceId);
  }
}

export function setAgentPosition(instanceId: string, x: number, y: number): void {
  const body = bodies.get(instanceId);
  if (!body || !rapier) return;
  body.setTranslation(new rapier.Vector2(x, y), true);
}

export function makeAgentDynamic(instanceId: string): void {
  const body = bodies.get(instanceId);
  if (!body || !rapier) return;
  body.setBodyType(rapier.RigidBodyType.Dynamic, true);
  body.setLinearDamping(DAMPING);
  body.setAngularDamping(DAMPING);
}

export function makeAgentKinematic(instanceId: string): void {
  const body = bodies.get(instanceId);
  if (!body || !rapier) return;
  body.setBodyType(rapier.RigidBodyType.KinematicPositionBased, true);
}

export function getAgentPosition(instanceId: string): { x: number; y: number } | null {
  const body = bodies.get(instanceId);
  if (!body) return null;
  const t = body.translation();
  return { x: t.x, y: t.y };
}

export function addSpringJoint(
  relationshipId: string,
  fromInstanceId: string,
  toInstanceId: string,
  restLength: number = 150,
  stiffness: number = 5,
  damping: number = 1,
): void {
  if (!world || !rapier) return;
  const bodyA = bodies.get(fromInstanceId);
  const bodyB = bodies.get(toInstanceId);
  if (!bodyA || !bodyB) return;

  const params = rapier.JointData.spring(
    restLength,
    stiffness,
    damping,
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  );
  const joint = world.createImpulseJoint(params, bodyA, bodyB, true);
  joints.set(relationshipId, joint);
}

export function removeSpringJoint(relationshipId: string): void {
  if (!world) return;
  const joint = joints.get(relationshipId);
  if (joint) {
    world.removeImpulseJoint(joint, true);
    joints.delete(relationshipId);
  }
}

export function step(): void {
  if (!world) return;
  world.step();
}

export function getAllPositions(): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  for (const [id, body] of bodies) {
    const t = body.translation();
    positions.set(id, { x: t.x, y: t.y });
  }
  return positions;
}

export function applyWanderImpulse(instanceId: string, homeX: number, homeY: number, radius: number): void {
  const body = bodies.get(instanceId);
  if (!body || !rapier) return;

  const pos = body.translation();
  const dx = homeX - pos.x;
  const dy = homeY - pos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Return force toward home if too far
  if (dist > radius) {
    const force = new rapier.Vector2(dx * 0.5, dy * 0.5);
    body.applyImpulse(force, true);
  } else {
    // Random wander
    const angle = Math.random() * Math.PI * 2;
    const strength = 2;
    const force = new rapier.Vector2(Math.cos(angle) * strength, Math.sin(angle) * strength);
    body.applyImpulse(force, true);
  }
}
```

**Step 2: Commit**

```bash
git add src/lib/workshop/physics.ts
git commit -m "feat(workshop): add Rapier physics engine wrapper"
```

---

## Task 5: Camera Module

**Files:**
- Create: `src/lib/workshop/camera.ts`

**Step 1: Create camera pan/zoom controller**

```typescript
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
```

**Step 2: Commit**

```bash
git add src/lib/workshop/camera.ts
git commit -m "feat(workshop): add camera pan/zoom module"
```

---

## Task 6: PixiJS Agent Sprite Manager

**Files:**
- Create: `src/lib/workshop/agent-sprite.ts`

**Step 1: Create agent sprite factory**

This module manages PixiJS sprites for agent instances on the canvas.

```typescript
// src/lib/workshop/agent-sprite.ts
import * as PIXI from 'pixi.js';

const sprites = new Map<string, PIXI.Container>();
const textures = new Map<string, PIXI.Texture>();

const SPRITE_SIZE = 60;
const BOBBING_AMPLITUDE = 2;
const BOBBING_SPEED = 0.002;

export interface AgentSpriteInfo {
  agentId: string;
  name: string;
  avatarSeed: string;
  emoji?: string;
}

async function getAvatarTexture(avatarSeed: string): Promise<PIXI.Texture> {
  if (textures.has(avatarSeed)) return textures.get(avatarSeed)!;

  const url = `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(avatarSeed)}&backgroundColor=transparent`;

  try {
    const res = await fetch(url);
    const svgText = await res.text();
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    const blobUrl = URL.createObjectURL(blob);
    const texture = await PIXI.Assets.load(blobUrl);
    textures.set(avatarSeed, texture);
    return texture;
  } catch {
    // Fallback: create a colored circle texture
    const gfx = new PIXI.Graphics();
    gfx.circle(0, 0, SPRITE_SIZE / 2);
    gfx.fill(0x6366f1);
    const texture = PIXI.RenderTexture.create({ width: SPRITE_SIZE, height: SPRITE_SIZE });
    textures.set(avatarSeed, texture);
    return texture;
  }
}

export async function createAgentSprite(
  instanceId: string,
  info: AgentSpriteInfo,
  x: number,
  y: number,
  stage: PIXI.Container,
): Promise<PIXI.Container> {
  const container = new PIXI.Container();
  container.x = x;
  container.y = y;
  container.label = instanceId;

  // Glow ring
  const ring = new PIXI.Graphics();
  ring.circle(0, 0, SPRITE_SIZE / 2 + 4);
  ring.stroke({ width: 2, color: 0x6366f1, alpha: 0.5 });
  container.addChild(ring);

  // Avatar
  const texture = await getAvatarTexture(info.avatarSeed || info.agentId);
  const avatar = new PIXI.Sprite(texture);
  avatar.anchor.set(0.5);
  avatar.width = SPRITE_SIZE;
  avatar.height = SPRITE_SIZE;

  // Circular mask
  const mask = new PIXI.Graphics();
  mask.circle(0, 0, SPRITE_SIZE / 2);
  mask.fill(0xffffff);
  container.addChild(mask);
  avatar.mask = mask;
  container.addChild(avatar);

  // Name label
  const label = new PIXI.Text({
    text: info.name || info.emoji || info.agentId.slice(0, 8),
    style: {
      fontFamily: 'JetBrains Mono NF, monospace',
      fontSize: 10,
      fill: 0xaaaaaa,
      align: 'center',
    },
  });
  label.anchor.set(0.5, 0);
  label.y = SPRITE_SIZE / 2 + 8;
  container.addChild(label);

  // Make interactive
  container.eventMode = 'static';
  container.cursor = 'grab';

  stage.addChild(container);
  sprites.set(instanceId, container);

  return container;
}

export function removeAgentSprite(instanceId: string): void {
  const container = sprites.get(instanceId);
  if (container) {
    container.removeFromParent();
    container.destroy();
    sprites.delete(instanceId);
  }
}

export function updateSpritePosition(instanceId: string, x: number, y: number): void {
  const container = sprites.get(instanceId);
  if (container) {
    container.x = x;
    container.y = y;
  }
}

export function applyBobbingAnimation(elapsed: number): void {
  for (const [, container] of sprites) {
    // Use the container's base position + bobbing offset
    const offset = Math.sin(elapsed * BOBBING_SPEED + container.x * 0.01) * BOBBING_AMPLITUDE;
    // Apply to the avatar sprite only (child index 2), not the whole container
    const avatar = container.children[2];
    if (avatar) avatar.y = offset;
  }
}

export function setSpriteGlowColor(instanceId: string, color: number): void {
  const container = sprites.get(instanceId);
  if (!container) return;
  const ring = container.children[0] as PIXI.Graphics;
  if (ring) {
    ring.clear();
    ring.circle(0, 0, SPRITE_SIZE / 2 + 4);
    ring.stroke({ width: 2, color, alpha: 0.5 });
  }
}

export function getSprite(instanceId: string): PIXI.Container | undefined {
  return sprites.get(instanceId);
}

export function getAllSprites(): Map<string, PIXI.Container> {
  return sprites;
}

export function clearAllSprites(): void {
  for (const [, container] of sprites) {
    container.removeFromParent();
    container.destroy();
  }
  sprites.clear();
}
```

**Step 2: Commit**

```bash
git add src/lib/workshop/agent-sprite.ts
git commit -m "feat(workshop): add PixiJS agent sprite manager"
```

---

## Task 7: Rope Renderer

**Files:**
- Create: `src/lib/workshop/rope-renderer.ts`

**Step 1: Create rope rendering module**

```typescript
// src/lib/workshop/rope-renderer.ts
import * as PIXI from 'pixi.js';

const ropes = new Map<string, { graphics: PIXI.Graphics; label: PIXI.Text }>();

function labelToColor(label: string): number {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = ((hash << 5) - hash + label.charCodeAt(i)) | 0;
  }
  // Generate a pastel-ish color from hash
  const h = Math.abs(hash) % 360;
  const s = 50 + (Math.abs(hash >> 8) % 30);
  const l = 55 + (Math.abs(hash >> 16) % 15);
  return hslToHex(h, s, l);
}

function hslToHex(h: number, s: number, l: number): number {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color);
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

export function createRope(
  relationshipId: string,
  label: string,
  stage: PIXI.Container,
): void {
  const graphics = new PIXI.Graphics();
  stage.addChildAt(graphics, 0); // Behind agent sprites

  const text = new PIXI.Text({
    text: label,
    style: {
      fontFamily: 'JetBrains Mono NF, monospace',
      fontSize: 9,
      fill: 0x888888,
      align: 'center',
    },
  });
  text.anchor.set(0.5);
  stage.addChild(text);

  ropes.set(relationshipId, { graphics, label: text });
}

export function updateRope(
  relationshipId: string,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  label: string,
  isActive: boolean = false,
): void {
  const rope = ropes.get(relationshipId);
  if (!rope) return;

  const color = labelToColor(label);
  const alpha = isActive ? 0.9 : 0.4;
  const width = isActive ? 3 : 1.5;

  // Calculate control point for catenary-like sag
  const midX = (fromX + toX) / 2;
  const midY = (fromY + toY) / 2;
  const dist = Math.sqrt((toX - fromX) ** 2 + (toY - fromY) ** 2);
  const sag = Math.min(dist * 0.15, 40); // Sag proportional to distance

  rope.graphics.clear();
  rope.graphics.moveTo(fromX, fromY);
  rope.graphics.quadraticCurveTo(midX, midY + sag, toX, toY);
  rope.graphics.stroke({ width, color, alpha });

  // Glow effect when active
  if (isActive) {
    rope.graphics.moveTo(fromX, fromY);
    rope.graphics.quadraticCurveTo(midX, midY + sag, toX, toY);
    rope.graphics.stroke({ width: width + 4, color, alpha: 0.15 });
  }

  // Position label at midpoint of the curve
  rope.label.x = midX;
  rope.label.y = midY + sag / 2;
  rope.label.text = label;
}

export function removeRope(relationshipId: string): void {
  const rope = ropes.get(relationshipId);
  if (rope) {
    rope.graphics.removeFromParent();
    rope.graphics.destroy();
    rope.label.removeFromParent();
    rope.label.destroy();
    ropes.delete(relationshipId);
  }
}

export function clearAllRopes(): void {
  for (const [, rope] of ropes) {
    rope.graphics.removeFromParent();
    rope.graphics.destroy();
    rope.label.removeFromParent();
    rope.label.destroy();
  }
  ropes.clear();
}

export function getRopeAtPoint(x: number, y: number, threshold: number = 10): string | null {
  // Simple proximity check against rope midpoints
  for (const [id, rope] of ropes) {
    const labelX = rope.label.x;
    const labelY = rope.label.y;
    const dist = Math.sqrt((x - labelX) ** 2 + (y - labelY) ** 2);
    if (dist < threshold + 20) return id;
  }
  return null;
}
```

**Step 2: Commit**

```bash
git add src/lib/workshop/rope-renderer.ts
git commit -m "feat(workshop): add elastic rope renderer"
```

---

## Task 8: Simulation Loop

**Files:**
- Create: `src/lib/workshop/simulation.ts`

**Step 1: Create the main simulation loop**

This ties physics and rendering together.

```typescript
// src/lib/workshop/simulation.ts
import * as physics from './physics';
import * as sprites from './agent-sprite';
import * as ropeRenderer from './rope-renderer';
import { workshop, updateAgentPosition } from '$lib/state/workshop.svelte';

let running = false;
let animFrameId: number | null = null;
let lastTime = 0;
let elapsed = 0;
let wanderTimer = 0;
const WANDER_INTERVAL = 2000; // ms between wander impulses

export function startSimulation(): void {
  if (running) return;
  running = true;
  lastTime = performance.now();
  tick(lastTime);
}

export function stopSimulation(): void {
  running = false;
  if (animFrameId !== null) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

function tick(now: number): void {
  if (!running) return;

  const dt = now - lastTime;
  lastTime = now;
  elapsed += dt;
  wanderTimer += dt;

  // Apply wander impulses periodically
  if (wanderTimer >= WANDER_INTERVAL) {
    wanderTimer = 0;
    for (const [instanceId, agent] of Object.entries(workshop.agents)) {
      if (agent.behavior === 'wander') {
        physics.applyWanderImpulse(instanceId, agent.homePosition.x, agent.homePosition.y, 80);
      }
    }
  }

  // Step physics
  physics.step();

  // Sync positions from physics to sprites and state
  const positions = physics.getAllPositions();
  for (const [instanceId, pos] of positions) {
    sprites.updateSpritePosition(instanceId, pos.x, pos.y);
    updateAgentPosition(instanceId, pos.x, pos.y);
  }

  // Update rope visuals
  for (const [relId, rel] of Object.entries(workshop.relationships)) {
    const fromPos = positions.get(rel.fromInstanceId);
    const toPos = positions.get(rel.toInstanceId);
    if (fromPos && toPos) {
      // Check if there's an active conversation between these agents
      const isActive = Object.values(workshop.conversations).some(
        (c) =>
          c.status === 'active' &&
          c.participantInstanceIds.includes(rel.fromInstanceId) &&
          c.participantInstanceIds.includes(rel.toInstanceId),
      );
      ropeRenderer.updateRope(relId, fromPos.x, fromPos.y, toPos.x, toPos.y, rel.label, isActive);
    }
  }

  // Bobbing animation
  sprites.applyBobbingAnimation(elapsed);

  animFrameId = requestAnimationFrame(tick);
}

export function isRunning(): boolean {
  return running;
}
```

**Step 2: Commit**

```bash
git add src/lib/workshop/simulation.ts
git commit -m "feat(workshop): add simulation loop tying physics and rendering"
```

---

## Task 9: Proximity Module

**Files:**
- Create: `src/lib/workshop/proximity.ts`

**Step 1: Create proximity detection**

```typescript
// src/lib/workshop/proximity.ts
import { workshop } from '$lib/state/workshop.svelte';

export interface ProximityPair {
  instanceIdA: string;
  instanceIdB: string;
  distance: number;
}

export function findNearbyAgents(instanceId: string, radius?: number): string[] {
  const r = radius ?? workshop.settings.proximityRadius;
  const agent = workshop.agents[instanceId];
  if (!agent) return [];

  const nearby: string[] = [];
  for (const [otherId, other] of Object.entries(workshop.agents)) {
    if (otherId === instanceId) continue;
    const dx = agent.position.x - other.position.x;
    const dy = agent.position.y - other.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= r) nearby.push(otherId);
  }
  return nearby;
}

export function getProximityPairs(radius?: number): ProximityPair[] {
  const r = radius ?? workshop.settings.proximityRadius;
  const agents = Object.entries(workshop.agents);
  const pairs: ProximityPair[] = [];

  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const [idA, a] = agents[i];
      const [idB, b] = agents[j];
      const dx = a.position.x - b.position.x;
      const dy = a.position.y - b.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= r) {
        pairs.push({ instanceIdA: idA, instanceIdB: idB, distance: dist });
      }
    }
  }
  return pairs;
}

export function distanceBetween(instanceIdA: string, instanceIdB: string): number | null {
  const a = workshop.agents[instanceIdA];
  const b = workshop.agents[instanceIdB];
  if (!a || !b) return null;
  const dx = a.position.x - b.position.x;
  const dy = a.position.y - b.position.y;
  return Math.sqrt(dx * dx + dy * dy);
}
```

**Step 2: Commit**

```bash
git add src/lib/workshop/proximity.ts
git commit -m "feat(workshop): add proximity detection module"
```

---

## Task 10: Conversation Manager

**Files:**
- Create: `src/lib/workshop/conversation-manager.ts`

**Step 1: Create the conversation orchestrator**

This module manages turn-based conversations between agents, enforcing the rules (concurrency limits, proximity gates, budget).

```typescript
// src/lib/workshop/conversation-manager.ts
import { workshop } from '$lib/state/workshop.svelte';
import { findNearbyAgents } from './proximity';

let banterMessageCount = 0;
let banterBudgetResetTime = Date.now() + 3600_000;

export function resetBanterBudget(): void {
  banterMessageCount = 0;
  banterBudgetResetTime = Date.now() + 3600_000;
}

function checkBanterBudget(): boolean {
  if (Date.now() > banterBudgetResetTime) {
    resetBanterBudget();
  }
  return banterMessageCount < workshop.settings.idleBanterBudgetPerHour;
}

function getActiveConversationCount(): number {
  return Object.values(workshop.conversations).filter((c) => c.status === 'active').length;
}

export function canStartConversation(type: 'task' | 'banter'): boolean {
  const activeCount = getActiveConversationCount();

  if (type === 'task') {
    // Tasks can always start if under limit, or bump a banter
    return activeCount < workshop.settings.maxConcurrentConversations;
  }

  if (type === 'banter') {
    if (!workshop.settings.idleBanterEnabled) return false;
    if (!checkBanterBudget()) return false;
    return activeCount < workshop.settings.maxConcurrentConversations;
  }

  return false;
}

export function startConversation(
  type: 'task' | 'banter',
  participantInstanceIds: string[],
  sessionKey: string,
): string | null {
  if (!canStartConversation(type)) return null;

  const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  workshop.conversations[id] = {
    id,
    type,
    participantInstanceIds,
    sessionKey,
    status: 'active',
  };

  if (type === 'banter') banterMessageCount++;

  return id;
}

export function endConversation(conversationId: string): void {
  const conv = workshop.conversations[conversationId];
  if (conv) {
    conv.status = 'completed';
  }
}

export function checkProximityGates(): void {
  // Remove participants who have moved out of range
  for (const [, conv] of Object.entries(workshop.conversations)) {
    if (conv.status !== 'active') continue;
    if (conv.participantInstanceIds.length < 2) {
      conv.status = 'completed';
      continue;
    }

    // Check all participants are still within proximity of each other
    const remaining = conv.participantInstanceIds.filter((id) => {
      const nearby = findNearbyAgents(id, workshop.settings.proximityRadius);
      return conv.participantInstanceIds.some((otherId) => otherId !== id && nearby.includes(otherId));
    });

    if (remaining.length < 2) {
      conv.status = 'completed';
    } else {
      conv.participantInstanceIds = remaining;
    }
  }
}

export function getConversationsForAgent(instanceId: string): string[] {
  return Object.entries(workshop.conversations)
    .filter(([, c]) => c.status === 'active' && c.participantInstanceIds.includes(instanceId))
    .map(([id]) => id);
}

export function isAgentInConversation(instanceId: string): boolean {
  return getConversationsForAgent(instanceId).length > 0;
}

export function findBanterCandidates(): Array<[string, string]> {
  if (!workshop.settings.idleBanterEnabled || !checkBanterBudget()) return [];

  const candidates: Array<[string, string]> = [];

  // Find pairs of idle agents connected by a relationship and in proximity
  for (const [, rel] of Object.entries(workshop.relationships)) {
    const fromAgent = workshop.agents[rel.fromInstanceId];
    const toAgent = workshop.agents[rel.toInstanceId];
    if (!fromAgent || !toAgent) continue;

    // Both must not be in an active conversation
    if (isAgentInConversation(rel.fromInstanceId)) continue;
    if (isAgentInConversation(rel.toInstanceId)) continue;

    // Must be in proximity
    const nearby = findNearbyAgents(rel.fromInstanceId);
    if (nearby.includes(rel.toInstanceId)) {
      candidates.push([rel.fromInstanceId, rel.toInstanceId]);
    }
  }

  return candidates;
}
```

**Step 2: Commit**

```bash
git add src/lib/workshop/conversation-manager.ts
git commit -m "feat(workshop): add conversation manager with rules and budgets"
```

---

## Task 11: Workshop Toolbar Component

**Files:**
- Create: `src/lib/components/workshop/WorkshopToolbar.svelte`

**Step 1: Create the toolbar**

This is the horizontal bar showing installed agent avatars that can be dragged onto the canvas. Use the `svelte:svelte-file-editor` agent for this Svelte component.

The toolbar should:
- Display all agents from `gw.agents` (gateway-data store) as circular avatar thumbnails
- Show tooltip on hover with name + description
- Support drag-start that emits agent data for the canvas to handle drop
- Scroll horizontally if many agents
- Match the existing cyberpunk/HUD aesthetic using the theme variables

Reference `src/lib/components/AgentSidebar.svelte` for how agents are listed and `src/lib/components/TaskCard.svelte` for drag-start pattern.

Agent avatar URL pattern: `https://api.dicebear.com/9.x/notionists/svg?seed=${avatarSeed}&backgroundColor=transparent`

For agents from `gw.agents` that don't have `avatarSeed`, fall back to their `emoji` or agent `id`.

Include a Save/Load section at the right side of the toolbar with buttons that trigger the save/load functions from the workshop state store.

**Step 2: Run the svelte autofixer on the component before committing**

**Step 3: Commit**

```bash
git add src/lib/components/workshop/WorkshopToolbar.svelte
git commit -m "feat(workshop): add toolbar component with agent drag source"
```

---

## Task 12: Speech Bubble Component

**Files:**
- Create: `src/lib/components/workshop/SpeechBubble.svelte`

**Step 1: Create the speech bubble overlay**

HTML overlay component positioned absolutely over the PixiJS canvas. Receives world coordinates and converts to screen coordinates using the camera state.

Features:
- Shows agent name + latest message text
- Auto-fades after 5 seconds (CSS animation)
- Positioned above the agent sprite (offset upward)
- Comic-style bubble with a small triangle pointer
- Matches theme (bg3 background, border color, foreground text)
- Max width ~200px, text truncated with ellipsis for long messages

Props:
- `message: string`
- `agentName: string`
- `screenX: number`
- `screenY: number`
- `onFaded: () => void` (callback when fade completes)

**Step 2: Run the svelte autofixer**

**Step 3: Commit**

```bash
git add src/lib/components/workshop/SpeechBubble.svelte
git commit -m "feat(workshop): add speech bubble overlay component"
```

---

## Task 13: Chat Panel Component

**Files:**
- Create: `src/lib/components/workshop/ChatPanel.svelte`

**Step 1: Create the expandable chat panel**

A floating/docked panel that shows the full conversation thread between agents. Triggered by clicking on a conversation indicator or speech bubble.

Features:
- Slide-in from the right (or floating near the conversation)
- Shows all messages with agent avatars + timestamps
- Auto-scrolls to latest message
- Close button
- Semi-transparent background matching theme
- Displays conversation type (task/banter) and participant list

Props:
- `conversationId: string`
- `onClose: () => void`

Reads messages from the `chat` state store filtered by the conversation's `sessionKey`.

Reference `src/lib/components/DetailPanel.svelte` for the existing panel pattern.

**Step 2: Run the svelte autofixer**

**Step 3: Commit**

```bash
git add src/lib/components/workshop/ChatPanel.svelte
git commit -m "feat(workshop): add expandable chat panel component"
```

---

## Task 14: Context Menu Component

**Files:**
- Create: `src/lib/components/workshop/ContextMenu.svelte`

**Step 1: Create the right-click context menu**

Appears on right-click on an agent sprite. Positioned at cursor location.

Menu items:
- Start conversation with... (submenu of nearby agents)
- Assign task (opens text input)
- Change behavior → Stationary / Wander / Patrol
- View profile (navigates to agent detail)
- Remove from canvas

Props:
- `instanceId: string`
- `x: number` (screen position)
- `y: number`
- `onClose: () => void`
- `onAction: (action: string, data?: unknown) => void`

Closes on click outside or Escape key. Matches theme styling (bg2 background, border, hover states).

**Step 2: Run the svelte autofixer**

**Step 3: Commit**

```bash
git add src/lib/components/workshop/ContextMenu.svelte
git commit -m "feat(workshop): add agent context menu component"
```

---

## Task 15: Relationship Prompt Component

**Files:**
- Create: `src/lib/components/workshop/RelationshipPrompt.svelte`

**Step 1: Create the relationship label input**

A small floating dialog that appears when the user completes a drag-to-link between two agents. Shows the two agent names and a text input for the freeform relationship label.

Props:
- `fromName: string`
- `toName: string`
- `x: number` (screen position)
- `y: number`
- `onSubmit: (label: string) => void`
- `onCancel: () => void`

Features:
- Auto-focuses the text input
- Submit on Enter, cancel on Escape
- Matches theme styling
- Shows suggested labels as placeholder text (e.g. "Manager, Mentor, Collaborator...")

**Step 2: Run the svelte autofixer**

**Step 3: Commit**

```bash
git add src/lib/components/workshop/RelationshipPrompt.svelte
git commit -m "feat(workshop): add relationship label prompt component"
```

---

## Task 16: Main WorkshopCanvas Component

**Files:**
- Create: `src/lib/components/workshop/WorkshopCanvas.svelte`

**Step 1: Create the main canvas component**

This is the core component that:
1. Initializes PixiJS Application and Rapier physics
2. Mounts the PixiJS canvas to a container div
3. Handles all pointer events (pan, zoom, drag agents, drag-to-link, right-click)
4. Manages the HTML overlay layer (speech bubbles, context menus, relationship prompts, chat panels)
5. Starts/stops the simulation loop
6. Syncs state from the workshop store to physics/sprites on mount
7. Handles agent drop from the toolbar (custom event from WorkshopToolbar)

Key interactions:
- **Pan**: pointer down on empty canvas → drag moves camera
- **Zoom**: scroll wheel → zoom toward cursor
- **Move agent**: pointer down on agent sprite → drag moves the agent (kinematic during drag, dynamic on release)
- **Link agents**: pointer down on agent + shift key held → starts link drag, shows dashed line → drop on another agent → show RelationshipPrompt
- **Right-click**: show ContextMenu on agent
- **Click rope**: show edit/delete options

Lifecycle:
- `onMount`: init PixiJS, init Rapier, restore state from autoLoad, create sprites/bodies for existing agents, start simulation
- `onDestroy`: stop simulation, destroy PixiJS app, destroy Rapier world

The canvas container is a `<div>` that fills the available space below the toolbar. The HTML overlay is a sibling `<div>` with `pointer-events: none` (individual overlay children have `pointer-events: auto`).

Reference:
- `src/lib/components/ParticleCanvas.svelte` for the PixiJS mounting pattern (but this uses raw Canvas 2D; we need PixiJS Application)
- `src/lib/components/TaskCard.svelte` for drag event handling

**Step 2: Run the svelte autofixer**

**Step 3: Commit**

```bash
git add src/lib/components/workshop/WorkshopCanvas.svelte
git commit -m "feat(workshop): add main WorkshopCanvas component"
```

---

## Task 17: Workshop Page Route

**Files:**
- Create: `src/routes/workshop/+page.svelte`
- Create: `src/routes/workshop/+page.ts`

**Step 1: Create the page load function**

```typescript
// src/routes/workshop/+page.ts
export const ssr = false; // PixiJS and Rapier are client-only
```

**Step 2: Create the workshop page**

```svelte
<!-- src/routes/workshop/+page.svelte -->
<script lang="ts">
  import Topbar from '$lib/components/Topbar.svelte';
  import WorkshopToolbar from '$lib/components/workshop/WorkshopToolbar.svelte';
  import WorkshopCanvas from '$lib/components/workshop/WorkshopCanvas.svelte';
</script>

<div class="relative z-10 flex flex-col h-screen overflow-hidden">
  <Topbar />
  <WorkshopToolbar />
  <WorkshopCanvas />
</div>
```

**Step 3: Run the svelte autofixer on the page component**

**Step 4: Commit**

```bash
git add src/routes/workshop/
git commit -m "feat(workshop): add workshop route with page and SSR disabled"
```

---

## Task 18: Add Workshop to Topbar Navigation

**Files:**
- Modify: `src/lib/components/Topbar.svelte`

**Step 1: Read the current Topbar**

Read `src/lib/components/Topbar.svelte` to see the exact current state.

**Step 2: Add Workshop nav item**

Add the Workshop link after the existing nav items (around line 29-32). Add an `isWorkshop` derived variable like the existing `isMarketplace` pattern:

```typescript
const isWorkshop = $derived($page.url.pathname.startsWith('/workshop'));
```

Add the nav link with active state styling:

```svelte
<a href="/workshop" class="text-xs no-underline px-3 py-1 rounded-full border transition-all duration-150 {isWorkshop ? 'bg-accent/10 text-accent border-accent/30' : 'text-muted border-border hover:bg-bg3 hover:text-foreground'}">Workshop</a>
```

**Step 3: Commit**

```bash
git add src/lib/components/Topbar.svelte
git commit -m "feat(workshop): add Workshop tab to topbar navigation"
```

---

## Task 19: Integration Testing - Canvas Renders

**Step 1: Start the dev server and verify**

```bash
npm run dev
```

Navigate to `http://localhost:5173/workshop` in a browser and verify:
- Page loads without errors
- Topbar shows "Workshop" tab with active state
- PixiJS canvas initializes (check for WebGL context in dev tools)
- Toolbar shows installed agents (if gateway is connected) or is empty
- Pan/zoom works on the canvas
- No console errors

**Step 2: Test agent placement**

- Drag an agent from the toolbar onto the canvas
- Verify the agent sprite appears at the drop position
- Verify the agent has a bobbing idle animation
- Try dragging the placed agent around the canvas
- Right-click the agent to verify context menu appears

**Step 3: Test relationships**

- Place two agents on the canvas
- Shift+drag from one agent to another
- Verify the relationship prompt appears
- Enter a label and submit
- Verify the elastic rope appears between the agents
- Drag one agent away and verify the rope stretches

**Step 4: Fix any issues found**

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(workshop): integration fixes from manual testing"
```

---

## Task 20: Conversation Integration with Gateway

**Files:**
- Modify: `src/lib/workshop/conversation-manager.ts` (add gateway integration)

**Step 1: Wire up conversation manager to the gateway**

This task connects the conversation manager to the existing WebSocket gateway so that workshop conversations create real sessions and exchange real LLM messages.

Read these files first to understand the gateway API:
- `src/lib/services/gateway.svelte.ts`
- `src/lib/state/chat.svelte.ts`
- `src/lib/types/gateway.ts`

The conversation manager should:
1. When `startConversation` is called with a task prompt, create a new gateway session
2. Send the initial prompt as a message to the first agent participant
3. When a response is received, route it to the next agent (turn-based)
4. Track turns and enforce the conversation rules
5. Emit events that the WorkshopCanvas can listen to for speech bubble updates

This task requires understanding the gateway protocol - read the service files first.

**Step 2: Update WorkshopCanvas to show speech bubbles on new messages**

When a conversation message arrives, create a SpeechBubble at the speaking agent's screen position.

**Step 3: Commit**

```bash
git add src/lib/workshop/conversation-manager.ts src/lib/components/workshop/WorkshopCanvas.svelte
git commit -m "feat(workshop): integrate conversations with gateway for real LLM chat"
```

---

## Task 21: Save/Load UI

**Files:**
- Create: `src/lib/components/workshop/SaveLoadBar.svelte`

**Step 1: Create save/load UI component**

A dropdown or modal that lets the user:
- Save current workspace with a name (text input + save button)
- See list of saved workspaces (name + date)
- Load a saved workspace (click to load)
- Delete a saved workspace (delete button with confirmation)

Integrate into the WorkshopToolbar (right side section).

Uses the `saveWorkspace`, `loadWorkspace`, `listWorkspaceSaves`, `deleteWorkspaceSave` functions from the workshop state store.

**Step 2: Run the svelte autofixer**

**Step 3: Commit**

```bash
git add src/lib/components/workshop/SaveLoadBar.svelte
git commit -m "feat(workshop): add save/load workspace UI"
```

---

## Task 22: Final Polish & Commit

**Step 1: Review all files for consistency**

- Ensure all imports are correct
- Verify theme variables are used consistently
- Check for any TypeScript errors: `npx tsc --noEmit`
- Run the build: `npm run build`

**Step 2: Test the complete flow end-to-end**

1. Navigate to Workshop
2. Drag agents onto canvas
3. Create relationships between them
4. Start a task conversation
5. Verify speech bubbles appear
6. Open chat panel
7. Save workspace
8. Refresh page - verify auto-restore
9. Load a named save

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat(workshop): complete agent interaction canvas with physics, conversations, and persistence"
```
