// Pure tenant-context resolution (R3 of specs/2026-05-26-auth-token-simplification.md).
// Kept free of `$env`/`getDb`/`getAuth` imports so it stays unit-testable under
// vitest — mirrors the supabase-bridge.ts (pure) vs .runtime.ts split.

import { eq } from 'drizzle-orm';
import { member } from '@minion-stack/db/schema';
import type { Db } from '$server/db/client';
import type { TenantContext } from '$server/services/base';

/**
 * Resolve a user's tenant context. Single rule, shared by the providers that
 * key tenancy off a user identity:
 *   - if an active org id is already known (Better Auth session), use it;
 *   - otherwise, optionally fall back to the user's first/sole membership.
 *
 * `fallbackToMembership` preserves the prior per-branch behavior exactly:
 * the Supabase branch looked up `member` by user id; the Better Auth branch
 * used only `session.activeOrganizationId` and left the membership fallback to
 * `(app)/+layout.server.ts`. Unifying those is a deliberate later change.
 */
export async function resolveUserTenant(
  db: Db,
  opts: { userId: string; activeOrganizationId?: string | null; fallbackToMembership: boolean },
): Promise<{ orgId: string; ctx: TenantContext } | null> {
  if (opts.activeOrganizationId) {
    return { orgId: opts.activeOrganizationId, ctx: { db, tenantId: opts.activeOrganizationId } };
  }
  if (!opts.fallbackToMembership) return null;
  const [m] = await db
    .select({ orgId: member.organizationId })
    .from(member)
    .where(eq(member.userId, opts.userId))
    .limit(1);
  if (m?.orgId) return { orgId: m.orgId, ctx: { db, tenantId: m.orgId } };
  return null;
}
