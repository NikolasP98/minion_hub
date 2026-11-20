import { error, json } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireModuleEnabled } from '$server/http/require-module';
import { HrRuleError } from '$server/services/hr.service';
import { StaleWriteError } from '$server/services/errors';

/** Common guard for the HR endpoints: auth + scheduling module (writes are gated by hooks: scheduling:edit). */
export async function hrCtx(locals: App.Locals) {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  await requireModuleEnabled(ctx, 'scheduling');
  return ctx;
}

/** Rule violations are 409 with a stable `code` the UI can localise. */
export async function hrTry<T>(fn: () => Promise<T>): Promise<Response> {
  try {
    return json(await fn());
  } catch (e) {
    if (e instanceof StaleWriteError)
      return json({ error: 'stale', current: e.current }, { status: 409 });
    if (e instanceof HrRuleError)
      return json(
        { error: e.code, message: e.message },
        { status: e.code === 'not_found' ? 404 : 409 },
      );
    throw e;
  }
}
