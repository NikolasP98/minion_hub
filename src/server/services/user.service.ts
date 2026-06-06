import { and, eq, ne, inArray } from 'drizzle-orm';
import { user, member, organization } from '../db/schema/auth';
import type { TenantContext } from './base';
import { getAuth } from '$lib/auth/auth';
import { supabaseAdmin } from '$server/supabase';

export async function listUsers(ctx: TenantContext) {
  const users = await ctx.db
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

  if (users.length === 0) return [];

  const userIds = users.map((u) => u.id);
  const memberships = await ctx.db
    .select({
      userId: member.userId,
      orgId: member.organizationId,
      orgName: organization.name,
      orgRole: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(inArray(member.userId, userIds));

  const orgsByUser = new Map<string, Array<{ id: string; name: string; role: string }>>();
  for (const m of memberships) {
    const list = orgsByUser.get(m.userId) ?? [];
    list.push({ id: m.orgId, name: m.orgName, role: m.orgRole });
    orgsByUser.set(m.userId, list);
  }

  return users.map((u) => ({
    ...u,
    organizations: orgsByUser.get(u.id) ?? [],
  }));
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function deleteUser(ctx: TenantContext, userId: string) {
  // Legacy Turso user row (best-effort — admin list is still Turso-keyed).
  await ctx.db.delete(user).where(eq(user.id, userId));

  const admin = supabaseAdmin();

  // Resolve the Supabase profile/auth id. The admin Users list returns Turso
  // ids, so `userId` is usually the LEGACY id — map it via profiles.legacy_user_id.
  // (It may already be the profile uuid for newer rows.) Without this mapping the
  // revocation below matches nothing and the deleted user keeps their session —
  // access is gated on Supabase auth.users, NOT on the Turso row we just removed.
  let profileId: string | undefined;
  const byLegacy = await admin
    .from('profiles')
    .select('id')
    .eq('legacy_user_id', userId)
    .maybeSingle();
  profileId = (byLegacy.data as { id?: string } | null)?.id;
  if (!profileId && UUID_RE.test(userId)) {
    const byId = await admin.from('profiles').select('id').eq('id', userId).maybeSingle();
    profileId = (byId.data as { id?: string } | null)?.id ?? userId;
  }
  if (!profileId) return;

  // Revoke EVERY org membership (not just the admin's current org)…
  await admin.from('organization_members').delete().eq('profile_id', profileId);
  // …and delete the Supabase auth identity so the session can no longer
  // authenticate. This is the actual access revocation; profiles cascades on
  // auth.users delete. Best-effort: log but don't fail the request if it errors.
  const { error: authErr } = await admin.auth.admin.deleteUser(profileId);
  if (authErr) {
    console.error('[user.service] auth.admin.deleteUser failed for', profileId, authErr);
  }
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

export async function listOrganizations(ctx: TenantContext) {
  return ctx.db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .orderBy(organization.name);
}

export async function updateUserOrganizations(
  ctx: TenantContext,
  userId: string,
  orgIds: string[],
) {
  // Get current memberships
  const current = await ctx.db
    .select({ orgId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId));

  const currentIds = new Set(current.map((c) => c.orgId));
  const desiredIds = new Set(orgIds);

  // Remove memberships that are no longer desired
  for (const cid of currentIds) {
    if (!desiredIds.has(cid)) {
      await ctx.db
        .delete(member)
        .where(and(eq(member.userId, userId), eq(member.organizationId, cid)));
    }
  }

  // Add new memberships
  const now = new Date();
  for (const did of desiredIds) {
    if (!currentIds.has(did)) {
      await ctx.db
        .insert(member)
        .values({
          id: crypto.randomUUID(),
          organizationId: did,
          userId,
          role: 'member',
          createdAt: now,
        })
        .onConflictDoNothing();
    }
  }
}
