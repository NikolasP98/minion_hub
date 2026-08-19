/**
 * SUNAT beta emission — shared shapes. Totals/IGV are always DERIVED (from
 * `igvRate` and tax-inclusive line prices) — never accept them as input,
 * that's how a caller ends up submitting an invoice whose lines don't sum to
 * its own totals.
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
  /** IGV rate as a FRACTION (e.g. eighteen percent is expressed as a
   *  fraction, never as a whole-number percent) — normalized once at the
   *  settings boundary by `resolveIgvRate` (finance/tax.ts, added in S2 of
   *  2026-08-17-hub-igv-rate-from-org-config-spec), never inside this library. */
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
