import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { ownerFilter } from '$server/services/rbac.service';
import {
  getContact,
  getContactTimeline,
  getContactTags,
  updateContact,
  softDeleteContact,
  hardDeleteContact,
} from '$server/services/crm-contacts.service';

/** GET /api/crm/contacts/[id] — record + identities + stats + journey timeline + tags. */
export const GET: RequestHandler = async ({ locals, params, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const id = params.id!;
  const record = await getContact(ctx, id, await ownerFilter(locals, 'crm'));
  if (!record) throw error(404, 'Contact not found');
  const timeline = await getContactTimeline(ctx, id, Number(url.searchParams.get('timelineLimit') ?? 100));
  const tags = await getContactTags(ctx, id);
  return json({ ...record, timeline, tags });
};

/** PATCH /api/crm/contacts/[id] — name, owner, lifecycle override, custom fields. */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await request.json().catch(() => ({}));
  const contact = await updateContact(ctx, params.id!, {
    displayName: body.displayName,
    ownerId: body.ownerId,
    lifecycleOverride: body.lifecycleOverride,
    customFields: body.customFields,
    phone: body.phone,
  });
  if (!contact) throw error(404, 'Contact not found');
  return json({ contact });
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
