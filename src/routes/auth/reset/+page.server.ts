import type { PageServerLoad } from './$types';
import { supabaseServer } from '$server/supabase';

export const load: PageServerLoad = async (event) => {
  const tokenHash = event.url.searchParams.get('token_hash');
  if (!tokenHash) return { ok: false as const };

  // Exchanges the recovery token for a session — sets the SSR session
  // cookies on the response so the browser Supabase client (same cookies)
  // can then call auth.updateUser({ password }) directly.
  const { error } = await supabaseServer(event).auth.verifyOtp({
    type: 'recovery',
    token_hash: tokenHash,
  });

  return { ok: !error };
};
