export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
  timestamp?: number;
}

export interface AgentChatState {
  messages: ChatMessage[];
  stream: string | null;
  runId: string | null;
  sending: boolean;
  loading: boolean;
  inputText: string;
  lastError: string | null;
}

export interface AgentActivityState {
  working: boolean;
  lastEventAt: number;
  sparkBins: number[]; // length 30
  _workingTimer?: ReturnType<typeof setTimeout>;
}
