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
 * Credentials come from the encrypted Supabase `gateway` row (per-user via
 * `user_gateway`, else system-wide), not from env vars. The
 * `OPENCLAW_GATEWAY_TOKEN` / `MINION_GATEWAY_URL` env vars remain only as
 * a one-time bootstrap fallback for fresh deployments with an empty DB.
 */
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

const env = process.env;

import type { PluginUiManifestOccupant } from '$lib/plugins/plugin-types';
import { hubBaseUrl } from '$server/config/urls';
import { currentBuildChannel } from '$server/gateway-channel';
import type { GatewayChannel } from '$server/services/gateway.pg.service';

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

/** Resolve the gateway HTTP base URL for a specific user (per-user PG creds).
 * Pass the caller's active `orgId` (when known) to honor per-org assignment. */
export async function getGatewayHttpUrlForUser(
  profileId: string | undefined,
  orgId?: string | null,
  channel?: GatewayChannel,
): Promise<string> {
  const { url } = await resolveCredentialsForUser(profileId, orgId, channel);
  return toHttpUrl(url).replace(/\/+$/, '');
}

/**
 * Resolve gateway credentials for a specific user.
 * Priority: (org, channel) lease → PG per-user → PG system-wide → env bootstrap.
 *
 * `orgId` is the caller's ACTIVE org (optional — thread it from locals/
 * resolveAssistantPrincipal where available).
 *
 * `channel` is the BUILD CHANNEL the caller selected; omitted, it comes from the
 * request-ambient `currentBuildChannel()`, which is `'prd'` unless the browser
 * explicitly asked for `'dev'`. Every step below is channel-aware, because the
 * dev rows are the newest rows and a channel-blind pick reached them: this
 * function and the browser must land on the SAME instance (spec §D4) or the
 * client/server split that caused the all-day intermittency comes straight back.
 */
export async function resolveCredentialsForUser(
  profileId: string | undefined,
  orgId?: string | null,
  channel?: GatewayChannel,
): Promise<{ url: string; token: string }> {
  const chan = channel ?? currentBuildChannel();
  // 0. The (org, channel) lease — ONE authority for which instance serves this
  //    org on this channel, shared with the endpoint the browser connects to.
  //    Miss (org has no row for the channel) or error → fall through.
  if (orgId) {
    try {
      const { resolveOrgChannelCredentials } =
        await import('$server/services/gateway-lease.service');
      const creds = await resolveOrgChannelCredentials(orgId, chan);
      if (creds) return { url: toWsUrl(creds.url), token: creds.token };
    } catch (err) {
      console.warn('[gateway-rpc] org channel lease lookup failed, falling back', err);
    }
  }
  // 1. Per-user PG lookup (new primary path).
  if (profileId && orgId) {
    try {
      const { getUserGatewayCredentials } = await import('$server/services/gateway.pg.service');
      const creds = await getUserGatewayCredentials(profileId, orgId, chan);
      if (creds) return { url: toWsUrl(creds.url), token: creds.token };
    } catch (err) {
      // Wave 1: catch covers both the dynamic import() and getUserGatewayCredentials().
      // A PG runtime error is currently demoted to a warn + Turso fallback — acceptable
      // for the transition period. Wave 2: split the catch so only the import() failure
      // is silenced and runtime errors propagate.
      console.warn('[gateway-rpc] PG per-user lookup failed, falling back to Turso', err);
    }
  }
  // 2. PG system-wide fallback (no per-user link or no profile context).
  try {
    const { getSystemGatewayCredentials } = await import('$server/services/gateway.pg.service');
    const creds = await getSystemGatewayCredentials(env.MINION_GATEWAY_PRIMARY_URL);
    if (creds) return { url: toWsUrl(creds.url), token: creds.token };
  } catch (err) {
    console.warn('[gateway-rpc] PG system credential lookup failed, trying env fallback', err);
  }
  // 3. Bootstrap env fallback.
  const fallbackUrl = env.MINION_GATEWAY_URL ?? env.OPENCLAW_GATEWAY_URL ?? '';
  const fallbackToken = env.OPENCLAW_GATEWAY_TOKEN ?? '';
  if (!fallbackUrl) throw new Error('No gateway configured. Add a gateway in Settings → Gateways.');
  if (!fallbackToken) throw new Error('No gateway token configured.');
  return { url: toWsUrl(fallbackUrl), token: fallbackToken };
}

async function resolveCredentials(): Promise<{ url: string; token: string }> {
  return resolveCredentialsForUser(undefined);
}

/**
 * Low-level WS call with explicit credentials. Extracted so both gatewayCall
 * and gatewayCallAsUser can share the same transport logic.
 */
async function gatewayCallWithCreds<T = unknown>(
  method: string,
  params: Record<string, unknown>,
  url: string,
  token: string,
  opts: {
    timeoutMs?: number;
    onEvent?: (event: string, payload: unknown) => void;
    /**
     * Hub-signed gateway JWT (see gateway-jwt.service.ts) carrying an
     * RBAC-validated `orgId` claim. The shared operator token alone is not an
     * org-scoping credential — every hub session (browser and server) holds
     * the same token, so the gateway cannot tell them apart by token alone.
     * Passing this lets org-scoped gateway RPCs (shells.*) trust `orgId` from
     * validated connect-time identity instead of an unauthenticated param.
     */
    jwt?: string;
  } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Origin header must match an entry in gateway.controlUi.allowedOrigins so
  // minion-control-ui+ui can bypass device-auth for admin scopes. Node ws
  // omits Origin by default; we set it explicitly to the hub's public URL.
  const origin =
    env.MINION_HUB_ORIGIN ||
    (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '') ||
    hubBaseUrl();

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

    // "(request sent)" marks failures that happened AFTER the request was
    // dispatched — for restart-inducing calls (update.run, config.patch) a
    // drop/timeout at that stage usually means the gateway is restarting, not
    // that the call failed. Callers can match on it to soften the error.
    const timer = setTimeout(
      () => fail(new Error(`gateway RPC timeout${requestId ? ' (request sent)' : ''}`)),
      timeoutMs,
    );
    timer.unref?.();

    ws.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))));
    ws.on('close', () =>
      fail(new Error(`gateway WS closed before response${requestId ? ' (request sent)' : ''}`)),
    );

    ws.on('message', (raw) => {
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        return;
      }
      const type = frame.type;
      // Broadcast events arrive on this socket while a long call (update.run)
      // is in flight — the fleet orchestrator uses them for true progress.
      if (
        type === 'event' &&
        typeof frame.event === 'string' &&
        frame.event !== 'connect.challenge' &&
        opts.onEvent
      ) {
        try {
          opts.onEvent(frame.event, frame.payload ?? frame.data ?? null);
        } catch {
          /* observer must never break the call */
        }
      }
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
              ...(opts.jwt ? { jwt: opts.jwt } : {}),
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

/**
 * Call a gateway RPC over a one-shot WebSocket and return the result.
 * Uses system-wide credentials (PG `gateway` row → env bootstrap fallback).
 */
export async function gatewayCall<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const { url, token } = await resolveCredentials();
  return gatewayCallWithCreds<T>(method, params, url, token, opts);
}

/**
 * Call a gateway RPC using per-user credentials resolved from PG.
 * Falls back to system-wide Turso creds and env if no per-user row exists.
 * `opts.orgId` (the caller's active org) routes through the (org, channel)
 * lease when one exists; omitted → old chain. `opts.channel` overrides the
 * request-ambient build channel — pass it only when the call is deliberately
 * about a specific channel (fleet tooling), never to "pick a working one".
 */
export async function gatewayCallAsUser<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  profileId: string | undefined,
  opts: {
    timeoutMs?: number;
    orgId?: string | null;
    jwt?: string;
    channel?: GatewayChannel;
  } = {},
): Promise<T> {
  const { url, token } = await resolveCredentialsForUser(profileId, opts.orgId, opts.channel);
  return gatewayCallWithCreds<T>(method, params, url, token, opts);
}

/**
 * Call a gateway RPC against a SPECIFIC instance by its own url + decrypted
 * token — bypasses user/org credential resolution entirely. Used by the
 * fleet-update orchestrator (spec §3.2), which already holds each gateway
 * row's own creds and must address instances individually rather than
 * whichever one resolveCredentials* would pick.
 */
export async function gatewayCallToInstance<T = unknown>(
  url: string,
  token: string,
  method: string,
  params: Record<string, unknown> = {},
  opts: { timeoutMs?: number; onEvent?: (event: string, payload: unknown) => void } = {},
): Promise<T> {
  return gatewayCallWithCreds<T>(method, params, toWsUrl(url), token, opts);
}

// alert-watcher is surfaced as the Triage autonomous agent, not a plugin.
const HIDDEN_PLUGIN_IDS = new Set(['alert-watcher', 'alerts']);

/**
 * Convenience: list plugin UI manifest occupants for a specific user.
 *
 * `orgId` scopes the per-plugin `orgEnabled` flag: the hub's gateway connection
 * authenticates with an admin/system token (no org claim), so the acting user's
 * org must be passed explicitly for the gateway to compute org-scoped enable
 * state. Omit for a global/unscoped view.
 */
export async function pluginsUiList(
  profileId?: string | undefined,
  orgId?: string | undefined,
): Promise<PluginUiManifestOccupant[]> {
  const res = await gatewayCallAsUser<
    | { entries?: PluginUiManifestOccupant[]; occupants?: PluginUiManifestOccupant[] }
    | PluginUiManifestOccupant[]
  >('plugins.ui.list', orgId ? { orgId } : {}, profileId);
  const raw = Array.isArray(res) ? res : (res?.entries ?? res?.occupants ?? []);
  return raw.filter((e) => !HIDDEN_PLUGIN_IDS.has(e.pluginId));
}
