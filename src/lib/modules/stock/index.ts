import * as m from '$lib/paraglide/messages';
import { defineModule } from '../sdk';
import { stockFacts } from './facts';

const f = (key: string, label: () => string, editable = false) => ({ key, label, editable });

/**
 * Stock — the first module written as one definition (spec 047). Its tables
 * reach `TABLE_REGISTRY` and its availability reaches `MODULE_MANIFEST` from
 * here (availability via `./facts`); the datasets and cross-module links live in
 * `$server/modules/stock.server.ts`.
 */
export const stock = defineModule({
  ...stockFacts,
  tables: [
    {
      id: 'stock.items',
      module: 'stock',
      label: m.stock_items_title,
      idPrefix: 'ITM-',
      hasId: true,
      fields: [
        f('name', m.stock_col_name, true),
        f('uom', m.stock_col_uom),
        f('tags', m.stock_col_tags),
        f('qtyOnHand', m.stock_col_on_hand),
        f('stockValue', m.stock_col_value),
        f('reorderLevel', m.stock_col_reorder_level, true),
        f('lastRestockCost', m.stock_col_last_restock_cost),
        f('lastSupplierName', m.stock_col_last_supplier),
      ],
    },
    {
      id: 'stock.entries',
      module: 'stock',
      label: m.stock_entries_title,
      idPrefix: 'ENT-',
      hasId: true,
      fields: [
        f('type', m.stock_col_type),
        f('status', m.stock_col_status),
        f('party', m.stock_col_party),
        f('document', m.stock_col_document),
        f('warehouse', m.stock_col_warehouse),
        f('lines', m.stock_col_lines),
        f('note', m.stock_field_note),
        f('posted', m.stock_col_posted_at),
        f('created', m.stock_col_created),
      ],
    },
  ],
});
