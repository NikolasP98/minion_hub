import type { CanonicalInvoice, CanonicalLineItem, CanonicalPayment, CanonicalClient } from '../connector';

const PROVIDER = 'susii';
const str = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
// SUSII sends an all-same-digit sentinel (e.g. "00000000") when a client has no
// real document. That is NOT a DNI — normalise it to null so it never collapses
// distinct docless clients nor displays as a fake ID. ponytail: all-same-DIGIT
// only; leave short/alphanumeric docs (foreign IDs, passports) untouched.
const docNumber = (v: unknown): string | null => {
  const s = str(v);
  return s != null && /^(\d)\1*$/.test(s) ? null : s;
};

function mapClient(raw: unknown): CanonicalClient | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  return {
    provider: PROVIDER,
    providerRef: String(c.id ?? ''),
    name: str(c.name),
    docType: str(c.document_type),
    docNumber: docNumber(c.document_number),
    email: str(c.email),
    phone: str(c.phone),
    metadata: c,
  };
}
function mapItem(raw: Record<string, unknown>): CanonicalLineItem {
  return {
    code: str(raw.code),
    description: str(raw.name),
    category: str(raw.category),
    quantity: num(raw.quantity),
    unitPrice: num(raw.price),
    discount: num(raw.discount),
    tax: num(raw.tax),
    total: num(raw.total) ?? (num(raw.price) != null && num(raw.quantity) != null ? Number(raw.price) * Number(raw.quantity) : null),
    metadata: raw,
  };
}
function mapPayment(raw: Record<string, unknown>): CanonicalPayment {
  return {
    providerRef: str(raw.id),
    method: str(raw.method),
    paidAt: str(raw.date),
    amount: num(raw.amount),
    status: raw.is_paid === true ? 'paid' : raw.is_paid === false ? 'pending' : null,
    metadata: raw,
  };
}

/** Map a SUSII `/v1/sales/sales/` result into the canonical invoice shape. */
export function mapSusiiSale(sale: Record<string, unknown>): CanonicalInvoice {
  const client = mapClient(sale.client);
  const status = sale.is_active === false ? 'void' : sale.is_paid === true ? 'paid' : 'pending';
  // CORE fields are lifted out; the WHOLE raw sale is kept in metadata minus the
  // big nested arrays (those become first-class items/payments).
  const { items: _i, payments: _p, document_set: _d, client: _c, ...rest } = sale;
  return {
    provider: PROVIDER,
    providerRef: String(sale.id ?? ''),
    number: str(sale.number),
    documentId: str((arr(sale.document_set)[0] ?? {}).serial) ?? str(sale.number),
    issuedAt: str(sale.date),
    clientName: client?.name ?? str(sale.client_name),
    clientDocType: client?.docType ?? null,
    clientDocNumber: client?.docNumber ?? null,
    clientEmail: client?.email ?? null,
    currency: str(sale.currency_code),
    subtotal: num(sale.subtotal),
    tax: num(sale.tax),
    discount: num(sale.discount),
    total: num(sale.total) ?? num((arr(sale.document_set)[0] ?? {}).total),
    status,
    seller: str(sale.user),
    note: str(sale.observations),
    metadata: { ...rest, document_set: arr(sale.document_set) },
    items: arr(sale.items).map(mapItem),
    payments: arr(sale.payments).map(mapPayment),
    client,
  };
}
