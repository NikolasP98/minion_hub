import { eq } from 'drizzle-orm';
import { user } from '$server/db/schema';
import type { TenantContext } from './base';
import { getAuth } from '$lib/auth/auth';

export async function listUsers(ctx: TenantContext) {
  return ctx.db
    .select({
      id: user.id,
      email: user.email,
      displayName: user.name,
      role: user.role,
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

export async function updateUserRole(
  ctx: TenantContext,
  userId: string,
  role: 'user' | 'admin',
) {
  await ctx.db
    .update(user)
    .set({ role, updatedAt: new Date() })
    .where(eq(user.id, userId));
}

export async function deleteUser(ctx: TenantContext, userId: string) {
  await ctx.db.delete(user).where(eq(user.id, userId));
}
