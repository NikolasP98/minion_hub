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
  settings: WorkshopSettings;
}

const AUTOSAVE_KEY = 'workshop:autosave';

export const workshopState: WorkshopState = $state({
  camera: { x: 0, y: 0, zoom: 1 },
  agents: {} as Record<string, AgentInstance>,
  relationships: {} as Record<string, Relationship>,
  conversations: {} as Record<string, WorkshopConversation>,
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

export function autoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    try {
      const snapshot = $state.snapshot(workshopState);
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(snapshot));
    } catch {
      // non-critical
    }
  }, 300);
}

export function autoLoad() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Partial<WorkshopState>;
    workshopState.camera = saved.camera ?? workshopState.camera;
    workshopState.agents = saved.agents ?? workshopState.agents;
    workshopState.relationships = saved.relationships ?? workshopState.relationships;
    workshopState.settings = { ...workshopState.settings, ...saved.settings };
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
    body: JSON.stringify({ name, state: snapshot }),
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
  autoSave();
}
