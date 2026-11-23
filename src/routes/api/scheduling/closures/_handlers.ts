/**
 * Spec 147 "Cerrar agenda" write handlers. One route family serves both
 * calendars: the central gate admits scheduling:create OR pos:create, so a
 * cashier who runs the POS agenda needs no scheduling role.
 */
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { CoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import {
  ClosureError,
  createClosures,
  reopenClosure,
} from '$server/services/scheduling-closures.service';

const createSchema = z.object({
  fromDate: z.string().max(10),
  toDate: z.string().max(10).nullish(),
  startTime: z.string().max(5).nullish(),
  endTime: z.string().max(5).nullish(),
  reason: z.string().max(500),
});
const reopenSchema = z.object({ group: z.boolean().optional() });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const actorOf = (ctx: CoreCtx, locals: App.Locals) => ({
  id: ctx.profileId ?? null,
  name: locals.user?.displayName ?? locals.user?.email ?? null,
});

function rethrow(e: unknown): never {
  if (e instanceof ClosureError) throw error(e.code === 'not_found' ? 404 : 400, e.message);
  throw e;
}

export async function createClosuresResponse(ctx: CoreCtx, locals: App.Locals, request: Request) {
  const body = await parseBody(request, createSchema);
  try {
    return json(await createClosures(ctx, body, actorOf(ctx, locals)), { status: 201 });
  } catch (e) {
    rethrow(e);
  }
}

export async function reopenClosureResponse(
  ctx: CoreCtx,
  locals: App.Locals,
  id: string,
  request: Request,
) {
  if (!UUID_RE.test(id)) throw error(404, 'closure not found');
  const body = await parseBody(request, reopenSchema);
  try {
    return json({
      removed: await reopenClosure(ctx, id, { group: body.group }, actorOf(ctx, locals)),
    });
  } catch (e) {
    rethrow(e);
  }
}
