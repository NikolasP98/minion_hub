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
  legacy_user_id: string | null;
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
 * `id` is the canonical Supabase profile uuid — the legacy_user_id bridge is
 * RETIRED (the Turso-keyed reads it existed for have all moved to Supabase,
 * keyed by profile uuid). `profile.legacy_user_id` is no longer read here; it
 * survives in the DB only so the gateway can still map its channel/legacy ids
 * via `resolveProfileId` until the gateway is cut over too.
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
