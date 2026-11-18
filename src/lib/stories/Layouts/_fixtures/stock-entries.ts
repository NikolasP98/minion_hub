// Dummy /stock/entries load output (invented items, suppliers and amounts).
import type { Granted } from '$lib/permissions';
import type { PageData as StockPage } from '../../../../routes/(app)/stock/entries/$types';

type Data = Granted<StockPage['stock']>;
type Movements = Extract<Data['movements'], { projection: 'full' }>;
type Entry = Movements['rows'][number];

const day = (d: number, h = 10) => new Date(Date.UTC(2026, 10, d, h, 0, 0)).toISOString();

function entry(n: number, type: string, status: string, extra: Partial<Entry> = {}): Entry {
  const created = day(10 - (n % 9), 9 + (n % 8));
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const itemId = ['it-1', 'it-2', 'it-3'][n % 3];
  return {
    entryId: id,
    entryHref: `/stock/entries/${id}`,
    humanId: status === 'draft' ? null : `STE-2026-${String(140 + n).padStart(5, '0')}`,
    type: type as Entry['type'],
    status: status as Entry['status'],
    note: null,
    postedAt: status === 'submitted' ? created : null,
    createdAt: created,
    partyName: null,
    partyState: 'missing',
    document: null,
    sourceState: 'missing',
    lineCount: 1,
    firstFromWarehouseId: type === 'receipt' ? null : 'wh-main',
    firstToWarehouseId: type === 'transfer' ? 'wh-room2' : type === 'receipt' ? 'wh-main' : null,
    attachmentCount: n % 5 === 0 ? 1 : 0,
    itemSummary: {
      first: { itemId, name: null, code: null },
      additionalItemCount: 0,
    },
    itemSearchText: itemId,
    lines: [
      {
        lineId: `l-${n}`,
        lineNo: 0,
        itemId,
        qty: String(1 + (n % 4)),
        uom: 'und',
        rate: null,
        fromWarehouseId: type === 'receipt' ? null : 'wh-main',
        toWarehouseId: type === 'transfer' ? 'wh-room2' : type === 'receipt' ? 'wh-main' : null,
      },
    ],
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
  movements: {
    surface: 'entries',
    projection: 'full',
    enrichmentAvailability: 'available',
    reason: null,
    nextCursor: null,
    itemsById: {
      'it-1': { code: 'GLV-M', name: 'Nitrile gloves, size M' },
      'it-2': { code: 'HA-1ML', name: 'Hyaluronic acid syringe 1 ml' },
      'it-3': { code: 'GAUZE', name: 'Sterile gauze 10x10' },
    },
    warehousesById: { 'wh-main': 'Main storage', 'wh-room2': 'Treatment room 2' },
    rows: [
      entry(1, 'receipt', 'submitted', {
        partyName: 'Distribuidora Medica Sur',
        partyState: 'available',
        note: 'Monthly restock',
        document: {
          kind: 'purchase',
          href: '/finances/purchases/pur-1',
          label: 'F001-00482',
        },
      }),
      entry(2, 'issue', 'submitted', {
        sourceState: 'available',
        document: { kind: 'ticket', href: '/pos/history/t-1', label: '#T-2031' },
      }),
      entry(3, 'transfer', 'submitted', { note: 'Move to treatment room 2' }),
      entry(4, 'adjustment', 'submitted', { note: 'Cycle count, gloves box short by 2' }),
      entry(5, 'receipt', 'draft', { partyName: 'Laboratorios Andinos', partyState: 'available' }),
      entry(6, 'issue', 'submitted', {
        sourceState: 'available',
        document: { kind: 'ticket', href: '/pos/history/t-2', label: '#T-2028' },
      }),
      entry(7, 'issue', 'cancelled', { note: 'Duplicated by mistake' }),
      entry(8, 'receipt', 'submitted', {
        partyName: 'Distribuidora Medica Sur',
        partyState: 'available',
        document: {
          kind: 'purchase',
          href: '/finances/purchases/pur-2',
          label: 'F001-00471',
        },
      }),
      entry(9, 'issue', 'submitted', {
        sourceState: 'available',
        document: { kind: 'ticket', href: '/pos/history/t-3', label: '#T-2019' },
      }),
      entry(10, 'transfer', 'draft'),
      entry(11, 'issue', 'submitted', {
        sourceState: 'available',
        document: { kind: 'ticket', href: '/pos/history/t-4', label: '#T-2011' },
      }),
      entry(12, 'adjustment', 'submitted', { note: 'Expired lot removed' }),
    ],
  },
  partyFilter: null,
  warehouseCount: 2,
};
