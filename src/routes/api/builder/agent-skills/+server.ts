import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { setAgentBuiltSkills } from '$server/services/builder.service';
import { requireCoreCtx } from '$server/auth/core-ctx';
import {
  requireBuilderCapability,
  requireBuilderOwnership,
  requireBuilderServerAccess,
} from '$server/services/builder-access';

export const POST: RequestHandler = async ({ locals, request }) => {
  await requireBuilderCapability(locals, 'edit');
  const ctx = await requireCoreCtx(locals);
  if (!ctx) throw error(401);
  const { gatewayAgentId, serverId, skillIds } = await request.json();
  if (
    typeof gatewayAgentId !== 'string' ||
    typeof serverId !== 'string' ||
    !Array.isArray(skillIds) ||
    !skillIds.every((skillId) => typeof skillId === 'string')
  ) {
    throw error(400, 'Missing gatewayAgentId, serverId, or skillIds');
  }
  await requireBuilderServerAccess(locals, serverId);
  await Promise.all(
    skillIds.map((skillId: string) => requireBuilderOwnership(locals, ctx, 'skill', skillId)),
  );
  await setAgentBuiltSkills(ctx, gatewayAgentId, serverId, skillIds);
  return json({ ok: true });
};
