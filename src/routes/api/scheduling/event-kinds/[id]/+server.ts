import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { requireModuleEnabled } from '$server/http/require-module';
import {
  updateEventKind,
  deleteEventKind,
  DefaultKindDeleteError,
} from '$server/services/scheduling.service';

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  color: z.string().trim().min(1).max(50).optional(),
  position: z.number().optional(),
  isDefault: z.boolean().optional(),
  active: z.boolean().optional(),
});

// Writes are gated by the central hook (scheduling:edit), same as /api/scheduling/resources/[id].
export const PATCH: RequestHandler = async ({ locals, request, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  await requireModuleEnabled(ctx, 'scheduling');
  const b = await parseBody(request, patchSchema);
  try {
    const kind = await updateEventKind(ctx, params.id!, b);
    return json({ kind });
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'invalid');
  }
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  await requireModuleEnabled(ctx, 'scheduling');
  try {
    await deleteEventKind(ctx, params.id!);
  } catch (e) {
    if (e instanceof DefaultKindDeleteError) throw error(409, e.message);
    throw e;
  }
  return json({ ok: true });
};
