import { describe, expect, it } from 'vitest';
import { DATASETS } from '$server/sandbox/datasets';
import { datasetsFrom } from './sdk.server';
import { stockServer } from './stock.server';

// Parity (spec 047 US3): the hand-written stock dataset as it was on master
// 812a4b0a, with `col()` expanded.
const STOCK_ITEMS_DATASET = {
  id: 'stock.items',
  module: 'stock',
  meaning: 'Stock items with their current on-hand quantity and valuation across all bins.',
  from:
    'stk_items t left join lateral ( select coalesce(sum(b.qty), 0) as qty_on_hand, ' +
    'coalesce(sum(b.qty * b.valuation_rate), 0) as valuation ' +
    'from stk_bins b where b.org_id = t.org_id and b.item_id = t.id ) bins on true',
  orgColumn: 't.org_id',
  defaultOrder: 'name asc',
  defaultColumns: ['code', 'name', 'uom', 'qty_on_hand'],
  columns: [
    { name: 'code', type: 'text', meaning: 'Item code / SKU' },
    { name: 'name', type: 'text', meaning: 'Item name' },
    { name: 'uom', type: 'text', meaning: 'Unit of measure' },
    { name: 'item_group', type: 'text', meaning: 'Item group / family' },
    { name: 'reorder_level', type: 'number', meaning: 'Quantity at which to reorder' },
    {
      name: 'qty_on_hand',
      type: 'number',
      meaning: 'Sum of stk_bins.qty across warehouses',
      expr: 'bins.qty_on_hand',
    },
    {
      name: 'valuation',
      type: 'number',
      meaning: 'Sum of qty * valuation_rate across warehouses',
      expr: 'bins.valuation',
    },
  ],
};

describe('module SDK parity — stock datasets', () => {
  it('derives the same stock dataset', () => {
    expect(datasetsFrom([stockServer])).toStrictEqual([STOCK_ITEMS_DATASET]);
    expect(DATASETS.find((d) => d.id === 'stock.items')).toStrictEqual(STOCK_ITEMS_DATASET);
  });

  it('keeps DATASETS order', () => {
    expect(DATASETS.map((d) => d.id)).toEqual([
      'crm.contacts',
      'pos.tickets',
      'pos.ticket_lines',
      'pos.payments',
      'finance.invoices',
      'finance.products',
      'scheduling.bookings',
      'stock.items',
    ]);
  });

  it('declares links as table.column pairs touching a stk_ table on exactly one side', () => {
    for (const { from, to } of stockServer.links) {
      expect(from).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(to).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(from.startsWith('stk_') !== to.startsWith('stk_')).toBe(true);
    }
  });
});
