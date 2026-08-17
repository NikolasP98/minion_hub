/**
 * SUNAT beta emission — shared shapes. Totals/IGV are always DERIVED from the
 * tax-inclusive line prices and the document's own `igvRate` — never accept
 * totals as input, that's how a caller ends up submitting an invoice whose
 * lines don't sum to its own totals. The RATE, by contrast, MUST be passed in:
 * it is per-org configuration (`fin_settings.tax_rate`), not a constant.
 */

/** '01' = factura, '03' = boleta (SUNAT InvoiceTypeCode, listID 0101). */
export type EmissionDocType = '01' | '03';

/** '1' = DNI, '6' = RUC (SUNAT PartyIdentification schemeID / catalog 06). */
export type ClientDocType = '1' | '6';

export interface EmissionLine {
  description: string;
  quantity: number;
  /** Unit price INCLUDING IGV (FACES prices are always tax-inclusive). */
  unitPriceInclTax: number;
}

export interface EmissionInvoice {
  docType: EmissionDocType;
  /** 4-char SUNAT series, e.g. "BE01" or "F999". */
  serie: string;
  correlativo: string;
  /** YYYY-MM-DD. */
  issueDate: string;
  currency: 'PEN';
  /**
   * IGV rate this document declares and derives its totals with, as a FRACTION
   * in (0, 1) — an 18% rate is `18 / 100`, never `18`. Required on purpose — no default, no
   * fallback, no module-level constant: a document that does not state its rate
   * is how every org silently got 18%. Resolve it exactly once, outside this
   * library, via `resolveIgvRate()` in `src/server/finance/tax.ts` (that is
   * also the only place a unit conversion or a fallback may live).
   */
  igvRate: number;
  emitter: {
    ruc: string;
    razonSocial: string;
    /** 6-digit SUNAT ubigeo. Omit only for quick beta smoke tests. */
    ubigeo?: string;
    address?: string;
  };
  client: {
    docType: ClientDocType;
    docNumber: string;
    name: string;
  };
  lines: EmissionLine[];
}

/** Parsed SUNAT CDR (Constancia de Recepción). `responseCode === '0'` = accepted. */
export interface CdrResult {
  responseCode: string;
  description: string;
  notes: string[];
}
