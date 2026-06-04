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
  /** LLM mode: rubric/conditions describing when this branch is chosen. */
  description?: string;
  rule?: { op: RouterRuleOp; value: string };
};

export type RouterNodeData = {
  /** 'rule' = text matching; 'llm' = rubric classification; 'hybrid' = rule
   *  fast-path then LLM rubric fallback (Classify/Route). */
  mode: 'rule' | 'llm' | 'hybrid';
  modelId?: string;
  branches: RouterBranch[];
  label: string;
};

/** A plugin-contributed preset for a built-in node (from `flows.nodes.list`).
 *  Lets a plugin inject one-click starter config into a native node — e.g.
 *  alert-watcher's "Severity" rubric on the Router. Surfaced only while the
 *  contributing plugin is enabled. */
export type FlowNodePreset = {
  pluginId: string;
  id: string;
  /** Built-in node type this preset targets (e.g. 'router'). */
  target: string;
  label: string;
  description?: string;
  icon?: string;
  /** Partial node `data` merged into the target node when applied. */
  data: Record<string, unknown>;
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

/** One delivery target for a built-in channel node. */
export type ChannelDestination = {
  /** 'user' = chosen from the channel's registered directory; 'custom' = manual address. */
  kind: 'user' | 'custom';
  /** Channel-native address: WhatsApp E.164/number, Telegram chat id, Discord user/channel id. */
  to: string;
  label?: string;
};

/** Built-in channel node — delivers the upstream message to one or more
 *  destinations on a chosen channel (whatsapp/telegram/discord/…) via the
 *  gateway `send` RPC. Not tied to any plugin. */
export type ChannelNodeData = {
  channel: string;
  accountId?: string;
  destinations: ChannelDestination[];
  label: string;
};

export type HandoffDestination = { channel: string; to: string; accountId?: string };

/** Built-in Human Handoff node — terminal; opens a live relay session to owners. */
export type HandoffNodeData = {
  label: string;
  destinations: HandoffDestination[];
  priority?: string;
  suggestionCount?: number;
  language?: string;
  systemPrompt?: string;
  closingMessage?: string;
};

/** Built-in Set Reaction node — transparent side-effect: sets a status emoji on
 *  the flow's trigger message (via gateway `flows.reaction.set`) then passes the
 *  upstream message through. Use to mark a complaint received/handled/escalated. */
export type ReactionNodeData = {
  label: string;
  /** Single emoji to set. Telegram restricts to its allowed set; WhatsApp is open. */
  emoji: string;
};

/** Subflow node — runs another saved flow as a subroutine: it receives this
 *  node's input and its final output flows downstream. The runner resolves
 *  `flowId` at execution time (with cycle + depth guards). */
export type SubflowNodeData = {
  label: string;
  /** Id of the flow to run. */
  flowId?: string;
  /** Cached display name of the referenced flow (UI convenience). */
  flowName?: string;
};

/** Database CRUD action. `read` → gateway `flows.db.query` (SELECT-only, returns
 *  rows, optional consume-marker); `create`/`update`/`delete` → `flows.db.exec`
 *  (write, returns the change count). */
export type DatabaseAction = 'read' | 'create' | 'update' | 'delete';

/** Built-in Database node — a single node covering all CRUD against a sqlite DB
 *  (defaults to the message ledger). `action` selects read (SELECT, hardened
 *  SELECT-only + identifier allowlist + DB-path confinement gateway-side, with an
 *  optional consume-marker) vs. a write (create/update/delete). `{input}` expands
 *  in the SQL. */
export type DatabaseNodeData = {
  label: string;
  action: DatabaseAction;
  sql: string;
  dbPath?: string;
  /** Read-only: consume-marker stamped on the returned rows (e.g. last_checked). */
  markColumn?: string;
  markTable?: string;
  markIdColumn?: string;
};

/** Built-in Write File node — writes the upstream message content to a file via
 *  gateway `flows.file.write` (path confined gateway-side; `{date}` expands). */
export type FileWriteNodeData = {
  label: string;
  path: string;
  mode: 'overwrite' | 'append';
};

/** Built-in Schedule trigger — an ENTRY node that fires the flow on a recurring
 *  interval. The gateway's flows scheduler service evaluates the interval and
 *  fires activated scheduled flows. No inbound message (empty seed prompt). */
export type ScheduleNodeData = {
  label: string;
  every: number;
  unit: 'minutes' | 'hours' | 'days';
  /** Optional "HH:MM" local anchor — for the 'days' unit, fire at/after this time. */
  atTime?: string;
};

/** Value stored by a `type: 'destination-list'` plugin config field — the same
 *  channel + sending-account + destinations the built-in Channel node carries,
 *  minus the node label. Forwarded to the plugin method verbatim. */
export type DestinationListValue = {
  channel?: string;
  accountId?: string;
  destinations: ChannelDestination[];
};

/** Value stored by a `type: 'branch-editor'` plugin config field — the Router's
 *  routing config minus the label. A node carrying this becomes a brancher: its
 *  branch ids become source handles, and the runner routes on the node's output. */
export type BranchConfig = {
  mode: 'rule' | 'llm' | 'hybrid';
  modelId?: string;
  branches: RouterBranch[];
};

/** One inbound source for a Channel Trigger: a channel + optional linked account.
 *  Mirrors the output node's destination rows. The trigger's single event applies
 *  to every source; account narrows to one linked sender account (blank = any). */
export type ChannelTriggerSource = {
  channel: string;
  accountId?: string;
};

export type TriggerNodeData = {
  /** Channel-scoped events only — non-channel events (memory/agent) don't belong
   *  on a Channel Trigger. One event per node; add another node for a different one. */
  event: 'message:received' | 'message:sent';
  label: string;
  deliverResponse: boolean;
  /** Inbound sources (channel + optional account). Empty = all channels. */
  sources?: ChannelTriggerSource[];
  /** @deprecated slice-1 multi-channel shape; read for back-compat, migrated to `sources`. */
  channels?: string[];
  /** @deprecated single-channel filter; superseded by `sources`. Read for back-compat. */
  filterChannelId?: string;
  filterAgentId?: string;
};

/** A typed config field a plugin declares for one of its flow nodes (mirrors the
 *  gateway's FlowNodeConfigField). Rendered as a form by NodeConfigPanel. */
export type FlowNodeConfigField = {
  key: string;
  label: string;
  type:
    | 'string'
    | 'number'
    | 'boolean'
    | 'select'
    | 'textarea'
    | 'channel'
    | 'destination-list'
    | 'branch-editor';
  options?: { value: string; label: string }[];
  default?: string | number | boolean;
  placeholder?: string;
  description?: string;
};

/** Palette group a contributed node belongs to (matches a built-in function
 *  group, or names a new one; absent ⇒ grouped under the plugin id). */
export type FlowNodeCategory = 'Triggers' | 'AI' | 'Logic & Data' | 'Output' | (string & {});

/** Plugin flow-node descriptor as returned by `flows.nodes.list`. */
export type FlowNodeDescriptor = {
  pluginId: string;
  id: string;
  kind: 'trigger' | 'action';
  label: string;
  description?: string;
  icon?: string;
  category?: FlowNodeCategory;
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
  type: 'agent' | 'promptBox' | 'llm' | 'trigger' | 'pluginTrigger' | 'pluginAction' | 'transform' | 'structured' | 'router' | 'toolAgent' | 'channel' | 'handoff' | 'reaction' | 'subflow' | 'database' | 'fileWrite' | 'schedule';
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
    | ToolAgentNodeData
    | ChannelNodeData
    | HandoffNodeData
    | ReactionNodeData
    | SubflowNodeData
    | DatabaseNodeData
    | FileWriteNodeData
    | ScheduleNodeData;
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
export type NodeRunStatus = 'running' | 'done' | 'error' | 'skipped';
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
  /** Plugin-contributed presets for built-in nodes (from flows.nodes.list). */
  nodePresets: [] as FlowNodePreset[],
  /** Node currently open in the config panel (null = closed). */
  configNodeId: null as string | null,
});

// ─── Plugin node config ─────────────────────────────────────────────────────

export function setPluginNodeDescriptors(descriptors: FlowNodeDescriptor[]) {
  flowEditorState.pluginNodeDescriptors = descriptors;
}

export function setNodePresets(presets: FlowNodePreset[]) {
  flowEditorState.nodePresets = presets;
}

/** Plugin presets targeting a given built-in node type (e.g. 'router'). */
export function presetsForNodeType(type: string): FlowNodePreset[] {
  return flowEditorState.nodePresets.filter((p) => p.target === type);
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

/** If a plugin node declares a `branch-editor` config field, return its key and
 *  current branch config (so the canvas node can render one source handle per
 *  branch — the "edge-syncing" between the config and the graph). Null when the
 *  node isn't a config-driven brancher. */
export function branchFieldFor(
  node: FlowNode | undefined,
): { key: string; value: BranchConfig } | null {
  const field = descriptorForNode(node)?.config?.find((f) => f.type === 'branch-editor');
  if (!field) return null;
  const config = ((node?.data as { config?: Record<string, unknown> })?.config ?? {}) as Record<
    string,
    unknown
  >;
  const raw = (config[field.key] ?? {}) as Partial<BranchConfig>;
  return {
    key: field.key,
    value: {
      mode: raw.mode === 'llm' || raw.mode === 'hybrid' ? raw.mode : 'rule',
      modelId: raw.modelId,
      branches: Array.isArray(raw.branches) ? raw.branches : [],
    },
  };
}

/** Build the default config value map from a contribution's declared fields. */
export function defaultConfigForFields(
  fields: FlowNodeConfigField[] | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields ?? []) {
    if (f.default !== undefined) out[f.key] = f.default;
    else if (f.type === 'boolean') out[f.key] = false;
    else if (f.type === 'destination-list') out[f.key] = { destinations: [] } satisfies DestinationListValue;
    else if (f.type === 'branch-editor') out[f.key] = { mode: 'rule', branches: [] } satisfies BranchConfig;
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

/** Effective inbound sources for a Channel Trigger, normalising the legacy
 *  `channels[]` (slice-1) and single `filterChannelId` shapes into `sources`. */
export function triggerSources(data: TriggerNodeData): ChannelTriggerSource[] {
  if (Array.isArray(data.sources) && data.sources.length > 0) return data.sources;
  if (Array.isArray(data.channels) && data.channels.length > 0) {
    return data.channels.map((channel) => ({ channel }));
  }
  if (data.filterChannelId) return [{ channel: data.filterChannelId }];
  return [];
}

/** Build the gateway trigger-registration channel filter from a trigger's data. */
export function triggerChannelFilter(data: TriggerNodeData): {
  filterChannelIds?: string[];
  filterChannelAccounts?: { channel: string; accountId?: string }[];
} {
  const sources = triggerSources(data);
  if (sources.length === 0) return {};
  return {
    filterChannelIds: [...new Set(sources.map((s) => s.channel))],
    filterChannelAccounts: sources.map((s) => ({ channel: s.channel, accountId: s.accountId })),
  };
}

/** Merge a partial patch into a node's `data` and persist. Used by built-in
 *  nodes (e.g. the channel node) that store structured data directly on `data`
 *  rather than under `data.config`. */
export function updateNodeData(nodeId: string, patch: Record<string, unknown>) {
  flowEditorState.nodes = flowEditorState.nodes.map((n) =>
    n.id === nodeId ? ({ ...n, data: { ...(n.data as Record<string, unknown>), ...patch } } as FlowNode) : n,
  );
  markDirty();
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
  // On run completion, any processing node that never started was skipped
  // (e.g. a router branch not taken, or nodes downstream of an error).
  if (ev.kind === 'run-end') {
    for (const n of flowEditorState.nodes) {
      if (PROCESSING_NODE_TYPES.has(n.type) && !flowEditorState.nodeRuns[n.id]) {
        flowEditorState.nodeRuns[n.id] = { status: 'skipped' };
      }
    }
    return;
  }
  if (!ev.nodeId) return;
  if (ev.kind === 'node-start') {
    flowEditorState.nodeRuns[ev.nodeId] = { status: 'running', input: ev.input };
  } else if (ev.kind === 'node-end') {
    flowEditorState.nodeRuns[ev.nodeId] = { status: 'done', input: ev.input, output: ev.output };
  } else if (ev.kind === 'node-error') {
    flowEditorState.nodeRuns[ev.nodeId] = { status: 'error', input: ev.input, error: ev.message };
  }
}

/** Node types the runner actually executes (entry nodes excluded). */
const PROCESSING_NODE_TYPES = new Set([
  'llm',
  'agent',
  'pluginAction',
  'transform',
  'structured',
  'router',
  'toolAgent',
  'channel',
  'reaction',
  'subflow',
  'database',
  'fileWrite',
]);

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
  // Only seed a sample payload when the flow's *connected* entry is a trigger.
  // A wired Prompt Box carries its own input (no seed); orphaned trigger nodes
  // dropped on the canvas but never wired must not force a seed — that mirrors
  // the runner, which ignores unconnected entry nodes.
  const flowSources = new Set(
    flowEditorState.edges.filter((e) => e.type === 'flow').map((e) => e.source),
  );
  const entry = flowEditorState.nodes.find(
    (n) =>
      (n.type === 'trigger' || n.type === 'pluginTrigger' || n.type === 'promptBox') &&
      flowSources.has(n.id),
  );
  const isTriggerEntry = entry?.type === 'trigger' || entry?.type === 'pluginTrigger';
  return isTriggerEntry ? TEST_RUN_SAMPLE_PROMPT : undefined;
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
        source: 'test', // manual Test Run; live trigger runs are persisted by the gateway as 'production'
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
