import type { TenantContext } from './base';
import { supabaseAdmin } from '$server/supabase';

/**
 * Org areas (departments) — hub-owned, Supabase system-of-record.
 *
 * An area is a color-coded division of an org that groups the agents/users that
 * work in it and tags the skills that define its behavior. All reads/writes are
 * scoped to `ctx.tenantId` (the active org) — an area can never leak across
 * orgs. The service role bypasses RLS; admin gating happens at the API layer.
 *
 * See migration `0002_org_areas.sql` and `$lib/types/entities` for the shapes.
 */

interface OrgAreaRow {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  icon: string;
  color: string;
  sort_order: number;
  agent_ids: string[] | null;
  user_ids: string[] | null;
  skill_keys: string[] | null;
  integration_keys: string[] | null;
  virtual_agents: VirtualAgent[] | null;
  created_at: string | null;
  updated_at: string | null;
}

/**
 * A provisioned single-function agent that doesn't exist on the gateway (yet).
 * Each one performs a narrow end-to-end function (copywriter, KPI analyst,
 * invoice processor) through the skills/integrations it declares.
 */
export interface VirtualAgent {
  id: string;
  name: string;
  role: string;
  skillKeys: string[];
  integrationKeys: string[];
}

export interface OrgArea {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  /** lucide-svelte icon name (see AREA_ICON_KEYS). */
  icon: string;
  /** accent color, hex. */
  color: string;
  sortOrder: number;
  agentIds: string[];
  userIds: string[];
  skillKeys: string[];
  integrationKeys: string[];
  virtualAgents: VirtualAgent[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface OrgAreaInput {
  name: string;
  slug?: string;
  icon?: string;
  color?: string;
  sortOrder?: number;
  agentIds?: string[];
  userIds?: string[];
  skillKeys?: string[];
  integrationKeys?: string[];
  virtualAgents?: VirtualAgent[];
}

export type OrgAreaPatch = Partial<OrgAreaInput>;

function rowToArea(r: OrgAreaRow): OrgArea {
  return {
    id: r.id,
    organizationId: r.organization_id,
    name: r.name,
    slug: r.slug,
    icon: r.icon,
    color: r.color,
    sortOrder: r.sort_order,
    agentIds: r.agent_ids ?? [],
    userIds: r.user_ids ?? [],
    skillKeys: r.skill_keys ?? [],
    integrationKeys: r.integration_keys ?? [],
    virtualAgents: r.virtual_agents ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Slugify a name into a stable, url-safe area slug. */
export function slugifyArea(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'area'
  );
}

/** All areas for the active org, in display order. */
export async function listAreas(ctx: TenantContext): Promise<OrgArea[]> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from('org_areas')
    .select('*')
    .eq('organization_id', ctx.tenantId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as OrgAreaRow[]).map(rowToArea);
}

export async function createArea(ctx: TenantContext, input: OrgAreaInput): Promise<OrgArea> {
  const admin = supabaseAdmin();
  const slug = (input.slug && slugifyArea(input.slug)) || slugifyArea(input.name);
  const { data, error } = await admin
    .from('org_areas')
    .insert({
      organization_id: ctx.tenantId,
      name: input.name,
      slug,
      icon: input.icon ?? 'Building2',
      color: input.color ?? '#6366f1',
      sort_order: input.sortOrder ?? 0,
      agent_ids: input.agentIds ?? [],
      user_ids: input.userIds ?? [],
      skill_keys: input.skillKeys ?? [],
      integration_keys: input.integrationKeys ?? [],
      virtual_agents: input.virtualAgents ?? [],
    })
    .select('*')
    .single();
  if (error) throw error;
  return rowToArea(data as OrgAreaRow);
}

export async function updateArea(
  ctx: TenantContext,
  id: string,
  patch: OrgAreaPatch,
): Promise<OrgArea> {
  const admin = supabaseAdmin();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.slug !== undefined) updates.slug = slugifyArea(patch.slug);
  if (patch.icon !== undefined) updates.icon = patch.icon;
  if (patch.color !== undefined) updates.color = patch.color;
  if (patch.sortOrder !== undefined) updates.sort_order = patch.sortOrder;
  if (patch.agentIds !== undefined) updates.agent_ids = patch.agentIds;
  if (patch.userIds !== undefined) updates.user_ids = patch.userIds;
  if (patch.skillKeys !== undefined) updates.skill_keys = patch.skillKeys;
  if (patch.integrationKeys !== undefined) updates.integration_keys = patch.integrationKeys;
  if (patch.virtualAgents !== undefined) updates.virtual_agents = patch.virtualAgents;

  const { data, error } = await admin
    .from('org_areas')
    .update(updates)
    .eq('id', id)
    .eq('organization_id', ctx.tenantId) // org-scope guard: never touch another org's row
    .select('*')
    .single();
  if (error) throw error;
  return rowToArea(data as OrgAreaRow);
}

export async function deleteArea(ctx: TenantContext, id: string): Promise<void> {
  const admin = supabaseAdmin();
  const { error } = await admin
    .from('org_areas')
    .delete()
    .eq('id', id)
    .eq('organization_id', ctx.tenantId);
  if (error) throw error;
}

/** The default area set, seeded on demand for an org that has none yet. */
export const DEFAULT_AREAS: OrgAreaInput[] = [
  { name: 'Sales', icon: 'TrendingUp', color: '#22c55e', sortOrder: 0 },
  { name: 'Marketing', icon: 'Megaphone', color: '#ec4899', sortOrder: 1 },
  { name: 'Operations', icon: 'Settings2', color: '#f59e0b', sortOrder: 2 },
  { name: 'Development', icon: 'Code2', color: '#3b82f6', sortOrder: 3 },
  { name: 'Support', icon: 'LifeBuoy', color: '#06b6d4', sortOrder: 4 },
];

/** Seed the default areas for the active org (idempotent via slug uniqueness). */
export async function seedDefaultAreas(ctx: TenantContext): Promise<OrgArea[]> {
  const existing = await listAreas(ctx);
  if (existing.length > 0) return existing;
  for (const a of DEFAULT_AREAS) {
    try {
      await createArea(ctx, a);
    } catch {
      // ignore slug-conflict races; listAreas below returns the canonical set
    }
  }
  return listAreas(ctx);
}
