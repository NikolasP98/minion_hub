// Pure mapper — no $env or SvelteKit runtime imports.
// The runtime helper (resolveSupabaseUser) that needs $server/supabase lives in
// supabase-bridge.runtime.ts so this file remains unit-testable without the vite
// $env/static/public shim.

export type UserRole = 'user' | 'admin';

export interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url?: string | null;
  role: UserRole | null;
  created_at?: string | null;
}

export interface BridgedUser {
  id: string; // canonical Supabase profile uuid (== supabaseId)
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: UserRole;
  supabaseId: string;
  createdAt: string | null;
}

/**
 * Pure: profiles row + supabase uuid -> hub locals.user shape.
 *
 * `id` is the canonical Supabase profile uuid. The legacy_user_id bridge was
 * fully removed in S7 (GoTrue: auth.users.id == profiles.id), so every principal
 * id is already the profile uuid.
 */
export function mapProfileToUser(profile: ProfileRow, supabaseId: string): BridgedUser {
  const role = profile.role === 'admin' ? 'admin' : 'user';
  return {
    id: supabaseId,
    email: profile.email ?? '',
    displayName: profile.display_name ?? null,
    avatarUrl: profile.avatar_url ?? null,
    role,
    supabaseId,
    createdAt: profile.created_at ?? null,
  };
}
