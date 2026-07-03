import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { ownerFilter, shouldMaskSensitive } from '$server/services/rbac.service';
import {
  getContact,
  getContactTimeline,
  getContactTags,
  updateContact,
  softDeleteContact,
  hardDeleteContact,
} from '$server/services/crm-contacts.service';
import { StaleWriteError } from '$server/services/errors';

/** GET /api/crm/contacts/[id] — record + identities + stats + journey timeline + tags. */
export const GET: RequestHandler = async ({ locals, params, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const id = params.id!;
  const [ownerId, maskPii] = await Promise.all([
    ownerFilter(locals, 'crm'),
    shouldMaskSensitive(locals, 'crm'),
  ]);
  const record = await getContact(ctx, id, ownerId, maskPii);
  if (!record) throw error(404, 'Contact not found');
  const timeline = await getContactTimeline(ctx, id, Number(url.searchParams.get('timelineLimit') ?? 100));
  const tags = await getContactTags(ctx, id);
  return json({ ...record, timeline, tags });
};

const patchSchema = z.object({
  displayName: z.string().max(500).nullable().optional(),
  ownerId: z.string().max(200).nullable().optional(),
  lifecycleOverride: z.string().max(200).nullable().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  phone: z.string().max(50).nullable().optional(),
  expectedUpdatedAt: z.coerce.date().optional(),
});

/** PATCH /api/crm/contacts/[id] — name, owner, lifecycle override, custom fields. */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, patchSchema);
  try {
    const contact = await updateContact(
      ctx,
      params.id!,
      {
        displayName: body.displayName,
        ownerId: body.ownerId,
        lifecycleOverride: body.lifecycleOverride,
        customFields: body.customFields,
        phone: body.phone,
      },
      body.expectedUpdatedAt,
    );
    if (!contact) throw error(404, 'Contact not found');
    return json({ contact });
  } catch (e) {
    if (e instanceof StaleWriteError) return json({ error: 'stale', current: e.current }, { status: 409 });
    throw e;
  }
};

/** DELETE /api/crm/contacts/[id] — soft by default; ?hard=true for right-to-erasure. */
export const DELETE: RequestHandler = async ({ locals, params, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (url.searchParams.get('hard') === 'true') {
    await hardDeleteContact(ctx, params.id!);
  } else {
    await softDeleteContact(ctx, params.id!);
  }
  return json({ ok: true });
};
