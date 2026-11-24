import type { EmissionInvoice, EmissionLine } from './types';
import { EXTENSION_PLACEHOLDER_XML, escapeXml, signatureBlockXml } from './ubl-common';

/** Round half-up — Math.round already does this for positive amounts, but the
 * intent (banker's rounding is NOT what SUNAT wants) is worth spelling out. */
function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * f) / f;
}

interface LineTotals {
  line: EmissionLine;
  /** Line total WITH IGV, round2 — the authoritative source amount. */
  totalInclTax: number;
  /** Line total WITHOUT IGV, derived from totalInclTax so exclTax + igv === inclTax exactly. */
  totalExclTax: number;
  igv: number;
  /** Reference unit price without IGV, 6dp (informational — LineExtensionAmount is authoritative). */
  unitPriceExclTax: number;
  /**
   * A zero-total line: an operación gratuita, NOT a gravada line worth
   * nothing. SUNAT rejects the latter with fault 3105 ("al menos un tributo
   * por linea de afectacion por IGV") — a line declaring afectación 10 has to
   * carry a non-zero taxable base.
   */
  gratuita: boolean;
  /** `valor de venta` of the gratuita (qty x reference unit price, IGV-excluded), 0 for paid lines. */
  gratuitaBase: number;
  /** Reference unit price WITHOUT IGV, 6dp — catálogo 16 code 02 `valor referencial unitario`. */
  gratuitaUnitPriceExclTax: number;
}

export interface InvoiceTotals {
  lines: LineTotals[];
  /** Total valor de venta of the ONEROUS lines only (guía numeral 23). */
  lineExtensionAmount: number;
  /** Sumatoria IGV — excludes gratuitas IGV by construction (guía numeral 27). */
  igvAmount: number;
  taxInclusiveAmount: number;
  payableAmount: number;
  /** Total valor de venta - operaciones gratuitas (guía numeral 26). */
  gratuitaAmount: number;
  /** True only when EVERY line is gratuita — the condition for legend 1002. */
  allGratuita: boolean;
}

/**
 * Derive per-line and document totals from tax-inclusive unit prices.
 * Every line's exclTax/igv split is computed FROM its own rounded inclTax
 * total, so document totals (plain sums of line totals) are consistent with
 * the lines by construction — no independent rounding path that could drift.
 *
 * Gratuitas (zero-total lines) are kept OUT of every onerous total; since
 * their inclTax/exclTax/igv are all zero, excluding them is numerically
 * identical to summing them — the split exists so the XML can declare them
 * under their own tributo, not to change any amount.
 */
export function computeTotals(inv: EmissionInvoice): InvoiceTotals {
  const lines = inv.lines.map((line): LineTotals => {
    const totalInclTax = round(line.quantity * line.unitPriceInclTax, 2);
    const totalExclTax = round(totalInclTax / (1 + inv.igvRate), 2);
    const igv = round(totalInclTax - totalExclTax, 2);
    const unitPriceExclTax = line.quantity > 0 ? round(totalExclTax / line.quantity, 6) : 0;
    const gratuita = totalInclTax === 0;
    // TODO(handoff): a ZERO reference value may still be rejected. When the
    // catalog price is 0 and no list price exists, this falls back to 0.00,
    // but guía numeral 39 says "en su defecto se aplicará el valor de
    // mercado". The next shadow emission carrying such a line is the test; if
    // SUNAT refuses it, the item needs a non-zero catalog/market price (data
    // fix). See the PR's open ends.
    const refInclTax = line.referenceUnitPriceInclTax ?? line.unitPriceInclTax;
    const gratuitaBase = gratuita
      ? round(round(line.quantity * refInclTax, 2) / (1 + inv.igvRate), 2)
      : 0;
    return {
      line,
      totalInclTax,
      totalExclTax,
      igv,
      unitPriceExclTax,
      gratuita,
      gratuitaBase,
      gratuitaUnitPriceExclTax:
        gratuita && line.quantity > 0 ? round(gratuitaBase / line.quantity, 6) : 0,
    };
  });
  const onerous = lines.filter((l) => !l.gratuita);
  const lineExtensionAmount = round(
    onerous.reduce((s, l) => s + l.totalExclTax, 0),
    2,
  );
  const igvAmount = round(
    onerous.reduce((s, l) => s + l.igv, 0),
    2,
  );
  const taxInclusiveAmount = round(
    onerous.reduce((s, l) => s + l.totalInclTax, 0),
    2,
  );
  return {
    lines,
    lineExtensionAmount,
    igvAmount,
    taxInclusiveAmount,
    payableAmount: taxInclusiveAmount,
    gratuitaAmount: round(
      lines.reduce((s, l) => s + l.gratuitaBase, 0),
      2,
    ),
    allGratuita: lines.length > 0 && onerous.length === 0,
  };
}

const UNITS = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
const TEENS = [
  'DIEZ',
  'ONCE',
  'DOCE',
  'TRECE',
  'CATORCE',
  'QUINCE',
  'DIECISEIS',
  'DIECISIETE',
  'DIECIOCHO',
  'DIECINUEVE',
];
const TWENTIES = [
  'VEINTE',
  'VEINTIUNO',
  'VEINTIDOS',
  'VEINTITRES',
  'VEINTICUATRO',
  'VEINTICINCO',
  'VEINTISEIS',
  'VEINTISIETE',
  'VEINTIOCHO',
  'VEINTINUEVE',
];
const TENS = [
  '',
  '',
  '',
  'TREINTA',
  'CUARENTA',
  'CINCUENTA',
  'SESENTA',
  'SETENTA',
  'OCHENTA',
  'NOVENTA',
];
const HUNDREDS = [
  '',
  'CIENTO',
  'DOSCIENTOS',
  'TRESCIENTOS',
  'CUATROCIENTOS',
  'QUINIENTOS',
  'SEISCIENTOS',
  'SETECIENTOS',
  'OCHOCIENTOS',
  'NOVECIENTOS',
];

function twoDigits(n: number): string {
  if (n < 10) return UNITS[n];
  if (n < 20) return TEENS[n - 10];
  if (n < 30) return TWENTIES[n - 20];
  const t = Math.floor(n / 10);
  const u = n % 10;
  return u > 0 ? `${TENS[t]} Y ${UNITS[u]}` : TENS[t];
}

function threeDigits(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h > 0) parts.push(HUNDREDS[h]);
  if (r > 0) parts.push(twoDigits(r));
  return parts.join(' ');
}

/** Spanish (Peru) integer-to-words. Caps at 999,999,999 — FACES invoices never
 * get near that, and SUNAT doesn't machine-validate this legend's wording. */
function integerToWords(n: number): string {
  if (n === 0) return 'CERO';
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const parts: string[] = [];
  if (millones > 0) parts.push(millones === 1 ? 'UN MILLON' : `${threeDigits(millones)} MILLONES`);
  if (miles > 0) parts.push(miles === 1 ? 'MIL' : `${threeDigits(miles)} MIL`);
  if (resto > 0 || parts.length === 0) parts.push(threeDigits(resto));
  return parts.join(' ');
}

/** SUNAT legend 1000: "SON <monto en letras> CON NN/100 SOLES". */
export function amountInWords(amount: number): string {
  const intPart = Math.floor(amount);
  const cents = Math.round((amount - intPart) * 100);
  return `SON ${integerToWords(intPart)} CON ${String(cents).padStart(2, '0')}/100 SOLES`;
}

function supplierAddress(inv: EmissionInvoice): string {
  if (!inv.emitter.ubigeo)
    return '<cac:Country><cbc:IdentificationCode>PE</cbc:IdentificationCode></cac:Country>';
  const line = inv.emitter.address
    ? `<cac:AddressLine><cbc:Line>${escapeXml(inv.emitter.address)}</cbc:Line></cac:AddressLine>`
    : '';
  return (
    `<cbc:ID>${escapeXml(inv.emitter.ubigeo)}</cbc:ID>` +
    '<cbc:AddressTypeCode>0000</cbc:AddressTypeCode>' +
    `${line}` +
    '<cac:Country><cbc:IdentificationCode>PE</cbc:IdentificationCode></cac:Country>'
  );
}

/** `rate * 100`, at most 2 decimals, trailing zeros dropped (a fractional
 *  rate of eighteen percent becomes "18", not "18.00") — the declared
 *  `cbc:Percent` and `computeTotals`'s divisor MUST come from the same
 *  `igvRate`, this is the only formatter. */
function formatPercent(rate: number): string {
  return String(round(rate * 100, 2));
}

/**
 * Afectación IGV (catálogo 07) + tributo (catálogo 05) for a zero-value line.
 *
 * `31` "Inafecto - Retiro por bonificación" with tributo `9998` is the shape
 * of SUNAT's OWN worked example of a free line inside an otherwise onerous
 * invoice (guía factura UBL 2.1, "Factura con bonificación" CASO 1, pp. 77-85:
 * afectación 31, tributo 9998/INAFECTO/FRE, line amounts all zero, the
 * reference value carried by PricingReference code 02 and by the document's
 * gratuitas TaxSubtotal). FACES's zero-value lines are exactly that — an item
 * given at no charge alongside a paid procedure.
 *
 * Deliberately NOT the gravado-gratuito family (11-17, tributo 9996/GRA):
 * those declare the free transfer as a TAXABLE retiro, i.e. IGV the emitter
 * owes. Whether a FACES bonificación is a taxable retiro is an accounting
 * determination, and emission software must not make it unilaterally — see
 * the PR's open ends.
 */
// TODO(handoff): 31 (inafecto) vs 15 (Gravado - Bonificaciones) is an
// ACCOUNTING decision — the clinic's accountant must confirm it before the
// production cutover. Switching to 15 also means tributo 9996/GRA and
// carrying the IGV on the reference value in both the line and the document
// gratuitas TaxAmount (today both are 0.00).
const GRATUITA_AFECTACION = '31';
const GRATUITA_TRIBUTO_ID = '9998';
const GRATUITA_TRIBUTO_NAME = 'INAFECTO';
const GRATUITA_TRIBUTO_TYPE = 'FRE';

/**
 * A gratuita line: `LineExtensionAmount`, the line TaxTotal and `cac:Price`
 * are all zero and the value that WOULD have been charged lives in
 * `PricingReference` under catálogo 16 code `02` ("valor referencial unitario
 * en operaciones no onerosas", guía numeral 39). The document-level gratuitas
 * TaxSubtotal (numeral 26) carries the sum of those reference values.
 */
function gratuitaLineXml(id: number, l: LineTotals, percent: string): string {
  return `<cac:InvoiceLine>
<cbc:ID>${id}</cbc:ID>
<cbc:InvoicedQuantity unitCode="NIU">${l.line.quantity}</cbc:InvoicedQuantity>
<cbc:LineExtensionAmount currencyID="PEN">0.00</cbc:LineExtensionAmount>
<cac:PricingReference>
<cac:AlternativeConditionPrice>
<cbc:PriceAmount currencyID="PEN">${l.gratuitaUnitPriceExclTax.toFixed(6)}</cbc:PriceAmount>
<cbc:PriceTypeCode>02</cbc:PriceTypeCode>
</cac:AlternativeConditionPrice>
</cac:PricingReference>
<cac:TaxTotal>
<cbc:TaxAmount currencyID="PEN">0.00</cbc:TaxAmount>
<cac:TaxSubtotal>
<cbc:TaxableAmount currencyID="PEN">0.00</cbc:TaxableAmount>
<cbc:TaxAmount currencyID="PEN">0.00</cbc:TaxAmount>
<cac:TaxCategory>
<cbc:Percent>${percent}</cbc:Percent>
<cbc:TaxExemptionReasonCode>${GRATUITA_AFECTACION}</cbc:TaxExemptionReasonCode>
<cac:TaxScheme>
<cbc:ID>${GRATUITA_TRIBUTO_ID}</cbc:ID>
<cbc:Name>${GRATUITA_TRIBUTO_NAME}</cbc:Name>
<cbc:TaxTypeCode>${GRATUITA_TRIBUTO_TYPE}</cbc:TaxTypeCode>
</cac:TaxScheme>
</cac:TaxCategory>
</cac:TaxSubtotal>
</cac:TaxTotal>
<cac:Item>
<cbc:Description>${escapeXml(l.line.description)}</cbc:Description>
</cac:Item>
<cac:Price>
<cbc:PriceAmount currencyID="PEN">0.00</cbc:PriceAmount>
</cac:Price>
</cac:InvoiceLine>`;
}

function lineXml(id: number, l: LineTotals, percent: string): string {
  if (l.gratuita) return gratuitaLineXml(id, l, percent);
  return `<cac:InvoiceLine>
<cbc:ID>${id}</cbc:ID>
<cbc:InvoicedQuantity unitCode="NIU">${l.line.quantity}</cbc:InvoicedQuantity>
<cbc:LineExtensionAmount currencyID="PEN">${l.totalExclTax.toFixed(2)}</cbc:LineExtensionAmount>
<cac:PricingReference>
<cac:AlternativeConditionPrice>
<cbc:PriceAmount currencyID="PEN">${l.line.unitPriceInclTax.toFixed(6)}</cbc:PriceAmount>
<cbc:PriceTypeCode>01</cbc:PriceTypeCode>
</cac:AlternativeConditionPrice>
</cac:PricingReference>
<cac:TaxTotal>
<cbc:TaxAmount currencyID="PEN">${l.igv.toFixed(2)}</cbc:TaxAmount>
<cac:TaxSubtotal>
<cbc:TaxableAmount currencyID="PEN">${l.totalExclTax.toFixed(2)}</cbc:TaxableAmount>
<cbc:TaxAmount currencyID="PEN">${l.igv.toFixed(2)}</cbc:TaxAmount>
<cac:TaxCategory>
<cbc:Percent>${percent}</cbc:Percent>
<cbc:TaxExemptionReasonCode>10</cbc:TaxExemptionReasonCode>
<cac:TaxScheme>
<cbc:ID>1000</cbc:ID>
<cbc:Name>IGV</cbc:Name>
<cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
</cac:TaxScheme>
</cac:TaxCategory>
</cac:TaxSubtotal>
</cac:TaxTotal>
<cac:Item>
<cbc:Description>${escapeXml(l.line.description)}</cbc:Description>
</cac:Item>
<cac:Price>
<cbc:PriceAmount currencyID="PEN">${l.unitPriceExclTax.toFixed(6)}</cbc:PriceAmount>
</cac:Price>
</cac:InvoiceLine>`;
}

/**
 * Build the unsigned UBL 2.1 Invoice document. `sign.ts` fills the
 * `ext:ExtensionContent` placeholder below. Structure verified against a
 * known-accepted Greenter Factura-Gravada.xml sample (Peru UBL 2.1,
 * CustomizationID 2.0) — see PR description for source.
 */
export function buildInvoiceXml(inv: EmissionInvoice): string {
  const totals = computeTotals(inv);
  const id = `${inv.serie}-${inv.correlativo}`;
  const percent = formatPercent(inv.igvRate);
  const lines = totals.lines.map((l, i) => lineXml(i + 1, l, percent)).join('\n');
  // Legend 1002 is "Aplicable solo en el caso que TODAS las operaciones
  // (líneas o ítems) comprendidas en la factura electrónica sean gratuitas"
  // (guía factura UBL 2.1, Leyendas) — SUNAT's own mixed invoice with a
  // bonificación line carries legend 1000 only. Hence allGratuita, not "has a
  // gratuita".
  const gratuitaNote = totals.allGratuita
    ? '\n<cbc:Note languageLocaleID="1002">TRANSFERENCIA GRATUITA DE UN BIEN Y/O SERVICIO PRESTADO GRATUITAMENTE</cbc:Note>'
    : '';
  // Total valor de venta - operaciones gratuitas (guía numeral 26): present
  // whenever ANY line is gratuita, even if its reference value is zero.
  const gratuitaSubtotal = totals.lines.some((l) => l.gratuita)
    ? `\n<cac:TaxSubtotal>
<cbc:TaxableAmount currencyID="PEN">${totals.gratuitaAmount.toFixed(2)}</cbc:TaxableAmount>
<cbc:TaxAmount currencyID="PEN">0.00</cbc:TaxAmount>
<cac:TaxCategory>
<cac:TaxScheme>
<cbc:ID>${GRATUITA_TRIBUTO_ID}</cbc:ID>
<cbc:Name>${GRATUITA_TRIBUTO_NAME}</cbc:Name>
<cbc:TaxTypeCode>${GRATUITA_TRIBUTO_TYPE}</cbc:TaxTypeCode>
</cac:TaxScheme>
</cac:TaxCategory>
</cac:TaxSubtotal>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
${EXTENSION_PLACEHOLDER_XML}
<cbc:UBLVersionID>2.1</cbc:UBLVersionID>
<cbc:CustomizationID>2.0</cbc:CustomizationID>
<cbc:ID>${escapeXml(id)}</cbc:ID>
<cbc:IssueDate>${inv.issueDate}</cbc:IssueDate>
<cbc:InvoiceTypeCode listID="0101">${inv.docType}</cbc:InvoiceTypeCode>
<cbc:Note languageLocaleID="1000">${amountInWords(totals.payableAmount)}</cbc:Note>${gratuitaNote}
<cbc:DocumentCurrencyCode>${inv.currency}</cbc:DocumentCurrencyCode>
${signatureBlockXml(inv.emitter.ruc, inv.emitter.razonSocial)}
<cac:AccountingSupplierParty>
<cac:Party>
<cac:PartyIdentification>
<cbc:ID schemeID="6">${escapeXml(inv.emitter.ruc)}</cbc:ID>
</cac:PartyIdentification>
<cac:PartyLegalEntity>
<cbc:RegistrationName>${escapeXml(inv.emitter.razonSocial)}</cbc:RegistrationName>
<cac:RegistrationAddress>
${supplierAddress(inv)}
</cac:RegistrationAddress>
</cac:PartyLegalEntity>
</cac:Party>
</cac:AccountingSupplierParty>
<cac:AccountingCustomerParty>
<cac:Party>
<cac:PartyIdentification>
<cbc:ID schemeID="${inv.client.docType}">${escapeXml(inv.client.docNumber)}</cbc:ID>
</cac:PartyIdentification>
<cac:PartyLegalEntity>
<cbc:RegistrationName>${escapeXml(inv.client.name)}</cbc:RegistrationName>
</cac:PartyLegalEntity>
</cac:Party>
</cac:AccountingCustomerParty>
<!-- Facturas rejected by beta with SUNAT fault 3244 ("tipo de transaccion del
     comprobante") until FormaPago was added — not in the spec's element list,
     added after live iteration. Harmless (and accepted) on boletas too. -->
<cac:PaymentTerms>
<cbc:ID>FormaPago</cbc:ID>
<cbc:PaymentMeansID>Contado</cbc:PaymentMeansID>
</cac:PaymentTerms>
<cac:TaxTotal>
<cbc:TaxAmount currencyID="PEN">${totals.igvAmount.toFixed(2)}</cbc:TaxAmount>
<cac:TaxSubtotal>
<cbc:TaxableAmount currencyID="PEN">${totals.lineExtensionAmount.toFixed(2)}</cbc:TaxableAmount>
<cbc:TaxAmount currencyID="PEN">${totals.igvAmount.toFixed(2)}</cbc:TaxAmount>
<cac:TaxCategory>
<cac:TaxScheme>
<cbc:ID>1000</cbc:ID>
<cbc:Name>IGV</cbc:Name>
<cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
</cac:TaxScheme>
</cac:TaxCategory>
</cac:TaxSubtotal>${gratuitaSubtotal}
</cac:TaxTotal>
<cac:LegalMonetaryTotal>
<cbc:LineExtensionAmount currencyID="PEN">${totals.lineExtensionAmount.toFixed(2)}</cbc:LineExtensionAmount>
<cbc:TaxInclusiveAmount currencyID="PEN">${totals.taxInclusiveAmount.toFixed(2)}</cbc:TaxInclusiveAmount>
<cbc:PayableAmount currencyID="PEN">${totals.payableAmount.toFixed(2)}</cbc:PayableAmount>
</cac:LegalMonetaryTotal>
${lines}
</Invoice>`;
}
