import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { sectionActionSetSchema } from '$lib/nav/section-access';
import { isModuleOrSub, requireOrgCapability } from '$server/services/rbac.service';
import {
  writeSectionAccess,
  resetRegisteredRolePolicies,
} from '$server/services/section-access.service';
const target = z.string().refine(isModuleOrSub, 'Registered module required');
const reset = z.object({ target, revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const base = z
  .object({
    roleKey: z.string().min(1).max(256),
    module: target,
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    resetSubresources: z.array(reset).max(100).optional(),
  })
  .strict();
const write = base
  .extend({
    caps: sectionActionSetSchema,
    ifOwner: z.boolean().optional(),
    fieldLevel: z.number().int().min(0).max(9).optional(),
  })
  .strict();
const resetRegistered = z
  .object({
    roleKey: z.string().min(1).max(256),
    resetRegisteredPolicies: z.array(reset).min(1).max(256),
  })
  .strict();
const deleteBody = z.union([base, resetRegistered]);
const headers = { 'Cache-Control': 'private, no-store' };
export const POST: RequestHandler = async ({ locals, request }) => {
  await requireOrgCapability(locals, 'roles', 'edit');
  const parsed = write.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'Invalid role override');
  const { module: target, resetSubresources, ...body } = parsed.data;
  return json(
    await writeSectionAccess(locals, { ...body, target, mode: 'override' }, resetSubresources),
    { headers },
  );
};
export const DELETE: RequestHandler = async ({ locals, request }) => {
  await requireOrgCapability(locals, 'roles', 'edit');
  const parsed = deleteBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'Invalid role override');
  if ('resetRegisteredPolicies' in parsed.data)
    return json(
      await resetRegisteredRolePolicies(
        locals,
        parsed.data.roleKey,
        parsed.data.resetRegisteredPolicies,
      ),
      { headers },
    );
  const { module: target, resetSubresources, ...body } = parsed.data;
  return json(
    await writeSectionAccess(locals, { ...body, target, mode: 'inherit' }, resetSubresources),
    { headers },
  );
};
