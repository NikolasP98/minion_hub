import { eq, sql } from 'drizzle-orm';
import { getDb } from '$server/db/client';
import { member, organization } from '@minion-stack/db/schema';
import { supabaseAdmin } from '$server/supabase';
import type { LoadCtx } from './types';

export interface OrganizationEntry {
  id: string;
  name: string;
  slug: string | null;
  /** The user's role WITHIN this organization. */
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
 * Source of truth = Supabase `organization_members` ⋈ `organizations`, keyed by
 * the SUPABASE profile id (`auth.uid()` = `user.supabaseId`). This deliberately
 * avoids the legacy id bridge: membership is keyed by profile id, not the
 * better-auth/Turso `member.user_id`. Falls back to the legacy `getDb` org/member
 * tables only when there is no supabase identity (self-host / better-auth mode).
 */
export async function loadOrganizationsForUser(
  ctx: LoadCtx,
  userId: string,
): Promise<OrganizationsBundle> {
  const activeOrgId = ctx.session?.activeOrganizationId ?? ctx.tenantCtx?.tenantId ?? null;
  const supabaseId = ctx.user?.supabaseId;

  if (supabaseId) {
    try {
      const admin = supabaseAdmin();
      const { data, error } = await admin
        .from('organization_members')
        .select('role, organizations(id, name, slug)')
        .eq('profile_id', supabaseId);
      if (!error && data) {
        type OrgRow = { id: string; name: string; slug: string | null };
        type MemRow = { role: string; organizations: OrgRow | OrgRow[] | null };
        const organizations: OrganizationEntry[] = (data as unknown as MemRow[])
          .map((row) => {
            const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
            if (!org) return null;
            return { id: org.id, name: org.name, slug: org.slug, role: row.role };
          })
          .filter((o): o is OrganizationEntry => o !== null)
          .sort((a, b) => a.name.localeCompare(b.name));
        if (organizations.length > 0) {
          return { organizations, activeOrgId: activeOrgId ?? organizations[0].id };
        }
      }
    } catch {
      // Fall through to the legacy path below.
    }
  }

  // Legacy fallback (better-auth / no supabase identity): read org/member from getDb.
  const db = getDb();
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

export interface OrgSummary {
  id: string;
  name: string;
  slug: string | null;
}

/**
 * All organizations (admin-only callers gate access). Supabase `organizations`
 * is the source of truth; falls back to the Turso `organization` table during
 * the cutover bake. Used by the join-requests org dropdown.
 */
export async function listAllOrganizations(): Promise<OrgSummary[]> {
  try {
    const admin = supabaseAdmin();
    const { data, error } = await admin.from('organizations').select('id, name, slug');
    if (!error && data) {
      return (data as OrgSummary[])
        .map((o) => ({ id: o.id, name: o.name, slug: o.slug }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
  } catch {
    // fall through to Turso
  }
  const db = getDb();
  return db
    .select({ id: organization.id, name: organization.name, slug: organization.slug })
    .from(organization);
}

/**
 * All organizations + their member counts (admin org-management page). Supabase
 * first (organizations + organization_members), Turso fallback during bake.
 */
export async function listAllOrganizationsWithMemberCounts(): Promise<
  Array<OrgSummary & { members: number }>
> {
  try {
    const admin = supabaseAdmin();
    const { data: orgs, error: orgErr } = await admin.from('organizations').select('id, name, slug');
    if (!orgErr && orgs) {
      const { data: mems } = await admin.from('organization_members').select('organization_id');
      const counts = new Map<string, number>();
      for (const m of (mems ?? []) as Array<{ organization_id: string }>) {
        counts.set(m.organization_id, (counts.get(m.organization_id) ?? 0) + 1);
      }
      return (orgs as OrgSummary[])
        .map((o) => ({ id: o.id, name: o.name, slug: o.slug, members: counts.get(o.id) ?? 0 }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
  } catch {
    // fall through to Turso
  }
  const db = getDb();
  const orgs = await db
    .select({ id: organization.id, name: organization.name, slug: organization.slug })
    .from(organization);
  const counts = await db
    .select({ orgId: member.organizationId, c: sql<number>`count(*)` })
    .from(member)
    .groupBy(member.organizationId);
  const countMap = new Map(counts.map((c) => [c.orgId, Number(c.c)]));
  return orgs.map((o) => ({ ...o, members: countMap.get(o.id) ?? 0 }));
}
