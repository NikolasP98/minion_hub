// Dummy /stock/entries load output (invented items, suppliers and amounts).
import type { Granted } from '$lib/permissions';
import type { PageData as StockPage } from '../../../../routes/(app)/stock/entries/$types';

type Data = Granted<StockPage['stock']>;
type Entry = Data['entries'][number];

const day = (d: number, h = 10) => new Date(Date.UTC(2026, 10, d, h, 0, 0));

function entry(n: number, type: string, status: string, extra: Partial<Entry> = {}): Entry {
  const created = day(10 - (n % 9), 9 + (n % 8));
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    orgId: 'org-demo',
    humanId: status === 'draft' ? null : `STE-2026-${String(140 + n).padStart(5, '0')}`,
    type,
    status,
    partyId: null,
    note: null,
    postedAt: status === 'submitted' ? created : null,
    createdBy: 'u-demo-1',
    metadata: {},
    createdAt: created,
    updatedAt: created,
    partyName: null,
    document: null,
    lineCount: 1 + (n % 4),
    firstFromWarehouseId: type === 'receipt' ? null : 'wh-main',
    firstToWarehouseId: type === 'transfer' ? 'wh-room2' : type === 'receipt' ? 'wh-main' : null,
    attachmentCount: n % 5 === 0 ? 1 : 0,
    ...extra,
  };
}

export const stockEntriesData: Data = {
  customProperties: {
    definitions: [],
    values: {},
    recordAccess: {},
    canManage: false,
    canEdit: false,
  },
  entries: [
    entry(1, 'receipt', 'submitted', {
      partyId: 'p-sup-1',
      partyName: 'Distribuidora Medica Sur',
      note: 'Monthly restock',
      document: {
        kind: 'purchase',
        id: 'pur-1',
        href: '/finances/purchases/pur-1',
        label: 'F001-00482',
      },
    }),
    entry(2, 'issue', 'submitted', {
      document: { kind: 'ticket', id: 't-1', href: '/pos/history/t-1', label: '#T-2031' },
    }),
    entry(3, 'transfer', 'submitted', { note: 'Move to treatment room 2' }),
    entry(4, 'adjustment', 'submitted', { note: 'Cycle count, gloves box short by 2' }),
    entry(5, 'receipt', 'draft', { partyId: 'p-sup-2', partyName: 'Laboratorios Andinos' }),
    entry(6, 'issue', 'submitted', {
      document: { kind: 'ticket', id: 't-2', href: '/pos/history/t-2', label: '#T-2028' },
    }),
    entry(7, 'issue', 'cancelled', { note: 'Duplicated by mistake' }),
    entry(8, 'receipt', 'submitted', {
      partyId: 'p-sup-1',
      partyName: 'Distribuidora Medica Sur',
      document: {
        kind: 'purchase',
        id: 'pur-2',
        href: '/finances/purchases/pur-2',
        label: 'F001-00471',
      },
    }),
    entry(9, 'issue', 'submitted', {
      document: { kind: 'ticket', id: 't-3', href: '/pos/history/t-3', label: '#T-2019' },
    }),
    entry(10, 'transfer', 'draft'),
    entry(11, 'issue', 'submitted', {
      document: { kind: 'ticket', id: 't-4', href: '/pos/history/t-4', label: '#T-2011' },
    }),
    entry(12, 'adjustment', 'submitted', { note: 'Expired lot removed' }),
  ],
  partyFilter: null,
  itemsById: {
    'it-1': { code: 'GLV-M', name: 'Nitrile gloves, size M' },
    'it-2': { code: 'HA-1ML', name: 'Hyaluronic acid syringe 1 ml' },
    'it-3': { code: 'GAUZE', name: 'Sterile gauze 10x10' },
  },
  warehousesById: { 'wh-main': 'Main storage', 'wh-room2': 'Treatment room 2' },
  warehouseCount: 2,
};
