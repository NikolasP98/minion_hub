import { createWorkforceClient, type WorkforceClient } from '@minion-stack/workforce-client';
import * as workforceTransport from '@minion-stack/workforce-client';
import { env } from '$env/dynamic/private';
import type { RequestEvent } from '@sveltejs/kit';
import { mintWorkforceIdentity } from './workforce-identity';
import { hubBaseUrl } from '$server/config/urls';

type WorkforceHttpCode =
  | 'http_error'
  | 'invalid_json'
  | 'response_too_large'
  | 'deadline_exceeded'
  | 'request_aborted'
  | 'transport_error';

/** A local diagnostic projection, never an upstream body/cause container. */
export class WorkforceHttpError extends Error {
  declare readonly status?: number;
  declare readonly upstreamStatus?: number;

  constructor(
    readonly code: WorkforceHttpCode,
    status?: number,
    upstreamStatus?: number,
  ) {
    super(`workforce ${code}`);
    this.name = 'WorkforceHttpError';
    if (status !== undefined) this.status = status;
    if (upstreamStatus !== undefined) this.upstreamStatus = upstreamStatus;
  }
}

function safeFailure(cause: unknown): WorkforceHttpError {
  if (cause instanceof WorkforceHttpError) {
    return new WorkforceHttpError(cause.code, cause.status, cause.upstreamStatus);
  }
  if (cause instanceof workforceTransport.WorkforceApiError) {
    const status = cause.status;
    if (Number.isInteger(status) && status >= 400 && status <= 599) {
      return new WorkforceHttpError('http_error', status, status);
    }
    return new WorkforceHttpError(
      'invalid_json',
      502,
      Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined,
    );
  }
  // The installed0.3.0 API predates this export. Recognize only the actual selected
  // constructor; a native error with a forged code/status is still a transport error.
  const PolicyError: unknown = Reflect.get(workforceTransport, 'WorkforceRequestError');
  if (typeof PolicyError === 'function' && cause instanceof PolicyError) {
    const code: unknown = Reflect.get(cause, 'code');
    if (code === 'request_aborted') return new WorkforceHttpError(code);
    if (code === 'deadline_exceeded') return new WorkforceHttpError(code, 504);
    if (code === 'response_too_large') return new WorkforceHttpError(code, 502);
  }
  return new WorkforceHttpError('transport_error', 502);
}

function projectedClient(options: Parameters<typeof createWorkforceClient>[0]): WorkforceClient {
  const client = createWorkforceClient(options);
  const request = client.request.bind(client);
  // Namespace factories retain this exact base object and read request dynamically.
  client.request = async <T>(args: Parameters<WorkforceClient['request']>[0]): Promise<T> => {
    try {
      return await request<T>(args);
    } catch (cause) {
      throw safeFailure(cause);
    }
  };
  return client;
}

// TODO(handoff): Candidate transport honors these structural options; installed0.3.0
// ignores them. Exact package/lock adoption remains required before claiming bounds.
// See proposals/2026-09-08-platform-qc-remediation.md, Workforce candidate JSON transport.
const transportPolicy = { timeoutMs: 30_000, maxResponseBytes: 4 * 1024 * 1024 };

/**
 * Base URL of the Workforce backend. `WORKFORCE_INTERNAL_URL` is the canonical
 * name; `PAPERCLIP_INTERNAL_URL` is read as a compat fallback during the
 * paperclip→workforce rename so the env cutover has no outage window.
 */
export function baseUrl(): string {
  return env.WORKFORCE_INTERNAL_URL ?? env.PAPERCLIP_INTERNAL_URL ?? 'http://workforce:3200';
}

/**
 * Pick the right auth header for the current workforce identity.
 *
 * Two auth modes are supported:
 *  - Board-key fallback: tokens prefixed `pcli_`. The Workforce backend's
 *    `server/src/middleware/auth.ts` only accepts these as `Authorization: Bearer <token>`.
 *  - User-scoped JWT minted via HUB_WORKFORCE_SHARED_SECRET: preferred for Hub
 *    requests because it carries the signed actor and role keys; consumed by
 *    the backend's `middleware/hub-identity.ts` via `x-hub-identity`.
 *
 * Sending the wrong header → backend 403 "Board access required" and every
 * workforce server-loader returns "workforce unavailable". See memory
 * `reference_hub_paperclip_auth_header_split` — the fix has regressed once
 * across a merge boundary (2026-05-12 → re-applied 2026-05-13 PR #43).
 */
export function authHeaders(token: string): Record<string, string> {
  return token.startsWith('pcli_')
    ? { Authorization: `Bearer ${token}` }
    : { 'x-hub-identity': token };
}

/**
 * Canonical public boundary asserted on trusted Hub→Workforce mutations.
 * Never derive these values from the inbound Host/Origin headers.
 */
export function trustedWorkforceMutationHeaders(): Record<string, string> {
  const publicHub = new URL(hubBaseUrl());
  return {
    origin: publicHub.origin,
    referer: `${publicHub.origin}/`,
    'x-forwarded-host': publicHub.host,
    'x-forwarded-proto': publicHub.protocol.slice(0, -1),
  };
}

export function workforceServerClient(event: RequestEvent): WorkforceClient {
  try {
    const token = event.locals.workforceIdentity?.token;
    if (!token) throw new Error('workforceIdentity not populated by hooks');
    const options = {
      baseUrl: baseUrl(),
      fetch: globalThis.fetch,
      headers: authHeaders(token),
      signal: event.request.signal,
      ...transportPolicy,
    };
    return projectedClient(options);
  } catch (cause) {
    throw safeFailure(cause);
  }
}

/**
 * JSON-response fetch preserving the caller's already serialized request body.
 * Streaming response consumers belong to the separate Workforce proxy boundary.
 */
export async function workforceRawFetch<T = unknown>(
  event: RequestEvent,
  path: string,
  init?: RequestInit,
): Promise<T> {
  try {
    const token = event.locals.workforceIdentity?.token;
    if (!token) throw new Error('workforceIdentity not populated by hooks');
    const captured: RequestInit = { ...init };
    const headers = new Headers(authHeaders(token));
    if (captured.body) headers.set('content-type', 'application/json');
    new Headers(captured.headers).forEach((value, key) => headers.set(key, value));
    captured.headers = headers;
    captured.method ??= 'GET';
    const callerSignal = captured.signal ?? undefined;
    const fetchAdapter: typeof globalThis.fetch = (input, boundedInit) =>
      globalThis.fetch(input, { ...captured, signal: boundedInit?.signal ?? callerSignal });
    const options = {
      baseUrl: baseUrl(),
      fetch: fetchAdapter,
      signal: event.request.signal,
      ...transportPolicy,
    };
    const client = projectedClient(options);
    // Private GET placeholder: the adapter restores the captured method/body/options.
    // Never pass body here: it is already serialized and must reach fetch unchanged.
    const args = { method: 'GET' as const, path, signal: callerSignal };
    return await client.request<T>(args);
  } catch (cause) {
    throw safeFailure(cause);
  }
}

/**
 * A workforce client for use OUTSIDE a request (e.g. the projects-module task
 * dispatcher). Prefers the board key (prod auth mode); otherwise mints a short
 * hub-identity JWT scoped to the org. Either header is selected by authHeaders.
 * Throws if neither HUB_WORKFORCE_BOARD_KEY nor the mint secret is available —
 * callers treat dispatch as best-effort and swallow.
 */
export async function workforceClientForOrg(
  orgId: string,
  actor?: { id?: string | null; name?: string | null; email?: string | null },
): Promise<WorkforceClient> {
  try {
    // Same board-key fallback chain the hooks use (hooks.server workforceIdentityHandle):
    // prod is configured with the compat HUB_PAPERCLIP_BOARD_KEY name, so checking
    // only HUB_WORKFORCE_BOARD_KEY found nothing and fell back to a mint secret that
    // isn't set — the bug that made the sync + dispatch silently no-op.
    const boardKey = (env.HUB_WORKFORCE_BOARD_KEY ?? env.HUB_PAPERCLIP_BOARD_KEY)?.trim();
    // Mint as the REAL acting user (matching the per-request identity the hooks
    // mint for /workforce pages) — the backend authorizes the company-scoped
    // endpoints against a known board member, so a synthetic 'system' user is
    // rejected. Falls back to 'system' only when no actor is supplied.
    const token =
      boardKey && boardKey.length > 0
        ? boardKey
        : await mintWorkforceIdentity({
            userId: actor?.id ?? 'system',
            email: actor?.email ?? null,
            name: actor?.name ?? 'Projects',
            companyId: orgId,
            roleKeys: [],
          });
    const options = {
      baseUrl: baseUrl(),
      fetch: globalThis.fetch,
      headers: authHeaders(token),
      ...transportPolicy,
    };
    return projectedClient(options);
  } catch (cause) {
    throw safeFailure(cause);
  }
}

// TODO(handoff): Safe helper errors do not change loaders that swallow cancellation,
// route-local DB/schema errors, the separate streaming proxy or upload stubs. Runtime
// schemas and those consumer policies remain open in the Workforce proposal above.
