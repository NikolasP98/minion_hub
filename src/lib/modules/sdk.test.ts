import { describe, expect, expectTypeOf, it } from 'vitest';
import * as m from '$lib/paraglide/messages';
import { TABLE_REGISTRY } from '$lib/tables/defs';
import { MODULE_MANIFEST, type ModuleId } from './availability';
import { manifestFrom, tablesFrom } from './sdk';
import { stock } from './stock';
import { stockFacts } from './stock/facts';

// Parity (spec 047 US3): literal copies of the hand-written stock entries as
// they were on master 812a4b0a, before stock became one definition.
describe('module SDK parity — stock', () => {
  it('derives the same MODULE_MANIFEST.stock entry', () => {
    expect(MODULE_MANIFEST.stock).toStrictEqual({
      appPrefixes: ['/stock'],
      toggleId: 'stock',
      kinds: ['business'],
    });
    expect(manifestFrom([stockFacts])).toStrictEqual({ stock: MODULE_MANIFEST.stock });
  });

  it('keeps the manifest free of table labels', async () => {
    // availability.ts is imported by the hooks and server services; the
    // paraglide bundle must not ride along (cold-import timeouts).
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('src/lib/modules/stock/facts.ts', 'utf8'),
    );
    expect(src).not.toContain('paraglide');
    expect(stock).toMatchObject(stockFacts);
  });

  it('keeps ModuleId a literal union and the manifest key order', () => {
    const id: ModuleId = 'stock';
    expect(id).toBe('stock');
    expectTypeOf<'stock'>().toExtend<ModuleId>();
    expectTypeOf<'nope'>().not.toExtend<ModuleId>();
    expect(Object.keys(MODULE_MANIFEST)).toEqual([
      'crm',
      'finances',
      'ads',
      'sales',
      'support',
      'scheduling',
      'memberships',
      'team',
      'pulse',
      'pos',
      'stock',
      'workforce',
      'posAppointments',
    ]);
  });

  it('derives the same two stock TableDefs', () => {
    const shape = (id: string) => {
      const t = TABLE_REGISTRY.find((d) => d.id === id)!;
      return {
        id: t.id,
        module: t.module,
        label: t.label(),
        idPrefix: t.idPrefix,
        hasId: t.hasId,
        fields: t.fields.map((f) => [f.key, f.label(), f.editable]),
      };
    };
    expect(shape('stock.items')).toStrictEqual({
      id: 'stock.items',
      module: 'stock',
      label: m.stock_items_title(),
      idPrefix: 'ITM-',
      hasId: true,
      fields: [
        ['name', m.stock_col_name(), true],
        ['uom', m.stock_col_uom(), false],
        ['tags', m.stock_col_tags(), false],
        ['qtyOnHand', m.stock_col_on_hand(), false],
        ['stockValue', m.stock_col_value(), false],
        ['reorderLevel', m.stock_col_reorder_level(), true],
        ['lastRestockCost', m.stock_col_last_restock_cost(), false],
        ['lastSupplierName', m.stock_col_last_supplier(), false],
      ],
    });
    expect(shape('stock.entries')).toStrictEqual({
      id: 'stock.entries',
      module: 'stock',
      label: m.stock_entries_title(),
      idPrefix: 'ENT-',
      hasId: true,
      fields: [
        ['type', m.stock_col_type(), false],
        ['status', m.stock_col_status(), false],
        ['party', m.stock_col_party(), false],
        ['document', m.stock_col_document(), false],
        ['warehouse', m.stock_col_warehouse(), false],
        ['lines', m.stock_col_lines(), false],
        ['note', m.stock_field_note(), false],
        ['posted', m.stock_col_posted_at(), false],
        ['created', m.stock_col_created(), false],
      ],
    });
    expect(tablesFrom([stock])).toStrictEqual(TABLE_REGISTRY.slice(0, 2));
  });

  it('keeps TABLE_REGISTRY order', () => {
    expect(TABLE_REGISTRY.map((t) => t.id)).toEqual([
      'stock.items',
      'stock.entries',
      'pos.catalog',
      'crm.customers',
      'finances.invoices',
      'finances.purchases',
      'socials.campaigns',
      'scheduling.bookings',
      'team.people',
    ]);
  });
});
