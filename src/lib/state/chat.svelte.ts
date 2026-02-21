import type { AgentChatState, AgentActivityState } from '$lib/types/chat';

export const agentChat = $state({} as Record<string, AgentChatState>);
export const agentActivity = $state({} as Record<string, AgentActivityState>);

const SPARK_STORAGE_KEY = 'minion-spark-data';

function loadSparkBins(agentId: string): number[] {
  try {
    const stored = localStorage.getItem(SPARK_STORAGE_KEY);
    if (!stored) return new Array(30).fill(0);
    const data = JSON.parse(stored);
    const entry = data[agentId];
    if (!entry) return new Array(30).fill(0);
    const { bins, savedAt } = entry;
    const now = Date.now();
    const elapsedMs = now - savedAt;
    if (elapsedMs >= 300_000) return new Array(30).fill(0);
    const savedBinIdx = Math.floor(savedAt / 10000) % 30;
    const elapsedBins = Math.floor(elapsedMs / 10000);
    const restored = [...bins];
    for (let i = 1; i <= elapsedBins; i++) {
      restored[(savedBinIdx + i) % 30] = 0;
    }
    return restored;
  } catch {
    return new Array(30).fill(0);
  }
}

export function saveSparkBins(agentId: string, bins: number[]): void {
  try {
    const stored = localStorage.getItem(SPARK_STORAGE_KEY);
    const data = stored ? JSON.parse(stored) : {};
    data[agentId] = { bins: [...bins], savedAt: Date.now() };
    localStorage.setItem(SPARK_STORAGE_KEY, JSON.stringify(data));
  } catch { /* ignore quota errors */ }
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
