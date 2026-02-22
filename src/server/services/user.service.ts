import { eq, and } from 'drizzle-orm';
import { users, userTenants } from '$server/db/schema';
import { hashPassword } from '$server/auth/password';
import { newId, nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

export async function listUsers(ctx: TenantContext) {
  return ctx.db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      kind: users.kind,
      role: userTenants.role,
    })
    .from(userTenants)
    .innerJoin(users, eq(userTenants.userId, users.id))
    .where(eq(userTenants.tenantId, ctx.tenantId));
}

export async function getUser(ctx: TenantContext, userId: string) {
  const rows = await ctx.db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      kind: users.kind,
      role: userTenants.role,
    })
    .from(userTenants)
    .innerJoin(users, eq(userTenants.userId, users.id))
    .where(and(eq(userTenants.tenantId, ctx.tenantId), eq(users.id, userId)));

  return rows[0] ?? null;
}

export async function createContactUser(
  ctx: TenantContext,
  data: { email: string; displayName?: string; password: string; role?: 'owner' | 'admin' | 'member' | 'viewer' },
) {
  const now = nowMs();
  const userId = newId();

  await ctx.db.insert(users).values({
    id: userId,
    email: data.email,
    passwordHash: await hashPassword(data.password),
    displayName: data.displayName ?? null,
    kind: 'contact',
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.insert(userTenants).values({
    userId,
    tenantId: ctx.tenantId,
    role: data.role ?? 'viewer',
    joinedAt: now,
  });

  return userId;
}

export async function updateUser(
  ctx: TenantContext,
  userId: string,
  data: { displayName?: string; kind?: 'operator' | 'contact' },
) {
  await ctx.db
    .update(users)
    .set({ ...data, updatedAt: nowMs() })
    .where(eq(users.id, userId));
}

export async function updateUserRole(
  ctx: TenantContext,
  userId: string,
  role: 'owner' | 'admin' | 'member' | 'viewer',
) {
  await ctx.db
    .update(userTenants)
    .set({ role })
    .where(and(eq(userTenants.userId, userId), eq(userTenants.tenantId, ctx.tenantId)));
}

export async function removeUserFromTenant(ctx: TenantContext, userId: string) {
  await ctx.db
    .delete(userTenants)
    .where(and(eq(userTenants.userId, userId), eq(userTenants.tenantId, ctx.tenantId)));
}
