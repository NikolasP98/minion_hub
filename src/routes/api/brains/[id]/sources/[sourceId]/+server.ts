import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { uuidParamOr404 } from '$server/utils/uuid-param';
import { requireOrgCapability } from '$server/services/rbac.service';
import { resolvePrincipal } from '$server/services/brains.service';
import { setFocusedBrainSourceMembership } from '$server/services/brain-corpus.service';

async function mutateMembership(
  locals: App.Locals,
  params: Partial<Record<string, string>>,
  member: boolean,
) {
  await requireOrgCapability(locals, 'brains', 'edit');
  const ctx = await requireCoreCtx(locals);
  const brainId = uuidParamOr404(params.id ?? '');
  const sourceId = uuidParamOr404(params.sourceId ?? '');
  const principal = await resolvePrincipal(ctx);
  const actor = {
    id: ctx.profileId ?? null,
    name: locals.user?.displayName ?? locals.user?.email ?? null,
  };
  return setFocusedBrainSourceMembership(
    ctx,
    brainId,
    sourceId,
    member,
    principal,
    actor,
  );
}

/** Attach an existing shared corpus source to a Focused Brain. */
export const PUT: RequestHandler = async ({ locals, params }) =>
  json(await mutateMembership(locals, params, true));

/** Detach a shared source reference without deleting or re-embedding it. */
export const DELETE: RequestHandler = async ({ locals, params }) =>
  json(await mutateMembership(locals, params, false));
