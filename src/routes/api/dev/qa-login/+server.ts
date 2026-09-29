import type { RequestEvent, RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { isDevQaLoginAvailable, requireDevBackend } from '$server/dev-backend';
import { checkRateLimit } from '$server/auth/rate-limit';
import { invalidateCachedIdentity, identityCacheKey } from '$server/auth/identity-cache';
import { supabaseAdmin, supabaseServer } from '$server/supabase';
import {
  listDevQaLoginUsers,
  normalizeEligibleQaEmail,
} from '$server/services/dev-qa-login.service';

const LIST_LIMIT = 60;
const LOGIN_LIMIT = 30;
const loginSchema = z.object({ userId: z.string().uuid() }).strict();
const noStore = { 'cache-control': 'no-store' };

function clientAddress(event: RequestEvent): string {
  try {
    return event.getClientAddress();
  } catch {
    return 'unknown';
  }
}

function hasSameOriginEvidence(request: Request, requestUrl: URL): boolean {
  const origin = request.headers.get('origin');
  if (origin && origin !== requestUrl.origin) return false;
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  return origin === requestUrl.origin || site === 'same-origin' || site === 'none';
}

function guardDevLoopback(locals: App.Locals, url: URL): Response | null {
  requireDevBackend(locals);
  return isDevQaLoginAvailable(locals, url)
    ? null
    : json({ error: 'not_found' }, { status: 404, headers: noStore });
}

export const GET: RequestHandler = async (event) => {
  const denied = guardDevLoopback(event.locals, event.url);
  if (denied) return denied;
  const ip = clientAddress(event);
  if (!checkRateLimit(`dev-qa-login-list:${ip}`, LIST_LIMIT)) {
    return json({ error: 'rate_limited' }, { status: 429, headers: noStore });
  }
  try {
    return json(await listDevQaLoginUsers(), { headers: noStore });
  } catch {
    return json({ error: 'qa_login_unavailable' }, { status: 503, headers: noStore });
  }
};

export const POST: RequestHandler = async (event) => {
  const { locals, request, url, cookies } = event;
  requireDevBackend(locals);
  if (!isDevQaLoginAvailable(locals, url)) {
    return json({ error: 'not_found' }, { status: 404, headers: noStore });
  }
  if (!hasSameOriginEvidence(request, url)) {
    return json({ error: 'cross_origin' }, { status: 403, headers: noStore });
  }
  const ip = clientAddress(event);
  if (!checkRateLimit(`dev-qa-login:${ip}`, LOGIN_LIMIT)) {
    return json({ error: 'rate_limited' }, { status: 429, headers: noStore });
  }

  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_request' }, { status: 400, headers: noStore });
  }

  let admin: ReturnType<typeof supabaseAdmin>;
  let target: Awaited<ReturnType<ReturnType<typeof supabaseAdmin>['auth']['admin']['getUserById']>>;
  try {
    admin = supabaseAdmin();
    target = await admin.auth.admin.getUserById(parsed.data.userId);
  } catch {
    return json({ error: 'qa_user_unavailable' }, { status: 404, headers: noStore });
  }
  const { data: targetData, error: lookupError } = target;
  const email = normalizeEligibleQaEmail(targetData?.user?.email);
  if (lookupError || !targetData?.user || !email) {
    return json({ error: 'qa_user_unavailable' }, { status: 404, headers: noStore });
  }

  try {
    const supabase = supabaseServer(event);
    const priorSession = await supabase.auth.getSession();
    const priorToken = priorSession.data.session?.access_token ?? null;
    const priorOrg = cookies.get('active_org') ?? null;

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    if (linkError || !link?.properties?.hashed_token) throw new Error('mint failed');
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: link.properties.hashed_token,
      type: 'magiclink',
    });
    if (verifyError) throw new Error('verification failed');

    cookies.delete('active_org', { path: '/' });
    if (priorToken) invalidateCachedIdentity(identityCacheKey(priorToken, priorOrg));
    return json({ ok: true }, { headers: noStore });
  } catch {
    return json({ error: 'qa_login_failed' }, { status: 500, headers: noStore });
  }
};
