import { json, type RequestEvent } from '@sveltejs/kit';
import { isAppRouteBlocked } from '$lib/modules/route-guard';
import type { CoreCtx } from '$server/auth/core-ctx';
import { checkSharedRateLimit } from '$server/auth/shared-rate-limit';
import { mapProfileToUser, type ProfileRow } from '$server/auth/supabase-bridge';
import { resolveSupabaseTenant } from '$server/auth/supabase-bridge.runtime';
import { getDb } from '$server/db/client';
import { getCoreDb } from '$server/db/pg-client';
import { loadCanonicalProfile } from '$server/services/canonical-directory.service';
import { listModuleStates } from '$server/services/modules.service';
import { resolveEntitlements } from '$server/services/entitlements.service';
import { touchKey, verifyKey } from '$server/services/org-api-keys.service';
import { endConnection, findAccess, membershipSince, touchConnection } from './oauth.service';
import { protectedResourceUrl } from './oauth-logic';
import { publicBase } from './base-url';

/**
 * Who is calling `/api/mcp` (spec 143 D4) — the ONLY place this is decided. Returns a refusal
 * or the caller. `mk_` keys keep their path untouched; `mcp_at_` is a hub-issued connection
 * credential; anything else is refused. A cookie identity is never read here.
 */
export type McpCaller =
  | { kind: 'key'; ctx: CoreCtx; keyId: string }
  | {
      kind: 'user';
      ctx: CoreCtx;
      locals: App.Locals;
      connectionId: string;
      /** The hub's own availability rule for `/sandbox` (module off, org kind, plan) — spec 143 P10. */
      sandboxBlocked: boolean;
    };

const IP_CALLS_PER_MINUTE = 300;
const CALLS_PER_MINUTE = 120;
const TOUCH_AFTER_MS = 60_000;

const refuse = (status: number, error: string) => json({ error }, { status });
const tooMany = () =>
  new Response(JSON.stringify({ error: 'Too many requests. Wait a minute and retry.' }), {
    status: 429,
    headers: { 'content-type': 'application/json', 'retry-after': '60' },
  });

/**
 * 401 with the pointer a harness follows to sign in. With no credential sent at all the header
 * carries only `resource_metadata`; with a bad one it adds the RFC 6750 `error` (and a description).
 */
export function unauthorized(error: string, credentialSent = true, description?: string): Response {
  const pointer = `Bearer resource_metadata="${protectedResourceUrl(publicBase())}"`;
  const detail = credentialSent
    ? `${pointer}, error="invalid_token"${description ? `, error_description="${description}"` : ''}`
    : pointer;
  return json({ error }, { status: 401, headers: { 'www-authenticate': detail } });
}

export async function resolveMcpCaller(
  event: Pick<RequestEvent, 'request' | 'getClientAddress'>,
): Promise<Response | McpCaller> {
  const { request } = event;
  const auth = request.headers.get('authorization') ?? '';
  const sentence = 'Send a valid API key or sign in.';

  // Prefix routing first: a key request never touches the per-address limiter (P6).
  if (auth.startsWith('Bearer mk_')) {
    const key = await verifyKey(auth.slice('Bearer '.length));
    if (!key) return unauthorized(sentence);
    if (!key.scopes.includes('sandbox'))
      return refuse(403, 'This API key does not have the "sandbox" scope.');
    if (!(await checkSharedRateLimit(`mcp-key:${key.id}`, CALLS_PER_MINUTE))) return tooMany();
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > TOUCH_AFTER_MS)
      await touchKey(key.id);
    // Acts for the key's organization alone; elements it writes have no author, only the key.
    return { kind: 'key', ctx: { db: getCoreDb(), tenantId: key.orgId }, keyId: key.id };
  }

  let ip = 'unknown';
  try {
    ip = event.getClientAddress();
  } catch {
    // unavailable in some test/adapter contexts
  }
  if (!(await checkSharedRateLimit(`mcp-ip:${ip}`, IP_CALLS_PER_MINUTE))) return tooMany();

  if (!auth.startsWith('Bearer mcp_at_')) return unauthorized(sentence, auth !== '');
  const access = await findAccess(auth.slice('Bearer '.length));
  if (!access) return unauthorized(sentence);
  if (!(await checkSharedRateLimit(`mcp-conn:${access.connectionId}`, CALLS_PER_MINUTE)))
    return tooMany();

  // Both lookups throw on an operational failure (a 500, never a refusal). A connection ends
  // only when a lookup succeeds and finds the person or the membership gone (P7).
  const profile = (await loadCanonicalProfile(access.userId)) as ProfileRow | null;
  if (!profile) {
    await endConnection(access.connectionId, null);
    return unauthorized(sentence);
  }
  const tenant = await resolveSupabaseTenant(access.userId, access.orgId);
  // The connection is bound to the membership it was approved under: a member who was removed and
  // added back has a new membership (later `created_at`), so the old connection ends here.
  const since = tenant ? await membershipSince(access.orgId, access.userId) : null;
  if (!tenant || !since || since.getTime() !== access.memberSince.getTime()) {
    await endConnection(access.connectionId, null);
    // 401, not 403: harnesses read 403 as "ask for more scope" (P8).
    return unauthorized(
      'You are no longer a member of this organization. Sign in again.',
      true,
      'The person is no longer a member of the connected organization',
    );
  }
  const [moduleStates, entitlements] = await Promise.all([
    listModuleStates({ db: getCoreDb(), tenantId: access.orgId, profileId: access.userId }),
    resolveEntitlements(access.orgId),
  ]);
  const sandboxBlocked = isAppRouteBlocked('/sandbox', {
    kind: tenant.kind,
    moduleStates,
    features: entitlements.features,
  });
  if (!access.lastUsedAt || Date.now() - access.lastUsedAt.getTime() > TOUCH_AFTER_MS)
    await touchConnection(access.connectionId);

  // Exactly what the permission service reads, nothing from any cookie (D5).
  const locals = {
    user: mapProfileToUser(profile, access.userId),
    tenantCtx: { db: getDb(), tenantId: access.orgId },
  } as unknown as App.Locals;
  return {
    kind: 'user',
    ctx: { db: getCoreDb(), tenantId: access.orgId, profileId: access.userId },
    locals,
    connectionId: access.connectionId,
    sandboxBlocked,
  };
}
