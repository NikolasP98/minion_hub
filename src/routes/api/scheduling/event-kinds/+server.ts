import { requireSchedulingRead } from '$server/auth/scheduling-read';
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { requireModuleEnabled } from '$server/http/require-module';
import { listEventKinds, createEventKind } from '$server/services/scheduling.service';

const postSchema = z.object({
  name: z.string().trim().min(1).max(200),
  color: z.string().trim().min(1).max(50),
});

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await requireSchedulingRead(locals);
  return json({ kinds: await listEventKinds(ctx) });
};

// Writes are gated by the central hook (scheduling:edit), same as /api/scheduling/resources.
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  await requireModuleEnabled(ctx, 'scheduling');
  const b = await parseBody(request, postSchema);
  const kind = await createEventKind(ctx, b);
  return json({ kind }, { status: 201 });
};
