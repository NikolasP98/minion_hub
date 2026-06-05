import { eq } from 'drizzle-orm';
import { getDb } from '$server/db/client';
import { member, organization } from '@minion-stack/db/schema';
import type { LoadCtx } from './types';

export interface OrganizationEntry {
  id: string;
  name: string;
  slug: string | null;
  /** The user's role WITHIN this organization (best-effort). */
  role: string;
}

export interface OrganizationsBundle {
  organizations: OrganizationEntry[];
  /** The session's active organization id (the one currently in scope). */
  activeOrgId: string | null;
}

/**
 * Load the organizations available to the authenticated user, plus the active
 * one — powering the sidebar org picker.
 *
 * Keyed by the RESOLVED active-org id (`tenantCtx.tenantId`), not the user id:
 * the better-auth → supabase identity migration left Supabase profile ids and
 * legacy Turso `member.user_id`s divergent, so a `member`-by-userId query misses
 * for migrated users. The active org id is already resolved upstream (the
 * supabase→legacy bridge in resolve-identity), so we read the org row by that id
 * — which works in every auth mode. Membership rows are added best-effort on top
 * (populated for non-migrated / better-auth sessions, where switching applies).
 */
export async function loadOrganizationsForUser(
  ctx: LoadCtx,
  userId: string,
): Promise<OrganizationsBundle> {
  const db = getDb();
  const activeOrgId = ctx.session?.activeOrganizationId ?? ctx.tenantCtx?.tenantId ?? null;

  const byMembership: OrganizationEntry[] = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId));

  const orgs = [...byMembership];

  // Guarantee the active org is present even when membership-by-userId missed.
  if (activeOrgId && !orgs.some((o) => o.id === activeOrgId)) {
    const [active] = await db
      .select({ id: organization.id, name: organization.name, slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, activeOrgId))
      .limit(1);
    if (active) orgs.unshift({ ...active, role: 'member' });
  }

  return { organizations: orgs, activeOrgId };
}
