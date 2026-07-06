import type { AgentChatState, AgentActivityState, ChatMessage } from '$lib/types/chat';

const MAX_CHAT_MESSAGES = 500;
// Only trim once we're meaningfully over the cap, then slice back to the cap in
// one batch. This amortises the O(n) copy across ~100 pushes instead of paying
// it on every push past the cap.
const CHAT_TRIM_AT = Math.ceil(MAX_CHAT_MESSAGES * 1.2);

export const SPARK_BIN_COUNT = 144;
export const SPARK_BIN_MS = 600_000; // 10 minutes

/**
 * Append a message to chat.messages using mutation (avoids full array copy).
 * Trims back to MAX_CHAT_MESSAGES only once length exceeds CHAT_TRIM_AT, so the
 * O(n) copy is amortised instead of paid on every push past the cap.
 */
export function pushChatMessage(chat: AgentChatState, msg: ChatMessage): void {
  chat.messages.push(msg);
  if (chat.messages.length > CHAT_TRIM_AT) {
    chat.messages = chat.messages.slice(-MAX_CHAT_MESSAGES);
  }
}

export const agentChat = $state({} as Record<string, AgentChatState>);
export const agentActivity = $state({} as Record<string, AgentActivityState>);

// ─── Agent-reply notifications ──────────────────────────────────────────────
// Fired when an agent turn reaches its final state AND the freshly reloaded
// history is in place. Lets the voice-call engine speak the reply reliably
// instead of racing the async history reload via reactivity.
type AgentReplyListener = (agentId: string) => void;
const agentReplyListeners = new Set<AgentReplyListener>();

export function onAgentReplyFinal(cb: AgentReplyListener): () => void {
  agentReplyListeners.add(cb);
  return () => agentReplyListeners.delete(cb);
}

export function notifyAgentReplyFinal(agentId: string): void {
  for (const cb of agentReplyListeners) {
    try {
      cb(agentId);
    } catch {
      /* listener errors must not break event handling */
    }
  }
}

const SPARK_STORAGE_KEY = 'minion-spark-data';

// Debounce spark bin saves: accumulate dirty agents and write every 3 seconds.
const sparkDirtyAgents = new Set<string>();
let sparkSaveTimer: ReturnType<typeof setTimeout> | null = null;

function flushSparkSave() {
  sparkSaveTimer = null;
  if (sparkDirtyAgents.size === 0) return;
  try {
    const stored = localStorage.getItem(SPARK_STORAGE_KEY);
    const data = stored ? JSON.parse(stored) : {};
    for (const agentId of sparkDirtyAgents) {
      const bins = agentActivity[agentId]?.sparkBins;
      if (bins) data[agentId] = { bins: [...bins], savedAt: Date.now() };
    }
    localStorage.setItem(SPARK_STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* ignore quota errors */
  }
  sparkDirtyAgents.clear();
}

function loadSparkBins(agentId: string): number[] {
  try {
    const stored = localStorage.getItem(SPARK_STORAGE_KEY);
    if (!stored) return new Array(SPARK_BIN_COUNT).fill(0);
    const data = JSON.parse(stored);
    const entry = data[agentId];
    if (!entry) return new Array(SPARK_BIN_COUNT).fill(0);
    const { bins, savedAt } = entry;
    const now = Date.now();
    const elapsedMs = now - savedAt;
    if (elapsedMs >= 86_400_000) return new Array(SPARK_BIN_COUNT).fill(0);
    const savedBinIdx = Math.floor(savedAt / SPARK_BIN_MS) % SPARK_BIN_COUNT;
    const elapsedBins = Math.floor(elapsedMs / SPARK_BIN_MS);
    const restored = [...bins];
    for (let i = 1; i <= elapsedBins; i++) {
      restored[(savedBinIdx + i) % SPARK_BIN_COUNT] = 0;
    }
    return restored;
  } catch {
    return new Array(SPARK_BIN_COUNT).fill(0);
  }
}

// SQLite dirty map: agentId → Map<binTs, count>
const sqliteDirtyBins = new Map<string, Map<number, number>>();
let sqliteFlushTimer: ReturnType<typeof setInterval> | null = null;
let sqliteServerId: string | null = null;

/** Mark a bin dirty for both localStorage and SQLite flush. */
export function markSparkBinDirty(agentId: string, binTs: number, count: number): void {
  // localStorage debounce
  sparkDirtyAgents.add(agentId);
  if (!sparkSaveTimer) {
    sparkSaveTimer = setTimeout(flushSparkSave, 3000);
  }

  // SQLite dirty map
  let agentBins = sqliteDirtyBins.get(agentId);
  if (!agentBins) {
    agentBins = new Map();
    sqliteDirtyBins.set(agentId, agentBins);
  }
  agentBins.set(binTs, Math.max(agentBins.get(binTs) ?? 0, count));
}

export function startSqliteFlush(serverId: string): void {
  sqliteServerId = serverId;
  stopSqliteFlush();
  sqliteFlushTimer = setInterval(flushToSqlite, 30_000);
}

export function stopSqliteFlush(): void {
  if (sqliteFlushTimer) {
    clearInterval(sqliteFlushTimer);
    sqliteFlushTimer = null;
  }
  sqliteServerId = null;
}

async function flushToSqlite(): Promise<void> {
  if (!sqliteServerId || sqliteDirtyBins.size === 0) return;

  const bins: { agentId: string; binTs: number; count: number }[] = [];
  for (const [agentId, agentBins] of sqliteDirtyBins) {
    for (const [binTs, count] of agentBins) {
      bins.push({ agentId, binTs, count });
    }
  }

  if (bins.length === 0) return;
  sqliteDirtyBins.clear();

  try {
    await fetch(`/api/servers/${sqliteServerId}/activity-bins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bins }),
    });
  } catch {
    /* non-critical */
  }
}

// Tab close/switch drops up to 30s (SQLite) / 3s (localStorage) of activity
// data if we only rely on the interval timers above — flush both paths
// immediately when the page is hidden or being torn down.
function flushSparkBinsNow(): void {
  flushSparkSave();
  void flushToSqlite();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushSparkBinsNow();
  });
  window.addEventListener('pagehide', flushSparkBinsNow);
}

/** Merge activity bins fetched from DB into ring buffer slots that are still 0. */
export function mergeActivityBinsFromDb(
  bins: { agentId: string; binTs: number; count: number }[],
): void {
  for (const { agentId, binTs, count } of bins) {
    const act = agentActivity[agentId];
    if (!act) continue;
    const binIdx = Math.floor(binTs / SPARK_BIN_MS) % SPARK_BIN_COUNT;
    if (act.sparkBins[binIdx] === 0) {
      act.sparkBins[binIdx] = count;
    }
  }
}

export function ensureAgentChat(agentId: string): AgentChatState {
  if (!agentChat[agentId]) {
    agentChat[agentId] = {
      messages: [],
      stream: null,
      streamMessage: null,
      streamDisplay: '',
      runId: null,
      sending: false,
      loading: false,
      inputText: '',
      lastError: null,
    };
  }
  return agentChat[agentId];
}

// ─── Streaming text smoother (typewriter reveal) ───────────────────────────
// The gateway sends coarse, throttled deltas. To make streaming feel smooth
// regardless of provider chunking, we reveal the answer text progressively with
// an ease-out rate via requestAnimationFrame. `streamMessage` (reasoning + tool
// blocks) shows immediately; only the answer TEXT is smoothed. On `final` we
// keep revealing until the buffer is fully shown, THEN commit the message — so
// the streamed text and the committed message never disagree (no jump).

interface Smoother {
  target: string;
  shown: number;
  timer: ReturnType<typeof setTimeout> | null;
  pendingFinal: { msg: ChatMessage; onDone: () => void } | null;
}
const smoothers = new Map<string, Smoother>();

// ~60fps reveal. setTimeout (not requestAnimationFrame) on purpose: rAF is
// fully PAUSED in background/unfocused tabs, which would freeze the reveal AND
// stall the final commit until the tab regains focus. setTimeout only throttles
// in the background, so the stream still progresses and always commits.
const SMOOTH_INTERVAL_MS = 16;

/** Concatenated answer text (text blocks only) of an assistant message. */
function answerText(msg: ChatMessage | null | undefined): string {
  if (!msg) return '';
  const c = msg.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  let out = '';
  for (const b of c) {
    const bb = b as { type?: string; text?: string };
    if (bb?.type === 'text' && typeof bb.text === 'string') out += bb.text;
  }
  return out;
}

function timersAvailable(): boolean {
  return typeof window !== 'undefined';
}

/** Finalise a run that has fully revealed: commit the message and clear stream. */
function commitPending(agentId: string, chat: AgentChatState, s: Smoother): void {
  const pending = s.pendingFinal;
  if (!pending) return;
  pushChatMessage(chat, pending.msg as never);
  chat.streamDisplay = '';
  chat.streamMessage = null;
  chat.stream = null;
  smoothers.delete(agentId);
  pending.onDone();
}

function stepSmoother(agentId: string): void {
  const chat = agentChat[agentId];
  const s = smoothers.get(agentId);
  if (!chat || !s) return;
  s.timer = null;
  if (s.shown < s.target.length) {
    const remaining = s.target.length - s.shown;
    // Ease-out: bigger jumps reveal faster, but a min so short text still moves.
    s.shown = Math.min(s.target.length, s.shown + Math.max(2, Math.ceil(remaining * 0.08)));
    chat.streamDisplay = s.target.slice(0, s.shown);
  }
  if (s.shown >= s.target.length) {
    if (s.pendingFinal) {
      commitPending(agentId, chat, s);
      return;
    }
    // Caught up to the current buffer — pause; a later feed will resume.
    return;
  }
  s.timer = setTimeout(() => stepSmoother(agentId), SMOOTH_INTERVAL_MS);
}

function ensureRunning(agentId: string): void {
  const s = smoothers.get(agentId);
  if (!s || s.timer != null) return;
  if (!timersAvailable()) {
    // No DOM (SSR/tests): jump straight to the end so nothing is lost.
    const chat = agentChat[agentId];
    if (!chat) return;
    s.shown = s.target.length;
    chat.streamDisplay = s.target;
    if (s.pendingFinal) commitPending(agentId, chat, s);
    return;
  }
  s.timer = setTimeout(() => stepSmoother(agentId), SMOOTH_INTERVAL_MS);
}

/** Feed a streaming delta: show its meta blocks now, smooth-reveal its text. */
export function feedStreamMessage(agentId: string, message: ChatMessage | null): void {
  const chat = ensureAgentChat(agentId);
  chat.streamMessage = message;
  const text = answerText(message);
  let s = smoothers.get(agentId);
  if (!s) {
    s = { target: '', shown: 0, timer: null, pendingFinal: null };
    smoothers.set(agentId, s);
  }
  // New run or a shorter buffer (rare) → restart the reveal.
  if (text.length < s.shown) {
    s.shown = 0;
    chat.streamDisplay = '';
  }
  s.target = text;
  ensureRunning(agentId);
}

/** Finish a run: keep revealing to the end of `finalMsg`, then commit it. */
export function finishStreamMessage(
  agentId: string,
  finalMsg: ChatMessage,
  onDone: () => void,
): void {
  const chat = ensureAgentChat(agentId);
  let s = smoothers.get(agentId);
  const finalText = answerText(finalMsg);
  if (!s) {
    s = { target: '', shown: 0, timer: null, pendingFinal: null };
    smoothers.set(agentId, s);
  }
  // Show the final message's meta (reasoning/tools) during the reveal.
  chat.streamMessage = finalMsg;
  if (finalText.length < s.shown) s.shown = 0;
  s.target = finalText;
  s.pendingFinal = { msg: finalMsg, onDone };
  ensureRunning(agentId);
}

/** Abort/error: stop the smoother and clear the display. */
export function cancelStreamText(agentId: string): void {
  const s = smoothers.get(agentId);
  if (s?.timer != null) clearTimeout(s.timer);
  smoothers.delete(agentId);
  const chat = agentChat[agentId];
  if (chat) chat.streamDisplay = '';
}

export function ensureAgentActivity(agentId: string): AgentActivityState {
  if (!agentActivity[agentId]) {
    agentActivity[agentId] = {
      working: false,
      lastEventAt: 0,
      sparkBins: loadSparkBins(agentId) as number[],
    };
  }
  return agentActivity[agentId];
}
