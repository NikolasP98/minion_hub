import { conn, setConnectError, clearConnectError } from '$lib/state/gateway/connection.svelte';
import { describeGatewayError } from '$lib/services/gateway-errors';
import { queryClient } from '$lib/query/client';
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
  feedStreamMessage,
  finishStreamMessage,
  cancelStreamText,
  clearLiveActivity,
  SPARK_BIN_MS,
  SPARK_BIN_COUNT,
} from '$lib/state/chat/chat.svelte';
import { activityVerb } from '$lib/chat/blocks';
import {
  hostsState,
  getActiveHost,
  updateHost,
  saveLastActiveHost,
  fetchHostToken,
  getOrgAssignedHost,
} from '$lib/state/features/hosts.svelte';
import { userState } from '$lib/state/features/user.svelte';
import type { Host } from '$lib/types/host';
import {
  armEagerReconnect,
  clearPendingEagerReconnect,
  disarmEagerReconnect,
  isEagerReconnectArmed,
  scheduleEagerReconnect,
} from './gateway/eager-reconnect';
import { ConnectionLifecycleFence, isDistinctCutoverTarget } from './gateway/connection-lifecycle';
import { autoSave, resetWorkshop } from '$lib/state/workshop/workshop.svelte';
import { ui } from '$lib/state/ui/ui.svelte';
import { toastError, toastInfo, toastSuccess, toastWarning } from '$lib/state/ui/toast.svelte';
import {
  pushReliabilityEvent,
  type ReliabilityEvent,
} from '$lib/state/reliability/reliability.svelte';
import {
  configState,
  loadConfig,
  restartState,
  onRestartReconnected,
  resetRestartState,
  beginRestart,
} from '$lib/state/config/config.svelte';
import {
  updateState,
  applyUpdateStatus,
  bumpUpdateProgress,
  setUpdateProgress,
  isUpdateRestartExpected,
  type PendingUpdate,
  type UpdateApplyResult,
  type UpdateProgress,
} from '$lib/state/gateway/update-state.svelte';
import { extractText } from '$lib/utils/text';
import type { ChatMessage } from '$lib/types/chat';
import { loadAgentGroups } from '$lib/state/features/agent-groups.svelte';
import * as m from '$lib/paraglide/messages';
import {
  GatewayClient,
  newTraceparent,
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
// RPC primitives (client + sendRequest/sendInstall) live in the leaf
// `gateway-rpc` module so config/reliability/chat-rpc can import them without
// forming a static import cycle back through this file. We re-export them below
// to preserve the `$lib/services/gateway.svelte` import paths consumers use.
import { getClient, setClient, sendRequest, sendInstall } from './gateway-rpc';
import { env as publicEnv } from '$env/dynamic/public';

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

// Internal state — plain vars, not $state.
// The GatewayClient instance lives in the `gateway-rpc` leaf (accessed via
// getClient()/setClient()) so RPC consumers can import `sendRequest` without a
// cycle. This file still owns the client *lifecycle*.
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollPresenceTimer: ReturnType<typeof setInterval> | null = null;
// One-shot guard: when the gateway closes with NOT_PAIRED / "device identity
// required", we refetch the token and try exactly once more. A second auth-
// fatal close halts the reconnect loop and surfaces a CTA instead of letting
// the shared client autoReconnect with the same stale credential forever.
let notPairedRefetchAttempted = false;
// Fences overlapping lifecycle operations while they await token fetches or a
// backup handshake. Client identity fences socket callbacks; this generation
// additionally prevents an older async wsConnect/cutover from installing
// itself after a newer user action or reconnect attempt has won.
const lifecycleFence = new ConnectionLifecycleFence();

// ─── Gateway JWT (multi-tenant org identity) ────────────────────────────────
// When PUBLIC_GATEWAY_JWT_AUTH is enabled the dashboard additionally presents a
// hub-issued JWT (orgId/agentIds claims) on connect, so the gateway can org-scope
// the agent roster server-side. The shared-secret token still rides along as the
// operator credential — the JWT only adds identity. Self-healing: if the gateway
// ever rejects the JWT, disable it for the rest of the session and fall back to
// shared-token auth so the dashboard can never be locked out by a JWT problem.
// (Harmless when the gateway has no oidcIssuers configured — it ignores the jwt.)
let jwtAuthDisabled = false;
// A JWT rejection is usually transient (JWKS rotation/cache lag, clock skew) now
// that oidcIssuers IS configured. Permanently disabling the JWT would strand the
// whole session on UNSCOPED shared-token auth, where channel/account scoping
// fails open and other orgs' accounts leak in. So we re-enable the JWT after this
// cooldown and reconnect — bounding the cross-org fail-open window to the cooldown
// rather than "until page reload".
const JWT_RETRY_COOLDOWN_MS = 60_000;
let jwtRetryTimer: ReturnType<typeof setTimeout> | null = null;

function isJwtAuthEnabled(): boolean {
  return publicEnv.PUBLIC_GATEWAY_JWT_AUTH === 'true' && !jwtAuthDisabled;
}

/** Best-effort fetch of the hub-issued gateway JWT. Null on any failure. */
async function fetchGatewayJwt(): Promise<string | null> {
  try {
    const res = await fetch('/api/gateway/jwt', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const data = (await res.json()) as { token?: unknown };
    return typeof data.token === 'string' ? data.token : null;
  } catch {
    return null;
  }
}

/** A 1008 close whose reason implicates JWT validation (issuer/audience/exp/sig). */
function isJwtAuthClose(code: number, reason: string): boolean {
  return code === 1008 && /jwt/i.test(reason);
}

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
  const c = getClient();
  if (c) {
    c.close();
    setClient(null);
  }

  if (notPairedRefetchAttempted) {
    const info = describeGatewayError(reason);
    setConnectError(reason);
    toastError(info.title, info.hint, {
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

const OPERATOR_ROLE = 'operator';
const OPERATOR_SCOPES = [
  'operator.admin',
  'operator.read',
  'operator.write',
  'operator.approvals',
  'operator.pairing',
];

/**
 * Build a GatewayClient wired with the dashboard's auth/event/close handling.
 * Shared by `wsConnect` (the main client) and `cutoverToHost` (the
 * make-before-break backup client) — see specs/2026-07-11-ws-failover-eager-reconnect.md §3.2.
 *
 * Fencing: onEvent/onClose close over `client` (the instance being built) and
 * bail out if `getClient() !== client`. This makes a stray close/event from a
 * client that's no longer current (replaced by a cutover, or an eager
 * recreate) a complete no-op — it can never clobber `conn` state or spawn a
 * duplicate reconnect loop. Safe because these callbacks are only ever
 * invoked asynchronously, after the `const client = new GatewayClient(...)`
 * assignment has completed.
 */
function buildGatewayClient(host: Host, token: string): GatewayClient {
  const client: GatewayClient = new GatewayClient({
    url: host.url,
    autoReconnect: true,

    onOpen() {
      // Wire the binary (Yjs workshop sync) listener onto the freshly-opened
      // socket. This fires on EVERY (re)connect — GatewayClient.scheduleReconnect
      // calls connect() internally, which creates a new socket and re-fires
      // onOpen. Wiring here (rather than only in the one-shot `.connect().then`)
      // is what keeps binary sync alive across auto-reconnects. For a backup
      // client (cutover) built before it's registered as current, this is a
      // harmless no-op — rawSocket() still resolves the OLD client via
      // getClient() until the atomic swap runs, so nothing gets mis-wired.
      wireBinaryListener();
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

      // Best-effort org-identity JWT (gated). Only included when fetched OK; a
      // failed fetch falls back to shared-token auth (orgId undefined => full
      // roster) rather than sending a known-bad credential.
      const jwt = isJwtAuthEnabled() ? await fetchGatewayJwt() : null;

      return {
        minProtocol: 3,
        maxProtocol: 3,
        // `displayName` is the human user's name (not the UI's) — the gateway
        // surfaces it as SenderName so a personal agent greets the user by name
        // instead of asking what to call them during onboarding.
        client: {
          id: 'minion-control-ui',
          version: '1.0',
          platform: 'web',
          mode: 'ui',
          displayName: userState.user?.displayName ?? undefined,
        },
        role: OPERATOR_ROLE,
        scopes: OPERATOR_SCOPES,
        // `tool-events` opts this connection into live per-run tool events
        // (stream:'tool' agent frames) — drives the real-time activity verbs
        // and live tool rows in chat surfaces.
        caps: ['tool-events'],
        auth: token ? { token } : undefined,
        jwt: jwt ?? undefined,
        userId,
        userAgent: navigator.userAgent,
        locale: navigator.language,
      };
    },

    onEvent(frame: EventFrame) {
      // Fence: a client that's been replaced (cutover, or an eager recreate)
      // must never mutate shared event-sequence/handler state.
      if (getClient() !== client) return;
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
      // Fence: ignore entirely if this client is no longer the current one —
      // it was replaced by a cutover (H2) or an eager recreate (H1). Without
      // this a stale close could flip `conn.connected` back to false right
      // after a successful cutover, or spawn a duplicate reconnect loop.
      if (getClient() !== client) return;

      conn.connected = false;
      conn.connecting = false;
      const expectedRestart = code === 1012 || isEagerReconnectArmed();
      conn.particleHue = expectedRestart ? 'amber' : 'red';
      // Update install in flight (progress set, pending not yet confirmed
      // landed): the gateway dropping the WS *is* the restart step.
      if (updateState.pending && updateState.progress && updateState.progress.pct < 90) {
        bumpUpdateProgress({ phase: 'restarting', pct: 90 });
      }
      // The underlying socket is gone; detach the binary listener bound to it so
      // it doesn't leak or fire against a dead socket. onOpen re-wires the next
      // socket on reconnect.
      teardownBinaryWiring();

      // 1012 Service Restart: the gateway's authoritative "this is a
      // deliberate restart, come right back" signal (RFC 6455 registry).
      // Arm the eager reconnect window and, when no update flow is already
      // narrating the restart (isUpdateRestartExpected() covers that case
      // via the bump above), fall back to the config-restart amber path so a
      // manual gateway restart still ambers instead of reading as an outage.
      if (code === 1012) {
        armEagerReconnect();
        if (!isUpdateRestartExpected()) beginRestart();
      }

      // JWT rejected by the gateway (e.g. oidcIssuers not yet configured, or an
      // expired/invalid token): disable the JWT for the rest of the session and
      // reconnect on shared-token auth alone. Self-healing — the dashboard is
      // never locked out by a JWT problem; it just loses org-scoping.
      if (isJwtAuthEnabled() && isJwtAuthClose(code, reason)) {
        jwtAuthDisabled = true;
        console.warn('[hub] gateway rejected JWT — temporarily falling back to shared-token auth:', reason);
        // Re-enable the JWT after a cooldown and reconnect, so a transient
        // rejection doesn't leave the session permanently unscoped (cross-org
        // fail-open). If the next attempt fails too, this same path re-arms.
        if (jwtRetryTimer) clearTimeout(jwtRetryTimer);
        jwtRetryTimer = setTimeout(() => {
          jwtRetryTimer = null;
          jwtAuthDisabled = false;
          const live = getClient();
          if (live) {
            live.close();
            setClient(null);
          }
          void wsConnect();
        }, JWT_RETRY_COOLDOWN_MS);
        client.close();
        setClient(null);
        void wsConnect();
        return;
      }

      // Auth-fatal closes (NOT_PAIRED / "device identity required") will never
      // recover by retrying the same token, so handle them out-of-band: one
      // forced token refetch + reconnect, then halt the reconnect loop and
      // surface a clear CTA. Without this, GatewayClient autoReconnect would
      // ping-pong against the same stale credential indefinitely.
      if (isAuthFatalClose(code, reason)) {
        void handleAuthFatalClose(reason);
        return;
      }

      // Eager reconnect (H1): while armed, bypass the shared client's own
      // exponential backoff — tear this client down (close() cancels its
      // internal reconnect timer) and schedule exactly one flat-cadence
      // reconnect attempt instead of waiting out backoffMs.
      if (isEagerReconnectArmed()) {
        client.close();
        setClient(null);
        scheduleEagerReconnect(() => void wsConnect());
      }
    },

    onReconnectScheduled(_delayMs: number) {
      // Reconnect scheduled — conn state already updated in onClose
    },
  });

  // Group every gateway RPC from this browser session under one trace id, so the
  // gateway's per-request SERVER spans (added in request-trace.ts) all share a
  // trace and read as one session in any OTLP backend. No browser OTel SDK
  // needed — the shared client stamps each frame's traceparent as a child of
  // this root. (newTraceparent() with no parent mints a fresh root.)
  client.setParentTraceparent(newTraceparent());

  return client;
}

export async function wsConnect() {
  const generation = lifecycleFence.begin();
  const host = getActiveHost();
  if (!host?.url) return;
  conn.closed = false;
  conn.connecting = true;
  conn.particleHue = 'amber';

  gw.lastSeq = null;
  // A fresh manual/programmatic connect supersedes any eager-reconnect
  // attempt already in flight from a previous close (H1 stacking guard).
  clearPendingEagerReconnect();

  // Close existing client before creating a new one
  const existing = getClient();
  if (existing) {
    existing.close();
    setClient(null);
  }
  teardownBinaryWiring();

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
  if (!lifecycleFence.isCurrent(generation)) return;
  if (fetched === null) {
    conn.connecting = false;
    if (isEagerReconnectArmed()) {
      conn.particleHue = 'amber';
      scheduleEagerReconnect(() => void wsConnect());
      return;
    }
    conn.particleHue = 'red';
    const info = describeGatewayError('could not load gateway token');
    setConnectError('could not load gateway token');
    toastError(info.title, info.hint, { id: 'gateway-token-unavailable' });
    return;
  }
  const token = fetched.trim();

  const newClient = buildGatewayClient(host, token);

  // Register the client in the leaf BEFORE connect() so onOpen (which fires the
  // moment the socket opens, and again on every auto-reconnect) sees it and can
  // wire the binary listener via getClient().
  setClient(newClient);

  void newClient
    .connect()
    .then((hello) => {
      if (!lifecycleFence.isCurrent(generation) || getClient() !== newClient) {
        newClient.close();
        return;
      }
      const wasReconnect = conn.backoffMs > 800;
      conn.backoffMs = 800;
      conn.connected = true;
      conn.connecting = false;
      conn.particleHue = 'blue';
      conn.connectedAt = Date.now();
      clearConnectError();
      // A live handshake means whatever restart/outage this was riding out is
      // over — stop probing eagerly and let the normal backoff resume for any
      // future (unannounced) drop.
      disarmEagerReconnect();
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
          updateHost(
            capturedHostId,
            {
              name: h.name,
              url: h.url,
              lastConnectedAt: conn.connectedAt,
            },
            { silent: true },
          );
          saveLastActiveHost(capturedHostId);
        }
      }

      // Binary (Yjs workshop sync) listener is wired in onOpen — see
      // wireBinaryListener() — so it survives auto-reconnects.

      onHelloOk(hello as HelloOk);
      resolveServerId();
    })
    .catch((err) => {
      if (!lifecycleFence.isCurrent(generation) || getClient() !== newClient) return;
      if (isEagerReconnectArmed()) {
        conn.particleHue = 'amber';
        scheduleEagerReconnect(() => void wsConnect());
        return;
      }
      console.error('[hub] connect failed:', err);
      const raw = String((err as Error)?.message ?? err);
      const info = describeGatewayError(raw);
      setConnectError(raw);
      toastError(info.title, info.hint, { id: 'gateway-connect-failed' });
    });
}

/**
 * Make-before-break cutover to `host` (H2): build a backup client, await its
 * hello, then atomically swap it in as the main client — active-host state,
 * binary wiring, and per-gateway data are all repointed at the new host —
 * before closing the old client last. `conn.connected` never goes false
 * during a successful cutover. On backup-connect failure the old client is
 * left completely untouched (today's behavior).
 */
export async function cutoverToHost(
  host: Host,
  sourceHostId = hostsState.activeHostId,
): Promise<boolean> {
  const sourceClient = getClient();
  const generation = lifecycleFence.snapshot();
  const fetched = await fetchHostToken(host.id);
  if (!lifecycleFence.isCurrent(generation) || getClient() !== sourceClient) return false;
  if (fetched === null) return false;
  const token = fetched.trim();

  const backup = buildGatewayClient(host, token);
  let hello: HelloOk;
  try {
    hello = (await backup.connect()) as HelloOk;
  } catch (err) {
    console.error('[hub] cutover to host failed:', err);
    backup.close();
    return false;
  }

  // The source may have dropped (and eager reconnect may have started) while
  // the backup handshake was in flight. Never let that now-stale cutover
  // overwrite the newer connection lifecycle.
  if (!lifecycleFence.isCurrent(generation) || getClient() !== sourceClient || !conn.connected) {
    backup.close();
    return false;
  }

  // Atomic swap. The old client's onClose is fenced (getClient() !== old, see
  // buildGatewayClient) so closing it below is inert — it can't clobber any
  // of the state we're about to set from the new client's perspective.
  const old = getClient();
  lifecycleFence.invalidate();
  setClient(backup);
  if (hostsState.activeHostId !== host.id) hostsState.activeHostId = host.id;

  // Re-wire the binary listener now that getClient() resolves to `backup` —
  // its own onOpen fired while the old client was still current, so that
  // first wire attempt was a no-op (see buildGatewayClient's onOpen note).
  teardownBinaryWiring();
  wireBinaryListener();

  // Same per-gateway data reset a manual host switch does today.
  resetGatewayData(sourceHostId);

  conn.connected = true;
  conn.connecting = false;
  conn.closed = false;
  conn.particleHue = 'blue';
  conn.connectedAt = Date.now();
  conn.backoffMs = 800;
  clearConnectError();
  disarmEagerReconnect();
  notPairedRefetchAttempted = false;

  gw.hello = hello;
  gw.presence = hello.snapshot?.presence ?? [];

  const h = hostsState.hosts.find((x) => x.id === host.id);
  if (h) {
    h.lastConnectedAt = conn.connectedAt;
    updateHost(
      host.id,
      { name: h.name, url: h.url, lastConnectedAt: conn.connectedAt },
      { silent: true },
    );
  }

  onHelloOk(hello);
  resolveServerId();

  // Close the OLD client last — its onClose is fenced, so this can't undo
  // anything we just set.
  if (old) old.close();
  return true;
}

export function wsDisconnect() {
  lifecycleFence.invalidate();
  conn.closed = true;
  conn.connected = false;
  conn.connecting = false;

  conn.particleHue = 'red';

  const c = getClient();
  if (c) {
    c.close();
    setClient(null);
  }
  teardownBinaryWiring();

  if (jwtRetryTimer) {
    clearTimeout(jwtRetryTimer);
    jwtRetryTimer = null;
  }
  clearPendingEagerReconnect();

  resetGatewayData(hostsState.activeHostId);

  ui.shutdownReason = null;
  clearConnectError();
  conn.backoffMs = 800;
}

/**
 * Per-gateway data reset shared by `wsDisconnect` (full teardown) and
 * `cutoverToHost` (H2 — data reset while the socket stays live on the new
 * client). `hostIdForAutosave` is the host being left, so the workshop
 * layout is saved under the right key before it's cleared.
 */
function resetGatewayData(hostIdForAutosave: string | null): void {
  stopPolling();
  stopSqliteFlush();

  // Save current host's workshop layout before clearing state
  autoSave(hostIdForAutosave);
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
}

// `sendRequest` / `sendInstall` now live in the `gateway-rpc` leaf (to break the
// import cycle). Re-exported here so the many `$lib/services/gateway.svelte`
// consumers keep their existing import paths.
export { sendRequest, sendInstall };

// ─── Internal ─────────────────────────────────────────────────────────────────

function enterEagerRestartFallback(version?: string): void {
  armEagerReconnect();
  bumpUpdateProgress({ phase: 'migrating', pct: 3, version });
  beginRestart();
}

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
      // Expected restart (update install / config save) — the progress bar and
      // calm banner already tell the story; a sticky red toast is just noise.
      if (!isUpdateRestartExpected() && restartState.phase !== 'restarting') {
        toastError('Gateway shutdown', reason, { id: 'gateway-shutdown', duration: Infinity });
      }
      break;
    }
    case 'cache.invalidate': {
      const { tags } = evt.payload as { tags: string[] };
      for (const tag of tags) {
        void queryClient.invalidateQueries({ queryKey: [tag] });
      }
      break;
    }
    case 'reliability':
      if (evt.payload && typeof evt.payload === 'object') {
        pushReliabilityEvent(evt.payload as ReliabilityEvent);
      }
      break;
    case 'update.available': {
      updateState.pending = evt.payload as PendingUpdate;
      // A fresh pending update supersedes any leftover progress from the last install.
      setUpdateProgress(null);
      toastInfo(
        m.gateway_update_available_title(),
        m.gateway_update_available_body({ version: updateState.pending.version }),
        { id: 'gateway-update' },
      );
      break;
    }
    case 'update.progress': {
      const p = evt.payload as UpdateProgress;
      if (p && typeof p.pct === 'number') bumpUpdateProgress(p);
      // The gateway is about to restart — arm eager reconnect so the drop
      // (whenever it lands) gets a flat-cadence probe instead of exponential
      // backoff.
      if (p?.phase === 'restarting') armEagerReconnect();
      break;
    }
    case 'update.migrating': {
      // Fleet-update orchestrator (spec §3.4) telling connected sessions an
      // instance is about to drain — arrives BEFORE the WS drop, so we can
      // react calmly instead of surprising the user with a bare disconnect.
      const p = evt.payload as { version?: string; reason?: string } | undefined;
      const sourceHostId = hostsState.activeHostId;
      const sourceHost = getActiveHost();
      const assignedHost = getOrgAssignedHost();
      if (isDistinctCutoverTarget(sourceHost, assignedHost)) {
        // This session's org is assigned to a different candidate (stale
        // manual pick / admin browsing). Its successful hello
        // is the only available trustworthy health proof; lastConnectedAt is
        // historical and deliberately isn't treated as liveness.
        if (conn.connected) {
          // Arm before the parallel handshake so a source drop during cutover
          // still gets flat probes. A successful cutover disarms it.
          armEagerReconnect();
          void cutoverToHost(assignedHost, sourceHostId).then((ok) => {
            if (!ok && hostsState.activeHostId === sourceHostId) {
              enterEagerRestartFallback(p?.version);
            }
          });
        } else enterEagerRestartFallback(p?.version);
      } else {
        // The org genuinely lives on the draining instance — arm eager
        // reconnect (H1: the drain window can be up to ~60s, but the actual
        // drop/reconnect gap should be ~1s once it happens) and the same
        // "expected restart" flag the Updates card uses so the status dot
        // (ConnectionStatusIndicator) ambers before the drop, not after.
        enterEagerRestartFallback(p?.version);
      }
      break;
    }
    case 'update.applied': {
      const r = evt.payload as UpdateApplyResult;
      updateState.lastResult = r;
      updateState.installing = false;
      if (r.ok) {
        updateState.pending = null;
        bumpUpdateProgress({ phase: 'done', pct: 100, version: r.to });
      } else {
        setUpdateProgress(null);
        // A rolled-back update slower than the 30s restart window would
        // otherwise fail silently — this event is the authoritative failure
        // signal regardless of timing.
        toastError(m.gateway_update_installFailed(), r.detail);
      }
      break;
    }
    case 'channels.status':
      if (evt.payload && typeof evt.payload === 'object') {
        gw.channels = evt.payload as typeof gw.channels;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('channels.status.updated'));
        }
      }
      break;
    case 'channels.whatsapp.qr': {
      const cid = (evt.payload as { channelId?: string })?.channelId;
      if (cid && !gw.pairingChannelIds.includes(cid)) {
        gw.pairingChannelIds = [...gw.pairingChannelIds, cid];
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('channels.whatsapp.qr', { detail: evt.payload }));
      }
      break;
    }
    case 'channels.whatsapp.paired':
    case 'channels.whatsapp.pairFailed': {
      const cid = (evt.payload as { channelId?: string })?.channelId;
      if (cid) gw.pairingChannelIds = gw.pairingChannelIds.filter((c) => c !== cid);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(evt.event as string, { detail: evt.payload }));
      }
      break;
    }
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
        window.dispatchEvent(new CustomEvent('prompt.sections.changed', { detail: evt.payload }));
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

  // Live tool events (requires the `tool-events` connect cap): track per-run
  // tool calls + a context-aware activity verb for the main-session chat UIs.
  if (payload.stream === 'tool' && typeof payload.sessionKey === 'string') {
    const sk = payload.sessionKey;
    if (sk === `agent:${agentId}:main`) {
      const data = (payload.data ?? {}) as {
        phase?: string;
        name?: string;
        toolCallId?: string;
        args?: unknown;
        result?: unknown;
        isError?: boolean;
      };
      const name = typeof data.name === 'string' ? data.name : 'tool';
      const id = typeof data.toolCallId === 'string' ? data.toolCallId : '';
      const chat = ensureAgentChat(agentId);
      if (id && data.phase === 'start') {
        if (!chat.liveTools.some((t) => t.id === id)) {
          chat.liveTools.push({ id, name, input: data.args, done: false });
        }
        chat.liveActivity = activityVerb(name);
      } else if (id && data.phase === 'end') {
        const t = chat.liveTools.find((x) => x.id === id);
        if (t) {
          t.done = true;
          t.isError = !!data.isError;
          if (data.result !== undefined) {
            t.result =
              typeof data.result === 'string' ? data.result : JSON.stringify(data.result, null, 2);
          }
        }
        if (!chat.liveTools.some((x) => !x.done)) chat.liveActivity = null;
      }
    }
  }

  if (payload.sessionKey) {
    const sk = payload.sessionKey as string;
    upsertSession({ sessionKey: sk, agentId: agentId, lastActiveAt: Date.now() });
    // Don't downgrade 'thinking' to 'running' — thinking is more specific
    if (ui.sessionStatus[sk] !== 'thinking') {
      const isNew = !(sk in ui.sessionStatus);
      ui.sessionStatus[sk] = 'running';
      if (isNew) capSessionStatus();
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

  // The run has started producing events — hand the "thinking" indicator off to
  // the streaming bubble (streamMessage/stream now drive it) so it doesn't flash.
  chat.sending = false;

  if (payload.state === 'delta') {
    // Each delta carries the FULL partial assistant message so far. Feed it to
    // the smoother: reasoning + tool blocks show immediately, the answer text is
    // revealed progressively (the gateway throttles deltas to ~coarse chunks, so
    // raw rendering "jumps"; the smoother types it out). `chat.stream` is kept as
    // a plain-text mirror for the voice-call engine.
    const m = payload.message;
    const text = extractText(m);
    if (typeof text === 'string') {
      const cur = chat.stream ?? '';
      if (!cur || text.length >= cur.length) chat.stream = text;
    }
    feedStreamMessage(agentId, m && typeof m === 'object' ? (m as ChatMessage) : null);
    const isNew = !(sk in ui.sessionStatus);
    ui.sessionStatus[sk] = 'thinking';
    if (isNew) capSessionStatus();
    if (ui.sessionStatusTimers[sk]) clearTimeout(ui.sessionStatusTimers[sk]);
    ui.sessionStatusTimers[sk] = setTimeout(() => {
      if (ui.sessionStatus[sk] === 'thinking') setSessionIdle(sk);
      delete ui.sessionStatusTimers[sk];
    }, 60000);
  } else if (payload.state === 'final') {
    // Hand the final message to the smoother: it keeps revealing until the full
    // answer text is shown, THEN commits the message (so the streamed text and
    // the committed bubble never disagree — no jump, no blink). The history
    // reconcile + reply-notify run after the commit.
    const fm = payload.message as { role?: string; content?: unknown } | null;
    const finalMsg: ChatMessage =
      fm && fm.role === 'assistant' && (Array.isArray(fm.content) || typeof fm.content === 'string')
        ? (fm as ChatMessage)
        : {
            role: 'assistant',
            content: [{ type: 'text', text: chat.stream ?? '' }],
            timestamp: Date.now(),
          };
    chat.runId = null;
    finishStreamMessage(agentId, finalMsg, () => {
      clearLiveActivity(agentId);
      if (sk === `agent:${agentId}:main`) {
        void loadChatHistory(agentId).then(() => notifyAgentReplyFinal(agentId));
      } else {
        notifyAgentReplyFinal(agentId);
      }
    });
    setSessionIdle(sk);
    if (ui.sessionStatusTimers[sk]) {
      clearTimeout(ui.sessionStatusTimers[sk]);
      delete ui.sessionStatusTimers[sk];
    }
  } else if (payload.state === 'aborted') {
    cancelStreamText(agentId);
    clearLiveActivity(agentId);
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
    chat.streamMessage = null;
    chat.runId = null;
    setSessionIdle(sk);
    if (ui.sessionStatusTimers[sk]) {
      clearTimeout(ui.sessionStatusTimers[sk]);
      delete ui.sessionStatusTimers[sk];
    }
  } else if (payload.state === 'error') {
    cancelStreamText(agentId);
    clearLiveActivity(agentId);
    chat.stream = null;
    chat.streamMessage = null;
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
    if (idx >= 0) {
      // De-thrash: skip the reassignment (and the reactive invalidation it
      // triggers) when this single-entry update is identical to what we hold.
      if (presenceEntriesEqual(gw.presence[idx], payload as never)) return;
      gw.presence[idx] = payload as never;
    } else {
      gw.presence.push(payload as never);
    }
  }
}

/** Shallow structural equality for presence entries (cheap last-write-wins guard). */
function presenceEntriesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  if (ak.length !== Object.keys(bo).length) return false;
  for (const k of ak) {
    if (ao[k] !== bo[k]) return false;
  }
  return true;
}

/** 10-minute eviction timers for idle session status entries. */
const sessionEvictTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Hard cap on live session-status entries. A churny roster (sessions that come
 * and go faster than the 10-minute idle eviction) could otherwise grow
 * `ui.sessionStatus` unbounded. When over cap, evict the oldest entries
 * (insertion order) and tear down their timers.
 */
const SESSION_STATUS_CAP = 1000;

function capSessionStatus(): void {
  const keys = Object.keys(ui.sessionStatus);
  if (keys.length <= SESSION_STATUS_CAP) return;
  const overflow = keys.length - SESSION_STATUS_CAP;
  for (let i = 0; i < overflow; i++) {
    const sk = keys[i];
    const evict = sessionEvictTimers.get(sk);
    if (evict) {
      clearTimeout(evict);
      sessionEvictTimers.delete(sk);
    }
    if (ui.sessionStatusTimers[sk]) {
      clearTimeout(ui.sessionStatusTimers[sk]);
      delete ui.sessionStatusTimers[sk];
    }
    delete ui.sessionStatus[sk];
  }
}

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

/**
 * Apply a fresh agents.list result to `gw`. Single source of truth for the
 * agent roster so EVERY path that replaces `gw.agents` (initial onHelloOk AND
 * the 30s poller) gets identical scaffolding: defaultAgentId resolution + a
 * chat store, activity store, and `main` session row per agent. Without this,
 * an agent first seen by the poller would have no chat/activity scaffold and
 * would render broken until the next full reconnect.
 *
 * Does NOT load chat history — that's a heavier initial-load concern owned by
 * onHelloOk (the poller must stay cheap).
 */
function applyAgentsList(agents: unknown[] | undefined, defaultId: string | undefined): void {
  gw.agents = (agents ?? []) as typeof gw.agents;
  // Prefer the gateway-declared default; else keep whatever we already had
  // (poller refresh shouldn't reset it); else fall back to the first agent
  // (initial connect).
  gw.defaultAgentId =
    defaultId ??
    gw.defaultAgentId ??
    (gw.agents.length > 0 ? (gw.agents[0] as { id: string }).id : null);
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
}

/**
 * Post-reconnect update-outcome check via update.status. `current` there is
 * the full timestamped version (unlike hello.server.version, which can be a
 * bare channel tag like "dev"), so it's the only reliable success signal.
 */
async function confirmUpdateOutcomeViaStatus(targetVersion: string): Promise<void> {
  try {
    const res = await fetch('/api/gateway/update');
    if (!res.ok) return;
    const status = (await res.json()) as {
      current?: string | null;
      pending?: PendingUpdate | null;
      lastResult?: UpdateApplyResult | null;
    };
    applyUpdateStatus(status);
    if (status.current === targetVersion) {
      updateState.pending = null;
      setUpdateProgress({ phase: 'done', pct: 100, version: targetVersion });
      toastSuccess(m.gateway_update_restartSuccess({ version: targetVersion }));
    } else if (status.lastResult && !status.lastResult.ok) {
      // Rolled back — the 'update.applied' handler owns the failure toast;
      // just settle the bar.
      setUpdateProgress(null);
    } else if (status.pending?.version === targetVersion) {
      // Reconnected on the old version with the update still pending.
      setUpdateProgress(null);
      toastWarning(m.gateway_update_restartMismatch());
    }
  } catch {
    /* leave state as-is — 'update.applied' or the card's refetch settles it */
  }
}

function onHelloOk(hello: HelloOk) {
  // Update-install outcome check, on EVERY reconnect regardless of
  // restartState.phase — a real update (npm install + restart + boot)
  // routinely exceeds the 30s restart window, so by the time the gateway is
  // back the phase may already be 'failed' and `installing` already reset by
  // the timeout. The 'update.applied' WS event is the authoritative result,
  // but it can race the reconnect — the version comparison is a minimal
  // fallback so the user always gets a toast and the Install button never
  // sticks on "Installing…".
  let updateToastShown = false;
  const targetVersion = updateState.pending?.version;
  if (targetVersion && hello.server?.version === targetVersion) {
    // The pending update landed (also covers reconnects after the 30s window).
    updateState.installing = false;
    updateState.pending = null;
    setUpdateProgress({ phase: 'done', pct: 100, version: targetVersion });
    toastSuccess(m.gateway_update_restartSuccess({ version: targetVersion }));
    updateToastShown = true;
  } else if (targetVersion && (updateState.installing || updateState.progress)) {
    // Install in flight but hello is inconclusive — prod gateways report a
    // bare channel tag ("dev") in hello.server.version that never equals the
    // full timestamped pending version. Confirm against update.status's
    // `current` before judging the outcome; it also owns the outcome toast,
    // so suppress the generic reconnect toast for this reconnect.
    updateState.installing = false;
    updateToastShown = true;
    void confirmUpdateOutcomeViaStatus(targetVersion);
  } else if (updateState.installing) {
    updateState.installing = false;
  }
  // If gateway was restarting after a config save, signal reconnection —
  // silent when the update toast already covered this reconnect (one toast).
  if (restartState.phase === 'restarting') {
    onRestartReconnected({ silent: updateToastShown });
  } else if (updateToastShown) {
    // A >30s update restart leaves phase 'failed' behind — clear it so the
    // settings page's auto-save-on-reconnect (which requires 'idle') works.
    resetRestartState();
  }

  sendRequest('agents.list', {})
    .then((r) => {
      const res = r as { agents?: never[]; defaultId?: string } | null;
      applyAgentsList(res?.agents, res?.defaultId);
      for (const agent of gw.agents) loadChatHistory((agent as { id: string }).id);
    })
    .catch((e) => console.error('[hub] agents.list error:', e));

  // Re-register active trigger flows
  fetch('/api/flows?active=true')
    .then((r) => r.json())
    .then(
      async (body: {
        flows?: Array<{
          id: string;
          nodes: Array<{ type: string; data: unknown }>;
          active: boolean;
        }>;
      }) => {
        for (const flow of body.flows ?? []) {
          const triggerNode = flow.nodes.find(
            (n) => n.type === 'trigger' || n.type === 'pluginTrigger',
          );
          if (!triggerNode) continue;
          const td = triggerNode.data as {
            event: string;
            deliverResponse: boolean;
            sources?: { channel: string; accountId?: string }[];
            channels?: string[];
            filterChannelId?: string;
            filterAgentId?: string;
          };
          const srcs =
            td.sources && td.sources.length > 0
              ? td.sources
              : td.channels && td.channels.length > 0
                ? td.channels.map((channel) => ({ channel }))
                : td.filterChannelId
                  ? [{ channel: td.filterChannelId }]
                  : [];
          await sendRequest('flows.trigger.register', {
            flowId: flow.id,
            event: td.event,
            deliverResponse: td.deliverResponse,
            filterChannelIds: srcs.length ? [...new Set(srcs.map((s) => s.channel))] : undefined,
            filterChannelAccounts: srcs.length ? srcs : undefined,
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

// In-flight guards: on a slow link a poll can take longer than its interval.
// Without these, ticks would stack requests (and racing responses could apply
// stale data out of order). We keep the `conn.connected` check rather than
// clearing the timer because the GatewayClient auto-reconnects — the interval
// must survive a transient drop and resume once reconnected.
let agentsPollInFlight = false;
let presencePollInFlight = false;

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (!conn.connected || agentsPollInFlight) return;
    agentsPollInFlight = true;
    // channels.status is event-driven (channels.status events), but events can be
    // dropped on a flaky link — repoll it here so stale connection/pairing state
    // self-heals within one interval instead of sticking until reconnect.
    Promise.allSettled([
      sendRequest('agents.list', {}),
      sendRequest('sessions.list', {}),
      sendRequest('channels.status', {}),
    ])
      .then((results) => {
        if (results[0].status === 'fulfilled' && results[0].value) {
          const r = results[0].value as { agents?: never[]; defaultId?: string };
          applyAgentsList(r.agents, r.defaultId);
        }
        if (results[1].status === 'fulfilled' && results[1].value) {
          const raw = (results[1].value as { sessions?: unknown[] })?.sessions ?? [];
          mergeSessions(mapGatewaySessionRows(raw));
        }
        if (results[2].status === 'fulfilled' && results[2].value) {
          gw.channels = results[2].value as typeof gw.channels;
        }
      })
      .catch(() => {})
      .finally(() => {
        agentsPollInFlight = false;
      });
  }, 30000);

  pollPresenceTimer = setInterval(() => {
    if (!conn.connected || presencePollInFlight) return;
    presencePollInFlight = true;
    sendRequest('system-presence', {})
      .then((res) => {
        if (Array.isArray(res)) gw.presence = res;
      })
      .catch(() => {})
      .finally(() => {
        presencePollInFlight = false;
      });
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
  // Clear in-flight guards so a poll that was mid-flight when we stopped can't
  // block the first tick after the next startPolling().
  agentsPollInFlight = false;
  presencePollInFlight = false;
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

// TODO(phase-8): upstream a proper binary channel API to GatewayClient. Until
// then we reach into its private `ws` to attach a raw 'message' listener for
// the Yjs workshop sync channel.
type RawSocket = {
  binaryType?: string;
  readyState?: number;
  send?: (d: Uint8Array) => void;
  addEventListener?: (ev: string, fn: (e: MessageEvent) => void) => void;
  removeEventListener?: (ev: string, fn: (e: MessageEvent) => void) => void;
} | null;

function rawSocket(): RawSocket {
  const c = getClient();
  if (!c) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (c as unknown as { ws: RawSocket }).ws;
}

// The binary listener is bound per-socket. We track the socket + handler we
// wired so we can detach exactly that pair across reconnects (the socket is
// swapped on every reconnect, so a stale binding would leak / never fire).
let wiredBinarySocket: RawSocket = null;
let wiredBinaryHandler: ((e: MessageEvent) => void) | null = null;

/** Attach the binary message listener onto the current (freshly-opened) socket. */
function wireBinaryListener(): void {
  const sock = rawSocket();
  if (!sock || typeof sock.addEventListener !== 'function') return;
  // Already wired to this exact socket — nothing to do.
  if (wiredBinarySocket === sock && wiredBinaryHandler) return;
  // A different socket was wired before (shouldn't normally happen — onClose
  // tears down — but be defensive against double-open).
  teardownBinaryWiring();

  const handler = (ev: MessageEvent) => {
    if (ev.data instanceof ArrayBuffer) {
      notifyBinaryListeners(new Uint8Array(ev.data));
    }
  };
  sock.binaryType = 'arraybuffer';
  sock.addEventListener('message', handler);
  wiredBinarySocket = sock;
  wiredBinaryHandler = handler;
}

/** Detach the binary listener from the socket it was bound to. */
function teardownBinaryWiring(): void {
  if (
    wiredBinarySocket &&
    wiredBinaryHandler &&
    typeof wiredBinarySocket.removeEventListener === 'function'
  ) {
    wiredBinarySocket.removeEventListener('message', wiredBinaryHandler);
  }
  wiredBinarySocket = null;
  wiredBinaryHandler = null;
}

/** Send raw binary data through the WebSocket. */
export function sendBinary(data: Uint8Array): void {
  const sock = rawSocket();
  if (!sock || sock.readyState !== 1 /* OPEN */ || typeof sock.send !== 'function') return;
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
  const sock = rawSocket();
  return sock !== null && sock.readyState === 1 /* OPEN */;
}

// ── Re-exports from sub-modules (see ./gateway/) ─────────────────────────────
export * from './gateway/prose';
export * from './gateway/debug-rpc';
export * from './gateway/whatsapp';
export * from './gateway/chat-rpc';
