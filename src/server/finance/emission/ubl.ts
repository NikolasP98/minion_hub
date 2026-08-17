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
}

export interface InvoiceTotals {
  lines: LineTotals[];
  lineExtensionAmount: number;
  igvAmount: number;
  taxInclusiveAmount: number;
  payableAmount: number;
}

/**
 * Derive per-line and document totals from tax-inclusive unit prices and the
 * document's own `igvRate` (per-org config — see types.ts).
 * Every line's exclTax/igv split is computed FROM its own rounded inclTax
 * total, so document totals (plain sums of line totals) are consistent with
 * the lines by construction — no independent rounding path that could drift.
 * That construction is what keeps `sum(lines) === totals` at EVERY rate, not
 * just at the one the library was originally built against.
 */
export function computeTotals(inv: EmissionInvoice): InvoiceTotals {
  const lines = inv.lines.map((line): LineTotals => {
    const totalInclTax = round(line.quantity * line.unitPriceInclTax, 2);
    const totalExclTax = round(totalInclTax / (1 + inv.igvRate), 2);
    const igv = round(totalInclTax - totalExclTax, 2);
    const unitPriceExclTax = round(totalExclTax / line.quantity, 6);
    return { line, totalInclTax, totalExclTax, igv, unitPriceExclTax };
  });
  const lineExtensionAmount = round(lines.reduce((s, l) => s + l.totalExclTax, 0), 2);
  const igvAmount = round(lines.reduce((s, l) => s + l.igv, 0), 2);
  const taxInclusiveAmount = round(lines.reduce((s, l) => s + l.totalInclTax, 0), 2);
  return { lines, lineExtensionAmount, igvAmount, taxInclusiveAmount, payableAmount: taxInclusiveAmount };
}

const UNITS = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
const TEENS = [
  'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE',
  'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE',
];
const TWENTIES = [
  'VEINTE', 'VEINTIUNO', 'VEINTIDOS', 'VEINTITRES', 'VEINTICUATRO',
  'VEINTICINCO', 'VEINTISEIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE',
];
const TENS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const HUNDREDS = [
  '', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
  'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS',
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
  if (!inv.emitter.ubigeo) return '<cac:Country><cbc:IdentificationCode>PE</cbc:IdentificationCode></cac:Country>';
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

/**
 * The rate as SUNAT's `cbc:Percent` wants it: a percentage, at most 2 decimals,
 * no trailing zeros (a rate of 18/100 renders `"18"`, 5.5/100 renders `"5.5"`).
 * Derived from the SAME
 * `igvRate` the totals are, so the declared percent and the divisor can never
 * disagree — a document whose arithmetic contradicts its declared rate is
 * rejected by SUNAT ("totales no consistentes").
 */
function percentXmlValue(igvRate: number): string {
  return String(round(igvRate * 100, 2));
}

function lineXml(id: number, l: LineTotals, igvPercent: string): string {
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
<cbc:Percent>${igvPercent}</cbc:Percent>
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
  const igvPercent = percentXmlValue(inv.igvRate);
  const lines = totals.lines.map((l, i) => lineXml(i + 1, l, igvPercent)).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
${EXTENSION_PLACEHOLDER_XML}
<cbc:UBLVersionID>2.1</cbc:UBLVersionID>
<cbc:CustomizationID>2.0</cbc:CustomizationID>
<cbc:ID>${escapeXml(id)}</cbc:ID>
<cbc:IssueDate>${inv.issueDate}</cbc:IssueDate>
<cbc:InvoiceTypeCode listID="0101">${inv.docType}</cbc:InvoiceTypeCode>
<cbc:Note languageLocaleID="1000">${amountInWords(totals.payableAmount)}</cbc:Note>
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
</cac:TaxSubtotal>
</cac:TaxTotal>
<cac:LegalMonetaryTotal>
<cbc:LineExtensionAmount currencyID="PEN">${totals.lineExtensionAmount.toFixed(2)}</cbc:LineExtensionAmount>
<cbc:TaxInclusiveAmount currencyID="PEN">${totals.taxInclusiveAmount.toFixed(2)}</cbc:TaxInclusiveAmount>
<cbc:PayableAmount currencyID="PEN">${totals.payableAmount.toFixed(2)}</cbc:PayableAmount>
</cac:LegalMonetaryTotal>
${lines}
</Invoice>`;
}
