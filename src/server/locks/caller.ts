import { json, type RequestEvent } from '@sveltejs/kit';
import type { CoreCtx } from '$server/auth/core-ctx';
import { checkSharedRateLimit } from '$server/auth/shared-rate-limit';
import { getCoreDb } from '$server/db/pg-client';
import { touchKey, verifyKey } from '$server/services/org-api-keys.service';
import { HookError } from '$server/services/record-locks.logic';

/**
 * Who calls `POST /api/hooks/record-locks` (spec 140 S4) — the only place this is decided.
 * An org API key with the `locks` scope, nothing else; a cookie identity is never read. The
 * organization comes from the key, never from the body. Pattern: `src/server/mcp/caller.ts`.
 */
export interface LocksCaller {
  ctx: CoreCtx;
  key: { id: string; name: string };
}

const CALLS_PER_MINUTE = 60;
const TOUCH_AFTER_MS = 60_000;

/** The JSON refusal every hook failure uses: `{ error, code, next }`. */
export function hookRefusal(e: HookError): Response {
  return json(
    { error: e.message, code: e.code, next: e.next },
    {
      status: e.status,
      headers: {
        'cache-control': 'no-store',
        ...(e.code === 'too_many' ? { 'retry-after': '60' } : {}),
      },
    },
  );
}

export async function resolveLocksCaller(
  event: Pick<RequestEvent, 'request'>,
): Promise<Response | LocksCaller> {
  const auth = event.request.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer mk_')) return hookRefusal(new HookError('unauthorized'));
  const key = await verifyKey(auth.slice('Bearer '.length));
  if (!key) return hookRefusal(new HookError('unauthorized'));
  if (!key.scopes.includes('locks')) return hookRefusal(new HookError('scope_required'));
  if (!(await checkSharedRateLimit(`locks-key:${key.id}`, CALLS_PER_MINUTE)))
    return hookRefusal(new HookError('too_many'));
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > TOUCH_AFTER_MS)
    await touchKey(key.id);
  // Acts for the key's organization alone.
  return {
    ctx: { db: getCoreDb(), tenantId: key.orgId },
    key: { id: key.id, name: key.name },
  };
}
