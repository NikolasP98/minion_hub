import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { cancelJobsByRef } from '$server/services/bg-runtime';
import { getGroupchatRun, setRunStatus } from '$server/services/groupchat.service';
import { requireFeature } from '$server/services/entitlements.service';

// Stop a run: cancel its bg job(s) and mark the run cancelled.
export const POST: RequestHandler = async ({ locals, params }) => {
  await requireFeature(locals, 'ai');
  if (!locals.tenantCtx) throw error(401);
  const ctx = await getGroupchatRun(locals.tenantCtx.tenantId, params.id!);
  if (!ctx) throw error(404);
  // Spec 117 FR-010: a member stops only a run they created.
  if (locals.user?.role !== 'admin' && (!locals.user || ctx.run.userId !== locals.user.id)) {
    throw error(403, "This role cannot stop another person's group chat");
  }
  await cancelJobsByRef(params.id!);
  await setRunStatus(params.id!, 'cancelled');
  return json({ ok: true });
};
