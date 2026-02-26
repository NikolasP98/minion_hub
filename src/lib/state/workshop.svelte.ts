import { hostsState } from '$lib/state/hosts.svelte';

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
  participantAgentIds: string[];
  sessionKey: string;
  status: 'active' | 'interrupted' | 'completed' | 'queued';
  startedAt: number;
  endedAt?: number;
  title?: string;
  taskPrompt?: string;
  maxTurns?: number;
}

// --- Workshop interactive elements ---

export type ElementType = 'pinboard' | 'messageboard' | 'inbox' | 'rulebook';

export interface PinboardItem {
  id: string;
  content: string;
  pinnedBy: string; // agentId or 'user'
  pinnedAt: number;
  upvotes: string[];   // voter IDs (agentId or 'user')
  downvotes: string[]; // voter IDs
  comments: Array<{ authorId: string; text: string; at: number }>;
}

export interface InboxItem {
  id: string;
  fromId: string;    // agentId or 'user'
  toId: string;      // agentId or 'user'
  content: string;
  sentAt: number;
  read: boolean;
}

export interface AgentMemory {
  contextSummary: string;
  workspaceNotes: string[];           // from [REMEMBER:] markers, max 10
  recentInteractions: string[];       // "talked to AgentX about Y", max 5
  environmentState: Record<string, { // elementId → last-read info
    summary: string;
    lastReadAt: number;
  }>;
  activePinboardItems: string[];      // pin IDs agent has chosen to keep in active context (max 5)
}

export interface WorkshopElement {
  instanceId: string;
  type: ElementType;
  position: { x: number; y: number };
  label: string;
  pinboardItems?: PinboardItem[];
  messageBoardContent?: string;
  inboxAgentId?: string;
  inboxItems?: InboxItem[];
  outboxItems?: InboxItem[];
  rulebookContent?: string;
}

export interface WorkshopSettings {
  maxConcurrentConversations: number;
  /** Master killswitch — disables all agent-to-agent conversations when false */
  agentChatsEnabled: boolean;
  idleBanterEnabled: boolean;
  idleBanterBudgetPerHour: number;
  proximityRadius: number;
  /** ms between idle-banter attempt checks */
  banterCheckInterval: number;
  /** ms cooldown between same-pair banters */
  banterCooldown: number;
  /** Max turns for banter conversations */
  banterMaxTurns: number;
  /** Max turns for task conversations */
  taskMaxTurns: number;
  /** ms to wait for agent response */
  responseTimeout: number;
  /** Default prompt for banter conversations */
  banterPrompt: string;
  /** Default prompt for solo tasks */
  taskPrompt: string;
}

export interface WorkshopState {
  camera: { x: number; y: number; zoom: number };
  agents: Record<string, AgentInstance>;
  relationships: Record<string, Relationship>;
  conversations: Record<string, WorkshopConversation>;
  elements: Record<string, WorkshopElement>;
  settings: WorkshopSettings;
}

type WorkshopSlice = 'camera' | 'agents' | 'relationships' | 'conversations' | 'elements' | 'settings';
const ALL_SLICES: WorkshopSlice[] = ['camera', 'agents', 'relationships', 'conversations', 'elements', 'settings'];

function autosaveKey(hostId: string, slice: WorkshopSlice): string {
  return `workshop:autosave:${hostId}:${slice}`;
}

/** Legacy single-key used before incremental save — kept for migration read. */
function legacyAutosaveKey(hostId: string): string {
  return `workshop:autosave:${hostId}`;
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
    banterPrompt: "Have a spontaneous, in-character conversation. Discuss what you're currently working on, share observations about the workspace, or just chat. Keep it natural and brief.",
    taskPrompt: "Reflect on your current state and describe what you'd work on next.",
  },
});

// --- Auto-save / auto-load (localStorage, incremental per-slice) ---

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
const dirtySlices = new Set<WorkshopSlice>();

/**
 * Schedule an incremental autosave. Pass the slices that changed; if none are
 * passed, all slices are marked dirty (full save — used by external callers).
 */
export function autoSave(hostId: string | null = hostsState.activeHostId, ...slices: WorkshopSlice[]) {
  if (!hostId) return;
  const toMark = slices.length > 0 ? slices : ALL_SLICES;
  for (const s of toMark) dirtySlices.add(s);
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  const hid = hostId;
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null;
    const snapshot = $state.snapshot(workshopState);
    for (const slice of dirtySlices) {
      try {
        localStorage.setItem(autosaveKey(hid, slice), JSON.stringify(snapshot[slice]));
      } catch {
        // non-critical (quota errors, etc.)
      }
    }
    dirtySlices.clear();
    scheduleDbSave();
  }, 300);
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

export function autoLoad(hostId: string | null = hostsState.activeHostId) {
  if (!hostId) return;
  try {
    // Try incremental per-slice keys first
    const hasSliceKeys = ALL_SLICES.some((s) => localStorage.getItem(autosaveKey(hostId, s)) !== null);

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

// --- Server-side workspace saves ---

export const saveSync = $state<{ activeSaveId: string | null; isSyncing: boolean }>({
  activeSaveId: null,
  isSyncing: false,
});

let thumbnailProvider: (() => Promise<string | null>) | null = null;

export function registerThumbnailProvider(fn: () => Promise<string | null>) {
  thumbnailProvider = fn;
}

export function unregisterThumbnailProvider() {
  thumbnailProvider = null;
}

let dbSaveTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleDbSave() {
  if (!saveSync.activeSaveId) return;
  if (dbSaveTimer) clearTimeout(dbSaveTimer);
  const id = saveSync.activeSaveId;
  dbSaveTimer = setTimeout(async () => {
    dbSaveTimer = null;
    if (!saveSync.activeSaveId || saveSync.activeSaveId !== id) return;
    saveSync.isSyncing = true;
    try {
      const snapshot = $state.snapshot(workshopState);
      const thumbnail = thumbnailProvider ? await thumbnailProvider() : null;
      await fetch(`/api/workshop/saves/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: JSON.stringify(snapshot),
          ...(thumbnail ? { thumbnail } : {}),
        }),
      });
    } catch {
      // non-critical
    } finally {
      saveSync.isSyncing = false;
    }
  }, 2000);
}

export function cancelDbSave() {
  if (dbSaveTimer) {
    clearTimeout(dbSaveTimer);
    dbSaveTimer = null;
  }
}

export async function openSave(id: string) {
  const res = await fetch(`/api/workshop/saves/${id}`);
  if (!res.ok) throw new Error('Failed to load workspace');
  const { save } = await res.json();
  const saved: WorkshopState = typeof save.state === 'string'
    ? JSON.parse(save.state)
    : save.state;
  workshopState.camera = saved.camera;
  workshopState.agents = saved.agents;
  workshopState.relationships = saved.relationships;
  workshopState.settings = { ...workshopState.settings, ...saved.settings };
  workshopState.conversations = saved.conversations ?? {};
  workshopState.elements = saved.elements ?? {};
  migratePinboardVoting();
  restoreConversations({ conversations: saved.conversations });
  saveSync.activeSaveId = id;
  autoSave(undefined, ...ALL_SLICES);
}

export async function createBlankSave(name: string): Promise<string> {
  resetWorkshop();
  const snapshot = $state.snapshot(workshopState);
  const res = await fetch('/api/workshop/saves', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, state: JSON.stringify(snapshot) }),
  });
  if (!res.ok) throw new Error('Failed to create workspace');
  const { id } = await res.json();
  saveSync.activeSaveId = id;
  autoSave(undefined, ...ALL_SLICES);
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

export async function listWorkspaceSaves(): Promise<Array<{
  id: string;
  name: string;
  updatedAt: number;
  createdAt: number;
  thumbnail: string | null;
  agentCount: number;
  elementCount: number;
}>> {
  const res = await fetch('/api/workshop/saves');
  if (!res.ok) throw new Error('Failed to list workspace saves');
  const { saves } = await res.json();
  return saves;
}

export async function deleteWorkspaceSave(id: string) {
  const res = await fetch(`/api/workshop/saves/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete workspace save');
}

// --- Reset ---

export function resetWorkshop() {
  workshopState.camera = { x: 0, y: 0, zoom: 1 };
  workshopState.agents = {};
  workshopState.relationships = {};
  workshopState.conversations = {};
  workshopState.elements = {};
  workshopState.settings = {
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
    banterPrompt: "Have a spontaneous, in-character conversation. Discuss what you're currently working on, share observations about the workspace, or just chat. Keep it natural and brief.",
    taskPrompt: "Reflect on your current state and describe what you'd work on next.",
  };
}

// --- Workshop elements ---

let elementCounter = 0;

function generateElementId(): string {
  return `elem_${Date.now()}_${elementCounter++}`;
}

export function addElement(type: ElementType, x: number, y: number, label: string, inboxAgentId?: string): string {
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

/** Add a pin ID to an agent's active pinboard context (max 5; drops oldest if at limit). */
export function addActivePinboardItem(instanceId: string, pinId: string): void {
  const mem = getOrCreateMemory(instanceId);
  if (mem.activePinboardItems.includes(pinId)) return;
  if (mem.activePinboardItems.length >= 5) {
    mem.activePinboardItems = mem.activePinboardItems.slice(1); // drop oldest
  }
  mem.activePinboardItems.push(pinId);
  saveMemory();
}

/** Remove a pin ID from an agent's active pinboard context. */
export function removeActivePinboardItem(instanceId: string, pinId: string): void {
  const mem = getOrCreateMemory(instanceId);
  mem.activePinboardItems = mem.activePinboardItems.filter((id) => id !== pinId);
  saveMemory();
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

export function markAllInboxItemsRead(elementId: string) {
  const el = workshopState.elements[elementId];
  if (!el || !el.inboxItems) return;
  for (const item of el.inboxItems) {
    item.read = true;
  }
  autoSave(undefined, 'elements');
}

// --- Agent memory ---

export const agentMemory: Record<string, AgentMemory> = $state({});

function emptyMemory(): AgentMemory {
  return {
    contextSummary: '',
    workspaceNotes: [],
    recentInteractions: [],
    environmentState: {},
    activePinboardItems: [],
  };
}

export function getOrCreateMemory(instanceId: string): AgentMemory {
  if (!agentMemory[instanceId]) agentMemory[instanceId] = emptyMemory();
  return agentMemory[instanceId];
}

export function addWorkspaceNote(instanceId: string, note: string): void {
  const mem = getOrCreateMemory(instanceId);
  mem.workspaceNotes = [...mem.workspaceNotes.slice(-9), note]; // keep last 10
  saveMemory();
}

export function addRecentInteraction(instanceId: string, summary: string): void {
  const mem = getOrCreateMemory(instanceId);
  mem.recentInteractions = [...mem.recentInteractions.slice(-4), summary]; // keep last 5
  saveMemory();
}

export function updateContextSummary(instanceId: string, summary: string): void {
  const mem = getOrCreateMemory(instanceId);
  mem.contextSummary = summary;
  saveMemory();
}

export function recordElementRead(instanceId: string, elementId: string, summary: string): void {
  const mem = getOrCreateMemory(instanceId);
  mem.environmentState[elementId] = { summary, lastReadAt: Date.now() };
  saveMemory();
}

export function clearAllMemory(): void {
  for (const key of Object.keys(agentMemory)) delete agentMemory[key];
  saveMemory();
}

function memoryKey(): string {
  return `workshop:memory:${hostsState.activeHostId ?? 'default'}`;
}

function saveMemory(): void {
  try {
    localStorage.setItem(memoryKey(), JSON.stringify($state.snapshot(agentMemory)));
  } catch { /* non-critical */ }
}

export function loadMemory(): void {
  try {
    const raw = localStorage.getItem(memoryKey());
    if (!raw) return;
    const saved = JSON.parse(raw) as Record<string, AgentMemory>;
    for (const [id, mem] of Object.entries(saved)) {
      // Migrate memory records that pre-date activePinboardItems
      if (!mem.activePinboardItems) mem.activePinboardItems = [];
      agentMemory[id] = mem;
    }
  } catch { /* non-critical */ }
}
