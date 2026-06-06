import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import {
  deleteUser,
  getUser,
  isAliasTaken,
  updateUserProfile,
  updateUserRole,
  updateUserOrganizations,
} from '$server/services/user.service';
import { requireAdmin } from '$server/auth/authorize';
import { normalizeAlias, validateAlias } from '$lib/utils/alias';

const VALID_ROLES = ['user', 'admin'] as const;
type LegacyRole = (typeof VALID_ROLES)[number];

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  requireAdmin(locals);
  if (!locals.tenantCtx) throw error(401);
  const ctx = locals.tenantCtx;

  const userId = params.id;
  if (!userId) throw error(400, 'missing id');

  const existing = await getUser(ctx, userId);
  if (!existing) throw error(404, 'user not found');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid JSON body');
  }
  const b = body as Record<string, unknown>;

  const patch: Parameters<typeof updateUserProfile>[2] = {};

  if (typeof b.displayName === 'string') patch.displayName = b.displayName.trim();
  if (typeof b.email === 'string') patch.email = b.email.trim();

  if (b.alias !== undefined) {
    if (b.alias === null || b.alias === '') {
      patch.alias = null;
    } else if (typeof b.alias !== 'string') {
      throw error(400, 'alias must be string or null');
    } else {
      const normalized = normalizeAlias(b.alias);
      if (!normalized) {
        patch.alias = null;
      } else {
        const check = validateAlias(normalized);
        if (!check.ok) throw error(400, 'alias format invalid');
        if (await isAliasTaken(ctx, normalized, userId)) {
          throw error(409, 'alias taken');
        }
        patch.alias = normalized;
      }
    }
  }

  if (b.roleId !== undefined) {
    patch.roleId = b.roleId === null ? null : typeof b.roleId === 'string' ? b.roleId : null;
  }

  // Backward-compat: legacy 'role' enum still accepted via dedicated call.
  if (typeof b.role === 'string' && VALID_ROLES.includes(b.role as LegacyRole)) {
    await updateUserRole(ctx, userId, b.role as LegacyRole);
  }

  if (Array.isArray(b.organizationIds)) {
    const orgIds = b.organizationIds.filter((id): id is string => typeof id === 'string');
    await updateUserOrganizations(ctx, userId, orgIds);
  }

  if (Object.keys(patch).length > 0) {
    await updateUserProfile(ctx, userId, patch);
  }

  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  requireAdmin(locals);
  if (!locals.tenantCtx) throw error(401);
  const ctx = locals.tenantCtx;

  const userId = params.id;
  if (!userId) throw error(400, 'missing id');

  // Prevent self-deletion. The admin list is keyed by the Supabase profile uuid,
  // but locals.user.id is still the legacy bridge id — compare against supabaseId
  // (and id) so the guard holds across the id-space divergence.
  if (userId === locals.user?.supabaseId || userId === locals.user?.id) {
    throw error(400, 'cannot delete your own account');
  }

  const existing = await getUser(ctx, userId);
  if (!existing) throw error(404, 'user not found');

  await deleteUser(ctx, userId);
  return json({ ok: true });
};
