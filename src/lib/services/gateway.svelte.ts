import { conn } from '$lib/state/gateway/connection.svelte';
import { dispatchCacheInvalidate } from '$lib/state/cache-invalidate-listener.svelte';
import {
  type DebugStepEvent,
  type DebugStepName,
  pushDebugStepEvent,
  pushDebugStepTimeout,
} from '$lib/state/debug';
import {
  gw,
  upsertSession,
  mergeSessions,
  clearSessions,
} from '$lib/state/gateway/gateway-data.svelte';
import {
  agentChat,
  agentActivity,
  ensureAgentChat,
  ensureAgentActivity,
  markSparkBinDirty,
  mergeActivityBinsFromDb,
  startSqliteFlush,
  stopSqliteFlush,
  pushChatMessage,
  notifyAgentReplyFinal,
  SPARK_BIN_MS,
  SPARK_BIN_COUNT,
} from '$lib/state/chat/chat.svelte';
import {
  hostsState,
  getActiveHost,
  updateHost,
  saveLastActiveHost,
  fetchHostToken,
} from '$lib/state/features/hosts.svelte';
import { userState } from '$lib/state/features/user.svelte';
import { autoSave, resetWorkshop } from '$lib/state/workshop/workshop.svelte';
import { ui } from '$lib/state/ui/ui.svelte';
import { toastError, toastInfo, toastSuccess } from '$lib/state/ui/toast.svelte';
import {
  pushReliabilityEvent,
  type ReliabilityEvent,
} from '$lib/state/reliability/reliability.svelte';
import {
  configState,
  loadConfig,
  restartState,
  onRestartReconnected,
} from '$lib/state/config/config.svelte';
import { extractText } from '$lib/utils/text';
import { loadAgentGroups } from '$lib/state/features/agent-groups.svelte';
import {
  GatewayClient,
  uuid,
  parseAgentSessionKey,
  type HelloOk,
  type ChatEvent,
  type Session,
  type EventFrame,
} from '@minion-stack/shared';
// Internal: event handlers below call loadChatHistory on stream errors. The
// function now lives in the chat-rpc sub-module — function-only cycle, ESM-safe.
import { loadChatHistory } from './gateway/chat-rpc';

// ─── Pi-Agent Notification Preferences ────────────────────────────────────────

type NotificationPrefs = {
  orchestrationStarted: boolean;
  orchestrationCompleted: boolean;
  subagentFailed: boolean;
  showOn: 'homepage' | 'all' | 'never';
};

const DEFAULT_PREFS: NotificationPrefs = {
  orchestrationStarted: true,
  orchestrationCompleted: true,
  subagentFailed: true,
  showOn: 'all',
};

function getNotificationPrefs(): NotificationPrefs {
  try {
    const raw =
      typeof localStorage !== 'undefined' ? localStorage.getItem('minion-hub:notifications') : null;
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULT_PREFS;
}

function shouldShowToast(prefs: NotificationPrefs): boolean {
  if (prefs.showOn === 'never') return false;
  if (prefs.showOn === 'all') return true;
  // 'homepage' — only show on root route
  if (typeof window !== 'undefined') return window.location.pathname === '/';
  return false;
}

/** Map gateway's GatewaySessionRow (key field) to hub's Session (sessionKey field). */
function mapGatewaySessionRows(raw: unknown[]): Session[] {
  return raw
    .filter((r): r is Record<string, unknown> => r != null && typeof r === 'object')
    .map((r) => {
      const key = String(r.key ?? '');
      const parsed = parseAgentSessionKey(key);
      return {
        sessionKey: key,
        agentId: parsed?.agentId,
        kind: r.kind as Session['kind'],
        label: r.label as string | undefined,
        displayName: r.displayName as string | undefined,
        channel: r.channel as string | undefined,
        model: r.model as string | undefined,
        updatedAt: r.updatedAt as number | undefined,
      };
    })
    .filter((s) => s.sessionKey);
}

// Internal state — plain vars, not $state
let client: GatewayClient | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollPresenceTimer: ReturnType<typeof setInterval> | null = null;
// One-shot guard: when the gateway closes with NOT_PAIRED / "device identity
// required", we refetch the token and try exactly once more. A second auth-
// fatal close halts the reconnect loop and surfaces a CTA instead of letting
// the shared client autoReconnect with the same stale credential forever.
let notPairedRefetchAttempted = false;

function isAuthFatalClose(code: number, reason: string): boolean {
  if (code !== 1008) return false;
  return /device identity required|pairing required|not paired/i.test(reason);
}

async function handleAuthFatalClose(reason: string): Promise<void> {
  const hostId = hostsState.activeHostId;
  if (!hostId) return;

  // Tear down the dead client so its autoReconnect timer is cancelled
  // (GatewayClient.close() sets `closed = true`, which short-circuits
  // scheduleReconnect on the way back up the close handler).
  if (client) {
    client.close();
    client = null;
  }

  if (notPairedRefetchAttempted) {
    conn.connectError =
      `Gateway rejected the token (${reason}). Rotate this host's token in Hosts → Edit, then reconnect.`;
    toastError('Authentication failed', conn.connectError, {
      id: 'gateway-not-paired',
      duration: Infinity,
    });
    return;
  }

  notPairedRefetchAttempted = true;
  toastInfo('Refetching gateway token…', 'One retry before giving up', {
    id: 'gateway-token-refetch',
  });
  await wsConnect();
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function wsConnect() {
  const host = getActiveHost();
  if (!host?.url) return;
  conn.closed = false;
  conn.connecting = true;
  conn.particleHue = 'amber';

  gw.lastSeq = null;

  // Close existing client before creating a new one
  if (client) {
    client.close();
    client = null;
  }

  const capturedHostId = hostsState.activeHostId;

  // Fetch the gateway token fresh from the server. The token is NEVER read
  // from localStorage — that's the whole point of this design. If the user
  // isn't authenticated to the hub (401) or the server can't be reached,
  // surface the failure immediately instead of attempting a handshake with
  // a stale/missing token (which fails as a confusing NOT_PAIRED close).
  if (!capturedHostId) {
    conn.connecting = false;
    return;
  }
  const fetched = await fetchHostToken(capturedHostId);
  if (fetched === null) {
    conn.connecting = false;
    conn.particleHue = 'red';
    conn.connectError =
      'Could not load gateway token. Log in to the hub, then try again.';
    toastError(
      'Cannot connect',
      conn.connectError,
      { id: 'gateway-token-unavailable' },
    );
    return;
  }
  const token = fetched.trim();
  const role = 'operator';
  const scopes = [
    'operator.admin',
    'operator.read',
    'operator.write',
    'operator.approvals',
    'operator.pairing',
  ];

  client = new GatewayClient({
    url: host.url,
    autoReconnect: true,

    onOpen() {
      // Wait for connect.challenge event — no action needed here
    },

    async onChallenge(_nonce: string): Promise<Record<string, unknown>> {
      // Control-UI auth model: the shared-secret gateway token (carried in WS
      // upgrade headers + the connect frame's auth path) IS the credential.
      // The real access filter is the hub's user_servers link — only users
      // approved for this host can even fetch the token via POST /api/servers/[id]/token.
      //
      // We DELIBERATELY do not send a `device` field. Sending it would force
      // the gateway into its per-device-pairing branch (message-handler.ts:705),
      // requiring an out-of-band `minion devices approve` for every new hub
      // instance — wrong UX for control-UI clients. The gateway's no-device
      // branch already accepts valid shared-secret auth (canSkipDevice =
      // sharedAuthOk) and that's the correct path for the UI.

      // Carry the Better Auth user id forward so the gateway can scope
      // per-user RPCs (myAgent.feedToday, etc.) to the right tenant. The
      // gateway accepts this claim only when the connection also presents
      // a valid shared-secret token + operator scope — same trust boundary
      // as the secret itself. See `message-handler.ts` proxy-userId block.
      const userId = userState.user?.id;

      return {
        minProtocol: 3,
        maxProtocol: 3,
        client: { id: 'minion-control-ui', version: '1.0', platform: 'web', mode: 'ui' },
        role,
        scopes,
        caps: [],
        auth: token ? { token } : undefined,
        userId,
        userAgent: navigator.userAgent,
        locale: navigator.language,
      };
    },

    onEvent(frame: EventFrame) {
      const seq = typeof frame.seq === 'number' ? frame.seq : null;
      if (seq !== null) {
        if (gw.lastSeq !== null && seq > gw.lastSeq + 1) {
          console.warn('[hub] event gap: expected', gw.lastSeq + 1, 'got', seq);
        }
        gw.lastSeq = seq;
      }
      handleEvent(frame as unknown as Record<string, unknown>);
    },

    onClose(code: number, reason: string) {
      conn.connected = false;
      conn.connecting = false;
      conn.particleHue = 'red';
      // Binary listeners: raw socket is gone, no cleanup needed for Uint8Array listeners

      // Auth-fatal closes (NOT_PAIRED / "device identity required") will never
      // recover by retrying the same token, so handle them out-of-band: one
      // forced token refetch + reconnect, then halt the reconnect loop and
      // surface a clear CTA. Without this, GatewayClient autoReconnect would
      // ping-pong against the same stale credential indefinitely.
      if (isAuthFatalClose(code, reason)) {
        void handleAuthFatalClose(reason);
      }
    },

    onReconnectScheduled(_delayMs: number) {
      // Reconnect scheduled — conn state already updated in onClose
    },
  });

  // Wire binary frame listener for Yjs workshop sync.
  // TODO(phase-8): upstream proper binary channel API to GatewayClient.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawWs = (client as unknown as { ws: WebSocket | null }).ws;

  // Attach binary listener after connect resolves so we have a socket reference.
  void client.connect().then((hello) => {
    const wasReconnect = conn.backoffMs > 800;
    conn.backoffMs = 800;
    conn.connected = true;
    conn.connecting = false;
    conn.particleHue = 'blue';
    conn.connectedAt = Date.now();
    conn.connectError = null;
    // Successful handshake — clear the one-shot NOT_PAIRED refetch guard so a
    // future stale-token incident gets its own retry budget.
    notPairedRefetchAttempted = false;

    if (wasReconnect) {
      const activeHost = getActiveHost();
      toastSuccess('Reconnected', activeHost?.name ?? activeHost?.url);
    }

    gw.hello = hello as HelloOk;
    gw.presence = (hello as HelloOk).snapshot?.presence ?? [];

    if (capturedHostId) {
      const h = hostsState.hosts.find((x) => x.id === capturedHostId);
      if (h) {
        h.lastConnectedAt = conn.connectedAt;
        // Don't send `token` — the server preserves the existing token
        // when token is omitted (or empty). Tokens never round-trip
        // through the client cache.
        updateHost(capturedHostId, {
          name: h.name,
          url: h.url,
          lastConnectedAt: conn.connectedAt,
        }, { silent: true });
        saveLastActiveHost(capturedHostId);
      }
    }

    // Wire binary message handler onto the underlying socket.
    // TODO(phase-8): upstream proper binary channel API to GatewayClient.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sock = (client as unknown as { ws: unknown }).ws as { binaryType?: string; addEventListener?: (ev: string, fn: (e: MessageEvent) => void) => void } | null;
    if (sock && typeof sock.addEventListener === 'function') {
      sock.binaryType = 'arraybuffer';
      sock.addEventListener('message', (ev: MessageEvent) => {
        if (ev.data instanceof ArrayBuffer) {
          notifyBinaryListeners(new Uint8Array(ev.data));
        }
      });
    }

    onHelloOk(hello as HelloOk);
    resolveServerId();
  }).catch((err) => {
    console.error('[hub] connect failed:', err);
    conn.connectError = String((err as Error)?.message ?? err);
    toastError('Connection failed', conn.connectError, { id: 'gateway-connect-failed' });
  });

  void rawWs; // suppress unused warning
}

export function wsDisconnect() {
  conn.closed = true;
  conn.connected = false;
  conn.connecting = false;

  conn.particleHue = 'red';

  if (client) {
    client.close();
    client = null;
  }

  stopPolling();
  stopSqliteFlush();

  // Save current host's workshop layout before clearing state
  autoSave(hostsState.activeHostId);
  resetWorkshop();

  // Clear session status timers and eviction timers
  for (const tid of Object.values(ui.sessionStatusTimers)) clearTimeout(tid);
  for (const tid of sessionEvictTimers.values()) clearTimeout(tid);
  sessionEvictTimers.clear();
  ui.sessionStatusTimers = {};
  ui.sessionStatus = {};
  ui.selectedAgentId = null;

  // Reset data
  gw.hello = null;
  gw.agents = [];
  clearSessions();
  gw.presence = [];
  gw.health = null;
  gw.channels = null;
  gw.cronJobs = [];
  gw.lastSeq = null;

  // Reset chat/activity (shallow clear)
  for (const k of Object.keys(agentChat)) delete (agentChat as Record<string, unknown>)[k];
  for (const k of Object.keys(agentActivity)) delete (agentActivity as Record<string, unknown>)[k];

  ui.shutdownReason = null;
  conn.connectError = null;
  conn.backoffMs = 800;
}

export function sendRequest(method: string, params?: unknown, timeoutMs = 15000): Promise<unknown> {
  if (!client) return Promise.reject(new Error('not connected'));
  return client.request<unknown>(method, params, { timeoutMs });
}

/**
 * Push agent files to the gateway filesystem via the WebSocket connection.
 * The gateway will write files to `.minion/marketplace/agents/<agentId>/`.
 * Throws if the connection is not open.
 */
export async function sendInstall(agentId: string, files: Record<string, string>): Promise<void> {
  await sendRequest('agent.install', { agentId, files });
}

// ─── Internal ─────────────────────────────────────────────────────────────────

async function resolveServerId() {
  try {
    const res = await fetch('/api/servers');
    if (!res.ok) return;
    const { servers } = await res.json();
    const activeHost = getActiveHost();
    if (!activeHost || !Array.isArray(servers)) return;

    const hostUrl = activeHost.url.replace(/\/+$/, '');
    const match = servers.find((s: { url?: string }) => {
      if (!s.url) return false;
      return s.url.replace(/\/+$/, '') === hostUrl;
    });
    if (match) {
      ui.selectedServerId = match.id;
      fetchActivityBinsFromDb(match.id);
      startSqliteFlush(match.id);
      loadAgentGroups(match.id);
    }
  } catch {
    // non-critical — UI will work without server ID, just can't fetch missions
  }
}

async function fetchActivityBinsFromDb(serverId: string): Promise<void> {
  const since = Date.now() - 86_400_000; // 24h ago
  try {
    const res = await fetch(`/api/servers/${serverId}/activity-bins?since=${since}`);
    if (!res.ok) return;
    const { bins } = await res.json();
    if (Array.isArray(bins)) mergeActivityBinsFromDb(bins);
  } catch {
    /* non-critical */
  }
}

function handleEvent(evt: Record<string, unknown>) {
  switch (evt.event) {
    case 'agent':
      onAgentEvent(evt.payload as Record<string, unknown>);
      break;
    case 'chat':
      onChatEvent(evt.payload as ChatEvent);
      break;
    case 'presence':
      onPresenceEvent(evt.payload);
      break;
    case 'health':
      gw.health = evt.payload;
      break;
    case 'tick':
      ui.lastTickAt = Date.now();
      break;
    case 'shutdown': {
      const reason = (evt.payload as { reason?: string })?.reason ?? 'Gateway shutting down';
      ui.shutdownReason = reason;
      toastError('Gateway shutdown', reason, { id: 'gateway-shutdown', duration: Infinity });
      break;
    }
    case 'cache.invalidate':
      dispatchCacheInvalidate(evt.payload as Parameters<typeof dispatchCacheInvalidate>[0]);
      break;
    case 'reliability':
      if (evt.payload && typeof evt.payload === 'object') {
        pushReliabilityEvent(evt.payload as ReliabilityEvent);
      }
      break;
    case 'channels.status':
      if (evt.payload && typeof evt.payload === 'object') {
        gw.channels = evt.payload as typeof gw.channels;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('channels.status.updated'));
        }
      }
      break;
    case 'channels.whatsapp.qr':
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('channels.whatsapp.qr', { detail: evt.payload }));
      }
      break;
    case 'channels.whatsapp.paired':
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('channels.whatsapp.paired', { detail: evt.payload }));
      }
      break;
    case 'channels.whatsapp.pairFailed':
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('channels.whatsapp.pairFailed', { detail: evt.payload }),
        );
      }
      break;
    case 'flows.run.event':
      // Live per-node Test Run feedback — flow-editor state listens on the window.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('flows.run.event', { detail: evt.payload }));
      }
      break;
    case 'prompt.sections.preview.event':
      // Phase 3: progressive per-section reveal for the /agents Prompt tab.
      // Must be handled here explicitly — the generic `prompt.section.*`
      // default branch below collapses payloads into `prompt.sections.changed`,
      // which would drop the per-section breakdown this stream carries.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('prompt.sections.preview.event', { detail: evt.payload }),
        );
      }
      break;
    case 'pi-agent.run-start':
    case 'pi-agent.run-end':
    case 'pi-agent.tool-call':
    case 'pi-agent.subagent-spawned':
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(evt.event as string, { detail: evt.payload }));
      }
      break;
    case 'pi-agent.subagent-completed': {
      const scPayload = evt.payload as
        | { key?: string; status?: string; agentId?: string }
        | undefined;
      if (scPayload?.status === 'failed') {
        const prefs = getNotificationPrefs();
        if (prefs.subagentFailed && shouldShowToast(prefs)) {
          toastError('Subagent failed', scPayload?.key?.split(':').pop() ?? 'unknown');
        }
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(evt.event as string, { detail: evt.payload }));
      }
      break;
    }
    case 'pi-agent.orchestration-progress': {
      const opPayload = evt.payload as
        | { type?: string; orchestrationId?: string; data?: Record<string, unknown> }
        | undefined;
      const prefs = getNotificationPrefs();
      if (opPayload?.type === 'orchestration.started') {
        if (prefs.orchestrationStarted && shouldShowToast(prefs)) {
          toastInfo('Orchestration started', opPayload?.orchestrationId?.slice(0, 8) ?? '');
        }
      } else if (opPayload?.type === 'orchestration.completed') {
        const orchStatus = (opPayload?.data as { status?: string } | undefined)?.status;
        if (prefs.orchestrationCompleted && shouldShowToast(prefs)) {
          if (orchStatus === 'completed') {
            toastSuccess('Orchestration completed', opPayload?.orchestrationId?.slice(0, 8) ?? '');
          } else {
            toastError(
              'Orchestration ' + (orchStatus ?? 'ended'),
              opPayload?.orchestrationId?.slice(0, 8) ?? '',
            );
          }
        }
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(evt.event as string, { detail: evt.payload }));
      }
      break;
    }
    default: {
      const evtName = evt.event as string | undefined;
      // Phase 25: bubble prompt.section.* mutations to a single window event
      // so /prompt subscribers can refetch usage without a per-event case.
      if (
        typeof evtName === 'string' &&
        evtName.startsWith('prompt.section.') &&
        typeof window !== 'undefined'
      ) {
        window.dispatchEvent(
          new CustomEvent('prompt.sections.changed', { detail: evt.payload }),
        );
      }
      // Phase D-0c: debug.step.* (admin-only) — push to debug rune store
      if (typeof evtName === 'string' && evtName.startsWith('debug.step.')) {
        onDebugStepEvent(evtName, evt.payload);
      }
      break;
    }
  }
}

function onDebugStepEvent(eventName: string, payload: unknown) {
  if (!payload || typeof payload !== 'object') return;
  const stepFromName = eventName.slice('debug.step.'.length);
  // Special: debug.step.timeout — auto-resume notification, not a gate fire
  if (stepFromName === 'timeout') {
    const p = payload as { sessionKey?: unknown; step?: unknown; ts?: unknown };
    if (typeof p.sessionKey === 'string' && typeof p.step === 'string') {
      pushDebugStepTimeout({
        sessionKey: p.sessionKey,
        step: p.step as DebugStepName,
        ts: typeof p.ts === 'number' ? p.ts : Date.now(),
      });
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
    }
    return;
  }
  // Step gate event: push into the debug store. Payload shape matches the
  // gateway's DebugStepEvent type.
  const p = payload as Partial<DebugStepEvent>;
  if (typeof p.sessionKey === 'string' && typeof p.step === 'string') {
    pushDebugStepEvent({
      category: 'debug.step',
      step: p.step as DebugStepName,
      sessionKey: p.sessionKey,
      agentId: typeof p.agentId === 'string' ? p.agentId : undefined,
      state: (p.state as Record<string, unknown>) ?? {},
      ts: typeof p.ts === 'number' ? p.ts : Date.now(),
    });
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
  }
}

function onAgentEvent(payload: Record<string, unknown>) {
  if (!payload) return;
  let agentId = payload.agentId as string | undefined;
  if (!agentId && payload.sessionKey)
    agentId = parseAgentId(payload.sessionKey as string) ?? undefined;
  if (!agentId) agentId = gw.defaultAgentId ?? 'default';

  const act = ensureAgentActivity(agentId);
  act.lastEventAt = Date.now();
  act.working = true;

  const now = Date.now();
  const binTs = Math.floor(now / SPARK_BIN_MS) * SPARK_BIN_MS;
  const binIdx = Math.floor(binTs / SPARK_BIN_MS) % SPARK_BIN_COUNT;
  act.sparkBins[binIdx] = (act.sparkBins[binIdx] ?? 0) + 1;
  markSparkBinDirty(agentId, binTs, act.sparkBins[binIdx]);

  if (act._workingTimer) clearTimeout(act._workingTimer);
  act._workingTimer = setTimeout(() => {
    act.working = false;
  }, 5000);

  if (payload.sessionKey) {
    const sk = payload.sessionKey as string;
    upsertSession({ sessionKey: sk, agentId: agentId, lastActiveAt: Date.now() });
    // Don't downgrade 'thinking' to 'running' — thinking is more specific
    if (ui.sessionStatus[sk] !== 'thinking') {
      ui.sessionStatus[sk] = 'running';
      if (ui.sessionStatusTimers[sk]) clearTimeout(ui.sessionStatusTimers[sk]);
      ui.sessionStatusTimers[sk] = setTimeout(() => {
        if (ui.sessionStatus[sk] === 'running') setSessionIdle(sk);
        delete ui.sessionStatusTimers[sk];
      }, 30000);
    }
  }
}

function onChatEvent(payload: ChatEvent) {
  if (!payload?.sessionKey) return;
  const agentId = parseAgentId(payload.sessionKey);
  if (!agentId) return;

  const chat = ensureAgentChat(agentId);
  const sk = payload.sessionKey;
  upsertSession({ sessionKey: sk, agentId, lastActiveAt: Date.now() });

  // Cross-run: a different run finished
  if (payload.runId && chat.runId && payload.runId !== chat.runId) {
    if (payload.state === 'final' && sk === `agent:${agentId}:main`) {
      void loadChatHistory(agentId).then(() => notifyAgentReplyFinal(agentId));
    }
    return;
  }

  if (payload.state === 'delta') {
    const text = extractText(payload.message);
    if (typeof text === 'string') {
      const cur = chat.stream ?? '';
      if (!cur || text.length >= cur.length) chat.stream = text;
    }
    ui.sessionStatus[sk] = 'thinking';
    if (ui.sessionStatusTimers[sk]) clearTimeout(ui.sessionStatusTimers[sk]);
    ui.sessionStatusTimers[sk] = setTimeout(() => {
      if (ui.sessionStatus[sk] === 'thinking') setSessionIdle(sk);
      delete ui.sessionStatusTimers[sk];
    }, 60000);
  } else if (payload.state === 'final') {
    chat.stream = null;
    chat.runId = null;
    // Only refresh main chat history — workshop sessions are handled by the bridge.
    // Notify after the reload lands so listeners (voice-call) see the new reply.
    if (sk === `agent:${agentId}:main`) {
      void loadChatHistory(agentId).then(() => notifyAgentReplyFinal(agentId));
    }
    setSessionIdle(sk);
    if (ui.sessionStatusTimers[sk]) {
      clearTimeout(ui.sessionStatusTimers[sk]);
      delete ui.sessionStatusTimers[sk];
    }
  } else if (payload.state === 'aborted') {
    const msg = payload.message as { role?: string; content?: unknown } | null;
    if (msg?.role === 'assistant' && Array.isArray(msg.content)) {
      pushChatMessage(chat, msg as never);
    } else if (chat.stream?.trim()) {
      pushChatMessage(chat, {
        role: 'assistant',
        content: [{ type: 'text', text: chat.stream }],
        timestamp: Date.now(),
      } as never);
    }
    chat.stream = null;
    chat.runId = null;
    setSessionIdle(sk);
    if (ui.sessionStatusTimers[sk]) {
      clearTimeout(ui.sessionStatusTimers[sk]);
      delete ui.sessionStatusTimers[sk];
    }
  } else if (payload.state === 'error') {
    chat.stream = null;
    chat.runId = null;
    chat.lastError = payload.errorMessage ?? 'chat error';
    setSessionIdle(sk);
    if (ui.sessionStatusTimers[sk]) {
      clearTimeout(ui.sessionStatusTimers[sk]);
      delete ui.sessionStatusTimers[sk];
    }
  }
}

function onPresenceEvent(payload: unknown) {
  if (Array.isArray(payload)) {
    gw.presence = payload;
  } else if (payload) {
    const p = payload as { instanceId?: string };
    const idx = gw.presence.findIndex((x) => x.instanceId === p.instanceId);
    if (idx >= 0) gw.presence[idx] = payload as never;
    else gw.presence.push(payload as never);
  }
}

/** 10-minute eviction timers for idle session status entries. */
const sessionEvictTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Mark a session as idle and schedule eviction of its status entry after 10 minutes.
 * Cancels any existing eviction timer for this key (reset on re-activity).
 */
function setSessionIdle(sk: string) {
  ui.sessionStatus[sk] = 'idle';
  const existing = sessionEvictTimers.get(sk);
  if (existing) clearTimeout(existing);
  sessionEvictTimers.set(
    sk,
    setTimeout(
      () => {
        sessionEvictTimers.delete(sk);
        delete ui.sessionStatus[sk];
        delete ui.sessionStatusTimers[sk];
      },
      10 * 60 * 1000,
    ),
  );
}

function parseAgentId(sessionKey: string): string | null {
  if (!sessionKey) return gw.defaultAgentId;
  const m = sessionKey.match(/^agent:([^:]+):/);
  if (m) return m[1];
  return gw.defaultAgentId;
}

function onHelloOk(hello: HelloOk) {
  // If gateway was restarting after a config save, signal reconnection
  if (restartState.phase === 'restarting') {
    onRestartReconnected();
  }

  sendRequest('agents.list', {})
    .then((r) => {
      const res = r as { agents?: never[]; defaultId?: string } | null;
      gw.agents = res?.agents ?? [];
      gw.defaultAgentId =
        res?.defaultId ?? (gw.agents.length > 0 ? (gw.agents[0] as { id: string }).id : null);
      for (const agent of gw.agents) {
        const a = agent as { id: string };
        ensureAgentChat(a.id);
        ensureAgentActivity(a.id);
        upsertSession({
          sessionKey: `agent:${a.id}:main`,
          agentId: a.id,
          label: 'main',
          status: 'idle',
        });
      }
      for (const agent of gw.agents) loadChatHistory((agent as { id: string }).id);
    })
    .catch((e) => console.error('[hub] agents.list error:', e));

  // Re-register active trigger flows
  fetch('/api/flows?active=true')
    .then((r) => r.json())
    .then(
      async (body: {
        flows?: Array<{ id: string; nodes: Array<{ type: string; data: unknown }>; active: boolean }>;
      }) => {
        for (const flow of body.flows ?? []) {
          const triggerNode = flow.nodes.find(
            (n) => n.type === 'trigger' || n.type === 'pluginTrigger',
          );
          if (!triggerNode) continue;
          const td = triggerNode.data as {
            event: string;
            deliverResponse: boolean;
            filterChannelId?: string;
            filterAgentId?: string;
          };
          await sendRequest('flows.trigger.register', {
            flowId: flow.id,
            event: td.event,
            deliverResponse: td.deliverResponse,
            filterChannelId: td.filterChannelId,
            filterAgentId: td.filterAgentId,
          }).catch(() => {
            /* gateway may lack the method — non-fatal */
          });
        }
      },
    )
    .catch(() => {
      /* hub not ready — non-fatal */
    });

  sendRequest('sessions.list', {})
    .then((r) => {
      const raw = (r as { sessions?: unknown[] })?.sessions ?? [];
      mergeSessions(mapGatewaySessionRows(raw));
    })
    .catch(() => {});

  sendRequest('health', {})
    .then((r) => {
      gw.health = r;
    })
    .catch(() => {});
  sendRequest('system-presence', {})
    .then((r) => {
      if (Array.isArray(r)) gw.presence = r;
    })
    .catch(() => {});
  sendRequest('channels.status', {})
    .then((r) => {
      if (r) gw.channels = r;
    })
    .catch(() => {});
  sendRequest('cron.list', {})
    .then((r) => {
      if (r) gw.cronJobs = (r as { jobs?: never[] })?.jobs ?? [];
    })
    .catch(() => {});

  // (Removed) Personal-agent displayName sync from hub→gateway. Display name
  // now lives in gateway config (`agents.list[].identity.name`) and survives
  // restarts. /my-agent writes via config.patch directly.

  // Reload config if it was loaded before disconnect (e.g. after a save that restarted the gateway)
  if (configState.loaded || configState.loading) {
    loadConfig().catch(() => {});
  }

  setTimeout(startPolling, 3000);
}





function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (!conn.connected) return;
    Promise.allSettled([sendRequest('agents.list', {}), sendRequest('sessions.list', {})])
      .then((results) => {
        if (results[0].status === 'fulfilled' && results[0].value) {
          const r = results[0].value as { agents?: never[]; defaultId?: string };
          gw.agents = r.agents ?? [];
          gw.defaultAgentId = r.defaultId ?? gw.defaultAgentId;
        }
        if (results[1].status === 'fulfilled' && results[1].value) {
          const raw = (results[1].value as { sessions?: unknown[] })?.sessions ?? [];
          mergeSessions(mapGatewaySessionRows(raw));
        }
      })
      .catch(() => {});
  }, 30000);

  pollPresenceTimer = setInterval(() => {
    if (!conn.connected) return;
    sendRequest('system-presence', {})
      .then((res) => {
        if (Array.isArray(res)) gw.presence = res;
      })
      .catch(() => {});
  }, 60000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (pollPresenceTimer) {
    clearInterval(pollPresenceTimer);
    pollPresenceTimer = null;
  }
}

// ─── Binary Frame API ──────────────────────────────────────────────────────
type BinaryMessageHandler = (data: Uint8Array) => void;
const binaryListeners = new Set<BinaryMessageHandler>();

function notifyBinaryListeners(data: Uint8Array) {
  for (const handler of binaryListeners) {
    try {
      handler(data);
    } catch {
      /* ignore */
    }
  }
}

/** Send raw binary data through the WebSocket. */
export function sendBinary(data: Uint8Array): void {
  if (!client) return;
  // TODO(phase-8): upstream proper binary channel API to GatewayClient.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sock = (client as unknown as { ws: { readyState: number; send: (d: Uint8Array) => void } | null }).ws;
  if (!sock || sock.readyState !== 1 /* OPEN */) return;
  sock.send(data);
}

/** Register a handler for incoming binary WebSocket messages. Returns unsubscribe function. */
export function onBinaryMessage(handler: BinaryMessageHandler): () => void {
  binaryListeners.add(handler);
  return () => {
    binaryListeners.delete(handler);
  };
}

/** Get whether the WebSocket is currently connected and ready. */
export function isWsReady(): boolean {
  if (!client) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sock = (client as unknown as { ws: { readyState: number } | null }).ws;
  return sock !== null && sock.readyState === 1 /* OPEN */;
}

// ── Re-exports from sub-modules (see ./gateway/) ─────────────────────────────
export * from './gateway/prose';
export * from './gateway/debug-rpc';
export * from './gateway/whatsapp';
export * from './gateway/chat-rpc';
