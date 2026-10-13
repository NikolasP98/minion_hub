// Leaf RPC module — holds ONLY the GatewayClient instance + the request
// primitives (`sendRequest`, `sendInstall`). It imports nothing from the rest
// of the dashboard, which is the whole point: `gateway.svelte` statically
// imports state modules (config, reliability, chat-rpc) that need to dispatch
// gateway requests. If those modules imported `sendRequest` from
// `gateway.svelte` you'd have a static import cycle
// (gateway.svelte → config.svelte → gateway.svelte). Routing the RPC
// primitives through this leaf breaks that cycle so importers can stay static.
//
// `gateway.svelte` owns the client lifecycle and registers/clears the instance
// here via `setClient()`; everything else just calls `sendRequest`.

import type { GatewayClient } from '@minion-stack/shared';

let client: GatewayClient | null = null;
let channelStatusSink: ((status: object) => void) | null = null;

// Diagnostic breadcrumbs (2026-09-08, see gateway.svelte.ts): console.warn so
// session replay captures the line, mirrored to a buffered PostHog event
// since posthog loads lazily. Lives in this leaf module (not gateway.svelte)
// so chat-rpc.ts can call it too without a static import cycle.
const gwDiagQueue: { phase: string; detail: Record<string, unknown> }[] = [];
function gwFlush(): boolean {
  const ph = (window as Window & { posthog?: { capture?: (e: string, p?: object) => void } })
    .posthog;
  if (!ph?.capture) return false;
  for (const c of gwDiagQueue.splice(0))
    ph.capture('gateway_diag', { gateway_phase: c.phase, ...c.detail });
  return true;
}
export function gwTrace(phase: string, detail?: Record<string, unknown>): void {
  console.warn('[gateway:diag]', phase, detail ?? '');
  try {
    gwDiagQueue.push({ phase, detail: { ...(detail ?? {}), at: Date.now() } });
    if (!gwFlush()) {
      const t = setInterval(() => {
        if (gwFlush()) clearInterval(t);
      }, 1000);
      setTimeout(() => clearInterval(t), 60_000);
    }
  } catch {
    /* diagnostics never throw */
  }
}

/** Register the active client (or clear it with `null`). Called by `gateway.svelte`. */
export function setClient(c: GatewayClient | null): void {
  client = c;
}

/** Current client instance, or null when disconnected. */
export function getClient(): GatewayClient | null {
  return client;
}

/** Register the dashboard-state sink without importing that state into this leaf module. */
export function setChannelStatusSink(sink: ((status: object) => void) | null): void {
  channelStatusSink = sink;
}

export function sendRequest(method: string, params?: unknown, timeoutMs = 15000): Promise<unknown> {
  if (!client) return Promise.reject(new Error('not connected'));
  return client.request<unknown>(method, params, { timeoutMs });
}

/** Fetch and publish a fresh channels.status snapshot through the registered sink. */
export async function refreshChannelStatus(): Promise<object | null> {
  const status = await sendRequest('channels.status', {});
  if (!status || typeof status !== 'object') return null;
  channelStatusSink?.(status);
  return status;
}

/**
 * Push agent files to the gateway filesystem via the WebSocket connection.
 * The gateway will write files to `.minion/marketplace/agents/<agentId>/`.
 * Throws if the connection is not open.
 */
export async function sendInstall(agentId: string, files: Record<string, string>): Promise<void> {
  await sendRequest('agent.install', { agentId, files });
}
