import { recordPathSegment } from '$lib/utils/record-path';
import { hostsState } from '$lib/state/features/hosts.svelte';
import { userState } from '$lib/state/features/user.svelte';
import { Debouncer } from '$lib/pacer/index.svelte';
import type {
  AgentInstance,
  Relationship,
  WorkshopConversation,
  ElementType,
  PinboardItem,
  InboxItemStatus,
  InboxAttachment,
  InboxItem,
  AgentMemory,
  WorkshopElement,
  WorkshopSettings,
  WorkshopState,
} from './workshop.types';
// Internal: autoLoad calls loadMemory after restoring slices. Memory split lives
// in workshop.memory.svelte — function-only ref, ESM-safe.
import { loadMemory } from './workshop.memory.svelte';

type WorkshopSlice =
  'camera' | 'agents' | 'relationships' | 'conversations' | 'elements' | 'settings';
const ALL_SLICES: WorkshopSlice[] = [
  'camera',
  'agents',
  'relationships',
  'conversations',
  'elements',
  'settings',
];

function autosaveKey(hostId: string, slice: WorkshopSlice): string {
  return `workshop:autosave:${hostId}:${slice}`;
}

/** Legacy single-key used before incremental save — kept for migration read. */
function legacyAutosaveKey(hostId: string): string {
  return `workshop:autosave:${hostId}`;
}

/** Key for view mode preference */
function viewModeKey(): string {
  return 'workshop:viewMode';
}

export const workshopState: WorkshopState = $state({
  camera: { x: 0, y: 0, zoom: 1 },
  agents: {} as Record<string, AgentInstance>,
  relationships: {} as Record<string, Relationship>,
  conversations: {} as Record<string, WorkshopConversation>,
  elements: {} as Record<string, WorkshopElement>,
  settings: {
    maxConcurrentConversations: 3,
    agentChatsEnabled: true,
    idleBanterEnabled: true,
    idleBanterBudgetPerHour: 20,
    proximityRadius: 200,
    banterCheckInterval: 28_000,
    banterCooldown: 120_000,
    banterMaxTurns: 4,
    taskMaxTurns: 6,
    responseTimeout: 120_000,
    banterPrompt:
      "Have a spontaneous, in-character conversation. Discuss what you're currently working on, share observations about the workspace, or just chat. Keep it natural and brief.",
    taskPrompt: "Reflect on your current state and describe what you'd work on next.",
    viewMode: 'classic',
    crossWorkspaceChats: true,
  },
});

// --- View Mode Management ---

export function loadViewMode(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const saved = localStorage.getItem(viewModeKey());
    if (saved === 'classic' || saved === 'habbo' || saved === 'pixel') {
      workshopState.settings.viewMode = saved;
    }
  } catch {
    /* ignore */
  }
}

export function setViewMode(mode: 'classic' | 'habbo' | 'pixel'): void {
  workshopState.settings.viewMode = mode;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(viewModeKey(), mode);
    } catch {
      /* ignore */
    }
  }
  dirtySlices.add('settings');
  autoSave(undefined, 'settings');
}

export function toggleViewMode(): void {
  const modes: Array<'classic' | 'habbo' | 'pixel'> = ['classic', 'habbo', 'pixel'];
  const currentIdx = modes.indexOf(workshopState.settings.viewMode);
  const newMode = modes[(currentIdx + 1) % modes.length];
  setViewMode(newMode);
}

/** Toggle whether idle agents auto-chat ("banter"). Persists to the settings slice. */
export function toggleIdleBanter(): void {
  workshopState.settings.idleBanterEnabled = !workshopState.settings.idleBanterEnabled;
  autoSave(undefined, 'settings');
}

// --- Workspace owner (HC-037) ---
//
// Mirrors services/gateway/session-owner.svelte: a handle captured at dispatch
// and re-checked before every publication. `intent` is the latest load the user
// asked for; `active` is the workspace whose state is on screen. A load may
// publish only while it is still the intent; a save may publish status only
// while its owner is still active. Both also require the actor/org that
// dispatched them to still be signed in.

export interface WorkspaceOwner {
  readonly saveId: string;
  readonly actorId: string;
  readonly orgId: string;
  readonly generation: number;
  readonly current: () => boolean;
}

let generation = 0;
let intent: WorkspaceOwner | null = null;
let active: WorkspaceOwner | null = null;

function identityMatches(owner: WorkspaceOwner): boolean {
  return (userState.user?.id ?? '') === owner.actorId && (userState.orgId ?? '') === owner.orgId;
}

function createOwner(saveId: string, slot: () => WorkspaceOwner | null): WorkspaceOwner {
  const owner: WorkspaceOwner = Object.freeze({
    saveId,
    actorId: userState.user?.id ?? '',
    orgId: userState.orgId ?? '',
    generation: ++generation,
    current: () => slot() === owner && identityMatches(owner),
  });
  return owner;
}

/** Capture the user's latest load intent; every earlier in-flight load goes stale. */
function dispatchIntent(saveId: string): WorkspaceOwner {
  intent = createOwner(saveId, () => intent);
  return intent;
}

function retireWorkspaceOwner(): void {
  generation++;
  intent = null;
  active = null;
}

// --- Auto-save / auto-load (localStorage, incremental per-slice) ---

const dirtySlices = new Set<WorkshopSlice>();
/** Bumped by every local mutation; the DB save compares it to decide `saved` vs `unsaved`. */
let mutationSeq = 0;
let ackedSeq = 0;

const autoSaveDebouncer = new Debouncer(
  (hid: string) => {
    const snapshot = $state.snapshot(workshopState);
    for (const slice of dirtySlices) {
      try {
        localStorage.setItem(autosaveKey(hid, slice), JSON.stringify(snapshot[slice]));
      } catch {
        // non-critical (quota errors, etc.)
      }
    }
    dirtySlices.clear();
    if (!active) saveSync.lastSavedAt = Date.now();
    else if (mutationSeq !== ackedSeq) scheduleDbSave();
  },
  { wait: 300 },
);

/** Mirror slices to the host's localStorage layout without claiming a new mutation. */
function markDirty(hostId: string, slices: WorkshopSlice[]) {
  for (const s of slices) dirtySlices.add(s);
  autoSaveDebouncer.maybeExecute(hostId);
}

/**
 * Schedule an incremental autosave. Pass the slices that changed; if none are
 * passed, all slices are marked dirty (full save — used by external callers).
 */
export function autoSave(
  hostId: string | null = hostsState.activeHostId,
  ...slices: WorkshopSlice[]
) {
  if (!hostId) return;
  mutationSeq++;
  if (active) saveSync.status = 'unsaved';
  markDirty(hostId, slices.length > 0 ? slices : ALL_SLICES);
}

function restoreConversations(saved: Partial<WorkshopState>) {
  if (!saved.conversations) return;
  const cleaned: Record<string, WorkshopConversation> = {};
  const bestByPair = new Map<string, { id: string; startedAt: number }>();
  for (const [id, conv] of Object.entries(saved.conversations)) {
    if (!conv.participantAgentIds || !conv.startedAt) continue;
    if (conv.status === 'active') conv.status = 'interrupted';
    const pairKey = [...conv.participantAgentIds].sort().join(':');
    const existing = bestByPair.get(pairKey);
    if (!existing || conv.startedAt > existing.startedAt) {
      if (existing) delete cleaned[existing.id];
      bestByPair.set(pairKey, { id, startedAt: conv.startedAt });
      cleaned[id] = conv;
    }
  }
  workshopState.conversations = cleaned;
}

/** Migrate pinboard items that pre-date voting fields (upvotes/downvotes/comments). */
function migratePinboardVoting() {
  for (const el of Object.values(workshopState.elements)) {
    if (el.type === 'pinboard' && el.pinboardItems) {
      for (const pin of el.pinboardItems) {
        if (!pin.upvotes) pin.upvotes = [];
        if (!pin.downvotes) pin.downvotes = [];
        if (!pin.comments) pin.comments = [];
      }
    }
  }
}

/** Migrate inbox items that pre-date subject/status fields. */
function migrateInboxItems() {
  for (const el of Object.values(workshopState.elements)) {
    if (el.type === 'inbox') {
      for (const item of el.inboxItems ?? []) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = item as any;
        if (raw.status === undefined) item.status = 'open';
        if (raw.subject === undefined) item.subject = '';
      }
      for (const item of el.outboxItems ?? []) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = item as any;
        if (raw.status === undefined) item.status = 'open';
        if (raw.subject === undefined) item.subject = '';
      }
    }
  }
}

export function autoLoad(hostId: string | null = hostsState.activeHostId) {
  if (!hostId) return;
  try {
    // Try incremental per-slice keys first
    const hasSliceKeys = ALL_SLICES.some(
      (s) => localStorage.getItem(autosaveKey(hostId, s)) !== null,
    );

    if (hasSliceKeys) {
      const load = <T>(slice: WorkshopSlice): T | null => {
        const raw = localStorage.getItem(autosaveKey(hostId, slice));
        return raw ? (JSON.parse(raw) as T) : null;
      };
      const camera = load<WorkshopState['camera']>('camera');
      const agents = load<WorkshopState['agents']>('agents');
      const relationships = load<WorkshopState['relationships']>('relationships');
      const settings = load<WorkshopState['settings']>('settings');
      const elements = load<WorkshopState['elements']>('elements');
      const conversations = load<WorkshopState['conversations']>('conversations');
      if (camera) workshopState.camera = camera;
      if (agents) workshopState.agents = agents;
      if (relationships) workshopState.relationships = relationships;
      if (settings) workshopState.settings = { ...workshopState.settings, ...settings };
      if (elements) workshopState.elements = elements;
      migratePinboardVoting();
      migrateInboxItems();
      restoreConversations({ conversations: conversations ?? undefined });
    } else {
      // Fallback: read legacy single-key format
      const raw = localStorage.getItem(legacyAutosaveKey(hostId));
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<WorkshopState>;
      workshopState.camera = saved.camera ?? workshopState.camera;
      workshopState.agents = saved.agents ?? workshopState.agents;
      workshopState.relationships = saved.relationships ?? workshopState.relationships;
      workshopState.settings = { ...workshopState.settings, ...saved.settings };
      workshopState.elements = saved.elements ?? {};
      migratePinboardVoting();
      migrateInboxItems();
      restoreConversations(saved);
      // Migrate to per-slice keys immediately
      autoSave(hostId, ...ALL_SLICES);
    }
  } catch {
    // non-critical
  }
  loadMemory();
}

// --- Agent instances ---

let instanceCounter = 0;

function generateInstanceId(): string {
  return `inst_${Date.now()}_${instanceCounter++}`;
}

export function addAgentInstance(agentId: string, x: number, y: number): string {
  const instanceId = generateInstanceId();
  workshopState.agents[instanceId] = {
    instanceId,
    agentId,
    position: { x, y },
    behavior: 'stationary',
    homePosition: { x, y },
  };
  autoSave(undefined, 'agents');
  return instanceId;
}

export function removeAgentInstance(instanceId: string) {
  delete workshopState.agents[instanceId];
  // Remove any relationships connected to this instance
  for (const [id, rel] of Object.entries(workshopState.relationships)) {
    if (rel.fromInstanceId === instanceId || rel.toInstanceId === instanceId) {
      delete workshopState.relationships[id];
    }
  }
  autoSave(undefined, 'agents', 'relationships');
}

export function updateAgentPosition(instanceId: string, x: number, y: number) {
  const agent = workshopState.agents[instanceId];
  if (agent) {
    agent.position = { x, y };
    // Note: no autoSave here — this is called every frame from the simulation loop.
    // Position is saved as part of the debounced autoSave triggered by other mutations.
  }
}

export function setAgentBehavior(instanceId: string, behavior: AgentInstance['behavior']) {
  const agent = workshopState.agents[instanceId];
  if (agent) {
    agent.behavior = behavior;
    autoSave(undefined, 'agents');
  }
}

// --- Relationships ---

let relCounter = 0;

function generateRelationshipId(): string {
  return `rel_${Date.now()}_${relCounter++}`;
}

export function addRelationship(from: string, to: string, label: string): string {
  const id = generateRelationshipId();
  workshopState.relationships[id] = {
    id,
    fromInstanceId: from,
    toInstanceId: to,
    label,
  };
  autoSave(undefined, 'relationships');
  return id;
}

export function removeRelationship(id: string) {
  delete workshopState.relationships[id];
  autoSave(undefined, 'relationships');
}

export function updateRelationshipLabel(id: string, label: string) {
  const rel = workshopState.relationships[id];
  if (rel) {
    rel.label = label;
    autoSave(undefined, 'relationships');
  }
}

// --- Structural undo (add/remove agent · element · relationship) ---
//
// Physics canvases can't support frame-by-frame undo (positions change every
// tick), so we snapshot only the *structural* slices before a discrete user
// action. Restoring is followed by an imperative rebuildScene() in the canvas,
// which is authoritative — no risk of a state/sprite ghost.

interface WorkshopCheckpoint {
  agents: Record<string, AgentInstance>;
  relationships: Record<string, Relationship>;
  elements: Record<string, WorkshopElement>;
}

const UNDO_LIMIT = 20;
const undoStack: WorkshopCheckpoint[] = [];

export const undoState = $state<{ canUndo: boolean }>({ canUndo: false });

/** Snapshot the structural slices before a discrete, undoable user action. */
export function pushUndoCheckpoint(): void {
  const snap = $state.snapshot(workshopState);
  // structuredClone yields a mutable deep copy ($state.snapshot is frozen).
  undoStack.push({
    agents: structuredClone(snap.agents) as Record<string, AgentInstance>,
    relationships: structuredClone(snap.relationships) as Record<string, Relationship>,
    elements: structuredClone(snap.elements) as Record<string, WorkshopElement>,
  });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  undoState.canUndo = undoStack.length > 0;
}

/**
 * Restore the most recent checkpoint. Returns true if state changed (the caller
 * is responsible for re-syncing the canvas via rebuildScene()).
 */
export function popUndoCheckpoint(): boolean {
  const cp = undoStack.pop();
  undoState.canUndo = undoStack.length > 0;
  if (!cp) return false;
  workshopState.agents = cp.agents;
  workshopState.relationships = cp.relationships;
  workshopState.elements = cp.elements;
  autoSave(undefined, 'agents', 'relationships', 'elements');
  return true;
}

/** Drop all undo history (e.g. when opening a different save). */
export function clearUndoHistory(): void {
  undoStack.length = 0;
  undoState.canUndo = false;
}

// --- Server-side workspace saves ---

/**
 * `unsaved` = a local mutation the server has not acknowledged; `saving` = PUT
 * in flight; `saved` = acknowledged with no mutation since; `failed` = the
 * server rejected it; `unknown` = the response was lost (the write may or may
 * not have landed). Recovery is explicit (`retryDbSave`), never a silent replay.
 */
export type WorkspaceSaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved' | 'failed' | 'unknown';

export const saveSync = $state<{
  activeSaveId: string | null;
  status: WorkspaceSaveStatus;
  lastSavedAt: number | null;
}>({
  activeSaveId: null,
  status: 'idle',
  lastSavedAt: null,
});

let thumbnailProvider: (() => Promise<string | null>) | null = null;

export function registerThumbnailProvider(fn: () => Promise<string | null>) {
  thumbnailProvider = fn;
}

export function unregisterThumbnailProvider() {
  thumbnailProvider = null;
}

/**
 * The snapshot and its sequence are captured synchronously (before any await)
 * so a flush on teardown/switch persists what was on screen, not what replaced
 * it. The PUT is sent only for the identity that owns it; status is published
 * only while that owner is still the active workspace.
 */
async function saveWorkspace(owner: WorkspaceOwner): Promise<void> {
  if (!owner.current()) return;
  const seq = mutationSeq;
  const snapshot = $state.snapshot(workshopState);
  saveSync.status = 'saving';
  let thumbnail: string | null = null;
  try {
    thumbnail = thumbnailProvider ? await thumbnailProvider() : null;
  } catch {
    thumbnail = null;
  }
  if (!identityMatches(owner)) return;
  let res: Response;
  try {
    res = await fetch(`/api/workshop/saves/${recordPathSegment(owner.saveId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: JSON.stringify(snapshot),
        ...(thumbnail ? { thumbnail } : {}),
      }),
    });
  } catch {
    if (owner.current()) saveSync.status = 'unknown';
    return;
  }
  if (!owner.current()) return;
  if (!res.ok) {
    saveSync.status = 'failed';
    return;
  }
  ackedSeq = seq;
  saveSync.lastSavedAt = Date.now();
  saveSync.status = mutationSeq === seq ? 'saved' : 'unsaved';
}

const dbSaveDebouncer = new Debouncer(saveWorkspace, { wait: 2000 });

export function scheduleDbSave() {
  if (!active) return;
  dbSaveDebouncer.maybeExecute(active);
}

/** Run any pending debounced saves now (route teardown, workspace switch). */
export function flushDbSave() {
  autoSaveDebouncer.flush();
  dbSaveDebouncer.flush();
}

/** Explicit recovery after `failed`/`unknown`: one send of the CURRENT state. */
export async function retryDbSave(): Promise<void> {
  if (!active) return;
  dbSaveDebouncer.cancel();
  await saveWorkspace(active);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Replace the on-screen workspace with `saved` under `owner`; previous owner's pending saves go out first. */
function publishWorkspace(owner: WorkspaceOwner, saved: Partial<WorkshopState>) {
  flushDbSave();
  const blank = blankWorkshopState();
  workshopState.camera = isRecord(saved.camera) ? saved.camera : blank.camera;
  workshopState.agents = isRecord(saved.agents) ? saved.agents : {};
  workshopState.relationships = isRecord(saved.relationships) ? saved.relationships : {};
  workshopState.settings = {
    ...workshopState.settings,
    ...(isRecord(saved.settings) ? saved.settings : {}),
  };
  workshopState.conversations = {};
  workshopState.elements = isRecord(saved.elements) ? saved.elements : {};
  migratePinboardVoting();
  migrateInboxItems();
  restoreConversations({
    conversations: isRecord(saved.conversations) ? saved.conversations : undefined,
  });
  active = createOwner(owner.saveId, () => active);
  ackedSeq = mutationSeq;
  saveSync.activeSaveId = owner.saveId;
  saveSync.status = 'saved';
  saveSync.lastSavedAt = null;
  persistActiveSaveId(owner.saveId);
  clearUndoHistory();
  const hostId = hostsState.activeHostId;
  if (hostId) markDirty(hostId, ALL_SLICES);
}

/**
 * Load a saved workspace. Resolves `true` when it published (state, active-save
 * identity, persisted key), `false` when a later open/create or an actor/org
 * change superseded it; throws on a real failure with the live state untouched.
 */
export async function openSave(id: string): Promise<boolean> {
  const owner = dispatchIntent(id);
  const res = await fetch(`/api/workshop/saves/${recordPathSegment(id)}`);
  if (!owner.current()) return false;
  if (!res.ok) throw new Error('Failed to load workspace');
  const { save } = await res.json();
  if (!owner.current()) return false;
  const saved: unknown = typeof save?.state === 'string' ? JSON.parse(save.state) : save?.state;
  if (!isRecord(saved)) throw new Error('Failed to load workspace');
  publishWorkspace(owner, saved as Partial<WorkshopState>);
  return true;
}

/**
 * Create a blank workspace. The live workspace is untouched until the server
 * acknowledges; a rejection throws with state and selection intact. Resolves
 * the new id, or `null` when a later open/create or identity change superseded it.
 */
export async function createBlankSave(name: string): Promise<string | null> {
  const owner = dispatchIntent('');
  const blank = blankWorkshopState();
  const res = await fetch('/api/workshop/saves', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, state: JSON.stringify(blank) }),
  });
  if (!owner.current()) return null;
  if (!res.ok) throw new Error('Failed to create workspace');
  const { id } = await res.json();
  if (!owner.current() || typeof id !== 'string' || !id) return null;
  publishWorkspace({ ...owner, saveId: id }, blank);
  return id;
}

const ACTIVE_SAVE_KEY = 'workshop:activeSaveId';

export function persistActiveSaveId(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_SAVE_KEY, id);
    else localStorage.removeItem(ACTIVE_SAVE_KEY);
  } catch {
    // non-critical
  }
}

export function loadPersistedActiveSaveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_SAVE_KEY);
  } catch {
    return null;
  }
}

export async function listWorkspaceSaves(): Promise<
  Array<{
    id: string;
    name: string;
    updatedAt: number;
    createdAt: number;
    thumbnail: string | null;
    agentCount: number;
    elementCount: number;
  }>
> {
  const res = await fetch('/api/workshop/saves');
  if (!res.ok) throw new Error('Failed to list workspace saves');
  const { saves } = await res.json();
  return saves;
}

export async function deleteWorkspaceSave(id: string) {
  const res = await fetch(`/api/workshop/saves/${recordPathSegment(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete workspace save');
}

// --- Reset ---

export function blankWorkshopState(): WorkshopState {
  return {
    camera: { x: 0, y: 0, zoom: 1 },
    agents: {},
    relationships: {},
    conversations: {},
    elements: {},
    settings: {
      maxConcurrentConversations: 3,
      agentChatsEnabled: true,
      idleBanterEnabled: true,
      idleBanterBudgetPerHour: 20,
      proximityRadius: 200,
      banterCheckInterval: 28_000,
      banterCooldown: 120_000,
      banterMaxTurns: 4,
      taskMaxTurns: 6,
      responseTimeout: 120_000,
      banterPrompt:
        "Have a spontaneous, in-character conversation. Discuss what you're currently working on, share observations about the workspace, or just chat. Keep it natural and brief.",
      taskPrompt: "Reflect on your current state and describe what you'd work on next.",
      viewMode: 'classic',
      crossWorkspaceChats: true,
    },
  };
}

/**
 * Blank the workspace (host switch, disconnect). Pending saves are flushed
 * FIRST — their snapshots are captured synchronously — so what gets persisted
 * is the workspace that was on screen, never the blank one; then every owner
 * is retired so nothing in flight can publish into the new workspace.
 */
export function resetWorkshop() {
  flushDbSave();
  retireWorkspaceOwner();
  Object.assign(workshopState, blankWorkshopState());
  saveSync.activeSaveId = null;
  saveSync.status = 'idle';
  saveSync.lastSavedAt = null;
}

// --- Workshop elements ---

let elementCounter = 0;

function generateElementId(): string {
  return `elem_${Date.now()}_${elementCounter++}`;
}

export function addElement(
  type: ElementType,
  x: number,
  y: number,
  label: string,
  inboxAgentId?: string,
): string {
  const instanceId = generateElementId();
  const element: WorkshopElement = {
    instanceId,
    type,
    position: { x, y },
    label,
  };

  if (type === 'pinboard') element.pinboardItems = [];
  if (type === 'messageboard') element.messageBoardContent = '';
  if (type === 'inbox') {
    element.inboxAgentId = inboxAgentId;
    element.inboxItems = [];
    element.outboxItems = [];
  }
  if (type === 'rulebook') element.rulebookContent = '';
  if (type === 'portal') {
    element.portalTargetWorkspaceId = '';
    element.portalLabel = '';
  }

  workshopState.elements[instanceId] = element;
  autoSave(undefined, 'elements');
  return instanceId;
}

export function removeElement(instanceId: string) {
  delete workshopState.elements[instanceId];
  autoSave(undefined, 'elements');
}

export function updateElementPosition(instanceId: string, x: number, y: number) {
  const el = workshopState.elements[instanceId];
  if (el) {
    el.position = { x, y };
  }
}

const MAX_PINBOARD_ITEMS = 50;
const MAX_INBOX_ITEMS = 100;

export function addPinboardItem(elementId: string, content: string, pinnedBy: string) {
  const el = workshopState.elements[elementId];
  if (!el || el.type !== 'pinboard') return;
  if (!el.pinboardItems) el.pinboardItems = [];
  el.pinboardItems.push({
    id: `pin_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    content,
    pinnedBy,
    pinnedAt: Date.now(),
    upvotes: [],
    downvotes: [],
    comments: [],
  });
  // Cap at MAX_PINBOARD_ITEMS — remove oldest (lowest pinnedAt) on overflow
  if (el.pinboardItems.length > MAX_PINBOARD_ITEMS) {
    el.pinboardItems.sort((a, b) => a.pinnedAt - b.pinnedAt);
    el.pinboardItems.splice(0, el.pinboardItems.length - MAX_PINBOARD_ITEMS);
  }
  autoSave(undefined, 'elements');
}

export function removePinboardItem(elementId: string, itemId: string) {
  const el = workshopState.elements[elementId];
  if (!el || !el.pinboardItems) return;
  el.pinboardItems = el.pinboardItems.filter((p) => p.id !== itemId);
  autoSave(undefined, 'elements');
}

/** Vote on a pinboard item. Removes opposite vote if it exists; auto-removes item if net score ≤ −3. */
export function votePinboardItem(
  elementId: string,
  pinId: string,
  voterId: string,
  direction: 'up' | 'down',
): void {
  const el = workshopState.elements[elementId];
  if (!el || !el.pinboardItems) return;
  const pin = el.pinboardItems.find((p) => p.id === pinId);
  if (!pin) return;

  if (direction === 'up') {
    pin.downvotes = pin.downvotes.filter((v) => v !== voterId);
    if (!pin.upvotes.includes(voterId)) pin.upvotes.push(voterId);
  } else {
    pin.upvotes = pin.upvotes.filter((v) => v !== voterId);
    if (!pin.downvotes.includes(voterId)) pin.downvotes.push(voterId);
  }

  // Auto-remove if net score ≤ −3
  const netScore = pin.upvotes.length - pin.downvotes.length;
  if (netScore <= -3) {
    el.pinboardItems = el.pinboardItems.filter((p) => p.id !== pinId);
  }

  autoSave(undefined, 'elements');
}

/** Add a comment to a pinboard item. */
export function addPinboardComment(
  elementId: string,
  pinId: string,
  authorId: string,
  text: string,
): void {
  const el = workshopState.elements[elementId];
  if (!el || !el.pinboardItems) return;
  const pin = el.pinboardItems.find((p) => p.id === pinId);
  if (!pin) return;
  pin.comments.push({ authorId, text, at: Date.now() });
  autoSave(undefined, 'elements');
}

/** Count pins by a given agent on a board. */
export function getAgentPinCount(elementId: string, agentId: string): number {
  const el = workshopState.elements[elementId];
  if (!el || !el.pinboardItems) return 0;
  return el.pinboardItems.filter((p) => p.pinnedBy === agentId).length;
}

export function setMessageBoardContent(elementId: string, content: string) {
  const el = workshopState.elements[elementId];
  if (!el || el.type !== 'messageboard') return;
  el.messageBoardContent = content;
  autoSave(undefined, 'elements');
}

export function setRulebookContent(elementId: string, content: string) {
  const el = workshopState.elements[elementId];
  if (!el || el.type !== 'rulebook') return;
  el.rulebookContent = content;
  autoSave(undefined, 'elements');
}

export function addInboxItem(elementId: string, item: Omit<InboxItem, 'id'>) {
  const el = workshopState.elements[elementId];
  if (!el || el.type !== 'inbox') return;
  if (!el.inboxItems) el.inboxItems = [];
  el.inboxItems.push({
    ...item,
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  });
  // Cap at MAX_INBOX_ITEMS — remove oldest (lowest sentAt) on overflow
  if (el.inboxItems.length > MAX_INBOX_ITEMS) {
    el.inboxItems.sort((a, b) => a.sentAt - b.sentAt);
    el.inboxItems.splice(0, el.inboxItems.length - MAX_INBOX_ITEMS);
  }
  autoSave(undefined, 'elements');
}

export function addOutboxItem(elementId: string, item: Omit<InboxItem, 'id'>) {
  const el = workshopState.elements[elementId];
  if (!el || el.type !== 'inbox') return;
  if (!el.outboxItems) el.outboxItems = [];
  el.outboxItems.push({
    ...item,
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  });
  // Cap at MAX_INBOX_ITEMS — remove oldest on overflow
  if (el.outboxItems.length > MAX_INBOX_ITEMS) {
    el.outboxItems.sort((a, b) => a.sentAt - b.sentAt);
    el.outboxItems.splice(0, el.outboxItems.length - MAX_INBOX_ITEMS);
  }
  autoSave(undefined, 'elements');
}

export function markInboxItemRead(elementId: string, itemId: string) {
  const el = workshopState.elements[elementId];
  if (!el || !el.inboxItems) return;
  const item = el.inboxItems.find((m) => m.id === itemId);
  if (item) {
    item.read = true;
    autoSave(undefined, 'elements');
  }
}

export function updateInboxItemStatus(elementId: string, itemId: string, status: InboxItemStatus) {
  const el = workshopState.elements[elementId];
  if (!el) return;
  const item =
    (el.inboxItems ?? []).find((m) => m.id === itemId) ??
    (el.outboxItems ?? []).find((m) => m.id === itemId);
  if (item) {
    item.status = status;
    autoSave(undefined, 'elements');
  }
}

export function markAllInboxItemsRead(elementId: string) {
  const el = workshopState.elements[elementId];
  if (!el || !el.inboxItems) return;
  for (const item of el.inboxItems) {
    item.read = true;
  }
  autoSave(undefined, 'elements');
}

// ── Re-exports from sub-modules ───────────────────────────────────────────────
export * from './workshop.types';
export * from './workshop.memory.svelte';
