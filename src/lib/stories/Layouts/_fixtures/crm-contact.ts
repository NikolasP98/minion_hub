// Dummy /crm/[contactId] load output for one invented patient. Never real customer data.
import type { Granted } from '$lib/permissions';
import type { PageData as ContactPage } from '../../../../routes/(app)/crm/[contactId]/$types';
import { crmContacts, crmTags, EMPTY_BUNDLE } from './crm';

type Data = Granted<ContactPage['crm']>;

const ranked = crmContacts[0];
const created = new Date(Date.UTC(2026, 1, 4, 15, 20));
const iso = (m: number, d: number, h = 15) => new Date(Date.UTC(2026, m, d, h, 0)).toISOString();

export const contactId = ranked.contact_id;

export const contactData: Data = {
  origin: { source: 'Instagram ad', where: 'Spring skin care', at: iso(1, 4) },
  contact: {
    id: ranked.contact_id,
    orgId: 'org-demo',
    humanId: 'CUS-00128',
    displayName: ranked.display_name,
    profileId: null,
    ownerId: null,
    partyId: ranked.party_id,
    lifecycleOverride: null,
    source: 'whatsapp',
    customFields: { email: 'valeria.quispe@example.com', phone: '+51 900 000 128' },
    firstTouch: null,
    deletedAt: null,
    createdAt: created,
    updatedAt: created,
  },
  identities: [
    {
      id: 'ident-1',
      orgId: 'org-demo',
      contactId: ranked.contact_id,
      channel: 'whatsapp',
      externalId: '51900000128',
      handle: null,
      createdAt: created,
    },
  ],
  stats: {
    message_count: ranked.total_msgs,
    inbound_count: ranked.inbound_msgs,
    channels_used: ranked.channels_used,
    first_contact_at: ranked.first_contact_at,
    last_contact_at: ranked.last_contact_at,
  },
  party: { docNumber: '40000128', dob: '1991-03-14', age: 35, dniVerified: true, sex: 'F' },
  score: ranked,
  timeline: [
    {
      kind: 'message',
      direction: 'in',
      channel: 'whatsapp',
      body: 'Hi, can I move my Thursday session to Friday afternoon?',
      occurred_at: iso(10, 8, 14),
      source_id: 'msg-1',
    },
    {
      kind: 'message',
      direction: 'out',
      channel: 'whatsapp',
      body: 'Yes, Friday at 4:30 pm is free. Shall I book it?',
      occurred_at: iso(10, 8, 15),
      source_id: 'msg-2',
    },
    {
      kind: 'message',
      direction: 'in',
      channel: 'whatsapp',
      body: 'Perfect, thank you.',
      occurred_at: iso(10, 8, 16),
      source_id: 'msg-3',
    },
  ],
  contactTags: [crmTags[0]],
  allTags: crmTags,
  autoTags: [],
  finance: {
    revenue: 4870,
    invoices: 6,
    lastPurchaseAt: iso(10, 2),
    purchased: true,
    reservedOnly: false,
    loyal: true,
    recentInvoices: [
      {
        id: 'inv-6',
        documentId: 'B001-00931',
        issuedAt: iso(10, 2),
        total: 650,
        status: 'paid',
        item: 'Botulinum toxin, one zone',
      },
      {
        id: 'inv-5',
        documentId: 'B001-00884',
        issuedAt: iso(8, 21),
        total: 1190,
        status: 'paid',
        item: 'Hydrafacial, pack of 4',
      },
      {
        id: 'inv-4',
        documentId: 'B001-00802',
        issuedAt: iso(7, 5),
        total: 1200,
        status: 'paid',
        item: 'Lip filler 1 ml',
      },
    ],
  },
  cashflow: null,
  connections: [
    {
      label: 'Sales',
      items: [
        { key: 'invoices', label: 'Invoices', count: 6, href: '/finances/invoices' },
        { key: 'bookings', label: 'Appointments', count: 9, href: '/scheduling/bookings' },
      ],
    },
  ],
  journey: [
    { id: 'j1', type: 'contact', label: 'First message', at: iso(1, 4) },
    { id: 'j2', type: 'booking', label: 'First consultation', at: iso(1, 11) },
    { id: 'j3', type: 'purchase', label: 'First treatment', at: iso(2, 2) },
    { id: 'j4', type: 'purchase', label: 'Repeat treatment', at: iso(7, 5) },
  ],
  bookings: [],
  guardians: [],
  guardianCandidates: [],
  customProperties: EMPTY_BUNDLE,
};
