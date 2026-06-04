// Master Flows — curated, read-only DAG visualizations of the gateway's
// STANDARD internal behaviors (what actually happens inside the gateway when a
// user texts it, when a flow trigger fires, on a heartbeat tick, etc.).
//
// These are NOT user-editable flows and are NOT persisted. They're hand-authored
// documentation diagrams rendered in the same @xyflow canvas the flow editor
// uses, so the "internal logic" reads with the same visual vocabulary as the
// flows users build themselves.
//
// Accuracy note: the steps below mirror the real gateway pipeline (minion/, DEV
// branch) — inbound monitor → dedupe/access → message_intercept hook → reaction
// lifecycle → session resolve → media/link understanding → directive/command
// detection → smart routing → prompt assembly (memory + skills) → agent turn →
// tool-use loop → block streaming → outbound deliver → ledger/memory. Kept at a
// readable granularity; it is a map, not a line-by-line trace.

export type MasterNodeKind =
  | 'trigger'
  | 'schedule'
  | 'guard'
  | 'hook'
  | 'reaction'
  | 'session'
  | 'process'
  | 'router'
  | 'agent'
  | 'llm'
  | 'tool'
  | 'skill'
  | 'channel'
  | 'handoff'
  | 'memory'
  | 'end';

export interface MasterBranch {
  /** Stable handle id referenced by an edge's `sourceHandle`. */
  id: string;
  label: string;
}

export interface MasterFlowNode {
  id: string;
  kind: MasterNodeKind;
  title: string;
  subtitle?: string;
  position: { x: number; y: number };
  /** Router-style multiple labeled outputs. Omit for a single `out` handle. */
  branches?: MasterBranch[];
}

export interface MasterFlowEdge {
  id: string;
  source: string;
  target: string;
  /** Defaults to the node's single `out` handle; set to a branch id to fan out. */
  sourceHandle?: string;
  label?: string;
  /** `loop` = agentic retry (animated); `parallel` = concurrent side-path (dashed). */
  variant?: 'default' | 'loop' | 'parallel';
}

export interface MasterFlow {
  id: string;
  name: string;
  /** One-line summary shown on the card + viewer header. */
  description: string;
  tags?: string[];
  nodes: MasterFlowNode[];
  edges: MasterFlowEdge[];
}

// ── Flow 1: Channel message → reply (the flagship "normal interaction") ───────
const channelMessageReply: MasterFlow = {
  id: 'channel-message-reply',
  name: 'Channel message → reply',
  description:
    'The standard path when a user texts the gateway on a channel — from inbound receipt through the agent turn, tool loop, and reply delivery.',
  tags: ['inbound', 'agent', 'tools'],
  nodes: [
    { id: 'inbound', kind: 'trigger', title: 'Inbound message', subtitle: 'user texts a channel (WhatsApp, Telegram…)', position: { x: 0, y: 280 } },
    { id: 'filter', kind: 'guard', title: 'Filter & dedupe', subtitle: 'debounce/coalesce · dedupe · access control · drop own messages', position: { x: 260, y: 280 } },
    {
      id: 'intercept',
      kind: 'router',
      title: 'message_intercept',
      subtitle: 'plugins may claim the message',
      position: { x: 560, y: 280 },
      branches: [
        { id: 'open', label: 'Not handled' },
        { id: 'claimed', label: 'Claimed by plugin' },
      ],
    },
    { id: 'suppressed', kind: 'end', title: 'Suppressed', subtitle: 'plugin handles it — no AI reply (e.g. alert-watcher)', position: { x: 860, y: 80 } },
    { id: 'flowfire', kind: 'hook', title: 'Flow triggers fire', subtitle: 'message:received — user flows run in parallel', position: { x: 560, y: 520 } },
    { id: 'flowrun', kind: 'end', title: 'See "Flow trigger execution"', position: { x: 860, y: 520 } },

    { id: 'react-seen', kind: 'reaction', title: 'React 👀', subtitle: 'mark seen', position: { x: 860, y: 280 } },
    { id: 'session', kind: 'session', title: 'Resolve session', subtitle: 'session key (DM vs group) · load history', position: { x: 1120, y: 280 } },
    { id: 'understand', kind: 'process', title: 'Understand media & links', subtitle: 'image OCR/vision · scrape & summarize URLs', position: { x: 1400, y: 280 } },
    {
      id: 'dispatch',
      kind: 'router',
      title: 'Directives & command',
      subtitle: 'parse @@@directives · detect /commands',
      position: { x: 1680, y: 280 },
      branches: [
        { id: 'chat', label: 'Chat message' },
        { id: 'command', label: 'Slash command' },
      ],
    },
    { id: 'cmd-run', kind: 'tool', title: 'Run command handler', subtitle: '/new, /reset, control commands…', position: { x: 1960, y: 80 } },
    { id: 'cmd-deliver', kind: 'channel', title: 'Deliver command output', position: { x: 2240, y: 80 } },
    { id: 'cmd-end', kind: 'end', title: 'End', position: { x: 2520, y: 80 } },

    { id: 'route', kind: 'process', title: 'Select model & agent', subtitle: 'smart routing: rule fast-path → tier (local/API)', position: { x: 1960, y: 280 } },
    { id: 'skills', kind: 'skill', title: 'Load skills & memory', subtitle: 'allowlisted skills · LTM fact recall', position: { x: 1960, y: 520 } },
    { id: 'prompt', kind: 'process', title: 'Assemble system prompt', subtitle: 'base + sender meta + memory + skills + history', position: { x: 2240, y: 280 } },
    { id: 'agent', kind: 'agent', title: 'Agent turn (LLM)', subtitle: 'reason · stream · optional extended thinking', position: { x: 2520, y: 280 } },
    {
      id: 'toolcheck',
      kind: 'router',
      title: 'Tool call?',
      position: { x: 2800, y: 280 },
      branches: [
        { id: 'final', label: 'Final answer' },
        { id: 'tool', label: 'Tool requested' },
      ],
    },
    { id: 'tool-invoke', kind: 'tool', title: 'Invoke tool', subtitle: 'bash / http / plugin tool (approval if required)', position: { x: 2800, y: 520 } },
    { id: 'react-think', kind: 'reaction', title: 'React 🧠', subtitle: 'if reasoning was used', position: { x: 3080, y: 280 } },
    { id: 'stream', kind: 'process', title: 'Stream reply blocks', subtitle: 'typing indicator · block flush', position: { x: 3340, y: 280 } },
    { id: 'deliver', kind: 'channel', title: 'Deliver to channel', subtitle: 'send back to the originating chat', position: { x: 3600, y: 280 } },
    { id: 'react-done', kind: 'reaction', title: 'React ✅', subtitle: 'mark done', position: { x: 3860, y: 280 } },
    { id: 'persist', kind: 'memory', title: 'Write ledger & memory', subtitle: 'transcript · usage · fact commitments', position: { x: 4120, y: 280 } },
    { id: 'end', kind: 'end', title: 'End', position: { x: 4380, y: 280 } },
  ],
  edges: [
    { id: 'e1', source: 'inbound', target: 'filter' },
    { id: 'e2', source: 'filter', target: 'intercept' },
    { id: 'e3', source: 'intercept', sourceHandle: 'claimed', target: 'suppressed' },
    { id: 'e4', source: 'intercept', sourceHandle: 'open', target: 'react-seen' },
    { id: 'e-par', source: 'filter', target: 'flowfire', variant: 'parallel', label: 'parallel' },
    { id: 'e-par2', source: 'flowfire', target: 'flowrun', variant: 'parallel' },
    { id: 'e5', source: 'react-seen', target: 'session' },
    { id: 'e6', source: 'session', target: 'understand' },
    { id: 'e7', source: 'understand', target: 'dispatch' },
    { id: 'e8', source: 'dispatch', sourceHandle: 'command', target: 'cmd-run' },
    { id: 'e9', source: 'cmd-run', target: 'cmd-deliver' },
    { id: 'e10', source: 'cmd-deliver', target: 'cmd-end' },
    { id: 'e11', source: 'dispatch', sourceHandle: 'chat', target: 'route' },
    { id: 'e12', source: 'route', target: 'prompt' },
    { id: 'e13', source: 'skills', target: 'prompt', variant: 'parallel' },
    { id: 'e14', source: 'prompt', target: 'agent' },
    { id: 'e15', source: 'agent', target: 'toolcheck' },
    { id: 'e16', source: 'toolcheck', sourceHandle: 'tool', target: 'tool-invoke' },
    { id: 'e17', source: 'tool-invoke', target: 'agent', variant: 'loop', label: 'feed result back' },
    { id: 'e18', source: 'toolcheck', sourceHandle: 'final', target: 'react-think' },
    { id: 'e19', source: 'react-think', target: 'stream' },
    { id: 'e20', source: 'stream', target: 'deliver' },
    { id: 'e21', source: 'deliver', target: 'react-done' },
    { id: 'e22', source: 'react-done', target: 'persist' },
    { id: 'e23', source: 'persist', target: 'end' },
  ],
};

// ── Flow 2: Flow trigger execution (LangGraph) ────────────────────────────────
const flowTriggerExecution: MasterFlow = {
  id: 'flow-trigger-execution',
  name: 'Flow trigger execution',
  description:
    'How a user-built flow runs alongside the agent: an inbound message matches a registered trigger and the LangGraph flow executes its own nodes (classify → channel → handoff).',
  tags: ['flows', 'langgraph', 'routing'],
  nodes: [
    { id: 'evt', kind: 'trigger', title: 'message:received', subtitle: 'fired on every inbound', position: { x: 0, y: 240 } },
    {
      id: 'match',
      kind: 'router',
      title: 'Trigger registered?',
      subtitle: 'match channel + account + agent filter',
      position: { x: 260, y: 240 },
      branches: [
        { id: 'yes', label: 'Match' },
        { id: 'no', label: 'No match' },
      ],
    },
    { id: 'ignore', kind: 'end', title: 'Ignore', subtitle: 'default agent path handles it', position: { x: 540, y: 60 } },
    { id: 'run', kind: 'process', title: 'Run LangGraph flow', subtitle: 'compiled graph executes on the runner', position: { x: 540, y: 300 } },
    {
      id: 'classify',
      kind: 'router',
      title: 'Classify (Router node)',
      subtitle: 'rule → LLM rubric (hybrid)',
      position: { x: 820, y: 300 },
      branches: [
        { id: 'high', label: 'High severity' },
        { id: 'low', label: 'Low / FYI' },
      ],
    },
    { id: 'alert', kind: 'channel', title: 'Alert owners', subtitle: 'Channel node → registered destinations', position: { x: 1100, y: 140 } },
    { id: 'handoff', kind: 'handoff', title: 'Human handoff', subtitle: 'relay human ↔ human until /end', position: { x: 1380, y: 140 } },
    { id: 'alert-end', kind: 'end', title: 'Relayed', position: { x: 1660, y: 140 } },
    { id: 'auto', kind: 'channel', title: 'Auto-reply', subtitle: 'agent answers in-flow', position: { x: 1100, y: 420 } },
    { id: 'auto-end', kind: 'end', title: 'End', position: { x: 1380, y: 420 } },
  ],
  edges: [
    { id: 'f1', source: 'evt', target: 'match' },
    { id: 'f2', source: 'match', sourceHandle: 'no', target: 'ignore' },
    { id: 'f3', source: 'match', sourceHandle: 'yes', target: 'run' },
    { id: 'f4', source: 'run', target: 'classify' },
    { id: 'f5', source: 'classify', sourceHandle: 'high', target: 'alert' },
    { id: 'f6', source: 'alert', target: 'handoff' },
    { id: 'f7', source: 'handoff', target: 'alert-end' },
    { id: 'f8', source: 'classify', sourceHandle: 'low', target: 'auto' },
    { id: 'f9', source: 'auto', target: 'auto-end' },
  ],
};

// ── Flow 3: Heartbeat / proactive ─────────────────────────────────────────────
const heartbeatProactive: MasterFlow = {
  id: 'heartbeat-proactive',
  name: 'Heartbeat (proactive)',
  description:
    'The time-based path: on a scheduler tick the agent reads its HEARTBEAT brief and decides whether to reach out — no inbound message required.',
  tags: ['proactive', 'scheduled'],
  nodes: [
    { id: 'tick', kind: 'schedule', title: 'Scheduler tick', subtitle: 'cron — e.g. every 30 min', position: { x: 0, y: 200 } },
    { id: 'read', kind: 'process', title: 'Read HEARTBEAT brief', subtitle: 'HEARTBEAT.md from the workspace', position: { x: 260, y: 200 } },
    { id: 'turn', kind: 'agent', title: 'Heartbeat agent turn', subtitle: 'dedicated heartbeat model', position: { x: 540, y: 200 } },
    {
      id: 'decide',
      kind: 'router',
      title: 'Action needed?',
      position: { x: 820, y: 200 },
      branches: [
        { id: 'ok', label: 'HEARTBEAT_OK' },
        { id: 'msg', label: 'Has a message' },
      ],
    },
    { id: 'noop', kind: 'end', title: 'No-op', subtitle: 'stay quiet', position: { x: 1100, y: 40 } },
    { id: 'send', kind: 'channel', title: 'Send proactive message', position: { x: 1100, y: 340 } },
    { id: 'hb-end', kind: 'end', title: 'End', position: { x: 1380, y: 340 } },
  ],
  edges: [
    { id: 'h1', source: 'tick', target: 'read' },
    { id: 'h2', source: 'read', target: 'turn' },
    { id: 'h3', source: 'turn', target: 'decide' },
    { id: 'h4', source: 'decide', sourceHandle: 'ok', target: 'noop' },
    { id: 'h5', source: 'decide', sourceHandle: 'msg', target: 'send' },
    { id: 'h6', source: 'send', target: 'hb-end' },
  ],
};

// ── Flow 4: Human handoff / relay ─────────────────────────────────────────────
const humanHandoffRelay: MasterFlow = {
  id: 'human-handoff-relay',
  name: 'Human handoff & relay',
  description:
    'The triage path: an alert is raised, an owner claims it by replying, and the gateway relays messages human ↔ human until someone closes it — with the 👀→🫡→✍️→👍 reaction states.',
  tags: ['handoff', 'triage', 'reactions'],
  nodes: [
    { id: 'alert', kind: 'trigger', title: 'Alert raised', subtitle: 'classified inbound needs a human', position: { x: 0, y: 220 } },
    { id: 'notify', kind: 'channel', title: 'Notify owners', subtitle: 'react 👀 unattended', position: { x: 260, y: 220 } },
    {
      id: 'claim',
      kind: 'router',
      title: 'Owner claims?',
      subtitle: 'native reply to the alert',
      position: { x: 540, y: 220 },
      branches: [
        { id: 'claimed', label: 'Reply = claim' },
        { id: 'unclaimed', label: 'Unattended' },
      ],
    },
    { id: 'wait', kind: 'end', title: 'Stays unattended', position: { x: 820, y: 60 } },
    { id: 'react-claim', kind: 'reaction', title: 'React 🫡', subtitle: 'claimed', position: { x: 820, y: 320 } },
    { id: 'suggest', kind: 'process', title: 'Suggested replies', subtitle: 'agent drafts options for the owner', position: { x: 1100, y: 320 } },
    { id: 'relay', kind: 'handoff', title: 'Relay human ↔ human', subtitle: 'react ✍️ relaying', position: { x: 1380, y: 320 } },
    {
      id: 'endq',
      kind: 'router',
      title: '/end?',
      position: { x: 1660, y: 320 },
      branches: [
        { id: 'continue', label: 'Continue' },
        { id: 'close', label: '/end' },
      ],
    },
    { id: 'react-close', kind: 'reaction', title: 'React 👍', subtitle: 'closed', position: { x: 1940, y: 320 } },
    { id: 'closed', kind: 'end', title: 'Closed', position: { x: 2220, y: 320 } },
  ],
  edges: [
    { id: 'r1', source: 'alert', target: 'notify' },
    { id: 'r2', source: 'notify', target: 'claim' },
    { id: 'r3', source: 'claim', sourceHandle: 'unclaimed', target: 'wait' },
    { id: 'r4', source: 'claim', sourceHandle: 'claimed', target: 'react-claim' },
    { id: 'r5', source: 'react-claim', target: 'suggest' },
    { id: 'r6', source: 'suggest', target: 'relay' },
    { id: 'r7', source: 'relay', target: 'endq' },
    { id: 'r8', source: 'endq', sourceHandle: 'continue', target: 'relay', variant: 'loop', label: 'keep relaying' },
    { id: 'r9', source: 'endq', sourceHandle: 'close', target: 'react-close' },
    { id: 'r10', source: 'react-close', target: 'closed' },
  ],
};

export const MASTER_FLOWS: MasterFlow[] = [
  channelMessageReply,
  flowTriggerExecution,
  heartbeatProactive,
  humanHandoffRelay,
];

export function getMasterFlow(id: string): MasterFlow | undefined {
  return MASTER_FLOWS.find((f) => f.id === id);
}
