import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { requireOrgCapability } from '$server/services/rbac.service';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { removeElement, upsertElement } from '$server/sandbox/sandbox.service';
import { parseSandboxBody, sandboxErrorResponse } from '../../_errors';

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  html: z.string().optional(),
  css: z.string().optional(),
  js: z.string().optional(),
  w: z.number().int().min(1).max(4).optional(),
  h: z.number().int().min(1).max(4).optional(),
  position: z.number().int().min(0).max(10_000).optional(),
  published: z.boolean().optional(),
});

/** PATCH /api/sandbox/elements/[id] */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  await requireOrgCapability(locals, 'settings', 'manage');
  const ctx = await requireCoreCtx(locals);
  try {
    const body = await parseSandboxBody(request, patchSchema);
    return json({ element: await upsertElement(ctx, { ...body, id: params.id }) });
  } catch (failure) {
    return sandboxErrorResponse(failure);
  }
};

/** DELETE /api/sandbox/elements/[id] */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  await requireOrgCapability(locals, 'settings', 'manage');
  const ctx = await requireCoreCtx(locals);
  try {
    if (!(await removeElement(ctx, params.id!))) throw error(404, 'element not found');
    return json({ ok: true });
  } catch (failure) {
    return sandboxErrorResponse(failure);
  }
};
