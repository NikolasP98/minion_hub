import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { listBuiltSkills, createBuiltSkill } from '$server/services/builder.service';
import { requireCoreCtx } from '$server/auth/core-ctx';
import {
  builderOwner,
  requireBuilderCapability,
  requireBuilderServerAccess,
} from '$server/services/builder-access';

export const GET: RequestHandler = async ({ locals, url }) => {
  await requireBuilderCapability(locals, 'view');
  const ctx = await requireCoreCtx(locals);
  const actor = builderOwner(locals);
  const status = url.searchParams.get('status');
  const opts: { status?: 'draft' | 'published'; createdBy?: string } =
    status === 'published' || status === 'draft' ? { status } : {};
  if (!actor.isAdmin) opts.createdBy = actor.id;
  const skills = await listBuiltSkills(ctx, opts);
  return json({ skills });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  await requireBuilderCapability(locals, 'create');
  const ctx = await requireCoreCtx(locals);
  const actor = builderOwner(locals);
  const body = await request.json();
  if (body.serverId) await requireBuilderServerAccess(locals, body.serverId);
  const { id } = await createBuiltSkill(ctx, { ...body, createdBy: actor.id });
  return json({ id }, { status: 201 });
};
