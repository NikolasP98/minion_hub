import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied, viewableModules } from '$server/auth/dataset-ctx';
import { ownerFilter, shouldMaskSensitive } from '$server/services/rbac.service';
import {
  getContact,
  getContactTimeline,
  getContactTags,
  rankContacts,
  listTags,
} from '$server/services/crm-contacts.service';
import { evaluateTagRule } from '$server/services/crm-scoring';
import { contactFinanceSummary, contactCashflow } from '$server/services/crm-finance.service';
import { contactConnections } from '$server/services/connections.service';
import { contactJourney } from '$server/services/crm-journey.service';
import { listBookings } from '$server/services/scheduling-bookings.service';
import { uuidParamOr404 } from '$server/utils/uuid-param';
import { listAdultGuardianCandidates, listGuardians } from '$server/services/crm-guardians.service';
import { loadCustomPropertyBundle } from '$server/services/custom-property-bundle.service';

export const load: PageServerLoad = async ({ locals, params, depends, parent }) => {
  const ctx = await datasetCtx(locals, 'crm');
  if (isDenied(ctx)) return { crm: ctx }; // rendered by DataSource (spec 039)
  depends('crm:contact');
  const id = uuidParamOr404(params.contactId);
  // Foreign datasets through their OWN handles (spec 039); a denied one degrades its section.
  const fin = await datasetCtx(locals, 'finance');
  const sched = await datasetCtx(locals, 'scheduling');
  const viewable = await viewableModules(locals, [
    'scheduling',
    'stock',
    'finance',
    'sales',
    'support',
  ]);
  // contactConnections keys groups by feature id ('finances' for the finance module).
  const viewableFeatures = new Set<string>(
    [...viewable].map((m) => (m === 'finance' ? 'finances' : m)),
  );
  // Personal orgs get the ContactCashflow bridge (fin_transactions) instead of
  // the business ContactFinance summary (fin_invoices) — WP2.
  const { activeOrgKind } = await parent();
  const isPersonal = activeOrgKind === 'personal';

  // Record-level (if-owner) scope: a scoped caller can only open contacts they
  // own — a non-owned id 404s rather than leaking existence. Field-level scope
  // masks the contact's PII (phone/email) below the crm sensitive field level.
  const [ownerId, maskPii, maskBookingPii] = await Promise.all([
    ownerFilter(locals, 'crm'),
    shouldMaskSensitive(locals, 'crm'),
    shouldMaskSensitive(locals, 'scheduling'),
  ]);
  const record = await getContact(ctx, id, ownerId, maskPii);
  if (!record) throw error(404, 'Contact not found');

  const [timeline, contactTags, allTags, ranked] = await Promise.all([
    getContactTimeline(ctx, id, 200),
    getContactTags(ctx, id),
    listTags(ctx, 'crm'),
    // Same principal scope as `getContact` above — an unscoped/masked `score`
    // row here would leak `_relationship` back to a masked caller even though
    // `getContact` correctly hid it (F1a).
    rankContacts(ctx, {
      contactId: id,
      limit: 1,
      ownerId,
      maskSensitive: maskPii,
      withoutFinance: isDenied(fin),
    }),
  ]);

  // Auto-tags are derived live from the scored row (never stored as contact_tags).
  const score = ranked[0] ?? null;
  const autoTags = score
    ? allTags.filter(
        (t) => t.kind === 'auto' && t.rule != null && evaluateTagRule(t.rule, score as never),
      )
    : [];

  const [
    finance,
    cashflow,
    connections,
    journey,
    bookings,
    guardians,
    guardianCandidates,
    customProperties,
  ] = await Promise.all([
    isPersonal || isDenied(fin) ? Promise.resolve(null) : contactFinanceSummary(fin, id),
    isPersonal && !isDenied(fin) ? contactCashflow(fin, id) : Promise.resolve(null),
    contactConnections(ctx, id, activeOrgKind, viewableFeatures),
    contactJourney(ctx, id, !isDenied(fin)),
    // Fail-soft: scheduling can be disabled/absent for this org — the contact
    // page must not 500 over an optional section (mirrors the stock-accrual
    // try/catch in load-bookings-view.ts).
    isDenied(sched)
      ? Promise.resolve([])
      : listBookings(sched, {
          crmContactId: id,
          limit: 20,
          maskAttendeePii: maskBookingPii,
        }).catch(() => []),
    listGuardians(ctx, id, ownerId),
    listAdultGuardianCandidates(ctx, id, ownerId),
    // Overview card custom properties (spec 2026-09-28 Bundle F).
    loadCustomPropertyBundle(locals, ctx, 'crm.customers', [id]),
  ]);

  return {
    crm: {
      contact: record.contact,
      identities: record.identities,
      stats: record.stats,
      // Party-spine identity (doc_number / dob / derived age) — the authority for
      // DNI + date of birth on this page, replacing custom_fields.dni / .edad.
      party: record.party,
      score,
      timeline,
      contactTags,
      allTags,
      autoTags,
      finance,
      cashflow,
      connections,
      journey,
      bookings,
      guardians,
      guardianCandidates,
      customProperties,
    },
  };
};
