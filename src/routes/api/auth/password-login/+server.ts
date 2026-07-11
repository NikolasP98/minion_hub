import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { supabaseAdmin, supabaseServer } from '$server/supabase';
import { normalizeUsername } from '$server/auth/username';
import { checkRateLimit } from '$server/auth/rate-limit';

const invalidCredentials = () => json({ error: 'invalid_credentials' }, { status: 401 });

/**
 * POST /api/auth/password-login — sign in with EITHER email or username +
 * password. Server-side (not a direct client `signInWithPassword` call) so
 * username→email resolution never leaks which emails exist to the client.
 * Unknown username and wrong password return the SAME generic 401 shape —
 * no enumeration signal either way.
 */
export const POST: RequestHandler = async (event) => {
  const body = (await event.request.json().catch(() => ({}))) as {
    identifier?: unknown;
    password?: unknown;
  };
  if (typeof body.identifier !== 'string' || typeof body.password !== 'string') {
    throw error(400, 'identifier and password required');
  }
  const identifier = body.identifier.trim();
  if (!identifier || !body.password) throw error(400, 'identifier and password required');

  // Key on IP + identifier: identifier-only would let an attacker lock a
  // victim out of their own login by spamming their username.
  let ip = 'unknown';
  try {
    ip = event.getClientAddress();
  } catch {
    // unavailable in some test/adapter contexts
  }
  if (!checkRateLimit(`login:${ip}:${identifier.toLowerCase()}`)) {
    return json({ error: 'rate_limited' }, { status: 429 });
  }

  let email: string;
  if (identifier.includes('@')) {
    email = identifier;
  } else {
    const username = normalizeUsername(identifier);
    if (!username) return invalidCredentials();
    const { data } = await supabaseAdmin()
      .from('profiles')
      .select('email')
      .eq('username', username)
      .maybeSingle();
    if (!data?.email) return invalidCredentials();
    email = data.email;
  }

  const { error: signInError } = await supabaseServer(event).auth.signInWithPassword({
    email,
    password: body.password,
  });
  if (signInError) return invalidCredentials();

  return json({ ok: true });
};
