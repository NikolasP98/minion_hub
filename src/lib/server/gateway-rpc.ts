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
 * Credentials come from the encrypted DB row (`servers` table), not from
 * env vars. Resolution: if `MINION_GATEWAY_PRIMARY_URL` env is set, look
 * up the matching server row; otherwise pick the oldest server. The
 * `OPENCLAW_GATEWAY_TOKEN` / `MINION_GATEWAY_URL` env vars remain only as
 * a one-time bootstrap fallback for fresh deployments with an empty DB.
 */
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

import { getDb } from '$server/db/client';
import { getSystemGatewayCredentials } from '$server/services/server.service';

const env = process.env;

import type { PluginUiManifestOccupant } from '$lib/plugins/PluginSlotHost.svelte';

const DEFAULT_TIMEOUT_MS = 8000;

/** Normalise http(s) → ws(s) so callers (or DB rows) can use either. */
function toWsUrl(raw: string): string {
  if (raw.startsWith('http://')) return 'ws://' + raw.slice('http://'.length);
  if (raw.startsWith('https://')) return 'wss://' + raw.slice('https://'.length);
  return raw;
}

/** Inverse: ws(s) → http(s) for plugin UI iframe sources. */
export function toHttpUrl(raw: string): string {
  if (raw.startsWith('ws://')) return 'http://' + raw.slice('ws://'.length);
  if (raw.startsWith('wss://')) return 'https://' + raw.slice('wss://'.length);
  return raw;
}

/** Resolve the gateway HTTP base URL (for browser-side iframe srcs etc.). */
export async function getGatewayHttpUrl(): Promise<string> {
  const { url } = await resolveCredentials();
  return toHttpUrl(url).replace(/\/+$/, '');
}

async function resolveCredentials(): Promise<{ url: string; token: string }> {
  // DB is the source of truth.
  try {
    const creds = await getSystemGatewayCredentials(getDb(), env.MINION_GATEWAY_PRIMARY_URL);
    if (creds) return { url: toWsUrl(creds.url), token: creds.token };
  } catch (err) {
    console.warn('[gateway-rpc] DB credential lookup failed, trying env fallback', err);
  }
  // Bootstrap fallback (empty DB).
  const fallbackUrl = env.MINION_GATEWAY_URL ?? env.OPENCLAW_GATEWAY_URL ?? '';
  const fallbackToken = env.OPENCLAW_GATEWAY_TOKEN ?? '';
  if (!fallbackUrl) throw new Error('No gateway host in DB and MINION_GATEWAY_URL is not set');
  if (!fallbackToken)
    throw new Error('No gateway token in DB and OPENCLAW_GATEWAY_TOKEN is not set');
  return { url: toWsUrl(fallbackUrl), token: fallbackToken };
}

/**
 * Call a gateway RPC over a one-shot WebSocket and return the result.
 */
export async function gatewayCall<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { url, token } = await resolveCredentials();

  // Origin header must match an entry in gateway.controlUi.allowedOrigins so
  // minion-control-ui+ui can bypass device-auth for admin scopes. Node ws
  // omits Origin by default; we set it explicitly to the hub's public URL.
  const origin =
    env.MINION_HUB_ORIGIN ||
    (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '') ||
    'https://hub.minion-ai.org';

  return new Promise<T>((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { Origin: origin } });
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
                id: 'minion-control-ui',
                version: '1.0',
                platform: 'node',
                mode: 'ui',
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
  const res = await gatewayCall<
    | { entries?: PluginUiManifestOccupant[]; occupants?: PluginUiManifestOccupant[] }
    | PluginUiManifestOccupant[]
  >('plugins.ui.list', {});
  if (Array.isArray(res)) return res;
  return res?.entries ?? res?.occupants ?? [];
}
