import { eq, sql } from 'drizzle-orm';
import { roles, rolePermissions } from '../db/schema/roles';
import { user } from '../db/schema/auth/index';
import type { TenantContext } from './base';
import { randomUUID } from 'node:crypto';
import { PERMISSIONS } from '$lib/permissions';

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
  const memberRows = await ctx.db
    .select({ roleId: user.roleId, c: sql<number>`count(*)` })
    .from(user)
    .groupBy(user.roleId);
  const memberMap = new Map<string | null, number>(
    memberRows.map((m) => [m.roleId, Number(m.c)]),
  );
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
  const existing = (await ctx.db.select().from(roles).where(eq(roles.id, roleId)))[0];
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
  const existing = (await ctx.db.select().from(roles).where(eq(roles.id, roleId)))[0];
  if (!existing) throw new Error('role not found');
  if (existing.isSystem) throw new Error('cannot edit system role');
  await ctx.db
    .update(roles)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(roles.id, roleId));
}

export async function deleteRole(ctx: TenantContext, roleId: string) {
  const existing = (await ctx.db.select().from(roles).where(eq(roles.id, roleId)))[0];
  if (!existing) throw new Error('role not found');
  if (existing.isSystem) throw new Error('cannot delete system role');
  await ctx.db.update(user).set({ roleId: null }).where(eq(user.roleId, roleId));
  await ctx.db.delete(roles).where(eq(roles.id, roleId));
}

export async function getPermissionsForUser(
  ctx: TenantContext,
  userId: string,
): Promise<Set<string>> {
  const u = (
    await ctx.db
      .select({ role: user.role, roleId: user.roleId })
      .from(user)
      .where(eq(user.id, userId))
  )[0];
  if (!u) return new Set();
  if (u.roleId) {
    const rows = await ctx.db
      .select()
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, u.roleId));
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
    permissions: PERMISSIONS.filter((p) => p.endsWith(':view')),
    isSystem: true,
  });
}
