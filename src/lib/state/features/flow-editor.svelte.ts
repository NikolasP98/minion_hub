// Flow Editor State — Svelte 5 runes
import { readSseStream } from './flow-run';
import { env } from '$env/dynamic/public';

export type HandleDef = { id: string; label: string };

export type ContextRule = {
  condition: string;
  contextNodeId: string;
};

export type AgentNodeData = {
  agentKind?: 'custom' | 'personal' | 'drone';
  agentId: string;
  label: string;
  sessionMode: 'ephemeral' | 'shared';
  defaultValues: Record<string, string>;
  contextRules: ContextRule[];
  inputHandles: HandleDef[];
  outputHandles: HandleDef[];
  contextHandles: HandleDef[];
};

export type PromptBoxData = {
  label: string;
  value: string;
};

export type LLMNodeData = {
  modelId: string;
  label: string;
};

export type TransformNodeData = {
  template: string;
  label: string;
};

export type StructuredNodeData = {
  modelId: string;
  schema: string;
  label: string;
};

export type TriggerNodeData = {
  event:
    | 'message:received'
    | 'message:sent'
    | 'agent:bootstrap'
    | 'memory:node_created'
    | 'memory:node_updated'
    | 'memory:node_deleted';
  label: string;
  deliverResponse: boolean;
  filterChannelId?: string;
  filterAgentId?: string;
};

export type PluginTriggerNodeData = {
  pluginId: string;
  contributionId: string;
  event: string;
  label: string;
  deliverResponse: boolean;
};

export type PluginActionNodeData = {
  pluginId: string;
  contributionId: string;
  method: string;
  label: string;
};

export type FlowNode = {
  id: string;
  type: 'agent' | 'promptBox' | 'llm' | 'trigger' | 'pluginTrigger' | 'pluginAction' | 'transform' | 'structured';
  position: { x: number; y: number };
  data:
    | AgentNodeData
    | PromptBoxData
    | LLMNodeData
    | TriggerNodeData
    | PluginTriggerNodeData
    | PluginActionNodeData
    | TransformNodeData
    | StructuredNodeData;
};

export type FlowEdge = {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  type: 'flow' | 'context';
  label?: string;
};

export type LogEntry = {
  id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  nodeId?: string;
};

// ─── State ────────────────────────────────────────────────────────────────────

export const flowEditorState = $state({
  flowId: null as string | null,
  flowName: '',
  nodes: [] as FlowNode[],
  edges: [] as FlowEdge[],
  selectedNodeIds: [] as string[],
  isDirty: false,
  isSaving: false,
  isRunning: false,
  flowActive: false,
  relationshipMode: false,
  consoleOpen: false,
  consoleLogs: [] as LogEntry[],
  canvasViewport: { x: 0, y: 0, zoom: 1 },
  contextMenu: { open: false, x: 0, y: 0, nodeId: null as string | null },
});

// ─── Auto-save ────────────────────────────────────────────────────────────────

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutoSave() {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    saveFlow();
  }, 2000);
}

// ─── Draft persistence ────────────────────────────────────────────────────────

function getDraftKey(id: string) {
  return `flow-editor:draft:${id}`;
}

function saveDraft() {
  if (!flowEditorState.flowId) return;
  try {
    localStorage.setItem(
      getDraftKey(flowEditorState.flowId),
      JSON.stringify({ nodes: flowEditorState.nodes, edges: flowEditorState.edges }),
    );
  } catch {
    // ignore storage errors
  }
}

function loadDraft(id: string): { nodes: FlowNode[]; edges: FlowEdge[] } | null {
  try {
    const raw = localStorage.getItem(getDraftKey(id));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearDraft(id: string) {
  try {
    localStorage.removeItem(getDraftKey(id));
  } catch {
    // ignore
  }
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function loadFlow(id: string) {
  flowEditorState.flowId = id;
  flowEditorState.isDirty = false;

  // Check for unsaved draft first
  const draft = loadDraft(id);

  const res = await fetch(`/api/flows/${id}`);
  if (!res.ok) throw new Error('Failed to load flow');

  const { flow } = await res.json();
  flowEditorState.flowName = flow.name;

  // Use draft if it's newer than server state
  if (draft) {
    flowEditorState.nodes = draft.nodes;
    flowEditorState.edges = draft.edges;
    flowEditorState.isDirty = true;
  } else {
    flowEditorState.nodes = flow.nodes;
    flowEditorState.edges = flow.edges;
  }

  flowEditorState.flowActive = flow.active ?? false;
}

export async function saveFlow() {
  if (!flowEditorState.flowId) return;

  flowEditorState.isSaving = true;
  try {
    const res = await fetch(`/api/flows/${flowEditorState.flowId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: flowEditorState.flowName,
        nodes: flowEditorState.nodes,
        edges: flowEditorState.edges,
      }),
    });

    if (res.ok) {
      flowEditorState.isDirty = false;
      clearDraft(flowEditorState.flowId);
    }
  } finally {
    flowEditorState.isSaving = false;
  }
}

export function markDirty() {
  flowEditorState.isDirty = true;
  saveDraft();
  scheduleAutoSave();
}

export function setNodes(nodes: FlowNode[]) {
  flowEditorState.nodes = nodes;
  markDirty();
}

export function setEdges(edges: FlowEdge[]) {
  flowEditorState.edges = edges;
  markDirty();
}

export function setRelationshipMode(active: boolean) {
  flowEditorState.relationshipMode = active;
}

export function appendLog(entry: Omit<LogEntry, 'id' | 'timestamp'>) {
  flowEditorState.consoleLogs.push({
    ...entry,
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    timestamp: Date.now(),
  });
}

export function clearLogs() {
  flowEditorState.consoleLogs = [];
}

export function deleteNode(nodeId: string) {
  flowEditorState.nodes = flowEditorState.nodes.filter((n) => n.id !== nodeId);
  flowEditorState.edges = flowEditorState.edges.filter(
    (e) => e.source !== nodeId && e.target !== nodeId,
  );
  markDirty();
}

export function duplicateNode(nodeId: string) {
  const node = flowEditorState.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const newNode: FlowNode = {
    ...node,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    position: { x: node.position.x + 40, y: node.position.y + 40 },
  };
  flowEditorState.nodes = [...flowEditorState.nodes, newNode];
  markDirty();
}

const FLOWS_URL = env.PUBLIC_LANGGRAPH_FLOWS_URL ?? 'http://localhost:2025';

export async function runFlow() {
  if (flowEditorState.isRunning) return;
  flowEditorState.isRunning = true;
  flowEditorState.consoleOpen = true;
  clearLogs();

  try {
    const res = await fetch(`${FLOWS_URL}/flows/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodes: flowEditorState.nodes,
        edges: flowEditorState.edges,
      }),
    });

    if (!res.ok || !res.body) {
      appendLog({ level: 'error', message: `Flow runner returned ${res.status}.` });
      return;
    }

    for await (const event of readSseStream(res.body)) {
      appendLog({ level: event.level, message: event.message, nodeId: event.nodeId });
    }
  } catch {
    appendLog({ level: 'error', message: `Could not reach flow runner at ${FLOWS_URL}.` });
  } finally {
    flowEditorState.isRunning = false;
  }
}
