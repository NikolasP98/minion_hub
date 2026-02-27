import { eq, and } from 'drizzle-orm';
import { user, member } from '$server/db/schema';
import { newId } from '$server/db/utils';
import type { TenantContext } from './base';
import { auth } from '$lib/auth';

export async function listUsers(ctx: TenantContext) {
  return ctx.db
    .select({
      id: user.id,
      email: user.email,
      displayName: user.name,
      role: member.role,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, ctx.tenantId));
}

export async function getUser(ctx: TenantContext, userId: string) {
  const rows = await ctx.db
    .select({
      id: user.id,
      email: user.email,
      displayName: user.name,
      role: member.role,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(and(eq(member.organizationId, ctx.tenantId), eq(user.id, userId)));

  return rows[0] ?? null;
}

export async function createContactUser(
  ctx: TenantContext,
  data: { email: string; displayName?: string; password: string; role?: 'owner' | 'admin' | 'member' | 'viewer' },
) {
  // Use Better Auth API so password is properly hashed into the account table
  const result = await auth.api.signUpEmail({
    body: {
      email: data.email,
      password: data.password,
      name: data.displayName ?? data.email.split('@')[0],
    },
  });

  const userId = result.user.id;
  const now = new Date();

  await ctx.db.insert(member).values({
    id: newId(),
    userId,
    organizationId: ctx.tenantId,
    role: data.role ?? 'viewer',
    createdAt: now,
  });

  return userId;
}

export async function updateUser(
  ctx: TenantContext,
  userId: string,
  data: { displayName?: string },
) {
  if (data.displayName !== undefined) {
    await ctx.db
      .update(user)
      .set({ name: data.displayName, updatedAt: new Date() })
      .where(eq(user.id, userId));
  }
}

export async function updateUserRole(
  ctx: TenantContext,
  userId: string,
  role: 'owner' | 'admin' | 'member' | 'viewer',
) {
  await ctx.db
    .update(member)
    .set({ role })
    .where(and(eq(member.userId, userId), eq(member.organizationId, ctx.tenantId)));
}

export async function removeUserFromTenant(ctx: TenantContext, userId: string) {
  await ctx.db
    .delete(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, ctx.tenantId)));
}
