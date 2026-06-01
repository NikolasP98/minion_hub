import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { env as publicEnv } from '$env/dynamic/public';
import { env } from '$env/dynamic/private';
import type { RequestEvent } from '@sveltejs/kit';

const SUPABASE_URL = publicEnv.PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = publicEnv.PUBLIC_SUPABASE_ANON_KEY ?? '';

/** Request-scoped client that reads/writes auth cookies on the response. */
export function supabaseServer(event: RequestEvent) {
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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
  return createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
