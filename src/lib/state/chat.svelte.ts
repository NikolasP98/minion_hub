import type { AgentChatState, AgentActivityState } from '$lib/types/chat';

export const agentChat = $state({} as Record<string, AgentChatState>);
export const agentActivity = $state({} as Record<string, AgentActivityState>);

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
      sparkBins: new Array(30).fill(0) as number[],
    };
  }
  return agentActivity[agentId];
}
