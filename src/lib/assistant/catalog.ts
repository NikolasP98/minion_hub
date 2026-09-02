/**
 * Static catalog of assistant-fillable forms. Each page that mounts one of
 * these calls `registerForm({ def, get, set })` with the SAME def, so the
 * model's plan (from this catalog) and the live tool (from the mount) agree.
 *
 * `guide` targets are `data-assist` keys the page puts on its controls
 * (`<form_id>.<field_key>` by convention, plus page-level anchors).
 */
import type { FormDef } from './forms';

export const STOCK_ENTRY_FORM: FormDef = {
  id: 'stock_entry',
  title: 'New stock entry',
  description:
    'records stock movement: receipt = purchase/goods in, issue = goods out/consumption, transfer = between warehouses, adjustment = correction',
  route: '/stock/entries/new',
  open: { type: 'receipt' },
  fields: [
    {
      key: 'type',
      label: 'Entry type',
      type: 'select',
      required: true,
      options: [
        { value: 'receipt', label: 'Receipt (goods in / purchase)' },
        { value: 'issue', label: 'Issue (goods out)' },
        { value: 'transfer', label: 'Transfer between warehouses' },
        { value: 'adjustment', label: 'Adjustment' },
      ],
    },
    {
      key: 'party',
      label: 'Supplier / party',
      type: 'entity',
      entity: 'supplier or customer name',
      description: 'Who the goods come from or go to (optional).',
    },
    {
      key: 'item',
      label: 'Item',
      type: 'entity',
      required: true,
      entity: 'stock item name or code',
      description: 'The product being moved.',
    },
    {
      key: 'qty',
      label: 'Quantity',
      type: 'number',
      required: true,
      description: "Units in the item's stock unit of measure (boxes, units…).",
    },
    {
      key: 'rate',
      label: 'Unit cost',
      type: 'number',
      description: 'Cost per unit; required for receipts (used for inventory valuation).',
    },
    {
      key: 'warehouse',
      label: 'Warehouse',
      type: 'entity',
      entity: 'warehouse name',
      description:
        'Destination for receipts, source for issues. Defaults to the default warehouse.',
    },
    { key: 'note', label: 'Note', type: 'textarea' },
  ],
  guide: [
    {
      target: 'stock_entry.type',
      message: 'Pick the movement type. A purchase you just received is a Receipt.',
    },
    {
      target: 'stock_entry.party',
      message: 'Optionally pick the supplier so the purchase is traceable.',
    },
    {
      target: 'stock_entry.item',
      message: 'Add the item you received. You can add several lines.',
    },
    { target: 'stock_entry.qty', message: 'Enter how many units arrived.' },
    { target: 'stock_entry.rate', message: 'Enter the unit cost so inventory value stays right.' },
    {
      target: 'stock_entry.submit',
      message: 'Submit posts the entry to stock. Save draft keeps it editable.',
    },
  ],
};

export const STOCK_ITEM_FORM: FormDef = {
  id: 'stock_item',
  title: 'New stock item',
  description: 'creates an item in the stock master so it can be received, issued and counted',
  route: '/stock/items',
  open: { new: '1' },
  fields: [
    {
      key: 'code',
      label: 'Code',
      type: 'text',
      required: true,
      description: 'Short unique identifier (SKU).',
    },
    { key: 'name', label: 'Name', type: 'text', required: true },
    {
      key: 'uom',
      label: 'Unit of measure',
      type: 'text',
      required: true,
      description: 'How stock is counted: unit, box, ml, vial…',
    },
    {
      key: 'itemGroup',
      label: 'Group',
      type: 'text',
      description: 'Category for reporting (optional).',
    },
  ],
  guide: [
    { target: 'stock_item.code', message: 'Give the item a short unique code.' },
    { target: 'stock_item.name', message: 'The name staff will search for.' },
    { target: 'stock_item.uom', message: 'The unit you count stock in.' },
    { target: 'stock_item.submit', message: 'Create saves the item and opens its detail page.' },
  ],
};

export const WAREHOUSE_FORM: FormDef = {
  id: 'warehouse',
  title: 'New warehouse',
  description: 'creates a storage location (or a sub-location) for stock',
  route: '/stock/warehouses',
  open: { new: '1' },
  fields: [{ key: 'name', label: 'Warehouse name', type: 'text', required: true }],
  guide: [
    {
      target: 'warehouse.name',
      message: 'Name the location, e.g. "Main store" or "Room 2 cabinet".',
    },
    { target: 'warehouse.submit', message: 'Create adds it to the tree.' },
  ],
};

export const SELLABLE_FORM: FormDef = {
  id: 'sellable',
  title: 'New catalog item',
  description:
    'creates a product or service that can be sold at the POS (bundles are composed later from the catalog)',
  route: '/pos/catalog/new',
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    {
      key: 'code',
      label: 'Code',
      type: 'text',
      description: 'Auto-suggested from the name; letters, digits and dashes.',
    },
    { key: 'category', label: 'Category', type: 'text' },
    {
      key: 'unitPrice',
      label: 'Price',
      type: 'number',
      description: 'Selling price per unit, tax included.',
    },
    {
      key: 'source',
      label: 'Kind',
      type: 'select',
      required: true,
      options: [
        { value: 'service', label: 'Service (no stock)' },
        { value: 'new-item', label: 'Product — create a new stock item' },
        { value: 'existing-item', label: 'Product — link an existing stock item' },
      ],
      description: 'Services consume no stock; products track stock.',
    },
    {
      key: 'existingItem',
      label: 'Existing stock item',
      type: 'entity',
      entity: 'stock item name or code',
      description: 'Only for source=existing-item.',
    },
  ],
  guide: [
    { target: 'sellable.name', message: 'Name as it should appear on the ticket.' },
    { target: 'sellable.unitPrice', message: 'Selling price.' },
    { target: 'sellable.source', message: 'Service, or a product that tracks stock.' },
    { target: 'sellable.submit', message: 'Save adds it to the catalog and the POS.' },
  ],
};

export const PARTY_FORM: FormDef = {
  id: 'party',
  title: 'New customer / supplier',
  description:
    'creates a person or company (used by POS, stock and finance pickers); deduplicates by document number or phone',
  route: '/crm/customers',
  open: { new: '1' },
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    {
      key: 'type',
      label: 'Type',
      type: 'select',
      required: true,
      options: [
        { value: 'person', label: 'Person' },
        { value: 'company', label: 'Company' },
      ],
    },
    { key: 'phone', label: 'Phone', type: 'text' },
    { key: 'email', label: 'Email', type: 'text' },
    {
      key: 'docNumber',
      label: 'Document number',
      type: 'text',
      description: 'DNI for a person, RUC for a company.',
    },
  ],
  guide: [
    { target: 'party.name', message: 'Full name or company name.' },
    { target: 'party.type', message: 'Person (DNI) or company (RUC).' },
    { target: 'party.phone', message: 'Phone lets WhatsApp conversations link to this customer.' },
    {
      target: 'party.submit',
      message: 'Create saves — existing document/phone matches are reused, not duplicated.',
    },
  ],
};

export const BOOKING_FORM: FormDef = {
  id: 'booking',
  title: 'New appointment',
  description: 'books a service for a client at a free slot',
  route: '/scheduling/bookings',
  open: { new: '1' },
  fields: [
    {
      key: 'service',
      label: 'Service',
      type: 'entity',
      required: true,
      entity: 'event type / service name',
    },
    { key: 'date', label: 'Date', type: 'date', required: true },
    {
      key: 'time',
      label: 'Time',
      type: 'text',
      required: true,
      description: 'HH:MM, must be a free slot for that date.',
    },
    {
      key: 'client',
      label: 'Client',
      type: 'entity',
      entity: 'existing client name or phone',
      description: 'Links the booking to the CRM contact.',
    },
    { key: 'name', label: 'Attendee name', type: 'text', required: true },
    { key: 'phone', label: 'Phone', type: 'text' },
  ],
  guide: [
    {
      target: 'booking.service',
      message: 'Choose the service; it sets the duration and the free slots.',
    },
    { target: 'booking.date', message: 'Pick the day.' },
    { target: 'booking.time', message: 'Pick a free slot.' },
    { target: 'booking.client', message: 'Search an existing client, or type a name below.' },
    { target: 'booking.submit', message: 'Confirm books the slot.' },
  ],
};

export const PURCHASE_FORM: FormDef = {
  id: 'purchase',
  title: 'Register purchase invoice',
  description: 'records a supplier invoice (factura de compra) in the open finance period',
  route: '/finances/purchases',
  open: { new: '1' },
  fields: [
    {
      key: 'supplierRuc',
      label: 'Supplier RUC',
      type: 'text',
      description: '11-digit tax id of the supplier.',
    },
    { key: 'supplierName', label: 'Supplier name', type: 'text', required: true },
    {
      key: 'docType',
      label: 'Document type',
      type: 'text',
      description: '01 = factura, 03 = boleta.',
    },
    { key: 'serie', label: 'Serie', type: 'text', description: 'e.g. F001' },
    { key: 'numero', label: 'Number', type: 'text' },
    { key: 'issuedAt', label: 'Issue date', type: 'date' },
    {
      key: 'baseGravada',
      label: 'Taxable base',
      type: 'number',
      description: 'Amount before IGV.',
    },
    { key: 'igv', label: 'IGV', type: 'number', description: 'Tax amount (18% of the base).' },
    { key: 'total', label: 'Total', type: 'number' },
  ],
  guide: [
    {
      target: 'purchase.supplierRuc',
      message: 'Type the supplier RUC and name as printed on the invoice.',
    },
    { target: 'purchase.serie', message: 'Serie and number as printed on the invoice.' },
    { target: 'purchase.total', message: 'Base, IGV and total as printed.' },
    { target: 'purchase.submit', message: 'Save registers it in the current period.' },
  ],
};

export const POS_SALE_FORM: FormDef = {
  id: 'pos_sale',
  title: 'Point of sale — current sale',
  description:
    'sets the customer and adds catalog items to the cart of the sale being rung up; the cashier reviews, takes payment and charges',
  route: '/pos/sell',
  fields: [
    {
      key: 'customer',
      label: 'Customer',
      type: 'entity',
      entity: 'customer name, phone or document number',
      description: 'Who the sale is for (optional unless POS settings require a customer).',
    },
    {
      key: 'item',
      label: 'Catalog item',
      type: 'entity',
      entity: 'product or service name/code',
      description: 'Adds one line to the cart.',
    },
    {
      key: 'qty',
      label: 'Quantity',
      type: 'number',
      description: 'Quantity for the item being added (default 1).',
    },
  ],
  guide: [
    { target: 'pos_sale.item', message: 'Search or tap a catalog item to add it to the cart.' },
    {
      target: 'pos_sale.customer',
      message: 'Pick the customer (required when the setting is on).',
    },
    { target: 'pos_sale.payment', message: 'Choose the payment method and amount.' },
    { target: 'pos_sale.submit', message: 'Charge closes the sale and emits the receipt.' },
  ],
};

export const FORM_CATALOG: FormDef[] = [
  STOCK_ENTRY_FORM,
  STOCK_ITEM_FORM,
  WAREHOUSE_FORM,
  SELLABLE_FORM,
  PARTY_FORM,
  BOOKING_FORM,
  PURCHASE_FORM,
  POS_SALE_FORM,
];
