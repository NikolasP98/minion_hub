/**
 * Stock management (P5, ERPNext-based) — Supabase PG, org-scoped via
 * withOrgCore (app_ledger role + app.current_org_id GUC, forced RLS).
 * Companion migration: supabase/migrations/20260702120000_stock.sql (meta-repo
 * root). Design: specs/2026-07-02-hub-erp-agent-native-audit.md §7.
 *
 * stk_ledger is the append-only source of truth; stk_bins is a rebuildable
 * cache. ONLY stock.service.ts's submitEntry/cancelEntry write the ledger —
 * see stock.logic.ts for the (pure) valuation math both rest on.
 */

import { sql } from 'drizzle-orm';
import { bigserial, boolean, integer, jsonb, numeric, pgTable, text, timestamp, uuid, index, primaryKey, uniqueIndex } from 'drizzle-orm/pg-core';

export const stkItems = pgTable(
  'stk_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    uom: text('uom').notNull().default('unit'),
    itemGroup: text('item_group'),
    isStockItem: boolean('is_stock_item').notNull().default(true),
    reorderLevel: numeric('reorder_level'),
    reorderQty: numeric('reorder_qty'),
    /** P5.1b: unit services consume this item in, e.g. 'ml', when it differs
     *  from `uom` (the stock/ledger unit, e.g. 'caja'). Null = same as uom. */
    consumptionUom: text('consumption_uom'),
    /** Conversion factor: 1 stock uom = N consumption uom (e.g. 500 ml/caja). */
    unitsPerStockUom: numeric('units_per_stock_uom'),
    /** Display-only (e.g. 10 bottles/caja) for the ConsumptionGauge SVG. */
    subunitsPerStockUom: numeric('subunits_per_stock_uom'),
    /** Opts the item into the ConsumptionGauge diagram. */
    diagramEnabled: boolean('diagram_enabled').notNull().default(false),
    /** Shape ids from stock-svg.ts; null = registry default. unit = stock-uom
     *  container (box/tray…), subunit = vessel (bottle/vial…). */
    unitSvg: text('unit_svg'),
    subunitSvg: text('subunit_svg'),
    /** v1: 'moving_avg' only (ponytail: FIFO deferred until someone needs it). */
    valuationMethod: text('valuation_method').notNull().default('moving_avg'),
    /** Soft ref → fin_products (bridge to the SUSII-synced catalog). */
    finProductId: uuid('fin_product_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('stk_items_org_code_uniq').on(t.orgId, t.code),
    index('stk_items_org_idx').on(t.orgId),
    // At most ONE item may back a given fin_product — resolveIssueLines and
    // the derived `kind` both assume it. Companion migration:
    // 20260719230000_stk_items_fin_product_uniq.sql
    uniqueIndex('stk_items_org_fin_product_uniq')
      .on(t.orgId, t.finProductId)
      .where(sql`fin_product_id is not null`),
  ],
);

export const stkWarehouses = pgTable(
  'stk_warehouses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    name: text('name').notNull(),
    /** Tree; cycle-guarded in stock.logic.ts (wouldCreateCycle), not the DB. */
    parentId: uuid('parent_id'),
    /** Accrual paths (booking create) have no warehouse input — this org's
     *  default is used, else the earliest-created. One per org (partial uniq). */
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('stk_warehouses_org_idx').on(t.orgId), index('stk_warehouses_org_parent_idx').on(t.orgId, t.parentId)],
);

export const stkEntries = pgTable(
  'stk_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    /** Naming series (STE-YYYY-#####), stamped at submit — see naming-series.ts. */
    humanId: text('human_id'),
    /** 'receipt' | 'issue' | 'transfer' | 'adjustment' — see stock.logic.ts ENTRY_TYPES. */
    type: text('type').notNull(),
    /** 'draft' | 'submitted' | 'cancelled' — see stock.logic.ts ENTRY_STATUSES. */
    status: text('status').notNull().default('draft'),
    /** Soft ref → parties (supplier/customer). */
    partyId: uuid('party_id'),
    note: text('note'),
    /** Set at submit. */
    postedAt: timestamp('posted_at', { withTimezone: true }),
    createdBy: text('created_by'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('stk_entries_org_status_idx').on(t.orgId, t.status),
    index('stk_entries_org_created_idx').on(t.orgId, t.createdAt),
  ],
);

/** org_id is denormalized from the parent entry — needed on the row itself for RLS. */
export const stkEntryLines = pgTable(
  'stk_entry_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    entryId: uuid('entry_id').notNull(),
    itemId: uuid('item_id').notNull(),
    qty: numeric('qty').notNull(),
    uom: text('uom'),
    /** Required for receipt lines / positive adjustments; ignored for issues
     *  (those consume at the bin's current valuation rate). */
    rate: numeric('rate'),
    fromWarehouseId: uuid('from_warehouse_id'),
    toWarehouseId: uuid('to_warehouse_id'),
    lineNo: integer('line_no').notNull().default(0),
  },
  (t) => [index('stk_entry_lines_entry_idx').on(t.entryId), index('stk_entry_lines_org_idx').on(t.orgId)],
);

/**
 * APPEND-ONLY. `id` is a bigserial (not uuid) so it doubles as the strict
 * total order rebuildBins replays on. `qtyAfter`/`valuationRate` are the
 * resulting BIN snapshot immediately after this row commits — rebuildBins
 * just takes the latest row per (item, warehouse); no re-derivation.
 * DB grants omit update/delete for the app_ledger role (see migration) —
 * append-only is enforced at the privilege layer, not just by convention.
 */
export const stkLedger = pgTable(
  'stk_ledger',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    orgId: text('org_id').notNull(),
    itemId: uuid('item_id').notNull(),
    warehouseId: uuid('warehouse_id').notNull(),
    entryId: uuid('entry_id').notNull(),
    qtyDelta: numeric('qty_delta').notNull(),
    qtyAfter: numeric('qty_after').notNull(),
    valuationRate: numeric('valuation_rate').notNull(),
    valueDelta: numeric('value_delta').notNull(),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('stk_ledger_org_item_posted_idx').on(t.orgId, t.itemId, t.postedAt),
    index('stk_ledger_entry_idx').on(t.entryId),
  ],
);

/** Rebuildable cache — PK doubles as the natural lookup index. */
export const stkBins = pgTable(
  'stk_bins',
  {
    orgId: text('org_id').notNull(),
    itemId: uuid('item_id').notNull(),
    warehouseId: uuid('warehouse_id').notNull(),
    qty: numeric('qty').notNull().default('0'),
    valuationRate: numeric('valuation_rate').notNull().default('0'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.itemId, t.warehouseId] })],
);

/**
 * P5.1 interconnect: fin_product (service/product sold) → stk_items consumed
 * per unit sold/performed. Completes the catalog triangle
 * sched_event_types.product_id → fin_products ← stk_items.fin_product_id.
 * Companion migration: supabase/migrations/20260703160000_stock_consumption.sql.
 * Design: specs/hub-erp-roadmap/P5.1-stock-interconnect-seed.md §D1/D2.
 */
export const stkConsumption = pgTable(
  'stk_consumption',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    /** Soft ref → fin_products (sold service/product); no FK — cross-schema, same
     *  soft-ref convention as stkItems.finProductId above. */
    finProductId: uuid('fin_product_id').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => stkItems.id, { onDelete: 'cascade' }),
    qtyPerUnit: numeric('qty_per_unit').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('stk_consumption_org_product_item_uniq').on(t.orgId, t.finProductId, t.itemId),
    index('stk_consumption_org_product_idx').on(t.orgId, t.finProductId),
  ],
);

/**
 * Consumption accruals — potential (committed) spend vs realized spend.
 * A booking accrues expected consumption at creation ('open'), realizes into a
 * posted stk_entry at completion, or releases on cancel/no-show. Parallel to
 * the real ledger; NEVER a ledger writer.
 * Companion migration: supabase/migrations/20260705230000_stock_accruals.sql.
 * Design: docs/superpowers/specs/2026-07-05-consumption-accrual-scheduling-stock-design.md.
 */
export const stkAccruals = pgTable(
  'stk_accruals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    /** 'booking' today; 'order' later. Legacy /stock/consume issues never accrue. */
    source: text('source').notNull(),
    sourceId: uuid('source_id').notNull(),
    /** Soft ref → fin_products (the sold service that drove the accrual). */
    finProductId: uuid('fin_product_id'),
    itemId: uuid('item_id')
      .notNull()
      .references(() => stkItems.id, { onDelete: 'cascade' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => stkWarehouses.id),
    /** Expected, consumption uom (what the gauge edits). */
    qtyConsumption: numeric('qty_consumption').notNull(),
    /** Expected, stock uom (server-converted via unitsPerStockUom). */
    qty: numeric('qty').notNull(),
    /** Moving-avg cost snapshot at accrual time. */
    estUnitCost: numeric('est_unit_cost').notNull().default('0'),
    estValue: numeric('est_value').notNull().default('0'),
    /** 'open' | 'realized' | 'released' */
    status: text('status').notNull().default('open'),
    realizedEntryId: uuid('realized_entry_id'),
    realizedQty: numeric('realized_qty'),
    realizedValue: numeric('realized_value'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    realizedAt: timestamp('realized_at', { withTimezone: true }),
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('stk_accruals_org_source_item_uniq').on(t.orgId, t.source, t.sourceId, t.itemId),
    index('stk_accruals_org_status_idx').on(t.orgId, t.status),
    index('stk_accruals_org_item_wh_status_idx').on(t.orgId, t.itemId, t.warehouseId, t.status),
    index('stk_accruals_source_idx').on(t.source, t.sourceId),
  ],
);

export type StkItem = typeof stkItems.$inferSelect;
export type StkWarehouse = typeof stkWarehouses.$inferSelect;
export type StkEntry = typeof stkEntries.$inferSelect;
export type StkEntryLine = typeof stkEntryLines.$inferSelect;
export type StkLedgerRow = typeof stkLedger.$inferSelect;
export type StkBin = typeof stkBins.$inferSelect;
export type StkConsumption = typeof stkConsumption.$inferSelect;
export type StkAccrual = typeof stkAccruals.$inferSelect;
