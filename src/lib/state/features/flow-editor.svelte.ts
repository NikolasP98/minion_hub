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

export type RouterRuleOp = 'contains' | 'equals' | 'regex';

export type RouterBranch = {
  id: string;
  label: string;
  rule?: { op: RouterRuleOp; value: string };
};

export type RouterNodeData = {
  mode: 'rule' | 'llm';
  modelId?: string;
  branches: RouterBranch[];
  label: string;
};

export type ToolRef =
  | { kind: 'builtin'; id: string }
  | { kind: 'gateway'; method: string; name: string; description: string };

export type ToolAgentNodeData = {
  modelId: string;
  systemPrompt?: string;
  tools: ToolRef[];
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

/** A typed config field a plugin declares for one of its flow nodes (mirrors the
 *  gateway's FlowNodeConfigField). Rendered as a form by NodeConfigPanel. */
export type FlowNodeConfigField = {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'textarea';
  options?: { value: string; label: string }[];
  default?: string | number | boolean;
  placeholder?: string;
  description?: string;
};

/** Plugin flow-node descriptor as returned by `flows.nodes.list`. */
export type FlowNodeDescriptor = {
  pluginId: string;
  id: string;
  kind: 'trigger' | 'action';
  label: string;
  description?: string;
  icon?: string;
  event?: string;
  method?: string;
  channelId?: string;
  config?: FlowNodeConfigField[];
};

export type PluginTriggerNodeData = {
  pluginId: string;
  contributionId: string;
  event: string;
  label: string;
  deliverResponse: boolean;
  /** Channel-scoped triggers (e.g. WhatsApp/Telegram) carry the channel id so
   *  trigger registration only fires for that channel's inbound traffic. */
  filterChannelId?: string;
  /** Values for the contribution's declared config fields. */
  config?: Record<string, unknown>;
};

export type PluginActionNodeData = {
  pluginId: string;
  contributionId: string;
  method: string;
  label: string;
  /** Values for the contribution's declared config fields; forwarded to the
   *  gateway method by the langgraph runner. */
  config?: Record<string, unknown>;
};

export type FlowNode = {
  id: string;
  type: 'agent' | 'promptBox' | 'llm' | 'trigger' | 'pluginTrigger' | 'pluginAction' | 'transform' | 'structured' | 'router' | 'toolAgent';
  position: { x: number; y: number };
  data:
    | AgentNodeData
    | PromptBoxData
    | LLMNodeData
    | TriggerNodeData
    | PluginTriggerNodeData
    | PluginActionNodeData
    | TransformNodeData
    | StructuredNodeData
    | RouterNodeData
    | ToolAgentNodeData;
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
  /** Plugin node descriptors (from flows.nodes.list) — carry the config field
   *  defs the config panel renders. */
  pluginNodeDescriptors: [] as FlowNodeDescriptor[],
  /** Node currently open in the config panel (null = closed). */
  configNodeId: null as string | null,
});

// ─── Plugin node config ─────────────────────────────────────────────────────

export function setPluginNodeDescriptors(descriptors: FlowNodeDescriptor[]) {
  flowEditorState.pluginNodeDescriptors = descriptors;
}

/** Resolve the descriptor (with config field defs) for a plugin node. */
export function descriptorForNode(node: FlowNode | undefined): FlowNodeDescriptor | null {
  if (!node || (node.type !== 'pluginAction' && node.type !== 'pluginTrigger')) return null;
  const d = node.data as { pluginId?: string; contributionId?: string };
  return (
    flowEditorState.pluginNodeDescriptors.find(
      (x) => x.pluginId === d.pluginId && x.id === d.contributionId,
    ) ?? null
  );
}

/** Build the default config value map from a contribution's declared fields. */
export function defaultConfigForFields(
  fields: FlowNodeConfigField[] | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields ?? []) {
    if (f.default !== undefined) out[f.key] = f.default;
    else if (f.type === 'boolean') out[f.key] = false;
  }
  return out;
}

/** True when a node exposes a configurable surface (declared config fields). */
export function nodeHasConfig(node: FlowNode | undefined): boolean {
  return (descriptorForNode(node)?.config?.length ?? 0) > 0;
}

export function openNodeConfig(nodeId: string) {
  flowEditorState.configNodeId = nodeId;
}

export function closeNodeConfig() {
  flowEditorState.configNodeId = null;
}

/** Set one config value on a node and persist. */
export function updateNodeConfig(nodeId: string, key: string, value: unknown) {
  flowEditorState.nodes = flowEditorState.nodes.map((n) => {
    if (n.id !== nodeId) return n;
    const data = n.data as Record<string, unknown> & { config?: Record<string, unknown> };
    return {
      ...n,
      data: { ...data, config: { ...(data.config ?? {}), [key]: value } },
    } as FlowNode;
  });
  markDirty();
}

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

/** Open the node context menu at the cursor, suppressing the browser default.
 *  Shared by every node component so right-click is consistent across the editor. */
export function openNodeContextMenu(e: MouseEvent, nodeId: string) {
  e.preventDefault();
  e.stopPropagation();
  flowEditorState.contextMenu = { open: true, x: e.clientX, y: e.clientY, nodeId };
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
