import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { env as publicEnv } from '$env/dynamic/public';
import { requireAuth } from '$server/auth/authorize';
import { supabaseAdmin } from '$server/supabase';
import { hasPasswordIdentity } from '$server/auth/password';

/**
 * POST /api/me/password — set (OAuth-only user) or change (already has a
 * password identity) the current user's password. When a password identity
 * already exists, `currentPassword` is required and verified via a
 * throwaway, non-persisting anon client before the admin update runs.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  const user = requireAuth(locals);
  const supabaseId = user.supabaseId;
  if (!supabaseId) throw error(400, 'no supabase profile for this user');

  const body = (await request.json().catch(() => ({}))) as {
    currentPassword?: unknown;
    newPassword?: unknown;
  };
  if (
    typeof body.newPassword !== 'string' ||
    body.newPassword.length < 8 ||
    body.newPassword.length > 72
  ) {
    throw error(400, 'newPassword must be 8-72 characters');
  }

  const hadPassword = await hasPasswordIdentity(supabaseId);

  if (hadPassword) {
    if (typeof body.currentPassword !== 'string' || !body.currentPassword) {
      throw error(400, 'currentPassword required');
    }
    const anon = createClient(
      publicEnv.PUBLIC_SUPABASE_URL ?? '',
      publicEnv.PUBLIC_SUPABASE_ANON_KEY ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error: verifyError } = await anon.auth.signInWithPassword({
      email: user.email,
      password: body.currentPassword,
    });
    if (verifyError) return json({ error: 'wrong_password' }, { status: 400 });
  }

  const { error: updateError } = await supabaseAdmin().auth.admin.updateUserById(supabaseId, {
    password: body.newPassword,
  });
  if (updateError) throw error(500, 'password update failed');

  return json({ ok: true, hadPassword });
};
