// Pure mapper — no $env or SvelteKit runtime imports.
// The runtime helper (resolveSupabaseUser) that needs $server/supabase lives in
// supabase-bridge.runtime.ts so this file remains unit-testable without the vite
// $env/static/public shim.

export type UserRole = 'user' | 'admin' | 'super_admin';

export interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  role: UserRole | null;
  legacy_user_id: string | null;
}

export interface BridgedUser {
  id: string; // legacy_user_id when present (matches Turso), else supabase uuid
  email: string;
  displayName: string | null;
  role: UserRole;
  supabaseId: string;
}

/** Pure: profiles row + supabase uuid -> hub locals.user shape. */
export function mapProfileToUser(profile: ProfileRow, supabaseId: string): BridgedUser {
  const role =
    profile.role === 'super_admin' ? 'super_admin' : profile.role === 'admin' ? 'admin' : 'user';
  return {
    id: profile.legacy_user_id ?? supabaseId,
    email: profile.email ?? '',
    displayName: profile.display_name ?? null,
    role,
    supabaseId,
  };
}
