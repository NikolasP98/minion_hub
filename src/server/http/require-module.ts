import { error } from '@sveltejs/kit';
import { isModuleEnabled } from '$server/services/modules.service';
import { errorBody } from './error-body';

/** A switched-off module answers 404 `module_disabled` on every API route (spec 138 H7). */
export async function requireModuleEnabled(
  ctx: Parameters<typeof isModuleEnabled>[0],
  moduleId: string,
): Promise<void> {
  if (!(await isModuleEnabled(ctx, moduleId)))
    throw error(404, errorBody('Not found', 'module_disabled'));
}
