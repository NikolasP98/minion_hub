import { redirect, type RequestHandler } from '@sveltejs/kit';
import { supabaseServer, supabaseAdmin } from '$server/supabase';
import { syncGoogleLogin } from '$server/auth/identity-sync';
import { sealSecret } from '@minion-stack/db/pg';

export const GET: RequestHandler = async (event) => {
  const code = event.url.searchParams.get('code');
  const next = event.url.searchParams.get('next') ?? '/';
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
