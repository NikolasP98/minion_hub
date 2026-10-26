import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { parseBody } from '$server/api/validate';
import { doorErrorResponse } from '$server/doors/http';
import {
  DOOR_SLUG_RE,
  createDoor,
  listDoorsWithFunnel,
  resolveDoorRange,
} from '$server/services/doors.service';
import { resolveOrgTimezone } from '$server/services/inbox/daily-feed.service';
import { DOOR_KINDS } from '$lib/doors/types';

const createSchema = z.object({
  kind: z.enum(DOOR_KINDS),
  slug: z.string().trim().regex(DOOR_SLUG_RE),
  title: z.string().trim().min(1).max(200),
});

/** GET /api/crm/doors?days=30 | ?from&to → doors + booking links with their funnel (crm:view). */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  await requireOrgCapability(locals, 'crm', 'view');
  const tz = await resolveOrgTimezone(ctx);
  const range = resolveDoorRange(url.searchParams, tz);
  try {
    return json({ range, doors: await listDoorsWithFunnel(ctx, range, tz) });
  } catch (e) {
    return doorErrorResponse(e);
  }
};

/** POST /api/crm/doors {kind, slug, title} → a new OFF door (crm:manage). 409 `slug_taken`. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  await requireOrgCapability(locals, 'crm', 'manage');
  const body = await parseBody(request, createSchema);
  try {
    const door = await createDoor(ctx, { ...body, createdBy: ctx.profileId });
    return json({ door }, { status: 201 });
  } catch (e) {
    return doorErrorResponse(e);
  }
};
