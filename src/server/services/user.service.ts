import { and, eq, ne } from 'drizzle-orm';
import { user } from '../db/schema/auth';
import type { TenantContext } from './base';
import { getAuth } from '$lib/auth/auth';

export async function listUsers(ctx: TenantContext) {
  return ctx.db
    .select({
      id: user.id,
      email: user.email,
      displayName: user.name,
      role: user.role,
      alias: user.alias,
      roleId: user.roleId,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(user.createdAt);
}

export async function getUser(ctx: TenantContext, userId: string) {
  const rows = await ctx.db
    .select({
      id: user.id,
      email: user.email,
      displayName: user.name,
      role: user.role,
      alias: user.alias,
      roleId: user.roleId,
    })
    .from(user)
    .where(eq(user.id, userId));

  return rows[0] ?? null;
}

export async function createUser(
  ctx: TenantContext,
  data: { email: string; displayName?: string; password: string; role?: 'user' | 'admin' },
) {
  const result = await getAuth().api.signUpEmail({
    body: {
      email: data.email,
      password: data.password,
      name: data.displayName ?? data.email.split('@')[0],
    },
  });

  const userId = result.user.id;

  if (data.role && data.role !== 'user') {
    await ctx.db
      .update(user)
      .set({ role: data.role, updatedAt: new Date() })
      .where(eq(user.id, userId));
  }

  return userId;
}

export async function updateUserRole(ctx: TenantContext, userId: string, role: 'user' | 'admin') {
  await ctx.db.update(user).set({ role, updatedAt: new Date() }).where(eq(user.id, userId));
}

export async function deleteUser(ctx: TenantContext, userId: string) {
  await ctx.db.delete(user).where(eq(user.id, userId));
}

export type UserProfileUpdate = {
  displayName?: string;
  email?: string;
  alias?: string | null;
  roleId?: string | null;
};

export async function updateUserProfile(
  ctx: TenantContext,
  userId: string,
  patch: UserProfileUpdate,
) {
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.displayName !== undefined) updates.name = patch.displayName;
  if (patch.email !== undefined) updates.email = patch.email;
  if (patch.alias !== undefined) updates.alias = patch.alias;
  if (patch.roleId !== undefined) updates.roleId = patch.roleId;

  await ctx.db.update(user).set(updates).where(eq(user.id, userId));
}

export async function isAliasTaken(
  ctx: TenantContext,
  alias: string,
  excludeUserId?: string,
): Promise<boolean> {
  const rows = await ctx.db
    .select({ id: user.id })
    .from(user)
    .where(
      excludeUserId
        ? and(eq(user.alias, alias), ne(user.id, excludeUserId))
        : eq(user.alias, alias),
    )
    .limit(1);
  return rows.length > 0;
}

export async function listAliases(ctx: TenantContext): Promise<Record<string, string>> {
  const rows = await ctx.db
    .select({ id: user.id, alias: user.alias })
    .from(user);
  return Object.fromEntries(rows.filter((r) => r.alias).map((r) => [r.id, r.alias!]));
}
