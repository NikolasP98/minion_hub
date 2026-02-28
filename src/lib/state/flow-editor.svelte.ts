// Flow Editor State — Svelte 5 runes

export type HandleDef = { id: string; label: string };

export type ContextRule = {
  condition: string;
  contextNodeId: string;
};

export type AgentNodeData = {
  agentId: string;
  label: string;
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

export type FlowNode = {
  id: string;
  type: 'agent' | 'promptBox';
  position: { x: number; y: number };
  data: AgentNodeData | PromptBoxData;
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

// ─── State ────────────────────────────────────────────────────────────────────

export const flowEditorState = $state({
  flowId: null as string | null,
  flowName: '',
  nodes: [] as FlowNode[],
  edges: [] as FlowEdge[],
  selectedNodeIds: [] as string[],
  isDirty: false,
  isSaving: false,
  relationshipMode: false,
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
