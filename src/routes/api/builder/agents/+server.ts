import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { listBuiltAgents, createBuiltAgent } from '$server/services/builder.service';
import { requireCoreCtx } from '$server/auth/core-ctx';
import {
  builderOwner,
  requireBuilderCapability,
  requireBuilderServerAccess,
} from '$server/services/builder-access';

export const GET: RequestHandler = async ({ locals }) => {
  await requireBuilderCapability(locals, 'view');
  const ctx = await requireCoreCtx(locals);
  const actor = builderOwner(locals);
  const agents = await listBuiltAgents(ctx, actor.isAdmin ? undefined : actor.id);
  return json({ agents });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  await requireBuilderCapability(locals, 'create');
  const ctx = await requireCoreCtx(locals);
  const actor = builderOwner(locals);
  const body = await request.json();
  if (body.serverId) await requireBuilderServerAccess(locals, body.serverId);
  const { id } = await createBuiltAgent(ctx, { ...body, createdBy: actor.id });
  return json({ id }, { status: 201 });
};
