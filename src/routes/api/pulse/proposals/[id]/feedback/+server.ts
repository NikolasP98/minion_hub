import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireAuth } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import {
  readPulseFeedbackInput,
  getPulseFeedback,
  savePulseFeedback,
} from '$server/services/pulse-feedback.service';
export const GET: RequestHandler = async ({ locals, params }) => {
  requireAuth(locals);
  await requireOrgCapability(locals, 'pulse', 'view');
  if (!z.string().uuid().safeParse(params.id).success) throw error(400, 'invalid_id');
  return json({ feedback: await getPulseFeedback(await requireCoreCtx(locals), params.id) });
};
export const POST: RequestHandler = async ({ locals, params, request, url }) => {
  requireAuth(locals);
  await requireOrgCapability(locals, 'pulse', 'edit');
  if (request.headers.get('origin') !== url.origin) throw error(403, 'same_origin_required');
  if (!z.string().uuid().safeParse(params.id).success) throw error(400, 'invalid_id');
  if (Number(request.headers.get('content-length') ?? 0) > 8192)
    throw error(413, 'feedback_body_limit');
  // parseBody validates the complete strict shape; comments have a Unicode scalar bound.
  const input = await readPulseFeedbackInput(request);
  return json({
    feedback: await savePulseFeedback(await requireCoreCtx(locals), params.id, input),
  });
};
