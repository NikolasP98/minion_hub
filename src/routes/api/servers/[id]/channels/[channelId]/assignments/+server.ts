import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import {
  listChannelAssignments,
  assignChannel,
  unassignChannel,
} from '$server/services/channel.service';

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!locals.tenantCtx) throw error(401);
  const assignments = await listChannelAssignments(locals.tenantCtx, params.channelId!);
  return json({ assignments });
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.tenantCtx) throw error(401);
  const body = await request.json();
  if (!body.targetType || !body.targetId) throw error(400, 'targetType and targetId required');

  const id = await assignChannel(locals.tenantCtx, params.channelId!, body.targetType, body.targetId);
  return json({ ok: true, id });
};

export const DELETE: RequestHandler = async ({ locals, url }) => {
  if (!locals.tenantCtx) throw error(401);
  const assignmentId = url.searchParams.get('assignmentId');
  if (!assignmentId) throw error(400, 'assignmentId query param required');

  await unassignChannel(locals.tenantCtx, assignmentId);
  return json({ ok: true });
};
