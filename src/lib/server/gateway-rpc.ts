/**
 * Server-side one-shot gateway RPC helper.
 *
 * Hub's primary gateway client (`src/lib/services/gateway.svelte.ts`) is a
 * Svelte 5 rune store and only usable from the browser. SSR loaders need a
 * pure node-side path, so this module opens a transient WebSocket, performs
 * the token-auth handshake, sends a single request, and tears down.
 *
 * Auth: backward-compat admin mode (Case 2 in `ws-jwt-auth.ts`). We pass a
 * raw operator token in the `connect` request; the gateway treats
 * token/password auth without a JWT as `role: "admin"`.
 *
 * Env vars (already used elsewhere in hub):
 *   MINION_GATEWAY_URL        — ws:// or wss:// URL of the gateway
 *   OPENCLAW_GATEWAY_TOKEN    — operator/admin token
 */
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

const env = process.env;

import type { PluginUiManifestOccupant } from '$lib/plugins/PluginSlotHost.svelte';

const DEFAULT_TIMEOUT_MS = 8000;

function resolveGatewayUrl(): string {
  const raw = env.MINION_GATEWAY_URL ?? env.OPENCLAW_GATEWAY_URL ?? '';
  if (!raw) {
    throw new Error('MINION_GATEWAY_URL is not set');
  }
  // Normalise http(s) → ws(s) so callers can paste either.
  if (raw.startsWith('http://')) return 'ws://' + raw.slice('http://'.length);
  if (raw.startsWith('https://')) return 'wss://' + raw.slice('https://'.length);
  return raw;
}

function resolveToken(): string {
  const tok = env.OPENCLAW_GATEWAY_TOKEN ?? '';
  if (!tok) {
    throw new Error('OPENCLAW_GATEWAY_TOKEN is not set');
  }
  return tok;
}

/**
 * Call a gateway RPC over a one-shot WebSocket and return the result.
 */
export function gatewayCall<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = resolveGatewayUrl();
  const token = resolveToken();

  return new Promise<T>((resolve, reject) => {
    const ws = new WebSocket(url);
    let settled = false;
    let connectId: string | null = null;
    let requestId: string | null = null;

    const cleanup = () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    const succeed = (value: T) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const timer = setTimeout(() => fail(new Error('gateway RPC timeout')), timeoutMs);
    timer.unref?.();

    ws.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))));
    ws.on('close', () => fail(new Error('gateway WS closed before response')));

    ws.on('message', (raw) => {
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        return;
      }
      const type = frame.type;
      if (type === 'event' && frame.event === 'connect.challenge') {
        // Send connect request (token-only auth → admin role per ws-jwt-auth.ts Case 2).
        connectId = randomUUID();
        ws.send(
          JSON.stringify({
            type: 'req',
            id: connectId,
            method: 'connect',
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: 'minion-hub-ssr',
                version: '1.0',
                platform: 'node',
                mode: 'admin',
              },
              role: 'operator',
              scopes: ['operator.admin', 'operator.read', 'operator.write'],
              caps: [],
              auth: { token },
            },
          }),
        );
        return;
      }

      if (type === 'res' && frame.id === connectId) {
        if (frame.ok === false) {
          fail(new Error(`gateway connect failed: ${JSON.stringify(frame.error ?? frame)}`));
          return;
        }
        // Connected. Send the actual request.
        requestId = randomUUID();
        ws.send(
          JSON.stringify({
            type: 'req',
            id: requestId,
            method,
            params,
          }),
        );
        return;
      }

      if (type === 'res' && frame.id === requestId) {
        clearTimeout(timer);
        if (frame.ok === false) {
          fail(new Error(`gateway ${method} failed: ${JSON.stringify(frame.error ?? frame)}`));
          return;
        }
        succeed((frame.result ?? frame.payload ?? frame.data) as T);
      }
    });
  });
}

/** Convenience: list plugin UI manifest occupants. */
export async function pluginsUiList(): Promise<PluginUiManifestOccupant[]> {
  const res = await gatewayCall<{ occupants?: PluginUiManifestOccupant[] } | PluginUiManifestOccupant[]>(
    'plugins.ui.list',
    {},
  );
  if (Array.isArray(res)) return res;
  return res?.occupants ?? [];
}
