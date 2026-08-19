/**
 * SUSII `business_payment_method` id → display name.
 *
 * SUSII's API exposes NO catalog endpoint for these ids (probed 2026-08-13:
 * the /v1/sales/ router has none, and /v1/businesses/businesses/ returns 403
 * for our accountant-role sync token). Names were derived empirically by
 * joining 1,517 hub payments against the owner's SUSII "MetodoPago" report
 * exports on (invoice number, exact amount) — zero contradictions.
 *
 * Unknown ids resolve to null (method stays empty, exactly the pre-map
 * behavior). When a new id appears in synced payments, add one line here.
 */
export const SUSII_METHOD_NAMES: Record<number, string> = {
  15940: 'Efectivo',
  15941: 'Tarjeta de Crédito',
  15942: 'Tarjeta de Débito',
  15943: 'Transferencia Bancaria',
  23116: 'YAPE',
  23117: 'PLIN',
  23119: 'Transferencia Bancaria (Faces)',
  24581: 'Mercado Pago',
  24582: 'Power Pay',
  25301: 'PLIN-FACES-CONSULTA',
};
