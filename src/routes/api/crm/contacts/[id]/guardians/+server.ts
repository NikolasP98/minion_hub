import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { ownerFilter, requireOrgCapability } from '$server/services/rbac.service';
import { getContact } from '$server/services/crm-contacts.service';
import {
  addGuardian,
  isGuardianEligibilityFailure,
  listGuardians,
  removeGuardian,
} from '$server/services/crm-guardians.service';

const bodySchema = z.object({
  guardianContactId: z.string().uuid(),
  action: z.enum(['link', 'remove']).default('link'),
});

export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  await requireOrgCapability(locals, 'crm', 'view');
  const id = z.string().uuid().safeParse(params.id);
  if (!id.success) throw error(404);
  const ownerId = await ownerFilter(locals, 'crm');
  if (!(await getContact(ctx, id.data, ownerId, true))) throw error(404);
  return json({ guardians: await listGuardians(ctx, id.data, ownerId) });
};
export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const id = z.string().uuid().safeParse(params.id);
  if (!id.success) throw error(404);
  const body = await parseBody(request, bodySchema);
  const ownerId = await ownerFilter(locals, 'crm');
  if (
    !(await getContact(ctx, id.data, ownerId, true)) ||
    !(await getContact(ctx, body.guardianContactId, ownerId, true))
  )
    throw error(404);
  try {
    if (body.action === 'remove') {
      await removeGuardian(ctx, id.data, body.guardianContactId);
    } else {
      await addGuardian(ctx, id.data, body.guardianContactId);
    }
  } catch (e) {
    if (isGuardianEligibilityFailure(e))
      throw error(422, e instanceof Error ? e.message : 'Guardian is not eligible');
    throw e;
  }
  return json({ ok: true }, { status: body.action === 'link' ? 201 : 200 });
};
export const DELETE: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const id = z.string().uuid().safeParse(params.id);
  if (!id.success) throw error(404);
  const body = await parseBody(request, bodySchema);
  const ownerId = await ownerFilter(locals, 'crm');
  if (
    !(await getContact(ctx, id.data, ownerId, true)) ||
    !(await getContact(ctx, body.guardianContactId, ownerId, true))
  )
    throw error(404);
  await removeGuardian(ctx, id.data, body.guardianContactId);
  return json({ ok: true });
};
