// Master Flows — curated, read-only DAG visualizations of the gateway's
// STANDARD internal behaviors (what actually happens inside the gateway when a
// user texts it, when a flow trigger fires, on a heartbeat tick, etc.).
//
// These are NOT user-editable flows and are NOT persisted. They're hand-authored
// documentation diagrams rendered in the same @xyflow canvas the flow editor
// uses, so the "internal logic" reads with the same visual vocabulary as the
// flows users build themselves.
//
// Accuracy note: these diagrams were reconstructed 1:1 against the real gateway
// implementation (minion/, DEV branch) by tracing the actual call graph —
// src/web/inbound/monitor.ts, src/web/auto-reply/monitor/*, src/dispatch/*,
// src/flows/trigger-manager.ts, the langgraph-server runner (compile-flow.ts),
// src/infra/heartbeat-runner.ts, and extensions/flows/src/relay/*. Branch labels,
// reaction emojis, sentinels, RPC names and config defaults reflect the code as
// written. Several nodes use "custom" placeholder kinds (intercept, guardrail,
// dedupe, voice, broadcast, directive, preflight, coalesce, buffer, subflow,
// database, file-write, plugin-action, structured, transform, tool-agent) that
// the base editor palette doesn't have — they exist only to document internals
// faithfully. It is a detailed map, not a literal line-by-line trace.

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
  | 'end'
  // Custom placeholder kinds — gateway internals the base palette can't express.
  | 'dedupe'
  | 'intercept'
  | 'guardrail'
  | 'voice'
  | 'broadcast'
  | 'directive'
  | 'preflight'
  | 'coalesce'
  | 'buffer'
  | 'subflow'
  | 'database'
  | 'file-write'
  | 'plugin-action'
  | 'structured'
  | 'transform'
  | 'tool-agent';

export interface MasterBranch {
  /** Stable handle id referenced by an edge's `sourceHandle`. */
  id: string;
  label: string;
}

export type VariableType = 'int' | 'float' | 'string' | 'bool' | 'list' | 'object';

export interface VariableSpec {
  /** Universal id — dotted key namespace.name (e.g., "reminders.sent"). */
  key: string;
  /** Type of the variable. */
  type: VariableType;
  /** Human label for the export panel + the artifact builder. */
  label: string;
  /** Optional one-line description. */
  description?: string;
  /** Example value for the viewer + the artifact builder (5b.2). */
  sample?: unknown;
  /** Enabled state when no toggle row exists (default true). */
  defaultExported?: boolean;
}

export interface MasterFlowNode {
  id: string;
  kind: MasterNodeKind;
  title: string;
  subtitle?: string;
  position: { x: number; y: number };
  /** Router-style multiple labeled outputs. Omit for a single `out` handle. */
  branches?: MasterBranch[];
  /** Variables exported by this node. */
  exports?: VariableSpec[];
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

// Layout helper — `col` advances left→right, `lane` offsets up (-) / down (+)
// from the spine. Keeps ~150 hand-placed nodes consistent and editable.
const COL = 300;
const ROW = 175;
const Y0 = 520;
const at = (col: number, lane = 0): { x: number; y: number } => ({
  x: col * COL,
  y: Y0 + lane * ROW,
});

// Common branch shapes.
const PASS_DROP: MasterBranch[] = [
  { id: 'pass', label: 'Pass' },
  { id: 'drop', label: 'Drop' },
];

// ── Flow 1: Channel message → reply (the flagship "normal interaction") ───────
const channelMessageReply: MasterFlow = {
  id: 'channel-message-reply',
  name: 'Channel message → reply',
  description:
    'The real inbound path when a user texts the gateway — socket intake, dedupe/access, debounce, plugin intercept, routing & content guardrails, the dispatch pipeline, the agent tool loop, delivery, status reactions and the ledger. Reconstructed 1:1 from src/web + src/dispatch.',
  tags: ['inbound', 'agent', 'tools', 'guardrails'],
  nodes: [
    // ── Phase A: socket intake (web/inbound/monitor.ts) ──
    { id: 'socket-upsert', kind: 'trigger', title: 'Inbound (messages.upsert)', subtitle: 'Baileys notify/append · records channel activity', position: at(0) },
    { id: 'status-filter', kind: 'guard', title: 'Status / broadcast filter', subtitle: 'drop @status·@broadcast · require remoteJid', position: at(1), branches: PASS_DROP },
    { id: 'msgid-dedupe', kind: 'dedupe', title: 'Message-ID dedupe', subtitle: '20-min LRU · key acctId:remoteJid:msgId', position: at(2), branches: PASS_DROP },
    { id: 'jid-resolve', kind: 'process', title: 'Resolve sender JID→E.164', subtitle: 'WhatsApp LID mapping · drop if unresolvable', position: at(3), branches: PASS_DROP },
    { id: 'group-meta', kind: 'process', title: 'Fetch group metadata', subtitle: 'subject + roster (5-min cache) · group only', position: at(4) },
    { id: 'access', kind: 'guard', title: 'Inbound access control', subtitle: 'group/dm policy · drop own outbound · pairing-code reply', position: at(5), branches: [{ id: 'allowed', label: 'Allowed' }, { id: 'blocked', label: 'Blocked' }] },
    { id: 'read-receipt', kind: 'process', title: 'Native read ✓✓ (blue-tick)', subtitle: 'sock.readMessages() — NOT an emoji · fires before intercept', position: at(6) },
    { id: 'extract', kind: 'process', title: 'Extract body · media · location', subtitle: 'download media + quoted-audio · drop if empty', position: at(7) },

    // ── Phase B: debounce, hooks & intercept (auto-reply/monitor.ts onFlush) ──
    { id: 'debounce', kind: 'coalesce', title: 'Inbound debouncer', subtitle: 'batch rapid msgs · skipped for media/reply/command', position: at(8) },
    { id: 'inbound-hook', kind: 'hook', title: 'message_inbound hook', subtitle: 'fire-and-forget · plugins + ledger', position: at(8, 2) },
    { id: 'flow-trigger', kind: 'trigger', title: 'Flow triggers fire', subtitle: 'fireInboundTriggerHook → message:received · best-effort', position: at(9, 2) },
    { id: 'flowrun', kind: 'end', title: 'See "Flow trigger execution"', position: at(10, 2) },
    { id: 'intercept', kind: 'intercept', title: 'message_intercept', subtitle: 'plugins may claim · {handled:true} suppresses AI reply', position: at(9), branches: [{ id: 'open', label: 'Not handled' }, { id: 'claimed', label: 'Claimed' }] },
    { id: 'suppressed', kind: 'end', title: 'Suppressed', subtitle: 'plugin handled it (relay screen-window, alert-watcher…)', position: at(9, -2) },
    { id: 'combine', kind: 'process', title: 'Combine debounced batch', subtitle: 'join bodies · union mentions', position: at(10) },

    // ── Phase C: routing & content gating (auto-reply/monitor/on-message.ts) ──
    { id: 'route', kind: 'process', title: 'Resolve agent route', subtitle: 'resolveAgentRoute · peer/bindings · group-history key', position: at(11) },
    { id: 'early-echo', kind: 'dedupe', title: 'Early echo skip', subtitle: 'echoTracker body-match · drop own just-sent text', position: at(12), branches: PASS_DROP },
    { id: 'group-gating', kind: 'guard', title: 'Group mention / activation', subtitle: 'mention · /activation · owner-bypass · else store+wait', position: at(13), branches: [{ id: 'activated', label: 'Addressed' }, { id: 'idle', label: 'Not addressed' }] },
    { id: 'medical-guardrail', kind: 'guardrail', title: 'Medical safety guardrail', subtitle: 'public agents · detectMedicalContent → deferral reply', position: at(14), branches: [{ id: 'clean', label: 'Clean' }, { id: 'medical', label: 'Medical' }] },
    { id: 'broadcast', kind: 'broadcast', title: 'Broadcast fan-out', subtitle: 'cfg.broadcast → run N agents (parallel/sequential)', position: at(15), branches: [{ id: 'single', label: 'Single agent' }, { id: 'fanout', label: 'Broadcast' }] },

    // ── Phase D: pre-dispatch (auto-reply/monitor/process-message.ts) ──
    { id: 'combined-body', kind: 'process', title: 'Build inbound + history', subtitle: 'backfill <media:image>/<media:audio> from disk history', position: at(16) },
    { id: 'late-echo', kind: 'dedupe', title: 'Combined-body echo skip', subtitle: 'buildCombinedEchoKey → drop duplicate', position: at(17), branches: PASS_DROP },
    { id: 'status-init', kind: 'reaction', title: 'Status reaction 👀 (queued)', subtitle: 'setQueued emoji · gated direct/mention · ⏳@10s ⚠️@30s stall', position: at(18) },
    { id: 'bg-meta', kind: 'memory', title: 'Background meta + last-route', subtitle: 'recordSessionMetaFromInbound · async write', position: at(18, 2) },
    { id: 's2s-voice', kind: 'voice', title: 'S2S voice-note shortcut', subtitle: 'mode=s2s + audio → OpenAI Realtime · bypasses the LLM', position: at(19), branches: [{ id: 'normal', label: 'Text path' }, { id: 's2s', label: 'Voice S2S' }] },

    // ── Phase E: dispatch guards (dispatch/dispatch-from-config.ts) ──
    { id: 'dispatch-dedupe', kind: 'dedupe', title: 'Dispatch-layer dedupe', subtitle: 'shouldSkipDuplicateInbound · second idempotency guard', position: at(20), branches: PASS_DROP },
    { id: 'credential-scan', kind: 'guardrail', title: 'Credential-leak scan', subtitle: 'always-on floor · blocks api-key/token/private-key leaks', position: at(21), branches: [{ id: 'clean', label: 'Clean' }, { id: 'leak', label: 'Leak' }] },
    { id: 'fast-abort', kind: 'directive', title: 'Fast-abort (/stop)', subtitle: 'tryFastAbortFromMessage · stop subagents · reply', position: at(22), branches: [{ id: 'continue', label: 'Continue' }, { id: 'abort', label: '/stop' }] },

    // ── Phase F: reply preparation (auto-reply/monitor/get-reply*.ts) ──
    { id: 'understand', kind: 'process', title: 'Understand media & links', subtitle: 'image vision · audio STT · video · file · URL scrape (concurrent)', position: at(23) },
    { id: 'dispatch-hook', kind: 'hook', title: 'message_received hook', subtitle: 'fire-and-forget plugin hook (≠ flow trigger)', position: at(23, 2) },
    { id: 'session', kind: 'session', title: 'Init session state', subtitle: 'load/create · reset detection · command-auth', position: at(24) },
    { id: 'directives', kind: 'router', title: 'Resolve @@@directives', subtitle: '/think /model /queue /elevated · may early-reply', position: at(25), branches: [{ id: 'continue', label: 'Continue' }, { id: 'reply', label: 'Directive reply' }] },
    { id: 'smart-route', kind: 'process', title: 'Smart route & pin model', subtitle: 'classify → provider/model/timeout override · pin session', position: at(26) },
    { id: 'inline-actions', kind: 'router', title: 'Inline actions & commands', subtitle: 'skill-commands · /status · slash-commands', position: at(27), branches: [{ id: 'chat', label: 'Chat' }, { id: 'command', label: 'Command' }] },
    { id: 'prompt', kind: 'process', title: 'Assemble prompt + skills', subtitle: 'base + sender meta + memory + skills + history · pre_prompt_build', position: at(28), branches: [{ id: 'ok', label: 'Has text' }, { id: 'empty', label: 'Empty body' }] },
    { id: 'queue', kind: 'process', title: 'Resolve queue / steer', subtitle: 'interrupt clears lane · steer/followup decision', position: at(29) },

    // ── Phase G: agent turn + tool loop (dispatch + agent-runner) ──
    { id: 'agent', kind: 'agent', title: 'Agent turn (runReplyAgent)', subtitle: 'memory flush · signalRunStart', position: at(30), branches: [{ id: 'run', label: 'Run' }, { id: 'steer', label: 'Steer / followup' }] },
    { id: 'agent-loop', kind: 'llm', title: 'LLM turn + thinking', subtitle: 'stream · 🧠 setThinking on reasoning · provider fallback', position: at(31), branches: [{ id: 'final', label: 'Final answer' }, { id: 'tool', label: 'Tool call' }] },
    { id: 'tool-invoke', kind: 'tool', title: 'Invoke tool', subtitle: 'bash/http/plugin · approval if required · per-tool emoji', position: at(31, 2) },
    { id: 'stream', kind: 'process', title: 'Stream reply blocks + TTS', subtitle: 'onBlockReply · maybeApplyTts · media-dedup', position: at(32) },

    // ── Phase H: deliver & persist ──
    { id: 'deliver', kind: 'channel', title: 'Deliver to channel', subtitle: 'deliverWebReply chunked · cross-provider route', position: at(33) },
    { id: 'ledger', kind: 'memory', title: 'Outbound ledger + echo seed', subtitle: 'record() · rememberSentText (seeds echo set)', position: at(33, 2) },
    { id: 'terminal-react', kind: 'reaction', title: 'Terminal reaction ✅ / ❌', subtitle: 'setDone/setError · clear after removeAckAfterReply hold', position: at(34) },
    { id: 'clear-history', kind: 'memory', title: 'Clear group-history window', subtitle: 'reset groupHistories[key] on success', position: at(35) },
    { id: 'end', kind: 'end', title: 'End', position: at(36) },

    // ── Early-exit terminals (lane -2) ──
    { id: 'drop-filter', kind: 'end', title: 'Dropped', subtitle: 'filter · dedupe · unresolved JID', position: at(2, -2) },
    { id: 'access-block', kind: 'end', title: 'Blocked', subtitle: 'policy block / pairing-code reply', position: at(5, -2) },
    { id: 'drop-early', kind: 'end', title: 'Dropped (echo)', position: at(12, -2) },
    { id: 'store-wait', kind: 'end', title: 'Stored to history', subtitle: 'no reply — not addressed', position: at(13, -2) },
    { id: 'medical-end', kind: 'end', title: 'Deferral reply sent', position: at(14, -2) },
    { id: 'broadcast-end', kind: 'end', title: 'Fanned out to N agents', position: at(15, -2) },
    { id: 'drop-late', kind: 'end', title: 'Dropped (echo)', position: at(17, -2) },
    { id: 'voice-end', kind: 'end', title: 'Voice PTT delivered', position: at(19, -2) },
    { id: 'drop-dispatch', kind: 'end', title: 'Dropped (duplicate)', position: at(20, -2) },
    { id: 'leak-end', kind: 'end', title: 'Blocked (credential leak)', position: at(21, -2) },
    { id: 'abort-end', kind: 'end', title: 'Aborted (/stop)', position: at(22, -2) },
    { id: 'directive-end', kind: 'end', title: 'Directive reply sent', position: at(25, -2) },
    { id: 'command-end', kind: 'end', title: 'Command output sent', position: at(27, -2) },
    { id: 'empty-end', kind: 'end', title: 'Canned "no text" reply', position: at(28, -2) },
    { id: 'queue-end', kind: 'end', title: 'Steered / queued', subtitle: 'folded into the in-flight run', position: at(30, -2) },
  ],
  edges: [
    { id: 'a1', source: 'socket-upsert', target: 'status-filter' },
    { id: 'a2', source: 'status-filter', sourceHandle: 'pass', target: 'msgid-dedupe' },
    { id: 'a2d', source: 'status-filter', sourceHandle: 'drop', target: 'drop-filter' },
    { id: 'a3', source: 'msgid-dedupe', sourceHandle: 'pass', target: 'jid-resolve' },
    { id: 'a3d', source: 'msgid-dedupe', sourceHandle: 'drop', target: 'drop-filter' },
    { id: 'a4', source: 'jid-resolve', sourceHandle: 'pass', target: 'group-meta' },
    { id: 'a4d', source: 'jid-resolve', sourceHandle: 'drop', target: 'drop-filter' },
    { id: 'a5', source: 'group-meta', target: 'access' },
    { id: 'a6', source: 'access', sourceHandle: 'allowed', target: 'read-receipt' },
    { id: 'a6b', source: 'access', sourceHandle: 'blocked', target: 'access-block' },
    { id: 'a7', source: 'read-receipt', target: 'extract' },
    { id: 'a8', source: 'extract', target: 'debounce' },
    { id: 'a9', source: 'debounce', target: 'intercept' },
    { id: 'a9p', source: 'debounce', target: 'inbound-hook', variant: 'parallel', label: 'parallel' },
    { id: 'a9p2', source: 'debounce', target: 'flow-trigger', variant: 'parallel' },
    { id: 'a9p3', source: 'flow-trigger', target: 'flowrun', variant: 'parallel' },
    { id: 'a10', source: 'intercept', sourceHandle: 'open', target: 'combine' },
    { id: 'a10b', source: 'intercept', sourceHandle: 'claimed', target: 'suppressed' },
    { id: 'a11', source: 'combine', target: 'route' },
    { id: 'a12', source: 'route', target: 'early-echo' },
    { id: 'a13', source: 'early-echo', sourceHandle: 'pass', target: 'group-gating' },
    { id: 'a13d', source: 'early-echo', sourceHandle: 'drop', target: 'drop-early' },
    { id: 'a14', source: 'group-gating', sourceHandle: 'activated', target: 'medical-guardrail' },
    { id: 'a14b', source: 'group-gating', sourceHandle: 'idle', target: 'store-wait' },
    { id: 'a15', source: 'medical-guardrail', sourceHandle: 'clean', target: 'broadcast' },
    { id: 'a15b', source: 'medical-guardrail', sourceHandle: 'medical', target: 'medical-end' },
    { id: 'a16', source: 'broadcast', sourceHandle: 'single', target: 'combined-body' },
    { id: 'a16b', source: 'broadcast', sourceHandle: 'fanout', target: 'broadcast-end' },
    { id: 'a17', source: 'combined-body', target: 'late-echo' },
    { id: 'a18', source: 'late-echo', sourceHandle: 'pass', target: 'status-init' },
    { id: 'a18d', source: 'late-echo', sourceHandle: 'drop', target: 'drop-late' },
    { id: 'a19', source: 'status-init', target: 's2s-voice' },
    { id: 'a19p', source: 'status-init', target: 'bg-meta', variant: 'parallel' },
    { id: 'a20', source: 's2s-voice', sourceHandle: 'normal', target: 'dispatch-dedupe' },
    { id: 'a20b', source: 's2s-voice', sourceHandle: 's2s', target: 'voice-end' },
    { id: 'a21', source: 'dispatch-dedupe', sourceHandle: 'pass', target: 'credential-scan' },
    { id: 'a21d', source: 'dispatch-dedupe', sourceHandle: 'drop', target: 'drop-dispatch' },
    { id: 'a22', source: 'credential-scan', sourceHandle: 'clean', target: 'fast-abort' },
    { id: 'a22b', source: 'credential-scan', sourceHandle: 'leak', target: 'leak-end' },
    { id: 'a23', source: 'fast-abort', sourceHandle: 'continue', target: 'understand' },
    { id: 'a23b', source: 'fast-abort', sourceHandle: 'abort', target: 'abort-end' },
    { id: 'a24', source: 'understand', target: 'session' },
    { id: 'a24p', source: 'understand', target: 'dispatch-hook', variant: 'parallel' },
    { id: 'a25', source: 'session', target: 'directives' },
    { id: 'a26', source: 'directives', sourceHandle: 'continue', target: 'smart-route' },
    { id: 'a26b', source: 'directives', sourceHandle: 'reply', target: 'directive-end' },
    { id: 'a27', source: 'smart-route', target: 'inline-actions' },
    { id: 'a28', source: 'inline-actions', sourceHandle: 'chat', target: 'prompt' },
    { id: 'a28b', source: 'inline-actions', sourceHandle: 'command', target: 'command-end' },
    { id: 'a29', source: 'prompt', sourceHandle: 'ok', target: 'queue' },
    { id: 'a29b', source: 'prompt', sourceHandle: 'empty', target: 'empty-end' },
    { id: 'a30', source: 'queue', target: 'agent' },
    { id: 'a31', source: 'agent', sourceHandle: 'run', target: 'agent-loop' },
    { id: 'a31b', source: 'agent', sourceHandle: 'steer', target: 'queue-end' },
    { id: 'a32', source: 'agent-loop', sourceHandle: 'final', target: 'stream' },
    { id: 'a32b', source: 'agent-loop', sourceHandle: 'tool', target: 'tool-invoke' },
    { id: 'a33', source: 'tool-invoke', target: 'agent-loop', variant: 'loop', label: 'feed result back' },
    { id: 'a34', source: 'stream', target: 'deliver' },
    { id: 'a35', source: 'deliver', target: 'terminal-react' },
    { id: 'a35p', source: 'deliver', target: 'ledger', variant: 'parallel' },
    { id: 'a36', source: 'terminal-react', target: 'clear-history' },
    { id: 'a37', source: 'clear-history', target: 'end' },
  ],
};

// ── Flow 2: Flow trigger execution (LangGraph runner) ─────────────────────────
const flowTriggerExecution: MasterFlow = {
  id: 'flow-trigger-execution',
  name: 'Flow trigger execution',
  description:
    'The GENERIC mechanism: an inbound message (or a schedule tick) matches a registered trigger, the gateway fires a best-effort POST to the LangGraph runner, which fetches, validates, compiles and invokes the flow — then optionally delivers the reply. Plus the full palette of node types a compiled flow can contain.',
  tags: ['flows', 'langgraph', 'runner', 'palette'],
  nodes: [
    // ── Generic trigger → run → deliver spine ──
    { id: 'inbound', kind: 'channel', title: 'Inbound message', subtitle: 'fireMessageInbound() · decoupled from agent dispatch', position: at(0) },
    { id: 'hook', kind: 'hook', title: 'Emit message:received', subtitle: 'fireInboundTriggerHook · skip bot · synthetic sessionKey', position: at(1) },
    { id: 'plugin-gate', kind: 'guard', title: 'Flows plugin enabled?', subtitle: 'soft switch entries.flows.config.enabled (default on)', position: at(2), branches: [{ id: 'on', label: 'Enabled' }, { id: 'off', label: 'Disabled' }] },
    { id: 'match', kind: 'router', title: 'Match registered triggers', subtitle: 'channel + account + agent filter · triggers.json registry', position: at(3), branches: [{ id: 'yes', label: 'Match' }, { id: 'no', label: 'No match' }] },
    { id: 'extract', kind: 'process', title: 'Extract prompt from event', subtitle: 'message→ctx.content · per-event-key shaping', position: at(4) },
    { id: 'fire', kind: 'process', title: 'POST /flows/run-triggered', subtitle: 'void fireFlow → FLOWS_RUNNER_URL · best-effort, non-blocking', position: at(5) },
    { id: 'loaddef', kind: 'process', title: 'Runner fetches flow def', subtitle: 'GET hub /api/internal/flows/:id · Bearer HUB_API_TOKEN', position: at(6), branches: [{ id: 'ok', label: 'Loaded' }, { id: 'unreachable', label: 'Hub down' }] },
    { id: 'validate', kind: 'guard', title: 'Validate flow shape', subtitle: '1 wired entry · ≥1 processing · reachable · acyclic DAG', position: at(7), branches: [{ id: 'valid', label: 'Valid' }, { id: 'invalid', label: 'Invalid' }] },
    { id: 'compile', kind: 'process', title: 'Compile to StateGraph', subtitle: 'buildNodeRunner per node · conditional edges · seed prompt', position: at(8) },
    { id: 'invoke', kind: 'process', title: 'Invoke graph', subtitle: 'graph.invoke(initialState) · runs node topology', position: at(9) },
    { id: 'reply', kind: 'process', title: 'Take final message', subtitle: 'reply = last message content', position: at(10), branches: [{ id: 'ok', label: 'Reply' }, { id: 'error', label: 'Threw' }] },
    { id: 'deliver', kind: 'channel', title: 'Deliver reply (if flagged)', subtitle: 'reg.deliverResponse + target → deliverOutboundPayloads', position: at(11) },
    { id: 'done', kind: 'end', title: 'Run complete', position: at(12) },

    // ── Alternate entry: scheduler ──
    { id: 'sched-tick', kind: 'schedule', title: 'Scheduler tick fires flow', subtitle: 'flows-scheduler · 60s tick · isDue · empty prompt {scheduled:true}', position: at(5, -2) },

    // ── Generic-mechanism terminals ──
    { id: 'disabled-end', kind: 'end', title: 'Skipped', subtitle: 'flows plugin off', position: at(2, -2) },
    { id: 'ignore-end', kind: 'end', title: 'Ignored', subtitle: 'default agent path handles it', position: at(3, -2) },
    { id: 'unreachable-end', kind: 'end', title: '503 · hub unreachable', position: at(6, -2) },
    { id: 'invalid-end', kind: 'end', title: 'Rejected · invalid shape', position: at(7, -2) },
    { id: 'error-end', kind: 'end', title: '500 · run failed', position: at(10, -2) },

    // ── Executable node palette (reference legend — what a compiled flow can hold) ──
    { id: 'pal-header', kind: 'process', title: '▼ Executable node palette', subtitle: 'reference: node types compile-flow.ts can run', position: at(0, 3) },
    // entry nodes
    { id: 'pal-trigger', kind: 'trigger', title: 'Channel Trigger', subtitle: 'event entry · sources[] channel+account', position: at(2, 3) },
    { id: 'pal-schedule', kind: 'schedule', title: 'Schedule', subtitle: 'interval entry · every/unit · optional atTime', position: at(3, 3) },
    { id: 'pal-promptbox', kind: 'process', title: 'Prompt Box', subtitle: 'manual/test entry · value (override by subflow)', position: at(4, 3) },
    { id: 'pal-plugintrigger', kind: 'trigger', title: 'Plugin Trigger', subtitle: 'plugin event {pluginId,contributionId}', position: at(5, 3) },
    // processing nodes — row 1
    { id: 'pal-llm', kind: 'llm', title: 'LLM Call', subtitle: 'model.invoke · resolveProviderModel(claude-haiku-4-5)', position: at(0, 4) },
    { id: 'pal-agent', kind: 'agent', title: 'Agent Turn', subtitle: 'sendAgentTurn → gateway chat.send RPC', position: at(1, 4) },
    { id: 'pal-toolagent', kind: 'tool-agent', title: 'Tool Agent (ReAct)', subtitle: 'createReactAgent · recursionLimit 10 · INPUT only', position: at(2, 4) },
    { id: 'pal-structured', kind: 'structured', title: 'Structured Output', subtitle: 'withStructuredOutput · JSON schema', position: at(3, 4) },
    { id: 'pal-transform', kind: 'transform', title: 'Transform', subtitle: '{input} template · no model/RPC', position: at(4, 4) },
    { id: 'pal-router', kind: 'router', title: 'Router / Classify', subtitle: 'rule fast-path → LLM rubric (hybrid) · RE2 guarded', position: at(5, 4), branches: [{ id: 'hi', label: 'branch A' }, { id: 'lo', label: 'branch B' }] },
    { id: 'pal-channel', kind: 'channel', title: 'Channel Send', subtitle: 'send RPC · destinations[] · idempotencyKey', position: at(6, 4) },
    // processing nodes — row 2
    { id: 'pal-handoff', kind: 'handoff', title: 'Human Handoff', subtitle: 'flows.relay.open · terminal · see "Human handoff"', position: at(0, 5) },
    { id: 'pal-reaction', kind: 'reaction', title: 'Set Reaction', subtitle: 'flows.reaction.set on trigger msg · transparent', position: at(1, 5) },
    { id: 'pal-subflow', kind: 'subflow', title: 'Subflow', subtitle: 'load→compile→invoke · cycle + depth(8) guards', position: at(2, 5) },
    { id: 'pal-database', kind: 'database', title: 'Database (CRUD)', subtitle: 'read=flows.db.query SELECT · cud=flows.db.exec · confined', position: at(3, 5) },
    { id: 'pal-filewrite', kind: 'file-write', title: 'Write File', subtitle: 'flows.file.write · path-confined · {date} expand', position: at(4, 5) },
    { id: 'pal-pluginaction', kind: 'plugin-action', title: 'Plugin Action', subtitle: 'plugin gateway method · config form · may branch', position: at(5, 5) },
  ],
  edges: [
    { id: 'b1', source: 'inbound', target: 'hook' },
    { id: 'b2', source: 'hook', target: 'plugin-gate' },
    { id: 'b3', source: 'plugin-gate', sourceHandle: 'on', target: 'match' },
    { id: 'b3b', source: 'plugin-gate', sourceHandle: 'off', target: 'disabled-end' },
    { id: 'b4', source: 'match', sourceHandle: 'yes', target: 'extract' },
    { id: 'b4b', source: 'match', sourceHandle: 'no', target: 'ignore-end' },
    { id: 'b5', source: 'extract', target: 'fire' },
    { id: 'b6', source: 'fire', target: 'loaddef' },
    { id: 'b6s', source: 'sched-tick', target: 'loaddef', variant: 'parallel', label: 'schedule entry' },
    { id: 'b7', source: 'loaddef', sourceHandle: 'ok', target: 'validate' },
    { id: 'b7b', source: 'loaddef', sourceHandle: 'unreachable', target: 'unreachable-end' },
    { id: 'b8', source: 'validate', sourceHandle: 'valid', target: 'compile' },
    { id: 'b8b', source: 'validate', sourceHandle: 'invalid', target: 'invalid-end' },
    { id: 'b9', source: 'compile', target: 'invoke' },
    { id: 'b10', source: 'invoke', target: 'reply' },
    { id: 'b11', source: 'reply', sourceHandle: 'ok', target: 'deliver' },
    { id: 'b11b', source: 'reply', sourceHandle: 'error', target: 'error-end' },
    { id: 'b12', source: 'deliver', target: 'done' },
  ],
};

// ── Flow 3: Heartbeat / proactive ─────────────────────────────────────────────
const heartbeatProactive: MasterFlow = {
  id: 'heartbeat-proactive',
  name: 'Heartbeat (proactive)',
  description:
    'The time-based path: an interval/exec/cron/hook wake is coalesced, runs an admission-control preflight (enable, quiet-hours, in-flight, lock, HEARTBEAT.md gate, visibility), then an agent turn whose reply is judged against the HEARTBEAT_OK sentinel — skip (prune transcript) or deliver. Reconstructed from src/infra/heartbeat-*.',
  tags: ['proactive', 'scheduled', 'preflight'],
  nodes: [
    // ── Wake entry variants ──
    { id: 'interval', kind: 'schedule', title: 'Interval scheduler', subtitle: 'DEFAULT_HEARTBEAT_EVERY 30m · per-agent timer', position: at(0) },
    { id: 'exec-wake', kind: 'trigger', title: 'Exec-completion wake', subtitle: 'async bash exit · enqueues system event', position: at(0, -1) },
    { id: 'cron-wake', kind: 'trigger', title: 'Cron-job wake', subtitle: 'cron:<id> · wakeMode now | next-heartbeat', position: at(0, 1) },
    { id: 'hook-wake', kind: 'trigger', title: 'Hook wake', subtitle: 'hook:wake / hook:<job> · priority ACTION', position: at(0, 2) },

    // ── Coalesce + admission control ──
    { id: 'coalesce', kind: 'coalesce', title: 'Coalesce + prioritize', subtitle: 'dedupe agent::session · 250ms · RETRY<INTERVAL<DEFAULT<ACTION', position: at(1) },
    { id: 'wake-timer', kind: 'process', title: 'Wake timer + run-lock', subtitle: 'single timer · serialize running · 1s retry on busy', position: at(2) },
    { id: 'dispatch', kind: 'process', title: 'Runner dispatch', subtitle: 'targeted vs fan-out · interval respects nextDue', position: at(3) },
    { id: 'enable-gate', kind: 'guard', title: 'Enable gate', subtitle: 'heartbeatsEnabled · per-agent · intervalMs!=null', position: at(4), branches: [{ id: 'pass', label: 'Enabled' }, { id: 'skip', label: 'Disabled' }] },
    { id: 'active-hours', kind: 'guard', title: 'Active-hours window', subtitle: 'activeHours{start,end,tz} · wraps midnight', position: at(5), branches: [{ id: 'pass', label: 'In window' }, { id: 'skip', label: 'Quiet hours' }] },
    { id: 'inflight', kind: 'guard', title: 'In-flight queue gate', subtitle: 'Main lane queue>0 → requeue + retry 1s', position: at(6), branches: [{ id: 'pass', label: 'Idle' }, { id: 'skip', label: 'Busy' }] },
    { id: 'lock', kind: 'guard', title: 'Per-agent lock', subtitle: 'agentsInProgress set · released in finally', position: at(7), branches: [{ id: 'pass', label: 'Free' }, { id: 'skip', label: 'Running' }] },
    { id: 'reason', kind: 'process', title: 'Classify reason', subtitle: 'exec-event / cron / wake / hook', position: at(8) },
    { id: 'session', kind: 'session', title: 'Resolve session', subtitle: 'scope global/per-sender · forced alias main/global', position: at(9) },
    { id: 'peek-events', kind: 'process', title: 'Peek pending events', subtitle: 'in-memory system events (≤20) · detect cron-tagged', position: at(10) },
    { id: 'file-gate', kind: 'guard', title: 'HEARTBEAT.md gate', subtitle: 'read workspace file · empty/missing → skip unless exec/cron/wake/hook', position: at(11), branches: [{ id: 'pass', label: 'Content / bypass' }, { id: 'skip', label: 'Empty / missing' }] },
    { id: 'target', kind: 'channel', title: 'Resolve delivery target', subtitle: "heartbeat.target 'last' · channel/to/accountId", position: at(12), branches: [{ id: 'ok', label: 'Has target' }, { id: 'none', label: 'None' }] },
    { id: 'visibility', kind: 'guard', title: 'Visibility resolve', subtitle: 'showOk:false showAlerts:true useIndicator:true', position: at(13), branches: [{ id: 'pass', label: 'Visible' }, { id: 'skip', label: 'All off' }] },

    // ── Prompt + agent turn ──
    { id: 'prompt-sel', kind: 'process', title: 'Select prompt', subtitle: 'exec→EXEC_EVENT · cron→buildCronEvent · else HEARTBEAT_PROMPT', position: at(14) },
    { id: 'time-inject', kind: 'process', title: 'Time + context inject', subtitle: 'appendCurrentTimeLine · prior session-log (≤20, gated)', position: at(15) },
    { id: 'capture-size', kind: 'session', title: 'Capture transcript size', subtitle: 'stat file pre-run for later prune', position: at(16) },
    { id: 'turn', kind: 'agent', title: 'Agent turn (heartbeat)', subtitle: 'getReplyFromConfig isHeartbeat:true · heartbeat.model override', position: at(17), branches: [{ id: 'final', label: 'Final' }, { id: 'tool', label: 'Tool call' }] },
    { id: 'tool-loop', kind: 'tool', title: 'Tool loop + event drain', subtitle: 'same loop as normal · drains system events · may read HEARTBEAT.md', position: at(17, 2) },

    // ── Sentinel + outcome ──
    { id: 'sentinel', kind: 'router', title: 'Sentinel evaluation', subtitle: 'stripHeartbeatToken HEARTBEAT_OK · skip if empty or ≤ackMaxChars(300)', position: at(18), branches: [{ id: 'send', label: 'Has message' }, { id: 'ack', label: 'OK / ack' }] },
    { id: 'dup-check', kind: 'router', title: 'Duplicate suppression', subtitle: 'same text <24h → skip', position: at(19), branches: [{ id: 'new', label: 'New' }, { id: 'dup', label: 'Duplicate' }] },
    { id: 'readiness', kind: 'guard', title: 'Delivery readiness', subtitle: 'channel/to set · showAlerts · plugin checkReady', position: at(20), branches: [{ id: 'ready', label: 'Ready' }, { id: 'notready', label: 'Not ready' }] },
    { id: 'deliver', kind: 'channel', title: 'Deliver proactive message', subtitle: 'deliverOutboundPayloads · record lastHeartbeatText/At', position: at(21) },
    { id: 'prune', kind: 'session', title: 'Prune + restore (skip)', subtitle: 'truncate transcript · restore updatedAt', position: at(20, 2) },
    { id: 'emit', kind: 'memory', title: 'Emit event + log', subtitle: 'status sent/ok-empty/ok-token/skipped/failed · unified store', position: at(22) },
    { id: 'hb-end', kind: 'end', title: 'Done', position: at(23) },

    // ── Skip terminals ──
    { id: 'skip-disabled', kind: 'end', title: 'Skipped · disabled', position: at(4, -2) },
    { id: 'skip-quiet', kind: 'end', title: 'Skipped · quiet-hours', position: at(5, -2) },
    { id: 'skip-inflight', kind: 'end', title: 'Requeued · in-flight', position: at(6, -2) },
    { id: 'skip-inprogress', kind: 'end', title: 'Skipped · already running', position: at(7, -2) },
    { id: 'skip-file', kind: 'end', title: 'Skipped · empty/no HEARTBEAT.md', position: at(11, -2) },
    { id: 'skip-target', kind: 'end', title: 'No-op · no target', position: at(12, -2) },
    { id: 'skip-alertsoff', kind: 'end', title: 'Skipped · alerts off', position: at(13, -2) },
    { id: 'skip-readiness', kind: 'end', title: 'Skipped · not ready', position: at(20, -2) },
  ],
  edges: [
    { id: 'c0a', source: 'interval', target: 'coalesce' },
    { id: 'c0b', source: 'exec-wake', target: 'coalesce' },
    { id: 'c0c', source: 'cron-wake', target: 'coalesce' },
    { id: 'c0d', source: 'hook-wake', target: 'coalesce' },
    { id: 'c1', source: 'coalesce', target: 'wake-timer' },
    { id: 'c2', source: 'wake-timer', target: 'dispatch' },
    { id: 'c3', source: 'dispatch', target: 'enable-gate' },
    { id: 'c4', source: 'enable-gate', sourceHandle: 'pass', target: 'active-hours' },
    { id: 'c4s', source: 'enable-gate', sourceHandle: 'skip', target: 'skip-disabled' },
    { id: 'c5', source: 'active-hours', sourceHandle: 'pass', target: 'inflight' },
    { id: 'c5s', source: 'active-hours', sourceHandle: 'skip', target: 'skip-quiet' },
    { id: 'c6', source: 'inflight', sourceHandle: 'pass', target: 'lock' },
    { id: 'c6s', source: 'inflight', sourceHandle: 'skip', target: 'skip-inflight' },
    { id: 'c6r', source: 'inflight', sourceHandle: 'skip', target: 'coalesce', variant: 'loop', label: 'retry 1s' },
    { id: 'c7', source: 'lock', sourceHandle: 'pass', target: 'reason' },
    { id: 'c7s', source: 'lock', sourceHandle: 'skip', target: 'skip-inprogress' },
    { id: 'c8', source: 'reason', target: 'session' },
    { id: 'c9', source: 'session', target: 'peek-events' },
    { id: 'c10', source: 'peek-events', target: 'file-gate' },
    { id: 'c11', source: 'file-gate', sourceHandle: 'pass', target: 'target' },
    { id: 'c11s', source: 'file-gate', sourceHandle: 'skip', target: 'skip-file' },
    { id: 'c12', source: 'target', sourceHandle: 'ok', target: 'visibility' },
    { id: 'c12s', source: 'target', sourceHandle: 'none', target: 'skip-target' },
    { id: 'c13', source: 'visibility', sourceHandle: 'pass', target: 'prompt-sel' },
    { id: 'c13s', source: 'visibility', sourceHandle: 'skip', target: 'skip-alertsoff' },
    { id: 'c14', source: 'prompt-sel', target: 'time-inject' },
    { id: 'c15', source: 'time-inject', target: 'capture-size' },
    { id: 'c16', source: 'capture-size', target: 'turn' },
    { id: 'c17', source: 'turn', sourceHandle: 'final', target: 'sentinel' },
    { id: 'c17t', source: 'turn', sourceHandle: 'tool', target: 'tool-loop' },
    { id: 'c17l', source: 'tool-loop', target: 'turn', variant: 'loop', label: 'feed result back' },
    { id: 'c18', source: 'sentinel', sourceHandle: 'send', target: 'dup-check' },
    { id: 'c18a', source: 'sentinel', sourceHandle: 'ack', target: 'prune' },
    { id: 'c19', source: 'dup-check', sourceHandle: 'new', target: 'readiness' },
    { id: 'c19d', source: 'dup-check', sourceHandle: 'dup', target: 'prune' },
    { id: 'c20', source: 'readiness', sourceHandle: 'ready', target: 'deliver' },
    { id: 'c20s', source: 'readiness', sourceHandle: 'notready', target: 'skip-readiness' },
    { id: 'c21', source: 'deliver', target: 'emit' },
    { id: 'c21p', source: 'prune', target: 'emit', variant: 'parallel' },
    { id: 'c22', source: 'emit', target: 'hb-end' },
  ],
};

// ── Flow 4: Human handoff / relay ─────────────────────────────────────────────
const humanHandoffRelay: MasterFlow = {
  id: 'human-handoff-relay',
  name: 'Human handoff & relay',
  description:
    'The triage path: a flow Handoff node opens a relay session, owners are alerted (📥), the agent is silenced by a screen-window while client messages buffer, an owner claims by quote-replying (💬), then the gateway relays human ↔ human (💬) until /end (✅). Reconstructed from extensions/flows/src/relay/*. Emojis shown are the live WhatsApp set; Telegram falls back to 👀/🫡/✍️/👍.',
  tags: ['handoff', 'triage', 'reactions', 'relay'],
  nodes: [
    { id: 'handoff-fire', kind: 'handoff', title: 'Handoff node fires', subtitle: 'flows.relay.open · origin + destinations + suggestionCount(3)', position: at(0) },
    { id: 'idem', kind: 'guard', title: 'Idempotency check', subtitle: 'findActiveByOrigin · non-closed session → reuse', position: at(1), branches: [{ id: 'open', label: 'New' }, { id: 'reused', label: 'Already open' }] },
    { id: 'suggest', kind: 'llm', title: 'Generate suggestions', subtitle: 'drone claude-haiku-4-5 · structured {replies} · 3 · best-effort []', position: at(2) },
    { id: 'create', kind: 'session', title: 'Create RelaySession', subtitle: 'status=pending · relay.db · expires NEVER (windowMs 0)', position: at(3) },
    { id: 'alert', kind: 'channel', title: 'Alert each owner', subtitle: '🔔 [priority] complaint + claim/end instructions · capture messageId', position: at(4), branches: [{ id: 'delivered', label: '≥1 alerted' }, { id: 'rollback', label: '0 reached' }] },
    { id: 'react-unattended', kind: 'reaction', title: 'React 📥 unattended', subtitle: 'RELAY_REACTIONS.unattended · 📥 WhatsApp / 👀 Telegram · fromMe:true', position: at(5) },
    { id: 'pending', kind: 'session', title: 'Awaiting claim (pending)', subtitle: 'owner must quote-reply an alert to claim', position: at(6) },

    // ── Concurrent: AI screen-window + pre-claim buffer ──
    { id: 'screen', kind: 'intercept', title: 'Screen-window (AI silencing)', subtitle: 'message_intercept busy-wait ≤6000ms · none/low time out → agent', position: at(5, 2), branches: [{ id: 'opened', label: 'Relay open' }, { id: 'timeout', label: 'none/low' }] },
    { id: 'agent-reply-end', kind: 'end', title: 'Agent replies', subtitle: 'low-severity — no human needed', position: at(5, 3) },
    { id: 'buffer', kind: 'buffer', title: 'Pre-claim client buffer', subtitle: 'relay_buffer FIFO · suppress AI (handled:true) · flush on claim', position: at(6, 2) },

    // ── Owner claim ──
    { id: 'owner-route', kind: 'router', title: 'Owner inbound routing', subtitle: 'resolve via quotedMessageId · parse /end·/claim·1-N·freeform', position: at(7), branches: [{ id: 'claim', label: 'Quoted claim' }, { id: 'agent', label: 'Not a claim' }] },
    { id: 'claim', kind: 'session', title: 'Claim (first-wins)', subtitle: 'atomic UPDATE WHERE status=pending AND claimed_by NULL', position: at(8), branches: [{ id: 'won', label: 'Won' }, { id: 'lost', label: 'Lost race' }] },
    { id: 'react-claimed', kind: 'reaction', title: 'React 💬 claimed', subtitle: 'RELAY_REACTIONS.claimed · 💬 WhatsApp / 🫡 Telegram', position: at(9) },
    { id: 'reveal', kind: 'channel', title: 'Reveal + flush + notify losers', subtitle: 'DM winner suggestions · flush buffer · DM losers "ya tomó"', position: at(10) },

    // ── Relay loop ──
    { id: 'owner-intent', kind: 'router', title: 'Owner message intent', subtitle: '/end · /claim reshow · 1/2/3 preset · freeform', position: at(11), branches: [{ id: 'send', label: 'Preset/custom' }, { id: 'end', label: '/end' }] },
    { id: 'forward-owner', kind: 'channel', title: 'Forward owner → client', subtitle: 'sendToClient origin channel+account · fail → notify owner', position: at(12) },
    { id: 'react-relaying', kind: 'reaction', title: 'React 💬 relaying (1st send)', subtitle: 'claimed→relaying · 💬 / ✍️ Telegram · then touch only', position: at(13) },
    { id: 'forward-client', kind: 'channel', title: 'Forward client → owner', subtitle: "sendToOwner owner channel+account · cross-channel safe · '💬 '", position: at(13, 2) },
    { id: 'close', kind: 'session', title: '/end close', subtitle: 'relaying→closed · react ✅ · closing_message to client · DM owner', position: at(14) },
    { id: 'closed', kind: 'end', title: 'Closed', position: at(15) },

    // ── Idle sweep (only if windowMs>0) ──
    { id: 'sweep', kind: 'schedule', title: 'Idle sweep (5-min)', subtitle: 'sweepExpired · only if windowMs>0 · close + ✅ + closing msg', position: at(14, 2) },

    // ── Terminals ──
    { id: 'reused-end', kind: 'end', title: 'No-op · already open', position: at(1, -2) },
    { id: 'rollback-end', kind: 'end', title: 'Rolled back · no owner reached', position: at(4, -2) },
    { id: 'agent-fallthrough-end', kind: 'end', title: 'Falls to agent', subtitle: 'bare text — not a claim', position: at(7, -2) },
    { id: 'lost-end', kind: 'end', title: 'Race lost · swallowed', position: at(8, -2) },
  ],
  edges: [
    { id: 'd1', source: 'handoff-fire', target: 'idem' },
    { id: 'd2', source: 'idem', sourceHandle: 'open', target: 'suggest' },
    { id: 'd2b', source: 'idem', sourceHandle: 'reused', target: 'reused-end' },
    { id: 'd3', source: 'suggest', target: 'create' },
    { id: 'd4', source: 'create', target: 'alert' },
    { id: 'd5', source: 'alert', sourceHandle: 'delivered', target: 'react-unattended' },
    { id: 'd5b', source: 'alert', sourceHandle: 'rollback', target: 'rollback-end' },
    { id: 'd6', source: 'react-unattended', target: 'pending' },
    { id: 'd6s', source: 'react-unattended', target: 'screen', variant: 'parallel' },
    { id: 'd6u', source: 'react-unattended', target: 'buffer', variant: 'parallel' },
    { id: 'd7t', source: 'screen', sourceHandle: 'timeout', target: 'agent-reply-end' },
    { id: 'd7o', source: 'screen', sourceHandle: 'opened', target: 'owner-route', variant: 'parallel' },
    { id: 'd7f', source: 'buffer', target: 'reveal', variant: 'parallel', label: 'flush on claim' },
    { id: 'd8', source: 'pending', target: 'owner-route' },
    { id: 'd9', source: 'owner-route', sourceHandle: 'claim', target: 'claim' },
    { id: 'd9b', source: 'owner-route', sourceHandle: 'agent', target: 'agent-fallthrough-end' },
    { id: 'd10', source: 'claim', sourceHandle: 'won', target: 'react-claimed' },
    { id: 'd10b', source: 'claim', sourceHandle: 'lost', target: 'lost-end' },
    { id: 'd11', source: 'react-claimed', target: 'reveal' },
    { id: 'd12', source: 'reveal', target: 'owner-intent' },
    { id: 'd13', source: 'owner-intent', sourceHandle: 'send', target: 'forward-owner' },
    { id: 'd13b', source: 'owner-intent', sourceHandle: 'end', target: 'close' },
    { id: 'd14', source: 'forward-owner', target: 'react-relaying' },
    { id: 'd15', source: 'react-relaying', target: 'owner-intent', variant: 'loop', label: 'keep relaying' },
    { id: 'd15c', source: 'react-relaying', target: 'forward-client', variant: 'parallel', label: 'client replies' },
    { id: 'd16', source: 'forward-client', target: 'owner-intent', variant: 'loop' },
    { id: 'd17', source: 'close', target: 'closed' },
    { id: 'd18', source: 'sweep', target: 'close', variant: 'parallel', label: 'windowMs>0 idle' },
  ],
};

export const MASTER_FLOWS: MasterFlow[] = [
  channelMessageReply,
  flowTriggerExecution,
  heartbeatProactive,
  humanHandoffRelay,
];

// ── Representative per-autonomous-agent flows ────────────────────────────────
// Read-only diagrams of what each system agent actually does. Resolvable via
// /flow-editor/master/<id> but intentionally NOT in MASTER_FLOWS (so they don't
// clutter the master-flows roster). True to the real implementation.
const remindersAgentFlow: MasterFlow = {
  id: 'agent-reminders',
  name: 'Reminders agent',
  description:
    'How the Reminders autonomous agent works: an external cron tick scans upcoming bookings, finds due reminder stages (confirmation / 24h / 2h), composes a personalized Spanish WhatsApp message, sends it via the gateway, and mirrors it into the CRM messages ledger. Reconstructed from the hub reminders service.',
  tags: ['autonomous', 'scheduling', 'whatsapp'],
  nodes: [
    { id: 'tick', kind: 'schedule', title: 'Cron tick (every minute)', subtitle: 'external scheduler → /api/scheduling/reminders/tick (CRON_SECRET)', position: at(0) },
    { id: 'enabled', kind: 'guard', title: 'Reminders enabled for org?', subtitle: 'sched_reminder_config.enabled · else skip', position: at(1), branches: [{ id: 'on', label: 'Enabled' }, { id: 'off', label: 'Disabled' }] },
    { id: 'due', kind: 'process', title: 'Find due stages', subtitle: '60-day booking horizon · dueStages(confirmation/24h/2h) · claim-first dedupe', position: at(2) },
    { id: 'optout', kind: 'guard', title: 'Recipient opted out?', subtitle: 'crm_contacts.custom_fields._reminders_opt_out', position: at(3), branches: [{ id: 'ok', label: 'OK' }, { id: 'skip', label: 'Opted out' }] },
    { id: 'compose', kind: 'llm', title: 'Compose reminder (LLM)', subtitle: 'OpenRouter · personalized Spanish · template fallback', position: at(4) },
    { id: 'send', kind: 'channel', title: 'Send WhatsApp', subtitle: "gatewayCall('channels.send') · idempotencyKey rem-{booking}-{stage}", position: at(5) },
    { id: 'ledger', kind: 'memory', title: 'Mirror to messages ledger', subtitle: 'insertMessages → shows in CRM timeline', position: at(6) },
    { id: 'done', kind: 'end', title: 'Recorded', subtitle: 'sched_reminders row: sent / failed / skipped', position: at(7), exports: [
      { key: 'reminders.sent', type: 'int', label: 'Sent', description: 'Number of reminders sent successfully', sample: 42 },
      { key: 'reminders.failed', type: 'int', label: 'Failed', description: 'Number of reminders that failed to send', sample: 1 },
      { key: 'reminders.skipped', type: 'int', label: 'Skipped', description: 'Number of reminders skipped (opted out)', sample: 7 },
    ] },
    { id: 'skip-disabled', kind: 'end', title: 'Skipped', subtitle: 'reminders disabled for org', position: at(1, -2) },
    { id: 'skip-optout', kind: 'end', title: 'Skipped', subtitle: 'recipient opted out', position: at(3, -2) },
  ],
  edges: [
    { id: 'e-tick-enabled', source: 'tick', target: 'enabled' },
    { id: 'e-enabled-on', source: 'enabled', sourceHandle: 'on', target: 'due' },
    { id: 'e-enabled-off', source: 'enabled', sourceHandle: 'off', target: 'skip-disabled' },
    { id: 'e-due-optout', source: 'due', target: 'optout' },
    { id: 'e-optout-ok', source: 'optout', sourceHandle: 'ok', target: 'compose' },
    { id: 'e-optout-skip', source: 'optout', sourceHandle: 'skip', target: 'skip-optout' },
    { id: 'e-compose-send', source: 'compose', target: 'send' },
    { id: 'e-send-ledger', source: 'send', target: 'ledger' },
    { id: 'e-ledger-done', source: 'ledger', target: 'done' },
  ],
};

const alertWatcherAgentFlow: MasterFlow = {
  id: 'agent-alert-watcher',
  name: 'Alert Watcher (Triage)',
  description:
    'How the Alert Watcher triage agent works: it intercepts every inbound channel message, classifies it with one LLM call into is_complaint/severity/category, and for real complaints fans out an alert to the owner channels and opens a claimable handoff. Non-complaints take no edge and fall through to the normal agent loop. Runs in the gateway.',
  tags: ['autonomous', 'triage', 'gateway'],
  nodes: [
    { id: 'inbound', kind: 'trigger', title: 'Inbound message', subtitle: 'every channel message (message_inbound/received hook)', position: at(0) },
    { id: 'gate', kind: 'guard', title: 'Dedup + cooldown', subtitle: 'ring-LRU dedup · per-chat cooldown (escalation-aware)', position: at(1), branches: [{ id: 'pass', label: 'Pass' }, { id: 'drop', label: 'Suppressed' }] },
    { id: 'classify', kind: 'llm', title: 'Classify (LLM)', subtitle: 'haiku · {is_complaint, severity, category, summary}', position: at(2) },
    { id: 'route', kind: 'router', title: 'Severity router', subtitle: 'high / med / low / none', position: at(3), branches: [{ id: 'high', label: 'high' }, { id: 'med', label: 'med' }, { id: 'low', label: 'low' }, { id: 'none', label: 'none' }], exports: [
      { key: 'triage.counts.total', type: 'int', label: 'Total alerts', description: 'Total number of messages triaged', sample: 12 },
      { key: 'triage.counts.high', type: 'int', label: 'High severity', description: 'Number of high-severity complaints', sample: 3 },
    ] },
    { id: 'alert', kind: 'channel', title: 'Fan out alert', subtitle: 'parallel send to owner destinations · delivery-tracked', position: at(4) },
    { id: 'handoff', kind: 'intercept', title: 'Claimable handoff', subtitle: 'first-reply-wins · owner reply → forwarded to customer', position: at(5), exports: [
      { key: 'triage.recent', type: 'list', label: 'Recent alerts', description: 'Recent handoffs opened for this chat', sample: [] },
    ] },
    { id: 'ignore', kind: 'end', title: 'Normal agent loop', subtitle: 'not a complaint → no edge → conversational agent replies', position: at(3, -2) },
    { id: 'done', kind: 'end', title: 'Logged', subtitle: 'alerts.db complaint row + pending_reply', position: at(6) },
  ],
  edges: [
    { id: 'e-in-gate', source: 'inbound', target: 'gate' },
    { id: 'e-gate-classify', source: 'gate', sourceHandle: 'pass', target: 'classify' },
    { id: 'e-classify-route', source: 'classify', target: 'route' },
    { id: 'e-route-high', source: 'route', sourceHandle: 'high', target: 'alert' },
    { id: 'e-route-med', source: 'route', sourceHandle: 'med', target: 'alert' },
    { id: 'e-route-low', source: 'route', sourceHandle: 'low', target: 'alert' },
    { id: 'e-route-none', source: 'route', sourceHandle: 'none', target: 'ignore' },
    { id: 'e-alert-handoff', source: 'alert', target: 'handoff' },
    { id: 'e-handoff-done', source: 'handoff', target: 'done' },
  ],
};

const artifactBuilderFlow: MasterFlow = {
  id: 'agent-artifact-builder',
  name: 'Artifact Builder',
  description:
    'How the Artifact Builder admin-only agent works: an admin request triggers variable schema assembly, an LLM generates the full artifact bundle, a guard validates and self-repairs the output, and the result is stored as an org-scoped agent_artifact.',
  tags: ['autonomous', 'artifacts', 'admin'],
  nodes: [
    { id: 'request', kind: 'trigger', title: 'Admin requests an artifact', subtitle: 'Admin selects agent + requests a custom dashboard build', position: at(0) },
    { id: 'schema', kind: 'process', title: "Assemble the agent's exported variable schema", subtitle: 'Collect exported variable specs from the agent flow', position: at(1) },
    { id: 'generate', kind: 'llm', title: 'OpenRouter · whole-bundle from the reference', subtitle: 'Generate full artifact HTML/CSS/JS bundle via LLM', position: at(2) },
    { id: 'repair', kind: 'guard', title: 'Validate + self-repair retry', subtitle: 'Schema-validate output; branch pass or fail for retry', position: at(3), branches: [{ id: 'pass', label: 'Pass' }, { id: 'fail', label: 'Fail' }] },
    { id: 'store', kind: 'memory', title: 'agent_artifacts (org-scoped)', subtitle: 'Persist artifact to the org-scoped agent_artifacts store', position: at(4) },
    { id: 'done', kind: 'end', title: 'Done', subtitle: 'Artifact available in the agent detail view', position: at(5) },
  ],
  edges: [
    { id: 'ab1', source: 'request', target: 'schema' },
    { id: 'ab2', source: 'schema', target: 'generate' },
    { id: 'ab3', source: 'generate', target: 'repair' },
    { id: 'ab4', source: 'repair', sourceHandle: 'pass', target: 'store' },
    { id: 'ab5', source: 'repair', sourceHandle: 'fail', target: 'generate', variant: 'loop' },
    { id: 'ab6', source: 'store', target: 'done' },
  ],
};

export const AGENT_FLOWS: MasterFlow[] = [remindersAgentFlow, alertWatcherAgentFlow, artifactBuilderFlow];

export function getMasterFlow(id: string): MasterFlow | undefined {
  return MASTER_FLOWS.find((f) => f.id === id) ?? AGENT_FLOWS.find((f) => f.id === id);
}

export function flowExportedSpecs(flow: MasterFlow): VariableSpec[] {
  return flow.nodes.flatMap((n) => n.exports ?? []);
}
