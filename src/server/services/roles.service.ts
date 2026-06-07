import { and, eq } from 'drizzle-orm';
import { roles, rolePermissions } from '../db/schema/roles';
import { supabaseAdmin } from '$server/supabase';
import type { TenantContext } from './base';
import { randomUUID } from 'node:crypto';
import { PERMISSIONS, MODULE_PERMISSIONS } from '$lib/permissions';

/** Count profiles per role_id (Supabase = the user identity store). */
async function roleMemberCounts(): Promise<Map<string | null, number>> {
  const { data } = await supabaseAdmin().from('profiles').select('role_id');
  const counts = new Map<string | null, number>();
  for (const p of (data ?? []) as Array<{ role_id: string | null }>) {
    counts.set(p.role_id, (counts.get(p.role_id) ?? 0) + 1);
  }
  return counts;
}

export type RoleInput = {
  name: string;
  description?: string;
  permissions: string[];
  isSystem?: boolean;
};

export type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  memberCount: number;
};

export async function listRoles(ctx: TenantContext): Promise<RoleRow[]> {
  const roleRows = await ctx.db
    .select()
    .from(roles)
    .where(eq(roles.tenantId, ctx.tenantId));
  const permRows = await ctx.db.select().from(rolePermissions);
  const memberMap = await roleMemberCounts();
  return roleRows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    permissions: permRows.filter((p) => p.roleId === r.id).map((p) => p.permission),
    memberCount: memberMap.get(r.id) ?? 0,
  }));
}

export async function createRole(ctx: TenantContext, input: RoleInput): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  await ctx.db.insert(roles).values({
    id,
    tenantId: ctx.tenantId,
    name: input.name,
    description: input.description ?? null,
    isSystem: input.isSystem ?? false,
    createdAt: now,
    updatedAt: now,
  });
  if (input.permissions.length > 0) {
    await ctx.db
      .insert(rolePermissions)
      .values(input.permissions.map((p) => ({ roleId: id, permission: p })));
  }
  return id;
}

export async function updateRolePermissions(
  ctx: TenantContext,
  roleId: string,
  permissions: string[],
) {
  const existing = (await ctx.db.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.tenantId, ctx.tenantId))))[0];
  if (!existing) throw new Error('role not found');
  if (existing.isSystem) throw new Error('cannot edit system role');
  await ctx.db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  if (permissions.length > 0) {
    await ctx.db
      .insert(rolePermissions)
      .values(permissions.map((p) => ({ roleId, permission: p })));
  }
  await ctx.db.update(roles).set({ updatedAt: Date.now() }).where(eq(roles.id, roleId));
}

export async function updateRoleMeta(
  ctx: TenantContext,
  roleId: string,
  patch: { name?: string; description?: string | null },
) {
  const existing = (await ctx.db.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.tenantId, ctx.tenantId))))[0];
  if (!existing) throw new Error('role not found');
  if (existing.isSystem) throw new Error('cannot edit system role');
  await ctx.db
    .update(roles)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(roles.id, roleId));
}

export async function deleteRole(ctx: TenantContext, roleId: string) {
  const existing = (await ctx.db.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.tenantId, ctx.tenantId))))[0];
  if (!existing) throw new Error('role not found');
  if (existing.isSystem) throw new Error('cannot delete system role');
  // Unassign the role from any profiles holding it (Supabase identity store).
  await supabaseAdmin().from('profiles').update({ role_id: null }).eq('role_id', roleId);
  await ctx.db.delete(roles).where(eq(roles.id, roleId));
}

export async function getPermissionsForUser(
  ctx: TenantContext,
  userId: string,
): Promise<Set<string>> {
  const { data } = await supabaseAdmin()
    .from('profiles')
    .select('role, role_id')
    .eq('id', userId)
    .maybeSingle();
  const u = data as { role: string | null; role_id: string | null } | null;
  if (!u) return new Set();
  if (u.role_id) {
    const rows = await ctx.db
      .select()
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, u.role_id));
    return new Set(rows.map((r) => r.permission));
  }
  // Legacy fallback: admin = all perms, user = all *:view
  if (u.role === 'admin') return new Set(PERMISSIONS);
  return new Set(PERMISSIONS.filter((p) => p.endsWith(':view')));
}

export async function seedSystemRoles(ctx: TenantContext) {
  const existing = await ctx.db
    .select()
    .from(roles)
    .where(eq(roles.tenantId, ctx.tenantId));
  if (existing.some((r) => r.isSystem)) return;
  await createRole(ctx, {
    name: 'admin',
    description: 'Full access',
    permissions: [...PERMISSIONS],
    isSystem: true,
  });
  await createRole(ctx, {
    name: 'user',
    description: 'View-only',
    permissions: [
      ...PERMISSIONS.filter((p) => p.endsWith(':view')),
      // user gets the two non-admin modules by default; explicit module perms win over derivation
      'module:operations',
      'module:workspace',
    ],
    isSystem: true,
  });
}

/**
 * Backfill module perms on the built-in admin role for tenants seeded before modules existed.
 * Idempotent — safe to call on every load.
 */
export async function ensureAdminHasModules(ctx: TenantContext) {
  const adminRow = (
    await ctx.db
      .select()
      .from(roles)
      .where(eq(roles.tenantId, ctx.tenantId))
  ).find((r) => r.isSystem && r.name === 'admin');
  if (!adminRow) return;
  const have = new Set(
    (await ctx.db.select().from(rolePermissions).where(eq(rolePermissions.roleId, adminRow.id))).map(
      (r) => r.permission,
    ),
  );
  const missing = MODULE_PERMISSIONS.filter((p) => !have.has(p));
  if (missing.length === 0) return;
  await ctx.db
    .insert(rolePermissions)
    .values(missing.map((p) => ({ roleId: adminRow.id, permission: p })));
}
