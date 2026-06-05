/**
 * Remote functions for role management (settings/roles, RolesSection.svelte).
 * Mirrors the `/api/roles*` routes' service calls + validation. The page's
 * `initialRoles`/`initialCatalog` still arrive via the `settings:roles` load
 * bundle for first paint; mutations keep `invalidate('settings:roles')` on the
 * client. These remote functions replace the hand-written fetch glue and add
 * end-to-end types.
 */
import { query, command } from '$app/server';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { currentAdmin, currentCtx } from '$server/remote/guard';
import * as roles from '$server/services/roles.service';
import { PERMISSIONS, groupPermissions } from '$lib/permissions';

function assertValidPerms(perms: string[]) {
  const invalid = perms.filter((p) => !(PERMISSIONS as readonly string[]).includes(p));
  if (invalid.length) error(400, `invalid permissions: ${invalid.join(',')}`);
}

/** All roles for the current tenant. */
export const getRoles = query(async () => {
  const ctx = currentCtx();
  return roles.listRoles(ctx);
});

/** Grouped permission catalog (static). */
export const getPermissionsCatalog = query(async () => groupPermissions());

/** Create a custom role. Returns its id. */
export const createRole = command(
  z.object({
    name: z.string().trim().min(1),
    description: z.string().nullish(),
    permissions: z.array(z.string()),
  }),
  async ({ name, description, permissions }) => {
    currentAdmin();
    const ctx = currentCtx();
    assertValidPerms(permissions);
    try {
      const id = await roles.createRole(ctx, {
        name,
        description: description ?? undefined,
        permissions,
      });
      return { id };
    } catch (e) {
      if (/UNIQUE/i.test(String(e))) error(409, 'role name taken');
      throw e;
    }
  },
);

/** Update a role's name/description and/or its permission set. */
export const updateRole = command(
  z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1).optional(),
    description: z.string().nullish(),
    permissions: z.array(z.string()).optional(),
  }),
  async ({ id, name, description, permissions }) => {
    currentAdmin();
    const ctx = currentCtx();
    try {
      if (name !== undefined || description !== undefined) {
        await roles.updateRoleMeta(ctx, id, { name, description });
      }
      if (permissions) {
        assertValidPerms(permissions);
        await roles.updateRolePermissions(ctx, id, permissions);
      }
      return { ok: true as const };
    } catch (e) {
      if (/system role/i.test(String(e))) error(403, 'cannot edit system role');
      throw e;
    }
  },
);

/** Delete a custom role. */
export const deleteRole = command(z.string().min(1), async (id) => {
  const ctx = (currentAdmin(), currentCtx());
  try {
    await roles.deleteRole(ctx, id);
    return { ok: true as const };
  } catch (e) {
    if (/system/i.test(String(e))) error(403, 'cannot delete system role');
    throw e;
  }
});
