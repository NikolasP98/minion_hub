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

/** Register the active client (or clear it with `null`). Called by `gateway.svelte`. */
export function setClient(c: GatewayClient | null): void {
  client = c;
}

/** Current client instance, or null when disconnected. */
export function getClient(): GatewayClient | null {
  return client;
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
