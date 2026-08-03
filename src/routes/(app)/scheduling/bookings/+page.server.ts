import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { shouldMaskSensitive } from '$server/services/rbac.service';
import { listBookings } from '$server/services/scheduling-bookings.service';
import { listResources, listEventTypes } from '$server/services/scheduling.service';
import { getContact } from '$server/services/crm-contacts.service';
import { accrualSummaryForSources } from '$server/services/stock-accruals.service';
import { effectiveModuleEnabled } from '$lib/modules/availability';

const DAY = 86_400_000;

export const load: PageServerLoad = async ({ locals, depends, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('scheduling:data');

  // Cross-module nav: ?contact= shows ALL of one contact's bookings (no window),
  // ?new=1 opens the New-appointment modal pre-bound to that contact.
  const contact = url.searchParams.get('contact') ?? undefined;
  const openNew = url.searchParams.get('new') === '1';

  const now = Date.now();
  const maskAttendeePii = await shouldMaskSensitive(locals, 'scheduling');
  const bookingsOpts = contact
    ? { crmContactId: contact, limit: 500, maskAttendeePii }
    : { from: new Date(now - 30 * DAY), to: new Date(now + 90 * DAY), limit: 500, maskAttendeePii };
  const [bookings, resources, eventTypes, contactRec] = await Promise.all([
    listBookings(ctx, bookingsOpts),
    listResources(ctx),
    listEventTypes(ctx),
    contact ? getContact(ctx, contact) : Promise.resolve(null),
  ]);

  // S3/WP1 R6: stock is now kind-hidden for personal orgs (not just
  // toggle-gated) — skip the accrual read entirely instead of relying on the
  // try/catch to swallow a query that shouldn't run.
  const stockEnabled = effectiveModuleEnabled(locals.orgKind, locals.moduleStates ?? {}, 'stock');
  let accrualSummaries: Awaited<ReturnType<typeof accrualSummaryForSources>> = [];
  if (stockEnabled) {
    try {
      accrualSummaries = await accrualSummaryForSources(
        ctx,
        'booking',
        bookings.map((b) => b.id),
      );
    } catch {
      // stock module absent/off — bookings render without chips
    }
  }

  return {
    bookings,
    resources: resources.map((r) => ({ id: r.id, name: r.name })),
    eventTypes: eventTypes.map((e) => ({ id: e.id, title: e.title, productId: e.productId ?? null })),
    stockEnabled,
    contactId: contact ?? null,
    contactName: contactRec?.contact?.displayName ?? null,
    openNew,
    accrualSummaries,
  };
};
