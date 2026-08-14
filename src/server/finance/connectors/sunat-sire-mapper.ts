import type { CanonicalInvoice, CanonicalClient } from '../connector';

const PROVIDER = 'sunat-sire';
const str = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** SUNAT doc-identity catalog (tabla 2) — only the types that actually appear in retail. */
const DOC_TYPES: Record<string, string> = { '1': 'DNI', '4': 'CE', '6': 'RUC', '7': 'PASAPORTE' };

/** SIRE placeholder for "no client name" is a literal dash. */
const name = (v: unknown): string | null => {
  const s = str(v)?.trim();
  return s && s !== '-' ? s : null;
};

/** fecEmision arrives dd/mm/yyyy; canonical wants ISO. */
const isoDate = (v: unknown): string | null => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str(v) ?? '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

function mapClient(r: Record<string, unknown>): CanonicalClient | null {
  const docNumber = str(r.numDocIdentidad);
  // No identity → no client row; the invoice keeps its own denormalised fields.
  if (!docNumber || /^(\d)\1*$/.test(docNumber)) return null;
  const docTypeCode = str(r.codTipoDocIdentidad) ?? '';
  return {
    provider: PROVIDER,
    providerRef: `${docTypeCode}:${docNumber}`,
    name: name(r.nomRazonSocialCliente),
    docType: DOC_TYPES[docTypeCode] ?? (docTypeCode || null),
    docNumber,
    email: null,
    phone: null,
    metadata: {},
  };
}

/**
 * Map one RVIE propuesta `registros[]` row into the canonical invoice shape.
 *
 * SIRE is SUNAT's own ledger of emitted CPEs — it has document-level amounts
 * only (no line items, no payments), so `items`/`payments` are always empty and
 * `status` reflects document validity, never collection state.
 */
export function mapSireRegistro(r: Record<string, unknown>): CanonicalInvoice {
  const client = mapClient(r);
  const serie = str(r.numSerieCDP);
  const numero = str(r.numCDP);
  const documentId = serie && numero ? `${serie}-${numero}` : null;
  const estado = (str(r.desEstadoComprobante) ?? '').toLowerCase();
  return {
    provider: PROVIDER,
    // codCar is SUNAT's own unique carga key (RUC+tipo+serie+numero) — stable across pulls.
    providerRef: str(r.codCar) ?? `${str(r.codTipoCDP)}-${documentId}`,
    number: documentId,
    documentId,
    issuedAt: isoDate(r.fecEmision),
    clientName: client?.name ?? null,
    clientDocType: client?.docType ?? null,
    clientDocNumber: client?.docNumber ?? null,
    clientEmail: null,
    currency: str(r.codMoneda) ?? 'PEN',
    subtotal: num(r.mtoBIGravada),
    tax: num(r.mtoIGV),
    discount: num(r.mtoDsctoBI),
    total: num(r.mtoTotalCP),
    status: /anulad|baja/.test(estado) ? 'void' : null,
    seller: null,
    note: null,
    metadata: r,
    items: [],
    payments: [],
    client,
  };
}
