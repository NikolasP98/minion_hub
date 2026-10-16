import { error } from '@sveltejs/kit';
import { supabaseAdmin } from '$server/supabase';

export async function assertWhatsAppUserActive(profileId: string, timeoutMs = 3000): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    supabaseAdmin().auth.admin.getUserById(profileId),
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(error(503, 'User authority unavailable')), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));
  const user = result.data.user as typeof result.data.user & {
    deleted_at?: string;
    banned_until?: string;
  };
  if (
    result.error ||
    !user ||
    user.id !== profileId ||
    user.deleted_at ||
    (user.banned_until &&
      (!Number.isFinite(Date.parse(user.banned_until)) ||
        Date.parse(user.banned_until) > Date.now()))
  )
    throw error(403, 'WhatsApp authority unavailable');
}
