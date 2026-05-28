// Shared workshop types (split out of workshop.svelte.ts).

export interface AgentInstance {
  instanceId: string;
  agentId: string;
  position: { x: number; y: number };
  behavior: 'stationary' | 'wander' | 'patrol';
  homePosition: { x: number; y: number };
}

export interface Relationship {
  id: string;
  fromInstanceId: string;
  toInstanceId: string;
  label: string;
}

export interface WorkshopConversation {
  id: string;
  type: 'task' | 'banter';
  participantInstanceIds: string[];
  participantAgentIds: string[];
  sessionKey: string;
  status: 'active' | 'interrupted' | 'completed' | 'queued';
  startedAt: number;
  endedAt?: number;
  title?: string;
  taskPrompt?: string;
  maxTurns?: number;
}

// --- Workshop interactive elements ---

export type ElementType = 'pinboard' | 'messageboard' | 'inbox' | 'rulebook' | 'portal';

export interface PinboardItem {
  id: string;
  content: string;
  pinnedBy: string; // agentId or 'user'
  pinnedAt: number;
  upvotes: string[]; // voter IDs (agentId or 'user')
  downvotes: string[]; // voter IDs
  comments: Array<{ authorId: string; text: string; at: number }>;
}

export type InboxItemStatus = 'open' | 'closed' | 'pending';

export interface InboxAttachment {
  id: string;
  fileName: string;
  contentType: string;
  url: string;
  sizeBytes: number;
}

export interface InboxItem {
  id: string;
  fromId: string; // agentId or 'user'
  toId: string; // agentId or 'user'
  content: string;
  subject: string;
  status: InboxItemStatus;
  sentAt: number;
  read: boolean;
  attachments?: InboxAttachment[];
}

export interface AgentMemory {
  contextSummary: string;
  workspaceNotes: string[]; // from [REMEMBER:] markers, max 10
  recentInteractions: string[]; // "talked to AgentX about Y", max 5
  environmentState: Record<
    string,
    {
      // elementId → last-read info
      summary: string;
      lastReadAt: number;
    }
  >;
  activePinboardItems: string[]; // pin IDs agent has chosen to keep in active context (max 5)
}

export interface WorkshopElement {
  instanceId: string;
  type: ElementType;
  position: { x: number; y: number };
  label: string;
  pinboardItems?: PinboardItem[];
  messageBoardContent?: string;
  inboxAgentId?: string;
  inboxItems?: InboxItem[];
  outboxItems?: InboxItem[];
  rulebookContent?: string;
  portalTargetWorkspaceId?: string;
  portalLabel?: string;
}

export interface WorkshopSettings {
  maxConcurrentConversations: number;
  /** Master killswitch — disables all agent-to-agent conversations when false */
  agentChatsEnabled: boolean;
  idleBanterEnabled: boolean;
  idleBanterBudgetPerHour: number;
  proximityRadius: number;
  /** ms between idle-banter attempt checks */
  banterCheckInterval: number;
  /** ms cooldown between same-pair banters */
  banterCooldown: number;
  /** Max turns for banter conversations */
  banterMaxTurns: number;
  /** Max turns for task conversations */
  taskMaxTurns: number;
  /** ms to wait for agent response */
  responseTimeout: number;
  /** Default prompt for banter conversations */
  banterPrompt: string;
  /** Default prompt for solo tasks */
  taskPrompt: string;
  /** Visual mode: classic (freeform), habbo (isometric), or pixel (pixel art office) */
  viewMode: 'classic' | 'habbo' | 'pixel';
  /** When off, conversations are fully isolated to this workspace */
  crossWorkspaceChats: boolean;
}

export interface WorkshopState {
  camera: { x: number; y: number; zoom: number };
  agents: Record<string, AgentInstance>;
  relationships: Record<string, Relationship>;
  conversations: Record<string, WorkshopConversation>;
  elements: Record<string, WorkshopElement>;
  settings: WorkshopSettings;
}
