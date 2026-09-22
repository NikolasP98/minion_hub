/**
 * CRM — parties, contacts, identities, tags, tag_links, funnel stages,
 * relationship pins, settings, activity stats.
 */
import { matrixUuid, humanId } from './ids';
import { ORG_BUSINESS, ORG_PERSONAL, userId } from './tenancy';
import { PRODUCT_SERVICE_PLAIN } from './catalog';
import { ITEM_RECIPE_CHILD } from './stock';
import { matrixById } from './matrix';
import type { SeedContext } from './db';

export const CONTACT_DNI_VERIFIED = matrixUuid('crm.contact.dni-verified');
export const CONTACT_DNI_MISSING = matrixUuid('crm.contact.dni-missing');
export const CONTACT_RUC_COMPANY = matrixUuid('crm.contact.ruc-company');
export const CONTACT_PHONE_ONLY = matrixUuid('crm.contact.phone-only');
export const CONTACT_PARTY_NULL = matrixUuid('crm.contact.party-null');
export const CONTACT_SHARED_PHONE9_A = matrixUuid('crm.contact.shared-phone9', 'a');
export const CONTACT_SHARED_PHONE9_B = matrixUuid('crm.contact.shared-phone9', 'b');
export const CONTACT_IDENTITIES_3 = matrixUuid('crm.contact.identities-3');
export const CONTACT_SOFT_DELETED = matrixUuid('crm.contact.soft-deleted');
export const CONTACT_LIFECYCLE_OVERRIDE = matrixUuid('crm.contact.lifecycle-override');
export const CONTACT_FUNNEL_LEAD = matrixUuid('crm.funnel.lead');
export const CONTACT_FUNNEL_OPPORTUNITY = matrixUuid('crm.funnel.opportunity');
export const CONTACT_FUNNEL_CUSTOMER = matrixUuid('crm.funnel.customer');
export const CONTACT_FUNNEL_LOYAL = matrixUuid('crm.funnel.loyal');
export const CONTACT_FUNNEL_LEGACY_ID = matrixUuid('crm.funnel.legacy-id');
export const CONTACT_REL_USER_PINNED = matrixUuid('crm.rel.user-pinned');
export const CONTACT_REL_AI_CLAIMED = matrixUuid('crm.rel.ai-claimed');
export const CONTACT_ACTIVITY_PRESENT = matrixUuid('crm.activity.stats-present');
export const CONTACT_LONG_NAME_EMOJI = matrixUuid('crm.contact.long-name-emoji');

const OWNER = () => userId('tenancy.user.owner');

/** Exactly 120 UTF-16 code units (JS `.length`), incl. one emoji and a run of
 *  accented/CJK filler — spec §4's locale/emoji fixture. The emoji sits well
 *  before the truncation boundary so slicing to 120 never splits a surrogate
 *  pair; every filler character here is single-code-unit BMP, so the cut is
 *  always safe regardless of where 120 lands inside the repeated filler. */
function buildLongEmojiName(): string {
  const emoji = '🎉';
  let name = `QA Long Name ${emoji} `;
  const filler = 'Ñandú café résumé naïve façade 日本語 ';
  while (name.length < 120) name += filler;
  return name.slice(0, 120);
}

interface ContactSpec {
  matrixId: string;
  id: string;
  partyId: string | null;
  displayName: string;
  party?: {
    type: 'person' | 'company';
    phone9?: string;
    email?: string;
    docType?: string;
    docNumber?: string;
    dob?: string;
    dniVerified?: boolean;
  };
  lifecycleOverride?: string;
  customFields?: Record<string, unknown>;
  deleted?: boolean;
}

export async function seed(ctx: SeedContext): Promise<void> {
  const { sql, register, now } = ctx;

  const contacts: ContactSpec[] = [
    {
      matrixId: 'crm.contact.dni-verified',
      id: CONTACT_DNI_VERIFIED,
      partyId: matrixUuid('crm.contact.dni-verified', 'party'),
      displayName: 'QA DNI Verified',
      party: {
        type: 'person',
        docType: 'DNI',
        docNumber: '10000001',
        dob: '1990-01-15',
        dniVerified: true,
      },
    },
    {
      matrixId: 'crm.contact.dni-missing',
      id: CONTACT_DNI_MISSING,
      partyId: matrixUuid('crm.contact.dni-missing', 'party'),
      displayName: 'QA DNI Missing',
      party: { type: 'person' },
    },
    {
      matrixId: 'crm.contact.ruc-company',
      id: CONTACT_RUC_COMPANY,
      partyId: matrixUuid('crm.contact.ruc-company', 'party'),
      displayName: 'QA RUC Company SAC',
      party: { type: 'company', docType: 'RUC', docNumber: '20100000001' },
    },
    {
      matrixId: 'crm.contact.phone-only',
      id: CONTACT_PHONE_ONLY,
      partyId: matrixUuid('crm.contact.phone-only', 'party'),
      displayName: 'QA Phone Only',
      party: { type: 'person', phone9: '987000001' },
    },
    {
      matrixId: 'crm.contact.party-null',
      id: CONTACT_PARTY_NULL,
      partyId: null,
      displayName: 'QA No Party',
    },
    {
      matrixId: 'crm.contact.shared-phone9',
      id: CONTACT_SHARED_PHONE9_A,
      partyId: matrixUuid('crm.contact.shared-phone9', 'party-a'),
      displayName: 'QA Shared Phone A',
      party: { type: 'person', phone9: '987000002' },
    },
    {
      matrixId: 'crm.contact.shared-phone9 (b)',
      id: CONTACT_SHARED_PHONE9_B,
      partyId: matrixUuid('crm.contact.shared-phone9', 'party-b'),
      displayName: 'QA Shared Phone B',
      party: { type: 'person', phone9: '987000002' },
    },
    {
      matrixId: 'crm.contact.identities-3',
      id: CONTACT_IDENTITIES_3,
      partyId: matrixUuid('crm.contact.identities-3', 'party'),
      displayName: 'QA Three Identities',
      party: { type: 'person', phone9: '987000003' },
    },
    {
      matrixId: 'crm.contact.soft-deleted',
      id: CONTACT_SOFT_DELETED,
      partyId: matrixUuid('crm.contact.soft-deleted', 'party'),
      displayName: 'QA Soft Deleted',
      party: { type: 'person' },
      deleted: true,
    },
    {
      matrixId: 'crm.contact.lifecycle-override',
      id: CONTACT_LIFECYCLE_OVERRIDE,
      partyId: matrixUuid('crm.contact.lifecycle-override', 'party'),
      displayName: 'QA Lifecycle Override',
      party: { type: 'person' },
      lifecycleOverride: 'loyal',
    },
    {
      matrixId: 'crm.funnel.lead',
      id: CONTACT_FUNNEL_LEAD,
      partyId: matrixUuid('crm.funnel.lead', 'party'),
      displayName: 'QA Funnel Lead',
      party: { type: 'person' },
      customFields: { _funnel: { stage: 'lead', auto: true } },
    },
    {
      matrixId: 'crm.funnel.opportunity',
      id: CONTACT_FUNNEL_OPPORTUNITY,
      partyId: matrixUuid('crm.funnel.opportunity', 'party'),
      displayName: 'QA Funnel Opportunity',
      party: { type: 'person' },
      customFields: { _funnel: { stage: 'opportunity', auto: true } },
    },
    {
      matrixId: 'crm.funnel.customer',
      id: CONTACT_FUNNEL_CUSTOMER,
      partyId: matrixUuid('crm.funnel.customer', 'party'),
      displayName: 'QA Funnel Customer',
      party: { type: 'person' },
      customFields: { _funnel: { stage: 'customer', auto: true } },
    },
    {
      matrixId: 'crm.funnel.loyal',
      id: CONTACT_FUNNEL_LOYAL,
      partyId: matrixUuid('crm.funnel.loyal', 'party'),
      displayName: 'QA Funnel Loyal',
      party: { type: 'person' },
      customFields: { _funnel: { stage: 'loyal', auto: true } },
    },
    {
      matrixId: 'crm.funnel.legacy-id',
      id: CONTACT_FUNNEL_LEGACY_ID,
      partyId: matrixUuid('crm.funnel.legacy-id', 'party'),
      displayName: 'QA Funnel Legacy Interest',
      party: { type: 'person' },
      customFields: { _funnel: { stage: 'interest', auto: true } },
    },
    {
      matrixId: 'crm.rel.user-pinned',
      id: CONTACT_REL_USER_PINNED,
      partyId: matrixUuid('crm.rel.user-pinned', 'party'),
      displayName: 'QA Relationship User-Pinned',
      party: { type: 'person' },
      customFields: { _relationship: { category: 'regular', source: 'user' } },
    },
    {
      matrixId: 'crm.rel.ai-claimed',
      id: CONTACT_REL_AI_CLAIMED,
      partyId: matrixUuid('crm.rel.ai-claimed', 'party'),
      displayName: 'QA Relationship AI-Claimed',
      party: { type: 'person' },
      customFields: { _relationship: { category: 'vip', source: 'ai' } },
    },
    {
      matrixId: 'crm.activity.stats-present',
      id: CONTACT_ACTIVITY_PRESENT,
      partyId: matrixUuid('crm.activity.stats-present', 'party'),
      displayName: 'QA Busy Contact 名前 🙂',
      party: { type: 'person', phone9: '987000004' },
    },
    {
      matrixId: 'crm.contact.long-name-emoji',
      id: CONTACT_LONG_NAME_EMOJI,
      partyId: matrixUuid('crm.contact.long-name-emoji', 'party'),
      displayName: buildLongEmojiName(),
      party: { type: 'person', phone9: '987000005' },
    },
  ];

  for (const c of contacts) {
    if (c.partyId && c.party) {
      await sql`
        insert into parties (id, org_id, type, name, phone9, email, doc_type, doc_number, dob, dni_verified)
        values (
          ${c.partyId}, ${ORG_BUSINESS}, ${c.party.type}, ${c.displayName},
          ${c.party.phone9 ?? null}, ${c.party.email ?? null}, ${c.party.docType ?? null},
          ${c.party.docNumber ?? null}, ${c.party.dob ?? null}, ${c.party.dniVerified ?? false}
        )
        on conflict (id) do update set name = excluded.name, phone9 = excluded.phone9
      `;
    }
    await sql`
      insert into crm_contacts (id, org_id, human_id, display_name, owner_id, party_id, lifecycle_override, source, custom_fields, deleted_at)
      values (
        ${c.id}, ${ORG_BUSINESS}, ${humanId('CONT', c.matrixId)}, ${c.displayName}, ${OWNER()},
        ${c.partyId}, ${c.lifecycleOverride ?? null}, 'manual', ${sql.json(c.customFields ?? {})},
        ${c.deleted ? now.toISOString() : null}
      )
      on conflict (id) do update set
        display_name = excluded.display_name, party_id = excluded.party_id,
        lifecycle_override = excluded.lifecycle_override, custom_fields = excluded.custom_fields,
        deleted_at = excluded.deleted_at
    `;
    // Two ContactSpec entries borrow another entry's matrix id for
    // id-derivation only — the "(b)" sibling of a shared-phone9 pair (not a
    // matrix id at all) and the activity-stats fixture (whose id belongs to
    // the crm_contact_activity_stats row registered below, not this contact
    // row). Neither has a contact-level matrix row of its own to register.
    if (
      matrixById().has(c.matrixId) &&
      !c.matrixId.includes(' (') &&
      c.matrixId !== 'crm.activity.stats-present'
    ) {
      register(c.matrixId, { table: 'crm_contacts', where: { id: c.id } });
    }
  }

  await sql`update parties set dob = '2012-06-15' where id = ${matrixUuid('crm.contact.phone-only', 'party')}`;
  await sql`
    insert into crm_contact_guardians (org_id, ward_contact_id, guardian_contact_id)
    values (${ORG_BUSINESS}, ${CONTACT_PHONE_ONLY}, ${CONTACT_DNI_VERIFIED})
    on conflict do nothing
  `;
  register('crm.guardian.adult-minor', {
    table: 'crm_contact_guardians',
    where: {
      org_id: ORG_BUSINESS,
      ward_contact_id: CONTACT_PHONE_ONLY,
      guardian_contact_id: CONTACT_DNI_VERIFIED,
    },
  });

  await sql`
    insert into crm_contact_identities (org_id, contact_id, channel, external_id, handle)
    values
      (${ORG_BUSINESS}, ${CONTACT_IDENTITIES_3}, 'whatsapp', '51987000003', 'QA WA'),
      (${ORG_BUSINESS}, ${CONTACT_IDENTITIES_3}, 'instagram', 'qa.instagram.user', 'qa.instagram.user'),
      (${ORG_BUSINESS}, ${CONTACT_IDENTITIES_3}, 'email', 'qa-identities@example.test', null)
    on conflict (org_id, channel, external_id) do update set contact_id = excluded.contact_id
  `;

  await sql`
    insert into crm_contact_activity_stats (contact_id, org_id, message_count, inbound_count, outbound_count, channels_used, first_contact_at, last_contact_at, last_inbound_at, last_outbound_at)
    values (${CONTACT_ACTIVITY_PRESENT}, ${ORG_BUSINESS}, 42, 30, 12, 2, ${now.toISOString()}, ${now.toISOString()}, ${now.toISOString()}, ${now.toISOString()})
    on conflict (contact_id) do update set message_count = excluded.message_count
  `;
  register('crm.activity.stats-present', {
    table: 'crm_contact_activity_stats',
    where: { contact_id: CONTACT_ACTIVITY_PRESENT },
  });
  register('crm.activity.stats-missing', {
    table: 'crm_contact_activity_stats',
    where: { contact_id: CONTACT_DNI_MISSING },
    expect: 'absent',
  });

  // Tags + tag_links.
  const tagManual = matrixUuid('crm.tag.manual');
  const tagAuto = matrixUuid('crm.tag.auto-with-rule');
  const tagVip = matrixUuid('crm.tag.vip');
  // One tag per non-crm scope: tags are never interchangeable across categories
  // (migration 20260921010000_tag_scopes), so links must use a tag of their kind's scope.
  const tagEvent = matrixUuid('crm.tag.event');
  const tagCatalog = matrixUuid('crm.tag.catalog');
  const tagStock = matrixUuid('crm.tag.stock');
  await sql`
    insert into crm_tags (id, org_id, name, color, kind, rule, created_by, scope)
    values
      (${tagManual}, ${ORG_BUSINESS}, 'QA Manual Tag', '#3366ff', 'manual', null, ${OWNER()}, 'crm'),
      (${tagAuto}, ${ORG_BUSINESS}, 'QA Auto Tag', '#ff6633', 'auto', ${sql.json({ field: 'lifecycle', op: 'eq', value: 'loyal' })}, ${OWNER()}, 'crm'),
      (${tagVip}, ${ORG_BUSINESS}, 'VIP', '#a855f7', 'manual', null, ${OWNER()}, 'crm'),
      (${tagEvent}, ${ORG_BUSINESS}, 'QA Event Tag', '#10b981', 'manual', null, ${OWNER()}, 'event'),
      (${tagCatalog}, ${ORG_BUSINESS}, 'QA Catalog Tag', '#f59e0b', 'manual', null, ${OWNER()}, 'catalog'),
      (${tagStock}, ${ORG_BUSINESS}, 'QA Stock Tag', '#06b6d4', 'manual', null, ${OWNER()}, 'stock')
    on conflict (org_id, scope, name) do update set kind = excluded.kind, rule = excluded.rule
  `;
  register('crm.tag.manual', { table: 'crm_tags', where: { id: tagManual } });
  register('crm.tag.auto-with-rule', { table: 'crm_tags', where: { id: tagAuto } });
  register('crm.tag.vip', { table: 'crm_tags', where: { id: tagVip, name: 'VIP' } });
  register('crm.tag.event', { table: 'crm_tags', where: { id: tagEvent, scope: 'event' } });
  register('crm.tag.catalog', { table: 'crm_tags', where: { id: tagCatalog, scope: 'catalog' } });
  register('crm.tag.stock', { table: 'crm_tags', where: { id: tagStock, scope: 'stock' } });

  await sql`
    insert into crm_contact_tags (org_id, contact_id, tag_id, applied_by)
    values
      (${ORG_BUSINESS}, ${CONTACT_DNI_VERIFIED}, ${tagManual}, ${OWNER()}),
      (${ORG_BUSINESS}, ${CONTACT_DNI_VERIFIED}, ${tagVip}, ${OWNER()})
    on conflict (contact_id, tag_id) do nothing
  `;

  const bookingLinkId = matrixUuid('sched.booking.accepted'); // scheduling.ts owns the row; tag_links is a soft ref.
  const orphanId = matrixUuid('crm.tag.link-orphan', 'nonexistent-entity');
  await sql`
    insert into tag_links (org_id, entity_kind, entity_id, tag_id, applied_by)
    values
      (${ORG_BUSINESS}, 'booking', ${bookingLinkId}, ${tagEvent}, ${OWNER()}),
      (${ORG_BUSINESS}, 'event_type', ${matrixUuid('sched.event-type.plain')}, ${tagCatalog}, ${OWNER()}),
      (${ORG_BUSINESS}, 'product', ${PRODUCT_SERVICE_PLAIN}, ${tagCatalog}, ${OWNER()}),
      (${ORG_BUSINESS}, 'product', ${orphanId}, ${tagCatalog}, ${OWNER()}),
      (${ORG_BUSINESS}, 'item', ${ITEM_RECIPE_CHILD}, ${tagStock}, ${OWNER()})
    on conflict (entity_kind, entity_id, tag_id) do nothing
  `;
  register('crm.tag.link-booking', {
    table: 'tag_links',
    where: {
      org_id: ORG_BUSINESS,
      entity_kind: 'booking',
      entity_id: bookingLinkId,
      tag_id: tagEvent,
    },
  });
  register('crm.tag.link-event-type', {
    table: 'tag_links',
    where: {
      org_id: ORG_BUSINESS,
      entity_kind: 'event_type',
      entity_id: matrixUuid('sched.event-type.plain'),
      tag_id: tagCatalog,
    },
  });
  register('crm.tag.link-product', {
    table: 'tag_links',
    where: {
      org_id: ORG_BUSINESS,
      entity_kind: 'product',
      entity_id: PRODUCT_SERVICE_PLAIN,
      tag_id: tagCatalog,
    },
  });
  register('crm.tag.link-orphan', {
    table: 'tag_links',
    where: {
      org_id: ORG_BUSINESS,
      entity_kind: 'product',
      entity_id: orphanId,
      tag_id: tagCatalog,
    },
  });
  register('crm.tag.link-item', {
    table: 'tag_links',
    where: {
      org_id: ORG_BUSINESS,
      entity_kind: 'item',
      entity_id: ITEM_RECIPE_CHILD,
      tag_id: tagStock,
    },
  });

  // crm_settings — org.business gets a custom deposit rule; org.personal
  // deliberately gets no row at all (a missing row = defaults).
  await sql`
    insert into crm_settings (org_id, value)
    values (${ORG_BUSINESS}, ${sql.json({
      deposit: { keywords: ['adelanto', 'sena', 'reserva'], label: 'Depósito de reserva' },
    })})
    on conflict (org_id) do update set value = excluded.value
  `;
  register('crm.settings.deposit-rule', { table: 'crm_settings', where: { org_id: ORG_BUSINESS } });
  register('crm.settings.defaults-personal', {
    table: 'crm_settings',
    where: { org_id: ORG_PERSONAL },
    expect: 'absent',
  });
}
