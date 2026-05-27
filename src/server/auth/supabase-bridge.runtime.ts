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

  const admin = supabaseAdmin();

  // CORE identity columns only. These must resolve for org-membership lookup to
  // work (legacy_user_id keys the Turso member rows). NEVER add additive columns
  // here: if a not-yet-migrated column is requested, PostgREST errors the whole
  // query, profile comes back null, and we'd fall back to legacy_user_id:null —
  // which silently breaks login (user gets bounced to /join). Enrichment columns
  // are fetched best-effort below.
  const { data: profile } = await admin
    .from('profiles')
    .select('id, email, display_name, role, legacy_user_id')
    .eq('id', user.id)
    .single();

  // Best-effort enrichment (avatar_url, created_at). Tolerates the columns not
  // existing yet (migration lag): on error `extra` is null and we degrade to the
  // Google metadata avatar / null — login is unaffected.
  const metadataAvatar =
    (user.user_metadata?.avatar_url as string) ??
    (user.user_metadata?.picture as string) ??
    null;
  let avatar_url: string | null = metadataAvatar;
  let created_at: string | null = null;
  const { data: extra } = await admin
    .from('profiles')
    .select('avatar_url, created_at')
    .eq('id', user.id)
    .single();
  if (extra) {
    avatar_url = (extra.avatar_url as string | null) ?? metadataAvatar;
    created_at = (extra.created_at as string | null) ?? null;
  }

  return mapProfileToUser(
    profile
      ? { ...profile, avatar_url, created_at }
      : {
          id: user.id,
          email: user.email ?? null,
          display_name: (user.user_metadata?.full_name as string) ?? null,
          avatar_url,
          role: null,
          legacy_user_id: null,
          created_at,
        },
    user.id,
  );
}
