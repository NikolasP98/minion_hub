import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { listResources, listEventTypes, listEventKinds } from '$server/services/scheduling.service';
import { schedulingTimeZone } from '$lib/components/scheduling/calendar-window';
import { getContact, getContactPrefill, listTags } from '$server/services/crm-contacts.service';

/** `/scheduling/bookings/new[?contact=<crm contact id>]` — the in-page booking form. */
export const load: PageServerLoad = async ({ locals, url }) => {
  const ctx = await datasetCtx(locals, 'scheduling');
  if (isDenied(ctx)) return { scheduling: ctx }; // rendered by DataSource (spec 039)
  // CRM tags/contact are CRM data: own handle; denied => no tags, no prefill.
  const crm = await datasetCtx(locals, 'crm');
  const contactId = url.searchParams.get('contact');
  const [resources, eventTypes, kinds, tags, rec, prefill] = await Promise.all([
    listResources(ctx),
    listEventTypes(ctx),
    listEventKinds(ctx),
    isDenied(crm) ? Promise.resolve([]) : listTags(crm, 'event'),
    contactId && !isDenied(crm) ? getContact(crm, contactId) : Promise.resolve(null),
    contactId && !isDenied(crm) ? getContactPrefill(crm, contactId) : Promise.resolve(null),
  ]);
  return {
    scheduling: {
      orgTz: schedulingTimeZone(resources),
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
    },
  };
};
