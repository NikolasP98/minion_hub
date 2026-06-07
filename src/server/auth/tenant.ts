// Pure tenant-context resolution (R3 of specs/2026-05-26-auth-token-simplification.md).
// Kept free of `$env`/`getDb`/`getAuth` imports so it stays unit-testable under
// vitest — mirrors the supabase-bridge.ts (pure) vs .runtime.ts split.

import type { Db } from '$server/db/client';
import type { TenantContext } from '$server/services/base';

/**
 * Resolve a user's tenant context from a known active org id.
 *
 * Membership-based tenancy now lives entirely in Supabase: the Supabase provider
 * resolves the org via `resolveSupabaseTenant` (organization_members) before
 * calling this, so the prior Turso `member` fallback has been removed. This only
 * honors an explicitly-known active org id; callers handle the no-org case.
 * `fallbackToMembership` is retained for signature stability and is now a no-op.
 */
export async function resolveUserTenant(
  db: Db,
  opts: { userId: string; activeOrganizationId?: string | null; fallbackToMembership?: boolean },
): Promise<{ orgId: string; ctx: TenantContext } | null> {
  if (opts.activeOrganizationId) {
    return { orgId: opts.activeOrganizationId, ctx: { db, tenantId: opts.activeOrganizationId } };
  }
  return null;
}
