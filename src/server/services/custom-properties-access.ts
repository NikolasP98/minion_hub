import { error } from '@sveltejs/kit';
import type { CoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from './modules.service';
import { customPropertyTablePolicy } from './custom-properties.service';
import { hasOrgCapability, requireOrgCapability, shouldMaskSensitive } from './rbac.service';

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
  if (!(await isModuleEnabled(ctx, policy.moduleId))) throw error(404, 'module_disabled');
  await requireOrgCapability(locals, policy.module, 'view');
  if (policy.sensitiveModule && (await shouldMaskSensitive(locals, policy.sensitiveModule)))
    return null;
  if (policy.team) {
    if (action === 'manage') {
      await requireOrgCapability(locals, 'users', 'view');
      await requireOrgCapability(locals, 'scheduling', 'manage');
      await requireOrgCapability(locals, 'users', 'manage');
    }
  } else if (action !== 'view') await requireOrgCapability(locals, policy.module, action);
  const [moduleManage, moduleEdit, usersView, usersManage, usersEdit] = await Promise.all([
    hasOrgCapability(locals, policy.module, 'manage'),
    hasOrgCapability(locals, policy.module, 'edit'),
    policy.team ? hasOrgCapability(locals, 'users', 'view') : Promise.resolve(true),
    policy.team ? hasOrgCapability(locals, 'users', 'manage') : Promise.resolve(true),
    policy.team ? hasOrgCapability(locals, 'users', 'edit') : Promise.resolve(true),
  ]);
  return {
    canManage: moduleManage && usersView && usersManage,
    canEdit: policy.team ? moduleEdit || (usersView && usersEdit) : moduleEdit,
  };
}
