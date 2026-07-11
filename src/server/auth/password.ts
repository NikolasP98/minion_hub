import { supabaseAdmin } from '$server/supabase';

/**
 * Whether the given Supabase user already has a password (email/password)
 * identity, as opposed to being OAuth-only (e.g. Google). Used to decide
 * "set password" vs "change password" UX and whether `currentPassword` must
 * be verified on `/api/me/password`.
 */
export async function hasPasswordIdentity(supabaseId: string): Promise<boolean> {
  const { data } = await supabaseAdmin().auth.admin.getUserById(supabaseId);
  return data.user?.identities?.some((i) => i.provider === 'email') ?? false;
}
