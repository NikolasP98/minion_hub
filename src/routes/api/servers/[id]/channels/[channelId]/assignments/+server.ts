import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import {
  listChannelAssignments,
  assignChannel,
  unassignChannel,
  isValidTargetType,
} from '$server/services/channel.service';

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);
  try {
    const assignments = await listChannelAssignments(locals.tenantCtx, params.channelId!);
    return json({ assignments });
  } catch (e) {
    console.error(`[GET /api/servers/${params.id}/channels/${params.channelId}/assignments]`, e);
    return json({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.tenantCtx) throw error(401);
  try {
    const body = await request.json();
    if (!body.targetType || !body.targetId) throw error(400, 'targetType and targetId required');
    if (!isValidTargetType(body.targetType)) throw error(400, `Invalid targetType: ${body.targetType}`);

    const id = await assignChannel(locals.tenantCtx, params.channelId!, body.targetType, body.targetId);
    return json({ ok: true, id });
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) throw e;
    console.error(`[POST /api/servers/${params.id}/channels/${params.channelId}/assignments]`, e);
    return json({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
};

export const DELETE: RequestHandler = async ({ locals, url }) => {
  if (!locals.tenantCtx) throw error(401);
  const assignmentId = url.searchParams.get('assignmentId');
  if (!assignmentId) throw error(400, 'assignmentId query param required');

  try {
    await unassignChannel(locals.tenantCtx, assignmentId);
    return json({ ok: true });
  } catch (e) {
    console.error(`[DELETE channel assignment ${assignmentId}]`, e);
    return json({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
};
