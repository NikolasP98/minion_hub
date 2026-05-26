// Runtime helper — imports $server/supabase (which needs $env shims).
// Kept separate from supabase-bridge.ts so the pure mapper stays unit-testable.
import type { RequestEvent } from '@sveltejs/kit';
import { supabaseServer, supabaseAdmin } from '$server/supabase';
import { mapProfileToUser, type BridgedUser } from './supabase-bridge.js';

export type { BridgedUser } from './supabase-bridge.js';

/**
 * Runtime: resolve the current Supabase user (if any) into the hub user shape.
 * Returns null when unauthenticated. Reads role/legacy id from public.profiles
 * via the service-role client (RLS-independent, server-side).
 */
export async function resolveSupabaseUser(event: RequestEvent): Promise<BridgedUser | null> {
  const supabase = supabaseServer(event);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabaseAdmin()
    .from('profiles')
    .select('id, email, display_name, role, legacy_user_id')
    .eq('id', user.id)
    .single();

  return mapProfileToUser(
    profile ?? {
      id: user.id,
      email: user.email ?? null,
      display_name: (user.user_metadata?.full_name as string) ?? null,
      role: null,
      legacy_user_id: null,
    },
    user.id,
  );
}
