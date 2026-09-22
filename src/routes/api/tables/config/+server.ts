import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { requireOrgCapability } from '$server/services/rbac.service';
import { readTableConfig, updateTableConfig } from '$server/services/table-config.service';
import { FIELD_LABEL_MAX, ID_PREFIX_MAX } from '$lib/tables/registry';

const fieldSchema = z.object({
  label: z.string().max(FIELD_LABEL_MAX).optional(),
  hidden: z.boolean().nullable().optional(),
  editable: z.boolean().optional(),
});
const patchSchema = z.record(
  z.string().min(1).max(60),
  z.object({
    idPrefix: z.string().max(ID_PREFIX_MAX).optional(),
    fields: z.record(z.string().min(1).max(60), fieldSchema).optional(),
  }),
);

/** GET /api/tables/config — the active org's table-config document. */
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json(await readTableConfig(ctx));
};

/** PUT /api/tables/config — merge a patch; owners/admins (settings:manage) only. */
export const PUT: RequestHandler = async ({ locals, request }) => {
  await requireOrgCapability(locals, 'settings', 'manage');
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const patch = await parseBody(request, patchSchema);
  return json(await updateTableConfig(ctx, patch));
};
