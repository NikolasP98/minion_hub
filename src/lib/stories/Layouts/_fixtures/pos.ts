// Dummy POS data: an invented clinic catalog, prices in PEN. Never real customer data.
import type { Granted } from '$lib/permissions';
import type { PageData as SellPage } from '../../../../routes/(app)/pos/sell/$types';
import type { LayoutData as PosLayout } from '../../../../routes/(app)/pos/$types';
import { classify } from '$lib/catalog/taxonomy';
import { normalizeRequirements } from '$lib/pos/requirements';

type SellData = Granted<SellPage['pos']>;
type Sellable = SellData['sellables'][number];
type Settings = Granted<PosLayout['posSettings']>;
type OpenShift = NonNullable<Granted<PosLayout['openShift']>>;

type Seed = [
  code: string,
  name: string,
  kind: Sellable['kind'],
  price: number,
  stock: number | null,
];
const SEEDS: Seed[] = [
  ['CONS', 'Dermatology consultation', 'service', 120, null],
  ['BTX-1', 'Botulinum toxin, one zone', 'service', 650, null],
  ['BTX-3', 'Botulinum toxin, three zones', 'service', 1450, null],
  ['HA-LIP', 'Lip filler 1 ml', 'service', 1200, null],
  ['PEEL', 'Chemical peel', 'service', 280, null],
  ['HYD', 'Hydrafacial', 'service', 350, null],
  ['PKG-HYD4', 'Hydrafacial, pack of 4', 'bundle', 1190, null],
  ['SPF50', 'Sunscreen SPF 50, 50 ml', 'product', 89, 24],
  ['SER-C', 'Vitamin C serum 30 ml', 'product', 145, 6],
  ['CRM-RET', 'Retinol night cream', 'product', 132, 0],
];

export const sellables: Sellable[] = SEEDS.map(([code, name, kind, unitPrice, stockQty], i) => ({
  productId: `f0000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  code,
  name,
  category: kind === 'product' ? 'Skin care' : 'Treatments',
  unitPrice,
  active: true,
  kind,
  stockQty,
  hasMapping: stockQty != null,
  packageSessions: kind === 'bundle' ? 4 : 0,
  consumedItemNames: [],
  taxonomy: classify(name, code, null, kind === 'bundle'),
}));

export const sellData: SellData = {
  sellables,
  todayTickets: [],
  todayShifts: [],
  schedulingEnabled: true,
  orgTz: 'America/Lima',
  stockEnabled: true,
  resources: [
    { id: 'res-1', name: 'Dr. Paula Ríos' },
    { id: 'res-2', name: 'Treatment room 2' },
  ],
  eventTypes: [],
};

const method = (id: string, label: string, takesTendered = false) => ({
  id,
  label,
  enabled: true,
  takesTendered,
  drawsOnCredit: false,
  requiresCreditDecision: false,
});

export const posSettings: Settings = {
  methods: [
    method('cash', 'Efectivo', true),
    method('card', 'Tarjeta'),
    method('yape', 'Yape'),
    method('transfer', 'Transferencia'),
  ],
  currency: 'PEN',
  requireCustomer: false,
  allowPriceOverride: true,
  emission: { mode: 'off', docTypeDefault: '03' },
  requirements: normalizeRequirements({}),
  currencyIssue: null,
  supportedCurrencies: ['PEN'],
  paymentPolicyRevision: 'r1',
  updatedAt: null,
};

const opened = new Date(Date.UTC(2026, 10, 10, 13, 5));
export const openShift: OpenShift = {
  shift: {
    id: 'shift-1',
    orgId: 'org-demo',
    status: 'open',
    openedBy: 'u-demo-1',
    openedAt: opened,
    openingFloat: { cash: 200 },
    closedBy: null,
    closedAt: null,
    expected: null,
    counted: null,
    note: null,
    createdAt: opened,
    updatedAt: opened,
  },
  summary: {
    ticketCount: 7,
    voidCount: 0,
    gross: 3185,
    byMethod: { cash: 610, card: 2575 },
    unemitted: 0,
  },
};

/** The /pos layout's own page.data slots (settings, shift, pending work). */
export const posLayoutData = {
  stockEnabled: true,
  schedulingEnabled: true,
  posSettings,
  openShift,
  openerName: 'Inés Robles',
  openShifts: [],
  posPendingWork: 0,
};
