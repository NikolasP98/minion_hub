// Ported from src/gateway/protocol/schema/frames.ts + snapshot.ts

export interface RequestFrame {
  type: 'req';
  id: string;
  method: string;
  params?: unknown;
}

export interface ResponseFrame {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string; details?: unknown; retryable?: boolean };
}

export interface EventFrame {
  type: 'event';
  event: string;
  payload?: unknown;
  seq?: number;
  stateVersion?: StateVersion;
}

export type GatewayFrame = RequestFrame | ResponseFrame | EventFrame;

export interface StateVersion {
  presence: number;
  health: number;
}

export interface PresenceEntry {
  host?: string;
  ip?: string;
  version?: string;
  platform?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  mode?: string;
  lastInputSeconds?: number;
  reason?: string;
  tags?: string[];
  text?: string;
  ts: number;
  deviceId?: string;
  roles?: string[];
  scopes?: string[];
  instanceId?: string;
}

export interface SessionDefaults {
  defaultAgentId: string;
  mainKey: string;
  mainSessionKey: string;
  scope?: string;
}

export interface GatewaySnapshot {
  presence: PresenceEntry[];
  health: unknown;
  stateVersion: StateVersion;
  uptimeMs: number;
  configPath?: string;
  stateDir?: string;
  sessionDefaults?: SessionDefaults;
  authMode?: 'none' | 'token' | 'password' | 'trusted-proxy';
}

export interface HelloOk {
  type: 'hello-ok';
  protocol: number;
  server: {
    version: string;
    commit?: string;
    host?: string;
    connId: string;
  };
  features: {
    methods: string[];
    events: string[];
  };
  snapshot: GatewaySnapshot;
  canvasHostUrl?: string;
  auth?: {
    deviceToken: string;
    role: string;
    scopes: string[];
    issuedAtMs?: number;
  };
  policy: {
    maxPayload: number;
    maxBufferedBytes: number;
    tickIntervalMs: number;
  };
}

export interface Agent {
  id: string;
  name?: string;
  emoji?: string;
  description?: string;
  model?: string;
  status?: string;
}

export interface Session {
  sessionKey: string;
  agentId?: string;
  kind?: 'direct' | 'group' | 'global' | 'unknown';
  label?: string;
  displayName?: string;
  channel?: string;
  model?: string;
  status?: string;
  lastActiveAt?: number;
  updatedAt?: number;
  createdAt?: number;
}

// Chat event from gateway
export interface ChatEvent {
  runId: string;
  sessionKey: string;
  seq: number;
  state: 'delta' | 'final' | 'aborted' | 'error';
  message?: unknown;
  errorMessage?: string;
  usage?: unknown;
  stopReason?: string;
}

export interface ShutdownEvent {
  reason: string;
  restartExpectedMs?: number;
}
