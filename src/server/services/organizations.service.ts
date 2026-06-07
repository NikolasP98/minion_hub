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
 * Organizations available to the authenticated user + the active one (powers the
 * sidebar org picker). Source of truth = Supabase `organization_members` ⋈
 * `organizations`, keyed by the Supabase profile id (`auth.uid()` =
 * `user.supabaseId`). Turso is no longer consulted — Supabase is the single
 * tenancy store (self-host now runs a Supabase stack too).
 */
export async function loadOrganizationsForUser(
  ctx: LoadCtx,
  _userId: string,
): Promise<OrganizationsBundle> {
  const activeOrgId = ctx.session?.activeOrganizationId ?? ctx.tenantCtx?.tenantId ?? null;
  const supabaseId = ctx.user?.supabaseId;
  if (!supabaseId) return { organizations: [], activeOrgId };

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from('organization_members')
    .select('role, organizations(id, name, slug)')
    .eq('profile_id', supabaseId);
  if (error || !data) return { organizations: [], activeOrgId };

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

  return { organizations, activeOrgId: activeOrgId ?? organizations[0]?.id ?? null };
}

export interface OrgSummary {
  id: string;
  name: string;
  slug: string | null;
}

/**
 * All organizations (admin-only callers gate access). Supabase `organizations`
 * is the single source of truth. Used by the join-requests org dropdown.
 */
export async function listAllOrganizations(): Promise<OrgSummary[]> {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from('organizations').select('id, name, slug');
  if (error || !data) return [];
  return (data as OrgSummary[])
    .map((o) => ({ id: o.id, name: o.name, slug: o.slug }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * All organizations + their member counts (admin org-management page), from
 * Supabase `organizations` + `organization_members`.
 */
export async function listAllOrganizationsWithMemberCounts(): Promise<
  Array<OrgSummary & { members: number }>
> {
  const admin = supabaseAdmin();
  const { data: orgs, error: orgErr } = await admin.from('organizations').select('id, name, slug');
  if (orgErr || !orgs) return [];
  const { data: mems } = await admin.from('organization_members').select('organization_id');
  const counts = new Map<string, number>();
  for (const m of (mems ?? []) as Array<{ organization_id: string }>) {
    counts.set(m.organization_id, (counts.get(m.organization_id) ?? 0) + 1);
  }
  return (orgs as OrgSummary[])
    .map((o) => ({ id: o.id, name: o.name, slug: o.slug, members: counts.get(o.id) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
