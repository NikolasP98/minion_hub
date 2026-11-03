import { stockFacts } from '$lib/modules/stock/facts';
import { col, defineServerModule } from './sdk.server';

/**
 * Stock's server companion (spec 047). Every link below is a soft reference:
 * no foreign key joins a `stk_*` table to another module's table today (local
 * QA catalog 2026-11-01; the migrations mark them "soft ref → …"). Keys between
 * two `stk_*` tables are internal to the module and not listed.
 */
export const stockServer = defineServerModule({
  module: stockFacts,
  datasets: [
    {
      id: 'stock.items',
      module: 'stock',
      meaning: 'Stock items with their current on-hand quantity and valuation across all bins.',
      from: [
        'stk_items t',
        'left join lateral (',
        'select coalesce(sum(b.qty), 0) as qty_on_hand,',
        'coalesce(sum(b.qty * b.valuation_rate), 0) as valuation',
        'from stk_bins b where b.org_id = t.org_id and b.item_id = t.id',
        ') bins on true',
      ].join(' '),
      orgColumn: 't.org_id',
      defaultOrder: 'name asc',
      defaultColumns: ['code', 'name', 'uom', 'qty_on_hand'],
      columns: [
        col('code', 'text', 'Item code / SKU'),
        col('name', 'text', 'Item name'),
        col('uom', 'text', 'Unit of measure'),
        col('item_group', 'text', 'Item group / family'),
        col('reorder_level', 'number', 'Quantity at which to reorder'),
        col('qty_on_hand', 'number', 'Sum of stk_bins.qty across warehouses', {
          expr: 'bins.qty_on_hand',
        }),
        col('valuation', 'number', 'Sum of qty * valuation_rate across warehouses', {
          expr: 'bins.valuation',
        }),
      ],
    },
  ],
  links: [
    // Retired sellable-stock bridge (20261017120000); the column is still present.
    { from: 'stk_items.fin_product_id', to: 'fin_products.id', soft: true },
    { from: 'stk_items.default_supplier_party_id', to: 'parties.id', soft: true },
    { from: 'stk_entries.party_id', to: 'parties.id', soft: true },
    { from: 'stk_consumption.fin_product_id', to: 'fin_products.id', soft: true },
    { from: 'stk_accruals.fin_product_id', to: 'fin_products.id', soft: true },
    // Polymorphic on stk_accruals.source; 'booking' is the only source today.
    { from: 'stk_accruals.source_id', to: 'sched_bookings.id', soft: true },
    { from: 'pos_tickets.stock_entry_id', to: 'stk_entries.id', soft: true },
  ],
});
