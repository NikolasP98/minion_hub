import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireDevBackend } from '$server/dev-backend';
import { requireAuth } from '$server/auth/authorize';
import { supabaseAdmin, supabaseServer } from '$server/supabase';
import { checkRateLimit } from '$server/auth/rate-limit';
import { invalidateCachedIdentity } from '$server/auth/identity-cache';

/**
 * JSON POSTs bypass SvelteKit's form-action CSRF check (that only inspects
 * form-encoded content types), so this handler does its own same-origin
 * check. Default-deny: an absent/mismatched Sec-Fetch-Site AND an
 * absent/mismatched Origin both fail closed.
 */
function assertSameOrigin(request: Request, requestUrl: URL): void {
  const site = request.headers.get('sec-fetch-site');
  if (site) {
    if (site === 'same-origin' || site === 'none') return;
    throw error(403, 'cross-origin request rejected');
  }
  const origin = request.headers.get('origin');
  if (origin && origin === requestUrl.origin) return;
  throw error(403, 'cross-origin request rejected');
}

/**
 * POST /api/dev/switch-user { userId } — spec §2.2. Mints a real GoTrue
 * session for `userId` password-lessly (generateLink + verifyOtp), clears
 * `active_org` so the target lands on their own first org, and evicts the
 * outgoing session's identity-cache entry. DEV-only (404 elsewhere); any
 * authenticated role may switch.
 */
export const POST: RequestHandler = async (event) => {
  const { locals, request, cookies, url } = event;
  requireDevBackend(locals);
  requireAuth(locals);
  assertSameOrigin(request, url);

  let ip = 'unknown';
  try {
    ip = event.getClientAddress();
  } catch {
    // unavailable in some test/adapter contexts
  }
  if (!checkRateLimit(`dev-switch-user:${ip}`)) {
    return json({ error: 'rate_limited' }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as { userId?: unknown };
  if (typeof body.userId !== 'string' || !body.userId) throw error(400, 'userId required');

  const admin = supabaseAdmin();
  const { data: target, error: getErr } = await admin.auth.admin.getUserById(body.userId);
  if (getErr || !target?.user?.email) throw error(404, 'unknown user');
  const email = target.user.email;

  // Capture the OUTGOING session's cache key before verifyOtp overwrites the
  // cookies — resolveViaSupabase keys the identity cache on (access token,
  // active_org cookie) (src/server/auth/identity-cache.ts).
  const supabase = supabaseServer(event);
  const priorSession = await supabase.auth.getSession();
  const priorToken = priorSession.data.session?.access_token ?? null;
  const priorOrg = cookies.get('active_org') ?? null;

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkErr || !link?.properties?.hashed_token) throw error(500, 'failed to mint dev session');

  const { error: verifyErr } = await supabase.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'magiclink',
  });
  if (verifyErr) throw error(500, 'failed to switch user');

  // Land the target on their own first org, not the previous user's.
  cookies.delete('active_org', { path: '/' });
  if (priorToken) invalidateCachedIdentity(`${priorToken}\x00${priorOrg ?? ''}`);

  return json({ ok: true, user: { id: target.user.id, email } });
};

/** A bare GET must not reveal the route exists outside the DEV backend (405
 *  would); on DEV it is simply the wrong method. */
export const GET: RequestHandler = ({ locals }) => {
  requireDevBackend(locals);
  throw error(405, 'method not allowed');
};
