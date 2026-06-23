import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listBookings } from '$server/services/scheduling-bookings.service';
import { listResources, listEventTypes } from '$server/services/scheduling.service';
import { getContact } from '$server/services/crm-contacts.service';

const DAY = 86_400_000;

export const load: PageServerLoad = async ({ locals, depends, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(404, 'Scheduling module disabled');
  depends('scheduling:data');

  // Cross-module nav: ?contact= shows ALL of one contact's bookings (no window),
  // ?new=1 opens the New-appointment modal pre-bound to that contact.
  const contact = url.searchParams.get('contact') ?? undefined;
  const openNew = url.searchParams.get('new') === '1';

  const now = Date.now();
  const bookingsOpts = contact
    ? { crmContactId: contact, limit: 500 }
    : { from: new Date(now - 30 * DAY), to: new Date(now + 90 * DAY), limit: 500 };
  const [bookings, resources, eventTypes, contactRec] = await Promise.all([
    listBookings(ctx, bookingsOpts),
    listResources(ctx),
    listEventTypes(ctx),
    contact ? getContact(ctx, contact) : Promise.resolve(null),
  ]);
  return {
    bookings,
    resources: resources.map((r) => ({ id: r.id, name: r.name })),
    eventTypes: eventTypes.map((e) => ({ id: e.id, title: e.title })),
    contactId: contact ?? null,
    contactName: contactRec?.contact?.displayName ?? null,
    openNew,
  };
};
