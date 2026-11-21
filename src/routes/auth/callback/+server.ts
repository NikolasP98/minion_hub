import { redirect, type RequestHandler } from '@sveltejs/kit';
import { supabaseServer, supabaseAdmin } from '$server/supabase';
import { syncGoogleLogin } from '$server/auth/identity-sync';
import { sealSecret } from '@minion-stack/db/pg';

/** Same-origin paths only: a root-relative path that is not protocol-relative (`//host`, `/\\host`). */
const safePath = (value: string | null | undefined) =>
  value && /^\/(?![/\\])/.test(value) ? value : null;

export const GET: RequestHandler = async (event) => {
  const code = event.url.searchParams.get('code');
  // The login page keeps the page that sent the person to sign in (e.g. an MCP approval
  // request) in a short-lived cookie: the provider round trip drops query strings.
  const kept = safePath(event.cookies.get('login_next'));
  event.cookies.delete('login_next', { path: '/auth/callback' });
  const next = kept ?? safePath(event.url.searchParams.get('next')) ?? '/home';
  if (!code) throw redirect(303, '/login?error=missing_code');

  const supabase = supabaseServer(event);
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session || !data.user) throw redirect(303, '/login?error=exchange_failed');

  const session = data.session;
  await syncGoogleLogin(supabaseAdmin(), sealSecret, {
    user: data.user as never,
    providerRefreshToken: session.provider_refresh_token ?? null,
    providerScope: (session as { provider_scope?: string }).provider_scope ?? null,
  });

  throw redirect(303, next);
};
