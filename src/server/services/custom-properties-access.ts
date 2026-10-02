import { error } from '@sveltejs/kit';
import type { CoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from './modules.service';
import { customPropertyTablePolicy, policyModules } from './custom-properties.service';
import {
  hasOrgCapability,
  requireOrgCapability,
  shouldMaskSensitive,
  type Module,
  type PermAction,
} from './rbac.service';

/** `hasOrgCapability` over every module the policy accepts — any one grants. */
async function hasAnyCapability(
  locals: App.Locals,
  modules: readonly Module[],
  action: PermAction,
): Promise<boolean> {
  const results = await Promise.all(modules.map((m) => hasOrgCapability(locals, m, action)));
  return results.some(Boolean);
}
/** `requireOrgCapability` over every module the policy accepts: passes when any
 *  one grants; the 403 names the primary module like the single-module path. */
async function requireAnyCapability(
  locals: App.Locals,
  modules: readonly Module[],
  action: PermAction,
): Promise<void> {
  if (modules.length === 1 || !(await hasAnyCapability(locals, modules, action)))
    await requireOrgCapability(locals, modules[0], action);
}

export async function requireCustomPropertyAccess(
  locals: App.Locals,
  ctx: CoreCtx,
  tableId: string,
  action: 'view' | 'edit' | 'manage',
): Promise<{ canManage: boolean; canEdit: boolean }> {
  const access = await inspectCustomPropertyAccess(locals, ctx, tableId, action);
  if (!access) throw error(403, 'sensitive_fields_restricted');
  return access;
}

/** Returns null only for sensitive-field masking; all other access failures throw. */
export async function inspectCustomPropertyAccess(
  locals: App.Locals,
  ctx: CoreCtx,
  tableId: string,
  action: 'view' | 'edit' | 'manage',
): Promise<{ canManage: boolean; canEdit: boolean } | null> {
  const policy = customPropertyTablePolicy(tableId);
  const modules = policyModules(policy);
  if (!(await isModuleEnabled(ctx, policy.moduleId))) throw error(404, 'module_disabled');
  await requireAnyCapability(locals, modules, 'view');
  if (policy.sensitiveModule && (await shouldMaskSensitive(locals, policy.sensitiveModule)))
    return null;
  if (policy.team) {
    if (action === 'manage') {
      await requireOrgCapability(locals, 'users', 'view');
      await requireOrgCapability(locals, 'scheduling', 'manage');
      await requireOrgCapability(locals, 'users', 'manage');
    }
  } else if (action !== 'view') await requireAnyCapability(locals, modules, action);
  const [moduleManage, moduleEdit, usersView, usersManage, usersEdit] = await Promise.all([
    hasAnyCapability(locals, modules, 'manage'),
    hasAnyCapability(locals, modules, 'edit'),
    policy.team ? hasOrgCapability(locals, 'users', 'view') : Promise.resolve(true),
    policy.team ? hasOrgCapability(locals, 'users', 'manage') : Promise.resolve(true),
    policy.team ? hasOrgCapability(locals, 'users', 'edit') : Promise.resolve(true),
  ]);
  return {
    canManage: moduleManage && usersView && usersManage,
    canEdit: policy.team ? moduleEdit || (usersView && usersEdit) : moduleEdit,
  };
}
