/**
 * Stock — warehouses, items, the receipt→issue→transfer→adjustment→cancelled
 * entry chain (+ the ledger/bin rows that chain produces), accruals,
 * consumption mappings, and one item-composition edge.
 *
 * The duplicate-invoiceId entry (`stock.entry.issue-duplicate-invoice-id`) is
 * deliberately NOT inserted here — the whole point of that matrix id is that
 * the insert must FAIL against `stk_entries_org_active_invoice_issue_uniq`.
 * `seed.contract.test.ts` performs that insert itself and asserts the unique
 * violation; this module only hands it the exact invoiceId to collide with
 * (`CHAIN_INVOICE_ID` below).
 */
import { matrixUuid, humanId } from './ids';
import { ORG_BUSINESS, userId } from './tenancy';
import { PRODUCT_TRACKED, PRODUCT_RAW_MATERIAL_LINK, PRODUCT_CONSUMPTION_2_ITEMS } from './catalog';
import type { SeedContext } from './db';

export const WH_DEFAULT = matrixUuid('stock.warehouse.default');
export const WH_CHILD = matrixUuid('stock.warehouse.child');
export const WH_ARCHIVED = matrixUuid('stock.warehouse.archived');

export const ITEM_UOM_CONVERSION = matrixUuid('stock.item.uom-conversion');
export const ITEM_RECIPE_PARENT = matrixUuid('stock.item.recipe-with-optional-child', 'parent');
export const ITEM_RECIPE_CHILD = matrixUuid('stock.item.recipe-with-optional-child', 'child');
export const ITEM_LOW_STOCK = matrixUuid('stock.item.low-stock');
export const ITEM_TRACKED = matrixUuid('catalog.product.tracked', 'stk-item');
export const ITEM_RAW_MATERIAL_PARENT = matrixUuid('catalog.product.raw-material-link', 'stk-item');
export const ITEM_RAW_MATERIAL_CHILD = matrixUuid(
  'catalog.product.raw-material-link',
  'raw-material-child',
);
export const ITEM_CONSUMPTION_A = matrixUuid('stock.consumption.two-items', 'item-a');
export const ITEM_CONSUMPTION_B = matrixUuid('stock.consumption.two-items', 'item-b');
export const ITEM_CHAIN = matrixUuid('stock.entry.receipt', 'chain-item');

export const CHAIN_INVOICE_ID = 'INV-QA-DUP-0001';

const ENTRY_RECEIPT = matrixUuid('stock.entry.receipt');
const ENTRY_ISSUE = matrixUuid('stock.entry.issue');
const ENTRY_TRANSFER = matrixUuid('stock.entry.transfer');
const ENTRY_ADJUSTMENT = matrixUuid('stock.entry.adjustment');
const ENTRY_CANCELLED = matrixUuid('stock.entry.cancelled');

export async function seed(ctx: SeedContext): Promise<void> {
  const { sql, register, now } = ctx;
  const createdBy = userId('tenancy.user.owner');

  await sql`
    insert into stk_warehouses (id, org_id, name, parent_id, is_default, archived_at)
    values
      (${WH_DEFAULT}, ${ORG_BUSINESS}, 'QA Main Warehouse', null, true, null),
      (${WH_CHILD}, ${ORG_BUSINESS}, 'QA Sub Warehouse', ${WH_DEFAULT}, false, null),
      (${WH_ARCHIVED}, ${ORG_BUSINESS}, 'QA Archived Warehouse', null, false, ${now.toISOString()})
    on conflict (id) do update set name = excluded.name, archived_at = excluded.archived_at
  `;
  register('stock.warehouse.default', { table: 'stk_warehouses', where: { id: WH_DEFAULT } });
  register('stock.warehouse.child', { table: 'stk_warehouses', where: { id: WH_CHILD } });
  register('stock.warehouse.archived', { table: 'stk_warehouses', where: { id: WH_ARCHIVED } });

  const items: Array<{
    matrixId?: string;
    id: string;
    code: string;
    name: string;
    uom: string;
    consumptionUom?: string;
    unitsPerStockUom?: string;
    reorderLevel?: string;
    finProductId?: string;
  }> = [
    {
      matrixId: 'stock.item.uom-conversion',
      id: ITEM_UOM_CONVERSION,
      code: 'QA-UOM',
      name: 'QA Box-to-Unit Item',
      uom: 'box',
      consumptionUom: 'unit',
      unitsPerStockUom: '24',
    },
    {
      matrixId: 'stock.item.recipe-with-optional-child',
      id: ITEM_RECIPE_PARENT,
      code: 'QA-RCP',
      name: 'QA Recipe Parent Item',
      uom: 'unit',
    },
    { id: ITEM_RECIPE_CHILD, code: 'QA-RCC', name: 'QA Recipe Optional Child', uom: 'unit' },
    {
      matrixId: 'stock.item.low-stock',
      id: ITEM_LOW_STOCK,
      code: 'QA-LOW',
      name: 'QA Low Stock Item',
      uom: 'unit',
      reorderLevel: '20',
    },
    {
      id: ITEM_TRACKED,
      code: 'QA-TRK',
      name: 'QA Tracked Item',
      uom: 'ml',
      finProductId: PRODUCT_TRACKED,
    },
    {
      id: ITEM_RAW_MATERIAL_PARENT,
      code: 'QA-RMP',
      name: 'QA Raw-Material-Linked Item',
      uom: 'unit',
      finProductId: PRODUCT_RAW_MATERIAL_LINK,
    },
    { id: ITEM_RAW_MATERIAL_CHILD, code: 'QA-RMC', name: 'QA Raw Material', uom: 'ml' },
    { id: ITEM_CONSUMPTION_A, code: 'QA-CSA', name: 'QA Consumption Item A', uom: 'ml' },
    { id: ITEM_CONSUMPTION_B, code: 'QA-CSB', name: 'QA Consumption Item B', uom: 'unit' },
    { id: ITEM_CHAIN, code: 'QA-CHN', name: 'QA Entry-Chain Item', uom: 'unit' },
  ];
  for (const it of items) {
    await sql`
      insert into stk_items (id, org_id, code, name, uom, consumption_uom, units_per_stock_uom, reorder_level, fin_product_id)
      values (
        ${it.id}, ${ORG_BUSINESS}, ${it.code}, ${it.name}, ${it.uom},
        ${it.consumptionUom ?? null}, ${it.unitsPerStockUom ?? null}, ${it.reorderLevel ?? null}, ${it.finProductId ?? null}
      )
      on conflict (org_id, code) do update set name = excluded.name, reorder_level = excluded.reorder_level
    `;
    if (it.matrixId) register(it.matrixId, { table: 'stk_items', where: { id: it.id } });
  }

  await sql`
    insert into stk_item_components (org_id, parent_item_id, child_item_id, qty, optional, default_included)
    values (${ORG_BUSINESS}, ${ITEM_RECIPE_PARENT}, ${ITEM_RECIPE_CHILD}, 1, true, false)
    on conflict (org_id, parent_item_id, child_item_id) do update set optional = excluded.optional
  `;
  await sql`
    insert into stk_item_components (org_id, parent_item_id, child_item_id, qty, optional, default_included)
    values (${ORG_BUSINESS}, ${ITEM_RAW_MATERIAL_PARENT}, ${ITEM_RAW_MATERIAL_CHILD}, 5, false, true)
    on conflict (org_id, parent_item_id, child_item_id) do update set qty = excluded.qty
  `;

  // Low-stock: bin sitting under reorder_level (20).
  await sql`
    insert into stk_bins (org_id, item_id, warehouse_id, qty, valuation_rate)
    values (${ORG_BUSINESS}, ${ITEM_LOW_STOCK}, ${WH_DEFAULT}, 5, 4.00)
    on conflict (org_id, item_id, warehouse_id) do update set qty = excluded.qty
  `;

  // ── Entry chain: receipt(+20) -> transfer(-5/+5) -> adjustment(+2) -> issue(-17) -> cancelled.
  async function entry(
    matrixId: string,
    id: string,
    type: string,
    status: string,
    metadata: Record<string, unknown>,
  ) {
    await sql`
      insert into stk_entries (id, org_id, human_id, type, status, note, posted_at, created_by, metadata)
      values (
        ${id}, ${ORG_BUSINESS}, ${humanId('STE', matrixId)}, ${type}, ${status}, ${matrixId},
        ${status === 'submitted' ? now.toISOString() : null}, ${createdBy}, ${sql.json(metadata)}
      )
      on conflict (id) do update set status = excluded.status, metadata = excluded.metadata
    `;
    register(matrixId, { table: 'stk_entries', where: { id } });
  }

  // stk_ledger is APPEND-ONLY (bigserial id, no update/delete grant) — there is
  // no natural key to `on conflict` against, so idempotency has to be an
  // application-level guard: only insert a ledger row for this
  // (entry_id, warehouse_id) pair if one doesn't already exist. Without this,
  // every re-run of the seed would append a fresh row forever.
  async function ledgerRow(
    itemId: string,
    warehouseId: string,
    entryId: string,
    qtyDelta: number,
    qtyAfter: number,
    valuationRate: number,
    valueDelta: number,
  ) {
    await sql`
      insert into stk_ledger (org_id, item_id, warehouse_id, entry_id, qty_delta, qty_after, valuation_rate, value_delta)
      select ${ORG_BUSINESS}, ${itemId}, ${warehouseId}, ${entryId}, ${qtyDelta}, ${qtyAfter}, ${valuationRate}, ${valueDelta}
      where not exists (select 1 from stk_ledger where entry_id = ${entryId} and warehouse_id = ${warehouseId})
    `;
  }

  await entry('stock.entry.receipt', ENTRY_RECEIPT, 'receipt', 'submitted', {});
  await sql`
    insert into stk_entry_lines (id, org_id, entry_id, item_id, qty, uom, rate, to_warehouse_id, line_no)
    values (${matrixUuid('stock.entry.receipt', 'line')}, ${ORG_BUSINESS}, ${ENTRY_RECEIPT}, ${ITEM_CHAIN}, 20, 'unit', 5.00, ${WH_DEFAULT}, 0)
    on conflict (id) do nothing
  `;
  await ledgerRow(ITEM_CHAIN, WH_DEFAULT, ENTRY_RECEIPT, 20, 20, 5.0, 100.0);

  await entry('stock.entry.transfer', ENTRY_TRANSFER, 'transfer', 'submitted', {});
  await sql`
    insert into stk_entry_lines (id, org_id, entry_id, item_id, qty, uom, from_warehouse_id, to_warehouse_id, line_no)
    values (${matrixUuid('stock.entry.transfer', 'line')}, ${ORG_BUSINESS}, ${ENTRY_TRANSFER}, ${ITEM_CHAIN}, 5, 'unit', ${WH_DEFAULT}, ${WH_CHILD}, 0)
    on conflict (id) do nothing
  `;
  await ledgerRow(ITEM_CHAIN, WH_DEFAULT, ENTRY_TRANSFER, -5, 15, 5.0, -25.0);
  await ledgerRow(ITEM_CHAIN, WH_CHILD, ENTRY_TRANSFER, 5, 5, 5.0, 25.0);

  await entry('stock.entry.adjustment', ENTRY_ADJUSTMENT, 'adjustment', 'submitted', {});
  await sql`
    insert into stk_entry_lines (id, org_id, entry_id, item_id, qty, uom, rate, to_warehouse_id, line_no)
    values (${matrixUuid('stock.entry.adjustment', 'line')}, ${ORG_BUSINESS}, ${ENTRY_ADJUSTMENT}, ${ITEM_CHAIN}, 2, 'unit', 6.00, ${WH_DEFAULT}, 0)
    on conflict (id) do nothing
  `;
  await ledgerRow(ITEM_CHAIN, WH_DEFAULT, ENTRY_ADJUSTMENT, 2, 17, 5.12, 12.0);

  await entry('stock.entry.issue', ENTRY_ISSUE, 'issue', 'submitted', {
    invoiceId: CHAIN_INVOICE_ID,
  });
  // stock.entry.issue-duplicate-invoice-id has no row of its own (see the file
  // header) — it "materializes" as the original issue entry its variant is
  // designed to collide with, so orchestrator coverage stays honest while the
  // real behavioral assertion (the insert must fail) lives in the contract test.
  register('stock.entry.issue-duplicate-invoice-id', {
    table: 'stk_entries',
    where: { id: ENTRY_ISSUE },
  });
  await sql`
    insert into stk_entry_lines (id, org_id, entry_id, item_id, qty, uom, from_warehouse_id, line_no)
    values (${matrixUuid('stock.entry.issue', 'line')}, ${ORG_BUSINESS}, ${ENTRY_ISSUE}, ${ITEM_CHAIN}, 17, 'unit', ${WH_DEFAULT}, 0)
    on conflict (id) do nothing
  `;
  await ledgerRow(ITEM_CHAIN, WH_DEFAULT, ENTRY_ISSUE, -17, 0, 5.12, -87.04);
  await sql`
    insert into stk_bins (org_id, item_id, warehouse_id, qty, valuation_rate)
    values
      (${ORG_BUSINESS}, ${ITEM_CHAIN}, ${WH_DEFAULT}, 0, 5.12),
      (${ORG_BUSINESS}, ${ITEM_CHAIN}, ${WH_CHILD}, 5, 5.00)
    on conflict (org_id, item_id, warehouse_id) do update set qty = excluded.qty, valuation_rate = excluded.valuation_rate
  `;
  register('stock.bin.zero', {
    table: 'stk_bins',
    where: { org_id: ORG_BUSINESS, item_id: ITEM_CHAIN, warehouse_id: WH_DEFAULT, qty: 0 },
  });

  await entry('stock.entry.cancelled', ENTRY_CANCELLED, 'adjustment', 'cancelled', {});

  // ── Accruals — soft refs to bookings scheduling.ts creates (no FK, order-independent).
  const bookingOpen = matrixUuid('sched.booking.accepted');
  const bookingRealized = matrixUuid('sched.booking.completed');
  const bookingReleased = matrixUuid('sched.booking.cancelled');
  const accrualOpen = matrixUuid('stock.accrual.open');
  const accrualRealized = matrixUuid('stock.accrual.realized');
  const accrualReleased = matrixUuid('stock.accrual.released');
  await sql`
    insert into stk_accruals (id, org_id, source, source_id, fin_product_id, item_id, warehouse_id, qty_consumption, qty, est_unit_cost, est_value, status, realized_entry_id, realized_at, released_at)
    values
      (${accrualOpen}, ${ORG_BUSINESS}, 'booking', ${bookingOpen}, ${PRODUCT_TRACKED}, ${ITEM_CONSUMPTION_A}, ${WH_DEFAULT}, 5, 5, 4.00, 20.00, 'open', null, null, null),
      (${accrualRealized}, ${ORG_BUSINESS}, 'booking', ${bookingRealized}, ${PRODUCT_TRACKED}, ${ITEM_CONSUMPTION_A}, ${WH_DEFAULT}, 5, 5, 4.00, 20.00, 'realized', ${ENTRY_ISSUE}, ${now.toISOString()}, null),
      (${accrualReleased}, ${ORG_BUSINESS}, 'booking', ${bookingReleased}, ${PRODUCT_TRACKED}, ${ITEM_CONSUMPTION_A}, ${WH_DEFAULT}, 5, 5, 4.00, 20.00, 'released', null, null, ${now.toISOString()})
    on conflict (org_id, source, source_id, item_id) do update set status = excluded.status
  `;
  register('stock.accrual.open', { table: 'stk_accruals', where: { id: accrualOpen } });
  register('stock.accrual.realized', { table: 'stk_accruals', where: { id: accrualRealized } });
  register('stock.accrual.released', { table: 'stk_accruals', where: { id: accrualReleased } });

  await sql`
    insert into stk_consumption (org_id, fin_product_id, item_id, qty_per_unit)
    values
      (${ORG_BUSINESS}, ${PRODUCT_CONSUMPTION_2_ITEMS}, ${ITEM_CONSUMPTION_A}, 2.5),
      (${ORG_BUSINESS}, ${PRODUCT_CONSUMPTION_2_ITEMS}, ${ITEM_CONSUMPTION_B}, 1)
    on conflict (org_id, fin_product_id, item_id) do update set qty_per_unit = excluded.qty_per_unit
  `;
  register('stock.consumption.two-items', {
    table: 'stk_consumption',
    where: {
      org_id: ORG_BUSINESS,
      fin_product_id: PRODUCT_CONSUMPTION_2_ITEMS,
      item_id: ITEM_CONSUMPTION_A,
    },
  });
}
