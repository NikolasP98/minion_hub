import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isPageRuleKey } from '$server/services/nav-config.service';
import { supabaseAdmin } from '$server/supabase';
import {
  setRoleOverride,
  clearRoleOverride,
  isModuleOrSub,
  requireOrgCapability,
  ACTIONS,
  type ActionSet,
  type PermAction,
} from '$server/services/rbac.service';

/**
 * Role Permission Manager writes — per-org capability overrides for a built-in
 * role. POST upserts the (role, module) ActionSet; DELETE reverts it to the code
 * default. Admin-only; org scope = the caller's active org.
 */

function parseCaps(raw: unknown): ActionSet {
  const c = (raw ?? {}) as Record<string, unknown>;
  const out = {} as ActionSet;
  for (const a of ACTIONS) out[a as PermAction] = c[a] === true;
  return out;
}

/** A Role Permission Manager module key, or a nav page/section view-rule key (specs 037/039). */
async function validKey(locals: App.Locals, key: unknown): Promise<boolean> {
  if (isModuleOrSub(key)) return true;
  if (typeof key !== 'string' || !/^(page|section):/.test(key)) return false;
  const ctx = await getCoreCtx(locals);
  return !!ctx && (await isPageRuleKey(ctx, key));
}

/** GET ?module=<page/section key> — { [roleKey]: view allowed } from this org's rules. */
export const GET: RequestHandler = async ({ locals, url }) => {
  await requireOrgCapability(locals, 'users', 'manage');
  if (!locals.tenantCtx) throw error(401);
  const key = url.searchParams.get('module');
  if (!key || isModuleOrSub(key) || !(await validKey(locals, key)))
    throw error(400, 'valid page key required');
  const { data, error: dbError } = await supabaseAdmin()
    .from('permission_rules')
    .select('role_key, can_view')
    .eq('org_id', locals.tenantCtx.tenantId)
    .eq('module', key);
  if (dbError) throw error(500);
  return json(
    Object.fromEntries(
      (data ?? []).map((r: { role_key: string; can_view: boolean }) => [r.role_key, r.can_view]),
    ),
  );
};

export const POST: RequestHandler = async ({ locals, request }) => {
  await requireOrgCapability(locals, 'users', 'manage');
  if (!locals.tenantCtx) throw error(401);
  const b = (await request.json().catch(() => ({}))) as {
    roleKey?: string;
    module?: string;
    caps?: unknown;
    ifOwner?: unknown;
    fieldLevel?: unknown;
  };
  if (!b.roleKey || !(await validKey(locals, b.module)))
    throw error(400, 'roleKey and valid module required');
  await setRoleOverride(
    locals.tenantCtx.tenantId,
    b.roleKey,
    b.module as string,
    parseCaps(b.caps),
    b.ifOwner === true,
    typeof b.fieldLevel === 'number' ? b.fieldLevel : undefined,
  );
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
  await requireOrgCapability(locals, 'users', 'manage');
  if (!locals.tenantCtx) throw error(401);
  const b = (await request.json().catch(() => ({}))) as { roleKey?: string; module?: string };
  if (!b.roleKey || !(await validKey(locals, b.module)))
    throw error(400, 'roleKey and valid module required');
  await clearRoleOverride(locals.tenantCtx.tenantId, b.roleKey, b.module as string);
  return json({ ok: true });
};
