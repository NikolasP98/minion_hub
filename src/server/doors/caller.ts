import { json, type RequestEvent } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { checkSharedRateLimit } from '$server/auth/shared-rate-limit';
import { getCoreDb } from '$server/db/pg-client';
import { crmDoors } from '$server/db/pg-doors-schema';
import { touchKey, verifyKey } from '$server/services/org-api-keys.service';

// Shared across lambda instances (public_rate_limits). Without a key: per visitor address and
// door, as before keys existed (a site posting from its own server shares one address).
const SUBMIT_LIMIT = 5;
const UPLOAD_LIMIT = 40;
// With a key: per key, across every door of its organization.
const KEY_SUBMIT_LIMIT = 60;
const KEY_UPLOAD_LIMIT = 240;

const TOUCH_AFTER_MS = 60_000;

/** The door's organization, by slug: the same bypass read `resolvePublicDoor` does to pick the org. */
async function doorOrgId(slug: string): Promise<string | null> {
  const [hit] = await getCoreDb()
    .select({ orgId: crmDoors.orgId })
    .from(crmDoors)
    .where(and(eq(crmDoors.slug, slug), eq(crmDoors.active, true)))
    .limit(1);
  return hit?.orgId ?? null;
}

const fail = (status: number, code: string) => json({ error: code }, { status });

/**
 * Who is calling a public form-door endpoint (spec 121 research R2) — the ONLY place this
 * is decided. Runs before the body is read. Returns a refusal or the key that identified
 * the caller (`null` = anonymous, today's behaviour). The key text is never logged.
 */
export async function doorCaller(
  event: Pick<RequestEvent, 'request' | 'getClientAddress'>,
  slug: string,
  bucket: 'submit' | 'upload',
): Promise<Response | { keyId: string | null }> {
  const auth = event.request.headers.get('authorization') ?? '';
  // 1. No key: exactly the limiter call of before. Any other Authorization kind is ignored.
  if (!auth.startsWith('Bearer mk_')) {
    let ip = 'unknown';
    try {
      ip = event.getClientAddress();
    } catch {
      // unavailable in some test/adapter contexts
    }
    if (
      !(await checkSharedRateLimit(
        `door-${bucket}:${ip}:${slug}`,
        bucket === 'submit' ? SUBMIT_LIMIT : UPLOAD_LIMIT,
      ))
    )
      return fail(429, 'too_many');
    return { keyId: null };
  }
  // 2–3. Format check (inside verifyKey, before any query), lookup, constant-time compare.
  const key = await verifyKey(auth.slice('Bearer '.length));
  if (!key) return fail(401, 'unauthorized');
  // 4. A key of another organization than the door's is refused like an unknown one. An
  //    unknown slug continues: the service answers 404, as for any caller.
  const doorOrg = await doorOrgId(slug);
  if (doorOrg && doorOrg !== key.orgId) return fail(401, 'unauthorized');
  // 5. The key's own ceiling replaces the address limit.
  if (
    !(await checkSharedRateLimit(
      `door-key-${bucket}:${key.id}`,
      bucket === 'submit' ? KEY_SUBMIT_LIMIT : KEY_UPLOAD_LIMIT,
    ))
  )
    return fail(429, 'too_many');
  // 6. "Last used" at most a minute stale.
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > TOUCH_AFTER_MS)
    await touchKey(key.id);
  return { keyId: key.id };
}
