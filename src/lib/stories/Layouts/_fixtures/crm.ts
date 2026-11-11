// Dummy CRM data: invented patients of a fictional clinic. Never real customer data.
import type { Granted } from '$lib/permissions';
import type { PageData as CustomersPage } from '../../../../routes/(app)/crm/customers/$types';

type CustomersData = Granted<CustomersPage['crm']>;
type Contact = CustomersData['contacts'][number];
type Tag = CustomersData['tags'][number];

export const EMPTY_BUNDLE = {
  definitions: [],
  values: {},
  recordAccess: {},
  canManage: false,
  canEdit: false,
};

const tag = (id: string, name: string, color: string, position: number): Tag => ({
  id,
  orgId: 'org-demo',
  name,
  color,
  kind: 'manual',
  scope: 'crm',
  rule: null,
  position,
  createdBy: null,
  createdAt: new Date(Date.UTC(2026, 5, 1)),
});

export const crmTags: Tag[] = [
  tag('tag-vip', 'VIP', 'amber', 3),
  tag('tag-botox', 'Botox follow-up', 'cyan', 2),
  tag('tag-referral', 'Referral', 'emerald', 1),
];

type Seed = [name: string, stage: string, funnel: string | null, score: number, days: number];
const SEEDS: Seed[] = [
  ['Valeria Quispe Ramos', 'active', 'loyal', 86, 2],
  ['Martín Salazar', 'active', 'customer', 74, 5],
  ['Lucía Fernández Paredes', 'warm', 'opportunity', 61, 9],
  ['Rodrigo Huamán', 'active', 'customer', 58, 12],
  ['Camila Torres Vega', 'warm', 'opportunity', 47, 18],
  ['Diego Castillo', 'cooling', 'customer', 39, 34],
  ['Sofía Mendoza', 'new', 'lead', 22, 1],
  ['Andrea Rojas Chávez', 'new', 'lead', 18, 3],
  ['Javier Cárdenas', 'cooling', 'lead', 15, 41],
  ['Gabriela Ponce', 'dormant', 'customer', 9, 96],
  ['Renato Villanueva', 'new', null, 4, 0],
  ['Mariana Espinoza Luna', 'dormant', 'lead', 2, 140],
];

export const crmContacts: Contact[] = SEEDS.map(([name, stage, funnel, score, days], i) => {
  const last = new Date(Date.UTC(2026, 10, 10 - days, 15, 0)).toISOString();
  const buyer = funnel === 'customer' || funnel === 'loyal';
  return {
    contact_id: `c0000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    display_name: name,
    owner_id: null,
    source: i % 3 === 0 ? 'manual' : 'whatsapp',
    total_msgs: 6 + ((i * 7) % 40),
    inbound_msgs: 3 + ((i * 5) % 20),
    channels_used: 1 + (i % 2),
    channels: i % 2 ? ['whatsapp', 'instagram'] : ['whatsapp'],
    identities: [{ channel: 'whatsapp', externalId: null, handle: null }],
    tag_ids: i === 0 ? ['tag-vip'] : i % 4 === 1 ? ['tag-botox'] : [],
    custom_fields: {},
    party_id: `p0000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    dni_verified: i % 3 !== 2,
    age: 24 + ((i * 3) % 30),
    dob: null,
    sex: i % 2 ? 'M' : 'F',
    first_contact_at: new Date(Date.UTC(2026, 1 + (i % 6), 4)).toISOString(),
    last_contact_at: last,
    is_buyer: buyer,
    awaiting_reply: i === 2 || i === 6,
    lead_origin: i % 3 === 1 ? 'ad' : 'organic',
    lead_campaign: i % 3 === 1 ? 'Spring skin care' : null,
    last_days: days,
    reciprocity: 0.5,
    r_score: Math.min(5, Math.ceil(score / 20)),
    f_score: Math.min(5, Math.ceil(score / 25)),
    m_score: buyer ? 4 : 1,
    score,
    stage,
    funnel_stage: funnel,
    finance: buyer
      ? {
          revenue: 380 + i * 215,
          invoices: 1 + (i % 4),
          lastPurchaseAt: last,
          purchased: true,
          reservedOnly: false,
          loyal: funnel === 'loyal',
        }
      : null,
  };
});

export const customersData: CustomersData = {
  contacts: crmContacts,
  customProperties: EMPTY_BUNDLE,
  total: crmContacts.length,
  tags: crmTags,
  metaKeys: [],
  channels: ['whatsapp', 'instagram'],
  orgId: 'org-demo',
  financeEnabled: true,
  pageSize: 100,
};
