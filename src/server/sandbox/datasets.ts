/**
 * Sandbox dataset registry — the ONLY source of SQL identifiers the query
 * compiler may emit (spec 010 FR-001, contract §2). Nothing in a query spec
 * ever reaches SQL as an identifier: a spec names a dataset id and column
 * names, both of which are looked up here and replaced by the registry's own
 * `expr`/`from` strings. Values are always bound as parameters.
 *
 * These tables are NOT declared in Drizzle (the business schema lives only in
 * Postgres), so `from`/`expr` are raw SQL fragments. The primary table is
 * always aliased `t`; `orgColumn`/`ownerColumn` are qualified expressions.
 */
import type { Module } from '$server/services/rbac.service';

export type ColumnType = 'text' | 'number' | 'timestamp' | 'boolean' | 'uuid';

export interface DatasetColumn {
  name: string;
  type: ColumnType;
  meaning?: string;
  /** Masked to '***' when the caller's field level is below sensitive. */
  pii?: boolean;
  /** Registry-owned SQL expression; defaults to `t.<name>`. */
  expr?: string;
}

export interface Dataset {
  id: string;
  /** RBAC module gating `view` on this dataset. */
  module: Module;
  meaning: string;
  /** FROM + JOIN clause; the primary table is aliased `t`. */
  from: string;
  /** Qualified org column — defence in depth behind `withOrgCore`'s RLS. */
  orgColumn: string;
  /** Qualified owner column, for record-level (if-owner) scoping. */
  ownerColumn?: string;
  /** `<column> <asc|desc>` applied when the spec has no orderBy. */
  defaultOrder: string;
  /** Columns selected when the spec has no `select`. */
  defaultColumns: string[];
  columns: DatasetColumn[];
}

function col(
  name: string,
  type: ColumnType,
  meaning: string,
  extra: { pii?: boolean; expr?: string } = {},
): DatasetColumn {
  return { name, type, meaning, ...extra };
}

export const DATASETS: readonly Dataset[] = [
  {
    id: 'crm.contacts',
    module: 'crm',
    meaning: 'CRM contacts (customers and leads) of the organization.',
    from: 'crm_contacts t',
    orgColumn: 't.org_id',
    ownerColumn: 't.owner_id',
    defaultOrder: 'created_at desc',
    defaultColumns: ['display_name', 'source', 'created_at'],
    columns: [
      col('display_name', 'text', 'Contact name as shown in the UI'),
      col('source', 'text', 'How the contact arrived (channel, import, manual)'),
      col('human_id', 'text', 'Short human-readable contact code'),
      col('created_at', 'timestamp', 'When the contact was created'),
      col('party_id', 'uuid', 'Linked party (shared identity) id'),
      col('owner_id', 'uuid', 'Profile id of the assigned owner'),
    ],
  },
  {
    id: 'pos.tickets',
    module: 'pos',
    meaning: 'Point-of-sale tickets (sales); one row per ticket.',
    from: 'pos_tickets t',
    orgColumn: 't.org_id',
    defaultOrder: 'submitted_at desc',
    defaultColumns: ['human_id', 'status', 'total', 'submitted_at'],
    columns: [
      col('human_id', 'text', 'Ticket number shown to staff'),
      col('customer_name', 'text', 'Customer name typed at the till', { pii: true }),
      col('status', 'text', "Ticket state: 'submitted' or 'void'"),
      col('subtotal', 'number', 'Sum of line totals before ticket discount'),
      col('discount', 'number', 'Ticket-level discount amount'),
      col('total', 'number', 'Amount charged'),
      col('currency', 'text', 'ISO currency code'),
      col('submitted_at', 'timestamp', 'When the sale was recorded'),
      col('voided_at', 'timestamp', 'When the ticket was voided (null if live)'),
      col('shift_id', 'uuid', 'Till shift the ticket belongs to'),
      col('crm_contact_id', 'uuid', 'Linked CRM contact id'),
    ],
  },
  {
    id: 'pos.ticket_lines',
    module: 'pos',
    meaning:
      'Point-of-sale ticket lines (one row per item sold), joined to its ticket and catalog product.',
    from: [
      'pos_ticket_lines t',
      'join pos_tickets tk on tk.id = t.ticket_id and tk.org_id = t.org_id',
      'left join fin_products p on p.id = t.fin_product_id and p.org_id = t.org_id',
    ].join(' '),
    orgColumn: 't.org_id',
    defaultOrder: 'submitted_at desc',
    defaultColumns: ['product_name', 'qty', 'unit_price', 'total', 'submitted_at'],
    columns: [
      col('ticket_id', 'uuid', 'Parent ticket id'),
      col('kind', 'text', "'service' or 'product'"),
      col('description', 'text', 'Line description as printed'),
      col('qty', 'number', 'Quantity sold'),
      col('unit_price', 'number', 'Price per unit charged'),
      col('discount', 'number', 'Line discount amount'),
      col('total', 'number', 'Line revenue (qty * unit_price - discount)'),
      col('fin_product_id', 'uuid', 'Catalog product id'),
      col('product_name', 'text', 'Catalog product name', { expr: 'p.name' }),
      col('submitted_at', 'timestamp', 'When the parent ticket was sold', {
        expr: 'tk.submitted_at',
      }),
      col('ticket_status', 'text', "Parent ticket state ('submitted' / 'void')", {
        expr: 'tk.status',
      }),
    ],
  },
  {
    id: 'pos.payments',
    module: 'pos',
    meaning: 'Payments tendered against point-of-sale tickets.',
    from: 'pos_payments t',
    orgColumn: 't.org_id',
    defaultOrder: 'paid_at desc',
    defaultColumns: ['method', 'amount', 'paid_at'],
    columns: [
      col('ticket_id', 'uuid', 'Ticket the payment settles'),
      col('shift_id', 'uuid', 'Till shift the payment belongs to'),
      col('method', 'text', 'Tender method (cash, card, transfer, credit, …)'),
      col('amount', 'number', 'Amount tendered'),
      col('paid_at', 'timestamp', 'When the payment was taken'),
    ],
  },
  {
    id: 'finance.invoices',
    module: 'finance',
    meaning: 'Issued sales invoices / receipts.',
    from: 'fin_invoices t',
    orgColumn: 't.org_id',
    defaultOrder: 'issued_at desc',
    defaultColumns: ['number', 'issued_at', 'total', 'status'],
    columns: [
      col('number', 'text', 'Invoice series + number'),
      col('issued_at', 'timestamp', 'Issue date'),
      col('client_name', 'text', 'Billed client name', { pii: true }),
      col('client_email', 'text', 'Billed client email', { pii: true }),
      col('currency', 'text', 'ISO currency code'),
      col('subtotal', 'number', 'Net amount before tax'),
      col('tax', 'number', 'Tax amount'),
      col('total', 'number', 'Gross amount'),
      col('status', 'text', 'Invoice state'),
    ],
  },
  {
    id: 'finance.products',
    module: 'finance',
    meaning: 'Catalog of sellable products, services and packages.',
    from: 'fin_products t',
    orgColumn: 't.org_id',
    defaultOrder: 'name asc',
    defaultColumns: ['code', 'name', 'category', 'unit_price'],
    columns: [
      col('code', 'text', 'Business key / SKU'),
      col('name', 'text', 'Product name'),
      col('category', 'text', 'Catalog category'),
      col('unit_price', 'number', 'List price per unit'),
      col('active', 'boolean', 'Whether it is still sellable'),
      col('kind', 'text', "'service', 'product' or 'package'"),
    ],
  },
  {
    id: 'scheduling.bookings',
    module: 'scheduling',
    meaning: 'Calendar bookings (appointments).',
    from: 'sched_bookings t',
    orgColumn: 't.org_id',
    defaultOrder: 'start_time desc',
    defaultColumns: ['title', 'start_time', 'end_time', 'status'],
    columns: [
      col('start_time', 'timestamp', 'Appointment start'),
      col('end_time', 'timestamp', 'Appointment end'),
      col('status', 'text', 'Booking state'),
      col('title', 'text', 'Booking title'),
      col('attendee_name', 'text', 'Attendee name', { pii: true }),
      col('crm_contact_id', 'uuid', 'Linked CRM contact id'),
      col('product_id', 'uuid', 'Booked catalog product id'),
    ],
  },
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
];

const BY_ID = new Map(DATASETS.map((d) => [d.id, d]));

export function findDataset(id: unknown): Dataset | undefined {
  return typeof id === 'string' ? BY_ID.get(id) : undefined;
}

export function findColumn(dataset: Dataset, name: unknown): DatasetColumn | undefined {
  return typeof name === 'string' ? dataset.columns.find((c) => c.name === name) : undefined;
}

/** SQL expression for a registry column — never derived from caller input. */
export function columnExpr(column: DatasetColumn): string {
  return column.expr ?? `t.${column.name}`;
}

/** The catalog shape returned by `GET /api/sandbox/datasets` (contract §2). */
export function datasetCatalogEntry(dataset: Dataset) {
  return {
    id: dataset.id,
    module: dataset.module,
    meaning: dataset.meaning,
    defaultOrder: dataset.defaultOrder,
    defaultColumns: dataset.defaultColumns,
    columns: dataset.columns.map((c) => ({
      name: c.name,
      type: c.type,
      ...(c.meaning ? { meaning: c.meaning } : {}),
      ...(c.pii ? { pii: true } : {}),
    })),
  };
}
