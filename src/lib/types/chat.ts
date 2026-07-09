export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
  timestamp?: number;
}

export interface AgentChatState {
  messages: ChatMessage[];
  stream: string | null;
  /**
   * The full partial assistant message from the latest streaming delta — carries
   * content blocks (text / thinking / tool_use) so the UI can show live
   * reasoning and tool activity. Null when no run is streaming.
   */
  streamMessage: ChatMessage | null;
  /**
   * Smoothed (typewriter-revealed) answer text for the in-flight turn. The
   * gateway delivers coarse, throttled deltas (e.g. 3 → 789 chars), so the UI
   * reveals `streamMessage`'s answer text progressively through this field
   * instead of rendering each jump raw. Empty when not streaming.
   */
  streamDisplay: string;
  runId: string | null;
  sending: boolean;
  loading: boolean;
  inputText: string;
  lastError: string | null;
  /**
   * Live tool calls for the in-flight run, fed by gateway `agent` events
   * (stream:'tool', requires the `tool-events` client cap). Cleared on
   * final/abort/error — the reconciled history then carries the real blocks.
   */
  liveTools: LiveToolCall[];
  /** Context-aware status verb ("Reading files…") while the run works. */
  liveActivity: string | null;
}

export interface LiveToolCall {
  id: string;
  name: string;
  input?: unknown;
  result?: string;
  isError?: boolean;
  done: boolean;
}

export interface AgentActivityState {
  working: boolean;
  lastEventAt: number;
  sparkBins: number[]; // length 30
  _workingTimer?: ReturnType<typeof setTimeout>;
}
