import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { supabaseAdmin } from '$server/supabase';
import { normalizeUsername } from '$server/auth/username';
import { checkRateLimit } from '$server/auth/rate-limit';
import { sendPasswordResetEmail } from '$server/services/email.service';
import { hubBaseUrl } from '$server/config/urls';
import { dev } from '$app/environment';

const OK = () => json({ ok: true });

/**
 * POST /api/auth/forgot-password — always returns 200 regardless of whether
 * the identifier resolves to a real account, so the response never leaks
 * which usernames/emails exist. Resolves username→email the same way
 * password-login does.
 */
export const POST: RequestHandler = async (event) => {
  const body = (await event.request.json().catch(() => ({}))) as { identifier?: unknown };
  if (typeof body.identifier !== 'string' || !body.identifier.trim()) return OK();
  const identifier = body.identifier.trim();

  // IP + identifier key — see password-login for the lockout-DoS rationale.
  let ip = 'unknown';
  try {
    ip = event.getClientAddress();
  } catch {
    // unavailable in some test/adapter contexts
  }
  if (!checkRateLimit(`forgot:${ip}:${identifier.toLowerCase()}`)) return OK();

  const admin = supabaseAdmin();
  let email: string | null = identifier.includes('@') ? identifier : null;
  if (!email) {
    const username = normalizeUsername(identifier);
    if (username) {
      const { data } = await admin
        .from('profiles')
        .select('email')
        .eq('username', username)
        .maybeSingle();
      email = data?.email ?? null;
    }
  }

  if (email) {
    const { data, error: genError } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
    });
    const hashedToken = data?.properties?.hashed_token;
    if (!genError && hashedToken) {
      // Never derive the emailed origin from the request (Host-header reset
      // poisoning); dev keeps the localhost origin for local testing.
      const base = dev ? event.url.origin : hubBaseUrl();
      const link = `${base}/auth/reset?token_hash=${hashedToken}`;
      await sendPasswordResetEmail(email, link);
    }
  }

  return OK();
};
