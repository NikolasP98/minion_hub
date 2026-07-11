import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { supabaseServer } from '$server/supabase';
import { checkRateLimit } from '$server/auth/rate-limit';

/**
 * POST /api/auth/reset-password — completes a forgot-password flow. Verifies
 * the single-use recovery token (from the emailed /auth/reset link) and sets
 * the new password in one step, so the token is only ever consumed by an
 * explicit user submit — never by an email scanner prefetching the page.
 * The verifyOtp call sets the SSR session cookies, leaving the user signed in.
 */
export const POST: RequestHandler = async (event) => {
  const body = (await event.request.json().catch(() => ({}))) as {
    tokenHash?: unknown;
    newPassword?: unknown;
  };
  if (typeof body.tokenHash !== 'string' || !body.tokenHash) {
    throw error(400, 'tokenHash required');
  }
  if (
    typeof body.newPassword !== 'string' ||
    body.newPassword.length < 8 ||
    body.newPassword.length > 72
  ) {
    throw error(400, 'newPassword must be 8-72 characters');
  }

  let ip = 'unknown';
  try {
    ip = event.getClientAddress();
  } catch {
    // unavailable in some test/adapter contexts
  }
  if (!checkRateLimit(`reset:${ip}`)) {
    return json({ error: 'rate_limited' }, { status: 429 });
  }

  const supabase = supabaseServer(event);
  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: 'recovery',
    token_hash: body.tokenHash,
  });
  if (verifyError) return json({ error: 'invalid_token' }, { status: 400 });

  const { error: updateError } = await supabase.auth.updateUser({
    password: body.newPassword,
  });
  if (updateError) return json({ error: 'update_failed' }, { status: 500 });

  // A reset proves email control, not that other sessions are legitimate —
  // revoke everything except the fresh recovery session.
  await supabase.auth.signOut({ scope: 'others' }).catch(() => {});

  return json({ ok: true });
};
