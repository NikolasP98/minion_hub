// Flow Editor State — Svelte 5 runes
import { readSseStream } from './flow-run';
import { env } from '$env/dynamic/public';
import { sendRequest } from '$lib/services/gateway.svelte';
import { conn } from '$lib/state/gateway';

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

export type FlowRunEventKind =
  | 'run-start'
  | 'node-start'
  | 'node-end'
  | 'node-error'
  | 'run-end'
  | 'log';

export type LogEntry = {
  id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  nodeId?: string;
  /** Lifecycle classification (from the runner). */
  kind?: FlowRunEventKind;
  nodeType?: string;
  nodeLabel?: string;
  input?: string;
  output?: string;
};

/** Live per-node execution status for the current/last Test Run. */
export type NodeRunStatus = 'running' | 'done' | 'error';
export type NodeRunState = {
  status: NodeRunStatus;
  input?: string;
  output?: string;
  error?: string;
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
  /** Owning plugin id when this flow was imported from a plugin; null otherwise. */
  flowPluginId: null as string | null,
  relationshipMode: false,
  consoleOpen: false,
  consoleLogs: [] as LogEntry[],
  /** Per-node live status for the active/last Test Run (keyed by node id). */
  nodeRuns: {} as Record<string, NodeRunState>,
  /** True while the history drawer is open. */
  historyOpen: false,
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
  flowEditorState.flowPluginId = flow.pluginId ?? null;
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

/** Reset per-node run status (start of a fresh Test Run). */
export function resetNodeRuns() {
  flowEditorState.nodeRuns = {};
}

/** A single execution event from the runner (mirror of the runner's FlowRunEvent). */
export type RunnerEvent = {
  level: LogEntry['level'];
  message: string;
  nodeId?: string;
  kind?: FlowRunEventKind;
  nodeType?: string;
  nodeLabel?: string;
  input?: string;
  output?: string;
  ts?: number;
};

/** Apply one runner event: append a console line and update per-node status. */
export function applyRunEvent(ev: RunnerEvent) {
  appendLog({
    level: ev.level,
    message: ev.message,
    nodeId: ev.nodeId,
    kind: ev.kind,
    nodeType: ev.nodeType,
    nodeLabel: ev.nodeLabel,
    input: ev.input,
    output: ev.output,
  });
  if (!ev.nodeId) return;
  if (ev.kind === 'node-start') {
    flowEditorState.nodeRuns[ev.nodeId] = { status: 'running', input: ev.input };
  } else if (ev.kind === 'node-end') {
    flowEditorState.nodeRuns[ev.nodeId] = { status: 'done', input: ev.input, output: ev.output };
  } else if (ev.kind === 'node-error') {
    flowEditorState.nodeRuns[ev.nodeId] = { status: 'error', input: ev.input, error: ev.message };
  }
}

/** Replay a stored historic run into the console + node-status view. */
export function loadHistoryRun(events: RunnerEvent[]) {
  flowEditorState.consoleOpen = true;
  clearLogs();
  resetNodeRuns();
  for (const ev of events) applyRunEvent(ev);
}

export function toggleHistory() {
  flowEditorState.historyOpen = !flowEditorState.historyOpen;
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

/**
 * A flow whose entry is a trigger/pluginTrigger has no prompt of its own — the
 * runner refuses to compile it without an `initialPrompt` (the event payload it
 * would normally receive from the live trigger). For a manual Test Run we seed a
 * sample payload so the downstream nodes actually execute. Flows that start with
 * a Prompt Box carry their own input, so they get no seed.
 */
const TEST_RUN_SAMPLE_PROMPT =
  '(Test Run) Sample trigger message — edit the Prompt Box or wire a real trigger for production input.';

function testRunPrompt(): string | undefined {
  const hasTriggerEntry = flowEditorState.nodes.some(
    (n) => n.type === 'trigger' || n.type === 'pluginTrigger',
  );
  return hasTriggerEntry ? TEST_RUN_SAMPLE_PROMPT : undefined;
}

function runStatusOf(events: RunnerEvent[]): 'completed' | 'error' {
  return events.some((e) => e.kind === 'node-error' || (e.kind === 'run-end' && e.level === 'error'))
    ? 'error'
    : 'completed';
}

/** Best-effort: persist a finished Test Run to the history table. */
async function persistRun(startedAt: number, events: RunnerEvent[]) {
  const flowId = flowEditorState.flowId;
  if (!flowId || events.length === 0) return;
  try {
    await fetch(`/api/flows/${flowId}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startedAt,
        durationMs: Date.now() - startedAt,
        status: runStatusOf(events),
        events,
      }),
    });
  } catch {
    // History is non-critical — never let a persistence failure surface to the run.
  }
}

/**
 * Test Run. Preferred path routes through the gateway WS (`flows.run`): the hub
 * already holds an authenticated socket, the flows runner stays localhost-only,
 * and there's no mixed-content/CORS problem over HTTPS in prod. The gateway
 * streams each node-lifecycle event back as a `flows.run.event` (live node
 * status + I/O), and returns the full set in its response (used to persist the
 * run). When no gateway WS is connected (pure local dev pointing straight at a
 * runner), fall back to the direct SSE fetch (no live frames).
 */
export async function runFlow() {
  if (flowEditorState.isRunning) return;
  flowEditorState.isRunning = true;
  flowEditorState.consoleOpen = true;
  flowEditorState.historyOpen = false;
  clearLogs();
  resetNodeRuns();

  const prompt = testRunPrompt();
  const startedAt = Date.now();
  const collected: RunnerEvent[] = [];
  let liveCount = 0;

  // Live per-node events streamed from the gateway during the WS run.
  const onLive = (e: Event) => {
    const ev = (e as CustomEvent).detail?.event as RunnerEvent | undefined;
    if (!ev) return;
    liveCount++;
    collected.push(ev);
    applyRunEvent(ev);
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('flows.run.event', onLive);
  }

  try {
    if (prompt) {
      appendLog({ level: 'debug', message: `Seeding trigger entry with sample input: "${prompt}"` });
    }

    if (conn.connected) {
      const res = (await sendRequest(
        'flows.run',
        { nodes: flowEditorState.nodes, edges: flowEditorState.edges, ...(prompt ? { prompt } : {}) },
        190_000,
      )) as { runId?: string; events?: RunnerEvent[] } | null;
      const events = res?.events ?? [];
      // If the live stream delivered nothing (older gateway / missed frames),
      // replay the batched events so the console is never empty.
      if (liveCount === 0) {
        if (events.length === 0) {
          appendLog({ level: 'warn', message: 'Flow run returned no output.' });
        }
        for (const ev of events) applyRunEvent(ev);
      }
      void persistRun(startedAt, events.length ? events : collected);
      return;
    }

    // Local-dev fallback: no gateway WS, hit the runner directly.
    const res = await fetch(`${FLOWS_URL}/flows/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodes: flowEditorState.nodes,
        edges: flowEditorState.edges,
        ...(prompt ? { prompt } : {}),
      }),
    });

    if (!res.ok || !res.body) {
      appendLog({ level: 'error', message: `Flow runner returned ${res.status}.` });
      return;
    }

    for await (const event of readSseStream(res.body)) {
      const ev = event as RunnerEvent;
      collected.push(ev);
      applyRunEvent(ev);
    }
    void persistRun(startedAt, collected);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    appendLog({ level: 'error', message: `Flow run failed: ${detail}` });
  } finally {
    if (typeof window !== 'undefined') {
      window.removeEventListener('flows.run.event', onLive);
    }
    flowEditorState.isRunning = false;
  }
}
