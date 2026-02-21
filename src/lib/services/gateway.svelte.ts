import { conn } from '$lib/state/connection.svelte';
import { gw, upsertSession, mergeSessions } from '$lib/state/gateway-data.svelte';
import { agentChat, agentActivity, ensureAgentChat, ensureAgentActivity, saveSparkBins } from '$lib/state/chat.svelte';
import { hostsState, getActiveHost, updateHost, saveLastActiveHost } from '$lib/state/hosts.svelte';
import { ui } from '$lib/state/ui.svelte';
import { pushReliabilityEvent, setReliabilityServerId, type ReliabilityEvent } from '$lib/state/reliability.svelte';
import { configState, loadConfig } from '$lib/state/config.svelte';
import { uuid } from '$lib/utils/uuid';
import { extractText } from '$lib/utils/text';
import type { HelloOk, ChatEvent } from '$lib/types/gateway';

// Internal WS state — plain vars, not $state
let ws: WebSocket | null = null;
let wsGeneration = 0;
let pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let connectSent = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollPresenceTimer: ReturnType<typeof setInterval> | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

export function wsConnect() {
  const host = getActiveHost();
  if (!host?.url) return;
  conn.closed = false;
  conn.connecting = true;
  conn.particleHue = 'amber';
  conn.statusText = 'Connecting…';
  connectSent = false;
  gw.lastSeq = null;

  try {
    const gen = ++wsGeneration;
    ws = new WebSocket(host.url);

    ws.addEventListener('open', () => {
      // Wait for connect.challenge event
    });

    ws.addEventListener('message', (ev) => {
      handleMessage(String(ev.data ?? ''));
    });

    ws.addEventListener('close', (ev) => {
      if (wsGeneration !== gen) return; // stale socket
      const reason = String(ev.reason ?? '');
      ws = null;
      conn.connected = false;
      conn.connecting = false;
      conn.particleHue = 'red';
      flushPending(new Error(`closed (${ev.code}): ${reason}`));
      scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      // close handler fires next
    });
  } catch (e) {
    conn.connecting = false;
    conn.particleHue = 'red';
    conn.statusText = `Error: ${(e as Error).message}`;
    ws = null;
  }
}

export function wsDisconnect() {
  conn.closed = true;
  conn.connected = false;
  conn.connecting = false;
  conn.statusText = 'Disconnected';
  conn.particleHue = 'red';

  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) { ws.close(); ws = null; }

  flushPending(new Error('disconnected'));
  stopPolling();

  // Clear session status timers
  for (const tid of Object.values(ui.sessionStatusTimers)) clearTimeout(tid);
  ui.sessionStatusTimers = {};
  ui.sessionStatus = {};
  ui.selectedAgentId = null;

  // Reset data
  gw.hello = null;
  gw.agents = [];
  gw.sessions = [];
  gw.presence = [];
  gw.health = null;
  gw.channels = null;
  gw.cronJobs = [];
  gw.lastSeq = null;

  // Reset chat/activity (shallow clear)
  for (const k of Object.keys(agentChat)) delete (agentChat as Record<string, unknown>)[k];
  for (const k of Object.keys(agentActivity)) delete (agentActivity as Record<string, unknown>)[k];

  ui.shutdownReason = null;
  conn.backoffMs = 800;
}

export function sendRequest(method: string, params?: unknown, timeoutMs = 15000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return reject(new Error('not connected'));
    }
    const id = uuid();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`request '${method}' timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    ws.send(JSON.stringify({ type: 'req', id, method, params }));
  });
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function scheduleReconnect() {
  if (conn.closed) return;
  const delay = conn.backoffMs;
  conn.backoffMs = Math.min(conn.backoffMs * 1.7, 15000);
  conn.statusText = `Reconnecting in ${(delay / 1000).toFixed(1)}s…`;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; wsConnect(); }, delay);
}

function flushPending(err: Error) {
  for (const p of pending.values()) p.reject(err);
  pending.clear();
}

function sendConnect() {
  if (connectSent) return;
  connectSent = true;

  const activeHost = getActiveHost();
  const token = activeHost ? activeHost.token.trim() : '';
  const capturedHostId = hostsState.activeHostId;

  sendRequest('connect', {
    minProtocol: 3,
    maxProtocol: 3,
    client: { id: 'minion-control-ui', version: '1.0', platform: 'web', mode: 'ui' },
    role: 'operator',
    scopes: ['operator.admin', 'operator.read', 'operator.write', 'operator.approvals', 'operator.pairing'],
    caps: [],
    auth: token ? { token } : undefined,
    userAgent: navigator.userAgent,
    locale: navigator.language,
  })
    .then((hello) => {
      conn.backoffMs = 800;
      conn.connected = true;
      conn.connecting = false;
      conn.particleHue = 'blue';
      conn.connectedAt = Date.now();
      conn.statusText = 'Connected';

      gw.hello = hello as HelloOk;
      gw.presence = (hello as HelloOk).snapshot?.presence ?? [];

      if (capturedHostId) {
        const h = hostsState.hosts.find((x) => x.id === capturedHostId);
        if (h) {
          h.lastConnectedAt = conn.connectedAt;
          updateHost(capturedHostId, { name: h.name, url: h.url, token: h.token, lastConnectedAt: conn.connectedAt });
          saveLastActiveHost(capturedHostId);
        }
      }
      onHelloOk(hello as HelloOk);

      // Resolve DB server ID from active host URL
      resolveServerId();
    })
    .catch((err) => {
      console.error('[hub] connect failed:', err);
      ws?.close(4008, 'connect failed');
    });
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
      setReliabilityServerId(match.id);
    }
  } catch {
    // non-critical — UI will work without server ID, just can't fetch missions
  }
}

function handleMessage(raw: string) {
  let frame: Record<string, unknown>;
  try { frame = JSON.parse(raw); } catch { return; }

  if (frame.type === 'event') {
    if (frame.event === 'connect.challenge') {
      setTimeout(sendConnect, 200);
      return;
    }
    const seq = typeof frame.seq === 'number' ? frame.seq : null;
    if (seq !== null) {
      if (gw.lastSeq !== null && seq > gw.lastSeq + 1) {
        console.warn('[hub] event gap: expected', gw.lastSeq + 1, 'got', seq);
      }
      gw.lastSeq = seq;
    }
    handleEvent(frame);
    return;
  }

  if (frame.type === 'res') {
    const p = pending.get(frame.id as string);
    if (!p) return;
    pending.delete(frame.id as string);
    if (frame.ok) {
      p.resolve(frame.payload);
    } else {
      const err = frame.error as { message?: string } | undefined;
      p.reject(new Error(err?.message ?? 'request failed'));
    }
  }
}

function handleEvent(evt: Record<string, unknown>) {
  switch (evt.event) {
    case 'agent':   onAgentEvent(evt.payload as Record<string, unknown>); break;
    case 'chat':    onChatEvent(evt.payload as ChatEvent); break;
    case 'presence': onPresenceEvent(evt.payload); break;
    case 'health':  gw.health = evt.payload; break;
    case 'tick':    ui.lastTickAt = Date.now(); break;
    case 'shutdown':
      ui.shutdownReason = ((evt.payload as { reason?: string })?.reason) ?? 'Gateway shutting down';
      break;
    case 'reliability':
      if (evt.payload && typeof evt.payload === 'object') {
        pushReliabilityEvent(evt.payload as ReliabilityEvent);
      }
      break;
  }
}

function onAgentEvent(payload: Record<string, unknown>) {
  if (!payload) return;
  let agentId = payload.agentId as string | undefined;
  if (!agentId && payload.sessionKey) agentId = parseAgentId(payload.sessionKey as string) ?? undefined;
  if (!agentId) agentId = gw.defaultAgentId ?? 'default';

  const act = ensureAgentActivity(agentId);
  act.lastEventAt = Date.now();
  act.working = true;

  const binIdx = Math.floor((Date.now() / 10000) % 30);
  act.sparkBins[binIdx] = (act.sparkBins[binIdx] ?? 0) + 1;
  saveSparkBins(agentId, act.sparkBins);

  if (act._workingTimer) clearTimeout(act._workingTimer);
  const aid = agentId;
  act._workingTimer = setTimeout(() => { act.working = false; }, 5000);

  if (payload.sessionKey) {
    const sk = payload.sessionKey as string;
    upsertSession({ sessionKey: sk, agentId: agentId, lastActiveAt: Date.now() });
    // Don't downgrade 'thinking' to 'running' — thinking is more specific
    if (ui.sessionStatus[sk] !== 'thinking') {
      ui.sessionStatus[sk] = 'running';
      if (ui.sessionStatusTimers[sk]) clearTimeout(ui.sessionStatusTimers[sk]);
      ui.sessionStatusTimers[sk] = setTimeout(() => {
        if (ui.sessionStatus[sk] === 'running') ui.sessionStatus[sk] = 'idle';
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
    if (payload.state === 'final') loadChatHistory(agentId);
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
      if (ui.sessionStatus[sk] === 'thinking') ui.sessionStatus[sk] = 'idle';
      delete ui.sessionStatusTimers[sk];
    }, 60000);
  } else if (payload.state === 'final') {
    chat.stream = null;
    chat.runId = null;
    loadChatHistory(agentId);
    ui.sessionStatus[sk] = 'idle';
    if (ui.sessionStatusTimers[sk]) { clearTimeout(ui.sessionStatusTimers[sk]); delete ui.sessionStatusTimers[sk]; }
  } else if (payload.state === 'aborted') {
    const msg = payload.message as { role?: string; content?: unknown } | null;
    if (msg?.role === 'assistant' && Array.isArray(msg.content)) {
      chat.messages = [...chat.messages, msg as never];
    } else if (chat.stream?.trim()) {
      chat.messages = [...chat.messages, { role: 'assistant', content: [{ type: 'text', text: chat.stream }], timestamp: Date.now() }];
    }
    chat.stream = null; chat.runId = null;
    ui.sessionStatus[sk] = 'idle';
    if (ui.sessionStatusTimers[sk]) { clearTimeout(ui.sessionStatusTimers[sk]); delete ui.sessionStatusTimers[sk]; }
  } else if (payload.state === 'error') {
    chat.stream = null; chat.runId = null;
    chat.lastError = payload.errorMessage ?? 'chat error';
    ui.sessionStatus[sk] = 'idle';
    if (ui.sessionStatusTimers[sk]) { clearTimeout(ui.sessionStatusTimers[sk]); delete ui.sessionStatusTimers[sk]; }
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

function parseAgentId(sessionKey: string): string | null {
  if (!sessionKey) return gw.defaultAgentId;
  const m = sessionKey.match(/^agent:([^:]+):/);
  if (m) return m[1];
  return gw.defaultAgentId;
}

function onHelloOk(hello: HelloOk) {
  sendRequest('agents.list', {})
    .then((r) => {
      const res = r as { agents?: never[]; defaultId?: string } | null;
      gw.agents = res?.agents ?? [];
      gw.defaultAgentId = res?.defaultId ?? (gw.agents.length > 0 ? (gw.agents[0] as { id: string }).id : null);
      for (const agent of gw.agents) {
        const a = agent as { id: string };
        ensureAgentChat(a.id);
        ensureAgentActivity(a.id);
        upsertSession({ sessionKey: `agent:${a.id}:main`, agentId: a.id, label: 'main', status: 'idle' });
      }
      for (const agent of gw.agents) loadChatHistory((agent as { id: string }).id);
    })
    .catch((e) => console.error('[hub] agents.list error:', e));

  sendRequest('sessions.list', {})
    .then((r) => { mergeSessions(((r as { sessions?: never[] })?.sessions) ?? []); })
    .catch(() => {});

  sendRequest('health', {}).then((r) => { gw.health = r; }).catch(() => {});
  sendRequest('system-presence', {}).then((r) => { if (Array.isArray(r)) gw.presence = r; }).catch(() => {});
  sendRequest('channels.status', {}).then((r) => { if (r) gw.channels = r; }).catch(() => {});
  sendRequest('cron.list', {}).then((r) => { if (r) gw.cronJobs = (r as { jobs?: never[] })?.jobs ?? []; }).catch(() => {});

  // Reload config if it was loaded before disconnect (e.g. after a save that restarted the gateway)
  if (configState.loaded || configState.loading) {
    loadConfig().catch(() => {});
  }

  setTimeout(startPolling, 3000);
}

export function loadChatHistory(agentId: string) {
  const chat = ensureAgentChat(agentId);
  chat.loading = true;
  sendRequest('chat.history', { sessionKey: `agent:${agentId}:main`, limit: 200 })
    .then((res) => {
      chat.messages = Array.isArray((res as { messages?: never[] })?.messages)
        ? (res as { messages: never[] }).messages
        : [];
    })
    .catch(() => {})
    .finally(() => { chat.loading = false; });
}

export function sendChatMsg(agentId: string) {
  const chat = ensureAgentChat(agentId);
  const msg = chat.inputText.trim();
  if (!msg || chat.sending || !conn.connected) return;

  const sessionKey = `agent:${agentId}:main`;
  const runId = uuid();

  chat.messages = [...chat.messages, { role: 'user', content: [{ type: 'text', text: msg }], timestamp: Date.now() }];
  chat.inputText = '';
  chat.sending = true;
  chat.runId = runId;
  chat.stream = '';
  chat.lastError = null;

  sendRequest('chat.send', { sessionKey, message: msg, deliver: false, idempotencyKey: runId })
    .then(() => { chat.sending = false; })
    .catch((e) => {
      chat.runId = null;
      chat.stream = null;
      chat.sending = false;
      chat.lastError = String(e);
    });
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
          mergeSessions(((results[1].value as { sessions?: never[] })?.sessions) ?? []);
        }
      })
      .catch(() => {});
  }, 30000);

  pollPresenceTimer = setInterval(() => {
    if (!conn.connected) return;
    sendRequest('system-presence', {})
      .then((res) => { if (Array.isArray(res)) gw.presence = res; })
      .catch(() => {});
  }, 60000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (pollPresenceTimer) { clearInterval(pollPresenceTimer); pollPresenceTimer = null; }
}
