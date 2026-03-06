import type { AgentChatState, AgentActivityState, ChatMessage } from '$lib/types/chat';

const MAX_CHAT_MESSAGES = 500;

export const SPARK_BIN_COUNT = 144;
export const SPARK_BIN_MS = 600_000; // 10 minutes

/**
 * Append a message to chat.messages using mutation (avoids full array copy).
 * Trims to MAX_CHAT_MESSAGES if needed.
 */
export function pushChatMessage(chat: AgentChatState, msg: ChatMessage): void {
  chat.messages.push(msg);
  if (chat.messages.length > MAX_CHAT_MESSAGES) {
    chat.messages.splice(0, chat.messages.length - MAX_CHAT_MESSAGES);
  }
}

export const agentChat = $state({} as Record<string, AgentChatState>);
export const agentActivity = $state({} as Record<string, AgentActivityState>);

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
  } catch { /* ignore quota errors */ }
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
  } catch { /* non-critical */ }
}

/** Merge activity bins fetched from DB into ring buffer slots that are still 0. */
export function mergeActivityBinsFromDb(bins: { agentId: string; binTs: number; count: number }[]): void {
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
      runId: null,
      sending: false,
      loading: false,
      inputText: '',
      lastError: null,
    };
  }
  return agentChat[agentId];
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
