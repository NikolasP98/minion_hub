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
  status: 'active' | 'completed' | 'queued';
  startedAt: number;
  endedAt?: number;
  title?: string;
}

// --- Workshop interactive elements ---

export type ElementType = 'pinboard' | 'messageboard' | 'inbox';

export interface PinboardItem {
  id: string;
  content: string;
  pinnedBy: string; // agentId or 'user'
  pinnedAt: number;
}

export interface InboxItem {
  id: string;
  fromId: string;    // agentId or 'user'
  toId: string;      // agentId or 'user'
  content: string;
  sentAt: number;
  read: boolean;
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
}

export interface WorkshopSettings {
  maxConcurrentConversations: number;
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

function autosaveKey(hostId: string): string {
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

// --- Auto-save / auto-load (localStorage) ---

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

export function autoSave(hostId: string | null = hostsState.activeHostId) {
  if (!hostId) return;
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    try {
      const snapshot = $state.snapshot(workshopState);
      localStorage.setItem(autosaveKey(hostId), JSON.stringify(snapshot));
    } catch {
      // non-critical
    }
  }, 300);
}

export function autoLoad(hostId: string | null = hostsState.activeHostId) {
  if (!hostId) return;
  try {
    const raw = localStorage.getItem(autosaveKey(hostId));
    if (!raw) return;
    const saved = JSON.parse(raw) as Partial<WorkshopState>;
    workshopState.camera = saved.camera ?? workshopState.camera;
    workshopState.agents = saved.agents ?? workshopState.agents;
    workshopState.relationships = saved.relationships ?? workshopState.relationships;
    workshopState.settings = { ...workshopState.settings, ...saved.settings };
    workshopState.elements = saved.elements ?? {};
    // Restore conversations — mark any previously-active as completed (stale from prior session)
    // Also purge any conversations missing required fields (from pre-migration format)
    if (saved.conversations) {
      const cleaned: Record<string, WorkshopConversation> = {};
      // Track best (most recent) conversation per unique agent pair
      const bestByPair = new Map<string, { id: string; startedAt: number }>();

      for (const [id, conv] of Object.entries(saved.conversations)) {
        // Skip conversations without the new required fields
        if (!conv.participantAgentIds || !conv.startedAt) continue;
        if (conv.status === 'active') {
          conv.status = 'completed';
          conv.endedAt = conv.endedAt ?? Date.now();
        }

        // Deduplicate by agent pair — keep only the most recent conversation per pair
        const pairKey = [...conv.participantAgentIds].sort().join(':');
        const existing = bestByPair.get(pairKey);
        if (!existing || conv.startedAt > existing.startedAt) {
          // Remove the older duplicate if one existed
          if (existing) delete cleaned[existing.id];
          bestByPair.set(pairKey, { id, startedAt: conv.startedAt });
          cleaned[id] = conv;
        }
        // else: skip this older duplicate
      }
      workshopState.conversations = cleaned;
    }
  } catch {
    // non-critical
  }
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
  autoSave();
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
  autoSave();
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
    autoSave();
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
  autoSave();
  return id;
}

export function removeRelationship(id: string) {
  delete workshopState.relationships[id];
  autoSave();
}

export function updateRelationshipLabel(id: string, label: string) {
  const rel = workshopState.relationships[id];
  if (rel) {
    rel.label = label;
    autoSave();
  }
}

// --- Server-side workspace saves ---

export async function saveWorkspace(name: string) {
  const snapshot = $state.snapshot(workshopState);
  const res = await fetch('/api/workshop/saves', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, state: JSON.stringify(snapshot) }),
  });
  if (!res.ok) throw new Error('Failed to save workspace');
  return await res.json();
}

export async function loadWorkspace(id: string) {
  const res = await fetch(`/api/workshop/saves/${id}`);
  if (!res.ok) throw new Error('Failed to load workspace');
  const { state: saved } = await res.json();
  workshopState.camera = saved.camera;
  workshopState.agents = saved.agents;
  workshopState.relationships = saved.relationships;
  workshopState.settings = { ...workshopState.settings, ...saved.settings };
  workshopState.conversations = saved.conversations ?? {};
  workshopState.elements = saved.elements ?? {};
  autoSave();
}

export async function listWorkspaceSaves() {
  const res = await fetch('/api/workshop/saves');
  if (!res.ok) throw new Error('Failed to list workspace saves');
  return await res.json();
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

  workshopState.elements[instanceId] = element;
  autoSave();
  return instanceId;
}

export function removeElement(instanceId: string) {
  delete workshopState.elements[instanceId];
  autoSave();
}

export function updateElementPosition(instanceId: string, x: number, y: number) {
  const el = workshopState.elements[instanceId];
  if (el) {
    el.position = { x, y };
  }
}

export function addPinboardItem(elementId: string, content: string, pinnedBy: string) {
  const el = workshopState.elements[elementId];
  if (!el || el.type !== 'pinboard') return;
  if (!el.pinboardItems) el.pinboardItems = [];
  el.pinboardItems.push({
    id: `pin_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    content,
    pinnedBy,
    pinnedAt: Date.now(),
  });
  autoSave();
}

export function removePinboardItem(elementId: string, itemId: string) {
  const el = workshopState.elements[elementId];
  if (!el || !el.pinboardItems) return;
  el.pinboardItems = el.pinboardItems.filter((p) => p.id !== itemId);
  autoSave();
}

export function setMessageBoardContent(elementId: string, content: string) {
  const el = workshopState.elements[elementId];
  if (!el || el.type !== 'messageboard') return;
  el.messageBoardContent = content;
  autoSave();
}

export function addInboxItem(elementId: string, item: Omit<InboxItem, 'id'>) {
  const el = workshopState.elements[elementId];
  if (!el || el.type !== 'inbox') return;
  if (!el.inboxItems) el.inboxItems = [];
  el.inboxItems.push({
    ...item,
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  });
  autoSave();
}

export function addOutboxItem(elementId: string, item: Omit<InboxItem, 'id'>) {
  const el = workshopState.elements[elementId];
  if (!el || el.type !== 'inbox') return;
  if (!el.outboxItems) el.outboxItems = [];
  el.outboxItems.push({
    ...item,
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  });
  autoSave();
}

export function markInboxItemRead(elementId: string, itemId: string) {
  const el = workshopState.elements[elementId];
  if (!el || !el.inboxItems) return;
  const item = el.inboxItems.find((m) => m.id === itemId);
  if (item) {
    item.read = true;
    autoSave();
  }
}
