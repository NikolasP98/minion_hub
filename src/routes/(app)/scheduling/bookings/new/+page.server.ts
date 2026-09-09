import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listEventTypes, listEventKinds } from '$server/services/scheduling.service';
import { getContact, getContactPrefill, listTags } from '$server/services/crm-contacts.service';

/** `/scheduling/bookings/new[?contact=<crm contact id>]` — the in-page booking form. */
export const load: PageServerLoad = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  const contactId = url.searchParams.get('contact');
  const [eventTypes, kinds, tags, rec, prefill] = await Promise.all([
    listEventTypes(ctx),
    listEventKinds(ctx),
    listTags(ctx),
    contactId ? getContact(ctx, contactId) : Promise.resolve(null),
    contactId ? getContactPrefill(ctx, contactId) : Promise.resolve(null),
  ]);
  return {
    eventTypes: eventTypes.map((e) => ({
      id: e.id,
      title: e.title,
      productId: e.productId ?? null,
      active: e.active,
      length: e.length,
      kindId: e.kindId ?? null,
    })),
    kinds,
    tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    contact:
      contactId && rec?.contact
        ? {
            id: contactId,
            partyId: rec.contact.partyId ?? null,
            name: prefill?.name ?? rec.contact.displayName ?? null,
            phone: prefill?.phone ?? null,
          }
        : null,
  };
};
