import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { env } from '$env/dynamic/private';
import type { RequestEvent } from '@sveltejs/kit';

/** Request-scoped client that reads/writes auth cookies on the response. */
export function supabaseServer(event: RequestEvent) {
  return createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => event.cookies.getAll(),
      setAll: (cookies) => {
        for (const { name, value, options } of cookies) {
          event.cookies.set(name, value, { ...options, path: '/' });
        }
      },
    },
  });
}

/** Service-role client — bypasses RLS. Server-only. NEVER expose to the gateway. */
export function supabaseAdmin() {
  return createClient(PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
